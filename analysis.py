"""
Faseeh acoustic comparison engine (librosa + FastDTW).

Architecture: Pipe & Filter
---------------------------
Each filter takes the previous filter's output and adds one transformation. Filters are
plain functions with no HTTP, file-system policy or domain knowledge beyond "a list of
word weights", so each can be tested, timed and replaced on its own.

    user file ──► [F1 load_audio] ──► [F2 check_quality] ──► [F3 extract_features] ──┐
                                                                                      ▼
    reference ──► [F1 load_audio] ──► [F2 trim_silence]  ──► [F3 extract_features] ──► [F4 align]
                                                                                      │
                            AnalysisResult ◄── [F5b judge / mock] ◄── [F5a word_costs] ◄┘

  F1  Ingestion & decoding   any browser format -> mono 16 kHz float32 (ffmpeg -> wav -> librosa)
  F2  Quality gating         silent / too short / wrong length -> "unclear" before heavy work
  F3  Feature extraction     MFCC c1..c13 + deltas, mean/variance normalized, unit-length rows
  F4  Alignment & scoring    FastDTW path + per-step distances -> 0..100 similarity score
  F5  Cost mapping & judging alignment cost per reference word -> flagged outlier words

Two modes (chosen by service.py):
  * "mock" (default): F1-F4 run for real, so silence, too-short recordings and duration
    mismatches are detected and the score reflects real audio when a reference is
    available. The flagged word comes from the ayah's prepared `focus_word`.
  * "dtw": experimental. Words whose alignment cost stands out are flagged. Thresholds
    are uncalibrated placeholders; tune them with real recordings (see "Calibration").

Calibration
-----------
Every result carries a `debug` dict with per-filter timings and granular DTW metrics
(path length, warp ratio, diagonal deviation, step-distance percentiles, per-word costs).
service.py logs it, and appends it as JSON lines to FASEEH_CALIBRATION_LOG when set.
Any AnalysisConfig field can be overridden without code changes through an environment
variable named FASEEH_CFG_<FIELD_NAME_IN_UPPER_CASE>, e.g. FASEEH_CFG_RELATIVE_THRESHOLD=1.5.
"""
from __future__ import annotations

import logging
import os
import shutil
import subprocess
import tempfile
import time
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field, fields
from functools import lru_cache
from pathlib import Path
from typing import Iterator, Literal

import librosa
import numpy as np
from fastdtw import fastdtw

logger = logging.getLogger("faseeh.analysis")

SAMPLE_RATE = 16_000
N_FFT = 512          # 32 ms window
HOP_LENGTH = 320     # 20 ms hop -> 50 frames per second
FRAMES_PER_SECOND = SAMPLE_RATE / HOP_LENGTH
N_MFCC = 13

Status = Literal["ok", "errors", "unclear"]
Mode = Literal["mock", "dtw"]


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class AnalysisConfig:
    """All tunable thresholds of the pipeline, grouped by the filter that uses them."""

    # F2 - quality gates
    top_db: float = 30.0              # trim: anything quieter than (peak - top_db) dB is silence
    min_rms: float = 1e-3             # overall loudness below this = silent
    min_voiced_seconds: float = 0.5   # voiced speech shorter than this = too short
    min_duration_ratio: float = 0.3   # user / reference voiced duration outside [min, max]
    max_duration_ratio: float = 3.5   #   -> probably not the selected ayah
    max_voiced_seconds: float = 90.0  # hard cap on user audio fed to DTW (bounds CPU time)

    # F4 - alignment and score
    dtw_radius: int = 10
    # Score: mean per-step distance (unit vectors, range 0..2) mapped linearly to 100..0.
    # Synthetic tests: correct 0.40-0.74, one wrong word 0.52-0.68, unrelated audio >= 1.18.
    # Re-calibrate with real recordings (meanStep / stepP50 / stepP90 in the debug metrics).
    score_best: float = 0.40
    score_worst: float = 1.20
    unclear_below_score: int = 20     # dtw mode: too different to judge

    # F5 - word flagging (dtw mode). UNCALIBRATED.
    relative_threshold: float = 1.35  # word cost / median word cost
    median_cost_floor: float = 0.10   # median below this is clamped, so near-perfect takes don't
                                      # turn tiny absolute differences into huge ratios
    min_word_frames: int = 3         # words shorter than this in the reference are never flagged
    max_errors: int = 3

    def __post_init__(self) -> None:
        problems = []
        if self.top_db <= 0:
            problems.append("top_db must be > 0")
        if self.min_rms < 0:
            problems.append("min_rms must be >= 0")
        if not 0 < self.min_voiced_seconds < self.max_voiced_seconds:
            problems.append("need 0 < min_voiced_seconds < max_voiced_seconds")
        if not 0 < self.min_duration_ratio < 1 < self.max_duration_ratio:
            problems.append("need 0 < min_duration_ratio < 1 < max_duration_ratio")
        if self.dtw_radius < 1:
            problems.append("dtw_radius must be >= 1")
        if not 0 <= self.score_best < self.score_worst <= 2:
            problems.append("need 0 <= score_best < score_worst <= 2")
        if not 0 <= self.unclear_below_score <= 100:
            problems.append("unclear_below_score must be within 0..100")
        if self.relative_threshold <= 1:
            problems.append("relative_threshold must be > 1")
        if self.median_cost_floor <= 0:
            problems.append("median_cost_floor must be > 0")
        if self.min_word_frames < 1 or self.max_errors < 1:
            problems.append("min_word_frames and max_errors must be >= 1")
        if problems:
            raise ValueError("Invalid AnalysisConfig: " + "; ".join(problems))

    @classmethod
    def from_env(cls, prefix: str = "FASEEH_CFG_") -> "AnalysisConfig":
        """Defaults, overridden by FASEEH_CFG_<FIELD> environment variables (for calibration runs)."""
        overrides: dict = {}
        for f in fields(cls):
            raw = os.getenv(prefix + f.name.upper())
            if raw is None or not raw.strip():
                continue
            caster = int if f.type in ("int", int) else float
            try:
                overrides[f.name] = caster(raw.strip())
            except ValueError:
                raise ValueError(f"{prefix + f.name.upper()} must be a number, got {raw!r}") from None
        cfg = cls(**overrides)
        if overrides:
            logger.info("AnalysisConfig overrides from environment: %s", overrides)
        return cfg

    def as_dict(self) -> dict:
        return asdict(self)


DEFAULT_CONFIG = AnalysisConfig.from_env()


# ---------------------------------------------------------------------------
# Results and errors
# ---------------------------------------------------------------------------
@dataclass
class FlaggedWord:
    word_index: int
    confidence: float


@dataclass
class AnalysisResult:
    status: Status
    score: int | None = None
    flagged: list[FlaggedWord] = field(default_factory=list)
    reason: str | None = None          # silent | too_short | duration_mismatch | too_different
    debug: dict = field(default_factory=dict)


class AudioLoadError(Exception):
    """The audio file could not be decoded."""


class FFmpegNotFound(RuntimeError):
    """No ffmpeg executable is available: a server setup problem, not a bad recording."""


FFMPEG_HELP = (
    "ffmpeg was not found, so the server can't decode browser recordings (webm/mp4). "
    "Fix: run `pip install imageio-ffmpeg` and restart the server, or install ffmpeg "
    "and open a NEW terminal so it is on PATH, or set FASEEH_FFMPEG to the full path of ffmpeg.exe."
)


@contextmanager
def _timed(debug: dict, name: str) -> Iterator[None]:
    """Record the wall time of one filter in debug['timingsMs'][name]."""
    start = time.perf_counter()
    try:
        yield
    finally:
        debug.setdefault("timingsMs", {})[name] = round((time.perf_counter() - start) * 1000, 1)


@lru_cache(maxsize=1)
def find_ffmpeg() -> str | None:
    """Locate ffmpeg: FASEEH_FFMPEG env var -> system PATH -> imageio-ffmpeg's bundled binary."""
    custom = os.getenv("FASEEH_FFMPEG", "").strip().strip('"')
    if custom and Path(custom).is_file():
        return custom
    on_path = shutil.which("ffmpeg")
    if on_path:
        return on_path
    try:
        import imageio_ffmpeg  # pip install imageio-ffmpeg (ships its own ffmpeg binary)
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


# ---------------------------------------------------------------------------
# F1. Ingestion & decoding
# ---------------------------------------------------------------------------
def load_audio(path: str | Path) -> np.ndarray:
    """Load any audio file as mono float32 at SAMPLE_RATE.

    Browser recordings (webm/opus, mp4/aac) are converted to wav with ffmpeg first:
    libsndfile (librosa's default reader) can't open them, and librosa's audioread
    fallback is deprecated.
    """
    path = Path(path)
    if path.suffix.lower() in {".wav", ".flac"}:
        return _librosa_load(path)

    ffmpeg = find_ffmpeg()
    if ffmpeg is None:
        raise FFmpegNotFound(FFMPEG_HELP)

    fd, wav_path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    try:
        proc = subprocess.run(
            [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(path),
             "-ac", "1", "-ar", str(SAMPLE_RATE), wav_path],
            capture_output=True, timeout=60,
        )
        if proc.returncode != 0:
            lines = [ln.strip() for ln in proc.stderr.decode(errors="ignore").splitlines() if ln.strip()]
            raise AudioLoadError(lines[-1][:200] if lines else "ffmpeg could not decode the audio")
        return _librosa_load(Path(wav_path))
    except subprocess.TimeoutExpired as exc:
        raise AudioLoadError("decoding took too long (over 60 s)") from exc
    finally:
        try:
            os.remove(wav_path)
        except OSError:
            pass


def _librosa_load(path: Path) -> np.ndarray:
    try:
        y, _ = librosa.load(str(path), sr=SAMPLE_RATE, mono=True)
    except Exception as exc:
        raise AudioLoadError(f"could not read {path.name}: {exc}") from exc
    if y.size == 0:
        raise AudioLoadError("the audio is empty")
    return y.astype(np.float32)


# ---------------------------------------------------------------------------
# F2. Quality gating
# ---------------------------------------------------------------------------
def trim_silence(y: np.ndarray, cfg: AnalysisConfig = DEFAULT_CONFIG) -> np.ndarray:
    trimmed, _ = librosa.effects.trim(y, top_db=cfg.top_db, frame_length=N_FFT, hop_length=HOP_LENGTH)
    return trimmed


def check_quality(y: np.ndarray, cfg: AnalysisConfig = DEFAULT_CONFIG) -> tuple[str | None, np.ndarray]:
    """Return (reason or None, trimmed audio). Over-long input is cut to max_voiced_seconds."""
    if y.size == 0 or float(np.sqrt(np.mean(y ** 2))) < cfg.min_rms:
        return "silent", y[:0]
    voiced = trim_silence(y, cfg)
    if voiced.size / SAMPLE_RATE < cfg.min_voiced_seconds:
        return "too_short", voiced
    return None, voiced[: int(cfg.max_voiced_seconds * SAMPLE_RATE)]


def signal_metrics(y: np.ndarray, voiced: np.ndarray) -> dict:
    """Loudness numbers that help tune min_rms / top_db."""
    rms = float(np.sqrt(np.mean(y ** 2))) if y.size else 0.0
    peak = float(np.max(np.abs(y))) if y.size else 0.0
    return {
        "rawSeconds": round(y.size / SAMPLE_RATE, 2),
        "rms": round(rms, 5),
        "peak": round(peak, 4),
        "voicedFraction": round(voiced.size / max(y.size, 1), 2),
    }


# ---------------------------------------------------------------------------
# F3. Feature extraction
# ---------------------------------------------------------------------------
def extract_features(y: np.ndarray) -> np.ndarray:
    """MFCC c1..c13 + deltas, shape (frames, 26), mean/variance normalized, unit-length rows.

    c0 (overall energy) is dropped and each recording is normalized on its own, which
    removes most differences in microphone, loudness and voice. Unit-length rows make
    the euclidean distance used by FastDTW behave like cosine distance.
    """
    mfcc = librosa.feature.mfcc(y=y, sr=SAMPLE_RATE, n_mfcc=N_MFCC + 1,
                                n_fft=N_FFT, hop_length=HOP_LENGTH)[1:]
    n_frames = mfcc.shape[1]
    width = min(9, n_frames if n_frames % 2 else n_frames - 1)
    delta = librosa.feature.delta(mfcc, width=width) if width >= 3 else np.zeros_like(mfcc)

    feat = np.vstack([mfcc, delta]).T
    feat = (feat - feat.mean(axis=0)) / (feat.std(axis=0) + 1e-8)
    feat /= np.linalg.norm(feat, axis=1, keepdims=True) + 1e-8
    return feat


# ---------------------------------------------------------------------------
# F4. Temporal alignment & scoring
# ---------------------------------------------------------------------------
def align(ref_feat: np.ndarray, usr_feat: np.ndarray,
          cfg: AnalysisConfig = DEFAULT_CONFIG) -> tuple[np.ndarray, np.ndarray]:
    """FastDTW alignment. Returns (path as (k, 2) [ref_frame, user_frame], per-step distances)."""
    _, path = fastdtw(ref_feat, usr_feat, radius=cfg.dtw_radius, dist=2)
    path = np.asarray(path, dtype=int)
    steps = np.linalg.norm(ref_feat[path[:, 0]] - usr_feat[path[:, 1]], axis=1)
    return path, steps


def alignment_metrics(path: np.ndarray, steps: np.ndarray, n_ref: int, n_usr: int) -> dict:
    """Granular DTW metrics for threshold calibration.

    pathLength            number of aligned frame pairs
    warpRatio             pathLength / max(n_ref, n_usr); 1.0 = straight diagonal,
                          higher = more stretching/compression (pauses, skipped words)
    maxDiagonalDeviation  largest distance of the path from the straight diagonal,
                          as a fraction of the user's frames (0 = no warping)
    stepP50/P90/Max       distribution of per-step distances (range 0..2)
    worstStretch*         the 1-second window with the highest mean distance, in reference time
    """
    ref_pos = path[:, 0] / max(n_ref - 1, 1)
    usr_pos = path[:, 1] / max(n_usr - 1, 1)
    window = max(1, int(FRAMES_PER_SECOND))
    if steps.size >= window:
        rolling = np.convolve(steps, np.ones(window) / window, mode="valid")
        worst = int(np.argmax(rolling))
        worst_mean, worst_ref_start = float(rolling[worst]), int(path[worst, 0])
    else:
        worst_mean, worst_ref_start = float(steps.mean()), 0
    return {
        "refFrames": int(n_ref),
        "userFrames": int(n_usr),
        "pathLength": int(len(path)),
        "warpRatio": round(len(path) / max(n_ref, n_usr, 1), 3),
        "maxDiagonalDeviation": round(float(np.max(np.abs(ref_pos - usr_pos))), 3),
        "stepP50": round(float(np.percentile(steps, 50)), 3),
        "stepP90": round(float(np.percentile(steps, 90)), 3),
        "stepMax": round(float(steps.max()), 3),
        "worstStretchMean": round(worst_mean, 3),
        "worstStretchRefSeconds": round(worst_ref_start / FRAMES_PER_SECOND, 2),
    }


def cost_to_score(mean_step: float, cfg: AnalysisConfig = DEFAULT_CONFIG) -> int:
    frac = (cfg.score_worst - mean_step) / (cfg.score_worst - cfg.score_best)
    return int(round(100 * float(np.clip(frac, 0.0, 1.0))))


# ---------------------------------------------------------------------------
# F5a. Cost mapping onto words
# ---------------------------------------------------------------------------
def word_frame_bounds(word_weights: list[int], n_frames: int) -> list[tuple[int, int]]:
    """Split the reference into word segments in proportion to `word_weights`.

    TODO (next step): replace with real per-word timings for the reference recitation.
    """
    w = np.asarray(word_weights, dtype=float)
    edges = np.round(np.concatenate([[0.0], np.cumsum(w)]) / w.sum() * n_frames).astype(int)
    return [(int(edges[i]), int(max(edges[i + 1], edges[i] + 1))) for i in range(len(w))]


def word_costs(path: np.ndarray, steps: np.ndarray, n_ref_frames: int,
               word_weights: list[int]) -> np.ndarray:
    """Mean alignment distance of each reference word."""
    sums = np.bincount(path[:, 0], weights=steps, minlength=n_ref_frames)
    counts = np.bincount(path[:, 0], minlength=n_ref_frames)
    per_frame = sums / np.maximum(counts, 1)
    bounds = word_frame_bounds(word_weights, n_ref_frames)
    return np.array([per_frame[s:min(e, n_ref_frames)].mean() for s, e in bounds])


# ---------------------------------------------------------------------------
# Pipeline entry point
# ---------------------------------------------------------------------------
def analyze(user_audio_path: str | Path,
            reference_audio_path: str | Path | None,
            word_weights: list[int],
            *,
            mode: Mode = "mock",
            mock_focus_index: int = 0,
            mock_outcome: Literal["errors", "ok"] = "errors",
            cfg: AnalysisConfig = DEFAULT_CONFIG) -> AnalysisResult:
    """Run the filters F1..F5 on a user recording and the reference recitation of the same ayah.

    word_weights: one weight per word of the ayah (e.g. letter counts), used to estimate
    where each word lies in the reference.
    """
    if not word_weights or min(word_weights) <= 0:
        raise ValueError("word_weights must be a non-empty list of positive numbers")
    debug: dict = {"mode": mode}

    # F1 + F2 on the user recording: cheap rejections first.
    with _timed(debug, "decodeUser"):
        user = load_audio(user_audio_path)
    with _timed(debug, "qualityGate"):
        reason, user_voiced = check_quality(user, cfg)
    debug["userSeconds"] = round(user_voiced.size / SAMPLE_RATE, 2)
    debug["signal"] = signal_metrics(user, user_voiced)
    if reason:
        return _finish(AnalysisResult(status="unclear", reason=reason, debug=debug))

    score: int | None = None
    costs: np.ndarray | None = None
    if reference_audio_path is not None:
        with _timed(debug, "decodeReference"):
            ref_voiced = trim_silence(load_audio(reference_audio_path), cfg)
        ratio = user_voiced.size / max(ref_voiced.size, 1)
        debug.update(referenceSeconds=round(ref_voiced.size / SAMPLE_RATE, 2), durationRatio=round(ratio, 2))
        if not cfg.min_duration_ratio <= ratio <= cfg.max_duration_ratio:
            return _finish(AnalysisResult(status="unclear", reason="duration_mismatch", debug=debug))

        # F3
        with _timed(debug, "features"):
            ref_feat, usr_feat = extract_features(ref_voiced), extract_features(user_voiced)
        # F4
        with _timed(debug, "dtw"):
            path, steps = align(ref_feat, usr_feat, cfg)
        mean_step = float(steps.mean())
        score = cost_to_score(mean_step, cfg)
        debug["meanStep"] = round(mean_step, 3)
        debug["alignment"] = alignment_metrics(path, steps, len(ref_feat), len(usr_feat))
        # F5a
        with _timed(debug, "wordCosts"):
            costs = word_costs(path, steps, len(ref_feat), word_weights)
        debug["wordCosts"] = [round(float(c), 3) for c in costs]
        debug["wordFrames"] = [e - s for s, e in word_frame_bounds(word_weights, len(ref_feat))]

    # F5b
    if mode == "mock":
        return _finish(_mock_result(score, mock_focus_index, mock_outcome, debug))
    if costs is None:
        raise ValueError("dtw mode needs a reference recording")
    return _finish(_judge(score, costs, debug["wordFrames"], cfg, debug))


def _finish(result: AnalysisResult) -> AnalysisResult:
    total = sum(result.debug.get("timingsMs", {}).values())
    result.debug["totalMs"] = round(total, 1)
    logger.debug("pipeline metrics: status=%s score=%s debug=%s", result.status, result.score, result.debug)
    return result


def _mock_result(score: int | None, focus_index: int, outcome: str, debug: dict) -> AnalysisResult:
    """Realistic fake result for frontend testing. Uses the real score when available."""
    if outcome == "ok":
        return AnalysisResult(status="ok", score=max(score if score is not None else 92, 85), debug=debug)
    return AnalysisResult(
        status="errors",
        score=min(score if score is not None else 74, 84),
        flagged=[FlaggedWord(word_index=focus_index, confidence=0.9)],
        debug=debug,
    )


def _judge(score: int, costs: np.ndarray, word_frames: list[int],
           cfg: AnalysisConfig, debug: dict) -> AnalysisResult:
    """Flag words whose alignment cost stands out. Placeholder thresholds."""
    if score < cfg.unclear_below_score:
        return AnalysisResult(status="unclear", score=score, reason="too_different", debug=debug)

    median = float(np.median(costs))
    relative = costs / max(median, cfg.median_cost_floor)
    debug["medianWordCost"] = round(median, 3)
    debug["relativeCosts"] = [round(float(r), 2) for r in relative]
    debug["relativeThreshold"] = cfg.relative_threshold
    candidates = [
        i for i in np.argsort(-relative)
        if relative[i] >= cfg.relative_threshold and word_frames[i] >= cfg.min_word_frames
    ]
    ranked = candidates[: cfg.max_errors]
    debug["flaggedIndices"] = [int(i) for i in sorted(ranked)]
    flagged = [
        # confidence 0.5 at the threshold, rising to 0.95 for clear outliers
        FlaggedWord(word_index=int(i),
                    confidence=round(min(0.95, 0.5 + (float(relative[i]) - cfg.relative_threshold) / 2), 2))
        for i in sorted(ranked)
    ]
    return AnalysisResult(status="errors" if flagged else "ok", score=score, flagged=flagged, debug=debug)

"""
Application / service layer: validate the request, store the upload, find the reference
audio, run the acoustic pipeline (analysis.py) and shape the response to the frontend's
contract:

    { surah, ayah, status, score, reason, message,
      errors: [{ wordIndex, word, rule, confidence }] }

This module never imports FastAPI: it raises AnalysisRequestError with an HTTP status and
lets main.py translate it, so the same logic can be called from tests or a CLI.

Settings (environment variables):
    FASEEH_ANALYSIS_MODE     mock (default) | dtw
    FASEEH_MOCK_OUTCOME      alternate (default) | errors | ok
                             alternate = errors on the 1st take of an ayah, ok on the 2nd, ...
    FASEEH_CALIBRATION_LOG   optional path of a JSON-lines file; every analysis appends one
                             line with its DTW metrics, for threshold calibration
    FASEEH_CFG_<FIELD>       override any AnalysisConfig threshold (see analysis.py)
"""
from __future__ import annotations

import json
import logging
import os
import tempfile
import threading
import time
from collections import defaultdict
from pathlib import Path

import analysis
from quran_data import get_ayah, letter_count
from reference import ReferenceUnavailable, get_reference_path
from rules import guess_rule

logger = logging.getLogger("faseeh.service")

ANALYSIS_MODE = os.getenv("FASEEH_ANALYSIS_MODE", "mock").strip().lower()
MOCK_OUTCOME = os.getenv("FASEEH_MOCK_OUTCOME", "alternate").strip().lower()
CALIBRATION_LOG = os.getenv("FASEEH_CALIBRATION_LOG", "").strip()
MAX_UPLOAD_BYTES = 10 * 1024 * 1024

if ANALYSIS_MODE not in {"mock", "dtw"}:
    raise RuntimeError("FASEEH_ANALYSIS_MODE must be 'mock' or 'dtw'")
if MOCK_OUTCOME not in {"alternate", "errors", "ok"}:
    raise RuntimeError("FASEEH_MOCK_OUTCOME must be 'alternate', 'errors' or 'ok'")

REASON_MESSAGES = {
    "silent": "No voice was detected in the recording.",
    "too_short": "The recording was too short to analyze.",
    "duration_mismatch": "The recording length doesn't match this ayah. Did you recite the selected ayah?",
    "too_different": "The recording is too different from the reference to judge "
                     "(wrong ayah or heavy background noise).",
}

_SUFFIX_BY_TYPE = {
    "audio/webm": ".webm", "video/webm": ".webm",
    "audio/mp4": ".mp4", "video/mp4": ".mp4", "audio/x-m4a": ".m4a", "audio/aac": ".aac",
    "audio/ogg": ".ogg", "audio/mpeg": ".mp3",
    "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/wave": ".wav",
}


class AnalysisRequestError(Exception):
    """A request problem that should be returned to the client as {"detail": ...}."""

    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


# --- "alternate" mock outcome bookkeeping -----------------------------------
_attempts: defaultdict[str, int] = defaultdict(int)
_attempts_lock = threading.Lock()


def _mock_outcome_for(surah: int, ayah: int) -> str:
    if MOCK_OUTCOME != "alternate":
        return MOCK_OUTCOME
    with _attempts_lock:
        _attempts[f"{surah}:{ayah}"] += 1
        return "errors" if _attempts[f"{surah}:{ayah}"] % 2 == 1 else "ok"


# --- calibration log (JSON lines) -------------------------------------------
_calibration_lock = threading.Lock()


def _record_calibration(surah: int, ayah: int, result: analysis.AnalysisResult) -> None:
    """Append one line of metrics to FASEEH_CALIBRATION_LOG. Never fails the request."""
    if not CALIBRATION_LOG:
        return
    entry = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "surah": surah,
        "ayah": ayah,
        "status": result.status,
        "score": result.score,
        "reason": result.reason,
        "flagged": [f.word_index for f in result.flagged],
        "debug": result.debug,
    }
    try:
        with _calibration_lock, open(CALIBRATION_LOG, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except OSError as exc:
        logger.warning("Could not write calibration log %s: %s", CALIBRATION_LOG, exc)


# --- helpers ----------------------------------------------------------------
def _parse_int(value: str, field: str) -> int:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        raise AnalysisRequestError(400, f"'{field}' must be a whole number, got {value!r}") from None


def _suffix_for(filename: str, content_type: str) -> str:
    suffix = Path(filename or "").suffix.lower()
    if suffix:
        return suffix
    base_type = (content_type or "").split(";")[0].strip().lower()
    return _SUFFIX_BY_TYPE.get(base_type, ".webm")


# --- entry point --------------------------------------------------------------
def analyze_recording(data: bytes, filename: str, content_type: str,
                      surah_raw: str, ayah_raw: str) -> dict:
    surah = _parse_int(surah_raw, "surah")
    ayah = _parse_int(ayah_raw, "ayah")
    target = get_ayah(surah, ayah)
    if target is None:
        raise AnalysisRequestError(400, f"Unknown ayah {surah}:{ayah}. Supported surahs: 112, 113, 114.")
    if not data:
        raise AnalysisRequestError(422, "The uploaded recording is empty.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise AnalysisRequestError(413, "The recording is too large (max 10 MB).")

    # Reference audio: required in dtw mode, nice-to-have in mock mode (gives a real score).
    reference_path: Path | None
    try:
        reference_path = get_reference_path(surah, ayah)
    except ReferenceUnavailable as exc:
        if ANALYSIS_MODE == "dtw":
            raise AnalysisRequestError(502, str(exc)) from exc
        logger.warning("Mock mode without reference audio: %s", exc)
        reference_path = None

    fd, user_path = tempfile.mkstemp(suffix=_suffix_for(filename, content_type))
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        result = analysis.analyze(
            user_path,
            reference_path,
            [letter_count(w) for w in target.words],
            mode=ANALYSIS_MODE,
            mock_focus_index=target.focus_word,
            mock_outcome=_mock_outcome_for(surah, ayah) if ANALYSIS_MODE == "mock" else "errors",
        )
    except analysis.FFmpegNotFound as exc:
        raise AnalysisRequestError(500, str(exc)) from exc
    except analysis.AudioLoadError as exc:
        raise AnalysisRequestError(422, f"Could not decode the recording: {exc}") from exc
    finally:
        try:
            os.remove(user_path)
        except OSError:
            pass

    align = result.debug.get("alignment", {})
    logger.info(
        "%s:%s -> %s score=%s meanStep=%s warp=%s p90=%s userSec=%s refSec=%s totalMs=%s",
        surah, ayah, result.status, result.score, result.debug.get("meanStep"),
        align.get("warpRatio"), align.get("stepP90"), result.debug.get("userSeconds"),
        result.debug.get("referenceSeconds"), result.debug.get("totalMs"),
    )
    logger.debug("%s:%s full metrics: %s", surah, ayah, result.debug)
    _record_calibration(surah, ayah, result)
    return build_response(surah, ayah, target.words, result)


def build_response(surah: int, ayah: int, words: tuple[str, ...], result: analysis.AnalysisResult) -> dict:
    errors = [
        {
            "wordIndex": f.word_index,
            "word": words[f.word_index],
            "rule": guess_rule(words[f.word_index]),
            "confidence": round(float(f.confidence), 2),
        }
        for f in result.flagged
        if 0 <= f.word_index < len(words)
    ]
    status = result.status
    if status == "errors" and not errors:
        status = "ok"
    return {
        "surah": surah,
        "ayah": ayah,
        "status": status,
        "score": result.score,
        "reason": result.reason if status == "unclear" else None,
        "message": REASON_MESSAGES.get(result.reason) if status == "unclear" else None,
        "errors": errors if status == "errors" else [],
    }

"""Validate uploaded audio, invoke Quran Muaalem and handle explicit retention."""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from uuid import uuid4

import numpy as np

MAX_BYTES = 25_000_000
MAX_SECONDS = 330
SAMPLE_RATE = 16_000
WEB = (Path(__file__).resolve().parent / "web").resolve()
FORMATS = "wav,ogg,matroska,webm,mov,mp4,m4a,3gp,3g2,mj2,mp3,flac,aac,aiff,amr"
log = logging.getLogger(__name__)


class ApiProblem(Exception):
    def __init__(self, status, code, detail):
        super().__init__(detail)
        self.status, self.code, self.detail = status, code, detail


def _media_tool(command):
    try:
        result = subprocess.run(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, timeout=45, check=False)
    except FileNotFoundError as exc:
        raise ApiProblem(503, "unavailable", "Audio processing is unavailable.") from exc
    except subprocess.TimeoutExpired as exc:
        raise ApiProblem(422, "invalid_audio", "The recording could not be decoded in time.") from exc
    if result.returncode:
        raise ApiProblem(422, "invalid_audio", "Choose a supported, decodable audio file.")
    return result.stdout


def decode(path):
    # Disallow playlists, network protocols, and demuxers for non-audio documents.
    input_options = ["-v", "error", "-max_alloc", "67108864", "-protocol_whitelist", "file",
                     "-format_whitelist", FORMATS]
    metadata = _media_tool(["ffprobe", *input_options, "-show_entries",
                            "stream=codec_type:stream_disposition=attached_pic",
                            "-of", "json", str(path)])
    streams = json.loads(metadata).get("streams", [])
    if (not any(s.get("codec_type") == "audio" for s in streams)
        or any(s.get("codec_type") != "audio" and not s.get("disposition", {}).get("attached_pic")
               for s in streams)):
        raise ApiProblem(422, "invalid_audio", "Choose an audio-only recording.")
    # Decode max duration plus a small sentinel so compressed audio cannot allocate unbounded PCM.
    pcm = _media_tool(["ffmpeg", "-nostdin", "-xerror", *input_options, "-threads", "1",
                       "-i", str(path), "-map", "0:a:0", "-t", str(MAX_SECONDS + .1),
                       "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "s16le", "pipe:1"])
    samples = np.frombuffer(pcm, dtype="<i2")
    if samples.size > MAX_SECONDS * SAMPLE_RATE:
        raise ApiProblem(413, "too_long", "Use a recording of 330 seconds or less. Choose fewer Ayahs.")
    if not samples.size:
        raise ApiProblem(422, "invalid_audio", "No audio could be decoded.")
    audio = samples.astype(np.float32) / 32768
    if max(abs(float(audio.min())), abs(float(audio.max()))) < .001:
        raise ApiProblem(422, "no_voice", "No voice was heard.")
    return audio


def retain(upload_path, root, name, surah, start, end):
    dest = Path(root).expanduser().resolve()
    if dest == WEB or dest.is_relative_to(WEB):
        raise ApiProblem(503, "unavailable", "The private recording store is unavailable.")
    try:
        dest.mkdir(mode=0o700, parents=True, exist_ok=True)
        # An opt-in archive never exposes names in filenames or uses them as paths.
        with tempfile.TemporaryDirectory(dir=dest, prefix=".incoming-") as staging:
            staging = Path(staging)
            shutil.copyfile(upload_path, staging / "recording")
            (staging / "consent.json").write_text(json.dumps({
                "consent": True, "name": name.strip() or None, "surah": surah,
                "startAyah": start, "endAyah": end,
            }, ensure_ascii=False), encoding="utf-8")
            staging.rename(dest / uuid4().hex)
    except OSError as exc:
        raise ApiProblem(503, "unavailable", "The private recording store is unavailable.") from exc


def process_recording(stream, surah, start, end, consent=False, name=""):
    archive = os.getenv("FASEEH_RECORDINGS_DIR")
    if consent and not archive:
        raise ApiProblem(400, "invalid_request", "Recording contributions are disabled on this server.")
    with tempfile.TemporaryDirectory(prefix="faseeh-") as workspace:
        path = Path(workspace) / "recording"
        with path.open("wb") as output:
            shutil.copyfileobj(stream, output, length=64 * 1024)
        audio = decode(path)
        try:
            from muaalem_engine import EngineError, analyze
        except ImportError as exc:
            raise ApiProblem(503, "unavailable", "The pronunciation model is unavailable.") from exc
        try:
            result = analyze(audio, surah, start, end)
        except EngineError as exc:
            status = 503 if exc.code in {"busy", "unavailable"} else 422
            raise ApiProblem(status, exc.code, str(exc)) from exc
        except Exception as exc:
            log.exception("Model inference failed for Surah %s", surah)
            raise ApiProblem(503, "unavailable", "The pronunciation model could not complete analysis.") from exc
        if consent:
            retain(path, archive, name, surah, start, result["endAyah"])
        return result

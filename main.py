"""Faseeh reader and post-recording analysis API. Run one ASGI worker per server."""
from __future__ import annotations

import os
import shutil
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.datastructures import UploadFile
from starlette.exceptions import HTTPException
from starlette.formparsers import MultiPartException
from python_multipart.exceptions import MultipartParseError

from recording_service import ApiProblem, MAX_BYTES, MAX_SECONDS, process_recording

BASE = Path(__file__).resolve().parent
WEB = BASE / "web"
COUNTS = {78: 40, 80: 42, 103: 3, 108: 3, 112: 4, 113: 5, 114: 6}
MAX_REQUEST = MAX_BYTES + 64 * 1024
CAPACITY = 40
ANALYSIS_PATHS = {"/analyze", "/api/analyze"}


def problem(status, code, detail):
    return JSONResponse({"code": code, "detail": detail}, status_code=status,
                        headers={"Cache-Control": "no-store"})


class AdmissionControl:
    """Admit requests before buffering uploads; an individual worker has one event loop."""
    def __init__(self, app):
        self.app = app
        self.active = 0

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["path"] not in ANALYSIS_PATHS or scope["method"] != "POST":
            return await self.app(scope, receive, send)
        request = Request(scope)
        # Uvicorn should trust X-Forwarded-Proto only from the deployment's TLS terminator.
        peer = scope.get("client")
        local = (request.url.hostname in {"localhost", "127.0.0.1", "::1"}
                 and peer is not None and peer[0] in {"127.0.0.1", "::1"})
        if scope["scheme"] != "https" and not local:
            return await problem(400, "https_required", "Use HTTPS to transmit recordings.")(scope, receive, send)
        length = request.headers.get("content-length")
        if length is not None and (not length.isdecimal() or len(length) > 15 or int(length) > MAX_REQUEST):
            return await problem(413, "too_large", "Use a recording of 25 MB or less.")(scope, receive, send)
        if self.active >= CAPACITY:
            return await problem(503, "busy", "The analysis server is busy.")(scope, receive, send)
        self.active += 1
        consumed = 0

        async def limited_receive():
            nonlocal consumed
            message = await receive()
            consumed += len(message.get("body", b""))
            if consumed > MAX_REQUEST:
                # Starlette's multipart parser closes already-open spool files on this exception.
                raise MultiPartException("request_too_large")
            return message

        try:
            await self.app(scope, limited_receive, send)
        finally:
            self.active -= 1


app = FastAPI(title="Faseeh", version="2.1")
app.add_middleware(AdmissionControl)
app.add_middleware(CORSMiddleware,
    allow_origins=[v.strip() for v in os.getenv("FASEEH_ALLOWED_ORIGINS", "").split(",") if v.strip()],
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$",
    allow_methods=["GET", "HEAD", "POST", "OPTIONS"], allow_headers=["Content-Type"])


@app.exception_handler(ApiProblem)
async def api_problem(_, exc):
    return problem(exc.status, exc.code, exc.detail)


@app.get("/health")
def health():
    decoder = shutil.which("ffmpeg")
    return {"ok": bool(decoder and shutil.which("ffprobe")), "ffmpeg": decoder,
            "mode": "muaalem", "maxBytes": MAX_BYTES, "maxSeconds": MAX_SECONDS,
            "capacity": CAPACITY, "retentionEnabled": bool(os.getenv("FASEEH_RECORDINGS_DIR"))}


def selection(form):
    try:
        surah = int(form.get("surah", ""))
        start = int(form.get("startAyah", form.get("ayah", 1)))
        end = int(form.get("endAyah", start))
    except (ValueError, TypeError) as exc:
        raise ApiProblem(400, "invalid_selection", "Choose a supported Surah and Ayah range.") from exc
    if not 1 <= start <= end <= COUNTS.get(surah, 0):
        raise ApiProblem(400, "invalid_selection", "Choose Ayahs within the selected Surah.")
    return surah, start, end


@app.post("/analyze", include_in_schema=False)
@app.post("/api/analyze", openapi_extra={"requestBody": {
    "required": True, "content": {"multipart/form-data": {"schema": {
        "type": "object", "required": ["file", "surah"], "properties": {
            "file": {"type": "string", "format": "binary", "description": "Audio, up to 25 MB and 330 s"},
            "surah": {"type": "integer", "enum": list(COUNTS)},
            "startAyah": {"type": "integer", "minimum": 1, "default": 1},
            "endAyah": {"type": "integer", "minimum": 1, "description": "Inclusive; defaults to startAyah"},
            "consent": {"type": "boolean", "default": False},
            "contributorName": {"type": "string", "maxLength": 120}
        }
    }}}
}})
async def analyze(request: Request):
    if request.headers.get("content-type", "").split(";")[0].strip().lower() != "multipart/form-data":
        raise ApiProblem(415, "invalid_request", "Submit a multipart audio recording.")
    try:
        async with request.form(max_files=1, max_fields=8, max_part_size=4096) as form:
            surah, start, end = selection(form)
            upload = form.get("file")
            if not isinstance(upload, UploadFile):
                raise ApiProblem(400, "invalid_audio", "Choose an audio recording.")
            if upload.size is None or upload.size > MAX_BYTES:
                raise ApiProblem(413, "too_large", "Choose fewer Ayahs or a smaller audio file.")
            if upload.size == 0:
                raise ApiProblem(422, "invalid_audio", "The recording is empty.")
            consent = form.get("consent") == "true"
            name = form.get("contributorName", "")
            if not isinstance(name, str) or len(name) > 120:
                raise ApiProblem(400, "invalid_request", "Use a shorter contributor name.")
            result = await run_in_threadpool(process_recording, upload.file, surah, start, end, consent, name)
    except MultipartParseError as exc:
        raise ApiProblem(400, "invalid_request", "Invalid multipart form.") from exc
    except HTTPException as exc:
        if exc.detail == "request_too_large":
            raise ApiProblem(413, "too_large", "Choose a smaller recording.") from exc
        raise ApiProblem(400, "invalid_request", "Invalid multipart form.") from exc
    if request.url.path == "/analyze" and "ayah" in form:
        # Compatibility for the original single-Ayah reader.
        result = dict(result, ayah=start, status="errors" if result["errors"] else "ok",
                      score=result["percentage"], reason=None, message=None)
    return JSONResponse(result, headers={"Cache-Control": "no-store"})


# Mount last so API routes take precedence. Only published frontend files are served.
app.mount("/", StaticFiles(directory=WEB, html=True, check_dir=False), name="reader")

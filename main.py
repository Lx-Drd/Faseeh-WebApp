"""
Faseeh API (application layer, HTTP boundary).

Run from this folder:
    uvicorn main:app --reload --port 8000

Then open http://127.0.0.1:8000/docs to try /analyze from the browser.

Responsibilities of this module only: HTTP routing, CORS, the response schema and
translating service errors into JSON. Business rules live in service.py, signal
processing in analysis.py.
"""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from typing import Literal, Optional

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import service
from analysis import DEFAULT_CONFIG, FFMPEG_HELP, find_ffmpeg
from service import AnalysisRequestError, analyze_recording

logging.basicConfig(
    level=os.getenv("FASEEH_LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("faseeh.api")


@asynccontextmanager
async def lifespan(_: FastAPI):
    exe = find_ffmpeg()
    if exe:
        logger.info("Using ffmpeg: %s", exe)
    else:
        logger.error(FFMPEG_HELP)
    logger.info("Analysis mode=%s config=%s", service.ANALYSIS_MODE, DEFAULT_CONFIG.as_dict())
    yield


app = FastAPI(title="Faseeh API", version="0.3.0", lifespan=lifespan)

# CORS for local development:
#   "null"              -> the frontend opened directly from disk (file://)
#   localhost/127.0.0.1 -> any port (python -m http.server, Live Server, Vite, ...)
# Add deployed origins with FASEEH_ALLOWED_ORIGINS="https://faseeh.app,https://www.faseeh.app"
extra_origins = [o.strip() for o in os.getenv("FASEEH_ALLOWED_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=["null", *extra_origins],
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$",
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


# --- Response schema (the frontend contract) ---------------------------------
class ErrorItem(BaseModel):
    wordIndex: int
    word: str
    rule: str
    confidence: float


class AnalyzeResponse(BaseModel):
    surah: int
    ayah: int
    status: Literal["ok", "errors", "unclear"]
    score: Optional[int]
    reason: Optional[Literal["silent", "too_short", "duration_mismatch", "too_different"]]
    message: Optional[str]
    errors: list[ErrorItem]


class ErrorResponse(BaseModel):
    detail: str


# Errors go through FastAPI's exception handling, which sits inside the CORS middleware,
# so the browser can read them (an unhandled 500 would look like a network failure).
@app.exception_handler(AnalysisRequestError)
async def handle_analysis_error(_: Request, exc: AnalysisRequestError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.get("/health")
def health() -> dict:
    exe = find_ffmpeg()
    return {
        "ok": exe is not None,
        "mode": service.ANALYSIS_MODE,
        "mockOutcome": service.MOCK_OUTCOME,
        "ffmpeg": exe,
        "help": None if exe else FFMPEG_HELP,
        "calibrationLog": bool(service.CALIBRATION_LOG),
        "analysisConfig": DEFAULT_CONFIG.as_dict(),
    }


@app.post(
    "/analyze",
    response_model=AnalyzeResponse,
    responses={400: {"model": ErrorResponse}, 413: {"model": ErrorResponse},
               422: {"model": ErrorResponse}, 500: {"model": ErrorResponse},
               502: {"model": ErrorResponse}},
)
async def analyze(
    file: UploadFile = File(..., description="Recording from MediaRecorder (webm, mp4 or ogg)"),
    surah: str = Form(..., examples=["112"]),
    ayah: str = Form(..., examples=["1"]),
) -> dict:
    try:
        data = await file.read(service.MAX_UPLOAD_BYTES + 1)
        # Decoding and DTW are CPU-bound: keep them off the event loop.
        return await run_in_threadpool(
            analyze_recording, data, file.filename or "", file.content_type or "", surah, ayah
        )
    except AnalysisRequestError:
        raise
    except Exception as exc:
        logger.exception("Unexpected error while analyzing %s:%s", surah, ayah)
        raise AnalysisRequestError(500, "Internal error while analyzing the recording.") from exc
    finally:
        await file.close()

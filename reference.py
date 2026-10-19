"""
Locates the expert reference recitation for an ayah.

Lookup order:
  1. reference_audio/SSSAAA.mp3  (files you place there yourself; also .wav)
  2. reference_cache/SSSAAA.mp3  (downloaded earlier)
  3. download from everyayah.com (Al-Sudais, 192 kbps, then 64 kbps) into reference_cache/
"""
from __future__ import annotations

import logging
import urllib.request
from pathlib import Path

logger = logging.getLogger("faseeh.reference")

BASE_DIR = Path(__file__).resolve().parent
LOCAL_DIR = BASE_DIR / "reference_audio"
CACHE_DIR = BASE_DIR / "reference_cache"

RECITER_SOURCES = [
    "https://everyayah.com/data/Abdurrahmaan_As-Sudais_192kbps/",
    "https://everyayah.com/data/Abdurrahmaan_As-Sudais_64kbps/",
]
DOWNLOAD_TIMEOUT_SEC = 20


class ReferenceUnavailable(Exception):
    pass


def reference_name(surah: int, ayah: int) -> str:
    """everyayah.com naming: 3-digit surah + 3-digit ayah, e.g. 112001."""
    return f"{surah:03d}{ayah:03d}"


def get_reference_path(surah: int, ayah: int, download: bool = True) -> Path:
    name = reference_name(surah, ayah)

    for folder in (LOCAL_DIR, CACHE_DIR):
        for ext in (".mp3", ".wav"):
            path = folder / f"{name}{ext}"
            if path.is_file() and path.stat().st_size > 0:
                return path

    if not download:
        raise ReferenceUnavailable(f"No local reference audio for {surah}:{ayah}")

    CACHE_DIR.mkdir(exist_ok=True)
    target = CACHE_DIR / f"{name}.mp3"
    errors = []
    for base in RECITER_SOURCES:
        url = f"{base}{name}.mp3"
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "Faseeh/0.1"})
            with urllib.request.urlopen(request, timeout=DOWNLOAD_TIMEOUT_SEC) as resp:
                data = resp.read()
            if not data:
                raise ValueError("empty response")
            partial = target.with_suffix(".part")
            partial.write_bytes(data)
            partial.replace(target)  # atomic: never leaves a half-written mp3
            logger.info("Downloaded reference %s from %s", name, url)
            return target
        except Exception as exc:  # network errors, HTTP 404, timeouts
            errors.append(f"{url}: {exc}")

    raise ReferenceUnavailable(
        f"Could not get the reference recitation for {surah}:{ayah}. "
        f"Place it at {LOCAL_DIR / (name + '.mp3')} or check the internet connection. "
        f"Tried: {'; '.join(errors)}"
    )

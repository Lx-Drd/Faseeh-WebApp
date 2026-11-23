"""Exercise the HTTP boundary and real FFmpeg decoder. No GPU or network required."""
import asyncio
import io
import json
import os
import struct
import sys
import tempfile
import unittest
import wave
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from main import AdmissionControl, app
from recording_service import MAX_BYTES


def wav(seconds=1, tone=True):
    output = io.BytesIO()
    with wave.open(output, "wb") as f:
        f.setparams((1, 2, 8000, 0, "NONE", "not compressed"))
        samples = (struct.pack("<hh", 9000, -9000) if tone else bytes(4)) * (4000 * seconds)
        f.writeframes(samples)
    return output.getvalue()


def multipart(recording, **fields):
    body = bytearray()
    for name, value in dict({"surah": "112", "startAyah": "1", "endAyah": "2"}, **fields).items():
        body.extend(f'--sample\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    body.extend(b'--sample\r\nContent-Disposition: form-data; name="file"; filename="clip.wav"\r\n'
                b'Content-Type: audio/wav\r\n\r\n' + recording + b'\r\n--sample--\r\n')
    return bytes(body)


async def request(body=b"", target=app, path="/api/analyze", **additional_headers):
    headers = {"content-type": "multipart/form-data; boundary=sample", "host": "localhost", **additional_headers}
    scope = {"type": "http", "method": "POST", "path": path, "scheme": "https", "query_string": b"",
             "headers": [(k.encode(), v.encode()) for k, v in headers.items()]}
    messages = []
    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}
    async def send(message):
        messages.append(message)
    await target(scope, receive, send)
    return messages[0]["status"], json.loads(messages[-1]["body"])


def infer(audio, surah, start, end):
    assert (surah, start, end) == (112, 1, 2)
    assert audio.ndim == 1 and len(audio) == 16000
    return {"surah": surah, "startAyah": start, "endAyah": start, "correctWords": 4,
            "totalWords": 4, "percentage": 100, "errors": [], "wordTimings": []}


class ApiTests(unittest.IsolatedAsyncioTestCase):
    async def test_decoded_analysis_and_retention(self):
        with tempfile.TemporaryDirectory() as archive, patch.dict(os.environ, FASEEH_RECORDINGS_DIR=archive), \
             patch.dict(sys.modules, {"muaalem_engine": SimpleNamespace(analyze=infer, EngineError=RuntimeError)}):
            pcm = wav()
            for consent in ["false", "true"]:
                status, data = await request(multipart(pcm, consent=consent, contributorName="../name"))
                self.assertEqual(status, 200, data)
                self.assertEqual(data["endAyah"], 1)
                self.assertEqual(len(list(Path(archive).iterdir())), int(consent == "true"))
            entry, = Path(archive).iterdir()
            self.assertEqual((entry / "recording").read_bytes(), pcm)
            self.assertEqual(json.loads((entry / "consent.json").read_text())["name"], "../name")

    async def test_refusals(self):
        for body, expected in [
            (multipart(b"missing", surah="1"), "invalid_selection"),
            (multipart(b"missing", startAyah="3", endAyah="2"), "invalid_selection"),
            (multipart(b""), "invalid_audio"),
            (multipart(b"not an audio file"), "invalid_audio"),
            (multipart(wav(tone=False)), "no_voice"),
            (multipart(wav(seconds=331, tone=False)), "too_long"),
        ]:
            status, data = await request(body)
            self.assertGreaterEqual(status, 400, data)
            self.assertEqual(data["code"], expected)
        status, data = await request(**{"content-length": str(MAX_BYTES + 70_000)})
        self.assertEqual((status, data["code"]), (413, "too_large"))

    async def test_41st_request_receives_busy(self):
        arrived, release = asyncio.Event(), asyncio.Event()
        count = 0
        async def worker(scope, receive, send):
            nonlocal count
            count += 1
            if count == 40:
                arrived.set()
            await release.wait()
            await send({"type": "http.response.start", "status": 200})
            await send({"type": "http.response.body", "body": b"{}"})
        limit = AdmissionControl(worker)
        tasks = [asyncio.create_task(request(target=limit)) for _ in range(40)]
        try:
            await asyncio.wait_for(arrived.wait(), timeout=5)
            status, data = await request(target=limit)
            self.assertEqual((status, data["code"]), (503, "busy"))
        finally:
            release.set()
            await asyncio.gather(*tasks)
        self.assertEqual((await request(target=limit))[0], 200)

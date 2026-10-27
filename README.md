# Faseeh backend (FastAPI + librosa + FastDTW)

## Run it

1. From this folder (Python 3.10+):
   ```
   pip install -r requirements.txt
   uvicorn main:app --reload --port 8000
   ```
   `requirements.txt` includes `imageio-ffmpeg`, which ships its own ffmpeg, so you don't
   need to install ffmpeg separately. A system ffmpeg on PATH is used first if you have one.
   You can also point to a specific binary with `FASEEH_FFMPEG=C:\path\to\ffmpeg.exe`.
2. Check http://127.0.0.1:8000/health. `"ok": true` and an `ffmpeg` path mean decoding works.
   The server also logs `Using ffmpeg: ...` on startup.
3. Open the frontend and record: its feedback badge should say **Live analysis** instead of
   "Demo · server offline".

## Modes

| env var | values | effect |
|---|---|---|
| `FASEEH_ANALYSIS_MODE` | `mock` (default) | Real decoding, silence/length checks and DTW score; the flagged word is the ayah's prepared `focus_word` |
| | `dtw` | Experimental: flags words whose alignment cost stands out (uncalibrated) |
| `FASEEH_MOCK_OUTCOME` | `alternate` (default), `errors`, `ok` | Mock only: alternate gives errors on the 1st take of an ayah, ok on the 2nd, … |
| `FASEEH_ALLOWED_ORIGINS` | comma list | Extra CORS origins (localhost, 127.0.0.1 and file:// are allowed already) |

Windows example: `set FASEEH_ANALYSIS_MODE=dtw` then `uvicorn main:app --port 8000`.

## API contract

`POST /analyze`, multipart form: `file` (recording), `surah` ("112"), `ayah` ("1").

```json
{
  "surah": 112, "ayah": 1,
  "status": "errors",
  "score": 84,
  "reason": null,
  "message": null,
  "errors": [{ "wordIndex": 3, "word": "أَحَدٌ", "rule": "hha", "confidence": 0.9 }]
}
```

- `status`:
  - `ok`: `errors` is `[]`.
  - `errors`: one or more entries.
  - `unclear`: `reason` is one of `silent`, `too_short`, `duration_mismatch` or `too_different`, and `message` explains it.
- `score`: 0–100, or `null` when the recording was silent or too short.
- `wordIndex`: 0-based index into `text.split(" ")`, the same split the frontend uses.
- `rule`: a key of the frontend's `RULES` object. It's guessed from the word's letters (`rules.guess_rule`).

Request problems return `{"detail": "..."}`:
- `400` bad or unknown surah/ayah
- `413` file over 10 MB
- `422` empty or undecodable audio
- `502` no reference audio (dtw mode)
- `500` unexpected error

## Files

| file | role |
|---|---|
| `main.py` | FastAPI app, CORS, response schema, `/analyze`, `/health` |
| `service.py` | Validation, temp file, reference lookup, mock outcome, response shaping |
| `analysis.py` | librosa loading, quality gates, MFCC features, FastDTW, word costs, mock/dtw judging |
| `quran_data.py` | Ayah texts, word splits, mock focus words |
| `rules.py` | Tajweed rule details + `guess_rule(word)` |
| `reference.py` | Finds the reference: `reference_audio/` → `reference_cache/` → download from everyayah.com |

## Baseline measurement (dev)

`scripts/baseline.py` measures per-filter latency in `dtw` mode; results and how to rerun them
are in `docs/baseline.md`. Dev setup: `pip install -r requirements-dev.txt` (pytest), tests with
`python -m pytest`. Design decisions are recorded in `docs/adr/`.

## Next step: calibrate the DTW

The thresholds in `AnalysisConfig` (`analysis.py`) were set on synthetic audio. The server
logs `meanStep` and `wordCosts` for every request. Record each ayah a few times correctly and
a few times with one deliberate mistake, run in `dtw` mode, and compare the logged numbers.
Then set:
- `score_best` / `score_worst` (mean distance that should map to 100 / 0)
- `relative_threshold` (how much a word must stand out to be flagged)
- `unclear_below_score`

Word positions in the reference are estimated from letter counts (`word_frame_bounds`).
Real word timings will make localization much more accurate.

**Text:** `quran_data.py` and the frontend use prototype text. Replace both with verified
Uthmani text.

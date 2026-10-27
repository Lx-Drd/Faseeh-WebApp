# Baseline: pipeline latency before the accuracy work

This is the "before" measurement (ROADMAP Phase 0). Phase 3 (exact banded DTW) appends the "after".
Reproduce it with `scripts/baseline.py` (see "How to reproduce" below).

## Run
| | |
|---|---|
| Date | 2026-10-27 |
| Run file | `data/eval/baseline_20261027_075811.jsonl` (local only, git-ignored) |
| Pipeline code | commit `6c15281` (`analysis.py`, `service.py`, `main.py` unmodified) |
| Mode | `FASEEH_ANALYSIS_MODE=dtw`, real server (`uvicorn main:app`), requests over HTTP on localhost |
| Machine | AMD Ryzen 7 9800X3D (8 cores / 16 threads), ~15 GB RAM, Windows 11 Pro 10.0.26200 |
| Python and libraries | Python 3.12.10, fastapi 0.162.0, uvicorn 0.54.0, librosa 1.0.0, fastdtw 0.3.4, numpy 2.5.4, scipy 1.18.1, numba 0.68.0, imageio-ffmpeg 0.6.0 |
| Requests | 15 samples × (1 warm-up + 3 measured passes); 45 measured requests |

## Samples
- **Stand-ins (`husary`, 15 files):** Mahmoud Khalil Al-Husary (murattal, everyayah
  `Husary_128kbps`), all 15 ayat. Each file was transcoded to **mono Opus in webm at 48 kHz**,
  so F1 decodes the same kind of file a browser MediaRecorder upload produces. Voiced length:
  3.2–9.1 s.
- **Own recordings:** none yet (`data/samples/own/` was empty). To add them, see the
  "How to reproduce" section.
- **Reference:** Al-Sudais (everyayah `Abdurrahmaan_As-Sudais_192kbps`, mp3), as used today.
  It is decoded and featurized on every request.

## Configuration (the "before")
`AnalysisConfig` defaults, read from `/health` during the run (no `FASEEH_CFG_*` overrides):

| field | value | field | value |
|---|---|---|---|
| top_db | 30.0 | dtw_radius | 10 |
| min_rms | 0.001 | score_best | 0.40 |
| min_voiced_seconds | 0.5 | score_worst | 1.20 |
| max_voiced_seconds | 90.0 | unclear_below_score | 20 |
| min_duration_ratio | 0.3 | relative_threshold | 1.35 |
| max_duration_ratio | 3.5 | median_cost_floor | 0.10 |
| min_word_frames | 3 | max_errors | 3 |

Other settings: 16 kHz, 20 ms hop (50 fps), MFCC c1–c13 + deltas, FastDTW (`radius=10`),
word boundaries estimated from letter counts.

## Latency per filter (measured passes, n = 45)
All filters ran on every request: `too_different` is decided in F5b, after F5a.

| filter | p50 ms | p95 ms | max ms |
|---|---|---|---|
| F1 `decodeUser` (ffmpeg webm → wav → librosa) | 52.6 | 56.8 | 61.9 |
| F2 `qualityGate` | 0.4 | 0.6 | 0.7 |
| F1+F2 `decodeReference` (mp3 decode + trim, every request) | 41.4 | 46.0 | 50.4 |
| F3 `features` (user + reference MFCC) | 5.1 | 6.2 | 6.3 |
| F4 `dtw` (FastDTW) | 131.3 | 202.6 | 208.7 |
| F5a `wordCosts` | 0.1 | 0.1 | 0.1 |
| **`totalMs`** (sum of the above, server-side) | **231.7** | **307.0** | **312.8** |
| `requestMs` (client wall time, HTTP round trip) | 236.1 | 328.2 | 352.5 |

Reading the numbers:
- **F4 DTW is the largest cost** (~57% of the p50 total), and it grows with audio length. The
  longest ayat (114:4, 114:5) take ~200 ms.
- **Decoding takes ~40%**: user decode ~53 ms plus reference decode ~41 ms. Phase 1's reference
  feature cache removes the reference decode.
- **Warm-up is excluded.** The first request took 2.5 s (it downloaded the Sudais reference and
  hit Python/numba first-call overheads). Later warm-up requests took 0.6–0.9 s each, mostly
  reference downloads. A cold server pays these costs once per ayah.
- The numbers come from one fast desktop CPU with nothing else heavy running. Expect slower
  laptops to be several times slower. Compare "before/after" only on the same machine.

## Outcomes (not an accuracy measure)
All 45 measured requests returned `unclear` / `too_different`: scores 4–17, against an
`unclear_below_score` of 20, with `meanStep` 1.07–1.17. Duration ratios were 1.10–2.05 (Husary is
slower than Sudais), so none hit `duration_mismatch`.

These requests are **not** labeled data, and the stand-in is another expert reciter, not a
learner. Still, this is a useful "before" observation: in the current configuration, a correct
recitation by a different reciter scores as "too different" to judge. `score_best` /
`score_worst` were set on synthetic audio (see the comment in `AnalysisConfig`). That fits
AGENTS.md: accuracy, not latency, is the main weakness. The thresholds were not changed in this
phase. Calibration happens from Phase 5 on, using labeled dev data.

## How to reproduce
```
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt -r requirements-dev.txt
.venv\Scripts\python scripts\baseline.py prepare      # 15 Husary stand-ins -> data/samples/husary/
.venv\Scripts\python scripts\baseline.py run          # starts the server in dtw mode on port 8765
.venv\Scripts\python scripts\baseline.py summarize    # tables for the latest run
```
Own recordings: save them as `data/samples/own/SSSAAA_<anything>.<webm|mp4|ogg>` (e.g.
`112001_take1.webm`), then rerun `run` and `summarize`. They get their own table.

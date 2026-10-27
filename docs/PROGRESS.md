# Faseeh: Progress Log

Handoff notes between sessions. The agent updates this file at the end of every phase.
Newest entry on top. Keep each entry short: anyone on the team should be able to read it
in two minutes and know where things stand.

## Current status
- **Current phase:** Phase 0 done (next: Phase 1)
- **Analysis mode in use:** `mock` (default)
- **Blocked on the team:** recruiting participants and a tajweed annotator; supervisor
  answers on ethics approval, AI-use policy and report template

## Waiting on the team (manual tasks)
- [ ] Recruit 10–15 participants (mixed gender, ages, proficiency; some non-native if possible)
- [ ] Agree with a tajweed teacher to review and label recordings
- [ ] Ask the supervisor: ethics approval, AI-use policy, report template (Future Work section?)
- [ ] Hand-label 3–4 ayat for husary and 2 for one other reciter in Audacity (needed in Phase 2)

---

## Entry template (copy for each phase)

### Phase N: <name> (YYYY-MM-DD)
- **Branch / commit:**
- **Done:**
- **Decisions (and why):**
- **How to run / verify:**
- **Measured results:** (only numbers that were actually measured)
- **Manual tasks for the team:**
- **Known issues / follow-ups:**

---

## Log

### Phase 0: Baseline (2026-10-27)
- **Branch / commit:** `phase-0-baseline` (first commit adds the agent docs and renames
  `faseeh-reader (1).html` → `faseeh-reader.html`; second commit is the phase work). Not pushed.
- **Done:**
  - `scripts/baseline.py` with three commands: `prepare` (stand-in samples), `run` (starts the
    server in dtw mode and sends every sample over HTTP) and `summarize` (p50/p95 per filter).
    Tests are in `tests/test_baseline.py` (14, hand-computed).
  - `docs/baseline.md`: the "before" latency report and config.
  - ADR 0001 (post-recording analysis) and ADR 0007 (no fine-tuning) in `docs/adr/`.
  - New `.gitignore` (none existed). Extended `.cursorignore` with the root-level
    `reference_audio/` and `reference_cache/` folders that `reference.py` really uses, plus
    `data/samples/` and `.venv/`. New `requirements-dev.txt` (pytest).
  - No pipeline code changed. Mock mode was checked: `/health` still reports `mode: mock` by
    default.
- **Decisions (and why):**
  - Samples: no recordings existed, so the stand-in is Husary (everyayah `Husary_128kbps`,
    verified to return audio), all 15 ayat, transcoded to webm/Opus 48 kHz mono so that F1
    decodes a browser-like upload. Own recordings can be added later in `data/samples/own/`.
  - Measured through the real HTTP server via the existing `FASEEH_CALIBRATION_LOG` hook, so
    nothing in `service.py`/`analysis.py` had to change. The first pass is a warm-up and is
    excluded (reference downloads and first-call overheads).
  - Environment: `.venv` on Python 3.12 (3.14 risks missing numba wheels).
- **How to run / verify:** see "How to reproduce" in `docs/baseline.md`;
  `.venv\Scripts\python -m pytest`.
- **Measured results:** dtw mode, 45 measured requests (15 stand-ins × 3), on a Ryzen 7 9800X3D:
  `totalMs` p50 231.7 / p95 307.0. The largest share is F4 FastDTW (p50 131.3 / p95 202.6),
  then user decode (52.6 / 56.8) and reference decode (41.4 / 46.0). Full tables are in
  `docs/baseline.md`.
  All 45 requests returned `unclear/too_different` (scores 4–17 < 20): a correct recitation by
  another expert reciter is rejected under the current, synthetic-calibrated `score_best`/`score_worst`.
  This is not an accuracy metric (no labels), but it is evidence for the calibration work. The
  thresholds were not changed.
- **Manual tasks for the team:** optionally record a few ayat in the frontend, save them as
  `data/samples/own/SSSAAA_<anything>.webm`, then rerun `baseline.py run` + `summarize` and add
  the "own" table to `docs/baseline.md`.
- **Known issues / follow-ups:**
  - No baseline on real learner/browser recordings yet (stand-ins only).
  - Timings are from one fast desktop. Compare before/after on the same machine only.
  - The `too_different` result on every stand-in suggests the score mapping will reject real
    users in dtw mode. To be addressed by calibration (Phases 5/9), not ad hoc.
  - Pre-existing: there was no `.gitignore`, and `reference.py` caches into the root
    `reference_cache/`, not `data/reference_cache/`. Both are now ignored. Phase 1 may move the
    cache.

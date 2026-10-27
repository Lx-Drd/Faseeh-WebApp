# Faseeh: Agent Instructions

These rules apply to every session in this repo. The phase-by-phase plan lives in
`docs/ROADMAP.md`; the running handoff log lives in `docs/PROGRESS.md`.

## Project in one paragraph
Faseeh is a Qur'an pronunciation practice app for Juz' 30 (surahs 112, 113, 114 = 15 ayat).
The browser records an ayah and uploads it; a FastAPI server compares it with expert
reciters and returns `ok`, `errors` (flagged words with tajweed rule ids) or `unclear`.

- `faseeh-reader.html`: frontend (Model / Services / View / Controller in one file)
- `main.py`: HTTP boundary only (routing, CORS, response schema, error translation)
- `service.py`: business rules and orchestration (never imports FastAPI)
- `analysis.py`: pipe-and-filter acoustic pipeline (F1 decode → F2 quality gate →
  F3 features → F4 DTW → F5a word costs → F5b judge)
- `reference.py`, `quran_data.py`, `rules.py`: reference audio, ayah text, rule ids

## Decisions already made (do not revisit or re-argue)
- NO real-time streaming. Post-recording analysis remains the architecture. A hybrid
  live-tracking layer is planned for Week 6+ and is out of scope.
- The main weakness is accuracy, not latency. Current word boundaries are estimated from
  letter counts and the flagging thresholds are uncalibrated placeholders.
- Pretrained models are used AS-IS. No fine-tuning or neural training of any kind.
  "Calibration" means choosing thresholds from labeled data with statistics.
- Whisper is used ONLY to check content (right ayah, right words). It must NEVER decide
  pronunciation errors, because it auto-corrects toward the expected word.
- All model inference runs on the server. The frontend only records and displays.

## Architecture rules
- HTTP concerns only in `main.py`. `service.py` never imports FastAPI and raises
  `AnalysisRequestError` for client-facing errors.
- Filters in `analysis.py` stay pure functions: no HTTP, no file-system policy, no domain
  knowledge beyond what they are given. New filters follow the same pattern.
- The `/analyze` response contract (`surah, ayah, status, score, reason, message,
  errors[{wordIndex, word, rule, confidence}]`) must not change. The ONLY allowed
  addition is the `reason` value `content_mismatch` (Phase 6).
- `mock` mode must keep working exactly as today. Every new behaviour is opt-in via config.
- Every threshold or setting lives in `AnalysisConfig` (overridable through
  `FASEEH_CFG_<FIELD>`) or in a versioned JSON file. Never hard-code tunable numbers.
- Every model is loaded ONCE at startup (in `main.py`'s lifespan, via a small registry in
  the service layer), never per request. If a model fails to load: log it, disable that
  feature, report it in `/health`, and keep the server running.
- Record the wall time of every new filter in `debug["timingsMs"]`.
- Locations: dev-only pages in `tools/`, CLI scripts in `scripts/`, docs in `docs/`,
  decision records in `docs/adr/`.

## Dependencies
- Runtime: `requirements.txt`.
- Heavy ML (torch, transformers, etc.): `requirements-ml.txt`. The server must still start
  without them when the ML features are disabled. Prefer CPU-only torch wheels.
- Dev-only tools (pandas, matplotlib, etc.): `requirements-dev.txt`.

## Data and privacy
- Never commit audio, participant data, evaluation caches or model weights. Keep
  `.gitignore` and `.cursorignore` up to date for `data/collected/`, `data/eval/`,
  reference audio caches and model folders.
- Never open, print or summarize participant recordings or labels unless the current
  task requires it.
- The data-collection routes exist only when `FASEEH_ENABLE_COLLECTION=1` and accept
  localhost only.

## Testing
- Add pytest tests for every new pure function.
- Keep existing tests passing. Run the full suite before declaring a phase done.
- Evaluation code must be tested on small synthetic fixtures where the expected metrics
  are known by hand, because a bug there produces wrong numbers silently.

## Architecture Decision Records
Write each in `docs/adr/NNNN-title.md` with Context / Decision / Consequences:
- 0001 Post-recording analysis instead of real-time streaming
- 0002 Exact banded DTW instead of FastDTW
- 0003 Multiple reference reciters
- 0004 Whisper as a content gate, not an error detector
- 0005 Server-side model inference
- 0006 Feature backend experiment: MFCC vs pretrained embeddings
- 0007 No fine-tuning within the project timeline
Write each ADR in the phase where the decision is implemented (0001 and 0007 in Phase 0).

## How to work on a phase
1. Read this file, `docs/ROADMAP.md` and `docs/PROGRESS.md`.
2. Work on ONE phase only: the one the user names. Do not start the next phase.
3. Before writing code, reply with a short plan: files to change, new files, risks,
   and how you will test it. Wait for the user's approval.
4. Implement on a branch named `phase-N-short-name`. Commit when done. Do not push.
5. Run the tests.
6. Update `docs/PROGRESS.md`: what was done, decisions made (with reasons), what the user
   must do manually, known issues, and how to run/verify the new work.
7. Stop and summarize. Wait for the user before continuing.

## Never
- Never change the frontend contract beyond the one allowed addition.
- Never use the TEST split for tuning. Only `scripts/evaluate.py --final` touches it.
- Never fine-tune or train a model.
- Never delete data, push to a remote, or install packages without asking first.
- Never invent results: if something wasn't run or measured, say so.
- Never silently skip a step in a phase. If something is blocked, report it in
  `docs/PROGRESS.md` and in the summary.

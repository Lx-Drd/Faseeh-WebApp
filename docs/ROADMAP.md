# Faseeh: Accuracy Roadmap (through Week 5)

Global rules and decisions are in `AGENTS.md`. Progress is logged in `docs/PROGRESS.md`.
Do one phase per session.

## Timeline
| Week | Work |
|---|---|
| 1 | Phases 0–4. The collection tool must be ready early: recording takes the longest. |
| 2–3 | Data collection and labeling (humans); Phases 5–6 in parallel |
| 3–4 | Phases 7–8 |
| 5 | Final `--final` evaluation on the test split, then Phase 9 |
| 6+ | Hybrid live-tracking layer (out of scope for this roadmap) |

Target pipeline after this roadmap:
`F1 decode → F2 quality gate → F2b content gate → F3 features → F4 align → F5a word costs → F5b judge`

---

## Phase 0: Baseline
- Run the server in `dtw` mode on a few sample recordings and collect `timingsMs` / `totalMs`.
- Write `docs/baseline.md` with p50/p95 per filter and the current config (the "before").
- Write ADR 0001 and ADR 0007.

## Phase 1: Multi-reciter references and caching
- Add a reciter registry (JSON or `reciters.py`) with: id, English and Arabic names,
  everyayah folder, style, enabled flag. Candidates:

  | id | Reciter | everyayah folder (VERIFY) |
  |---|---|---|
  | sudais | عبدالرحمن السديس | `Abdurrahmaan_As-Sudais_192kbps` (in use) |
  | husary | محمود خليل الحصري (مرتّل) | `Husary_128kbps` |
  | ali_jaber | علي جابر | `Ali_Jaber_64kbps` |
  | minshawi | محمد صديق المنشاوي (مرتّل) | `Minshawy_Murattal_128kbps` |
  | maher (disabled) | ماهر المعيقلي | find the correct folder |

- VERIFY every folder: `https://everyayah.com/data/<folder>/112001.mp3` must return audio.
  Fix wrong names by checking everyayah.com. Use ONLY Murattal recordings: never Mujawwad,
  never "Muallim" versions (they contain repetition pauses).
- `reference.py`: `get_reference_path(surah, ayah, reciter_id)` with an on-disk cache.
- `scripts/fetch_references.py`: download all 15 ayat for all enabled reciters and report
  failures.
- Cache reference FEATURES as `.npy`, keyed by reciter + ayah + feature backend + a hash of
  the feature settings. Today the reference is decoded and featurized on every request.
- Frontend: add a reciter selector to the Reference Audio card (listening only), keeping
  the existing fallback-URL behaviour.
- Write ADR 0003.

**Done when:** all enabled reciters download for all 15 ayat, cached features are reused
across requests, and tests pass.

## Phase 2: Real word timings
1. Format: `data/reference_timings/<reciter_id>.json` =
   `{ "112:1": [[start_s, end_s], ...one pair per word], ... }`
   Times are relative to the TRIMMED reference audio (same `trim_silence` / `top_db` as
   the pipeline). Document this clearly.
2. `scripts/align_references.py`: forced alignment of the known ayah text against each
   reciter's audio to produce word timings. Choose and justify the method, e.g. CTC forced
   alignment (torchaudio) with a pretrained Arabic model, or word timestamps from the
   Whisper-Quran model. Use the Arabic normalization from Phase 6 (implement it here as a
   shared pure function if Phase 6 isn't done yet).
3. `scripts/import_audacity_labels.py`: convert Audacity label exports
   (`start\tend\tlabel` per line) to the same JSON, applying the trim offset automatically
   with the pipeline's own function. Hand labels are the ground truth.
4. Validation: the user will hand-label 3–4 ayat for husary and 2 for one other reciter.
   `scripts/validate_timings.py` compares automatic boundaries with hand labels and
   reports mean and max boundary error in ms.
   Fallback if the automatic method is poor: hand-label husary fully, then propagate to
   the other reciters by DTW (`scripts/propagate_timings.py`, mapping boundaries through
   the alignment path, flagging suspicious word durations for review).
5. Load-time validation: word count must equal `len(target.words)`, intervals must be
   monotonic and within the audio duration. Otherwise log an error and fall back to the
   letter-count estimate.
6. `word_frame_bounds` uses real timings when available. The pipeline must still work
   without them (tests, mock mode).
7. `tools/timings_check.html`: pick reciter + ayah, play the audio with word highlighting
   in sync, and click a word to replay just that segment.

**Done when:** timings exist for every enabled reciter, the validation report is in
`docs/PROGRESS.md`, and the check page works.

## Phase 3: Exact banded DTW
- Add `dtw_backend: "exact" | "fastdtw"` to `AnalysisConfig` (default `"exact"`).
- Exact backend: Sakoe-Chiba band (e.g. `librosa.sequence.dtw` with global constraints, or
  Numba), the same unit-vector euclidean cost, returning the same `(path, steps)` shape.
  The band must allow a valid path across the full allowed duration-ratio range.
- `scripts/benchmark_dtw.py`: compare both backends (time, mean step, word costs). Append
  results to `docs/baseline.md` as the "after".
- Write ADR 0002.

## Phase 4: Data-collection and labeling tool (developer-only)
A SEPARATE page, `tools/collect.html`. Do NOT add any of this to `faseeh-reader.html`.
Reuse the reader's MediaRecorder approach with the SAME getUserMedia constraints
(echoCancellation + noiseSuppression), so collected audio matches real user audio.

Backend:
- `/collect/*` routes are registered ONLY when `FASEEH_ENABLE_COLLECTION=1`, and accept
  localhost only.
- Store uploads byte-for-byte in `data/collected/audio/` as
  `<speaker>_<SSS>-<AAA>_<take_type>_t<N>.<ext>`. Never run analysis here.
- Append one JSON line per take to `data/collected/takes.jsonl`: file, speaker_id, gender,
  age_band, proficiency, native_arabic, surah, ayah, take_type, intended errors
  `[{word_index, rule}]`, intended content error (if any), mime type, duration,
  user agent, timestamp, git commit.

Take types:
- `correct`
- `error1`: one deliberate pronunciation error
- `error2`: two deliberate errors
- `content`: a deliberately skipped, repeated or extra word, or a different ayah
- `duration`: a deliberately shortened madd or ghunnah

Collection flow:
1. Session setup: auto-suggested speaker ID (`spkNN`), gender, age band, proficiency,
   native Arabic speaker, and a REQUIRED consent checkbox with short consent text
   (university project; stored locally; deletable on request).
2. Progress grid: 15 ayat × take types, done/missing per speaker.
3. For error takes the operator clicks the target word(s) and picks the rule (rule ids
   from `rules.py` / the frontend `RULES`). Show a hint of the error to produce.
4. Record → play back → Save / Discard. Show duration and warn if the take is very quiet.
   Allow deleting the last take.
5. Shortcuts: space = record/stop, enter = save, backspace = discard.

Review tab (for the tajweed annotator):
- Play a take; each word toggles correct/error with a rule dropdown, prefilled from the
  intended errors. Takes can be marked `unusable` with a reason.
- Save to `data/collected/labels.csv`, ONE ROW PER WORD:
  `file,speaker,gender,surah,ayah,word_index,label,rule,deliberate,content_error,annotator,verified`
- Unverified takes are excluded from evaluation.

**Done when:** a full session (setup → record all take types → review → labels.csv) works
end to end on localhost, and the routes are absent without the env flag.

## Phase 5: Evaluation harness
`scripts/evaluate.py`:
1. Deterministic split BY SPEAKER (~70% dev / 30% test), saved to
   `data/collected/splits.json` and never regenerated once created.
2. Run each verified take × enabled reciter × feature backend through the pipeline up to
   F5a, and cache per-word costs, durations and debug metrics in `data/eval/`. Re-runs
   only compute missing entries.
3. Strategies (pure, unit-tested functions):
   a. `global_relative`: the current logic.
   b. `per_word`: per (ayah, word, reciter, feature backend), fit cost statistics from
      CORRECT dev takes only; flag if z = (cost − mean) / max(std, floor) ≥ k; fall back
      to (a) when there are too few samples.
   c. Multi-reference aggregation: per word, MIN normalized cost across reciters (also
      report MEAN for comparison).
4. Threshold sweep on DEV only: a precision–recall curve per configuration. Pick the
   operating point with precision ≥ P (default 0.80) that maximizes recall (CLI args).
5. Metrics:
   - word-level precision, recall and F1
   - take-level false-alarm rate (correct takes with ≥1 flag)
   - unclear rate on correct takes
   - content-gate accuracy: false rejects on correct takes; detection rate on `content` takes
   - breakdowns by rule, gender and proficiency
6. Comparison table across feature backend × strategy × reference set
   (sudais-only vs all reciters).
7. Output to `reports/eval_<timestamp>/`: `report.md`, PR-curve PNGs, CSVs, plus the exact
   config and git commit.
8. The TEST split is only evaluated with `--final`, using frozen dev-chosen settings. It
   writes a separate report and prints a warning that test results must not be used for
   tuning.

**Done when:** the harness runs on synthetic fixtures with hand-verified expected metrics,
and on whatever real data exists so far.

## Phase 6: Whisper-Quran content gate (new filter F2b)
- Model: `tarteel-ai/whisper-base-ar-quran` (configurable via `FASEEH_WHISPER_MODEL`;
  verify the model card and license). Loaded once at startup.
- F2b runs after F2 and before F3. It transcribes the trimmed user audio and compares it
  with the expected words at WORD level, using an alignment such as Levenshtein over words.
- Arabic normalization before comparing: strip diacritics and Qur'anic marks, unify alef
  forms (أ إ آ ٱ → ا), ة/ه and ى/ي, remove tatweel, and handle the dagger alif. Unit-test
  this on all 15 ayat: the normalized reference text must match itself exactly.
- Debug output: transcript, per-word alignment ops (match/sub/del/ins), word error rate.
  Decision rule with calibrated thresholds, e.g. a missing or extra word, or WER above a
  threshold, results in `content_mismatch`.
- Mode: `content_gate: "off" | "log" | "enforce"`, default `"off"`. Use `"log"` to collect
  metrics without affecting users, and `"enforce"` only after evaluation shows false
  rejects on correct takes are acceptably low.
- Contract: add `content_mismatch` to the `reason` Literal in `main.py`, to
  `REASON_MESSAGES` in `service.py`, and to `REASON_TEXT` in the frontend (e.g. "It sounds
  like a word was skipped or added. Recite the selected ayah from its first word.").
- Run the harness: report gate accuracy and the change in pronunciation-flag precision on
  takes the gate passes.
- Write ADR 0004 and ADR 0005.

## Phase 7: Feature backend switch (F3)
- Add `feature_backend: "mfcc" | "ssl"` and `ssl_model` to `AnalysisConfig`. Default `"mfcc"`.
- First `"ssl"` candidate: the ENCODER of the Whisper-Quran model already loaded in
  Phase 6, so one model in memory. Second candidate: one general pretrained speech model
  (e.g. a wav2vec2 / HuBERT / WavLM base model, from a chosen layer).
- Both backends must output shape (frames, dims) at 50 fps (20 ms), the same as MFCC.
  Whisper's encoder pads input to 30 s, so crop its output to the real audio length.
  Apply the same per-utterance mean/variance normalization and unit-length rows.
- Reference features are cached per backend (Phase 1).
- Run the harness. Report MFCC vs each ssl candidate: precision, recall, false-alarm rate
  (overall and by gender), and p95 latency.
- Adopt `"ssl"` as the default ONLY if the false-alarm rate drops without losing recall,
  and p95 total latency stays under 2 s on the user's machine. Otherwise keep MFCC and
  document why.
- Write ADR 0006.

## Phase 8: Per-word duration check (F5b)
- Mark which words contain duration rules (`madd`, `ghunnah`, and experimentally
  `qalqalah`) in a data file next to the ayah data. Do not hard-code this.
- From the DTW path, compute each word's duration in the user audio and normalize it by
  the user's overall tempo (user voiced length / reference voiced length). Compare it with
  the reference word's duration. Flag "too short" when the normalized ratio falls below a
  calibrated threshold, taking the best value across reciters.
- Merge with the cost-based flags; keep `max_errors`. Duration flags carry their rule id.
- Run the harness on `duration` takes and report per-rule results. Mark qalqalah
  experimental if it performs poorly.

## Phase 9: Ship the calibrated configuration
- Write the chosen settings to versioned `config/calibration.json`: feature backend,
  strategy, reciters, aggregation, thresholds, per-word statistics, duration thresholds,
  content-gate thresholds and mode, and the source report id.
- `service.py` loads it in `dtw` mode. `/health` shows the calibration version and the
  loaded models.
- After the user confirms the final test metrics: make `dtw` the default mode. Keep `mock`
  for demos.

## Deliverables (update README.md as phases complete)
- Setup, including the optional ML requirements and the model download.
- How to fetch references, generate and validate timings, and hand-label in Audacity.
- How to run collection and review sessions (env flag, URL, operator checklist).
- How to run evaluation and read the reports.
- Architecture section: the updated pipeline, model registry, reference cache, timings,
  and the calibration file.

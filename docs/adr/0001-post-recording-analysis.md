# ADR 0001: Post-recording analysis instead of real-time streaming

- **Status:** Accepted
- **Date:** 2026-10-27

## Context
Faseeh gives tajweed feedback on one ayah at a time (Juz' 30: surahs 112–114, 15 ayat). There
were two ways to build the analysis:

1. **Real-time streaming:** audio is sent in chunks while the user recites, and the server
   tracks their position and flags errors live.
2. **Post-recording analysis:** the browser records the whole ayah, uploads it once, and the
   server returns one result (`ok` / `errors` / `unclear`).

The main weakness of the current system is **accuracy, not latency**. Word boundaries are
estimated from letter counts, and the flagging thresholds are uncalibrated. The Phase 0
baseline (`docs/baseline.md`) measured a p95 server time of ~0.3 s for a whole ayah on the
development machine, which is already fast enough for feedback after recording.

Streaming would mean incremental/online alignment, a persistent connection (WebSocket), partial
results that can change, and a new frontend contract. The roadmap's accuracy work depends on
seeing the whole utterance: a whole-utterance DTW, a content check over the full transcript,
and per-word duration checks normalized by the user's overall tempo.

## Decision
Keep the **post-recording** architecture. The frontend records a complete ayah with
MediaRecorder and uploads it to `POST /analyze`. The server runs the pipe-and-filter pipeline
(F1 decode → F2 quality gate → F3 features → F4 DTW → F5a word costs → F5b judge) on the whole
recording and returns the existing response contract.

A hybrid live-tracking layer (showing the user's position while they recite, with the final
judgement still made after recording) is planned for Week 6+. It is out of scope for the current
roadmap.

## Consequences
- **Positive:** the whole utterance is available to every filter, which the planned accuracy
  work needs (global alignment, tempo normalization, content gate). The HTTP contract stays
  simple and stateless. The frontend only records and displays, and every filter can be tested
  on files offline.
- **Positive:** evaluation is straightforward. The same pipeline runs on collected takes in
  `scripts/evaluate.py` exactly as it does on live uploads.
- **Negative:** the user gets no feedback until they finish the ayah, and a mistake early in a
  long ayah is reported only at the end. The ayat in scope are short (about 3–9 s of voiced
  audio), which limits this cost.
- **Negative:** latency is paid all at once after recording. It must stay low: Phase 7 adopts
  a heavier feature backend only if p95 total latency stays under 2 s.
- **Follow-up:** the Week 6+ live layer must sit on top of this pipeline and must not replace
  the final post-recording judgement.

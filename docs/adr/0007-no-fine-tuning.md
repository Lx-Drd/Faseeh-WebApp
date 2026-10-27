# ADR 0007: No fine-tuning within the project timeline

- **Status:** Accepted
- **Date:** 2026-10-27

## Context
The roadmap (through Week 5) adds pretrained models to the pipeline: the Whisper-Quran model
as a content gate (Phase 6), and its encoder or a general speech model as a feature backend
(Phase 7). Fine-tuning those models on learner recordings could, in principle, improve error
detection. However:

- **Data:** the project will collect recordings from about 10–15 participants, labeled by one
  tajweed annotator. That is far too little to fine-tune a speech model without overfitting.
  It is also all the data available for calibration and the held-out test split.
- **Time and compute:** five weeks, CPU-oriented development machines, no training
  infrastructure.
- **Evaluation integrity:** with this little data, training on it would leave no clean
  held-out data to measure the result honestly.
- **Explainability:** a university project must justify its decisions. Statistically chosen
  thresholds on fixed models are easier to explain, reproduce and audit than trained weights.

## Decision
Use pretrained models **as-is**. There will be no fine-tuning and no neural training of any
kind within the project timeline.

"Calibration" means choosing thresholds and simple per-word statistics (for example the
mean and standard deviation of correct-take costs, and operating points on a precision–recall
curve) from labeled **dev** data with statistics. These values are stored in `AnalysisConfig`
or in a versioned JSON file (`config/calibration.json`). The **test** split is used only once,
by `scripts/evaluate.py --final`, with settings frozen on dev.

## Consequences
- **Positive:** results are reproducible from the model id, the code and one calibration
  file. There is no training pipeline to build or maintain, and the small dataset is used for
  calibration and an honest test evaluation.
- **Positive:** model choice becomes a measured experiment (MFCC vs pretrained embeddings,
  ADR 0006) instead of a training project.
- **Negative:** accuracy is limited by how well the pretrained representations separate
  correct from incorrect tajweed. A fine-tuned model might do better with enough data. The
  report should list this as future work.
- **Negative:** Whisper-Quran tends to auto-correct toward the expected text. Because it is
  not retrained, it may only check content (ADR 0004) and never decide pronunciation errors.

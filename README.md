# Faseeh · فصيح

Faseeh is a browser-based Qur’an recitation practice studio. Choose a surah and ayah range, listen to Sheikh Muhammad Siddiq al-Minshawi’s murattal recitation, and select any word to study its pronunciation. Record with the microphone or upload audio to get word-level feedback from the pretrained Quran Muaalem model. The static library contains seven surahs, 103 ayahs and 388 timed words.

## Run locally

On Linux, install Python 3.12, FFmpeg and ffprobe. From the project root, run the following commands for a CPU installation. The initial model download is approximately 2.42 GB and requires access to Hugging Face. The server reuses the cached checkpoint on later runs.

```bash
python3.12 -m venv .venv
. .venv/bin/activate
python -m pip install --index-url https://download.pytorch.org/whl/cpu torch==2.8.0
python -m pip install -r requirements.txt -r requirements-model.txt
python -m pip check
python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

Open **http://127.0.0.1:8000/** on the same machine. The backend serves the complete reader at the root. Set `FASEEH_MODEL_PATH` to the directory of the pinned model files to use an existing local checkpoint. The prepared cloud workspace uses `/workspace/.faseeh-venv` and `/workspace/.faseeh-muaalem-model`.

For a GPU install, HTTPS hosting, a Hugging Face Docker Space and primary/fallback configuration, see [deployment instructions](DEPLOYMENT.md). For library sources and model attribution, see [study library](web/data/SOURCES.md) and [model details](web/data/MODEL.md).

## Class and sequence diagrams

The class diagram maps the ten classes and their relationships to the running studio. Four sequence diagrams trace ayah selection, microphone recording, server analysis and unified correction, including permission denial and optional Tajweed explanations. [Class diagram](docs/class-diagram.md) · [Sequence diagrams](docs/sequence-diagrams.md)

The three development snapshots have OODM CLI dashboards for structural traceability, behavioral fidelity, use case coverage and architectural compliance. The measurement pack includes the architecture figure, scoring inputs and instructions for running the same comparison on Windows. [Experiment results and downloads](docs/measurements/README.md)

This branch contains the **Stage 3 application**. Stages 1 and 2 each have a separate branch with the application, architecture and measurements for that version. Each OODM run scans one source folder. [Stage 1 · Faseeh-v2gpt](https://github.com/Lx-Drd/Faseeh-WebApp/tree/Faseeh-v2gpt) · [Stage 2 · Faseeh-v3gpt](https://github.com/Lx-Drd/Faseeh-WebApp/tree/Faseeh-v3gpt)

## Practice flow

| Use cases from SRD v2.1 | In the studio |
| --- | --- |
| UC-01, UC-02 | Search by surah name or number, choose the starting and ending ayahs, and read the selection in the bundled KFGQPC Hafs font. |
| UC-03, UC-04, UC-05 | Select any word for its phonetic script, letter articulation, advanced guidance and timed expert playback. The same card explains words highlighted by the analysis. |
| UC-06, UC-11 | Record after granting microphone access, watch the level and elapsed time, then finish. Upload is also available when microphone access is denied. |
| UC-12 | Analyze after recording. The server infers the recited portion of the selected range. The reader displays word counts, percentage and coverage, or a specific failure message. Cancel dismisses an in-flight analysis. |
| UC-07, UC-08, UC-09 | Choose from 13 interface languages, change text direction, and toggle transliteration and advanced rules. Preferences persist in the browser. |
| UC-10 | Play the full recording or use measured timings to replay the selected word or ayah in the correction card. |

The guide includes a one-minute walkthrough, 13 subtitle tracks and an interactive tour. Expert audio, word boundaries, the Uthmani font, guides and diagrams ship as static files. The client keeps the current recording in memory. The server deletes its temporary audio after processing. Setting `FASEEH_RECORDINGS_DIR` outside the public web tree enables a separate, explicit contribution option with an optional name.

## API and acceptance checks

Submit the complete file as multipart form data with `surah`, `startAyah` and `endAyah`. Maximum file size is 25,000,000 bytes and maximum decoded duration is 330 seconds. Feedback includes the covered ayah range, word counts, per-letter findings, and word intervals in seconds. The server admits up to 40 analysis requests and reports busy when all slots are occupied.

With the server running, submit the bundled first ayah of Al-Ikhlas against the entire surah. Check that the returned coverage ends at ayah 1 and four words have timings. This exercises audio decoding, the actual checkpoint and alignment.

```bash
curl --fail-with-body -F file=@web/audio/112-1.mp3 -F surah=112 \
  -F startAyah=1 -F endAyah=4 http://127.0.0.1:8000/api/analyze
```

Run the automated checks from the project root. The Python tests use the app and model dependencies. The browser test also needs Playwright for Python and Chromium on PATH or installed for Playwright. JavaScript tests use Node 22 or later.

```bash
python -m unittest discover -s tests -p 'test_*.py' -v
node --test tests/*.test.mjs
python tests/browser_flow.py
```

The API tests cover admission control and validation with an inference fixture. Browser tests use controlled server responses for failure and failover cases. Full inference was also tested separately on CPU with real audio, including Minshawi, al-Shatri and Maher al-Muaiqly, a four-ayah passage and a wrong-passage upload. Production GPU throughput, public deployments, and specialist sign-off on recitation guidance and articulation diagrams remain acceptance work.

## Model advisory

This Quranic Teacher is an artificial-intelligence model that may make mistakes. It is intended for assistance only and must not be relied upon. It is not a replacement for a proficient, authorized teacher, because the Quran is only received through oral transmission (mushafahah).

هذا المعلّم القرآني نموذج ذكاء اصطناعي قد يخطئ؛ فهو للإعانة فقط ولا يُعتمد عليه، وليس بديلاً عن معلّمٍ مُتقِنٍ مُجاز؛ لأنّ القرآن لا يُؤخذ إلا بالمشافهة.

Interface providers must show this notice before first use, keep it available afterwards, and display it in Arabic and each interface language. The upstream license and notice accompany the project. [Quran Muaalem License](web/data/licenses/Quran-Muaalem-LICENSE.txt) · [NOTICE](NOTICE)

# Faseeh experiment measurements

OODM CLI 2.0.2 measured the three Git snapshots below. Each commit extends the previous one. The builds received progressively more design information. For the comparison, the evaluator received the same original class diagram, four sequence diagrams, twelve SRD use cases and architecture rules after each build. Its default scan counted 19, 25 and 27 source files respectively, including the original Python prototype and offline tools.

The download contains three English/Arabic HTML dashboards, their original JSON results, an Excel-readable CSV, the four evaluator inputs and the architecture figure. Extract the ZIP and open `reports/stage-1.html`, `reports/stage-2.html` or `reports/stage-3.html` in a browser. [Download the measurement pack](https://github.com/Lx-Drd/Faseeh-WebApp/raw/refs/heads/faseeh-studio/docs/measurements/faseeh-measurements.zip)

| Stage and input given during development | Git commit | #10 Structural traceability | #11 Behavioral fidelity | #12 Use case coverage | #13 Architectural compliance |
| --- | --- | ---: | ---: | ---: | ---: |
| 1 · Requirements and use cases | [4459279](https://github.com/Lx-Drd/Faseeh-WebApp/tree/44592797bdb452078ff9b8543283143a2d424d50) | 6.5% (3/46) | 0.0% (0/32) | 8.3% (1/12) | 10.0/10 (0 violations in 3) |
| 2 · Adds the class diagram | [b445e1d](https://github.com/Lx-Drd/Faseeh-WebApp/tree/b445e1de48b2fd5901d13298216a76d6fc466de3) | 91.3% (42/46) | 46.9% (15/32) | 41.7% (5/12) | 10.0/10 (0 violations in 5) |
| 3 · Adds the four sequence diagrams | [788bcd8](https://github.com/Lx-Drd/Faseeh-WebApp/tree/788bcd89110498a1e6e6f6913d99b84bcf7dea12) | 93.5% (43/46) | 62.5% (20/32) | 58.3% (7/12) | 8.3/10 (1 violation in 6) |

If the assignment counts only diagrams supplied **during development**, record **N/A** for stages 1 and 2 on #11 and for stage 1 on #10. The ZIP includes those alternate stage 1 and stage 2 dashboards in `reports/as-supplied/`. Stage 3 already uses all inputs. [Spreadsheet](results.csv)

## How to explain the scores

| Metric | What OODM found |
| --- | --- |
| **#10 · Structural traceability** | The original diagram has 10 classes, 25 methods and 11 relationships. Stage 1 matched two classes from the earlier Python prototype, `Ayah` and `Surah`, and their relationship. Stages 2 and 3 matched all 10 classes and 25 methods. Stage 3 matched 8 relationships. The three remaining pairs were AudioRecording–AIEngine, PronunciationError–Ayah and CorrectionInterface–Ayah. The code passes these objects as arguments and stores them in fields. |
| **#11 · Behavioral fidelity** | OODM counted 32 forward messages across the four sequences. It skips returns and messages addressed to external actors, including the AI server. Of the 12 unmatched messages in stage 3, six target the GUI and six represent object construction. Faseeh implements its GUI with JavaScript functions and creates its objects with `new`. OODM checks class and method names without testing call order. The stage 3 Chromium test separately exercised all four flows and passed. |
| **#12 · Use case coverage** | The input contains the twelve original SRD titles, including UC-03, “Look Up Word Pronunciation.” OODM compares words in each title with class and function names. For example, “Grant Microphone Permission” is among the five unmatched stage 3 titles. The browser implements that prompt in `requestMicPermission()`. All three snapshots passed their own browser flow tests. |
| **#13 · Architectural compliance** | OODM computes 10 × (1 − violations / observed cross-layer dependencies) and rounds to one decimal. Stage 3 introduced a domain-to-presentation dependency when `PronunciationError` began constructing a `CorrectionInterface`, as the analysis sequence specifies. That accounts for its one violation under the layer rules below. OODM reads local Python imports and JavaScript class references, so the number of dependencies it sees varies across stages. |

The dashboard targets are 90% for metrics 10–12 and 9/10 for metric 13. The class file preserves the original 25 operations. The later `loadReferenceData()` and `setStatus()` messages appear in the sequence input. Creation messages name the JavaScript `constructor` operation, and the learner and the internal `User` object have separate lifelines. The use case file uses the published SRD titles without extra matching keywords. [Class input](../class-faseeh.puml) · [Sequence input](../seq-faseeh.puml) · [Use case input](../usecases.txt) · [OODM scoring implementation](https://github.com/braabormo/oodm-cli/blob/f9394967364ac30a89b24aabdf3480d8d3325502/src/diagrams.js)

## Architecture

Faseeh uses a **browser client and a post-recording AI server**. The browser displays the selected ayahs, captures audio and presents corrections. It sends a completed recording and ayah range to the configured API over HTTPS. FastAPI passes the upload to the recording service, which validates and decodes it, then calls Quran Muaalem. The response provides findings, word timings and a score. The studio can use a configured fallback server.

![Faseeh browser components and the completed-recording request to the AI server](architecture.png)

The SRD supplies the client–server design. For metric 13, this experiment adds the following **source dependency rules**, held fixed across all stages. Runtime HTTP traffic appears in the diagram. The JSON maps source paths to layers and lists the other layers each may reference. OODM skips references within a layer. [Architecture rules](../architecture.json) · [Editable diagram](architecture.puml) · [PNG for a report or slides](architecture.png)

| Layer | Responsibility | Allowed source dependencies across layers |
| --- | --- | --- |
| Presentation | Studio, correction view and guide | Practice, domain, resources |
| Practice | Recording session and analysis client | Domain, resources |
| Domain | Surahs, ayahs, user, recording and findings | Resources |
| Resources | Study media, translations, playback utilities and config | None |
| API | FastAPI request boundary | Recording service |
| Recording service | Decode audio, handle opt-in retention and invoke inference | Inference |
| Inference | Model loading and word alignment | None |
| Library tools | Build bundled study files | Inference |
| Legacy | Original prototype modules | None |

## Generate a report for a folder on Windows

The supplied dashboards open directly in a browser. To measure your **own files**, install Node.js 18 or newer and extract the measurement pack. Open the extracted folder that contains `inputs` and `reports` in PowerShell. Run the following commands, changing the project folder for each local version.

```powershell
$inputs = (Resolve-Path .\inputs).Path
$project = (Resolve-Path "$env:USERPROFILE\Documents\GitHub\Faseeh-v2gpt").Path
$report = Join-Path $project "oodm-fidelity.html"
npx.cmd --yes oodm-cli@2.0.2 "$project" --class-diagram "$inputs\class-faseeh.puml" --sequence "$inputs\seq-faseeh.puml" --usecases "$inputs\usecases.txt" --arch "$inputs\architecture.json" --format html --out "$report"
Start-Process -FilePath "$report"
```

The command reads the source in the selected folder and writes a dashboard named `oodm-fidelity.html` there. The four sequences share one PlantUML file so a single `--sequence` flag loads all four. A local folder with different source can produce different scores.

In a clone of the updated `faseeh-studio` branch, OODM also discovers the four files in `docs` automatically. From the repository root, use `npx.cmd --yes oodm-cli@2.0.2 . --format html --out oodm-fidelity.html`. To reproduce a historical result, use the source at the linked commit and pass the same four inputs explicitly. [OODM CLI](https://braabormo.github.io/oodm-cli/) · [CLI usage and configuration](https://github.com/braabormo/oodm-cli/tree/f9394967364ac30a89b24aabdf3480d8d3325502)

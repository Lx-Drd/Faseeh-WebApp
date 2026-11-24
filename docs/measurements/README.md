# Stage 1 · Requirements and use cases

The application on `Faseeh-v2gpt` comes from the requirements-and-use-cases build at `4459279`. Each report below comes from a separate OODM CLI 2.0.2 run on these same 19 source files. [Original application](https://github.com/Lx-Drd/Faseeh-WebApp/tree/44592797bdb452078ff9b8543283143a2d424d50) · [Download the Stage 1 measurement pack](https://github.com/Lx-Drd/Faseeh-WebApp/raw/refs/heads/Faseeh-v2gpt/docs/measurements/stage-1-measurements.zip)

| Report in the ZIP | #10 Structure | #11 Behavior | #12 Use cases | #13 Architecture |
| --- | ---: | ---: | ---: | ---: |
| `reports/stage-inputs.html` | N/A | N/A | 8.3% | 10.0/10 |
| `reports/common-reference.html` | 6.5% | 0.0% | 8.3% | 10.0/10 |

The first report uses the 12 SRD use cases and the Stage 1 architecture rules. The class and sequence diagrams were introduced in later experiments, so their scores are N/A in this run. The second run also gave OODM those diagrams as evaluation inputs for comparison with other versions. Its structural score reflects three matching items out of 46 and its behavioral score reflects zero matching messages out of 32. Both reports belong to Stage 1. [Use cases](../usecases.txt) · [Layer rules](../architecture.json) · [Scores as CSV](results.csv)

## Architecture

In the browser, `studio.js` selects ayahs and opens word cards, `session.js` handles the microphone, upload and analysis request, and `correction.js` builds the feedback card. FastAPI receives the completed recording. The recording service decodes it and calls the Quran Muaalem model. The architecture file lists modules present in this snapshot. OODM observed three cross-layer dependencies and allowed all three.

![Stage 1 browser modules and AI server](architecture.png)

[Editable architecture diagram](architecture.puml)

## Run OODM on Stage 1

Select `Faseeh-v2gpt` in GitHub Desktop, open the repository folder in PowerShell, and run the following command with Node.js 18 or newer. OODM discovers the Stage 1 inputs in `docs`.

```powershell
npx.cmd --yes oodm-cli@2.0.2 . --format html --out oodm-stage-1.html
```

The ZIP also includes the exact inputs for both runs, JSON results and Windows commands for measuring an existing local copy. Open `START-HERE.txt` after extracting it.

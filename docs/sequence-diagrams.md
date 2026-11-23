# Faseeh sequence diagrams

The four interactions follow a learner from selecting a passage to reviewing a highlighted word. The GUI is the browser studio and its recording session. The AI server runs the pretrained Quran Muaalem model. [Studio](../web/studio.js) · [Recording session](../web/session.js) · [Class diagram](class-diagram.md)

## Select Ayahs

```mermaid
sequenceDiagram
    actor Learner as User
    participant GUI
    participant Surah
    participant Ayah
    Learner->>GUI: selectAyahs(fromAyah, toAyah)
    GUI->>Surah: getAyahRange(fromAyah, toAyah)
    Surah-->>GUI: ayahs in Mushaf order
    loop Each selected ayah
        GUI->>Ayah: loadReferenceData()
        GUI->>Ayah: getUthmaniText()
        Ayah-->>GUI: Uthmani text
    end
    GUI-->>Learner: Show selected ayahs highlighted
```

Both ends of the range are included. Each ayah combines the catalog’s text, transliteration, word timings and audio path with the bundled phonetic reference. Recording, listening and upload become available when the current selection is ready. If the learner changes the range during loading, only the latest selection appears. [Library](../web/library.js) · [Selection and highlighting](../web/studio.js)

## Record Recitation

```mermaid
sequenceDiagram
    actor Learner as User
    participant GUI
    participant Profile as aUser (User)
    Learner->>GUI: Start recording
    GUI->>Profile: createRecording(ayahs)
    create participant Rec as AudioRecording
    Profile->>Rec: Create recording for the selected ayahs
    Profile-->>GUI: rec
    GUI->>Rec: requestMicPermission()
    Rec-->>GUI: granted
    alt Permission denied
        GUI-->>Learner: Show microphone permission message and upload option
    else Permission granted
        GUI->>Rec: startRecord()
        Rec->>Rec: setStatus("recording")
        Learner->>GUI: Stop recording
        GUI->>Rec: stopRecord()
        Rec->>Rec: setStatus("recorded")
        Rec-->>GUI: Complete audio Blob
        GUI->>GUI: analyzeRecitation(rec)
    end
```

The recording stops its microphone tracks and resolves with the complete audio before analysis starts. File upload enters the same analysis flow with the selected file. [User](../web/user.js) · [Audio recording](../web/audio-recording.js) · [Session](../web/session.js)

## Analyze Recitation

```mermaid
sequenceDiagram
    actor Learner as User
    participant GUI
    participant Rec as AudioRecording
    participant Engine as AIEngine
    participant Server as AI Server
    GUI->>Rec: setStatus("analyzing")
    GUI-->>Learner: Show analyzing status and elapsed time
    GUI->>Engine: detectErrors(rec)
    Engine->>Rec: getAudioData()
    Rec-->>Engine: Complete audio
    Engine->>Server: POST /api/analyze with audio and selected ayah range
    Server-->>Engine: Findings, coverage, score and timings
    loop Each finding in the result
        create participant Error as PronunciationError
        Engine->>Error: Create error at the ayah and word position
        create participant Card as CorrectionInterface
        Error->>Card: Create correction interface
    end
    Engine-->>GUI: errors
    GUI->>Rec: setStatus("analyzed")
    GUI->>GUI: highlightErrors(errors)
    GUI-->>Learner: Show highlighted words and summary
```

Each finding gets its own correction interface, including findings on the same word. A successful response with zero findings shows the score and a clear result. Cancellation or a server failure ends the interaction before any highlights are applied. [Analysis client](../web/ai-engine.js) · [Pronunciation error](../web/word-study.js) · [Server](../main.py)

## View Unified Correction

```mermaid
sequenceDiagram
    actor Learner as User
    participant GUI
    participant Error as PronunciationError
    participant Card as CorrectionInterface
    Learner->>GUI: Select highlighted word
    GUI->>Card: loadErrorDetails(error)
    create participant Phonetic as PhoneticTranscription
    Card->>Phonetic: Create transcription
    create participant Guide as ArticulationGuide
    Card->>Guide: Create guide for the selected letter
    create participant Expert as ExpertAudio
    Card->>Expert: Create expert audio reference
    GUI->>Card: renderUnifiedFeedback()
    Card->>Phonetic: getPhoneticText()
    Card->>Guide: getArticulationImage()
    Card->>Guide: getAnatomicalDescription()
    Card->>Expert: getReciterName()
    opt Advanced rules enabled
        GUI->>Error: getRuleExplanation(lang)
        Error-->>GUI: Localized rule
    end
    GUI-->>Learner: Show unified correction
```

The studio opens the interface belonging to the selected finding. The learner can switch findings, change language, toggle advanced rules and play the expert or their own recording within the dialog. Selecting an unflagged word opens a lookup card for its ayah and word position. [Card selection](../web/correction.js) · [Correction interface](../web/correction-interface.js) · [Study media](../web/word-media.js)

## Verification

The Chromium test traces the method calls for all four interactions through the actual controls. It covers permission refusal, a reference retry with overlapping selections, a successful recording, two findings on one word, and advanced rules in both states. The class tests check that each error owns a distinct interface before any of its study media are created. [Browser flow](../tests/browser_flow.py) · [Class tests](../tests/class-model.test.mjs)

# Faseeh class diagram

The browser implements the ten classes below. The two actors in the use cases meet at `AIEngine.detectErrors(recording)`. That method sends a completed recording to FastAPI and converts the model’s findings into objects that point to the selected ayahs.

```mermaid
classDiagram
    class Surah {
        -int surahNumber
        -String nameArabic
        -String nameEnglish
        +loadFromFile(String filePath) List~Surah~$
        +getAyahList() List~Ayah~
        +getAyahRange(int fromAyah, int toAyah) List~Ayah~
    }
    class Ayah {
        -int surahNumber
        -int ayahNumber
        -String uthmaniText
        -String transliteration
        +loadReferenceData() void
        +getUthmaniText() String
        +getTransliteration() String
    }
    class User {
        -String userId
        -String preferredLanguage
        -Boolean transliterationEnabled
        -Boolean advancedRulesEnabled
        +setLanguage(String lang) void
        +toggleTransliteration() void
        +toggleAdvancedRules() void
        +createRecording(List~Ayah~ ayahs) AudioRecording
    }
    class AudioRecording {
        -String recordingId
        -Blob audioData
        -float duration
        -DateTime timestamp
        -String status
        +setStatus(String status) void
        +requestMicPermission() Boolean
        +startRecord() void
        +stopRecord() Blob
        +getAudioData() Blob
        +play() void
    }
    class AIEngine {
        -String serverUrl
        +detectErrors(AudioRecording recording) List~PronunciationError~
    }
    class PronunciationError {
        -String errorId
        -String mispronouncedWord
        -int positionIndex
        -String errorType
        -String letter
        +getRuleExplanation(String lang) String
    }
    class CorrectionInterface {
        -String interfaceId
        -Boolean isUnifiedView
        -String word
        -String letter
        -List~String~ ruleKeys
        +loadErrorDetails(PronunciationError error) void
        +loadWordDetails(Ayah ayah, int positionIndex, String letter) void
        +renderUnifiedFeedback() void
    }
    class PhoneticTranscription {
        -String phonemeText
        +getPhoneticText() String
    }
    class ArticulationGuide {
        -String letter
        -String imagePath
        -String description
        +getArticulationImage() Image
        +getAnatomicalDescription() String
    }
    class ExpertAudio {
        -String reciterName
        -String audioPath
        -String wordAudioPath
        +getExpertAudioClip() Audio
        +getWordAudioClip() Audio
        +getReciterName() String
    }
    Surah "1" *-- "1..*" Ayah : composedOf
    User "1" -- "0..*" AudioRecording : records
    Ayah "1..*" -- "0..*" AudioRecording : recitedIn
    AudioRecording "0..*" -- "1" AIEngine : analyzedBy
    AIEngine "1" -- "0..*" PronunciationError : detects
    PronunciationError "0..*" -- "1" Ayah : locatedIn
    PronunciationError "0..1" -- "1" CorrectionInterface : displaysIn
    CorrectionInterface "0..*" -- "1" Ayah : shows
    CorrectionInterface "1" *-- "1" PhoneticTranscription : contains
    CorrectionInterface "1" *-- "1" ArticulationGuide : contains
    CorrectionInterface "1" *-- "1" ExpertAudio : contains
```

## Follow an ayah through the program

1. **Select a passage.** Loading the catalog creates a Surah and its owned Ayah instances. An inclusive range returns references to those same ayahs. The reader uses the supplied Uthmani text, selectable words and optional transliteration. [Library](../web/library.js) · [Reader](../web/studio.js)
2. **Make a recording.** The anonymous User creates an AudioRecording bound to that user, one analysis engine and a nonempty sequence of consecutive ayahs. Microphone recording and file upload populate the same audio field. The user ID stays in the page session. Only language and display preferences persist. [User](../web/user.js) · [Audio recording](../web/audio-recording.js)
3. **Analyze the completed audio.** The engine submits the selected range and audio, handles replica failover, and locates each error by ayah and zero-based word position. The recording also carries the server’s coverage, score and playback timings. [Analysis client](../web/ai-engine.js) · [Python inference](../muaalem_engine.py)
4. **Open a word.** A lookup starts with an Ayah and word position. Each PronunciationError creates its own CorrectionInterface during analysis. Opening the finding loads its transcription, articulation guide and expert audio. When several findings concern the same word, the learner can switch between them inside the dialog. [Correction interface](../web/correction-interface.js) · [Word study classes](../web/word-media.js)

The sequence diagrams add `Ayah.loadReferenceData()` and `AudioRecording.setStatus(status)` to the original class operations. File and reference loading, microphone permission, stopping the recorder and inference return promises. The articulation image is an accessible SVG. Word audio uses a timed excerpt of the bundled ayah recording. [Sequence diagrams](sequence-diagrams.md)

## Verification

The class tests check object identity across a selection, recording, detected error and correction card. They also check range multiplicity, preferences, the completed microphone Blob, and the card’s three components. The Chromium flow exercises microphone consent, failover, playback, word lookup and switching between two findings on the same word. [Class tests](../tests/class-model.test.mjs) · [Browser flow](../tests/browser_flow.py)

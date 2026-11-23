import { cardStrings } from './card-text.js';
import { speechQuality } from './speech-qualities.js';
import { articulation, lettersOf } from './word-media.js';
import { CorrectionInterface } from './correction-interface.js';

export { articulation, lettersOf, tanweenForm, ArticulationGuide, ExpertAudio, PhoneticTranscription } from './word-media.js';

export class PronunciationError {
  #errorId = crypto.randomUUID();
  #mispronouncedWord;
  #positionIndex;
  #errorType;
  #letter;

  constructor(ayah, detectedBy, finding) {
    this.ayah = ayah;
    this.detectedBy = detectedBy;
    this.#positionIndex = finding.wordIndex;
    this.#mispronouncedWord = ayah.words[this.#positionIndex]?.text ?? finding.word ?? '';
    this.#errorType = finding.type;
    this.#letter = finding.letter || '';
    this.attribute = finding.attribute;
    this.expected = finding.expected;
    this.heard = finding.heard;
    this.phonetic = finding.phonetic;
    this.correctionInterface = new CorrectionInterface();
    Object.freeze(this);
  }

  get errorId() { return this.#errorId; }
  get mispronouncedWord() { return this.#mispronouncedWord; }
  get positionIndex() { return this.#positionIndex; }
  get errorType() { return this.#errorType; }
  get letter() { return this.#letter; }

  getRuleExplanation(lang) {
    const quality = speechQuality(this, lang);
    if (quality) return quality.explanation;
    const t = cardStrings(lang);
    if (this.#errorType === 'madd') return t['rule.length'];
    const letters = lettersOf(this.#mispronouncedWord);
    const i = letters.findIndex(token => token.letter === this.#letter);
    if (i < 0) return t['rule.general'];
    const pausing = this.#positionIndex === this.ayah.words.length - 1 && i === letters.length - 1;
    return t['rule.' + articulation(letters, i, pausing).rule];
  }
}

import { cardStrings } from './card-text.js';
import { speechQuality } from './speech-qualities.js';
import { audioClip } from './audio-clip.js';

const SVG = 'http://www.w3.org/2000/svg';
const diagrams = new URL('./articulation/places.svg', import.meta.url);
let phonetics;

// Keep Qur'anic combining marks attached to their base letter, including shadda and superscript alif.
export function lettersOf(text) {
  return [...text.replace(/ـٔ/gu,'ء').replace(/ـ/gu,'').matchAll(/([ء-غف-يٱ])([\u064b-\u065f\u0670\u06d6-\u06ed]*)/gu)]
    .map(([, letter, marks]) => ({ letter, marks }));
}

export function articulation(letters, index, pausing = false) {
  const { letter: written, marks } = letters[index];
  const letter = written === 'ة' ? (pausing ? 'ه' : 'ت') : marks.includes('ٔ') ? 'ء' : written;
  const previous = letters[index - 1]?.marks || '';
  const elongates = ['ا','ى'].includes(letter)
    || (!marks.match(/[ً-ِّْۡ]/u) && ((letter === 'و' && previous.includes('ُ')) || (letter === 'ي' && previous.includes('ِ'))));
  if (elongates) return { place: 'cavity', rule: 'length' };
  const groups = [
    ['ءأإؤئآهٱ','deepThroat'], ['عح','midThroat'], ['غخ','upperThroat'], ['ق','qaf'], ['ك','kaf'],
    ['جشي','middleTongue'], ['ض','sideTongue'], ['ل','lam'], ['ن','nun'], ['ر','ra'], ['طدت','dental'],
    ['صزس','sibilant'], ['ظذث','interdental'], ['ف','lipTeeth'], ['بم','lips'], ['و','roundLips'],
  ];
  let rule = 'general';
  if ('نم'.includes(letter) && marks.includes('ّ')) rule = 'nasal';
  else if ('قطبجد'.includes(letter) && /[ْۡ]/u.test(marks)) rule = 'echo';
  else if ('خصضغطقظ'.includes(letter)) rule = 'heavy';
  else if (marks.includes('ّ')) rule = 'double';
  return { place: groups.find(([group]) => group.includes(letter))?.[1], rule };
}

// Isolate the lexical tanween spelling from the QPS line, which includes contextual
// assimilation, madd lengths, and waqf. The display never uses this form for scoring.
export function tanweenForm(text) {
  if (!/[ًٌٍ]/u.test(text)) return '';
  const letters = lettersOf(text);
  const marks = {'ً':'َ','ٌ':'ُ','ٍ':'ِ'};
  return letters.map(({letter, marks: raw}, i) => {
    if (raw.includes('۟') || (i > 0 && letter === 'ا' && letters[i-1].marks.includes('ً'))) return '';
    const harakat = raw.replace(/[ۖ-ۭ]/gu,'').replace('ٰ','ا');
    const base = letter === 'ة' ? 'ت' : letter;
    const expanded = harakat.includes('ّ') ? base + 'ْ' + base : base;
    return expanded + harakat.replace('ّ','').replace(/[ًٌٍ]/u, mark => marks[mark] + 'نْ');
  }).join('');
}

function getPhonetics() {
  phonetics ??= fetch(new URL('./data/phonetics.json', import.meta.url)).then(response => {
    if (!response.ok) throw new Error('Phonetic data unavailable');
    return response.json();
  }).catch(() => { phonetics = undefined; return {}; });
  return phonetics;
}

export class PhoneticTranscription {
  #phonemeText;

  constructor(phonemeText = '') {
    this.#phonemeText = phonemeText;
  }

  async load(ayah, positionIndex) {
    if (!this.#phonemeText) {
      const library = await getPhonetics();
      this.#phonemeText = library[ayah.surahNumber + ':' + ayah.ayahNumber]?.[positionIndex] || '';
    }
  }

  getPhoneticText() { return this.#phonemeText; }
}

export class ArticulationGuide {
  #letter;
  #imagePath;
  #description;

  constructor(letters, index, pausing, language) {
    this.#letter = letters[index].letter;
    const site = articulation(letters, index, pausing);
    const t = cardStrings(language);
    this.#imagePath = diagrams.href + '#' + site.place;
    this.#description = t['place.' + site.place] || t.missing;
    this.ruleKey = site.rule;
  }

  get letter() { return this.#letter; }
  getAnatomicalDescription() { return this.#description; }

  getArticulationImage() {
    const graphic = document.createElementNS(SVG, 'svg');
    graphic.setAttribute('viewBox', '32 15 186 126');
    graphic.setAttribute('role', 'img');
    graphic.setAttribute('class', 'wc-diagram');
    graphic.setAttribute('aria-label', this.#description);
    const use = document.createElementNS(SVG, 'use');
    use.setAttribute('x', '32');
    use.setAttribute('y', '15');
    use.setAttribute('width', '186');
    use.setAttribute('height', '126');
    use.setAttribute('href', this.#imagePath);
    graphic.append(use);
    return graphic;
  }
}

export class ExpertAudio {
  #reciterName;
  #audioPath;
  #wordAudioPath;
  #start;
  #end;

  constructor(ayah, positionIndex, reciterName = 'Muhammad Siddiq al-Minshawi') {
    this.#reciterName = reciterName;
    this.#audioPath = ayah.audioPath;
    const word = ayah.words[positionIndex];
    this.#start = word?.start;
    this.#end = word?.end;
    // A word is a timed excerpt of the same local Minshawi ayah recording.
    this.#wordAudioPath = this.#audioPath && Number.isFinite(this.#start) &&
      this.#start >= 0 && Number.isFinite(this.#end) && this.#end > this.#start
      ? this.#audioPath + '#t=' + this.#start + ',' + this.#end : null;
  }

  get hasAyahClip() { return Boolean(this.#audioPath); }
  get hasWordClip() { return Boolean(this.#wordAudioPath); }
  getExpertAudioClip() { return audioClip(this.#audioPath); }
  getWordAudioClip() { return audioClip(this.#wordAudioPath, this.#start, this.#end); }
  getReciterName() { return this.#reciterName; }
}

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

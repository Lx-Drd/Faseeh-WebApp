import { cardStrings } from './card-text.js';
import { audioClip } from './audio-clip.js';

const SVG = 'http://www.w3.org/2000/svg';
const diagrams = new URL('./articulation/places.svg', import.meta.url);

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

export class PhoneticTranscription {
  #phonemeText;

  constructor(phonemeText = '') {
    this.#phonemeText = phonemeText;
  }

  async load(ayah, positionIndex) {
    if (!this.#phonemeText) {
      await ayah.loadReferenceData();
      this.#phonemeText = ayah.getReferencePhonetic(positionIndex);
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

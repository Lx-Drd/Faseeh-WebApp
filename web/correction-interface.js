import { cardStrings } from './card-text.js';
import { speechQuality } from './speech-qualities.js';
import { releaseAudio } from './audio-clip.js';
import { ArticulationGuide, ExpertAudio, PhoneticTranscription, lettersOf, tanweenForm } from './word-media.js';

const views = new WeakMap();
let expertPlayer;

export function stopCardAudio() {
  const previous = expertPlayer;
  expertPlayer = null;
  releaseAudio(previous);
}

export function clearCorrection(container) {
  views.get(container)?.clear();
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function arabic(tag, className, text) {
  const node = element(tag, className, text);
  node.lang = 'ar';
  node.dir = 'rtl';
  return node;
}

function button(label, className, click) {
  const node = element('button', className, label);
  node.type = 'button';
  node.addEventListener('click', click);
  return node;
}

export class CorrectionInterface {
  #interfaceId = 'correction-' + crypto.randomUUID();
  #isUnifiedView = false;
  #word = '';
  #letter = '';
  #ruleKeys = [];
  #ayah = null;
  #error = null;
  #positionIndex = -1;
  #letters = [];
  #selectedLetter = 0;
  #errorLetterIndex = -1;
  #hidden = new Set();
  #transcription;
  #articulation;
  #expertAudio;
  #container;
  #mediaLanguage;
  #ruleBody;
  #ruleExplanation = '';

  constructor(container, options = {}) {
    this.options = options;
    if (container) this.attach(container, options);
  }

  static forContainer(container) { return views.get(container); }

  attach(container, options = {}) {
    if (this.#container && this.#container !== container) this.clear();
    const previous = views.get(container);
    if (previous && previous !== this) previous.clear();
    this.#container = container;
    this.options = options;
    views.set(container, this);
  }

  get interfaceId() { return this.#interfaceId; }
  get isUnifiedView() { return this.#isUnifiedView; }
  get ayah() { return this.#ayah; }
  get error() { return this.#error; }
  get positionIndex() { return this.#positionIndex; }
  get word() { return this.#word; }
  get letter() { return this.#letter; }
  get ruleKeys() { return [...this.#ruleKeys]; }
  get phoneticTranscription() { return this.#transcription; }
  get articulationGuide() { return this.#articulation; }
  get expertAudio() { return this.#expertAudio; }

  #load(ayah, positionIndex, letter, error) {
    const word = ayah.words[positionIndex];
    if (!word) throw new RangeError('Unknown word position in this ayah.');
    if (this.#ayah !== ayah || this.#positionIndex !== positionIndex) this.#hidden.clear();
    this.#ayah = ayah;
    this.#error = error;
    this.#positionIndex = positionIndex;
    this.#word = word.text;
    this.#letters = lettersOf(this.#word);
    this.#selectedLetter = Math.max(0, this.#letters.findIndex(token => token.letter === letter));
    this.#errorLetterIndex = error ? this.#selectedLetter : -1;
    this.#transcription = new PhoneticTranscription(error?.phonetic || word.phonetic || ayah.getReferencePhonetic(positionIndex));
    this.#prepareMedia();
  }

  loadErrorDetails(error) {
    this.#load(error.ayah, error.positionIndex, error.letter, error);
  }

  loadWordDetails(ayah, positionIndex, letter = '') {
    this.#load(ayah, positionIndex, letter, null);
  }

  #selectLetter(index) {
    this.#selectedLetter = index;
    const lastWord = this.#positionIndex === this.#ayah.words.length - 1;
    this.#articulation = new ArticulationGuide(this.#letters, index, lastWord && index === this.#letters.length - 1, this.options.language);
    this.#letter = this.#articulation.letter;
    const issue = index === this.#errorLetterIndex ? this.#error : null;
    const key = issue?.attribute || (issue?.errorType === 'madd' ? 'length' : this.#articulation.ruleKey);
    this.#ruleKeys = [...new Set([key, this.#articulation.ruleKey])];
  }

  #prepareMedia() {
    this.#mediaLanguage = this.options.language;
    const t = cardStrings(this.options.language);
    this.#selectLetter(this.#selectedLetter);
    this.#expertAudio = new ExpertAudio(this.#ayah, this.#positionIndex, t.expert);
  }

  #section(grid, id, title) {
    const details = element('details', 'wc-section');
    details.open = !this.#hidden.has(id);
    details.addEventListener('toggle', () => {
      if (!this.#container?.contains(details)) return;
      if (details.open) this.#hidden.delete(id);
      else this.#hidden.add(id);
    });
    const body = element('div', 'wc-content');
    details.append(element('summary', '', title), body);
    grid.append(details);
    return body;
  }

  #renderIssue(card, t) {
    const issue = this.#error;
    if (!issue) return;
    const row = element('p', 'wc-error');
    const quality = speechQuality(issue, this.options.language);
    row.append(element('strong', '', t[issue.errorType] || t.pronunciation));
    if (quality) row.append(arabic('bdi', '', quality.name));
    if (issue.letter) row.append(arabic('bdi', '', issue.letter));
    for (const part of ['expected', 'heard']) {
      if (issue.attribute) {
        if (quality?.[part]) row.append(element('span', '', t[part]), element('bdi', 'wc-value', quality[part]));
      } else if (issue[part]) {
        row.append(element('span', '', t[part]), arabic('bdi', '', issue[part]));
      }
    }
    card.append(row);
  }

  #renderPhonetics(grid, t) {
    const transcription = this.#transcription;
    const phoneticText = transcription.getPhoneticText();
    const script = arabic('div', 'wc-phonetic', phoneticText || '…');
    const body = this.#section(grid, 'phonetic', t.phonetic);
    body.append(script);
    const expanded = tanweenForm(this.#word);
    if (expanded) body.append(element('small', 'wc-context', t.tanween), arabic('div', 'wc-phonetic', expanded));
    if (!phoneticText) {
      const show = value => {
        if (!this.#container?.contains(script)) return;
        script.textContent = value || t.missing;
        if (!value) { script.lang = this.options.language; script.dir = 'auto'; }
      };
      transcription.load(this.#ayah, this.#positionIndex).then(() => show(transcription.getPhoneticText()), () => show(''));
    }
  }

  #renderArticulation(grid, t) {
    const place = this.#section(grid, 'place', t.place);
    const group = element('div', 'wc-letters');
    group.dir = 'rtl';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', t.choose);
    const layout = element('div', 'wc-place-layout');
    place.append(group, layout);
    this.#ruleBody = this.options.advanced === false ? null : this.#section(grid, 'rule', t.rule);
    const update = () => {
      layout.replaceChildren(this.#articulation.getArticulationImage(),
        element('p', 'wc-description', this.#articulation.getAnatomicalDescription()));
      for (const [i, item] of [...group.children].entries()) item.setAttribute('aria-pressed', String(i === this.#selectedLetter));
      this.#renderRules();
    };
    for (const [i, token] of this.#letters.entries()) {
      const choice = button(token.letter + token.marks, 'wc-letter', () => { this.#selectLetter(i); update(); });
      choice.lang = 'ar';
      group.append(choice);
    }
    update();
  }

  setRuleExplanation(text) {
    this.#ruleExplanation = text;
    this.#renderRules();
  }

  #renderRules() {
    if (!this.#ruleBody) return;
    const t = cardStrings(this.options.language);
    const explanations = this.#ruleKeys.map((key, i) => {
      if (i === 0 && this.#selectedLetter === this.#errorLetterIndex && this.#ruleExplanation) return this.#ruleExplanation;
      return t['rule.' + key];
    }).filter(Boolean);
    this.#ruleBody.replaceChildren(...[...new Set(explanations)].map(text => element('p', '', text)));
  }

  #renderAudio(grid, t, message) {
    const { beforeAudio, hasRecording, playOwn, wordTimings = [] } = this.options;
    const showError = () => { message.textContent = t.audioError; };
    function clip(parent, label, enabled, run) {
      const control = button('▷  ' + label, 'wc-play', async () => {
        stopCardAudio();
        beforeAudio?.();
        message.textContent = '';
        try { if (await run() === false) showError(); } catch { showError(); }
      });
      if (!enabled) { control.disabled = true; control.title = t.missing; control.setAttribute('aria-label', label + ' · ' + t.missing); }
      parent.append(control);
    }
    const playExpert = audio => {
      expertPlayer = audio;
      audio.addEventListener('error', () => { if (expertPlayer === audio) { stopCardAudio(); showError(); } }, { once: true });
      return audio.play().catch(() => { if (expertPlayer === audio) { stopCardAudio(); showError(); } });
    };
    const expert = this.#expertAudio;
    const reference = this.#section(grid, 'expert', expert.getReciterName());
    clip(reference, t.word, expert.hasWordClip, () => playExpert(expert.getWordAudioClip()));
    clip(reference, t.ayah, expert.hasAyahClip, () => playExpert(expert.getExpertAudioClip()));

    if (hasRecording && playOwn) {
      const own = this.#section(grid, 'mine', t.mine);
      const ranges = wordTimings.filter(item => item.ayah === this.#ayah.ayahNumber &&
        Number.isFinite(item.start) && Number.isFinite(item.end) && item.start >= 0 && item.end > item.start);
      const match = ranges.find(item => item.wordIndex === this.#positionIndex);
      clip(own, t.word, Boolean(match), () => playOwn(match.start, match.end));
      clip(own, t.ayah, ranges.length > 0, () => playOwn(Math.min(...ranges.map(r => r.start)), Math.max(...ranges.map(r => r.end))));
    }
  }

  renderUnifiedFeedback() {
    if (!this.#ayah || !this.#container) return;
    stopCardAudio();
    this.#ruleExplanation = '';
    if (this.#mediaLanguage !== this.options.language) this.#prepareMedia();
    const t = cardStrings(this.options.language);
    const card = element('article', 'word-card');
    card.id = this.#interfaceId;
    const header = element('header', 'wc-header');
    const heading = element('div');
    heading.append(element('span', 'wc-label', this.#error ? t.correction : t.lookup), arabic('h3', 'wc-word', this.#word));
    const close = button('×', 'wc-close', () => {
      const onClose = this.options.onClose;
      this.clear();
      onClose?.();
    });
    close.setAttribute('aria-label', t.close);
    header.append(heading, close);
    card.append(header);
    this.#renderIssue(card, t);
    const grid = element('div', 'wc-grid');
    this.#renderPhonetics(grid, t);
    this.#renderArticulation(grid, t);
    const message = element('p', 'wc-play-status');
    message.setAttribute('role', 'status');
    this.#renderAudio(grid, t, message);
    card.append(grid, message);
    this.#container.replaceChildren(card);
    this.#container.hidden = false;
    this.#isUnifiedView = true;
  }

  clear() {
    if (this.#container) {
      stopCardAudio();
      this.#container.replaceChildren();
      this.#container.hidden = true;
      views.delete(this.#container);
      this.#container = null;
    }
    this.options = {};
    this.#isUnifiedView = false;
    this.#ayah = this.#error = this.#transcription = this.#articulation = this.#expertAudio = null;
    this.#ruleBody = null;
    this.#ruleExplanation = '';
    this.#word = this.#letter = '';
    this.#positionIndex = -1;
    this.#errorLetterIndex = -1;
    this.#ruleKeys = this.#letters = [];
    this.#hidden.clear();
  }
}

import { cardStrings } from './card-text.js';
import { speechQuality } from './speech-qualities.js';
import { Ayah } from './library.js';
import { releaseAudio } from './audio-clip.js';
import { ArticulationGuide, ExpertAudio, PhoneticTranscription, PronunciationError, lettersOf, tanweenForm } from './word-study.js';

export { articulation, lettersOf, tanweenForm } from './word-study.js';

const views = new WeakMap();
const catalogAyahs = new WeakMap();
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
  #hidden = new Set();
  #transcription;
  #articulation;
  #expertAudio;
  #container;
  #mediaLanguage;

  constructor(container, options = {}) {
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
    this.#transcription = new PhoneticTranscription(error?.phonetic || word.phonetic);
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
    const issue = this.#error?.letter === this.#letter ? this.#error : null;
    const key = issue?.attribute || (issue?.errorType === 'madd' ? 'length' : this.#articulation.ruleKey);
    this.#ruleKeys = [...new Set([key, this.#articulation.ruleKey])];
  }

  #prepareMedia() {
    this.#mediaLanguage = this.options.language;
    const t = cardStrings(this.options.language);
    this.#expertAudio = new ExpertAudio(this.#ayah, this.#positionIndex, t.expert);
    this.#selectLetter(this.#selectedLetter);
  }

  #section(grid, id, title) {
    const details = element('details', 'wc-section');
    details.open = !this.#hidden.has(id);
    details.addEventListener('toggle', () => {
      if (!this.#container.contains(details)) return;
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
    const script = arabic('div', 'wc-phonetic', transcription.getPhoneticText() || '…');
    const body = this.#section(grid, 'phonetic', t.phonetic);
    body.append(script);
    const expanded = tanweenForm(this.#word);
    if (expanded) body.append(element('small', 'wc-context', t.tanween), arabic('div', 'wc-phonetic', expanded));
    if (!transcription.getPhoneticText()) {
      transcription.load(this.#ayah, this.#positionIndex).then(() => {
        if (!this.#container.contains(script)) return;
        const value = transcription.getPhoneticText();
        script.textContent = value || t.missing;
        if (!value) { script.lang = this.options.language; script.dir = 'auto'; }
      });
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
    const rule = this.options.advanced === false ? null : this.#section(grid, 'rule', t.rule);
    const update = () => {
      layout.replaceChildren(this.#articulation.getArticulationImage(),
        element('p', 'wc-description', this.#articulation.getAnatomicalDescription()));
      for (const [i, item] of [...group.children].entries()) item.setAttribute('aria-pressed', String(i === this.#selectedLetter));
      if (rule) {
        const explanations = this.#ruleKeys.map((key, i) => {
          if (i === 0 && this.#error?.letter === this.#letter) return this.#error.getRuleExplanation(this.options.language);
          return t['rule.' + key];
        });
        rule.replaceChildren(...[...new Set(explanations)].map(text => element('p', '', text)));
      }
    };
    for (const [i, token] of this.#letters.entries()) {
      const choice = button(token.letter + token.marks, 'wc-letter', () => { this.#selectLetter(i); update(); });
      choice.lang = 'ar';
      group.append(choice);
    }
    update();
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
    if (!this.#ayah) return;
    stopCardAudio();
    if (this.#mediaLanguage !== this.options.language) this.#prepareMedia();
    const t = cardStrings(this.options.language);
    const card = element('article', 'word-card');
    card.id = this.#interfaceId;
    const header = element('header', 'wc-header');
    const heading = element('div');
    heading.append(element('span', 'wc-label', this.#error ? t.correction : t.lookup), arabic('h3', 'wc-word', this.#word));
    const close = button('×', 'wc-close', () => { this.clear(); this.options.onClose?.(); });
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
    stopCardAudio();
    this.#container.replaceChildren();
    this.#container.hidden = true;
    this.#isUnifiedView = false;
    this.#ayah = this.#error = this.#transcription = this.#articulation = this.#expertAudio = null;
    this.#word = this.#letter = '';
    this.#positionIndex = -1;
    this.#ruleKeys = this.#letters = [];
    this.#hidden.clear();
  }
}

// Several findings may point to the same word. Route each choice to a single-error
// card so its selected letter, transcription and guidance always describe that finding.
export function renderCorrection(container, { surah, ayah, wordIndex, errors = [], ...display }) {
  const view = views.get(container) ?? new CorrectionInterface(container);
  if (!(ayah instanceof Ayah)) {
    if (!catalogAyahs.has(ayah)) catalogAyahs.set(ayah, new Ayah(surah.id, ayah));
    ayah = catalogAyahs.get(ayah);
  }
  if (!ayah.words[wordIndex]) { view.clear(); return view; }
  const issues = errors.flatMap(issue => {
    if (issue instanceof PronunciationError) return issue.ayah === ayah && issue.positionIndex === wordIndex ? [issue] : [];
    return issue.ayah === ayah.ayahNumber && issue.wordIndex === wordIndex ? [new PronunciationError(ayah, null, issue)] : [];
  });
  view.options = display;
  const t = cardStrings(display.language);
  function show(error) {
    if (view.ayah !== ayah || view.positionIndex !== wordIndex || view.error !== error) {
      if (error) view.loadErrorDetails(error);
      else view.loadWordDetails(ayah, wordIndex);
    }
    view.renderUnifiedFeedback();
    if (issues.length < 2) return;
    const choices = element('div', 'wc-issue-choices');
    choices.setAttribute('role', 'group');
    choices.setAttribute('aria-label', t.correction);
    for (const entry of issues) {
      const quality = speechQuality(entry, display.language);
      const title = [t[entry.errorType] || t.pronunciation, quality?.name, entry.letter].filter(Boolean).join(' · ');
      const choice = button(title, 'wc-error-choice', () => {
        show(entry);
        container.querySelector('.wc-error-choice[aria-pressed="true"]')?.focus();
      });
      choice.setAttribute('aria-pressed', String(entry === error));
      choices.append(choice);
    }
    container.querySelector('.wc-header').after(choices);
  }
  show(issues.includes(view.error) ? view.error : issues[0] ?? null);
  return view;
}

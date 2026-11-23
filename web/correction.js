import { cardStrings } from './card-text.js';
import { speechQuality } from './speech-qualities.js';

const SVG = 'http://www.w3.org/2000/svg';
const diagrams = new URL('./articulation/places.svg', import.meta.url);
const cardState = new WeakMap();
let phonetics;
let expert;
let boundaryTimer;

export function stopCardAudio() {
  clearTimeout(boundaryTimer);
  if (!expert) return;
  const previous = expert;
  expert = null;
  previous.pause();
  previous.removeAttribute('src');
  previous.load();
}

function playExpert(source, start, end, onError) {
  stopCardAudio();
  const audio = new Audio();
  expert = audio;
  const fail = () => {
    if (expert !== audio) return;
    stopCardAudio();
    onError();
  };
  function checkEnd() {
    if (expert !== audio || !Number.isFinite(end)) return;
    clearTimeout(boundaryTimer);
    if (audio.currentTime >= end) stopCardAudio();
    else boundaryTimer = setTimeout(checkEnd, Math.max(15, (end - audio.currentTime) * 1000));
  }
  audio.addEventListener('error', fail, { once: true });
  audio.addEventListener('ended', () => { if (expert === audio) stopCardAudio(); });
  audio.addEventListener('playing', checkEnd);
  audio.addEventListener('timeupdate', checkEnd);
  audio.src = source;
  audio.currentTime = start;
  audio.play().catch(fail);
}

export function clearCorrection(container) {
  stopCardAudio();
  container.replaceChildren();
  container.hidden = true;
  cardState.delete(container);
}

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

function getPhonetics() {
  phonetics ??= fetch(new URL('./data/phonetics.json', import.meta.url)).then(response => {
    if (!response.ok) throw new Error('Phonetic data unavailable');
    return response.json();
  }).catch(() => { phonetics = undefined; return {}; });
  return phonetics;
}

export function renderCorrection(container, {
  surah, ayah, wordIndex, errors = [], wordTimings = [], advanced = true, language = 'en',
  hasRecording = false, playOwn, beforeAudio, onClose,
}) {
  stopCardAudio();
  const word = ayah.words[wordIndex];
  if (!word) { clearCorrection(container); return; }
  const t = cardStrings(language);
  const issues = errors.filter(item => item.ayah === ayah.number && item.wordIndex === wordIndex);
  const tokens = lettersOf(word.text);
  if (!tokens.length) { clearCorrection(container); return; }
  const key = [surah.id, ayah.number, wordIndex].join(':');
  let state = cardState.get(container);
  if (state?.key !== key) {
    const target = issues.find(issue => issue.letter)?.letter;
    const first = target ? tokens.findIndex(token => token.letter === target[0]) : 0;
    state = { key, selected: Math.max(0, first), hidden: new Set() };
    cardState.set(container, state);
  }
  container.hidden = false;
  const card = element('article', 'word-card');
  const header = element('header', 'wc-header');
  const heading = element('div');
  heading.append(element('span', 'wc-label', issues.length ? t.correction : t.lookup), arabic('h3', 'wc-word', word.text));
  const close = button('×', 'wc-close', () => { clearCorrection(container); onClose?.(); });
  close.setAttribute('aria-label', t.close);
  header.append(heading,close);
  card.append(header);

  for (const issue of issues) {
    const row = element('p', 'wc-error');
    const quality = speechQuality(issue,language);
    row.append(element('strong', '', t[issue.type] || t.pronunciation));
    if (quality) row.append(arabic('bdi','',quality.name));
    if (issue.letter) row.append(arabic('bdi', '', issue.letter));
    for (const part of ['expected','heard']) {
      if (issue.attribute) {
        if (quality?.[part]) row.append(element('span','',t[part]),element('bdi','wc-value',quality[part]));
      } else if (issue[part]) {
        row.append(element('span','',t[part]),arabic('bdi','',issue[part]));
      }
    }
    card.append(row);
  }
  const grid = element('div','wc-grid');
  function section(id,title) {
    const details = element('details','wc-section');
    details.open = !state.hidden.has(id);
    details.addEventListener('toggle',() => {
      if (details.open) state.hidden.delete(id);
      else state.hidden.add(id);
    });
    const body = element('div','wc-content');
    details.append(element('summary','',title),body);
    grid.append(details);
    return body;
  }
  const phonetic = arabic('div','wc-phonetic', issues.find(i => i.phonetic)?.phonetic || word.phonetic || '…');
  const spelling = section('phonetic',t.phonetic);
  spelling.append(phonetic);
  const expanded = tanweenForm(word.text);
  if (expanded) spelling.append(element('small','wc-context',t.tanween),arabic('div','wc-phonetic',expanded));
  if (phonetic.textContent === '…') {
    getPhonetics().then(data => {
      const value = data[surah.id + ':' + ayah.number]?.[wordIndex];
      phonetic.textContent = value || t.missing;
      if (!value) { phonetic.lang = language; phonetic.dir = 'auto'; }
    });
  }

  const place = section('place', t.place);
  const group = element('div', 'wc-letters');
  group.dir = 'rtl';
  group.setAttribute('role','group');
  group.setAttribute('aria-label', t.choose);
  const graphic = document.createElementNS(SVG,'svg');
  graphic.setAttribute('viewBox','32 15 186 126');
  graphic.setAttribute('role','img');
  graphic.setAttribute('class','wc-diagram');
  const use = document.createElementNS(SVG,'use');
  use.setAttribute('x', '32'); use.setAttribute('y', '15');
  use.setAttribute('width','186'); use.setAttribute('height','126');
  graphic.append(use);
  const desc = element('p','wc-description');
  const layout = element('div','wc-place-layout');
  layout.append(graphic,desc);
  place.append(group,layout);
  const rule = advanced ? section('rule',t.rule) : null;

  function select(index) {
    state.selected = index;
    const pausing = wordIndex === ayah.words.length - 1 && index === tokens.length - 1;
    const detail = articulation(tokens,index,pausing);
    const mistake = issues.find(issue => issue.letter === tokens[index].letter);
    if (mistake?.type === 'madd') detail.rule = 'length';
    for (const [i,b] of [...group.children].entries()) b.setAttribute('aria-pressed',String(i === index));
    use.setAttribute('href', diagrams.href + '#' + detail.place);
    desc.textContent = t['place.' + detail.place] || t.missing;
    graphic.setAttribute('aria-label',desc.textContent);
    if (rule) {
      const descriptions = new Set(issues.filter(issue => issue.letter === tokens[index].letter)
        .map(issue => speechQuality(issue,language)?.explanation).filter(Boolean));
      rule.replaceChildren(...[...descriptions].map(description => element('p','',description)));
      if (!descriptions.size) rule.textContent = t['rule.' + detail.rule];
    }
  }
  for (const [index,token] of tokens.entries()) {
    const b = button(token.letter + token.marks,'wc-letter',() => select(index));
    b.lang = 'ar';
    group.append(b);
  }
  select(state.selected);

  const message = element('p', 'wc-play-status');
  message.setAttribute('role','status');
  const showError = () => { message.textContent = t.audioError; };
  function clip(parent,label,enabled,run) {
    const b = button('▷  ' + label,'wc-play',async () => {
      stopCardAudio();
      beforeAudio?.();
      message.textContent = '';
      try { if (await run() === false) showError(); }
      catch { showError(); }
    });
    if (!enabled) { b.disabled = true; b.title = t.missing; b.setAttribute('aria-label', label + ' · ' + t.missing); }
    parent.append(b);
  }
  const reference = section('expert',t.expert);
  const valid = record => Number.isFinite(record?.start) && Number.isFinite(record.end) && record.start >= 0 && record.end > record.start;
  clip(reference,t.word, ayah.audio && valid(word), () => playExpert(ayah.audio,word.start,word.end,showError));
  clip(reference,t.ayah, Boolean(ayah.audio), () => playExpert(ayah.audio,0,Infinity,showError));

  if (hasRecording && playOwn) {
    const own = section('mine',t.mine);
    const ranges = wordTimings.filter(item => item.ayah === ayah.number && valid(item));
    const match = ranges.find(item => item.wordIndex === wordIndex);
    clip(own,t.word,Boolean(match),() => playOwn(match.start,match.end));
    clip(own,t.ayah,ranges.length > 0,() => playOwn(Math.min(...ranges.map(r => r.start)),Math.max(...ranges.map(r => r.end))));
  }
  card.append(grid,message);
  container.replaceChildren(card);
}

import { isRTL, languages, translate } from './i18n.js';

const css = document.createElement('link');
css.rel = 'stylesheet';
css.href = new URL('./guide/guide.css', import.meta.url);
document.head.append(css);

const tourTargets = ['#library', '#range', '#verses', '#practice', '#preferences'];
const tourTitles = ['library', 'passage', 'select_word', 'practice', 'language'];

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function button(label, click, className = '') {
  const control = element('button', label, className);
  control.type = 'button';
  control.addEventListener('click', click);
  return control;
}

export function openGuide(lang) {
  if (document.querySelector('#practice-guide')) return;
  const t = key => translate(lang, key);
  const dialog = element('dialog', '', 'fas-guide');
  dialog.id = 'practice-guide';
  dialog.lang = lang;
  dialog.dir = isRTL(lang) ? 'rtl' : 'ltr';
  dialog.setAttribute('aria-labelledby', 'guide-title');
  const heading = element('h2', t('guide'));
  heading.id = 'guide-title';
  const close = button('×', () => dialog.close(), 'guide-close');
  close.setAttribute('aria-label', t('close'));
  const header = element('header');
  header.append(heading, close);
  const video = element('video');
  video.controls = true;
  video.playsInline = true;
  video.preload = 'metadata';
  video.setAttribute('aria-label', t('video'));
  video.poster = new URL('./guide/poster.jpg', import.meta.url);
  video.src = new URL('./guide/walkthrough.mp4', import.meta.url);
  for (const { code, name } of languages) {
    const track = document.createElement('track');
    track.kind = 'captions';
    track.srclang = code;
    track.label = name;
    track.src = new URL('./guide/' + code + '.vtt', import.meta.url);
    track.default = code === lang;
    video.append(track);
  }

  const actions = element('div', '', 'guide-actions');
  const content = element('div', '', 'guide-content');
  const instruction = element('p', '', 'guide-instruction');
  const progress = element('div', '', 'guide-progress');
  const localizedNumber = new Intl.NumberFormat(lang);
  progress.setAttribute('aria-hidden', 'true');
  let index = 0;
  let target;
  let libraryOpened = false;
  let initialScroll = window.scrollY;
  const libraryToggle = document.querySelector('#menu-toggle');

  function positionTarget() {
    if (!target) return;
    const top = target.getBoundingClientRect().top + window.scrollY;
    const freeHeight = window.innerHeight - dialog.offsetHeight - 40;
    const offset = Math.max(12, (freeHeight - Math.min(target.offsetHeight, freeHeight)) / 2);
    window.scrollTo({ top: Math.max(0, top - offset), behavior: 'instant' });
  }
  function displayStep() {
    target?.classList.remove('faseeh-tour-target');
    const section = document.querySelector(tourTargets[index]);
    if (index === 0 && libraryToggle?.offsetWidth && libraryToggle.getAttribute('aria-expanded') === 'false') {
      libraryToggle.click();
      libraryOpened = true;
    }
    if (index === 0) target = section?.querySelector('.search') ?? section;
    else if (index === 2) target = section?.firstElementChild ?? section;
    else target = section;
    target?.classList.add('faseeh-tour-target');
    heading.textContent = t(tourTitles[index]);
    progress.textContent = localizedNumber.format(index + 1) + ' / ' + localizedNumber.format(tourTargets.length);
    instruction.textContent = t('step' + (index + 1));
    actions.replaceChildren();
    const previous = button(t('back'), () => { index--; displayStep(); });
    previous.disabled = index === 0;
    const last = index === tourTargets.length - 1;
    const next = button(t(last ? 'done' : 'next'), () => {
      if (last) dialog.close();
      else { index++; displayStep(); }
    }, 'guide-primary');
    actions.append(previous, next);
    next.focus({ preventScroll: true });
    requestAnimationFrame(positionTarget);
  }
  function startTour() {
    video.pause();
    initialScroll = window.scrollY;
    dialog.classList.add('guide-tour');
    content.setAttribute('aria-live', 'polite');
    content.replaceChildren(progress, instruction);
    displayStep();
  }
  actions.append(button(t('tour'), startTour, 'guide-primary'));
  const advisory = element('p', t('notice'));
  const arabic = element('p', translate('ar', 'notice'));
  arabic.lang = 'ar'; arabic.dir = 'rtl'; arabic.hidden = lang === 'ar';
  content.append(video, advisory, arabic);
  dialog.append(header, content, actions);
  document.body.append(dialog);
  dialog.addEventListener('close', () => {
    video.pause();
    target?.classList.remove('faseeh-tour-target');
    if (libraryOpened && libraryToggle?.getAttribute('aria-expanded') === 'true') libraryToggle.click();
    if (target) window.scrollTo({ top: initialScroll, behavior: 'instant' });
    window.removeEventListener('resize', positionTarget);
    dialog.remove();
  }, { once: true });
  window.addEventListener('resize', positionTarget);
  dialog.showModal();
}

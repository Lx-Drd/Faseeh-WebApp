import { languages, translate, isRTL } from './i18n.js';
import { createSession } from './session.js';
import { Surah } from './library.js';
import { User } from './user.js';
import { AIEngine } from './ai-engine.js';
import { ExpertAudio } from './word-study.js';
import { renderCorrection, clearCorrection, stopCardAudio } from './correction.js';
import { openGuide } from './guide.js';
import { icon } from './icons.js';

const el = id => document.getElementById(id);
function node(tag, cls, text) {
  const element = document.createElement(tag);
  if (cls) element.className = cls;
  if (text != null) element.textContent = text;
  return element;
}
function buttonContent(button, symbol, text) {
  const mark = node('i'); mark.innerHTML = icon(symbol);
  button.replaceChildren(mark, node('span', '', text));
}

async function startStudio() {
  const library = await Surah.loadFromFile('/data/surahs.json');
  const config = window.FASEEH_CONFIG ?? {};
  const health = await fetch('/health', {signal: AbortSignal.timeout(2500)}).then(r => r.json()).catch(() => ({}));
  const [primary, ...fallbacks] = config.analysisEndpoints ?? ['/api/analyze'];
  const user = new User(new AIEngine(primary, fallbacks));
  let surah = library.find(s => s.surahNumber === 112) ?? library[0];
  let first = 1, last = surah.getAyahList().length, result, activeWord;
  let state = {phase: 'idle'}, listening = false, sequence = 0, referencePlayer;
  const t = key => translate(user.preferredLanguage, key);
  const num = n => new Intl.NumberFormat(user.preferredLanguage, {useGrouping:false}).format(n);
  const rangeText = (a, b) => a === b ? num(a) : num(a) + '–' + num(b);
  const ayahLabel = (a, b) => t('ayahs') + ' ' + rangeText(a,b);
  const checkbox = id => el(id).checked;

  function setLocale() {
    const lang = user.preferredLanguage;
    document.documentElement.lang = lang;
    document.documentElement.dir = isRTL(lang) ? 'rtl' : 'ltr';
    document.querySelectorAll('[data-i]').forEach(n => n.textContent = t(n.dataset.i));
    document.querySelectorAll('[data-placeholder]').forEach(n => {
      n.placeholder = t(n.dataset.placeholder);
      n.setAttribute('aria-label', n.placeholder);
    });
    el('notice-ar').hidden = lang === 'ar';
    el('notice-ar').textContent = translate('ar','notice');
    el('language').setAttribute('aria-label',t('language'));
    el('menu-toggle').setAttribute('aria-label', t('menu'));
    el('surah-list').setAttribute('aria-label', t('library'));
    el('level').setAttribute('aria-label', t('recording'));
    el('preferences').setAttribute('aria-label', t('studio'));
    document.title = 'Faseeh · ' + t('practice');
    el('language').value = lang;
    el('card-language').value = lang;
    el('card-language').setAttribute('aria-label',t('language'));
  }

  function renderLibrary() {
    const query = el('search').value.trim().toLocaleLowerCase().normalize('NFKD')
      .replace(/[٠-٩]/g, d => String(d.charCodeAt(0)-1632)).replace(/[۰-۹]/g, d => String(d.charCodeAt(0)-1776));
    const choices = library.filter(s => (s.surahNumber+' '+s.nameEnglish+' '+s.nameArabic).toLowerCase().normalize('NFKD').includes(query));
    el('surah-list').replaceChildren(...choices.map(s => {
      const b = node('button','surah-item'); b.dataset.id = s.surahNumber; b.setAttribute('aria-current',String(s.surahNumber === surah.surahNumber));
      const label = node('span','surah-label');
      label.append(node('strong','',s.nameEnglish),node('small','',num(s.getAyahList().length)+' '+t('ayahs')));
      const ar = node('span','surah-ar',s.nameArabic); ar.lang = 'ar'; ar.dir = 'rtl';
      b.append(node('span','surah-number',num(s.surahNumber)), label, ar); return b;
    }));
    el('no-matches').hidden = choices.length > 0;
  }

  function renderPassage() {
    const lang = user.preferredLanguage;
    el('hero-title').textContent = lang === 'ar' ? surah.nameArabic : surah.nameEnglish;
    const alternate = el('hero-arabic');
    alternate.textContent = lang === 'ar' ? surah.nameEnglish : surah.nameArabic;
    alternate.lang = lang === 'ar' ? 'en' : 'ar';
    alternate.dir = lang === 'ar' ? 'ltr' : 'rtl';
    el('ayah-count').textContent = num(surah.getAyahList().length)+' '+t('ayahs');
    el('range-heading').textContent = ayahLabel(first,last);
    for (const [id, value] of [['from-ayah',first],['to-ayah',last]]) {
      el(id).replaceChildren(...surah.getAyahList().map(a => new Option(num(a.ayahNumber),a.ayahNumber)));
      el(id).value = value;
    }
    el('verses').replaceChildren(...surah.getAyahRange(first, last).map(a => {
      const row = node('article','ayah-row');
      row.setAttribute('aria-label', a.getUthmaniText());
      const badge = node('span','ayah-ref',num(surah.surahNumber)+':'+num(a.ayahNumber)); badge.dir = 'ltr';
      const line = node('div','ayah-text'); line.dir = 'rtl'; line.lang = 'ar';
      for (const [i, word] of a.words.entries()) {
        const b = node('button','word',word.text); b.dataset.word = i; b.dataset.ayah = a.ayahNumber;
        if (result?.errors.some(e => e.ayah === a && e.positionIndex === i)) {
          b.classList.add('flagged');
          b.setAttribute('aria-haspopup','dialog');
        }
        line.append(b, document.createTextNode(' '));
      }
      const text = node('div'); text.append(line);
      if (user.transliterationEnabled) {const tr=node('p','translit',a.getTransliteration()); tr.dir='ltr'; text.append(tr);}
      row.append(badge,text); return row;
    }));
    renderListen(); renderSummary();
  }

  function renderSummary() {
    const box = el('summary'); box.hidden = !result; box.replaceChildren();
    if (!result) return;
    if (!result.errors.length) box.append(node('strong','',t('correct')));
    box.append(node('strong','',num(result.correctWords)+' / '+num(result.totalWords)+' · '+num(result.percentage)+'% '+t('words_correct')),
      node('span','',t('covered')+' · '+rangeText(result.startAyah,result.endAyah)));
  }

  function renderListen() {
    buttonContent(el('listen'),listening ? 'stop':'play',t(listening ? 'stop':'listen'));
    el('listen').setAttribute('aria-pressed',String(listening));
  }
  function stopReference() {
    sequence++; listening = false;
    if (referencePlayer) {referencePlayer.onended = null; referencePlayer.onerror = null; referencePlayer.pause(); referencePlayer = null;}
    renderListen();
  }
  function stopAll() {stopReference(); stopCardAudio(); session.stopPlayback();}
  function playRange() {
    if (listening) {stopReference(); return;}
    stopAll(); el('audio-message').hidden = true;
    const token = sequence;
    const queue = surah.getAyahRange(first, last);
    listening = true; renderListen();
    function fail() {
      if (sequence !== token) return;
      stopReference(); el('audio-message').textContent = t('audio_missing'); el('audio-message').hidden = false;
    }
    function next(index) {
      if (sequence !== token) return;
      if (index >= queue.length) {stopReference(); return;}
      referencePlayer = new ExpertAudio(queue[index]).getExpertAudioClip();
      if (!referencePlayer) {fail(); return;}
      referencePlayer.onended = () => next(index+1);
      referencePlayer.onerror = fail; referencePlayer.play().catch(fail);
    }
    next(0);
  }

  function showCard() {
    if (!activeWord) return;
    const ayah = surah.getAyahList().find(a => a.ayahNumber === activeWord.ayah);
    el('card-advanced').checked = user.advancedRulesEnabled;
    renderCorrection(el('card-mount'), {surah, ayah, wordIndex:activeWord.index, language:user.preferredLanguage, advanced:user.advancedRulesEnabled,
      errors:result?.errors, wordTimings:result?.wordTimings, hasRecording:state.hasRecording,
      beforeAudio(){stopReference();session.stopPlayback();}, playOwn:(s,e)=>session.play(s,e),
      onClose:()=>el('feedback').close()});
    el('feedback').setAttribute('aria-label', ayah.words[activeWord.index].text);
    if (!el('feedback').open) el('feedback').showModal();
  }

  function renderState(s) {
    state = s;
    const phase = s.phase, elapsed = num(s.elapsed ?? 0)+' '+t('seconds');
    const recording = phase === 'recording', analyzing = phase === 'analyzing', waiting = phase === 'requesting';
    const busy = recording || analyzing || waiting;
    const phaseKey = {idle:'ready',requesting:'requesting',recording:'recording',analyzing:'analyzing',ready:'complete',error:'practice'}[phase];
    let label = t(phaseKey);
    if (recording || analyzing) label += ' · ' + elapsed;
    if (analyzing && s.estimate != null) label += ' · '+t('estimated')+' '+num(Math.round(s.estimate))+' '+t('seconds');
    if (el('practice-state').textContent !== label) el('practice-state').textContent = label;
    const action = recording ? 'finish':'record';
    if (el('record').dataset.action !== action+user.preferredLanguage) {
      buttonContent(el('record'),recording?'stop':'mic',t(action)); el('record').dataset.action = action+user.preferredLanguage;
    }
    el('record').disabled = analyzing || waiting; el('upload').hidden = busy; el('cancel').hidden = !busy;
    el('level').hidden = !recording; el('level').value = s.level ?? 0;
    el('practice-message').hidden = !s.messageKey;
    if (s.messageKey) el('practice-message').textContent = t(s.messageKey);
    el('play-mine').hidden = !s.hasRecording || busy;
    el('consent').disabled = busy; el('contributor').disabled = busy;
    el('listen').disabled = busy;
    el('from-ayah').disabled = el('to-ayah').disabled = busy;
    el('surah-list').inert = busy;
    el('verses').inert = recording || waiting;
    el('guide-button').disabled = recording || waiting;
  }

  const session = createSession({
    user, getSelection:()=>surah.getAyahRange(first, last), t,
    allowConsent:health.retentionEnabled === true,
    onResult(summary, errors){result = { ...summary, errors }; renderPassage(); if (el('feedback').open) showCard();},
    onReset(){result = null; renderPassage();}, onState:renderState
  });
  function clearSelection() {
    if (el('feedback').open) el('feedback').close();
    activeWord = null; stopAll(); session.reset(); el('audio-message').hidden = true;
  }
  el('consent-area').hidden = !health.retentionEnabled;
  function updateConsent() {
    el('contributor').hidden = !checkbox('consent'); session.setConsent(checkbox('consent'),el('contributor').value);
  }
  el('consent').onchange = updateConsent; el('contributor').oninput = updateConsent;
  for (const id of ['language','card-language']) {
    el(id).replaceChildren(...languages.map(l => new Option(l.name,l.code)));
  }
  el('transliteration').checked = user.transliterationEnabled;
  el('advanced').checked = user.advancedRulesEnabled;
  document.querySelectorAll('i[data-icon]').forEach(i => i.innerHTML = icon(i.dataset.icon));
  el('card-language').onchange = el('language').onchange = e => {
    user.setLanguage(e.target.value); setLocale(); renderLibrary(); renderPassage(); session.refresh();
    if (activeWord && el('feedback').open) showCard();
  };
  el('search').oninput = renderLibrary;
  el('menu-toggle').onclick = () => {
    const open = el('library').classList.toggle('expanded');
    el('menu-toggle').setAttribute('aria-expanded',String(open));
  };
  el('surah-list').onclick = e => {
    const b = e.target.closest('button[data-id]'); if (!b) return;
    clearSelection(); surah = library.find(s => s.surahNumber === Number(b.dataset.id));
    first = 1; last = surah.getAyahList().length;
    el('library').classList.remove('expanded'); el('menu-toggle').setAttribute('aria-expanded','false');
    renderLibrary(); renderPassage();
  };
  el('from-ayah').onchange = e => {
    const next = Number(e.target.value); clearSelection(); first = next; last = Math.max(first,last); renderPassage();
  };
  el('to-ayah').onchange = e => {
    const next = Number(e.target.value); clearSelection(); last = next; first = Math.min(first,last); renderPassage();
  };
  for (const id of ['transliteration','advanced']) el(id).onchange = () => {
    if (id === 'advanced') user.toggleAdvancedRules();
    else user.toggleTransliteration();
    renderPassage();
    if (activeWord && el('feedback').open) showCard();
  };
  el('card-advanced').onchange = () => {
    el('advanced').checked = checkbox('card-advanced'); el('advanced').onchange();
  };
  el('verses').onclick = e => {
    const b=e.target.closest('button[data-word]'); if (!b) return;
    stopAll(); activeWord={ayah:Number(b.dataset.ayah),index:Number(b.dataset.word)}; showCard();
  };
  el('feedback').addEventListener('close',()=>{clearCorrection(el('card-mount'));session.stopPlayback();activeWord=null;});
  el('feedback').onclick = e => {if (e.target === el('feedback')) el('feedback').close();};
  el('guide-button').onclick = () => {stopAll();openGuide(user.preferredLanguage);};
  el('listen').onclick = playRange;
  el('record').onclick = () => {if (state.phase === 'recording') session.stop(); else {stopAll(); session.start();}};
  el('cancel').onclick = () => session.cancel();
  el('upload').onclick = ()=>el('upload-file').click();
  el('upload-file').onchange = e => {const file=e.target.files[0]; if (file) {stopAll();session.upload(file);} e.target.value='';};
  el('play-mine').onclick = () => {stopAll();session.play();};
  window.addEventListener('pagehide',()=>{stopAll();session.destroy();});
  setLocale(); renderLibrary(); renderPassage(); session.refresh();
}
startStudio().catch(error => {
  console.error(error);
  el('load-error').textContent = 'The practice studio could not load. Refresh the page to try again.';
  el('load-error').hidden = false;
});

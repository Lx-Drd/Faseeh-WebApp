import { AIEngine } from './ai-engine.js';
import { Ayah } from './library.js';
import { MAX_SECONDS } from './audio-recording.js';
import { User } from './user.js';

const SPEED_KEY = 'faseeh.analysisSecondsPerAudioSecond';

function previousSpeed() {
  try {
    const speed = Number(localStorage.getItem(SPEED_KEY));
    return Number.isFinite(speed) && speed > 0 ? speed : null;
  } catch { return null; }
}

function rememberSpeed(seconds, duration) {
  if (!(duration > 0 && Number.isFinite(duration))) return;
  const sample = Math.max(0.01, seconds / duration);
  const previous = previousSpeed();
  try { localStorage.setItem(SPEED_KEY, String(previous ? previous * 0.5 + sample * 0.5 : sample)); }
  catch { /* Private browsing can restrict local storage. */ }
}

// Embedders of the original session API can still supply just the numeric range.
// The studio passes the selected, fully populated Ayah instances from its Surah.
function selectedAyahs(selection) {
  if (Array.isArray(selection)) return selection;
  const { surah, startAyah, endAyah } = selection;
  if (![surah, startAyah, endAyah].every(Number.isInteger) ||
      startAyah < 1 || endAyah < startAyah || endAyah > 286) throw new RangeError('invalid_selection');
  return Array.from({ length: endAyah - startAyah + 1 }, (_, i) => new Ayah(surah, { number: startAyah + i }));
}

/** Coordinates the view lifecycle. The recording owns capture and the engine owns analysis. */
export function createSession({
  getSelection, user, t = key => key, onState = () => {}, onResult = () => {},
  onReset = () => {}, endpoints = ['/api/analyze'], allowConsent = false,
}) {
  user ??= new User(new AIEngine(endpoints[0], endpoints.slice(1)));
  let recording = null, operation = null;
  let phase = 'idle', messageKey = '', timer, startTime = 0, lastElapsed = 0, estimate = null;
  let consent = false, contributorName = '';

  function emit() {
    const timed = phase === 'recording' || phase === 'analyzing';
    const elapsed = timed ? Math.floor((performance.now() - startTime) / 1000) : lastElapsed;
    onState({ phase, elapsed, estimate, level: recording?.level ?? 0,
      hasRecording: Boolean(recording?.getAudioData()), messageKey, message: messageKey ? t(messageKey) : '' });
  }

  function setPhase(next, error = '') {
    clearInterval(timer);
    phase = next;
    messageKey = error;
    if (next === 'recording' || next === 'analyzing') {
      startTime = performance.now();
      timer = setInterval(emit, next === 'recording' ? 150 : 500);
    }
    emit();
  }

  function cancel() {
    operation?.abort();
    operation = null;
    recording?.cancelCapture();
    estimate = null;
    lastElapsed = 0;
    setPhase('idle');
  }

  function reset() {
    recording?.dispose();
    recording = null;
    cancel();
    onReset();
  }

  function prepare() {
    reset();
    recording = user.createRecording(selectedAyahs(getSelection()));
    operation = new AbortController();
    return recording;
  }

  function fail(error) {
    if (recording) recording.status = 'error';
    setPhase('error', error);
  }

  async function analyze(take, signal) {
    if (navigator.onLine === false) return fail('no_connection');
    const speed = previousSpeed();
    const predict = () => take.duration && speed ? Math.max(1, Math.round(take.duration * speed)) : null;
    estimate = predict();
    setPhase('analyzing');
    try {
      if (!take.duration) {
        const duration = await take.measureDuration(signal);
        if (signal.aborted) return;
        if (duration > MAX_SECONDS) return fail('too_long');
        estimate = predict();
        emit();
      }
      const errors = await take.analyzedBy.detectErrors(take, { signal, consent: allowConsent && consent, contributorName });
      if (signal.aborted) return;
      const elapsed = (performance.now() - startTime) / 1000;
      rememberSpeed(elapsed, take.duration);
      lastElapsed = Math.floor(elapsed);
      setPhase('ready');
      onResult(take.analysisResult, errors);
    } catch (error) {
      if (!signal.aborted) fail(error.message);
    }
  }

  async function upload(file) {
    if (!file) return;
    try {
      const take = prepare();
      take.setAudioData(file);
      await analyze(take, operation.signal);
    } catch (error) { fail(error.message); }
  }

  async function start() {
    if (['requesting', 'recording', 'analyzing'].includes(phase)) return;
    try {
      const take = prepare();
      const signal = operation.signal;
      setPhase('requesting');
      const granted = await take.requestMicPermission();
      if (signal.aborted) return;
      if (!granted) return fail(take.permissionError);
      take.startRecord(code => { if (!signal.aborted) fail(code); });
      setPhase('recording');
    } catch (error) { fail(error.message); }
  }

  async function stop() {
    if (recording?.status !== 'recording') return;
    const take = recording;
    const signal = operation.signal;
    try {
      await take.stopRecord();
      if (!signal.aborted) await analyze(take, signal);
    } catch (error) {
      if (!signal.aborted) fail(error.message);
    }
  }

  async function play(start, end) {
    const take = recording;
    if (!take) return false;
    const played = await take.play(start, end);
    if (!played && recording === take) {
      messageKey = 'playback_unavailable';
      emit();
    }
    return played;
  }

  return {
    start, stop, upload, cancel, reset, play, destroy: reset, refresh: emit, user,
    get recording() { return recording; },
    stopPlayback() { recording?.stopPlayback(); },
    setConsent(value, name = '') { consent = Boolean(value); contributorName = String(name).trim().slice(0, 80); },
  };
}

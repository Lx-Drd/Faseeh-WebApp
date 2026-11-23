import { Ayah } from './library.js';
import { audioClip, releaseAudio } from './audio-clip.js';

const MAX_BYTES = 25_000_000;
export const MAX_SECONDS = 330;

function recordingOptions() {
  const types = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'];
  const mimeType = types.find(type => MediaRecorder.isTypeSupported?.(type));
  return mimeType ? { mimeType } : {};
}

export class AudioRecording {
  #recordingId = crypto.randomUUID();
  #user;
  #ayahs;
  #analyzedBy;
  #timestamp = new Date();
  #audioData = null;
  #duration = 0;
  #status = 'idle';
  #url = null;
  #stream;
  #recorder;
  #context;
  #analyser;
  #samples;
  #permissionVersion = 0;
  #startedAt = 0;
  #pendingStop;
  #player;

  constructor(user, ayahs, analyzedBy) {
    if (!user || !analyzedBy) throw new TypeError('A recording needs a user and an analysis engine.');
    if (!Array.isArray(ayahs) || !ayahs.length || !ayahs.every((ayah, i) =>
      ayah instanceof Ayah && ayah.surahNumber === ayahs[0].surahNumber &&
      ayah.ayahNumber === ayahs[0].ayahNumber + i)) throw new RangeError('invalid_selection');
    this.#user = user;
    this.#ayahs = Object.freeze([...ayahs]);
    this.#analyzedBy = analyzedBy;
    this.analysisResult = null;
    this.permissionError = '';
  }

  get user() { return this.#user; }
  get ayahs() { return this.#ayahs; }
  get analyzedBy() { return this.#analyzedBy; }
  get recordingId() { return this.#recordingId; }
  get timestamp() { return new Date(this.#timestamp); }
  get duration() { return this.#duration; }
  get status() { return this.#status; }
  set status(value) { this.#status = value; }
  getAudioData() { return this.#audioData; }

  async requestMicPermission() {
    if (this.#stream) return true;
    const version = ++this.#permissionVersion;
    this.#status = 'requesting';
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        throw new Error('Microphone capture unavailable');
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (version !== this.#permissionVersion) {
        stream.getTracks().forEach(track => track.stop());
        return false;
      }
      this.#stream = stream;
      this.permissionError = '';
      this.#status = 'permitted';
      return true;
    } catch (error) {
      if (version === this.#permissionVersion) {
        this.permissionError = ['NotAllowedError', 'SecurityError'].includes(error.name) ? 'mic_denied' : 'mic_unavailable';
        this.#status = 'error';
      }
      return false;
    }
  }

  #connectMeter() {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    try {
      this.#context = new Context();
      this.#analyser = this.#context.createAnalyser();
      this.#analyser.fftSize = 512;
      this.#samples = new Uint8Array(this.#analyser.fftSize);
      this.#context.createMediaStreamSource(this.#stream).connect(this.#analyser);
      void this.#context.resume().catch(() => {});
    } catch { this.#analyser = null; }
  }

  get level() {
    if (!this.#analyser || this.#status !== 'recording') return 0;
    this.#analyser.getByteTimeDomainData(this.#samples);
    let sum = 0;
    for (const sample of this.#samples) sum += ((sample - 128) / 128) ** 2;
    return Math.min(1, 4 * Math.sqrt(sum / this.#samples.length));
  }

  #releaseMic() {
    const recorder = this.#recorder;
    if (recorder) {
      recorder.ondataavailable = recorder.onstop = recorder.onerror = null;
      if (recorder.state !== 'inactive') recorder.stop();
    }
    this.#stream?.getTracks().forEach(track => track.stop());
    if (this.#context && this.#context.state !== 'closed') void this.#context.close().catch(() => {});
    this.#stream = this.#recorder = this.#context = this.#analyser = this.#samples = null;
  }

  startRecord(onFailure = () => {}) {
    if (!this.#stream || this.#recorder) throw new Error('mic_unavailable');
    try {
      const recorder = this.#recorder = new MediaRecorder(this.#stream, recordingOptions());
      const chunks = [];
      let size = 0;
      const fail = code => {
        const pending = this.#pendingStop;
        this.#pendingStop = null;
        this.#releaseMic();
        this.#status = 'error';
        if (pending) pending.reject(new Error(code));
        else onFailure(code);
      };
      recorder.ondataavailable = ({ data }) => {
        if (!data.size) return;
        size += data.size;
        const elapsed = (this.#pendingStop?.time ?? performance.now()) - this.#startedAt;
        if (size > MAX_BYTES) fail('too_large');
        else if (elapsed > MAX_SECONDS * 1000) fail('too_long');
        else chunks.push(data);
      };
      recorder.onerror = () => fail('mic_unavailable');
      recorder.onstop = () => {
        const pending = this.#pendingStop;
        if (!pending) return fail('mic_unavailable');
        const seconds = (pending.time - this.#startedAt) / 1000;
        if (seconds > MAX_SECONDS) return fail('too_long');
        const blob = new Blob(chunks, { type: chunks[0]?.type || recorder.mimeType });
        if (!blob.size) return fail('invalid_audio');
        this.#pendingStop = null;
        this.#releaseMic();
        this.setAudioData(blob, seconds);
        pending.resolve(blob);
      };
      this.#connectMeter();
      this.#startedAt = performance.now();
      recorder.start(250);
      this.#status = 'recording';
    } catch {
      this.#releaseMic();
      this.#status = 'error';
      throw new Error('mic_unavailable');
    }
  }

  async stopRecord() {
    if (this.#pendingStop) return this.#pendingStop.promise;
    if (this.#recorder?.state !== 'recording') throw new Error('mic_unavailable');
    const pending = { time: performance.now() };
    pending.promise = new Promise((resolve, reject) => {
      pending.resolve = resolve;
      pending.reject = reject;
    });
    this.#pendingStop = pending;
    this.#status = 'stopping';
    try { this.#recorder.stop(); }
    catch {
      this.#pendingStop = null;
      this.#releaseMic();
      this.#status = 'error';
      throw new Error('mic_unavailable');
    }
    return pending.promise;
  }

  cancelCapture() {
    this.#permissionVersion++;
    const pending = this.#pendingStop;
    this.#pendingStop = null;
    this.#releaseMic();
    this.#status = this.#audioData ? 'captured' : 'idle';
    pending?.reject(new DOMException('Capture cancelled', 'AbortError'));
  }

  setAudioData(blob, seconds = 0) {
    if (blob?.size > MAX_BYTES) throw new Error('too_large');
    if (!blob?.size) throw new Error('invalid_audio');
    this.stopPlayback();
    if (this.#url) URL.revokeObjectURL(this.#url);
    this.#url = URL.createObjectURL(blob);
    this.#audioData = blob;
    this.analysisResult = null;
    this.#duration = seconds;
    this.#status = 'captured';
  }

  async measureDuration(signal) {
    if (this.#duration || !this.#url) return this.#duration;
    // Browser recordings can omit metadata. The server checks decoded duration independently.
    const url = this.#url;
    const seconds = await new Promise(resolve => {
      const audio = new Audio();
      const finish = (seconds = 0) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        audio.onloadedmetadata = audio.onerror = null;
        audio.removeAttribute('src');
        audio.load();
        resolve(seconds);
      };
      const cancel = () => finish();
      const timer = setTimeout(cancel, 1500);
      signal.addEventListener('abort', cancel, { once: true });
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => finish(Number.isFinite(audio.duration) ? audio.duration : 0);
      audio.onerror = cancel;
      audio.src = url;
      if (signal.aborted) cancel();
    });
    if (this.#url === url && !signal.aborted) this.#duration = seconds;
    return this.#duration;
  }

  async play(start = 0, end = Infinity) {
    this.stopPlayback();
    const audio = audioClip(this.#url, start, end);
    if (!audio) return false;
    this.#player = audio;
    try {
      await audio.play();
      return this.#player === audio;
    } catch {
      if (this.#player === audio) this.stopPlayback();
      return false;
    }
  }

  stopPlayback() {
    releaseAudio(this.#player);
    this.#player = null;
  }

  dispose() {
    this.cancelCapture();
    this.stopPlayback();
    if (this.#url) URL.revokeObjectURL(this.#url);
    this.#url = this.#audioData = this.analysisResult = null;
    this.#duration = 0;
    this.#status = 'discarded';
  }
}

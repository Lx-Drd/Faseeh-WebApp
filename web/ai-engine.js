import { PronunciationError } from './word-study.js';
import { MAX_SECONDS } from './audio-recording.js';

const RETRYABLE = new Set(["busy", "unavailable", "no_connection"]);
const ERROR_CODES = new Set([
  "busy", "unavailable", "too_long", "too_large", "no_voice", "mismatch",
  "invalid_audio", "invalid_selection", "invalid_request", "no_connection",
]);

function safeEndpoint(value) {
  const url = new URL(value, document.baseURI);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || (url.protocol !== "https:" && !(local && url.protocol === "http:"))) {
    throw new Error("Analysis endpoints require HTTPS or loopback HTTP");
  }
  return url.href;
}

function apiError(response, body) {
  if (ERROR_CODES.has(body?.code)) return body.code;
  if (response.status === 429) return "busy";
  if (response.status === 413) return "too_large";
  if (response.status === 415 || response.status === 422) return "invalid_audio";
  return response.status >= 500 || response.status === 404 ? "unavailable" : "invalid_request";
}

function validResult(result, selection) {
  return result && Number(result.surah) === Number(selection.surah)
    && Number(result.startAyah) === Number(selection.startAyah)
    && Number.isInteger(result.endAyah) && result.endAyah >= Number(selection.startAyah)
    && result.endAyah <= Number(selection.endAyah) && Array.isArray(result.errors)
    && Array.isArray(result.wordTimings) && Number.isInteger(result.totalWords)
    && result.totalWords > 0 && Number.isInteger(result.correctWords)
    && result.correctWords >= 0 && result.correctWords <= result.totalWords
    && Number.isFinite(result.percentage) && result.percentage >= 0 && result.percentage <= 100;
}

/** Browser boundary of the pretrained inference service, including its configured replicas. */
export class AIEngine {
  #serverUrl;
  #fallbackUrls;

  constructor(serverUrl = '/api/analyze', fallbackUrls = []) {
    const urls = [...new Set([serverUrl, ...fallbackUrls].map(safeEndpoint))];
    [this.#serverUrl, ...this.#fallbackUrls] = urls;
  }

  get serverUrl() { return this.#serverUrl; }

  async detectErrors(recording, { signal = new AbortController().signal, consent = false, contributorName = '' } = {}) {
    if (recording.analyzedBy !== this) throw new TypeError('Recording belongs to another analysis engine.');
    if (navigator.onLine === false) throw new Error('no_connection');
    const file = recording.getAudioData();
    if (!file) throw new Error('invalid_audio');
    const ayahs = recording.ayahs;
    const range = { surah: ayahs[0].surahNumber, startAyah: ayahs[0].ayahNumber, endAyah: ayahs.at(-1).ayahNumber };
    const form = new FormData();
    const extension = file.type.includes('mp4') ? 'm4a' : file.type.includes('ogg') ? 'ogg' : 'webm';
    form.append('file', file, file.name || 'recitation.' + extension);
    for (const [key, value] of Object.entries(range)) form.append(key, String(value));
    if (consent) {
      form.append('consent', 'true');
      if (contributorName) form.append('contributorName', contributorName);
    }

    let code = 'unavailable';
    for (const url of [this.#serverUrl, ...this.#fallbackUrls]) {
      signal.throwIfAborted();
      const attempt = new AbortController();
      const abort = () => attempt.abort();
      signal.addEventListener('abort', abort, { once: true });
      const deadline = setTimeout(abort, Math.max(120, (recording.duration || MAX_SECONDS) * 6) * 1000);
      try {
        const response = await fetch(url, {
          method: 'POST', body: form, credentials: 'omit', redirect: 'error', signal: attempt.signal,
        });
        const body = await response.json().catch(() => null);
        signal.throwIfAborted();
        if (response.ok && validResult(body, range)) {
          const errors = body.errors.map(finding => {
            const ayah = ayahs[finding.ayah - range.startAyah];
            if (!ayah || ayah.ayahNumber !== finding.ayah || finding.ayah > body.endAyah ||
                !Number.isInteger(finding.wordIndex) || finding.wordIndex < 0 ||
                (ayah.words.length && finding.wordIndex >= ayah.words.length)) {
              throw new Error('Invalid finding in analysis response.');
            }
            return new PronunciationError(ayah, this, finding);
          });
          recording.analysisResult = body;
          return errors;
        }
        code = response.ok ? 'unavailable' : apiError(response, body);
      } catch {
        signal.throwIfAborted();
        code = navigator.onLine === false ? 'no_connection' : 'unavailable';
      } finally {
        clearTimeout(deadline);
        signal.removeEventListener('abort', abort);
      }
      if (!RETRYABLE.has(code) || code === 'no_connection') break;
    }
    throw new Error(code);
  }
}

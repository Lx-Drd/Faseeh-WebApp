const MAX_BYTES = 25_000_000;
const MAX_SECONDS = 330;
const SPEED_KEY = "faseeh.analysisSecondsPerAudioSecond";
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

function recordingOptions() {
  const types = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"];
  const mimeType = types.find(type => MediaRecorder.isTypeSupported?.(type));
  return mimeType ? { mimeType } : {};
}

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

// Some MediaRecorder files omit duration metadata. The server enforces the
// full decoded duration even when the browser has no duration estimate.
function mediaDuration(url, signal) {
  return new Promise(resolve => {
    const audio = new Audio();
    function finish(seconds = 0) {
      clearTimeout(timeout);
      signal.removeEventListener("abort", cancel);
      audio.onloadedmetadata = audio.onerror = null;
      audio.removeAttribute("src");
      audio.load();
      resolve(seconds);
    }
    const cancel = () => finish();
    const timeout = setTimeout(cancel, 1500);
    signal.addEventListener("abort", cancel, { once: true });
    audio.preload = "metadata";
    audio.onloadedmetadata = () => finish(Number.isFinite(audio.duration) ? audio.duration : 0);
    audio.onerror = cancel;
    audio.src = url;
    if (signal.aborted) cancel();
  });
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

export function createSession({
  getSelection, t = key => key, onState = () => {}, onResult = () => {},
  onReset = () => {}, endpoints = ["/api/analyze"], allowConsent = false,
}) {
  const servers = [...new Set(endpoints.map(safeEndpoint))];
  let generation = 0, phase = "idle", messageKey = "";
  let stream, recorder, context, analyser, samples, timer, controller;
  let blob, blobUrl, duration = 0, startTime = 0, range, estimate = null;
  let stoppedAt = null;
  let player, clipTimer, consent = false, contributor = "";
  let lastElapsed = 0;

  function emit() {
    const timed = phase === "recording" || phase === "analyzing";
    const elapsed = timed ? Math.floor((performance.now() - startTime) / 1000) : lastElapsed;
    let level = 0;
    if (analyser && phase === "recording") {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
      level = Math.min(1, 4 * Math.sqrt(sum / samples.length));
    }
    onState({ phase, elapsed, estimate, level, hasRecording: Boolean(blobUrl),
      messageKey, message: messageKey ? t(messageKey) : "" });
  }

  function setPhase(next, error = "") {
    clearInterval(timer);
    phase = next;
    messageKey = error;
    if (phase === "recording" || phase === "analyzing") {
      startTime = performance.now();
      timer = setInterval(emit, phase === "recording" ? 150 : 500);
    }
    emit();
  }

  function stopPlayback() {
    clearTimeout(clipTimer);
    if (player) {
      player.onloadedmetadata = player.ontimeupdate = player.onended = player.onerror = null;
      player.pause();
      player.removeAttribute("src");
      player.load();
      player = null;
    }
  }

  function releaseMic() {
    if (recorder) {
      recorder.ondataavailable = recorder.onstop = recorder.onerror = null;
      if (recorder.state !== "inactive") recorder.stop();
      recorder = null;
    }
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    if (context && context.state !== "closed") void context.close().catch(() => {});
    context = analyser = samples = null;
  }

  function cancel() {
    generation++;
    controller?.abort();
    controller = null;
    releaseMic();
    estimate = null;
    lastElapsed = 0;
    setPhase("idle");
  }

  function reset() {
    stopPlayback();
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blob = blobUrl = range = null;
    duration = 0;
    stoppedAt = null;
    cancel();
    onReset();
  }

  function setAudio(file, seconds) {
    blob = file;
    blobUrl = URL.createObjectURL(file);
    duration = seconds || 0;
  }

  async function analyze(token) {
    if (!blob || token !== generation) return;
    if (navigator.onLine === false) return setPhase("error", "no_connection");
    controller = new AbortController();
    const operation = controller;
    const speed = previousSpeed();
    estimate = duration && speed ? Math.max(1, Math.round(duration * speed)) : null;
    setPhase("analyzing");
    if (!duration) {
      const seconds = await mediaDuration(blobUrl, operation.signal);
      if (token !== generation) return;
      duration = seconds;
      if (duration > MAX_SECONDS) return setPhase("error", "too_long");
      estimate = duration && speed ? Math.max(1, Math.round(duration * speed)) : null;
      emit();
    }
    const form = new FormData();
    const extension = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
    form.append("file", blob, blob.name || "recitation." + extension);
    for (const key of ["surah", "startAyah", "endAyah"]) form.append(key, String(range[key]));
    if (allowConsent && consent) {
      form.append("consent", "true");
      if (contributor) form.append("contributorName", contributor);
    }
    let error = "unavailable";
    for (const url of servers) {
      const attempt = new AbortController();
      const abort = () => attempt.abort();
      operation.signal.addEventListener("abort", abort, { once: true });
      const deadline = setTimeout(abort, Math.max(120, (duration || MAX_SECONDS) * 6) * 1000);
      let result;
      try {
        const response = await fetch(url, {
          method: "POST", body: form, credentials: "omit", signal: attempt.signal, redirect: "error",
        });
        const body = await response.json().catch(() => null);
        if (token !== generation) return;
        if (response.ok && validResult(body, range)) result = body;
        else error = response.ok ? "unavailable" : apiError(response, body);
      } catch {
        if (token !== generation) return;
        error = navigator.onLine === false ? "no_connection" : "unavailable";
      } finally {
        clearTimeout(deadline);
        operation.signal.removeEventListener("abort", abort);
      }
      if (result) {
        const elapsed = (performance.now() - startTime) / 1000;
        rememberSpeed(elapsed, duration);
        lastElapsed = Math.floor(elapsed);
        controller = null;
        setPhase("ready");
        onResult(result);
        return;
      }
      if (!RETRYABLE.has(error) || error === "no_connection") break;
    }
    if (token === generation) {
      controller = null;
      setPhase("error", error);
    }
  }

  async function upload(file) {
    if (!file) return;
    reset();
    range = { ...getSelection() };
    if (file.size > MAX_BYTES) return setPhase("error", "too_large");
    if (!file.size) return setPhase("error", "invalid_audio");
    setAudio(file, 0);
    await analyze(generation);
  }

  async function start() {
    if (phase === "requesting" || phase === "recording" || phase === "analyzing") return;
    reset();
    const token = generation;
    range = { ...getSelection() };
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      return setPhase("error", "mic_unavailable");
    }
    setPhase("requesting");
    try {
      const granted = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (token !== generation) {
        granted.getTracks().forEach(track => track.stop());
        return;
      }
      stream = granted;
      recorder = new MediaRecorder(stream, recordingOptions());
      const chunks = [];
      let size = 0;
      const mime = recorder.mimeType;
      recorder.ondataavailable = event => {
        if (generation !== token || !event.data.size) return;
        size += event.data.size;
        if (size > MAX_BYTES || (stoppedAt ?? performance.now()) - startTime > MAX_SECONDS * 1000) {
          cancel();
          setPhase("error", size > MAX_BYTES ? "too_large" : "too_long");
        } else chunks.push(event.data);
      };
      recorder.onerror = () => { cancel(); setPhase("error", "mic_unavailable"); };
      recorder.onstop = () => {
        if (generation !== token) return;
        if (stoppedAt === null) {
          releaseMic();
          return setPhase("error", "mic_unavailable");
        }
        const seconds = (stoppedAt - startTime) / 1000;
        const file = new Blob(chunks, { type: chunks[0]?.type || mime });
        releaseMic();
        if (!file.size) return setPhase("error", "invalid_audio");
        if (seconds > MAX_SECONDS) return setPhase("error", "too_long");
        setAudio(file, seconds);
        void analyze(token);
      };
      const AudioContextType = window.AudioContext || window.webkitAudioContext;
      if (AudioContextType) {
        try {
          context = new AudioContextType();
          analyser = context.createAnalyser();
          analyser.fftSize = 512;
          samples = new Uint8Array(analyser.fftSize);
          context.createMediaStreamSource(stream).connect(analyser);
          void context.resume().catch(() => {});
        } catch { analyser = null; }
      }
      recorder.start(250);
      setPhase("recording");
    } catch (err) {
      if (token !== generation) return;
      releaseMic();
      setPhase("error", ["NotAllowedError", "SecurityError"].includes(err.name) ? "mic_denied" : "mic_unavailable");
    }
  }

  function stop() {
    if (recorder?.state === "recording") {
      stoppedAt = performance.now();
      recorder.stop();
    }
  }

  async function play(start = 0, end = Infinity) {
    stopPlayback();
    if (!blobUrl || !Number.isFinite(start) || start < 0 || !(end > start)) return false;
    const audio = new Audio(blobUrl);
    player = audio;
    const stopAtEnd = () => {
      if (player === audio && audio.currentTime >= end) stopPlayback();
    };
    audio.ontimeupdate = stopAtEnd;
    audio.onended = () => { if (player === audio) stopPlayback(); };
    try {
      audio.currentTime = start;
      await audio.play();
      if (player !== audio) return false;
      // Recheck currentTime during buffering instead of ending the clip early.
      if (Number.isFinite(end)) {
        const schedule = () => {
          if (player !== audio) return;
          stopAtEnd();
          if (player === audio) clipTimer = setTimeout(schedule, Math.max(30, (end - audio.currentTime) * 1000));
        };
        schedule();
      }
      return true;
    } catch {
      if (player === audio) {
        stopPlayback();
        messageKey = "playback_unavailable";
        emit();
      }
      return false;
    }
  }

  return { start, stop, upload, cancel, reset, play, stopPlayback, destroy: reset,
    setConsent(value, name = "") { consent = Boolean(value); contributor = String(name).trim().slice(0, 80); },
    refresh: emit,
  };
}

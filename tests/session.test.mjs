import test from "node:test";
import assert from "node:assert/strict";
import { createSession } from "../web/session.js";

const range = { surah: 112, startAyah: 1, endAyah: 2 };
const success = { ...range, endAyah: 1, errors: [], wordTimings: [], correctWords: 4, totalWords: 4, percentage: 100 };
const blob = () => new Blob(["test"], { type: "audio/webm" });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

function fixture(overrides = {}) {
  globalThis.document = { baseURI: "http://localhost/" };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
  globalThis.Audio = class {
    duration = 2;
    set src(value) { if (value) queueMicrotask(() => this.onloadedmetadata?.()); }
    removeAttribute() {}
    load() {}
  };
  const result = [], states = [];
  const session = createSession({ getSelection: () => range, onResult: r => result.push(r),
    onState: s => states.push(s), endpoints: ["/api/analyze", "https://secondary.example/api/analyze"],
    ...overrides });
  return { session, states, result };
}

test("tries fallback on busy, sends inclusive range, and omits identifying data by default", async () => {
  const { session, result, states } = fixture();
  const urls = [];
  globalThis.fetch = async (url, options) => {
    urls.push(url);
    assert.equal(options.body.get("startAyah"), "1");
    assert.equal(options.body.get("endAyah"), "2");
    assert.equal(options.body.get("consent"), null);
    assert.equal(options.body.get("contributorName"), null);
    assert.equal(options.body.get("file").size, blob().size);
    return urls.length === 1 ? json({ code: "busy" }, 429) : json(success);
  };
  try {
    session.setConsent(true, "name");
    await session.upload(blob());
    assert.equal(urls.length, 2);
    assert.deepEqual(result, [success]);
    assert.equal(states.at(-1).phase, "ready");
    assert.equal(session.recording.status, "analyzed");
  } finally { session.destroy(); }
});

test("refusal and size limits produce no result and never retry content failures", async () => {
  const { session, states, result } = fixture();
  let calls = 0;
  globalThis.fetch = async () => { calls++; return json({ code: "mismatch" }, 422); };
  try {
    await session.upload(blob());
    assert.equal(states.at(-1).messageKey, "mismatch");
    assert.equal(session.recording.status, "error");
    await session.upload({ size: 25_000_000 + 1 });
    assert.equal(states.at(-1).messageKey, "too_large");
    assert.deepEqual(result, []);
    assert.equal(calls, 1);
  } finally { session.destroy(); }
});

test("selection reset aborts analysis and suppresses a late response", async () => {
  const { session, result, states } = fixture();
  let finishRequest, signal, markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  globalThis.fetch = (url, options) => new Promise(resolve => {
    finishRequest = resolve; signal = options.signal; markStarted();
  });
  const upload = session.upload(blob());
  await started;
  const previousRecording = session.recording;
  assert.equal(previousRecording.status, "analyzing");
  session.reset();
  assert.equal(signal.aborted, true);
  finishRequest(json(success));
  await upload;
  assert.equal(previousRecording.status, "discarded");
  assert.equal(states.at(-1).hasRecording, false);
  assert.deepEqual(result, []);
});

test("cancel during microphone permission releases any subsequently granted stream", async () => {
  const { session, states } = fixture();
  let grant, stopped = false;
  globalThis.MediaRecorder = class {};
  navigator.mediaDevices = { getUserMedia: () => new Promise(resolve => { grant = resolve; }) };
  const pending = session.start();
  assert.equal(states.at(-1).phase, "requesting");
  session.cancel();
  grant({ getTracks: () => [{ stop() { stopped = true; } }] });
  await pending;
  assert.equal(stopped, true);
  assert.equal(states.at(-1).phase, "idle");
});

test("refuses off-machine HTTP endpoints", () => {
  assert.throws(() => fixture({ endpoints: ["http://not-local.example/api/analyze"] }), /HTTPS/);
});

test("checks duration from metadata before sending an upload", async () => {
  const { session, states } = fixture();
  globalThis.Audio = class {
    duration = 331;
    set src(value) { if (value) queueMicrotask(() => this.onloadedmetadata?.()); }
    removeAttribute() {}
    load() {}
  };
  let sent = false;
  globalThis.fetch = async () => { sent = true; return json(success); };
  try {
    await session.upload(blob());
    assert.equal(states.at(-1).messageKey, "too_long");
    assert.equal(sent, false);
  } finally { session.destroy(); }
});

test("sends contributor name only with available storage and explicit consent", async () => {
  const { session, result } = fixture({ allowConsent: true });
  globalThis.fetch = async (url, options) => {
    assert.equal(options.body.get("consent"), "true");
    assert.equal(options.body.get("contributorName"), "User");
    return json(success);
  };
  try {
    session.setConsent(true, "  User  ");
    await session.upload(blob());
    assert.deepEqual(result, [success]);
  } finally { session.destroy(); }
});

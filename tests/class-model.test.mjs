import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Ayah, Surah } from '../web/library.js';
import { User } from '../web/user.js';
import { AudioRecording } from '../web/audio-recording.js';
import { AIEngine } from '../web/ai-engine.js';
import { PronunciationError, PhoneticTranscription, ArticulationGuide, ExpertAudio } from '../web/word-study.js';
import { CorrectionInterface } from '../web/correction.js';

const catalog = JSON.parse(readFileSync(new URL('../web/data/surahs.json', import.meta.url)));
const ikhlas = new Surah(catalog.find(surah => surah.id === 112));
globalThis.document = { baseURI: 'http://localhost/' };

test('Surah.loadFromFile composes the actual ayahs and selects the same instances inclusively', async t => {
  t.mock.method(globalThis, 'fetch', async path => {
    assert.equal(path, '/data/surahs.json');
    return Response.json(catalog);
  });
  const all = await Surah.loadFromFile('/data/surahs.json');
  assert.equal(all.length, 7);
  const surah = all.find(s => s.surahNumber === 112);
  assert.equal(surah.nameEnglish, 'Al-Ikhlas');
  assert.equal(surah.nameArabic, 'الإخلاص');
  const [second, third] = surah.getAyahRange(2, 3);
  assert.ok(second instanceof Ayah);
  assert.equal(third, surah.getAyahList()[2]);
  assert.equal(second.getUthmaniText(), catalog.find(s => s.id === 112).ayahs[1].text);
  assert.ok(second.getTransliteration().length > 0);
  assert.throws(() => surah.getAyahRange(3, 2), RangeError);
  assert.throws(() => new Surah({ ...catalog[0], ayahs: [] }), RangeError);
});

test('a user remembers preferences and can own several independent recordings of overlapping ayahs', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: key => store.get(key), setItem: (key, value) => store.set(key, value) };
  try {
    const engine = new AIEngine();
    const user = new User(engine);
    user.setLanguage('ar');
    user.toggleAdvancedRules();
    user.toggleTransliteration();
    const restored = new User(engine);
    assert.equal(restored.preferredLanguage, 'ar');
    assert.equal(restored.advancedRulesEnabled, false);
    assert.equal(restored.transliterationEnabled, true);
    assert.notEqual(restored.userId, user.userId);
    const a = user.createRecording(ikhlas.getAyahRange(1, 2));
    const b = user.createRecording(ikhlas.getAyahRange(2, 3));
    assert.ok(a instanceof AudioRecording);
    assert.equal(a.user, user);
    assert.equal(a.analyzedBy, engine);
    assert.equal(a.ayahs[1], b.ayahs[0]);
    assert.notEqual(a.recordingId, b.recordingId);
    assert.ok(a.timestamp instanceof Date);
    assert.throws(() => user.createRecording([]), RangeError);
    assert.throws(() => user.createRecording([a.ayahs[0], b.ayahs[1]]), RangeError);
  } finally { delete globalThis.localStorage; }
});

test('selected ayahs retry unavailable or incomplete references and share the successful catalog fetch', async t => {
  const [first, second] = ikhlas.getAyahRange(1, 2);
  const references = JSON.parse(readFileSync(new URL('../web/data/phonetics.json', import.meta.url)));
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    assert.ok(url.pathname.endsWith('/data/phonetics.json'));
    requests++;
    if (requests === 1) return new Response(null, { status: 503 });
    return Response.json(requests === 2 ? {} : references);
  });
  await assert.rejects(first.loadReferenceData(), /Cannot load/);
  await assert.rejects(first.loadReferenceData(), /Missing phonetic reference/);
  await Promise.all([first.loadReferenceData(), second.loadReferenceData()]);
  await first.loadReferenceData();
  assert.equal(requests, 3);
  assert.equal(first.getReferencePhonetic(1), references['112:1'][1]);
  assert.equal(second.getReferencePhonetic(0), references['112:2'][0]);
});

test('the engine returns located errors and a card composes its own three study objects for correction and lookup', async t => {
  const engine = new AIEngine('/api/analyze');
  const ayahs = ikhlas.getAyahRange(1, 2);
  const take = new User(engine).createRecording(ayahs);
  const file = new Blob(['audio fixture'], { type: 'audio/webm' });
  take.setAudioData(file, 3);
  assert.equal(take.getAudioData(), file);
  const body = { surah: 112, startAyah: 1, endAyah: 1, totalWords: 4, correctWords: 3, percentage: 75,
    wordTimings: [], errors: [
      { ayah: 1, wordIndex: 3, type: 'pronunciation', letter: 'ح', phonetic: 'أَحَدْ' },
      { ayah: 1, wordIndex: 3, type: 'vowel', letter: 'د' },
    ] };
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    assert.equal(url, engine.serverUrl);
    assert.equal(request.body.get('endAyah'), '2');
    return Response.json(body);
  });
  try {
    take.setStatus('analyzing');
    const [issue, other] = await engine.detectErrors(take);
    assert.ok(issue instanceof PronunciationError);
    assert.equal(issue.detectedBy, engine);
    assert.equal(issue.ayah, ayahs[0]);
    assert.ok(issue.errorId);
    assert.equal(issue.mispronouncedWord, ayahs[0].words[3].text);
    assert.equal(issue.positionIndex, 3);
    assert.equal(issue.errorType, 'pronunciation');
    assert.notEqual(issue.getRuleExplanation('ar'), issue.getRuleExplanation('en'));
    assert.equal(take.analysisResult.endAyah, 1);
    assert.equal(take.status, 'analyzing', 'The session marks completion after the engine returns.');
    const view = issue.correctionInterface;
    assert.ok(view instanceof CorrectionInterface);
    assert.notEqual(view.interfaceId, other.correctionInterface.interfaceId);
    for (const finding of [issue, other]) {
      const card = finding.correctionInterface;
      assert.equal(card.isUnifiedView, false);
      assert.ok(!card.phoneticTranscription && !card.articulationGuide && !card.expertAudio);
    }
    view.attach({}, { language: 'en' });
    view.loadErrorDetails(issue);
    assert.equal(view.ayah, ayahs[0]);
    assert.equal(view.error, issue);
    assert.equal(view.word, issue.mispronouncedWord);
    assert.equal(view.letter, 'ح');
    assert.ok(view.phoneticTranscription instanceof PhoneticTranscription);
    assert.equal(view.phoneticTranscription.getPhoneticText(), 'أَحَدْ');
    assert.ok(view.articulationGuide instanceof ArticulationGuide);
    assert.ok(view.articulationGuide.getAnatomicalDescription());
    assert.ok(view.expertAudio instanceof ExpertAudio);
    assert.ok(view.expertAudio.getReciterName().includes('Minshawi'));
    assert.equal(view.expertAudio.hasWordClip, true);
    const lookup = new CorrectionInterface();
    lookup.loadWordDetails(ayahs[1], 0, 'ل');
    assert.equal(lookup.error, null);
    assert.equal(lookup.letter, 'ل');
    assert.equal(lookup.ayah, ayahs[1]);
    assert.equal(view.error, issue);
    assert.equal(other.correctionInterface.ayah, null);
  } finally { take.dispose(); }
});

test('stopRecord resolves with the same complete Blob returned by getAudioData and releases the microphone', async () => {
  let released = false;
  const stream = { getTracks: () => [{ stop() { released = true; } }] };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => stream } } });
  globalThis.window = {};
  globalThis.MediaRecorder = class {
    state = 'inactive';
    mimeType = 'audio/webm';
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      queueMicrotask(() => {
        this.ondataavailable?.({ data: new Blob(['complete audio'], { type: this.mimeType }) });
        this.onstop?.();
      });
    }
  };
  const take = new User(new AIEngine()).createRecording(ikhlas.getAyahRange(1, 1));
  try {
    assert.equal(await take.requestMicPermission(), true);
    take.startRecord();
    assert.equal(take.status, 'recording');
    const completed = await take.stopRecord();
    assert.equal(completed, take.getAudioData());
    assert.equal(await completed.text(), 'complete audio');
    assert.ok(take.duration >= 0);
    assert.equal(take.status, 'recorded');
    assert.equal(released, true);
  } finally { take.dispose(); }
});

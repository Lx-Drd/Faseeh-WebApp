"""Run with python3 tests/browser_flow.py (Playwright + Chromium).

Serves the real static reader on a temporary loopback port. The analysis
responses below are test fixtures. This exercises the UI and server failover;
it does not evaluate the model's pronunciation accuracy.
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
import math
import os
from pathlib import Path
import shutil
import struct
from threading import Thread
import wave

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
RTL = {"ar", "ur", "fa", "ps", "pa"}
LANGUAGES = RTL | {"en", "es", "fr", "zh", "id", "bn", "tr", "ha"}


class StaticHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


def sample_wav():
    buffer = BytesIO()
    with wave.open(buffer, "wb") as output:
        output.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
        output.writeframes(b"".join(
            struct.pack("<h", int(3276 * math.sin(2 * math.pi * 220 * frame / 16000)))
            for frame in range(16000)
        ))
    return {"name": "ui-test.wav", "mimeType": "audio/wav", "buffer": buffer.getvalue()}


def check_reference_retry(page, origin):
    requests = []

    def reference(route):
        requests.append(route)
        if len(requests) == 1:
            route.fulfill(status=503)

    page.route("**/data/phonetics.json", reference)
    page.goto(origin, wait_until="domcontentloaded")
    expect(page.locator("#retry-reference")).to_be_visible()
    expect(page.locator("#record")).to_be_disabled()
    page.locator("#retry-reference").click()
    page.locator("#to-ayah").select_option("2")
    page.locator("#from-ayah").select_option("2")
    expect(page.locator("#verses")).to_have_attribute("aria-busy", "true")
    expect(page.locator("#verses .word")).to_have_count(0)
    expect(page.locator("#upload")).to_be_disabled()
    expect(page.locator("#listen")).to_be_disabled()
    assert len(requests) == 2
    requests[1].continue_()
    expect(page.locator(".selected-ayah .ayah-ref")).to_have_text("112:2")
    expect(page.locator("#record")).to_be_enabled()
    expect(page.locator("#verses")).to_have_attribute("aria-busy", "false")
    assert len(requests) == 2
    page.unroute("**/data/phonetics.json", reference)


def trace_interactions(page):
    page.evaluate("""async () => {
      const {Surah, Ayah} = await import('/library.js');
      const {User} = await import('/user.js');
      const {AudioRecording} = await import('/audio-recording.js');
      const {AIEngine} = await import('/ai-engine.js');
      const {CorrectionInterface} = await import('/correction.js');
      const {PhoneticTranscription, ArticulationGuide, ExpertAudio, PronunciationError} = await import('/word-study.js');
      window.calls = [];
      function trace(Type, name, detail = () => '') {
        const original = Type.prototype[name];
        Type.prototype[name] = function(...args) {
          window.calls.push(name + detail.call(this, ...args));
          return original.apply(this, args);
        };
      }
      trace(Surah, 'getAyahRange', (from, to) => ' ' + from + '-' + to);
      for (const name of ['loadReferenceData', 'getUthmaniText']) {
        trace(Ayah, name, function() { return ' ' + this.ayahNumber; });
      }
      trace(User, 'createRecording');
      for (const name of ['requestMicPermission', 'startRecord', 'stopRecord', 'getAudioData']) trace(AudioRecording, name);
      trace(AudioRecording, 'setStatus', value => ' ' + value);
      const detect = AIEngine.prototype.detectErrors;
      AIEngine.prototype.detectErrors = async function(recording, options) {
        window.calls.push('detectErrors ' + recording.status + ' ' + document.querySelector('#practice-state').textContent);
        const errors = await detect.call(this, recording, options);
        window.cardIds = errors.map(error => error.correctionInterface.interfaceId);
        window.calls.push('return ' + errors.length + ' errors');
        return errors;
      };
      const send = window.fetch;
      window.fetch = (...args) => {
        if (args[1]?.method === 'POST') window.calls.push('send audio');
        return send(...args);
      };
      trace(CorrectionInterface, 'loadErrorDetails');
      trace(CorrectionInterface, 'renderUnifiedFeedback');
      trace(PhoneticTranscription, 'getPhoneticText');
      trace(ArticulationGuide, 'getArticulationImage');
      trace(ArticulationGuide, 'getAnatomicalDescription');
      trace(ExpertAudio, 'getReciterName');
      trace(PronunciationError, 'getRuleExplanation', language => ' ' + language);
    }""")


def run(page, origin):
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    posts = []
    outcome = "ok"

    def analysis_response(route):
        path = route.request.url.split("/")[-1]
        posts.append(path)
        assert route.request.method == "POST"
        form = route.request.post_data_buffer
        for key, value in [("surah", 112), ("startAyah", 1), ("endAyah", 2)]:
            assert f'name="{key}"\r\n\r\n{value}\r\n'.encode() in form
        if path == "test-primary":
            code = "mismatch" if outcome == "mismatch" else "busy"
            route.fulfill(status=503 if code == "busy" else 422, json={"code": code})
        else:
            issues = [
                {"ayah": 1, "wordIndex": 1, "letter": "ه", "type": "pronunciation"},
                {"ayah": 1, "wordIndex": 1, "letter": "و", "type": "vowel"},
            ] if outcome == "correction" else []
            correct = 4 - len({issue["wordIndex"] for issue in issues})
            route.fulfill(json={"surah": 112, "startAyah": 1, "endAyah": 1,
                "correctWords": correct, "totalWords": 4, "percentage": correct * 25, "errors": issues,
                "wordTimings": [{"ayah": 1, "wordIndex": i, "start": i / 4, "end": (i+1)/4}
                                for i in range(4)]})

    page.route("**/config.js", lambda route: route.fulfill(
        content_type="application/javascript",
        body='window.FASEEH_CONFIG={analysisEndpoints:["/test-primary","/test-secondary"]};'))
    page.route("**/test-primary", analysis_response)
    page.route("**/test-secondary", analysis_response)
    page.add_init_script("""const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function(...args) {
      this.addEventListener('playing', () => {
        if (this.currentSrc.startsWith('blob:')) {
          window.userRecordingPlayed = true;
          window.lastRecordingStart = this.currentTime;
        }
        if (this.currentSrc.includes('/audio/')) window.expertPlayed = true;
      }, { once: true });
      return play.apply(this, args);
    };""")
    page.goto(origin)
    language = page.locator("#language")
    expect(language.locator("option")).to_have_count(13)
    assert set(language.locator("option").evaluate_all("opts => opts.map(o => o.value)")) == LANGUAGES
    for lang in sorted(LANGUAGES):
        language.select_option(lang)
        expect(page.locator("html")).to_have_attribute("dir", "rtl" if lang in RTL else "ltr")
        expect(page.locator("html")).to_have_attribute("lang", lang)
    language.select_option("fr")
    page.reload()
    expect(language).to_have_value("fr")
    language.select_option("en")
    trace_interactions(page)
    search = page.locator("#search")
    search.fill("112")
    choices = page.locator("#surah-list button[data-id]:visible")
    expect(choices).to_have_count(1)
    choices.click()
    page.locator("#from-ayah").select_option("1")
    page.evaluate("window.calls.length = 0")
    page.locator("#to-ayah").select_option("2")
    words = page.locator("#verses button[data-word]")
    expect(words).to_have_count(6)
    assert page.evaluate("window.calls") == [
        "getAyahRange 1-2", "loadReferenceData 1", "getUthmaniText 1", "loadReferenceData 2", "getUthmaniText 2"]
    expect(page.get_by_role("region", name="Selected passage Ayahs 1–2")).to_be_visible()
    expect(page.locator(".selected-ayah .ayah-ref")).to_have_text(["112:1", "112:2"])
    assert not page.locator("#transliteration").is_checked()
    page.locator("label:has(#transliteration)").click()
    expect(page.locator("#transliteration")).to_be_checked()
    words.first.click()
    card = page.locator("#feedback")
    expect(card).to_be_visible()
    expect(card.locator(".wc-phonetic")).not_to_have_text("…")
    sections_with_rules = card.locator("details").count()
    expect(card.locator(".wc-diagram")).to_be_visible()
    card.locator(".wc-play").first.click()
    page.wait_for_function("window.expertPlayed === true")
    page.keyboard.press("Escape")
    expect(card).to_be_hidden()
    page.locator("label:has(#advanced)").click()
    expect(page.locator("#advanced")).not_to_be_checked()
    words.last.click()
    expect(card).to_be_visible()
    expect(card.locator("details")).to_have_count(sections_with_rules - 1)
    page.keyboard.press("Escape")
    page.locator("label:has(#advanced)").click()
    expect(page.locator("#advanced")).to_be_checked()
    for width in [390, 375, 320, 1280]:
        page.set_viewport_size({"width": width, "height": 820})
        overflow = page.evaluate("""() => [...document.querySelectorAll('body *')].filter(el => {
          const rect = el.getBoundingClientRect(); return rect.width && (rect.right > innerWidth + 1 || rect.left < -1);
        }).map(el => [el.tagName, el.id, el.className?.baseVal || String(el.className), el.getBoundingClientRect().right]).slice(0,12)""")
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), (width, overflow)
    permission = page.context.new_cdp_session(page)
    permission.send("Browser.setPermission", {
        "origin": origin.rstrip("/"), "permission": {"name": "microphone"}, "setting": "denied",
        "browserContextId": permission.send("Target.getTargetInfo")["targetInfo"]["browserContextId"],
    })
    page.locator("#record").click()
    expect(page.locator("#practice-message")).to_be_visible()
    expect(page.locator("#practice-message")).to_contain_text("denied")
    expect(page.locator("#upload")).to_be_visible()
    denied = page.evaluate("window.calls.slice(window.calls.indexOf('createRecording'))")
    assert denied[:2] == ["createRecording", "requestMicPermission"]
    assert "startRecord" not in denied and "getAudioData" not in denied
    assert posts == []
    page.locator("#upload-file").set_input_files(sample_wav())
    summary = page.locator("#summary")
    expect(summary).to_be_visible()
    expect(summary).to_contain_text("100")
    assert posts == ["test-primary", "test-secondary"]
    page.locator("#play-mine").click()
    page.wait_for_function("window.userRecordingPlayed === true")
    outcome = "mismatch"
    page.locator("#upload-file").set_input_files(sample_wav())
    expect(page.locator("#practice-message")).to_be_visible()
    expect(page.locator("#practice-message")).to_contain_text("match", ignore_case=True)
    assert posts == ["test-primary", "test-secondary", "test-primary"]
    expect(summary).to_be_hidden()
    outcome = "ok"
    page.evaluate("window.calls.length = 0")
    page.context.grant_permissions(["microphone"], origin=origin.rstrip("/"))
    page.locator("#record").click()
    expect(page.locator("#level")).to_be_visible()
    assert len(posts) == 3, "Microphone recording sent before Stop"
    page.wait_for_function("document.querySelector('#level').value > 0", timeout=8000)
    expect(page.locator("#practice-state")).to_contain_text("1 s", timeout=3000)
    page.locator("#record").click()
    expect(summary).to_contain_text("No errors detected")
    assert posts[3:] == ["test-primary", "test-secondary"]
    capture = page.evaluate("window.calls.slice(window.calls.indexOf('createRecording'))")
    assert capture[0:10] == [
        "createRecording", "requestMicPermission", "setStatus requesting", "setStatus permitted", "startRecord",
        "setStatus recording", "stopRecord", "setStatus stopping", "setStatus recorded", "setStatus analyzing"]
    assert capture[10].startswith("detectErrors analyzing Analyzing audio")
    assert capture[11:] == ["getAudioData", "send audio", "send audio", "return 0 errors", "setStatus analyzed"]
    expect(page.locator("#verses .flagged")).to_have_count(0)
    outcome = "correction"
    page.locator("#upload-file").set_input_files(sample_wav())
    expect(summary).to_contain_text("75")
    flagged = page.locator("#verses .flagged")
    expect(flagged).to_have_count(1)
    expect(flagged).to_have_attribute("aria-describedby", "correction-label")
    card_ids = page.evaluate("window.cardIds")
    assert len(set(card_ids)) == 2
    page.evaluate("window.calls.length = 0")
    flagged.click()
    reads = ["renderUnifiedFeedback", "getPhoneticText", "getArticulationImage", "getAnatomicalDescription", "getReciterName"]
    assert page.evaluate("window.calls") == ["loadErrorDetails", *reads, "getRuleExplanation en"]
    expect(card.locator(".word-card")).to_have_id(card_ids[0])
    expect(card.locator(".wc-error")).to_have_count(1)
    expect(card.locator(".wc-error")).to_contain_text("ه")
    expect(card.locator(".wc-error-choice")).to_have_count(2)
    card.locator(".wc-error-choice").last.click()
    expect(card.locator(".word-card")).to_have_id(card_ids[1])
    expect(card.locator(".wc-error")).to_contain_text("و")
    expect(card.locator('.wc-letter[aria-pressed="true"]')).to_contain_text("و")
    page.evaluate("window.calls.length = 0")
    page.locator("#card-advanced").uncheck()
    assert page.evaluate("window.calls") == reads
    page.locator("#card-language").select_option("ar")
    expect(card.locator(".wc-error-choice").last).to_have_attribute("aria-pressed", "true")
    assert not any(call.startswith("getRuleExplanation") for call in page.evaluate("window.calls"))
    page.locator("#card-advanced").check()
    assert page.evaluate("window.calls.at(-1)") == "getRuleExplanation ar"
    page.locator("#card-language").select_option("en")
    card.locator("details").last.locator(".wc-play").first.click()
    page.wait_for_function("window.lastRecordingStart >= 0.24 && window.lastRecordingStart < 0.5")
    page.keyboard.press("Escape")
    page.set_viewport_size({"width": 375, "height": 667})
    page.locator("#guide-button").click()
    guide = page.locator("dialog[open]")
    expect(guide).to_be_visible()
    expect(guide.locator("track")).to_have_count(13)
    expect(guide.locator("track[default]")).to_have_attribute("srclang", "en")
    guide.locator(".guide-primary").click()
    for step in range(1, 6):
        expect(guide.locator(".guide-progress")).to_have_text(f"{step} / 5")
        expect(page.locator(".faseeh-tour-target")).to_be_visible()
        guide.locator(".guide-primary").click()
    expect(guide).to_have_count(0)
    assert not errors, errors


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(StaticHandler, directory=ROOT / "web"))
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                executable_path=os.getenv("CHROMIUM_PATH") or shutil.which("chromium"),
                args=["--use-fake-device-for-media-stream"])
            try:
                page = browser.new_page(viewport={"width": 1280, "height": 850})
                page.set_default_timeout(8000)
                check_reference_retry(page, f"http://127.0.0.1:{server.server_port}/")
                run(page, f"http://127.0.0.1:{server.server_port}/")
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
    print("Passed all four interaction sequences in Chromium, plus localization, retry, failover, playback and guide checks.")


if __name__ == "__main__":
    main()

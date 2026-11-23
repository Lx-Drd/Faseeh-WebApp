import { languages } from './i18n.js';
import { AudioRecording } from './audio-recording.js';

function read(key) {
  try { return localStorage.getItem('faseeh.' + key); } catch { return null; }
}
function remember(key, value) {
  try { localStorage.setItem('faseeh.' + key, String(value)); } catch { /* Session-only preferences. */ }
}

export class User {
  #userId = crypto.randomUUID();
  #preferredLanguage;
  #transliterationEnabled = read('transliteration') === 'true';
  #advancedRulesEnabled = read('advanced') !== 'false';
  #engine;

  constructor(engine) {
    this.#engine = engine;
    const savedLanguage = read('language');
    this.#preferredLanguage = languages.some(l => l.code === savedLanguage) ? savedLanguage : 'en';
  }

  get userId() { return this.#userId; }
  get preferredLanguage() { return this.#preferredLanguage; }
  get transliterationEnabled() { return this.#transliterationEnabled; }
  get advancedRulesEnabled() { return this.#advancedRulesEnabled; }

  setLanguage(lang) {
    if (!languages.some(l => l.code === lang)) throw new RangeError('Unsupported interface language.');
    this.#preferredLanguage = lang;
    remember('language', lang);
  }

  toggleTransliteration() {
    this.#transliterationEnabled = !this.#transliterationEnabled;
    remember('transliteration', this.#transliterationEnabled);
  }

  toggleAdvancedRules() {
    this.#advancedRulesEnabled = !this.#advancedRulesEnabled;
    remember('advanced', this.#advancedRulesEnabled);
  }

  createRecording(ayahs) {
    return new AudioRecording(this, ayahs, this.#engine);
  }
}

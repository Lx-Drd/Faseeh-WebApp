import { cardStrings } from './card-text.js';
import { speechQuality } from './speech-qualities.js';
import { Ayah } from './library.js';
import { PronunciationError } from './word-study.js';
import { CorrectionInterface, clearCorrection } from './correction-interface.js';

export { CorrectionInterface, clearCorrection, stopCardAudio } from './correction-interface.js';
export { articulation, lettersOf, tanweenForm } from './word-media.js';

const catalogAyahs = new WeakMap();
const catalogErrors = new WeakMap();

// Several findings may point to the same word. Route each choice to a single-error
// card so its selected letter, transcription and guidance always describe that finding.
export function renderCorrection(container, { surah, ayah, wordIndex, errors = [], ...display }) {
  const current = CorrectionInterface.forContainer(container);
  if (!(ayah instanceof Ayah)) {
    if (!catalogAyahs.has(ayah)) catalogAyahs.set(ayah, new Ayah(surah.id, ayah));
    ayah = catalogAyahs.get(ayah);
  }
  if (!ayah.words[wordIndex]) {
    clearCorrection(container);
    return current;
  }
  const issues = errors.flatMap(issue => {
    if (issue instanceof PronunciationError) return issue.ayah === ayah && issue.positionIndex === wordIndex ? [issue] : [];
    if (issue.ayah !== ayah.ayahNumber || issue.wordIndex !== wordIndex) return [];
    if (catalogErrors.get(issue)?.ayah !== ayah) catalogErrors.set(issue, new PronunciationError(ayah, null, issue));
    return [catalogErrors.get(issue)];
  });
  const t = cardStrings(display.language);
  function show(error) {
    const view = error?.correctionInterface ?? (current && !current.error ? current : new CorrectionInterface());
    view.attach(container, display);
    if (view.ayah !== ayah || view.positionIndex !== wordIndex || view.error !== error) {
      if (error) view.loadErrorDetails(error);
      else view.loadWordDetails(ayah, wordIndex);
    }
    view.renderUnifiedFeedback();
    if (error && display.advanced !== false) view.setRuleExplanation(error.getRuleExplanation(display.language));
    if (issues.length < 2) return view;
    const choices = document.createElement('div');
    choices.className = 'wc-issue-choices';
    choices.setAttribute('role', 'group');
    choices.setAttribute('aria-label', t.correction);
    for (const entry of issues) {
      const quality = speechQuality(entry, display.language);
      const title = [t[entry.errorType] || t.pronunciation, quality?.name, entry.letter].filter(Boolean).join(' · ');
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.className = 'wc-error-choice';
      choice.textContent = title;
      choice.addEventListener('click', () => {
        show(entry);
        container.querySelector('.wc-error-choice[aria-pressed="true"]')?.focus();
      });
      choice.setAttribute('aria-pressed', String(entry === error));
      choices.append(choice);
    }
    container.querySelector('.wc-header').after(choices);
    return view;
  }
  return show(issues.includes(current?.error) ? current.error : issues[0] ?? null);
}

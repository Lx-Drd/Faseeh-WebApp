import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { articulation, lettersOf, tanweenForm } from '../web/correction.js';
import { cardStrings } from '../web/card-text.js';

const read = path => readFileSync(new URL(path, import.meta.url),'utf8');
const catalog = JSON.parse(read('../web/data/surahs.json'));
const phonetics = JSON.parse(read('../web/data/phonetics.json'));
const diagrams = read('../web/articulation/places.svg');
const languages = ['en','ar','es','fr','zh','ur','id','bn','pa','fa','tr','ps','ha'];

test('each catalog word has a reference transcription and each articulation site a diagram and localized description', () => {
  const selections = new Set();
  for (const surah of catalog) for (const ayah of surah.ayahs) {
    assert.equal(phonetics[surah.id + ':' + ayah.number].length, ayah.words.length);
    ayah.words.forEach((word,index) => {
      assert.ok(phonetics[surah.id + ':' + ayah.number][index]);
      const letters = lettersOf(word.text);
      assert.ok(letters.length);
      letters.forEach((_, i) => selections.add(JSON.stringify(articulation(letters,i,index === ayah.words.length-1 && i === letters.length-1))));
    });
  }
  for (const key of selections) {
    const {place,rule} = JSON.parse(key);
    assert.ok(diagrams.includes('id="' + place + '"'), place);
    for (const language of languages) {
      const labels = cardStrings(language);
      assert.ok(labels['place.' + place] && labels['rule.' + rule], language);
    }
  }
});

test('lexical tanween expands independently from pausing or joining in the actual ayah', () => {
  assert.equal(tanweenForm('أَحَدٌ'), 'أَحَدُنْ');
  assert.equal(tanweenForm('وَهَّاجًۭا'), 'وَهْهَاجَنْ');
  assert.equal(tanweenForm('ٱلصَّمَدُ'), '');
});
test('letter context distinguishes vowels, doubled nasal consonants, and final taa marbuta', () => {
  assert.equal(articulation(lettersOf('عَمَّ'),1).rule,'nasal');
  assert.equal(articulation(lettersOf('يَقُولُ'),2).place,'cavity');
  assert.equal(articulation(lettersOf('وَلَا'),0).place,'roundLips');
  assert.equal(articulation(lettersOf('ة'),0,true).place,'deepThroat');
  assert.equal(articulation(lettersOf('ة'),0,false).place,'dental');
});

import { speechQuality } from '../web/speech-qualities.js';
test('aligned acoustic attributes display localized values and their own rule descriptions', () => {
  const issue = {attribute:'ghonna',expected:'maghnoon',heard:'not_maghnoon'};
  assert.deepEqual(speechQuality(issue,'en'),{name:'الغنة',expected:'Present',heard:'Absent',
    explanation:'The resonance of the sound through the nose.'});
  for (const language of languages) {
    const {expected,heard,explanation} = speechQuality(issue,language);
    assert.ok(expected && heard && expected !== heard && explanation);
    assert.ok(![expected,heard].includes('maghnoon'));
  }
  const mixed = speechQuality({attribute:'tafkheem_or_taqeeq',expected:'low_mofakham',heard:'moraqaq'},'ar');
  assert.equal(mixed.expected,'أقل تفخيمًا');
  assert.equal(mixed.heard,'مرقق');
  assert.equal(speechQuality({attribute:'ghonna',heard:'unrecognized'},'en').heard,null);
  assert.equal(speechQuality({type:'vowel'},'en'),null);
});

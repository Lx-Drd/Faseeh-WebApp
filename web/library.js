/** One catalog entry, including the word positions used by both audio and feedback. */
export class Ayah {
  #surahNumber;
  #ayahNumber;
  #uthmaniText;
  #transliteration;

  constructor(surahNumber, { number, text = '', transliteration = '', words = [], audio = null }) {
    this.#surahNumber = surahNumber;
    this.#ayahNumber = number;
    this.#uthmaniText = text;
    this.#transliteration = transliteration;
    this.words = Object.freeze(words.map(word => Object.freeze({ ...word })));
    this.audioPath = audio;
    Object.freeze(this);
  }

  get surahNumber() { return this.#surahNumber; }
  get ayahNumber() { return this.#ayahNumber; }
  getUthmaniText() { return this.#uthmaniText; }
  getTransliteration() { return this.#transliteration; }
}

export class Surah {
  #surahNumber;
  #nameArabic;
  #nameEnglish;
  #ayahs;

  constructor({ id, arabicName, name, ayahs }) {
    this.#surahNumber = id;
    this.#nameArabic = arabicName;
    this.#nameEnglish = name;
    if (!ayahs.length || !ayahs.every((ayah, i) => ayah.number === i + 1)) {
      throw new RangeError('A surah must contain its ayahs in Mushaf order.');
    }
    this.#ayahs = Object.freeze(ayahs.map(data => new Ayah(id, data)));
  }

  static async loadFromFile(filePath) {
    const response = await fetch(filePath);
    if (!response.ok) throw new Error('Cannot load the surah library.');
    const catalog = await response.json();
    return catalog.map(entry => new Surah(entry));
  }

  get surahNumber() { return this.#surahNumber; }
  get nameArabic() { return this.#nameArabic; }
  get nameEnglish() { return this.#nameEnglish; }
  getAyahList() { return this.#ayahs; }

  getAyahRange(fromAyah, toAyah) {
    if (!Number.isInteger(fromAyah) || !Number.isInteger(toAyah) ||
        fromAyah < 1 || toAyah < fromAyah || toAyah > this.#ayahs.length) {
      throw new RangeError('invalid_selection');
    }
    return this.#ayahs.slice(fromAyah - 1, toAyah);
  }
}

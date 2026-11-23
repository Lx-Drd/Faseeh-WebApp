# Faseeh study library

The seven surahs contain 103 ayahs. The Uthmani text and word-level Latin transliterations come from the Quran Foundation verses API. Each word retains the source spelling. [Verses API example](https://api.quran.com/api/v4/verses/by_chapter/112?language=en&words=true&word_fields=text_uthmani&fields=text_uthmani)

The reference voice is Sheikh Muhammad Siddiq al-Minshawi, murattal, Quran Foundation recitation 9. Each local MP3 is an excerpt of the corresponding chapter recording. Verse boundaries and word timestamps come from the same recitation. The catalog gives seconds relative to the local ayah clip. [Reciter registry](https://api.quran.com/api/v4/resources/recitations) · [Timing example](https://api.quran.com/api/v4/chapter_recitations/9/112?segments=true) · [Source audio example](https://download.quranicaudio.com/qdc/siddiq_minshawi/murattal/112.mp3)

The bundled font is the King Fahd Glorious Qur'an Printing Complex **KFGQPC HAFS Uthmanic Script**, version 18, distributed by Quran.com. Its SHA-256 digest is `8c00e7a7d5f773bcfb1642fdcfba505dbd81975fef39f14718827a32d075020c`. [Font source](https://github.com/quran/quran.com-frontend-next/blob/aff1a035b09b66f28047b3216edcae4c5c949a49/public/fonts/quran/hafs/uthmanic_hafs/UthmanicHafs1Ver18.woff2)

To refresh the chapter data and clips, run `python3 tools/prepare_library.py` with FFmpeg installed. The script downloads the recordings referenced by the timestamp service and checks surah identity, verse count and word boundaries before installing the assets.

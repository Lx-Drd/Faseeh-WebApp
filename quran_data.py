"""
Ayah texts for Surahs 112-114, split into words exactly like the frontend does
(`text.split(' ')`), so `wordIndex` means the same thing on both sides.

NOTE: prototype text (standard script with tashkeel). Replace it with verified Uthmani
text, e.g. from Tanzil (tanzil.net), in BOTH this file and the frontend's SURAHS object.
"""
from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Ayah:
    number: int
    text: str
    words: tuple[str, ...]
    # Word the mock analysis flags (0-based). Mirrors `focus` in the frontend.
    focus_word: int


@dataclass(frozen=True)
class Surah:
    number: int
    name_en: str
    name_ar: str
    ayat: tuple[Ayah, ...]


def _surah(number: int, name_en: str, name_ar: str, ayat: list[tuple[str, int]]) -> Surah:
    built = []
    for i, (text, focus) in enumerate(ayat, start=1):
        words = tuple(text.split(" "))
        if not 0 <= focus < len(words):
            raise ValueError(f"{number}:{i} focus_word {focus} is out of range")
        built.append(Ayah(number=i, text=text, words=words, focus_word=focus))
    return Surah(number, name_en, name_ar, tuple(built))


SURAHS: dict[int, Surah] = {
    112: _surah(112, "Al-Ikhlas", "سورة الإخلاص", [
        ("قُلْ هُوَ اللَّهُ أَحَدٌ", 3),
        ("اللَّهُ الصَّمَدُ", 1),
        ("لَمْ يَلِدْ وَلَمْ يُولَدْ", 1),
        ("وَلَمْ يَكُن لَّهُ كُفُوًا أَحَدٌ", 4),
    ]),
    113: _surah(113, "Al-Falaq", "سورة الفلق", [
        ("قُلْ أَعُوذُ بِرَبِّ الْفَلَقِ", 3),
        ("مِن شَرِّ مَا خَلَقَ", 3),
        ("وَمِن شَرِّ غَاسِقٍ إِذَا وَقَبَ", 2),
        ("وَمِن شَرِّ النَّفَّاثَاتِ فِي الْعُقَدِ", 4),
        ("وَمِن شَرِّ حَاسِدٍ إِذَا حَسَدَ", 2),
    ]),
    114: _surah(114, "An-Nas", "سورة الناس", [
        ("قُلْ أَعُوذُ بِرَبِّ النَّاسِ", 3),
        ("مَلِكِ النَّاسِ", 1),
        ("إِلَٰهِ النَّاسِ", 0),
        ("مِن شَرِّ الْوَسْوَاسِ الْخَنَّاسِ", 3),
        ("الَّذِي يُوَسْوِسُ فِي صُدُورِ النَّاسِ", 3),
        ("مِنَ الْجِنَّةِ وَالنَّاسِ", 1),
    ]),
}


def get_ayah(surah: int, ayah: int) -> Ayah | None:
    s = SURAHS.get(surah)
    if s is None or not 1 <= ayah <= len(s.ayat):
        return None
    return s.ayat[ayah - 1]


# Harakat, tatweel and small Quranic marks don't take their own time when recited.
_DIACRITICS = re.compile(r"[ً-ٟـٰۖ-ۭ]")


def letter_count(word: str) -> int:
    """Base letters in a word: a rough proxy for how long it takes to recite."""
    return max(1, len(_DIACRITICS.sub("", word)))

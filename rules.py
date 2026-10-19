"""
Tajweed rules the API can report. The IDs must match the keys of the frontend's RULES
object, which holds the learner-facing text. The details here are for the server side
(logs, future endpoints, or embedding them in responses later).

`guess_rule(word)` picks the most error-prone feature of a word. The acoustic comparison
only finds WHICH word differs from the reference, not WHY, so this is a heuristic until a
phoneme-level model exists.
"""
from __future__ import annotations

RULES: dict[str, dict[str, str]] = {
    "hha": {
        "title": "Ḥā’ (ح)", "letter": "ح",
        "makhraj": "Wasaṭ al-Ḥalq (middle of the throat)",
        "description": "Ḥā’ pronounced like Hā’ (ه). Ḥā’ is a breathy sound from the middle of the throat.",
    },
    "ayn": {
        "title": "ʿAyn (ع)", "letter": "ع",
        "makhraj": "Wasaṭ al-Ḥalq (middle of the throat)",
        "description": "ʿAyn pronounced like Hamzah (ء). Tighten the middle of the throat to voice it.",
    },
    "khaa": {
        "title": "Khā’ (خ)", "letter": "خ",
        "makhraj": "Adnā al-Ḥalq (top of the throat)",
        "description": "Khā’ too light, close to Hā’ (ه). It needs friction at the top of the throat.",
    },
    "ghayn": {
        "title": "Ghayn (غ)", "letter": "غ",
        "makhraj": "Adnā al-Ḥalq (top of the throat)",
        "description": "Ghayn pronounced like a hard 'g'. Let air flow with a gargling friction instead.",
    },
    "qaf": {
        "title": "Qāf (ق)", "letter": "ق",
        "makhraj": "Aqṣā al-Lisān (back of the tongue)",
        "description": "Qāf pronounced like Kāf (ك). It comes from further back, against the soft palate.",
    },
    "saad": {
        "title": "Tafkhīm of Ṣād (ص)", "letter": "ص",
        "makhraj": "Tip of the tongue near the lower front teeth",
        "description": "Ṣād pronounced like a light Sīn (س). Raise the back of the tongue for a heavy sound.",
    },
    "qalqalah": {
        "title": "Qalqalah", "letter": "ق ط ب ج د",
        "makhraj": "Depends on the letter (e.g. د: tongue tip at the roots of the upper teeth)",
        "description": "A sākin Qalqalah letter was cut off silently. Give it a slight echoing bounce.",
    },
    "ghunnah": {
        "title": "Ghunnah", "letter": "نّ مّ",
        "makhraj": "Al-Khayshūm (nasal cavity)",
        "description": "Nūn or Mīm with shaddah held too briefly. Hold the nasal sound for two counts.",
    },
    "madd": {
        "title": "Madd Ṭabīʿī", "letter": "ا و ي",
        "makhraj": "Al-Jawf (open space of the mouth and throat)",
        "description": "A natural long vowel was shortened. Stretch it for two counts.",
    },
    "general": {
        "title": "Pronunciation", "letter": "",
        "makhraj": "",
        "description": "The word sounded different from the reference recitation.",
    },
}

SHADDA = "ّ"
SUKUN = "ْ"
DAGGER_ALIF = "ٰ"

# Letter-based rules, checked in this order; the first match wins.
_LETTER_RULES = [("ح", "hha"), ("ع", "ayn"), ("خ", "khaa"), ("غ", "ghayn"), ("ق", "qaf"), ("ص", "saad")]
_QALQALAH_LETTERS = set("قطبجد")
_GHUNNAH_LETTERS = set("نم")


def get_rule(rule_id: str) -> dict[str, str]:
    return RULES.get(rule_id, RULES["general"])


def guess_rule(word: str) -> str:
    """Most likely rule tested by `word`, judged from its letters and marks."""
    for letter, rule in _LETTER_RULES:
        if letter in word:
            return rule
    for i, ch in enumerate(word):
        # the shadda follows its letter, sometimes after the vowel mark
        if ch in _GHUNNAH_LETTERS and SHADDA in word[i + 1:i + 3]:
            return "ghunnah"
    if DAGGER_ALIF in word:
        return "madd"
    for i, ch in enumerate(word[:-1]):
        if ch in _QALQALAH_LETTERS and word[i + 1] == SUKUN:
            return "qalqalah"
    return "general"

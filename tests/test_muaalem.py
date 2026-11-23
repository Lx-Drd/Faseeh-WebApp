"""Reference alignment tests. Install requirements-model.txt to run them, no weights required."""

import json
from importlib.util import find_spec
from pathlib import Path
import unittest

from muaalem_engine import (
    EngineError,
    Phone,
    opening_invocations,
    score_phones,
    verse_text,
    word_errors,
    word_forms,
)


def phones(script):
    return [Phone(ch, i / 20, (i + 1) / 20) for i, ch in enumerate(script)]


@unittest.skipUnless(
    find_spec("quran_transcript"), "requires the model's quran-transcript package"
)
class ModelAlignment(unittest.TestCase):
    def test_pause_and_joined_recitations(self):
        stop = [*word_forms(verse_text(112, 1)), *word_forms(verse_text(112, 2))]
        join = word_forms(verse_text(112, 1) + " " + verse_text(112, 2))
        for forms in (stop, join):
            result = score_phones(phones("".join(f.script for f in forms)), 112, 1, 4)
            self.assertEqual(
                (result["endAyah"], result["correctWords"], result["totalWords"]),
                (2, 6, 6),
            )
            self.assertEqual(len(result["wordTimings"]), 6)

    def test_error_localizes_to_changed_consonant(self):
        forms = word_forms(verse_text(112, 1))
        text = "".join(f.script for f in forms).replace("ح", "ه")
        result = score_phones(phones(text), 112, 1, 4)
        self.assertEqual((result["totalWords"], result["percentage"]), (4, 75))
        (issue,) = result["errors"]
        self.assertEqual(
            (issue["ayah"], issue["wordIndex"], issue["letter"], issue["type"]),
            (1, 3, "ح", "pronunciation"),
        )

    def test_preamble_is_not_scored_and_preserves_audio_time(self):
        prefix = "".join(opening_invocations())
        verse = "".join(w.script for w in word_forms(verse_text(112, 1)))
        result = score_phones(phones(prefix + verse), 112, 1, 4)
        self.assertEqual(result["correctWords"], 4)
        self.assertEqual(result["wordTimings"][0]["start"], len(prefix) / 20)

    def test_attribute_error_requires_unambiguous_acoustic_alignment(self):
        forms = word_forms(verse_text(112, 1))
        sequence = phones("".join(f.script for f in forms))
        events = []
        offset = 0
        for form in forms:
            for start, group in form.sifat.items():
                first = sequence[offset + start]
                events.append(Phone(group.ghonna, first.start, first.end))
            offset += len(form.script)
        events[0] = Phone("maghnoon", events[0].start, events[0].end)
        result = score_phones(sequence, 112, 1, 4, {"ghonna": events})
        (issue,) = result["errors"]
        self.assertEqual(
            (issue["letter"], issue["attribute"], result["percentage"]),
            ("ق", "ghonna", 75),
        )
        self.assertEqual(
            score_phones(sequence, 112, 1, 4, {"ghonna": events[1:]})["errors"], []
        )

    def test_long_madd_tolerance(self):
        form = word_forms(verse_text(78, 1))[1]
        for n in (2, 4, 6):
            self.assertEqual(
                word_errors(form, form.script.replace("اااا", "ا" * n)), []
            )
        (error,) = word_errors(form, form.script.replace("اااا", "ا"))
        self.assertEqual((error["type"], error["letter"]), ("madd", "ا"))

    def test_rejects_unrelated_and_empty_recitations(self):
        for script, code in [("غغغغغغغغغغغغ", "mismatch"), ("", "no_voice")]:
            with self.assertRaises(EngineError) as error:
                score_phones(phones(script), 114, 1, 6)
            self.assertEqual(error.exception.code, code)

    def test_lookup_card_and_model_indices_agree(self):
        folder = Path(__file__).resolve().parents[1] / "web/data"
        lookup = json.loads((folder / "phonetics.json").read_text())
        for surah in json.loads((folder / "surahs.json").read_text()):
            for ayah in surah["ayahs"]:
                self.assertEqual(
                    len(lookup[f"{surah['id']}:{ayah['number']}"]), len(ayah["words"])
                )

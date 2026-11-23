"""Generate the learner lookup script in the context of its verse (waqf at verse end)."""

import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from muaalem_engine import verse_text, word_forms

counts = {78: 40, 80: 42, 103: 3, 108: 3, 112: 4, 113: 5, 114: 6}
output = {
    f"{surah}:{ayah}": [w.script for w in word_forms(verse_text(surah, ayah))]
    for surah, count in counts.items()
    for ayah in range(1, count + 1)
}
(ROOT / "web/data/phonetics.json").write_text(
    json.dumps(output, ensure_ascii=False, indent=1) + "\n"
)

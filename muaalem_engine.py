"""Post-recording Quran Muaalem inference and timing-aware Hafs reference alignment."""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from itertools import groupby
import logging
import os
from threading import Lock
import unicodedata

import numpy as np

MODEL_ID = "obadx/muaalem-model-v3_2"
REVISION = "01a1ef9fbe40d144ef845101e89ff924aed3fef5"
SAMPLE_RATE = 16000
_model = None
_init_lock = Lock()
log = logging.getLogger(__name__)


class EngineError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def load_model():
    """Load once per worker, including when first requests arrive concurrently."""
    global _model
    with _init_lock:
        if _model is None:
            try:
                import torch
                from huggingface_hub import snapshot_download
                from quran_muaalem import Muaalem

                device = os.getenv("FASEEH_MODEL_DEVICE") or (
                    "cuda" if torch.cuda.is_available() else "cpu"
                )
                source = os.getenv("FASEEH_MODEL_PATH") or snapshot_download(
                    MODEL_ID,
                    revision=REVISION,
                    allow_patterns=["*.json", "*.safetensors"],
                )
                dtype = (
                    torch.bfloat16
                    if device.startswith("cuda") and torch.cuda.is_bf16_supported()
                    else torch.float32
                )
                model = Muaalem(source, device=device, dtype=dtype)
                model.model.eval()
                _model = model
            except Exception as exc:
                log.exception("Could not initialize Quran Muaalem")
                raise EngineError(
                    "unavailable", "The pronunciation model is unavailable."
                ) from exc
        return _model


@dataclass(frozen=True)
class Phone:
    text: str
    start: float
    end: float


def collapse_frames(frames, vocab):
    events = []
    for idx, run in groupby(frames, key=lambda f: f[0]):
        if idx:
            group = list(run)
            events.append(Phone(vocab[idx], group[0][1], group[-1][2]))
    return events


def transcribe(audio):
    """Decode all acoustic heads with overlapping context at each window boundary."""
    model = load_model()
    import torch

    sample_count = len(audio)
    step = SAMPLE_RATE * 12
    context = SAMPLE_RATE
    streams = {}
    with torch.inference_mode():
        for left in range(0, sample_count, step):
            right = min(sample_count, left + step)
            begin, end = max(0, left - context), min(sample_count, right + context)
            features = model.processor(
                audio[begin:end], sampling_rate=SAMPLE_RATE, return_tensors="pt"
            )
            inputs = {
                k: v.to(model.device, dtype=model.dtype) for k, v in features.items()
            }
            logits = model.model(**inputs, return_dict=False)[0]
            for level, values in logits.items():
                ids = values[0].argmax(dim=-1).cpu().tolist()
                duration = (end - begin) / len(ids)
                stream = streams.setdefault(level, [])
                for i, idx in enumerate(ids):
                    s = begin + i * duration
                    if left <= s + duration / 2 < right:
                        stream.append(
                            (idx, s / SAMPLE_RATE, (s + duration) / SAMPLE_RATE)
                        )
    tokenizer = model.multi_level_tokenizer
    phones = collapse_frames(streams.pop("phonemes"), tokenizer.id_to_vocab["phonemes"])
    heads = {
        k: collapse_frames(frames, tokenizer.sifat_to_en_vocab[k])
        for k, frames in streams.items()
    }
    return phones, heads


@dataclass
class WordForm:
    text: str
    script: str
    mappings: list
    # Offset in this word's QPS -> upstream reference attributes for that group.
    sifat: dict


@lru_cache(maxsize=1)
def corpus():
    from quran_transcript import Aya

    return Aya().quran_dict


def verse_text(surah, ayah):
    from quran_transcript import Aya

    return Aya(surah, ayah, quran_dict=corpus()).get().uthmani


@lru_cache(maxsize=1)
def attributes():
    from quran_transcript import MoshafAttributes

    return MoshafAttributes(
        rewaya="hafs",
        madd_monfasel_len=4,
        madd_mottasel_len=4,
        madd_mottasel_waqf=4,
        madd_aared_len=4,
    )


@lru_cache(maxsize=256)
def word_forms(text):
    """Split the upstream character mappings at Mushaf word boundaries."""
    from dataclasses import replace
    from quran_transcript import quran_phonetizer
    import re

    out = quran_phonetizer(text, attributes(), remove_spaces=True)
    groups = {}
    offset = 0
    for group in out.sifat:
        groups[offset] = group
        offset += len(group.phonemes)
    forms = []
    for match in re.finditer(r"\S+", text):
        maps = out.mappings[match.start() : match.end()]
        positions = [i for m in maps for i in range(*m.pos)]
        if not positions:  # unattached pause marks have no spoken form
            continue
        begin, end = min(positions), max(positions) + 1
        local = [
            replace(m, pos=(max(0, m.pos[0] - begin), max(0, m.pos[1] - begin)))
            for m in maps
        ]
        sifat = {
            i - begin: group
            for i, group in groups.items()
            if begin <= i and i + len(group.phonemes) <= end
        }
        forms.append(WordForm(match.group(), out.phonemes[begin:end], local, sifat))
    return forms


def word_choices(surah, start, end):
    """Waqf at a verse boundary and wasl across that boundary are both valid."""
    texts = [verse_text(surah, n) for n in range(start, end + 1)]
    plain = [word_forms(t) for t in texts]
    choices = [[[w] for w in verse] for verse in plain]
    for i in range(len(texts) - 1):
        joined = word_forms(texts[i] + " " + texts[i + 1])
        pair = choices[i] + choices[i + 1]
        if len(joined) != len(pair):
            raise ValueError("Unexpected word boundaries in joined reference")
        for options, form in zip(pair, joined):
            if all(f.script != form.script for f in options):
                options.append(form)
    return [
        (start + v, w, options)
        for v, verse in enumerate(choices)
        for w, options in enumerate(verse)
    ]


def align_words(choices, heard):
    """Edit-distance lattice over word variants. Trailing unrecited words are free."""
    n = len(heard)
    if n < 2:
        raise EngineError("mismatch", "Too little recognizable recitation.")
    columns = np.arange(n + 1, dtype=np.int32)
    observed = np.array(list(heard), dtype="U1")
    previous = columns.copy()
    history = []
    endpoints = []
    for _, _, forms in choices:
        alternatives = []
        for form in forms:
            rows = [previous]
            for letter in form.script:
                # Start with deletion and diagonal moves; prefix minimum adds insertions.
                row = rows[-1] + 1
                row[1:] = np.minimum(row[1:], rows[-1][:-1] + (observed != letter))
                rows.append(np.minimum.accumulate(row - columns) + columns)
            alternatives.append(rows)
        history.append(alternatives)
        previous = np.minimum.reduce([rows[-1] for rows in alternatives])
        endpoints.append(previous[-1])
    last = int(np.argmin(endpoints))
    if endpoints[last] > 0.40 * n:
        raise EngineError(
            "mismatch", "The recitation does not match the selected passage."
        )

    spans = []
    j = n
    for idx in range(last, -1, -1):
        ayah, word, forms = choices[idx]
        options = history[idx]
        best = min(range(len(forms)), key=lambda k: options[k][-1][j])
        rows, form = options[best], forms[best]
        i, end = len(form.script), j
        while i:
            cost = rows[i][j]
            if j and cost == rows[i - 1][j - 1] + (form.script[i - 1] != heard[j - 1]):
                i -= 1
                j -= 1
            elif cost == rows[i - 1][j] + 1:
                i -= 1
            else:
                j -= 1
        if idx == 0:
            j = 0
        spans.append((ayah, word, form, j, end))
    return list(reversed(spans))


def word_errors(form, heard):
    from quran_transcript import explain_error

    if heard == form.script:
        return []
    if not heard:
        return [
            {
                "type": "omission",
                "letter": base_letter(form.text, 0),
                "expected": form.script,
                "heard": "",
            }
        ]
    errors = []
    for err in explain_error(form.text, form.script, heard, form.mappings):
        rules = [r.name.en for r in (err.ref_tajweed_rules or [])]
        name = next((r for r in rules if "Madd" in r), None)
        same_letter = err.expected_ph[:1] == err.preditected_ph[:1]
        if (
            name
            and same_letter
            and err.expected_len is not None
            and err.predicted_len is not None
        ):
            if (
                name
                in (
                    "Monfasel Madd",
                    "Mottasel Madd",
                    "Mottasel Madd at Pause",
                    "Lazem Madd",
                )
                and abs(err.expected_len - err.predicted_len) <= 2
            ):
                continue
            if name in ("Aared Madd", "Leen Madd") and err.predicted_len in (2, 4, 6):
                continue
        kind = {
            "insert": "insertion",
            "delete": "omission",
            "replace": "pronunciation",
        }[err.speech_error_type]
        if err.error_type == "tashkeel":
            kind = "vowel"
        elif name and err.error_type == "tajweed":
            kind = "madd"
        errors.append(
            {
                "letter": base_letter(form.text, err.uthmani_pos[0]),
                "type": kind,
                "expected": err.expected_ph,
                "heard": err.preditected_ph,
                "rules": rules,
            }
        )
    return errors


def base_letter(word, index):
    for ch in reversed(word[: min(len(word), index + 1)]):
        if unicodedata.category(ch) == "Lo":
            return ch
    return word[0]


@lru_cache(maxsize=1)
def opening_invocations():
    from quran_transcript import Aya

    example = Aya(112, 1, quran_dict=corpus()).get()
    return tuple(
        "".join(f.script for f in word_forms(text))
        for text in (example.istiaatha_uthmani, example.bismillah_uthmani)
    )


def skip_invocations(phones):
    """Permit an audible isti'adha and/or basmala before the selected passage."""
    from rapidfuzz.distance import Levenshtein

    text = "".join(p.text for p in phones)
    offset = 0
    for formula in opening_invocations():
        tolerance = len(formula) // 5
        ends = range(
            max(1, len(formula) - tolerance),
            min(len(text) - offset, len(formula) + tolerance) + 1,
        )
        matches = (
            (Levenshtein.distance(formula, text[offset : offset + n]), n) for n in ends
        )
        distance, length = min(matches, default=(tolerance + 1, 0))
        if distance <= tolerance:
            offset += length
    return phones[offset:]


def aligned_attributes(phones, heads):
    """Use an acoustic attribute only if its CTC events agree in count AND position."""
    from quran_transcript import chunck_phonemes

    heard = "".join(phone.text for phone in phones)
    groups = chunck_phonemes(heard)
    if "".join(groups) != heard:
        return {}
    valid = {key: events for key, events in heads.items() if len(events) == len(groups)}
    result = {}
    offset = 0
    for i, group in enumerate(groups):
        start = phones[offset].start
        end = phones[offset + len(group) - 1].end
        # Bound by surrounding acoustic groups; independently decoded heads may peak
        # one frame before or after phoneme heads, but must agree on this letter.
        lo = max(start - 0.08, (phones[offset - 1].end + start) / 2 if offset else 0)
        nxt = offset + len(group)
        hi = min(
            end + 0.08,
            (phones[nxt].start + end) / 2 if nxt < len(phones) else end + 0.08,
        )
        result[start] = {
            key: event.text
            for key, seq in valid.items()
            if lo <= ((event := seq[i]).start + event.end) / 2 <= hi
        }
        offset = nxt
    return result


def attribute_errors(form, observed, attribute_map):
    if form.script != "".join(p.text for p in observed):
        return []
    issues = []
    for i, group in form.sifat.items():
        for level, actual in attribute_map.get(observed[i].start, {}).items():
            expected = getattr(group, level)
            if expected != actual:
                uthmani_index = next(
                    j for j, m in enumerate(form.mappings) if m.pos[0] <= i < m.pos[1]
                )
                issues.append(
                    {
                        "type": "pronunciation",
                        "attribute": level,
                        "letter": base_letter(form.text, uthmani_index),
                        "expected": expected,
                        "heard": actual,
                    }
                )
    return issues


def score_phones(phones, surah, start_ayah, end_ayah, heads=None):
    if not phones:
        raise EngineError("no_voice", "No recognizable voice was heard.")
    attribute_map = aligned_attributes(phones, heads) if heads else {}
    phones = skip_invocations(phones)
    heard = "".join(p.text for p in phones)
    spans = align_words(word_choices(surah, start_ayah, end_ayah), heard)
    errors, timings = [], []
    incorrect = 0
    for ayah, word, form, start, end in spans:
        issues = word_errors(form, heard[start:end])
        if attribute_map:
            issues.extend(attribute_errors(form, phones[start:end], attribute_map))
        incorrect += bool(issues)
        for issue in issues:
            errors.append(
                dict(ayah=ayah, wordIndex=word, phonetic=form.script, **issue)
            )
        if end > start:
            timings.append(
                dict(
                    ayah=ayah,
                    wordIndex=word,
                    start=phones[start].start,
                    end=phones[end - 1].end,
                )
            )
    total = len(spans)
    return dict(
        surah=surah,
        startAyah=start_ayah,
        endAyah=spans[-1][0],
        totalWords=total,
        correctWords=total - incorrect,
        percentage=round(100 * (total - incorrect) / total),
        errors=errors,
        wordTimings=timings,
    )


def analyze(audio, surah, start_ayah, end_ayah):
    if not len(audio) or float(np.max(np.abs(audio))) < 0.001:
        raise EngineError("no_voice", "No voice was heard.")
    if len(audio) < SAMPLE_RATE // 5:
        raise EngineError("mismatch", "Too little recognizable recitation.")
    try:
        phones, heads = transcribe(audio)
        return score_phones(phones, surah, start_ayah, end_ayah, heads)
    except EngineError:
        raise
    except Exception as exc:
        log.exception("Recitation analysis failed")
        raise EngineError(
            "unavailable", "The analysis service could not process the recording."
        ) from exc

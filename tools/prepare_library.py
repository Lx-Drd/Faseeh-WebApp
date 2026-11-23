"""Refresh the seven local study surahs from Quran Foundation. Requires FFmpeg."""
import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from urllib.request import urlopen

WEB = Path(__file__).resolve().parents[1] / "web"
API = "https://api.quran.com/api/v4"
CHAPTERS = [
    (78, "An-Naba", "النبأ", 40),
    (80, "Abasa", "عبس", 42),
    (103, "Al-Asr", "العصر", 3),
    (108, "Al-Kawthar", "الكوثر", 3),
    (112, "Al-Ikhlas", "الإخلاص", 4),
    (113, "Al-Falaq", "الفلق", 5),
    (114, "An-Nas", "الناس", 6),
]


def load_json(url):
    with urlopen(url, timeout=90) as response:
        return json.load(response)


def prepare_chapter(directory, number, name, arabic_name, count):
    query = "language=en&words=true&word_fields=text_uthmani&fields=text_uthmani&per_page=50"
    verses = load_json(f"{API}/verses/by_chapter/{number}?{query}")["verses"]
    recording = load_json(f"{API}/chapter_recitations/9/{number}?segments=true")["audio_file"]
    expected = f"https://download.quranicaudio.com/qdc/siddiq_minshawi/murattal/{number}.mp3"
    if recording["audio_url"] != expected or len(verses) != count:
        raise ValueError(f"Review updated source data for surah {number}")

    source = directory / f"chapter-{number}.mp3"
    with urlopen(expected, timeout=180) as response, source.open("wb") as output:
        shutil.copyfileobj(response, output)
    ayahs = []
    for verse, timed in zip(verses, recording["timestamps"], strict=True):
        if timed["verse_key"] != verse["verse_key"]:
            raise ValueError(f"Unmatched reference timing at {verse['verse_key']}")
        start, stop = timed["timestamp_from"], timed["timestamp_to"]
        filename = f"{number}-{verse['verse_number']}.mp3"
        subprocess.run([
            "ffmpeg", "-nostdin", "-v", "error", "-threads", "1", "-ss", str(start / 1000),
            "-i", str(source), "-t", str((stop - start) / 1000), "-vn", "-map_metadata", "-1",
            "-c:a", "libmp3lame", "-q:a", "4", str(directory / "audio" / filename),
        ], check=True)

        segments = {}
        for position, first, last in timed["segments"]:
            if position in segments:
                first = min(first, segments[position][0])
                last = max(last, segments[position][1])
            segments[position] = (first, last)
        words = []
        for word in verse["words"]:
            if word["char_type_name"] != "word":
                continue
            first, last = segments[word["position"]]
            if not start <= first < last <= stop:
                raise ValueError(f"Invalid time for word {word['position']} of {verse['verse_key']}")
            words.append({
                "text": word["text_uthmani"], "transliteration": word["transliteration"]["text"],
                "start": round((first - start) / 1000, 3), "end": round((last - start) / 1000, 3),
            })
        ayahs.append({
            "number": verse["verse_number"], "text": verse["text_uthmani"],
            "transliteration": " ".join(w["transliteration"] for w in words),
            "words": words, "audio": f"/audio/{filename}",
        })
    return {"id": number, "name": name, "arabicName": arabic_name, "ayahs": ayahs}


def main():
    # Validate the full download before replacing any installed catalog or clip.
    with tempfile.TemporaryDirectory() as scratch:
        directory = Path(scratch)
        (directory / "audio").mkdir()
        catalog = [prepare_chapter(directory, *chapter) for chapter in CHAPTERS]
        (WEB / "audio").mkdir(exist_ok=True)
        (WEB / "data").mkdir(exist_ok=True)
        for clip in (directory / "audio").iterdir():
            shutil.copyfile(clip, WEB / "audio" / clip.name)
        (WEB / "data" / "surahs.json").write_text(
            json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
        )


if __name__ == "__main__":
    main()

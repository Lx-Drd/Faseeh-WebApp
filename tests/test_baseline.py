import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from baseline import (  # noqa: E402
    build_multipart,
    find_samples,
    parse_sample_name,
    percentile,
    percentile_summary,
    record_metrics,
    render_markdown,
    summarize_timings,
)


@pytest.mark.parametrize("name, expected", [
    ("112001.webm", (112, 1)),
    ("114006_take3.mp4", (114, 6)),
    ("data/samples/own/113005-x.ogg", (113, 5)),
    ("1120011.webm", None),     # 7 digits: not SSSAAA
    ("112000.webm", None),      # ayah 0
    ("take_112001.webm", None),
    ("12001.webm", None),
])
def test_parse_sample_name(name, expected):
    assert parse_sample_name(name) == expected


def test_percentile_hand_computed():
    values = [10.0, 20.0, 30.0, 40.0, 50.0]
    # position = (n - 1) * q / 100
    assert percentile(values, 50) == 30.0          # pos 2
    assert percentile(values, 95) == 48.0          # pos 3.8 -> 40 + 0.8 * 10
    assert percentile(values, 0) == 10.0
    assert percentile(values, 100) == 50.0
    assert percentile([7.0], 95) == 7.0
    assert percentile([1.0, 3.0], 50) == 2.0
    with pytest.raises(ValueError):
        percentile([], 50)


def test_percentile_summary_sorts_and_rounds():
    assert percentile_summary([50.0, 10.0, 40.0, 20.0, 30.0]) == {"n": 5, "p50": 30.0, "p95": 48.0, "max": 50.0}
    assert percentile_summary([]) == {"n": 0}


def _rec(source, pass_no, timings, total, request_ms, http=200):
    return {"source": source, "pass": pass_no, "httpStatus": http, "requestMs": request_ms,
            "debug": {"timingsMs": timings, "totalMs": total}}


def test_record_metrics_merges_server_and_client_times():
    r = _rec("husary", 1, {"decodeUser": 5.0, "dtw": 7.0}, 12.0, 20.0)
    assert record_metrics(r) == {"decodeUser": 5.0, "dtw": 7.0, "totalMs": 12.0, "requestMs": 20.0}
    assert record_metrics({"requestMs": 3.0, "debug": None}) == {"requestMs": 3.0}


def test_summarize_timings_excludes_warmup_failures_and_skipped_filters():
    records = [
        _rec("husary", 0, {"decodeUser": 999.0, "dtw": 999.0}, 1998.0, 2500.0),   # warm-up: excluded
        _rec("husary", 1, {"decodeUser": 10.0, "dtw": 100.0}, 110.0, 120.0),
        _rec("husary", 2, {"decodeUser": 20.0, "dtw": 300.0}, 320.0, 330.0),
        _rec("own", 1, {"decodeUser": 30.0}, 30.0, 40.0),                        # early exit: no dtw
        _rec("own", 1, {"decodeUser": 1.0}, 1.0, 2.0, http=422),                 # failed: excluded
    ]
    s = summarize_timings(records, ["decodeUser", "dtw", "totalMs", "requestMs"])
    assert set(s) == {"husary", "own", "all"}
    assert s["husary"]["dtw"] == {"n": 2, "p50": 200.0, "p95": 290.0, "max": 300.0}
    assert s["own"]["dtw"] == {"n": 0}
    assert s["all"]["decodeUser"] == {"n": 3, "p50": 20.0, "p95": 29.0, "max": 30.0}
    assert s["all"]["dtw"]["n"] == 2
    assert s["all"]["requestMs"]["max"] == 330.0


def test_render_markdown_lists_groups_and_outcomes():
    records = [_rec("husary", 1, {"dtw": 100.0}, 100.0, 110.0)]
    records[0].update(status="ok", reason=None)
    records[0]["debug"]["userSeconds"] = 2.5
    text = render_markdown(summarize_timings(records, ["dtw", "wordCosts"]), records)
    assert "#### husary" in text and "#### all" in text
    assert "| dtw | 1 | 100.0 | 100.0 | 100.0 |" in text
    assert "| wordCosts | 0 | – | – | – |" in text
    assert "| husary | 200 | ok | – | 1 |" in text
    assert "2.50–2.50 s" in text


def test_build_multipart_layout():
    body, header = build_multipart({"surah": "112", "ayah": "1"}, "file", "a.webm", b"\x00\x01", "audio/webm", "XYZ")
    assert header == "multipart/form-data; boundary=XYZ"
    assert body == (
        b'--XYZ\r\nContent-Disposition: form-data; name="surah"\r\n\r\n112\r\n'
        b'--XYZ\r\nContent-Disposition: form-data; name="ayah"\r\n\r\n1\r\n'
        b'--XYZ\r\nContent-Disposition: form-data; name="file"; filename="a.webm"\r\n'
        b"Content-Type: audio/webm\r\n\r\n\x00\x01\r\n--XYZ--\r\n"
    )


def test_find_samples_skips_hidden_dirs_bad_names_and_non_audio(tmp_path, capsys):
    (tmp_path / "own").mkdir()
    (tmp_path / ".downloads").mkdir()
    (tmp_path / "own" / "112001_a.webm").write_bytes(b"x")
    (tmp_path / "own" / "notes.txt").write_text("x")
    (tmp_path / "own" / "take.webm").write_bytes(b"x")
    (tmp_path / ".downloads" / "112001.mp3").write_bytes(b"x")
    found = find_samples(tmp_path)
    assert [(s, p.name, su, a) for s, p, su, a in found] == [("own", "112001_a.webm", 112, 1)]
    assert "take.webm" in capsys.readouterr().out

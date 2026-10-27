"""
Phase 0 baseline: measure how long each pipeline filter takes in `dtw` mode, before any
accuracy work changes the pipeline.

    python scripts/baseline.py prepare            # stand-in samples (Husary, as browser-like webm)
    python scripts/baseline.py run                # start the server in dtw mode, send every sample
    python scripts/baseline.py summarize          # p50/p95 per filter from the latest run

Samples live in data/samples/<source>/SSSAAA*.<ext> (git-ignored):
    data/samples/husary/   stand-in "user" audio: another expert reciter, made by `prepare`
    data/samples/own/      your own recordings, e.g. 112001_take1.webm

`run` writes data/eval/baseline_<ts>.jsonl (one line per request: sample, pass, HTTP status,
client wall time and the server's debug dict, taken from FASEEH_CALIBRATION_LOG) plus
baseline_<ts>.meta.json (machine, versions, git commit, /health). Pass 0 is a warm-up
(reference downloads, first-call overheads) and is excluded from the summary.
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SAMPLES_DIR = ROOT / "data" / "samples"
EVAL_DIR = ROOT / "data" / "eval"
DOWNLOADS_DIR = SAMPLES_DIR / ".downloads"

STAND_IN_RECITER = "husary"
STAND_IN_URL = "https://everyayah.com/data/Husary_128kbps/"
AUDIO_EXTENSIONS = {".webm", ".mp4", ".m4a", ".ogg", ".mp3", ".wav", ".flac"}
CONTENT_TYPES = {
    ".webm": "audio/webm", ".mp4": "audio/mp4", ".m4a": "audio/x-m4a", ".ogg": "audio/ogg",
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".flac": "audio/flac",
}
# Filters in pipeline order (keys of debug["timingsMs"]), then the server and client totals.
FILTERS = ["decodeUser", "qualityGate", "decodeReference", "features", "dtw", "wordCosts"]
TOTALS = ["totalMs", "requestMs"]

_SAMPLE_NAME = re.compile(r"^(\d{3})(\d{3})(?!\d)")


# ---------------------------------------------------------------------------
# Pure helpers (unit-tested in tests/test_baseline.py)
# ---------------------------------------------------------------------------
def parse_sample_name(name: str) -> tuple[int, int] | None:
    """'112001_take1.webm' -> (112, 1). None when the name doesn't start with SSSAAA."""
    m = _SAMPLE_NAME.match(Path(name).name)
    if not m:
        return None
    surah, ayah = int(m.group(1)), int(m.group(2))
    return (surah, ayah) if ayah >= 1 else None


def percentile(sorted_values: list[float], q: float) -> float:
    """Linear-interpolation percentile (numpy's default method) of an already sorted list."""
    if not sorted_values:
        raise ValueError("percentile of an empty list")
    pos = (len(sorted_values) - 1) * q / 100
    lo = int(pos)
    hi = min(lo + 1, len(sorted_values) - 1)
    return sorted_values[lo] + (sorted_values[hi] - sorted_values[lo]) * (pos - lo)


def percentile_summary(values: list[float]) -> dict:
    """n / p50 / p95 / max, or just n=0 when there are no values."""
    if not values:
        return {"n": 0}
    s = sorted(values)
    return {"n": len(s), "p50": round(percentile(s, 50), 1),
            "p95": round(percentile(s, 95), 1), "max": round(s[-1], 1)}


def record_metrics(record: dict) -> dict[str, float]:
    """Timings of one request: each filter that ran, the server totalMs and the client requestMs."""
    debug = record.get("debug") or {}
    metrics = {k: float(v) for k, v in (debug.get("timingsMs") or {}).items()}
    for key, value in (("totalMs", debug.get("totalMs")), ("requestMs", record.get("requestMs"))):
        if value is not None:
            metrics[key] = float(value)
    return metrics


def summarize_timings(records: list[dict], metrics: list[str] = FILTERS + TOTALS) -> dict:
    """{group: {metric: percentile_summary}} for each source and for "all".

    Only measured passes (pass >= 1) of successful requests count. A filter's stats include
    only the requests where it ran: early "unclear" exits skip the later filters.
    """
    groups: dict[str, list[dict]] = {}
    for r in records:
        if r.get("pass", 0) < 1 or r.get("httpStatus") != 200:
            continue
        groups.setdefault(r["source"], []).append(r)
        groups.setdefault("all", []).append(r)
    out = {}
    for group, rows in groups.items():
        per_request = [record_metrics(r) for r in rows]
        out[group] = {m: percentile_summary([p[m] for p in per_request if m in p]) for m in metrics}
    return out


def build_multipart(fields: dict[str, str], file_field: str, filename: str,
                    content: bytes, content_type: str, boundary: str) -> tuple[bytes, str]:
    """multipart/form-data body and its Content-Type header value."""
    parts = []
    for name, value in fields.items():
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'
                     .encode("utf-8"))
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{file_field}"; '
                 f'filename="{filename}"\r\nContent-Type: {content_type}\r\n\r\n'.encode("utf-8"))
    parts.append(content)
    parts.append(f"\r\n--{boundary}--\r\n".encode("utf-8"))
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def render_markdown(summary: dict, records: list[dict]) -> str:
    """Latency tables (one per group) plus outcome counts and audio lengths."""
    lines = []
    for group in sorted(summary, key=lambda g: (g == "all", g)):
        lines += [f"#### {group}", "", "| metric | n | p50 ms | p95 ms | max ms |", "|---|---|---|---|---|"]
        for metric, s in summary[group].items():
            if s["n"]:
                lines.append(f"| {metric} | {s['n']} | {s['p50']} | {s['p95']} | {s['max']} |")
            else:
                lines.append(f"| {metric} | 0 | – | – | – |")
        lines.append("")

    measured = [r for r in records if r.get("pass", 0) >= 1]
    outcomes = Counter((r["source"], r.get("httpStatus"), r.get("status"), r.get("reason")) for r in measured)
    lines += ["#### Outcomes (measured passes)", "", "| source | HTTP | status | reason | count |",
              "|---|---|---|---|---|"]
    for (source, http, status, reason), n in sorted(outcomes.items(), key=lambda kv: str(kv[0])):
        lines.append(f"| {source} | {http} | {status} | {reason or '–'} | {n} |")
    lines.append("")

    lengths = [(r.get("debug") or {}).get("userSeconds") for r in measured]
    lengths = [x for x in lengths if x is not None]
    if lengths:
        lines.append(f"Voiced user audio: {min(lengths):.2f}–{max(lengths):.2f} s per request.")
    return "\n".join(lines).rstrip() + "\n"


# ---------------------------------------------------------------------------
# prepare
# ---------------------------------------------------------------------------
def _download(url: str, target: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "Faseeh-baseline/0.1"})
    with urllib.request.urlopen(request, timeout=30) as resp:
        if not resp.headers.get("Content-Type", "").startswith("audio/"):
            raise ValueError(f"not audio: {resp.headers.get('Content-Type')}")
        data = resp.read()
    if not data:
        raise ValueError("empty response")
    partial = target.with_suffix(".part")
    partial.write_bytes(data)
    partial.replace(target)


def cmd_prepare(_: argparse.Namespace) -> int:
    sys.path.insert(0, str(ROOT))
    from analysis import find_ffmpeg
    from quran_data import SURAHS
    from reference import reference_name

    ffmpeg = find_ffmpeg()
    if ffmpeg is None:
        print("ffmpeg not found (pip install imageio-ffmpeg)")
        return 1
    raw_dir = DOWNLOADS_DIR / STAND_IN_RECITER
    out_dir = SAMPLES_DIR / STAND_IN_RECITER
    raw_dir.mkdir(parents=True, exist_ok=True)
    out_dir.mkdir(parents=True, exist_ok=True)
    (SAMPLES_DIR / "own").mkdir(exist_ok=True)

    failures = []
    names = [reference_name(s.number, a.number) for s in SURAHS.values() for a in s.ayat]
    for name in names:
        mp3, webm = raw_dir / f"{name}.mp3", out_dir / f"{name}.webm"
        try:
            if not mp3.is_file():
                _download(f"{STAND_IN_URL}{name}.mp3", mp3)
            # Browser-like upload: mono Opus in webm at 48 kHz, like MediaRecorder in Chrome.
            proc = subprocess.run(
                [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(mp3),
                 "-ac", "1", "-ar", "48000", "-c:a", "libopus", "-b:a", "64k", str(webm)],
                capture_output=True, timeout=60,
            )
            if proc.returncode != 0:
                raise RuntimeError(proc.stderr.decode(errors="ignore").strip()[-200:])
            print(f"ok   {name}  {webm.stat().st_size // 1024} KB")
        except Exception as exc:
            failures.append(name)
            print(f"FAIL {name}: {exc}")
    print(f"{len(names) - len(failures)}/{len(names)} stand-in samples ready in {out_dir}")
    return 1 if failures else 0


# ---------------------------------------------------------------------------
# run
# ---------------------------------------------------------------------------
def find_samples(root: Path = SAMPLES_DIR) -> list[tuple[str, Path, int, int]]:
    """(source, path, surah, ayah) for every SSSAAA* audio file under data/samples/<source>/."""
    found = []
    for path in sorted(root.glob("*/*")):
        source = path.parent.name
        if source.startswith(".") or path.suffix.lower() not in AUDIO_EXTENSIONS:
            continue
        parsed = parse_sample_name(path.name)
        if parsed is None:
            print(f"skip {path.relative_to(root)}: name must start with SSSAAA, e.g. 112001_take1.webm")
            continue
        found.append((source, path, *parsed))
    return found


def _get_json(url: str, timeout: float = 5) -> dict:
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _post_sample(base_url: str, path: Path, surah: int, ayah: int) -> tuple[int, dict, float]:
    body, content_type = build_multipart(
        {"surah": str(surah), "ayah": str(ayah)}, "file", path.name, path.read_bytes(),
        CONTENT_TYPES.get(path.suffix.lower(), "application/octet-stream"), uuid.uuid4().hex,
    )
    request = urllib.request.Request(f"{base_url}/analyze", data=body, method="POST",
                                     headers={"Content-Type": content_type})
    start = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=180) as resp:
            status, payload = resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        status, payload = exc.code, json.loads(exc.read().decode("utf-8") or "{}")
    return status, payload, round((time.perf_counter() - start) * 1000, 1)


def _read_new_lines(path: Path, already: int) -> list[dict]:
    if not path.is_file():
        return []
    with open(path, encoding="utf-8") as fh:
        lines = [ln for ln in fh if ln.strip()]
    return [json.loads(ln) for ln in lines[already:]]


def _machine_info() -> dict:
    from importlib.metadata import PackageNotFoundError, version

    versions = {}
    for pkg in ("fastapi", "uvicorn", "librosa", "fastdtw", "numpy", "scipy", "numba", "imageio-ffmpeg"):
        try:
            versions[pkg] = version(pkg)
        except PackageNotFoundError:
            versions[pkg] = None
    try:
        commit = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT,
                                capture_output=True, text=True).stdout.strip()
        # Uncommitted edits to tracked Python files (the pipeline), ignoring new untracked files.
        dirty = bool(subprocess.run(["git", "status", "--porcelain", "--untracked-files=no", "--", "*.py"],
                                    cwd=ROOT, capture_output=True, text=True).stdout.strip())
    except OSError:
        commit, dirty = None, None
    return {
        "platform": platform.platform(),
        "processor": platform.processor(),
        "cpuCount": os.cpu_count(),
        "python": platform.python_version(),
        "packages": versions,
        "gitCommit": commit,
        "gitPyDirty": dirty,
    }


def cmd_run(args: argparse.Namespace) -> int:
    samples = find_samples()
    if not samples:
        print(f"No samples under {SAMPLES_DIR}. Run `prepare` first.")
        return 1
    print("Samples per source:", dict(Counter(s[0] for s in samples)))

    EVAL_DIR.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d_%H%M%S")
    out_path = EVAL_DIR / f"baseline_{stamp}.jsonl"
    calib_path = EVAL_DIR / f"baseline_{stamp}.calibration.jsonl"
    server_log = EVAL_DIR / f"baseline_{stamp}.server.log"

    env = dict(os.environ, FASEEH_ANALYSIS_MODE="dtw", FASEEH_CALIBRATION_LOG=str(calib_path))
    base_url = f"http://127.0.0.1:{args.port}"
    with open(server_log, "w", encoding="utf-8") as log:
        server = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", str(args.port)],
            cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT,
        )
        try:
            health = None
            for _ in range(120):
                if server.poll() is not None:
                    print(f"Server exited early; see {server_log}")
                    return 1
                try:
                    health = _get_json(f"{base_url}/health")
                    break
                except (urllib.error.URLError, ConnectionError, TimeoutError):
                    time.sleep(0.5)
            if health is None or health.get("mode") != "dtw":
                print(f"Server not ready in dtw mode (health={health}); see {server_log}")
                return 1

            meta = {"startedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "repeats": args.repeats,
                    "machine": _machine_info(), "health": health,
                    "samples": dict(Counter(s[0] for s in samples))}
            (EVAL_DIR / f"baseline_{stamp}.meta.json").write_text(
                json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

            seen = 0
            with open(out_path, "w", encoding="utf-8") as out:
                for pass_no in range(args.repeats + 1):
                    label = "warm-up" if pass_no == 0 else f"pass {pass_no}/{args.repeats}"
                    for source, path, surah, ayah in samples:
                        http, payload, request_ms = _post_sample(base_url, path, surah, ayah)
                        new = _read_new_lines(calib_path, seen)
                        seen += len(new)
                        debug = new[-1]["debug"] if new else None
                        record = {"sample": path.name, "source": source, "surah": surah, "ayah": ayah,
                                  "pass": pass_no, "httpStatus": http, "requestMs": request_ms,
                                  "status": payload.get("status"), "reason": payload.get("reason"),
                                  "score": payload.get("score"), "detail": payload.get("detail"),
                                  "debug": debug}
                        out.write(json.dumps(record, ensure_ascii=False) + "\n")
                        out.flush()
                        print(f"[{label}] {source}/{path.name}: HTTP {http} {payload.get('status')} "
                              f"{payload.get('reason') or ''} {request_ms} ms")
        finally:
            server.terminate()
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.kill()
    print(f"Wrote {out_path}")
    return 0


# ---------------------------------------------------------------------------
# summarize
# ---------------------------------------------------------------------------
def cmd_summarize(args: argparse.Namespace) -> int:
    path = Path(args.file) if args.file else None
    if path is None:
        runs = sorted(p for p in EVAL_DIR.glob("baseline_*.jsonl") if ".calibration" not in p.name)
        if not runs:
            print(f"No baseline runs in {EVAL_DIR}. Use `run` first.")
            return 1
        path = runs[-1]
    with open(path, encoding="utf-8") as fh:
        records = [json.loads(ln) for ln in fh if ln.strip()]
    text = f"Run: `{path.name}`\n\n" + render_markdown(summarize_timings(records), records)
    print(text)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
        print(f"Wrote {args.out}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("prepare", help="download and transcode the stand-in samples")
    run = sub.add_parser("run", help="start the server in dtw mode and send every sample")
    run.add_argument("--repeats", type=int, default=3, help="measured passes after the warm-up (default 3)")
    run.add_argument("--port", type=int, default=8765)
    summ = sub.add_parser("summarize", help="p50/p95 per filter from a run")
    summ.add_argument("--file", help="a baseline_<ts>.jsonl (default: the latest)")
    summ.add_argument("--out", help="also write the markdown to this file")
    args = parser.parse_args(argv)
    return {"prepare": cmd_prepare, "run": cmd_run, "summarize": cmd_summarize}[args.command](args)


if __name__ == "__main__":
    sys.exit(main())

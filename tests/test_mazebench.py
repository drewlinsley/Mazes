"""End-to-end checks of the MazeBench pipeline (needs node and the engine submodule)."""
import json
import os
import shutil
import subprocess

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENGINE = os.environ.get("MAZEBENCH_ENGINE_DIR") or os.path.join(ROOT, "vendor", "MazeBenchEngine")
HAVE_ENGINE = shutil.which("node") is not None and os.path.exists(os.path.join(ENGINE, "public", "maze-engine.js"))

pytestmark = pytest.mark.skipif(not HAVE_ENGINE, reason="node and vendor/MazeBenchEngine are required")


def run(args, timeout=600):
    return subprocess.run(["node"] + args, cwd=ROOT, capture_output=True, text=True, timeout=timeout)


def read_jsonl(path):
    return [json.loads(line) for line in open(path) if line.strip()]


def test_engine_solves_a_shipped_room(tmp_path):
    out = tmp_path / "rooms.jsonl"
    r = run(["mazebench/solve_rooms.js", "--only", "0ukthqlnj3,1ji0bl8utq", "--out", str(out)])
    assert r.returncode == 0, r.stderr
    rows = {row["id"]: row for row in read_jsonl(out)}
    assert rows["0ukthqlnj3"]["status"] == "solved" and rows["0ukthqlnj3"]["moves"] == 117
    assert set(rows["0ukthqlnj3"]["path"]) <= set("UDLR") and len(rows["0ukthqlnj3"]["path"]) == 117
    assert rows["1ji0bl8utq"]["status"] == "no-gem"
    assert "ice" in rows["0ukthqlnj3"]["tags"]


def test_perturb_makes_verified_pairs(tmp_path):
    out = tmp_path / "variants.jsonl"
    r = run(["mazebench/perturb.js", "--only", "0ukthqlnj3", "--rooms", "/nonexistent", "--out", str(out), "--pairs-per-room", "2", "--room-budget", "60"])
    assert r.returncode == 0, r.stderr
    rows = read_jsonl(out)
    assert len(rows) == 4
    pairs = {}
    for row in rows:
        pairs.setdefault(row["pair"], []).append(row)
        assert row["room"] == "0ukthqlnj3"
        assert len(row["edit"]["changes"]) in (1, 2)
        assert row["level"].count("\n") == 16
        if row["solvable"]:
            assert row["moves"] >= 1
        else:
            assert row["moves"] is None
    for members in pairs.values():
        assert sorted(m["solvable"] for m in members) == [False, True]
        # a pair differs at no more than four cells (two single-cell edits of the original at most two cells each)
        a, b = (m["level"].split("\n") for m in members)
        diffs = sum(1 for ra, rb in zip(a, b) for ca, cb in zip(ra.split(" "), rb.split(" ")) if ca != cb)
        assert 1 <= diffs <= 4


def test_generated_rooms_have_mechanics_and_pairs(tmp_path):
    out = tmp_path / "generated.jsonl"
    r = run(["mazebench/generate_rooms.js", "--n", "3", "--type", "mixed", "--seed", "11", "--out", str(out), "--room-budget", "40"])
    assert r.returncode == 0, r.stderr
    rows = read_jsonl(out)
    assert len(rows) == 6
    assert all(row["generated"]["type"] in ("maze", "ice", "boxes", "holes", "orange") for row in rows)
    assert sum(row["solvable"] for row in rows) == 3
    for row in rows:
        assert ".+p" in row["level"] and ".+G" in row["level"]


def test_render_verifies_labels_and_writes_manifest(tmp_path):
    variants = tmp_path / "v.jsonl"
    r = run(["mazebench/generate_rooms.js", "--n", "1", "--type", "maze", "--layout", "maze", "--seed", "5", "--out", str(variants), "--room-budget", "30"])
    assert r.returncode == 0, r.stderr
    out = tmp_path / "render"
    r = run(["mazebench/render.js", "--variants", str(variants), "--out", str(out), "--size", "256", "--views", "perspective"], timeout=900)
    assert r.returncode == 0, r.stderr
    rows = read_jsonl(out / "manifest.jsonl")
    assert len(rows) == 2
    for row in rows:
        assert row["verified"] == row["solvable"]
        assert os.path.getsize(out / row["images"]["perspective"]) > 1000
        ascii_text = open(out / row["ascii"]).read()
        assert "P" in ascii_text and "G" in ascii_text and "W" in ascii_text
        assert row["legend"].get("P") == "player" and row["legend"].get("G") == "gem"

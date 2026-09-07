"""The Verifiers environment builds balanced multimodal prompts and scores answers (needs `verifiers`)."""
import json
import os
import sys

import pytest

vf = pytest.importorskip("verifiers")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "environments", "maze_snapshot"))
from maze_snapshot import load_environment  # noqa: E402


def reward_funcs(env):
    """The environment wraps the task rubric in a RubricGroup with its own monitor rubric."""
    rubric = env.rubric
    rubrics = getattr(rubric, "rubrics", None) or [rubric]
    return {f.__name__: f for rb in rubrics for f in getattr(rb, "funcs", [])}


def test_maze_environment_prompts_and_rewards():
    env = load_environment(source="mazes", n=6, representation="both", preset="easy", seed="t")
    ds = env.get_dataset()
    assert len(ds) == 6 and sorted(ds["answer"]) == ["NO"] * 3 + ["YES"] * 3
    content = ds[0]["prompt"][0]["content"]
    assert [c["type"] for c in content] == ["image_url", "text"]
    assert content[0]["image_url"]["url"].startswith("data:image/png;base64,")
    assert "ANSWER: YES" in content[1]["text"] and "#" in content[1]["text"]
    parser = env.parser
    funcs = reward_funcs(env)
    assert {"correct", "answered", "said_yes"} <= set(funcs)
    completion = [{"role": "assistant", "content": "Tracing...\nANSWER: NO"}]
    assert funcs["correct"](completion=completion, answer="NO", parser=parser) == 1.0
    assert funcs["correct"](completion=completion, answer="YES", parser=parser) == 0.0
    assert funcs["answered"](completion=[{"role": "assistant", "content": "maybe"}], parser=parser) == 0.0
    assert funcs["said_yes"](completion=[{"role": "assistant", "content": "ANSWER: YES"}], parser=parser) == 1.0


def test_room_environment_from_manifest(tmp_path):
    root = tmp_path
    (root / "images").mkdir()
    (root / "ascii").mkdir()
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 16
    rows = []
    for k, solvable in ((0, True), (1, False)):
        rid = f"r-0-{'yes' if solvable else 'no'}"
        (root / "images" / f"{rid}.png").write_bytes(png)
        (root / "images" / f"{rid}-y180.png").write_bytes(png)
        (root / "ascii" / f"{rid}.txt").write_text("WWW\nWPG\n")
        rows.append({"id": rid, "pair": "r-0", "solvable": solvable, "verified": solvable, "tags": ["ice"], "edit": {"type": "add_wall"},
                     "images": {"perspective": f"images/{rid}.png", "yaws": {"0": f"images/{rid}.png", "180": f"images/{rid}-y180.png"}},
                     "ascii": f"ascii/{rid}.txt", "legend": {"W": "wall", "P": "player", "G": "gem"}})
    (root / "manifest.jsonl").write_text("\n".join(json.dumps(r) for r in rows) + "\n")
    env = load_environment(source="rooms", manifest=str(root / "manifest.jsonl"), n=2, representation="both", yaws="0,180")
    ds = env.get_dataset()
    assert sorted(ds["answer"]) == ["NO", "YES"]
    content = ds[0]["prompt"][0]["content"]
    assert [c["type"] for c in content] == ["image_url", "image_url", "text"]
    assert "rotated in 90-degree steps" in content[-1]["text"] and "WPG" in content[-1]["text"]
    info = ds[0]["info"] if isinstance(ds[0]["info"], dict) else json.loads(ds[0]["info"])
    assert info["edit_type"] == "add_wall" and info["tags"] == ["ice"]

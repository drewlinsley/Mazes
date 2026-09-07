"""The JS reference (web/maze.js) and the Python port must agree exactly."""
import json
import os
import shutil
import subprocess

import pytest

import mazes
from mazes.prng import Mulberry32, normalize_seed
from mazes.prompt import build_prompt, build_room_prompt, parse_answer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DUMP = os.path.join(ROOT, "tests", "parity_dump.js")

COMBOS = [
    {"width": 9, "height": 7, "seed": 1, "algorithm": "backtracker", "placement": "random", "cut": "balanced", "loops": 3},
    {"width": 9, "height": 7, "seed": 2, "algorithm": "kruskal", "placement": "border", "cut": "random", "loops": 3},
    {"width": 9, "height": 7, "seed": 3, "algorithm": "prim", "placement": "corners", "cut": 0.1, "loops": 3},
    {"width": 9, "height": 7, "seed": 4, "algorithm": "backtracker", "placement": "far", "cut": 0.9, "loops": 0},
    {"width": 3, "height": 3, "seed": 5, "loops": 4},
    {"width": 24, "height": 24, "seed": "hello", "placement": "far", "loops": 12},
    {"width": 16, "height": 10, "seed": -7, "algorithm": "kruskal", "loops": 2},
    {"width": 12, "height": 12, "seed": "mäze ✓", "algorithm": "prim", "placement": "border", "cut": "random", "loops": 5},
]


@pytest.mark.skipif(shutil.which("node") is None, reason="node is required for the parity test")
@pytest.mark.parametrize("params", COMBOS, ids=[str(i) for i in range(len(COMBOS))])
def test_js_python_parity(params):
    js = json.loads(subprocess.check_output(["node", DUMP, json.dumps(params)]))
    rnd = Mulberry32(normalize_seed(params["seed"]))
    pos, neg = mazes.generate_pair(params)
    py = {
        "seed": normalize_seed(params["seed"]),
        "draws": [rnd.random() for _ in range(8)],
        "positive": pos.to_dict(),
        "negative": neg.to_dict(),
        "coin": mazes.generate(params).solvable,
        "ascii": mazes.to_ascii(neg),
        "seedHashes": {k: normalize_seed(v) for k, v in
                       {"hello": "hello", "neg": "-7", "big": "123456789012345", "uni": "mäze ✓"}.items()},
        "prompts": [build_prompt("image"), build_prompt("ascii"), build_prompt("both", markers="dots", theme="dark"),
                    build_prompt("image", grayscale=True), build_prompt("image", markers="letters", theme="dark")],
        "roomPrompts": [build_room_prompt("image", {}, "perspective"), build_room_prompt("ascii", {"W": "wall", "P": "player", "G": "gem"}, "top"),
                        build_room_prompt("both", {"I": "ice"}, "top")],
        "parsed": [parse_answer(t) for t in ["blah\nANSWER: NO", "yes it is.\nANSWER: YES", "I think no", "unclear",
                                             "ANSWER: yes\nANSWER: no", "", "Yes and no"]],
    }
    py = json.loads(json.dumps(py))
    for key in py:
        assert py[key] == js[key], key

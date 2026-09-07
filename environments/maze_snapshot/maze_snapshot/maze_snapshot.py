"""maze-snapshot: a Prime Intellect Verifiers environment.

One turn: the model receives a snapshot (an image, the text form, or both) of a
maze or a MazeBench room and answers whether it is solvable. Exactly half of
the examples are solvable. Rewards are deterministic: 1 when the final
"ANSWER: YES/NO" line matches the label, 0 otherwise.

Sources
-------
- ``source="mazes"`` (default): 2D mazes generated in-process by the ``mazes``
  package with the same seeds and minimal-pair construction as the website
  (parameters: ``preset`` or ``width``/``height``/``loops``/``cut``/
  ``placement``/``algorithm``; rendering: ``theme``/``markers``/``grayscale``).
- ``source="rooms"``: pre-rendered MazeBench rooms from a ``manifest.jsonl``
  written by ``mazebench/render.js`` (``manifest=`` path, ``view=``
  ``perspective``|``top``, ``yaws=`` e.g. ``"0"`` or ``"0,90,180,270"`` to send
  several camera rotations). Pairs are kept together so labels stay balanced.

``representation`` is ``image``, ``ascii`` or ``both`` (rooms also accept
``json``, the engine's JSON observation).
"""
import base64
import io
import json
import os
import sys

import verifiers as vf
from datasets import Dataset

# allow a source checkout (environments/maze_snapshot) to find the repo's `mazes` package
_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
if os.path.isdir(os.path.join(_REPO_ROOT, "mazes")) and _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

import mazes  # noqa: E402
from mazes.prng import Mulberry32, normalize_seed  # noqa: E402
from mazes.prompt import build_prompt, build_room_prompt, parse_answer  # noqa: E402
from mazes.render import RenderOptions  # noqa: E402


class AnswerParser(vf.Parser):
    """Extracts YES / NO from the model's final 'ANSWER:' line."""

    def parse(self, text):
        found = parse_answer(text)
        return found.upper() if found in ("yes", "no") else None


def _image_block(png_bytes):
    return {"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.standard_b64encode(png_bytes).decode("ascii")}}


def _balanced_trials(n, session_seed):
    """Same construction as the website and scripts/eval_model.py: exact 50/50, shuffled."""
    rnd = Mulberry32(normalize_seed(session_seed))
    labels = [i % 2 == 0 for i in range(n)]
    rnd.shuffle(labels)
    return [(normalize_seed(f"{session_seed}:{i}"), lab) for i, lab in enumerate(labels)]


def _maze_rows(n, seed, representation, params, ropts):
    rows = []
    prompt = build_prompt(representation, markers=ropts.markers, grayscale=ropts.grayscale, theme=ropts.theme)
    for maze_seed, solvable in _balanced_trials(n, seed):
        m = mazes.generate(dict(params, seed=maze_seed), solvable=solvable)
        content = []
        if representation != "ascii":
            buf = io.BytesIO()
            mazes.render_image(m, ropts).save(buf, format="PNG")
            content.append(_image_block(buf.getvalue()))
        text = prompt if representation == "image" else prompt + "\n\n" + mazes.to_ascii(m)
        content.append({"type": "text", "text": text})
        rows.append({
            "prompt": [{"role": "user", "content": content}],
            "answer": "YES" if m.solvable else "NO",
            "info": {"id": f"maze-{maze_seed}", "source": "mazes", "solvable": m.solvable, "seed": maze_seed,
                     "width": m.width, "height": m.height, "tree_path_length": m.meta["treePathLength"],
                     "solution_length": m.meta["solutionLength"], "pocket_frac": m.meta["pocketFrac"]},
        })
    return rows


def _room_rows(n, seed, representation, manifest, view, yaws, tag):
    root = os.path.dirname(os.path.abspath(manifest))
    items = [json.loads(line) for line in open(manifest) if line.strip()]
    if tag:
        items = [it for it in items if tag in (it.get("tags") or [])]
    by_pair = {}
    for it in items:
        by_pair.setdefault(it["pair"], []).append(it)
    pairs = [p for p in by_pair.values() if len(p) == 2 and p[0]["solvable"] != p[1]["solvable"]
             and all(it.get("verified") in (None, it["solvable"]) for it in p)]
    rnd = Mulberry32(normalize_seed(seed))
    rnd.shuffle(pairs)
    if n:
        pairs = pairs[: max(1, n // 2)]
    chosen = [it for p in pairs for it in p]
    rnd.shuffle(chosen)
    yaw_list = [int(y) for y in str(yaws).split(",") if str(y).strip() != ""]
    rows = []
    for it in chosen:
        content = []
        if representation in ("image", "both"):
            images = it.get("images") or {}
            paths = []
            if view == "top":
                paths = [images.get("top")]
            else:
                yaw_images = images.get("yaws") or {}
                for y in yaw_list:
                    p = yaw_images.get(str(y)) or (images.get("perspective") if y == 0 else None)
                    if p:
                        paths.append(p)
            paths = [p for p in paths if p]
            if not paths:
                raise FileNotFoundError(f"no {view} image for {it['id']} (yaws {yaw_list}); render it first")
            for p in paths:
                with open(os.path.join(root, p), "rb") as f:
                    content.append(_image_block(f.read()))
        text = build_room_prompt("image" if representation == "image" else ("both" if representation == "both" else "ascii"),
                                 it.get("legend") or {}, view)
        if representation in ("image", "both") and len(content) > 1:
            text = text.replace("The image shows the room", f"The {len(content)} images show the room from the game camera rotated in 90-degree steps")
        if representation in ("ascii", "both"):
            with open(os.path.join(root, it["ascii"])) as f:
                text += "\n\n" + f.read()
        if representation == "json":
            if not it.get("json"):
                raise FileNotFoundError(f"no JSON observation for {it['id']}; render with a current mazebench/render.js")
            with open(os.path.join(root, it["json"])) as f:
                text += "\n\nJSON observation:\n" + f.read()
        content.append({"type": "text", "text": text})
        rows.append({
            "prompt": [{"role": "user", "content": content}],
            "answer": "YES" if it["solvable"] else "NO",
            "info": {"id": it["id"], "source": "rooms", "solvable": it["solvable"], "room": it.get("room"), "pair": it.get("pair"),
                     "edit_type": (it.get("edit") or {}).get("type"), "tags": it.get("tags") or [], "moves": it.get("moves"),
                     "base_moves": it.get("baseMoves"), "view": view, "yaws": yaw_list},
        })
    return rows


def load_environment(
    source="mazes",
    n=200,
    seed="maze-snapshot",
    representation="image",
    preset="medium",
    width=None, height=None, loops=None, cut=None, placement=None, algorithm=None,
    theme="light", markers="sg", grayscale=False, cell_px=None, image_size=480,
    manifest=None, view="perspective", yaws="0", tag=None,
    system_prompt=None,
    **kwargs,
):
    """Build the single-turn environment. All arguments can be passed as env args."""
    if source == "rooms":
        if not manifest:
            raise ValueError('source="rooms" needs manifest=path/to/manifest.jsonl (written by mazebench/render.js)')
        rows = _room_rows(int(n), seed, representation, manifest, view, yaws, tag)
    else:
        params = dict(mazes.PRESETS[preset])
        for key, value in (("width", width), ("height", height), ("loops", loops), ("cut", cut), ("placement", placement), ("algorithm", algorithm)):
            if value is not None:
                params[key] = value
        params = mazes.normalize_params(params)
        longest = max(params["width"], params["height"])
        cell = int(cell_px) if cell_px else max(4, (int(image_size) - 24 - 4) // longest - 4)
        ropts = RenderOptions(cell_px=cell, wall_px=4, theme=theme, markers=markers, grayscale=bool(grayscale))
        if int(n) % 2:
            n = int(n) + 1
        rows = _maze_rows(int(n), seed, representation, params, ropts)

    dataset = Dataset.from_list(rows)
    parser = AnswerParser()

    def correct(completion, answer, parser, **_):
        return 1.0 if parser.parse_answer(completion) == answer else 0.0

    def answered(completion, parser, **_):
        return 1.0 if parser.parse_answer(completion) in ("YES", "NO") else 0.0

    def said_yes(completion, parser, **_):
        return 1.0 if parser.parse_answer(completion) == "YES" else 0.0

    rubric = vf.Rubric(funcs=[correct, answered, said_yes], weights=[1.0, 0.0, 0.0], parser=parser)
    return vf.SingleTurnEnv(dataset=dataset, eval_dataset=dataset, system_prompt=system_prompt, parser=parser, rubric=rubric, **kwargs)

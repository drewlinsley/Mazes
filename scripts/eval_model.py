#!/usr/bin/env python3
"""Ask a vision model whether maze snapshots are solvable and score it.

The prompt and the trial construction are the same as the website's Model
tab, so browser runs and script runs are comparable.

Examples
--------
    # 40 medium mazes generated on the fly, images sent to Claude Opus 5
    python scripts/eval_model.py --preset medium --n 40 --out results/opus5-medium.jsonl

    # score the test split of a dataset written by make_dataset.py
    python scripts/eval_model.py --dataset data/hard16 --split test --limit 200 \
        --model claude-opus-5 --effort high --concurrency 4 --out results/opus5-hard16.jsonl

    # text-only input (ASCII maze), no images
    python scripts/eval_model.py --preset medium --n 40 --representation ascii

    # see the prompts and images without calling the API
    python scripts/eval_model.py --preset medium --n 4 --dry-run

Credentials: the SDK reads ANTHROPIC_API_KEY (or an `ant auth login` profile).

Each run appends one JSON line per trial to --out (default results/<model>-<timestamp>.jsonl)
and prints accuracy, hit rate, false-alarm rate and d' overall and by pocket size.
"""
import argparse
import base64
import concurrent.futures as cf
import datetime as dt
import io
import json
import math
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import mazes  # noqa: E402
from mazes.prng import Mulberry32, normalize_seed  # noqa: E402
from mazes.render import RenderOptions  # noqa: E402
from mazes.prompt import build_prompt, build_room_prompt, parse_answer  # noqa: E402


# --------------------------------------------------------------------------
# Trials
# --------------------------------------------------------------------------
def build_trials(n, session_seed):
    """Same construction as the website: exact 50/50 labels, shuffled, seeds hashed from '<session>:<i>'."""
    rnd = Mulberry32(normalize_seed(session_seed))
    labels = [i % 2 == 0 for i in range(n)]
    rnd.shuffle(labels)
    return [{"index": i, "seed": normalize_seed(f"{session_seed}:{i}"), "solvable": lab} for i, lab in enumerate(labels)]


def trials_from_generator(args, params):
    session = args.session_seed if args.session_seed is not None else str(int(time.time()) % 1000000000)
    items = []
    for t in build_trials(args.n, session):
        m = mazes.generate(dict(params, seed=t["seed"]), solvable=t["solvable"])
        items.append({"id": f"{t['index']:06d}", "maze": m, "image_path": None})
    return items, {"source": "generator", "session_seed": session, "maze_params": params}


def trials_from_manifest(args):
    """Pre-rendered MazeBench rooms written by mazebench/render.js (manifest.jsonl + images + ascii)."""
    root = os.path.dirname(os.path.abspath(args.manifest))
    items = []
    with open(args.manifest) as f:
        for line in f:
            d = json.loads(line)
            if args.tag and args.tag not in (d.get("tags") or []):
                continue
            images = d.get("images") or {}
            if args.view == "top":
                paths = [images.get("top")]
            else:
                yaw_images = images.get("yaws") or {}
                wanted = sorted(int(k) for k in yaw_images) if args.yaws == "all" else [int(y) for y in args.yaws.split(",") if y.strip()]
                paths = [yaw_images.get(str(y)) or (images.get("perspective") if y == 0 else None) for y in wanted]
            paths = [os.path.join(root, p) for p in paths if p]
            ascii_path = os.path.join(root, d["ascii"]) if d.get("ascii") else None
            json_path = os.path.join(root, d["json"]) if d.get("json") else None
            items.append({
                "id": d["id"], "maze": None, "room": d,
                "image_path": paths[0] if paths else None, "image_paths": paths,
                "ascii": open(ascii_path).read() if ascii_path and os.path.exists(ascii_path) else None,
                "json": open(json_path).read() if json_path and os.path.exists(json_path) else None,
            })
    rnd = Mulberry32(normalize_seed(args.session_seed or 0))
    # keep pairs together: sample pairs, then shuffle members
    by_pair = {}
    for it in items:
        by_pair.setdefault(it["room"]["pair"], []).append(it)
    pairs = [p for p in by_pair.values() if len(p) == 2 and p[0]["room"]["solvable"] != p[1]["room"]["solvable"]]
    rnd.shuffle(pairs)
    if args.limit:
        pairs = pairs[: max(1, args.limit // 2)]
    items = [it for p in pairs for it in p]
    rnd.shuffle(items)
    return items, {"source": "manifest", "manifest": args.manifest, "view": args.view, "tag": args.tag}


def trials_from_dataset(args):
    root = args.dataset
    with open(os.path.join(root, "config.json")) as f:
        config = json.load(f)
    items = []
    with open(os.path.join(root, "mazes.jsonl")) as f:
        for line in f:
            d = json.loads(line)
            if args.split and d.get("split") != args.split:
                continue
            m = mazes.Maze.from_dict(d)
            items.append({"id": d["id"], "maze": m, "image_path": os.path.join(root, "images", d["id"] + ".png")})
    # balanced subset, shuffled reproducibly
    rnd = Mulberry32(normalize_seed(args.session_seed or 0))
    rnd.shuffle(items)
    if args.limit:
        pos = [i for i in items if i["maze"].solvable][: args.limit // 2]
        neg = [i for i in items if not i["maze"].solvable][: args.limit // 2]
        items = pos + neg
        rnd.shuffle(items)
    return items, {"source": "dataset", "dataset": root, "split": args.split, "dataset_config": config}


# --------------------------------------------------------------------------
# API call
# --------------------------------------------------------------------------
def image_bytes(item, ropts):
    if item.get("maze") is None and not (item.get("image_path") and os.path.exists(item["image_path"])):
        raise FileNotFoundError(f"no {item['id']} image for this view; render it or choose another --view")
    if item["image_path"] and os.path.exists(item["image_path"]):
        with open(item["image_path"], "rb") as f:
            return f.read()
    buf = io.BytesIO()
    mazes.render_image(item["maze"], ropts).save(buf, format="PNG")
    return buf.getvalue()


def build_content(item, ropts, repr_, prompt):
    content = []
    if repr_ in ("image", "both"):
        paths = item.get("image_paths") or ([item["image_path"]] if item.get("image_path") else [])
        if item.get("maze") is not None or not paths:
            data = base64.standard_b64encode(image_bytes(item, ropts)).decode("ascii")
            content.append({"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": data}})
        else:
            for p in paths:
                with open(p, "rb") as f:
                    content.append({"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": base64.standard_b64encode(f.read()).decode("ascii")}})
    if item.get("maze") is not None:
        text = prompt
        if repr_ != "image":
            text += "\n\n" + mazes.to_ascii(item["maze"])
    else:
        room_repr = "ascii" if repr_ in ("ascii", "json") else repr_
        text = build_room_prompt(room_repr, item["room"].get("legend") or {}, item.get("view", "perspective"))
        if len(content) > 1:
            text = text.replace("The image shows the room", f"The {len(content)} images show the room from the game camera rotated in 90-degree steps")
        if repr_ in ("ascii", "both"):
            text += "\n\n" + (item.get("ascii") or "")
        if repr_ == "json":
            if not item.get("json"):
                raise FileNotFoundError(f"no JSON observation for {item['id']}; render the manifest with a current mazebench/render.js")
            text += "\n\nJSON observation:\n" + item["json"]
    content.append({"type": "text", "text": text})
    return content


def ask(client, item, content, args):
    import anthropic

    kwargs = dict(model=args.model, max_tokens=args.max_tokens, messages=[{"role": "user", "content": content}])
    if args.effort:
        kwargs["output_config"] = {"effort": args.effort}
    if args.fallbacks:
        kwargs["betas"] = ["server-side-fallback-2026-07-01"]
        kwargs["fallbacks"] = "default"
    started = time.time()
    try:
        if args.fallbacks:
            resp = client.beta.messages.create(**kwargs)
        else:
            resp = client.messages.create(**kwargs)
    except anthropic.RateLimitError as e:          # retried by the SDK already; record and move on
        return {"error": f"rate limit: {e}", "latency": time.time() - started}
    except anthropic.APIStatusError as e:
        return {"error": f"HTTP {e.status_code}: {e.message}", "latency": time.time() - started}
    except anthropic.APIConnectionError as e:
        return {"error": f"connection: {e}", "latency": time.time() - started}
    reply = "".join(b.text for b in resp.content if b.type == "text")
    served = args.model
    if args.fallbacks:
        iterations = getattr(resp.usage, "iterations", None) or []
        if any(getattr(it, "type", "") == "fallback_message" for it in iterations):
            served = "fallback"
    return {
        "reply": reply, "stop_reason": resp.stop_reason, "latency": time.time() - started,
        "input_tokens": resp.usage.input_tokens, "output_tokens": resp.usage.output_tokens, "served_by": served,
        "answer": "refused" if resp.stop_reason == "refusal" else parse_answer(reply),
    }


# --------------------------------------------------------------------------
# Scoring
# --------------------------------------------------------------------------
def probit(p):
    """Inverse normal CDF via bisection on erf (no scipy dependency)."""
    lo, hi = -10.0, 10.0
    for _ in range(80):
        mid = (lo + hi) / 2
        if 0.5 * (1 + math.erf(mid / math.sqrt(2))) < p:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def summarize(rows):
    answered = [r for r in rows if r.get("answer") in ("yes", "no")]
    pos = [r for r in answered if r["solvable"]]
    neg = [r for r in answered if not r["solvable"]]
    hits = sum(r["answer"] == "yes" for r in pos)
    fas = sum(r["answer"] == "yes" for r in neg)
    correct = hits + len(neg) - fas
    H = (hits + 0.5) / (len(pos) + 1)
    F = (fas + 0.5) / (len(neg) + 1)
    return {
        "n": len(rows), "answered": len(answered), "correct": correct,
        "accuracy": correct / len(answered) if answered else None,
        "hit_rate": hits / len(pos) if pos else None, "fa_rate": fas / len(neg) if neg else None,
        "dprime": probit(H) - probit(F) if pos and neg else None,
        "refused": sum(r.get("answer") == "refused" for r in rows),
        "errors": sum(r.get("answer") == "error" for r in rows),
        "unparsed": sum(r.get("answer") == "unparsed" for r in rows),
        "input_tokens": sum(r.get("input_tokens") or 0 for r in rows),
        "output_tokens": sum(r.get("output_tokens") or 0 for r in rows),
    }


def fmt(x, digits=2):
    return "-" if x is None else f"{x:.{digits}f}"


def print_summary(rows):
    s = summarize(rows)
    print(f"\n{s['answered']}/{s['n']} answered; accuracy {fmt(s['accuracy'])}; hit rate {fmt(s['hit_rate'])}; "
          f"false alarms {fmt(s['fa_rate'])}; d' {fmt(s['dprime'])}; refused {s['refused']}; errors {s['errors']}; "
          f"unparsed {s['unparsed']}; tokens in/out {s['input_tokens']}/{s['output_tokens']}")
    bins = [(0.0, 0.15, "pocket < 15%"), (0.15, 0.3, "pocket 15-30%"), (0.3, 0.51, "pocket >= 30%")]
    print("by pocket size (size of the smaller disconnected part, both labels):")
    for lo, hi, name in bins:
        sub = [r for r in rows if lo <= r["pocket_frac"] < hi]
        if sub:
            ss = summarize(sub)
            print(f"  {name:14s} n={len(sub):4d} accuracy {fmt(ss['accuracy'])} d' {fmt(ss['dprime'])}")
    if any(r.get("edit_type") for r in rows):
        print("by edit type (what differs from the original room):")
        for et in sorted({r.get("edit_type") for r in rows if r.get("edit_type")}):
            sub = [r for r in rows if r.get("edit_type") == et]
            ss = summarize(sub)
            print(f"  {et:14s} n={len(sub):4d} accuracy {fmt(ss['accuracy'])} d' {fmt(ss['dprime'])}")
        tags = sorted({t for r in rows for t in (r.get("tags") or [])})
        for t in tags:
            sub = [r for r in rows if t in (r.get("tags") or [])]
            ss = summarize(sub)
            print(f"  tag {t:10s} n={len(sub):4d} accuracy {fmt(ss['accuracy'])} d' {fmt(ss['dprime'])}")
    lengths = sorted(r["tree_path_length"] for r in rows)
    if lengths:
        med = lengths[len(lengths) // 2]
        for name, sub in (("short paths", [r for r in rows if r["tree_path_length"] <= med]),
                          ("long paths", [r for r in rows if r["tree_path_length"] > med])):
            if sub:
                ss = summarize(sub)
                print(f"  {name:14s} n={len(sub):4d} accuracy {fmt(ss['accuracy'])} d' {fmt(ss['dprime'])} (median tree path {med})")


# --------------------------------------------------------------------------
def parse_args(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_argument_group("mazes (generate on the fly, or read a dataset)")
    src.add_argument("--dataset", help="directory written by scripts/make_dataset.py")
    src.add_argument("--manifest", help="manifest.jsonl written by mazebench/render.js (pre-rendered MazeBench rooms)")
    src.add_argument("--view", default="perspective", help="which rendered view to send for --manifest items (perspective | top)")
    src.add_argument("--tag", default=None, help="only --manifest rooms carrying this mechanics tag (ice, box, holes, orange, slope, lift, elevation)")
    src.add_argument("--yaws", default="0", help="camera rotations of --manifest rooms to send in one prompt: '0', '0,180', or 'all'")
    src.add_argument("--split", default=None, help="dataset split to use (train/val/test); default all")
    src.add_argument("--limit", type=int, default=0, help="balanced number of dataset items to score (0 = all)")
    src.add_argument("--preset", choices=sorted(mazes.PRESETS), default="medium")
    src.add_argument("--width", type=int)
    src.add_argument("--height", type=int)
    src.add_argument("--algorithm", choices=["backtracker", "kruskal", "prim"])
    src.add_argument("--placement", choices=["random", "border", "corners", "far"])
    src.add_argument("--cut")
    src.add_argument("--loops", type=int)
    src.add_argument("--n", type=int, default=20, help="number of generated trials (even)")
    src.add_argument("--session-seed", dest="session_seed", help="seed for trial labels/seeds (default: time based)")
    rnd = ap.add_argument_group("rendering (generated mazes)")
    rnd.add_argument("--style", choices=["lines", "blocks"], default="lines")
    rnd.add_argument("--cell-px", type=int, default=None, dest="cell_px")
    rnd.add_argument("--wall-px", type=int, default=4, dest="wall_px")
    rnd.add_argument("--image-size", type=int, default=640, dest="image_size")
    rnd.add_argument("--theme", choices=["light", "dark"], default="light")
    rnd.add_argument("--markers", choices=["sg", "dots", "letters"], default="sg")
    rnd.add_argument("--grayscale", action="store_true")
    mdl = ap.add_argument_group("model")
    mdl.add_argument("--model", default="claude-opus-5")
    mdl.add_argument("--effort", choices=["low", "medium", "high", "xhigh", "max"], default=None)
    mdl.add_argument("--max-tokens", type=int, default=16000, dest="max_tokens")
    mdl.add_argument("--representation", choices=["image", "ascii", "both", "json"], default="image",
                     help="json = the engine's JSON observation (manifest rooms only)")
    mdl.add_argument("--concurrency", type=int, default=2)
    mdl.add_argument("--fallbacks", action="store_true",
                     help="enable server-side refusal fallbacks (off by default: a fallback model would contaminate the score)")
    ap.add_argument("--out", default=None, help="JSONL output path")
    ap.add_argument("--dry-run", action="store_true", help="build prompts and images but do not call the API")
    ap.add_argument("--save-images", default=None, help="directory to save the exact PNGs sent to the model")
    return ap.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    if args.manifest:
        items, source = trials_from_manifest(args)
        for it in items:
            it["view"] = args.view
        ropts = RenderOptions()
    elif args.dataset:
        items, source = trials_from_dataset(args)
        rconf = source["dataset_config"].get("render", {})
        ropts = RenderOptions(**{k: v for k, v in rconf.items() if k in RenderOptions.__dataclass_fields__})
    else:
        p = dict(mazes.PRESETS[args.preset])
        for key in ("width", "height", "algorithm", "placement", "cut", "loops"):
            if getattr(args, key) is not None:
                p[key] = getattr(args, key)
        params = mazes.normalize_params(p)
        if args.n < 2 or args.n % 2:
            sys.exit("--n must be even and >= 2")
        items, source = trials_from_generator(args, params)
        longest = max(params["width"], params["height"])
        cell = args.cell_px or max(4, (args.image_size - 24 - args.wall_px) // longest - args.wall_px)
        ropts = RenderOptions(style=args.style, cell_px=cell, wall_px=args.wall_px, theme=args.theme,
                              markers=args.markers, grayscale=args.grayscale)
    if not items:
        sys.exit("no mazes to score")
    prompt = build_prompt(args.representation, markers=ropts.markers, grayscale=ropts.grayscale, theme=ropts.theme)

    out = args.out or os.path.join("results", f"{args.model}-{dt.datetime.now():%Y%m%d-%H%M%S}.jsonl")
    if args.save_images:
        os.makedirs(args.save_images, exist_ok=True)

    n_solvable = sum((i["maze"].solvable if i.get("maze") is not None else i["room"]["solvable"]) for i in items)
    print(f"{len(items)} items ({n_solvable} solvable), model {args.model}, "
          f"input {args.representation}, effort {args.effort or 'default'} -> {out}")
    print("prompt:", prompt, "\n")

    def row_for(item):
        m = item["maze"]
        if m is None:
            r = item["room"]
            return {
                "id": item["id"], "seed": None, "solvable": r["solvable"], "room": r.get("room"), "pair": r.get("pair"),
                "edit_type": (r.get("edit") or {}).get("type"), "tags": r.get("tags"), "tree_path_length": r.get("moves") or r.get("baseMoves") or 0,
                "solution_length": r.get("moves"), "pocket_frac": 0.5, "params": None, "model": args.model, "effort": args.effort,
                "representation": args.representation, "view": item.get("view"),
            }
        return {
            "id": item["id"], "seed": m.seed, "solvable": m.solvable, "width": m.width, "height": m.height,
            "tree_path_length": m.meta["treePathLength"], "solution_length": m.meta["solutionLength"],
            "pocket_frac": m.meta["pocketFrac"], "params": m.params, "model": args.model, "effort": args.effort,
            "representation": args.representation,
        }

    if args.dry_run:
        for item in items:
            content = build_content(item, ropts, args.representation, prompt)
            if args.save_images:
                with open(os.path.join(args.save_images, item["id"] + ".png"), "wb") as f:
                    f.write(image_bytes(item, ropts))
            text = [c["text"] for c in content if c["type"] == "text"][0]
            truth = item["maze"].solvable if item.get("maze") is not None else item["room"]["solvable"]
            print(f"--- {item['id']} solvable={truth} "
                  f"blocks={[c['type'] for c in content]}\n{text}\n")
        print("dry run: no API calls made")
        return

    import anthropic
    client = anthropic.Anthropic()
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)

    def work(item):
        content = build_content(item, ropts, args.representation, prompt)
        if args.save_images:
            with open(os.path.join(args.save_images, item["id"] + ".png"), "wb") as f:
                f.write(image_bytes(item, ropts))
        r = ask(client, item, content, args)
        row = row_for(item)
        if "error" in r:
            row.update(answer="error", correct=False, error=r["error"], latency=r["latency"])
        else:
            row.update(r)
            truth = item["maze"].solvable if item.get("maze") is not None else item["room"]["solvable"]
            row["correct"] = r["answer"] in ("yes", "no") and (r["answer"] == "yes") == truth
        return row

    rows = []
    with open(out, "a") as f, cf.ThreadPoolExecutor(max_workers=max(1, args.concurrency)) as pool:
        for row in pool.map(work, items):
            rows.append(row)
            f.write(json.dumps(row) + "\n")
            f.flush()
            mark = "ok " if row["correct"] else "BAD"
            print(f"{mark} {row['id']} truth={'yes' if row['solvable'] else 'no ':3s} answer={row['answer']:8s} "
                  f"{row.get('latency', 0):5.1f}s  {(row.get('error') or '')[:60]}")
    print_summary(rows)
    with open(out.replace(".jsonl", "") + ".summary.json", "w") as f:
        json.dump({"source": source, "model": args.model, "effort": args.effort, "representation": args.representation,
                   "prompt": prompt, "render": ropts.__dict__, "summary": summarize(rows)}, f, indent=2)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Generate a balanced maze-solvability dataset (images + labels).

Examples
--------
    python scripts/make_dataset.py --out data/medium --n 2000 --preset medium
    python scripts/make_dataset.py --out data/hard16 --n 5000 --width 16 --height 16 \
        --loops 6 --cut balanced --placement far --theme dark --markers dots --grayscale
    python scripts/make_dataset.py --out data/pairs --n 1000 --preset medium --pairs

Output layout
-------------
    OUT/config.json      parameters used
    OUT/images/ID.png    one image per maze
    OUT/labels.csv       id, seed, solvable, split, and per-maze statistics
    OUT/mazes.jsonl      full maze objects (walls, S/G, metadata) for regeneration
    OUT/ascii/ID.txt     (with --ascii) text rendering for language models

Exactly half of the mazes are solvable (within every split). With --pairs both
members of each minimal pair are emitted (2 images per seed, never split apart).
"""
import argparse
import csv
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import mazes  # noqa: E402
from mazes.prng import Mulberry32  # noqa: E402
from mazes.render import RenderOptions  # noqa: E402


def parse_args(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True, help="output directory")
    ap.add_argument("--n", type=int, default=1000, help="number of images (mazes) to generate; even")
    ap.add_argument("--seed", type=int, default=0, help="base seed; maze i uses seed base+i")
    ap.add_argument("--preset", choices=sorted(mazes.PRESETS), help="difficulty preset (overridden by explicit options)")
    ap.add_argument("--width", type=int)
    ap.add_argument("--height", type=int)
    ap.add_argument("--algorithm", choices=["backtracker", "kruskal", "prim"])
    ap.add_argument("--placement", choices=["random", "border", "corners", "far"])
    ap.add_argument("--cut", help="balanced | random | float in [0,1]")
    ap.add_argument("--loops", type=int)
    ap.add_argument("--min-distance", type=int, dest="min_distance")
    ap.add_argument("--min-path", type=int, default=0, help="skip seeds whose tree path is shorter than this")
    ap.add_argument("--pairs", action="store_true", help="emit both members of every minimal pair")
    ap.add_argument("--splits", default="0.8,0.1,0.1", help="train,val,test fractions")
    # rendering
    ap.add_argument("--style", choices=["lines", "blocks"], default="lines")
    ap.add_argument("--cell-px", type=int, default=None, dest="cell_px", help="corridor width in px (default: fit --image-size)")
    ap.add_argument("--wall-px", type=int, default=4, dest="wall_px")
    ap.add_argument("--margin", type=int, default=12)
    ap.add_argument("--image-size", type=int, default=320, dest="image_size", help="target longest side when --cell-px is not given")
    ap.add_argument("--theme", choices=["light", "dark"], default="light")
    ap.add_argument("--markers", choices=["sg", "dots", "letters"], default="sg")
    ap.add_argument("--marker-scale", type=float, default=0.6, dest="marker_scale")
    ap.add_argument("--grayscale", action="store_true")
    ap.add_argument("--supersample", type=int, default=2)
    ap.add_argument("--ascii", action="store_true", help="also write ASCII renderings")
    ap.add_argument("--quiet", action="store_true")
    return ap.parse_args(argv)


def maze_params(args):
    p = dict(mazes.PRESETS[args.preset]) if args.preset else {}
    for key in ("width", "height", "algorithm", "placement", "cut", "loops"):
        v = getattr(args, key)
        if v is not None:
            p[key] = v
    if args.min_distance is not None:
        p["minDistance"] = args.min_distance
    return mazes.normalize_params(p)


def fit_cell_px(width, height, image_size, wall_px, margin):
    longest = max(width, height)
    return max(4, (image_size - 2 * margin - wall_px) // longest - wall_px)


def main(argv=None):
    args = parse_args(argv)
    if args.n < 2 or args.n % 2:
        sys.exit("--n must be an even number >= 2")
    fracs = [float(x) for x in args.splits.split(",")]
    if len(fracs) != 3 or abs(sum(fracs) - 1.0) > 1e-6:
        sys.exit("--splits must be three fractions summing to 1")

    params = maze_params(args)
    cell_px = args.cell_px or fit_cell_px(params["width"], params["height"], args.image_size, args.wall_px, args.margin)
    ropts = RenderOptions(style=args.style, cell_px=cell_px, wall_px=args.wall_px, margin=args.margin,
                          theme=args.theme, markers=args.markers, marker_scale=args.marker_scale,
                          grayscale=args.grayscale, supersample=args.supersample)

    os.makedirs(os.path.join(args.out, "images"), exist_ok=True)
    if args.ascii:
        os.makedirs(os.path.join(args.out, "ascii"), exist_ok=True)

    n_seeds = args.n // 2 if args.pairs else args.n
    rng = Mulberry32(args.seed)
    order = rng.shuffle(list(range(n_seeds)))
    n_train = int(round(fracs[0] * n_seeds))
    n_val = int(round(fracs[1] * n_seeds))
    split_of = {}
    for rank, idx in enumerate(order):
        split_of[idx] = "train" if rank < n_train else ("val" if rank < n_train + n_val else "test")
    # exact label balance inside every split: alternate labels in shuffled order per split
    label_of = {}
    counters = {"train": 0, "val": 0, "test": 0}
    for idx in order:
        sp = split_of[idx]
        label_of[idx] = counters[sp] % 2 == 0
        counters[sp] += 1

    rows = []
    jsonl = open(os.path.join(args.out, "mazes.jsonl"), "w")
    next_seed = args.seed
    skipped = 0
    item_id = 0
    for idx in range(n_seeds):
        # find the next seed satisfying --min-path
        while True:
            seed = next_seed
            next_seed += 1
            pos, neg = mazes.generate_pair(dict(params, seed=seed))
            if pos.meta["treePathLength"] >= args.min_path:
                break
            skipped += 1
        members = [pos, neg] if args.pairs else [pos if label_of[idx] else neg]
        for m in members:
            mid = f"{item_id:06d}"
            item_id += 1
            mazes.save_png(m, os.path.join(args.out, "images", mid + ".png"), ropts)
            if args.ascii:
                with open(os.path.join(args.out, "ascii", mid + ".txt"), "w") as f:
                    f.write(mazes.to_ascii(m) + "\n")
            d = m.to_dict()
            d["id"] = mid
            d["split"] = split_of[idx]
            jsonl.write(json.dumps(d) + "\n")
            rows.append({
                "id": mid, "seed": m.seed, "solvable": int(m.solvable), "split": split_of[idx],
                "pair": idx, "width": m.width, "height": m.height,
                "tree_path_length": m.meta["treePathLength"],
                "solution_length": m.meta["solutionLength"] if m.meta["solutionLength"] is not None else "",
                "pocket_frac": round(m.meta["pocketFrac"], 4),
                "component_min": min(m.meta["componentSizes"]),
                "loops": m.meta["loops"], "cut_index": m.meta["cutIndex"],
                "start_x": m.start[0], "start_y": m.start[1], "goal_x": m.goal[0], "goal_y": m.goal[1],
            })
        if not args.quiet and (idx + 1) % 100 == 0:
            print(f"  {item_id} images written", file=sys.stderr)
    jsonl.close()

    with open(os.path.join(args.out, "labels.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    config = {
        "n": len(rows), "pairs": args.pairs, "base_seed": args.seed, "min_path": args.min_path,
        "seeds_skipped_for_min_path": skipped, "splits": fracs, "preset": args.preset,
        "maze_params": params, "render": ropts.__dict__, "ascii": args.ascii, "version": mazes.VERSION,
    }
    with open(os.path.join(args.out, "config.json"), "w") as f:
        json.dump(config, f, indent=2)

    if not args.quiet:
        by_split = {}
        for r in rows:
            by_split.setdefault(r["split"], []).append(r["solvable"])
        print(f"wrote {len(rows)} images to {args.out}", file=sys.stderr)
        for sp, labels in by_split.items():
            print(f"  {sp}: {len(labels)} images, {sum(labels)} solvable", file=sys.stderr)
        paths = [r["tree_path_length"] for r in rows]
        pockets = [r["pocket_frac"] for r in rows]
        print(f"  tree path length: mean {sum(paths)/len(paths):.1f}, min {min(paths)}, max {max(paths)}", file=sys.stderr)
        print(f"  pocket fraction (unsolvable side sizes): mean {sum(pockets)/len(pockets):.3f}, min {min(pockets):.3f}", file=sys.stderr)
    return config


if __name__ == "__main__":
    main()

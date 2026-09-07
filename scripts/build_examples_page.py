#!/usr/bin/env python3
"""Bundle web/examples.html into one self-contained file (scripts and images inlined).

    python scripts/build_examples_page.py --out /tmp/examples-standalone.html --world-pairs 27 --generated-pairs 24

The GitHub Pages copy (web/examples.html) loads maze.js, render.js and the
stimulus manifest from the site; this bundle embeds them, with images as data
URIs, so the page can be hosted anywhere as a single file.
"""
import argparse
import base64
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")


def data_uri(path):
    with open(path, "rb") as f:
        return "data:image/png;base64," + base64.standard_b64encode(f.read()).decode("ascii")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", required=True)
    ap.add_argument("--world-pairs", type=int, default=27)
    ap.add_argument("--generated-pairs", type=int, default=24)
    args = ap.parse_args()

    html = open(os.path.join(WEB, "examples.html")).read()
    raw = open(os.path.join(WEB, "stimuli", "mazebench", "manifest.js")).read()
    m = re.search(r"window\.MAZEBENCH_STIMULI\s*=\s*(\{.*\});?\s*$", raw, re.S)
    data = json.loads(m.group(1))
    limits = {"shipped": args.world_pairs, "generated": args.generated_pairs}
    for key, st in data["sets"].items():
        pairs = {}
        for it in st["items"]:
            pairs.setdefault(it["pair"], []).append(it)
        keep = list(pairs.values())[: limits.get(key, len(pairs))]
        items = [it for p in keep for it in p]
        for it in items:
            imgs = it.get("images") or {}
            for view, rel in list(imgs.items()):
                if view == "yaws":
                    for y, p in rel.items():
                        rel[y] = data_uri(os.path.join(WEB, p))
                else:
                    imgs[view] = data_uri(os.path.join(WEB, rel))
        st["items"] = items
    manifest_js = "window.MAZEBENCH_STIMULI = " + json.dumps(data, separators=(",", ":")) + ";"
    for src in ("maze.js", "render.js"):
        code = open(os.path.join(WEB, src)).read().replace("</script>", "<\\/script>")
        html = html.replace('<script src="%s"></script>' % src, "<script>\n" + code + "\n</script>")
    html = html.replace('<script src="stimuli/mazebench/manifest.js"></script>', "<script>" + manifest_js + "</script>")
    html = html.replace('<a href="index.html">Run the task</a> · ', "")
    with open(args.out, "w") as f:
        f.write(html)
    print(f"wrote {args.out} ({os.path.getsize(args.out) / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()

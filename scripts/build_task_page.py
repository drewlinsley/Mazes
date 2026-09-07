#!/usr/bin/env python3
"""Bundle the task site (web/index.html) into one self-contained HTML file.

    python scripts/build_task_page.py --out /tmp/task-standalone.html --world-pairs 20 --generated-pairs 12 \
        --examples-url https://example.com/gallery

Inlines style.css, maze.js, render.js, prompt.js, app.js and a subset of the
pre-rendered room stimuli (as data URIs) so the page runs anywhere a single
HTML file can be hosted. The Model tab needs a host that allows requests to
api.anthropic.com; the Task and Explore tabs work everywhere.
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


def subset_manifest(world_pairs, generated_pairs):
    raw = open(os.path.join(WEB, "stimuli", "mazebench", "manifest.js")).read()
    m = re.search(r"window\.MAZEBENCH_STIMULI\s*=\s*(\{.*\});?\s*$", raw, re.S)
    data = json.loads(m.group(1))
    limits = {"shipped": world_pairs, "generated": generated_pairs}
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
    return "window.MAZEBENCH_STIMULI = " + json.dumps(data, separators=(",", ":")) + ";"


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", required=True)
    ap.add_argument("--world-pairs", type=int, default=20)
    ap.add_argument("--generated-pairs", type=int, default=12)
    ap.add_argument("--examples-url", default="examples.html", help="where the Examples link should point")
    args = ap.parse_args()

    html = open(os.path.join(WEB, "index.html")).read()
    css = open(os.path.join(WEB, "style.css")).read()
    html = html.replace('<link rel="stylesheet" href="style.css">', "<style>\n" + css + "\n</style>")
    for src in ("maze.js", "render.js", "prompt.js", "app.js"):
        code = open(os.path.join(WEB, src)).read().replace("</script>", "<\\/script>")
        html = html.replace('<script src="%s"></script>' % src, "<script>\n" + code + "\n</script>")
    html = html.replace('<script src="stimuli/mazebench/manifest.js"></script>', "<script>" + subset_manifest(args.world_pairs, args.generated_pairs) + "</script>")
    html = html.replace('href="examples.html"', 'href="%s"' % args.examples_url)
    with open(args.out, "w") as f:
        f.write(html)
    print(f"wrote {args.out} ({os.path.getsize(args.out) / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()

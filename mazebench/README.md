# MazeBench rooms as a snapshot task

[MazeBench](https://mazebench.com) evaluates agents that steer a player through
a 3D block-puzzle world one action at a time: rooms of walls, ice, pushable
boxes, ice slopes, lifts, orange walls with buttons, pits and punchers, with
gems to collect. The scripts in this directory turn those rooms into a
**snapshot** task: a single rendered frame of a room, and the question
*can the player collect the gem?*, with exactly half of the rooms solvable.

Everything runs on the MazeBench engine itself, vendored as the git submodule
`vendor/MazeBenchEngine` (MIT) and not modified:

- the engine's exhaustive A* search decides every label (`public/maze-solver.js`).
  A room is *solvable* when the search finds a move sequence that collects every
  gem, and *unsolvable* when it has searched the whole reachable state space
  without finding one; rooms whose search hits the state budget are dropped;
- the engine's Three.js renderer draws the frames exactly as the game shows
  them to vision-mode agents (`scripts/maze-render-frame.js`, headless Chromium);
- the engine's ASCII observer produces the text form that text-mode agents
  receive (`scripts/maze-terminal.js`).

## Two stimulus sets

**Shipped rooms, one edit away.** `solve_rooms.js` solves the 258 rooms of the
MazeBench world; `perturb.js` takes every room the solver proves solvable and
applies single-cell edits: add or remove a wall, raise or lower one, move the
gem, the player or a box, flip an ice slope, toggle a lift, swap floor and
ice, open or fill a pit. Every edited room is solved again. From the results a
pair is formed, preferably from the same kind of edit: one edit that keeps
the room solvable and one that breaks it. The two members therefore differ
from each other at two cells and from the original at one, so nothing but
the consequence of the edit separates the labels.

**Generated rooms.** `generate_rooms.js` builds 16×16 rooms from scratch in
the engine's level format: a 7×7-cell perfect maze (from `web/maze.js`, so
the corridors are the same ones the 2D task draws) or an open field with
scattered wall blocks, plus one mechanic: ice, boxes to push aside, pits with
floating floors to push into them, or an orange wall opened by pushing a box
onto its button. The solver labels the base room, and the same pairing step
as above produces the two members.

## What the shipped pipeline produced

| Step | Result |
| --- | --- |
| `solve_rooms.js` (cap 60k states) | 258 rooms: 170 without a gem, 21 solvable, 31 unsolvable as single rooms, 34 over budget |
| `perturb.js` (2 pairs per room) | 28 pairs from 15 rooms; 22 pairs use the same kind of edit for both members |
| `generate_rooms.js --n 60` | 60 paired rooms from 101 attempts (36 maze, 30 ice, 26 orange, 16 boxes, 12 pits variants) |
| `render.js` | every label re-verified through the engine's level loader; one shipped variant disagreed and is excluded from the exported set |

## Running the pipeline

```bash
git submodule update --init            # vendor/MazeBenchEngine at a pinned commit
(cd vendor/MazeBenchEngine && npm ci)  # three.js and playwright-core for the renderer

node mazebench/solve_rooms.js --cap 60000            # -> mazebench/rooms.jsonl
node mazebench/perturb.js --pairs-per-room 2         # -> mazebench/variants.jsonl
node mazebench/generate_rooms.js --n 60 --type mixed # -> mazebench/generated.jsonl

node mazebench/render.js --variants mazebench/variants.jsonl  --out data/mazebench-shipped
node mazebench/render.js --variants mazebench/generated.jsonl --out data/mazebench-generated

python scripts/export_stimuli.py --manifest data/mazebench-shipped/manifest.jsonl   --set shipped   --max-pairs 60
python scripts/export_stimuli.py --manifest data/mazebench-generated/manifest.jsonl --set generated --max-pairs 60
```

`render.js` writes, per variant, `images/<id>-perspective.png` (the game
camera, tilt 58°, the default for vision agents) and `images/<id>-top.png`
(the room-preview camera looking straight down), `ascii/<id>.txt` (the
top-diagonal ASCII observation) and one line in `manifest.jsonl` with the
label, the edit, the mechanics tags, the solution length, a glyph legend and
the level text. Before rendering, every label is recomputed through the
engine's own level loader and solver; a mismatch aborts the run.

The renderer needs a Chromium that the available `playwright-core` can
launch. `pw-shim.mjs` picks the first of `$PLAYWRIGHT_CORE_PATH`, the engine's
`node_modules/playwright-core`, or a global Playwright whose browser is
installed.

`scripts/export_stimuli.py` resizes a chosen number of pairs into
`web/stimuli/mazebench/` and updates `manifest.js`, which the website loads
as a script so it also works when opened from disk.

## Using the stimuli

- Website: choose *MazeBench rooms* as the source. The Task tab runs blocks
  in which both members of every sampled pair appear, the Explore tab shows
  the pairs side by side with the edit that separates them, and the Model tab
  sends the frames to a model (serve the site over HTTP for this: browsers do
  not let a page read image files from disk).
- `scripts/eval_model.py --manifest data/mazebench-shipped/manifest.jsonl --view perspective --representation image`
  scores a model on a manifest, with accuracy and d′ broken down by edit type
  and by mechanics tag. `--representation ascii` sends the text observation
  with the glyph legend instead, `both` sends both.

The prompt (`web/prompt.js` / `mazes/prompt.py`, `buildRoomPrompt`) explains
the mechanics in the words of the game's own toolbox descriptions.

## File formats

`rooms.jsonl`: one line per shipped room with `status` (`solved`, `unsolved`,
`capped`, `no-gem`), `moves`, `path` (the solver's move string), `expanded`,
`gems`, `tags` and `actors`.

`variants.jsonl` / `generated.jsonl`: one line per variant with `id`, `room`,
`pair`, `solvable`, `edit` (`type` and the changed cells with their tokens
before and after), `sameType`, `tags`, `moves`, `baseMoves`, `expanded` and
`level` (the room in MazeBench level text). The level text can be pasted into
the MazeBench Build editor.

Level text: rows of space-separated cells, `+` separating the layers of a
cell from the bottom up (`.` floor, `.+#` a wall one block high, `.+#+#` two
blocks, `i` ice, `+` a pit, `.+p` the player, `.+G` the gem, `.+M0` a box,
`.+f` a floating floor, `.+O` an orange wall, `.+o` an orange button, `l`/`L`
a lowered/raised lift, `Sr` `Sl` `Su` `Sd` ice slopes).

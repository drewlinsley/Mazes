# maze-snapshot

A single-turn [Prime Intellect Verifiers](https://github.com/PrimeIntellect-ai/verifiers)
environment: the model sees one snapshot of a maze or of a MazeBench room and
answers whether it is solvable. Exactly half of the examples are solvable, and
every label is decided by an exhaustive search (the `mazes` package for 2D
mazes, the MazeBench engine's solver for rooms). This is the same task, prompt
and trial construction as the website in this repository and as
`scripts/eval_model.py`, packaged the way MazeBench's own environment is, so it
runs on Prime Intellect inference with the standard tooling.

> **Environment:** `maze-snapshot`
> **Type:** `SingleTurnEnv`, chat, multimodal (image blocks) or text-only
> **Reward:** `correct` (1 when the final `ANSWER: YES/NO` line matches the label), plus the metrics `answered` and `said_yes`

## Install and run

From this repository:

```bash
cd environments/maze_snapshot
uv venv && uv pip install -e .            # or: pip install -e .

# 40 generated 2D mazes (medium preset), images
vf-eval maze-snapshot -m <model> -b <inference base url> -k <API_KEY_ENV_VAR> -n 40 -r 1

# text-only mazes
vf-eval maze-snapshot -m <model> -b <base url> -k <KEY_VAR> -a '{"representation": "ascii", "preset": "hard"}'

# pre-rendered MazeBench rooms, four camera rotations per room
vf-eval maze-snapshot -m <model> -b <base url> -k <KEY_VAR> -n 54 \
  -a '{"source": "rooms", "manifest": "../../data/mazebench-shipped/manifest.jsonl", "yaws": "0,90,180,270"}'
```

`-a` / `--env-args` takes a JSON object of `load_environment` arguments. To
publish the environment to the Prime Hub, follow the `prime env push` flow used
by MazeBench (`vendor/MazeBenchEngine/environments/mazebench/README.md`).

## Environment arguments

| Argument | Default | Meaning |
| --- | --- | --- |
| `source` | `mazes` | `mazes` (generated 2D mazes) or `rooms` (pre-rendered MazeBench rooms) |
| `n` | `200` | number of examples (even; rooms: pairs are kept together) |
| `seed` | `maze-snapshot` | session seed: same seed, same examples, in any tool |
| `representation` | `image` | `image`, `ascii`, `both`; rooms also `json` (the engine's JSON observation) |
| `preset`, `width`, `height`, `loops`, `cut`, `placement`, `algorithm` | `medium` | maze parameters, as in the website |
| `theme`, `markers`, `grayscale`, `cell_px`, `image_size` | light, S/G discs | maze rendering |
| `manifest` | | `manifest.jsonl` written by `mazebench/render.js` |
| `view` | `perspective` | `perspective` (game camera) or `top` |
| `yaws` | `"0"` | camera rotations to send, e.g. `"0,180"`; needs a manifest rendered with `--yaws` |
| `tag` | | keep only rooms with this mechanics tag (`ice`, `box`, `holes`, `orange`, `slope`, `lift`, `elevation`) |

Each example's `info` carries the label and the difficulty measures (path
length and pocket fraction for mazes; edit type, mechanics tags and solution
length for rooms), so results can be sliced after the run.

## Rewards

| Reward | Weight | Definition |
| --- | ---: | --- |
| `correct` | 1.0 | the parsed answer equals the label |
| `answered` | 0.0 | a `YES` or `NO` could be parsed (metric only) |
| `said_yes` | 0.0 | the answer was `YES` (metric only; with balanced labels, the mean is the response bias) |

Accuracy on a balanced set is the mean of `correct`; hit rate and false-alarm
rate follow from `said_yes` split by `info.solvable`.

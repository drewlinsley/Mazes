"""Mazes with controlled solvability for visual-reasoning experiments.

Half of the mazes are solvable (a path joins S and G) and half are not.
Every seed defines a *minimal pair*: two mazes with the same walls count,
the same S/G positions, differing at exactly two wall segments, one solvable
and one not. See ``generate.py`` for the construction and ``render.py`` for
image output.
"""
from .prng import Mulberry32, fnv1a32, normalize_seed
from .generate import (
    VERSION, DEFAULTS, PRESETS, Maze, generate, generate_pair, normalize_params,
    solve, count_passages, to_block_grid, to_ascii,
)
from .render import render_image, save_png, RenderOptions

__all__ = [
    "Mulberry32", "fnv1a32", "normalize_seed",
    "VERSION", "DEFAULTS", "PRESETS", "Maze", "generate", "generate_pair", "normalize_params",
    "solve", "count_passages", "to_block_grid", "to_ascii",
    "render_image", "save_png", "RenderOptions",
]

"""Seeded PRNG identical to web/maze.js (mulberry32 with 32-bit state).

Every operation is done on unsigned 32-bit patterns, which reproduces the
JavaScript ``Math.imul`` / ``>>>`` semantics bit for bit.
"""
import re

MASK = 0xFFFFFFFF
TWO32 = 4294967296


class Mulberry32:
    """mulberry32 generator. ``random()`` returns a float in [0, 1)."""

    def __init__(self, seed):
        self.a = int(seed) & MASK

    def random(self):
        self.a = (self.a + 0x6D2B79F5) & MASK
        t = self.a
        t = ((t ^ (t >> 15)) * (t | 1)) & MASK
        t = (t ^ ((t + (((t ^ (t >> 7)) * (t | 61)) & MASK)) & MASK)) & MASK
        return ((t ^ (t >> 14)) & MASK) / TWO32

    __call__ = random

    def int(self, n):
        """Integer in [0, n), same draw as ``Math.floor(rnd() * n)``."""
        return int(self.random() * n)

    def shuffle(self, arr):
        """In-place Fisher-Yates shuffle, same draws as the JS version."""
        for i in range(len(arr) - 1, 0, -1):
            j = int(self.random() * (i + 1))
            arr[i], arr[j] = arr[j], arr[i]
        return arr


def fnv1a32(text):
    """FNV-1a 32-bit hash of the UTF-8 encoding of ``text``."""
    h = 0x811C9DC5
    for b in str(text).encode("utf-8"):
        h ^= b
        h = (h * 0x01000193) & MASK
    return h


_DIGITS = re.compile(r"^(-?)(\d+)$")


def normalize_seed(seed):
    """Map any seed (int, digit string, arbitrary string) to a uint32."""
    if isinstance(seed, bool):
        seed = str(seed).lower()
    if isinstance(seed, (int, float)):
        if isinstance(seed, float) and seed != seed:  # NaN behaves like JS: hash of "NaN"
            return fnv1a32("NaN")
        return int(seed) % TWO32
    s = "" if seed is None else str(seed).strip()
    m = _DIGITS.match(s)
    if m:
        h = int(m.group(2)) % TWO32
        return (TWO32 - h) % TWO32 if m.group(1) == "-" else h
    return fnv1a32(s)

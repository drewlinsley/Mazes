"""The question put to a model and the parsing of its reply.

Twin of web/prompt.js (tests/test_parity.py checks that both produce the
same text), so browser runs and scripts/eval_model.py runs are comparable.
"""
import re

_QUESTION = ('Is there a path from S to G that does not cross any wall? Think it through, then end your reply '
             'with a single line that says exactly "ANSWER: YES" if the maze is solvable or "ANSWER: NO" if it is not.')


def marker_description(markers="sg", grayscale=False):
    if markers == "letters":
        return "The letters S and G mark the start and the goal."
    if markers == "dots":
        return "Two identical discs mark the two endpoints, S and G."
    if grayscale:
        return "A filled gray disc marks the start S and a gray ring marks the goal G."
    return "A green disc marks the start S and a red disc marks the goal G."


def build_prompt(repr_="image", markers="sg", grayscale=False, theme="light"):
    """repr_: 'image' | 'ascii' | 'both'."""
    walls = "white lines on a black background" if theme == "dark" else "black lines on a white background"
    if repr_ == "ascii":
        return ('Below is a maze in text form: "#" is wall, "." is open floor, S is the start and G is the goal. '
                "Moves go up, down, left or right between adjacent open cells. " + _QUESTION)
    text = f"The image shows a maze. Walls are drawn as {walls}. {marker_description(markers, grayscale)} "
    if repr_ == "both":
        text += ('The same maze is also given in text form below: "#" is wall, "." is open floor, '
                 "S is the start and G is the goal. ")
    return text + _QUESTION


_ANSWER = re.compile(r"ANSWER:\s*(YES|NO)\b", re.I)


def parse_answer(text):
    """'yes' | 'no' | 'unparsed'."""
    text = text or ""
    found = _ANSWER.findall(text)
    if found:
        return "yes" if found[-1].upper() == "YES" else "no"
    last = text.strip().split("\n")[-1]
    has_yes, has_no = re.search(r"\byes\b", last, re.I), re.search(r"\bno\b", last, re.I)
    if has_yes and not has_no:
        return "yes"
    if has_no and not has_yes:
        return "no"
    return "unparsed"

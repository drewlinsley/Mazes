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


ROOM_RULES = (
    "The room is a 16 by 16 grid of cells seen from above. The green cube is the player; it moves up, down, left or "
    "right one cell at a time. The cyan gem is collected by stepping onto its cell. Dark blocks are walls: they cannot be "
    "entered, and a raised block can only be reached by a lift or an ice slope. Tan cells are floor. Light blue cells are ice: "
    "the player slides across ice until a wall, an object or a non-ice cell stops it. Blue cubes are boxes that the player "
    "can push one cell at a time if the cell beyond is free; boxes with the same number are joined and move together, and "
    "a box cannot leave the room. Purple ramps are ice slopes that carry a slide up or down one level. Green squares are lifts: "
    "standing on a lowered lift raises the player one level, and a raised lift lowers it. Orange walls block the way and drop "
    "only while an orange button is held down by the player or by a box; every button in the room must be held at once. "
    "Black gaps in the floor are pits: anything walking into a pit is lost, but a floating floor tile can be pushed into a pit "
    "to fill it. Punchers launch whatever stops in front of them across the room. Clones copy every move the player makes. "
    "The edges of the room are not passable."
)


def build_room_prompt(repr_="image", legend=None, view="perspective"):
    """Prompt for a pre-rendered MazeBench room (twin of web/prompt.js buildRoomPrompt)."""
    question = ('Can the player collect the gem, that is, does some sequence of moves end with the player on the gem? '
                'Think it through, then end your reply with a single line that says exactly "ANSWER: YES" if the room is solvable or '
                '"ANSWER: NO" if it is not.')
    legend_text = ""
    if legend:
        legend_text = (" Each cell is drawn as a block of characters: the top rows show what is on top of the cell and the bottom row shows "
                       "its side, so taller stacks are taller blocks. Legend: " +
                       ", ".join(f'"{g}" = {legend[g]}' for g in sorted(legend)) + ".")
    text = "This is one room from MazeBench, a 3D block-puzzle game. " + ROOM_RULES + " "
    camera = " from directly above" if view == "top" else " from the game camera"
    if repr_ == "ascii":
        text += "The room is given below in the text form that agents playing the game receive." + legend_text + " "
    elif repr_ == "both":
        text += ("The image shows the room" + camera + ", and the same room is also given below in the text form that agents "
                 "playing the game receive." + legend_text + " ")
    else:
        text += "The image shows the room" + camera + ". "
    return text + question


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

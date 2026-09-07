/*
 * prompt.js — the question put to a model, and how its reply is parsed.
 * mazes/prompt.py is the Python twin (checked by tests/test_parity.py), so
 * browser runs and scripts/eval_model.py runs use identical prompts.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.MazePrompt = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** r: render options ({markers, grayscale, theme}) */
  function markerDescription(r) {
    if (r.markers === 'letters') return 'The letters S and G mark the start and the goal.';
    if (r.markers === 'dots') return 'Two identical discs mark the two endpoints, S and G.';
    if (r.grayscale) return 'A filled gray disc marks the start S and a gray ring marks the goal G.';
    return 'A green disc marks the start S and a red disc marks the goal G.';
  }

  /** repr: 'image' | 'ascii' | 'both' */
  function buildPrompt(r, repr) {
    const walls = r.theme === 'dark' ? 'white lines on a black background' : 'black lines on a white background';
    const question = 'Is there a path from S to G that does not cross any wall? Think it through, then end your reply ' +
      'with a single line that says exactly "ANSWER: YES" if the maze is solvable or "ANSWER: NO" if it is not.';
    if (repr === 'ascii') {
      return 'Below is a maze in text form: "#" is wall, "." is open floor, S is the start and G is the goal. ' +
        'Moves go up, down, left or right between adjacent open cells. ' + question;
    }
    let text = 'The image shows a maze. Walls are drawn as ' + walls + '. ' + markerDescription(r) + ' ';
    if (repr === 'both') {
      text += 'The same maze is also given in text form below: "#" is wall, "." is open floor, S is the start and G is the goal. ';
    }
    return text + question;
  }

  const ROOM_RULES =
    'The room is a 16 by 16 grid of cells seen from above. The green cube is the player; it moves up, down, left or ' +
    'right one cell at a time. The cyan gem is collected by stepping onto its cell. Dark blocks are walls: they cannot be ' +
    'entered, and a raised block can only be reached by a lift or an ice slope. Tan cells are floor. Light blue cells are ice: ' +
    'the player slides across ice until a wall, an object or a non-ice cell stops it. Blue cubes are boxes that the player ' +
    'can push one cell at a time if the cell beyond is free; boxes with the same number are joined and move together, and ' +
    'a box cannot leave the room. Purple ramps are ice slopes that carry a slide up or down one level. Green squares are lifts: ' +
    'standing on a lowered lift raises the player one level, and a raised lift lowers it. Orange walls block the way and drop ' +
    'only while an orange button is held down by the player or by a box; every button in the room must be held at once. ' +
    'Black gaps in the floor are pits: anything walking into a pit is lost, but a floating floor tile can be pushed into a pit ' +
    'to fill it. Punchers launch whatever stops in front of them across the room. Clones copy every move the player makes. ' +
    'The edges of the room are not passable.';

  /** Prompt for a pre-rendered MazeBench room. repr: 'image' | 'ascii' | 'both'; legend: {glyph: name}. */
  function buildRoomPrompt(repr, legend, view) {
    const question = 'Can the player collect the gem, that is, does some sequence of moves end with the player on the gem? ' +
      'Think it through, then end your reply with a single line that says exactly "ANSWER: YES" if the room is solvable or ' +
      '"ANSWER: NO" if it is not.';
    const legendText = legend && Object.keys(legend).length
      ? ' Each cell is drawn as a block of characters: the top rows show what is on top of the cell and the bottom row shows ' +
        'its side, so taller stacks are taller blocks. Legend: ' + Object.keys(legend).sort().map(function (g) { return '"' + g + '" = ' + legend[g]; }).join(', ') + '.'
      : '';
    let text = 'This is one room from MazeBench, a 3D block-puzzle game. ' + ROOM_RULES + ' ';
    if (repr === 'ascii') text += 'The room is given below in the text form that agents playing the game receive.' + legendText + ' ';
    else if (repr === 'both') text += 'The image shows the room' + (view === 'top' ? ' from directly above' : ' from the game camera') + ', and the same room is also given below in the text form that agents playing the game receive.' + legendText + ' ';
    else text += 'The image shows the room' + (view === 'top' ? ' from directly above' : ' from the game camera') + '. ';
    return text + question;
  }

  /** 'yes' | 'no' | 'unparsed' */
  function parseAnswer(text) {
    const m = String(text || '').match(/ANSWER:\s*(YES|NO)\b/ig);
    if (m && m.length) return /YES/i.test(m[m.length - 1]) ? 'yes' : 'no';
    const lines = String(text || '').trim().split(/\n/);
    const last = lines[lines.length - 1] || '';
    const hasYes = /\byes\b/i.test(last), hasNo = /\bno\b/i.test(last);
    if (hasYes && !hasNo) return 'yes';
    if (hasNo && !hasYes) return 'no';
    return 'unparsed';
  }

  return { markerDescription: markerDescription, buildPrompt: buildPrompt, buildRoomPrompt: buildRoomPrompt, ROOM_RULES: ROOM_RULES, parseAnswer: parseAnswer };
}));

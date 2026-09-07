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

  return { markerDescription: markerDescription, buildPrompt: buildPrompt, parseAnswer: parseAnswer };
}));

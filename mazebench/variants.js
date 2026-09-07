/*
 * variants.js — single-cell edits of a MazeBench room and the search for a
 * matched pair: one edit that keeps the room solvable and one that makes it
 * unsolvable, both proven by the engine's solver.
 *
 * Used by perturb.js (shipped rooms) and generate_rooms.js (procedural rooms).
 */
const E = require('./engine');

const EDIT_PRIORITY = ['add_wall', 'remove_wall', 'move_gem', 'flip_slope', 'toggle_lift', 'floor_to_ice', 'ice_to_floor', 'raise_wall', 'lower_wall', 'move_box', 'floor_to_hole', 'hole_to_floor', 'move_player'];

const isPlainFloor = (t) => t.length === 1 && t[0] === '.';
const isIce = (t) => t.length === 1 && t[0] === 'i';
const isAir = (t) => t.length === 1 && t[0] === '';
const isWallTop = (t) => t.length >= 2 && t[t.length - 1] === '#' && t[0] === '.';
const isWall1 = (t) => t.length === 2 && t[0] === '.' && t[1] === '#';
const BOX = /^(M\d+|b|f)$/;
const SLOPE = /^S([rlud])(#|O)?$/;
const FLIP = { r: 'l', l: 'r', u: 'd', d: 'u' };

function neighbors(cells, x, y) {
  const out = [];
  if (y > 0) out.push([x, y - 1]);
  if (x < cells[0].length - 1) out.push([x + 1, y]);
  if (y < cells.length - 1) out.push([x, y + 1]);
  if (x > 0) out.push([x - 1, y]);
  return out;
}

function withCell(cells, x, y, tokens) {
  const next = E.copyCells(cells);
  next[y][x] = E.joinTokens(tokens);
  return next;
}

/** Every candidate single edit of every type. Each has {type, apply(), changes:[{x,y,before,after}]}. */
function enumerateEdits(cells) {
  const W = cells[0].length, H = cells.length;
  const T = (x, y) => E.cellTokens(cells[y][x]);
  const edits = [];
  const floors = [], ices = [], airs = [], wallTops = [], wall1s = [], gems = [], players = [], boxes = [], slopes = [], lifts = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = T(x, y);
      if (isPlainFloor(t)) floors.push([x, y]);
      if (isIce(t)) ices.push([x, y]);
      if (isAir(t) && x > 0 && y > 0 && x < W - 1 && y < H - 1) airs.push([x, y]);
      if (isWallTop(t)) wallTops.push([x, y]);
      if (isWall1(t)) wall1s.push([x, y]);
      const gi = t.indexOf('G'); if (gi >= 0) gems.push([x, y, gi]);
      const pi = t.indexOf('p'); if (pi >= 0) players.push([x, y, pi]);
      if (t.length >= 2 && BOX.test(t[t.length - 1]) && t[0] === '.') boxes.push([x, y]);
      t.forEach((tok, i) => { if (SLOPE.test(tok)) slopes.push([x, y, i]); if (tok === 'l' || tok === 'L') lifts.push([x, y, i]); });
    }
  }
  const change = (x, y, after) => ({ x, y, before: cells[y][x], after });
  floors.forEach(([x, y]) => {
    edits.push({ type: 'add_wall', apply: () => withCell(cells, x, y, ['.', '#']), changes: [change(x, y, '.+#')] });
    edits.push({ type: 'floor_to_ice', apply: () => withCell(cells, x, y, ['i']), changes: [change(x, y, 'i')] });
    edits.push({ type: 'floor_to_hole', apply: () => withCell(cells, x, y, ['']), changes: [change(x, y, '+')] });
  });
  ices.forEach(([x, y]) => edits.push({ type: 'ice_to_floor', apply: () => withCell(cells, x, y, ['.']), changes: [change(x, y, '.')] }));
  airs.forEach(([x, y]) => edits.push({ type: 'hole_to_floor', apply: () => withCell(cells, x, y, ['.']), changes: [change(x, y, '.')] }));
  wall1s.forEach(([x, y]) => edits.push({ type: 'remove_wall', apply: () => withCell(cells, x, y, ['.']), changes: [change(x, y, '.')] }));
  wallTops.forEach(([x, y]) => {
    const t = T(x, y);
    edits.push({ type: 'raise_wall', apply: () => withCell(cells, x, y, t.concat(['#'])), changes: [change(x, y, E.joinTokens(t.concat(['#'])))] });
    if (t.length >= 3) edits.push({ type: 'lower_wall', apply: () => withCell(cells, x, y, t.slice(0, -1)), changes: [change(x, y, E.joinTokens(t.slice(0, -1)))] });
  });
  slopes.forEach(([x, y, i]) => {
    const t = T(x, y).slice();
    const m = SLOPE.exec(t[i]);
    t[i] = 'S' + FLIP[m[1]] + (m[2] || '');
    edits.push({ type: 'flip_slope', apply: () => withCell(cells, x, y, t), changes: [change(x, y, E.joinTokens(t))] });
  });
  lifts.forEach(([x, y, i]) => {
    const t = T(x, y).slice();
    t[i] = t[i] === 'l' ? 'L' : 'l';
    edits.push({ type: 'toggle_lift', apply: () => withCell(cells, x, y, t), changes: [change(x, y, E.joinTokens(t))] });
  });
  gems.forEach(([gx, gy, gi]) => {
    const src = T(gx, gy).slice();
    src.splice(gi, 1);
    floors.forEach(([x, y]) => edits.push({
      type: 'move_gem',
      apply: () => { const c = withCell(cells, gx, gy, src); c[y][x] = E.joinTokens(['.', 'G']); return c; },
      changes: [change(gx, gy, E.joinTokens(src)), change(x, y, '.+G')]
    }));
  });
  players.forEach(([px, py, pi]) => {
    const src = T(px, py).slice();
    src.splice(pi, 1);
    floors.forEach(([x, y]) => edits.push({
      type: 'move_player',
      apply: () => { const c = withCell(cells, px, py, src); c[y][x] = E.joinTokens(['.', 'p']); return c; },
      changes: [change(px, py, E.joinTokens(src)), change(x, y, '.+p')]
    }));
  });
  boxes.forEach(([bx, by]) => {
    const t = T(bx, by);
    const box = t[t.length - 1];
    neighbors(cells, bx, by).forEach(([x, y]) => {
      if (!isPlainFloor(T(x, y))) return;
      edits.push({
        type: 'move_box',
        apply: () => { const c = withCell(cells, bx, by, t.slice(0, -1)); c[y][x] = E.joinTokens(['.', box]); return c; },
        changes: [change(bx, by, E.joinTokens(t.slice(0, -1))), change(x, y, E.joinTokens(['.', box]))]
      });
    });
  });
  return edits;
}

/**
 * Seeded sample of up to perType edits per type, interleaved so every type is
 * tried early. When the cells the solver's solution visits are known, half of
 * each type's budget goes to edits touching those cells: that is where an edit
 * is likely to break the room, so unsolvable variants are found quickly.
 */
function sampleEdits(edits, rnd, perType, types, pathCells) {
  const byType = new Map();
  edits.forEach((e) => { if (!byType.has(e.type)) byType.set(e.type, []); byType.get(e.type).push(e); });
  const onPath = (e) => pathCells && e.changes.some((c) => pathCells.has(c.x + ',' + c.y));
  const picked = [];
  (types || EDIT_PRIORITY).forEach((type) => {
    const list = byType.get(type);
    if (!list) return;
    rnd.shuffle(list);
    if (!pathCells) { picked.push(list.slice(0, perType)); return; }
    const near = list.filter(onPath), far = list.filter((e) => !onPath(e));
    const take = Math.min(near.length, Math.ceil(perType / 2));
    picked.push(near.slice(0, take).concat(far.slice(0, perType - take)));
  });
  const out = [];
  for (let k = 0; ; k++) {
    let any = false;
    for (const list of picked) if (k < list.length) { out.push(list[k]); any = true; }
    if (!any) break;
  }
  return out;
}

/**
 * Search for matched pairs. Returns { base, stats, pairs:[{positive, negative, sameType}], tried, solved, unsolved, capped }.
 * options: { rnd, cap, budgetSeconds, pairsPerRoom, perType, baseResult, types }
 */
async function makePairs(cells, options) {
  const o = Object.assign({ cap: 60000, budgetSeconds: 90, pairsPerRoom: 2, perType: 8 }, options);
  const started = Date.now();
  const stats = E.roomStats(cells);
  const base = o.baseResult || (await E.solve(cells, { cap: o.cap }));
  if (base.status !== 'solved') return { base, stats, pairs: [], tried: 0, solved: 0, unsolved: 0, capped: 0, skipped: base.status };
  let pathCells = null;
  if (base.path) {
    try { pathCells = new Set(E.replayPath(cells, base.path).map(([x, y]) => x + ',' + y)); } catch (e) { pathCells = null; }
  }
  const edits = sampleEdits(enumerateEdits(cells), o.rnd, o.perType, o.types, pathCells);
  const solved = [], unsolved = [];
  let capped = 0, tried = 0;
  for (const edit of edits) {
    if ((Date.now() - started) / 1000 > o.budgetSeconds) break;
    const next = edit.apply();
    const r = await E.solve(next, { cap: o.cap });
    tried++;
    const record = { type: edit.type, changes: edit.changes, cells: next, moves: r.moves ?? null, expanded: r.expanded, seconds: r.seconds };
    if (r.status === 'solved') solved.push(record);
    else if (r.status === 'unsolved') unsolved.push(record);
    else capped++;
    const enough = EDIT_PRIORITY.some((t) => solved.filter((s) => s.type === t).length >= o.pairsPerRoom && unsolved.filter((u) => u.type === t).length >= o.pairsPerRoom);
    if (enough && solved.length + unsolved.length >= o.pairsPerRoom * 4) break;
  }
  const pairs = [];
  const usedS = new Set(), usedU = new Set();
  const take = (sFilter, uFilter) => {
    while (pairs.length < o.pairsPerRoom) {
      const si = solved.findIndex((c, i) => !usedS.has(i) && sFilter(c));
      const ui = unsolved.findIndex((c, i) => !usedU.has(i) && uFilter(c));
      if (si < 0 || ui < 0) return;
      usedS.add(si); usedU.add(ui);
      pairs.push({ positive: solved[si], negative: unsolved[ui], sameType: solved[si].type === unsolved[ui].type });
    }
  };
  EDIT_PRIORITY.forEach((t) => take((c) => c.type === t, (c) => c.type === t));
  take(() => true, () => true);
  return { base, stats, pairs, tried, solved: solved.length, unsolved: unsolved.length, capped, seconds: (Date.now() - started) / 1000 };
}

/** Manifest-style records for the two members of a pair. */
function pairRecords(roomId, world, k, result, pair) {
  return ['positive', 'negative'].map((side) => {
    const v = pair[side];
    return {
      id: `${roomId}-${k}-${side === 'positive' ? 'yes' : 'no'}`,
      room: roomId, world: world || null, pair: `${roomId}-${k}`,
      solvable: side === 'positive', sameType: pair.sameType,
      edit: { type: v.type, changes: v.changes },
      baseMoves: result.base.moves, moves: v.moves, expanded: v.expanded, tags: result.stats.tags, gems: result.stats.gems,
      level: E.serializeCells(v.cells)
    };
  });
}

module.exports = { EDIT_PRIORITY, enumerateEdits, sampleEdits, makePairs, pairRecords, neighbors };

#!/usr/bin/env node
/*
 * generate_rooms.js — procedurally build MazeBench-style rooms with the
 * engine's mechanics, label them with the engine's solver, and emit matched
 * solvable / unsolvable pairs in the same format as perturb.js.
 *
 *   node mazebench/generate_rooms.js --n 40 [--type maze|ice|boxes|holes|orange|mixed] [--layout maze|field|mixed]
 *        [--seed 1] [--out mazebench/generated.jsonl] [--cap 60000] [--pairs-per-room 1] [--room-budget 60]
 *
 * Layouts (16 x 16 cells, walls one block high, the room's own outer wall ring):
 *   maze   a 7x7-cell perfect maze (web/maze.js, so the same seed gives the same
 *          corridors as the 2D task) plus a few loops
 *   field  an open floor with scattered wall blocks
 * Mechanics:
 *   ice     corridor cells become ice: the player slides until something stops it
 *   boxes   weightless boxes stand in corridors and must be pushed out of the way
 *   holes   pits in the corridors and floating floors that can be pushed in to bridge them
 *   orange  an orange wall bars the way; a box must be pushed onto the button that lowers it
 * A room whose base version the solver proves solvable is then paired exactly
 * as shipped rooms are (variants.js): one further edit that keeps it solvable
 * and one that breaks it.
 */
const fs = require('node:fs');
const path = require('node:path');
const E = require('./engine');
const V = require('./variants');
const MazeGen = require(path.join(__dirname, '..', 'web', 'maze.js'));

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const OPTS = {
  n: Number(opt('--n', 20)),
  type: opt('--type', 'mixed'),
  layout: opt('--layout', 'mixed'),
  seed: opt('--seed', '1'),
  out: path.resolve(opt('--out', path.join(__dirname, 'generated.jsonl'))),
  cap: Number(opt('--cap', 60000)),
  pairsPerRoom: Number(opt('--pairs-per-room', 1)),
  roomBudget: Number(opt('--room-budget', 60)),
  maxAttempts: Number(opt('--max-attempts', 0))
};
const TYPES = ['maze', 'ice', 'boxes', 'holes', 'orange'];
const SIZE = 16;

/* ------------------------------------------------------------------ */
/* Base layouts: cells[y][x] of level tokens                            */
/* ------------------------------------------------------------------ */
function mazeLayout(rnd, seed) {
  const maze = MazeGen.generate({ width: 7, height: 7, seed, loops: 2 + rnd.int(3), placement: 'far', solvable: true });
  const blocks = MazeGen.toBlockGrid(maze);   // 15 x 15, 1 = wall
  const cells = [];
  for (let y = 0; y < SIZE; y++) {
    const row = [];
    for (let x = 0; x < SIZE; x++) row.push(y < 15 && x < 15 ? (blocks[y][x] ? '.+#' : '.') : '.+#');
    cells.push(row);
  }
  const s = maze.start, g = maze.goal;
  cells[2 * s[1] + 1][2 * s[0] + 1] = '.+p';
  cells[2 * g[1] + 1][2 * g[0] + 1] = '.+G';
  return { cells, solution: maze.meta.solution.map(([cx, cy]) => [2 * cx + 1, 2 * cy + 1]) };
}

function fieldLayout(rnd) {
  const cells = Array.from({ length: SIZE }, (_, y) => Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? '.+#' : '.')));
  const density = 0.18 + rnd() * 0.12;
  for (let y = 1; y < SIZE - 1; y++) for (let x = 1; x < SIZE - 1; x++) if (rnd() < density) cells[y][x] = '.+#';
  // clusters: extend some walls into 2-3 cell bars
  for (let k = 0; k < 6; k++) {
    const x = 1 + rnd.int(SIZE - 2), y = 1 + rnd.int(SIZE - 2), horiz = rnd() < 0.5, len = 2 + rnd.int(3);
    for (let i = 0; i < len; i++) { const cx = horiz ? x + i : x, cy = horiz ? y : y + i; if (cx < SIZE - 1 && cy < SIZE - 1) cells[cy][cx] = '.+#'; }
  }
  const open = [];
  for (let y = 1; y < SIZE - 1; y++) for (let x = 1; x < SIZE - 1; x++) if (cells[y][x] === '.') open.push([x, y]);
  rnd.shuffle(open);
  const s = open[0];
  // BFS over open cells: goal = farthest reachable cell, so the pair is connected and the walk is long
  const dist = new Map([[s.join(','), 0]]);
  const parent = new Map();
  const queue = [s];
  for (let h = 0; h < queue.length; h++) {
    const [x, y] = queue[h];
    for (const [nx, ny] of V.neighbors(cells, x, y)) {
      if (cells[ny][nx] !== '.' || dist.has(nx + ',' + ny)) continue;
      dist.set(nx + ',' + ny, dist.get(x + ',' + y) + 1);
      parent.set(nx + ',' + ny, [x, y]);
      queue.push([nx, ny]);
    }
  }
  if (queue.length < 20) return fieldLayout(rnd);
  const g = queue[queue.length - 1];
  const solution = [];
  for (let c = g; c; c = parent.get(c.join(','))) solution.push(c);
  solution.reverse();
  cells[s[1]][s[0]] = '.+p';
  cells[g[1]][g[0]] = '.+G';
  return { cells, solution };
}

/* ------------------------------------------------------------------ */
/* Mechanics                                                            */
/* ------------------------------------------------------------------ */
function openCells(cells, exclude) {
  const out = [];
  for (let y = 1; y < SIZE - 1; y++) for (let x = 1; x < SIZE - 1; x++) if (cells[y][x] === '.' && !(exclude && exclude.has(x + ',' + y))) out.push([x, y]);
  return out;
}
function around(cells, x, y) { return V.neighbors(cells, x, y).filter(([nx, ny]) => cells[ny][nx] === '.').length; }
function find(cells, token) { for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (cells[y][x] === token) return [x, y]; return null; }
function near(a, b, d) { return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) <= d; }

function applyIce(cells, rnd) {
  const p = 0.35 + rnd() * 0.4;
  openCells(cells).forEach(([x, y]) => { if (rnd() < p) cells[y][x] = 'i'; });
}

function applyBoxes(cells, rnd, layout) {
  const player = find(cells, '.+p'), gem = find(cells, '.+G');
  const spots = openCells(cells).filter(([x, y]) => around(cells, x, y) >= 2 && !near([x, y], player, 2) && !near([x, y], gem, 1));
  rnd.shuffle(spots);
  const k = 1 + rnd.int(3);
  // prefer cells on the solution path so at least one box is in the way
  const onPath = layout.solution ? spots.filter(([x, y]) => layout.solution.some(([px, py]) => px === x && py === y)) : [];
  const chosen = onPath.slice(0, Math.min(k, onPath.length));
  for (const c of spots) { if (chosen.length >= k) break; if (!chosen.includes(c)) chosen.push(c); }
  chosen.forEach(([x, y], i) => { cells[y][x] = '.+M' + i; });
}

function applyHoles(cells, rnd, layout) {
  const player = find(cells, '.+p'), gem = find(cells, '.+G');
  const candidates = openCells(cells).filter(([x, y]) => !near([x, y], player, 2) && !near([x, y], gem, 1));
  const onPath = layout.solution ? candidates.filter(([x, y]) => layout.solution.some(([px, py]) => px === x && py === y)) : candidates;
  rnd.shuffle(onPath);
  const holes = onPath.slice(0, 1 + rnd.int(2));
  holes.forEach(([x, y]) => { cells[y][x] = '+'; });
  // one floating floor per hole, a few cells away in the open
  const rest = openCells(cells).filter(([x, y]) => around(cells, x, y) >= 2 && !near([x, y], player, 1));
  rnd.shuffle(rest);
  holes.forEach((h, i) => {
    const spot = rest.find((c) => near(c, h, 5) && !near(c, h, 1)) || rest[i];
    if (spot) cells[spot[1]][spot[0]] = '.+f';
  });
}

function applyOrange(cells, rnd, layout) {
  const player = find(cells, '.+p'), gem = find(cells, '.+G');
  const candidates = openCells(cells).filter(([x, y]) => !near([x, y], player, 1) && !near([x, y], gem, 1));
  const onPath = layout.solution ? candidates.filter(([x, y]) => layout.solution.some(([px, py]) => px === x && py === y)) : candidates;
  rnd.shuffle(onPath);
  if (!onPath.length) return;
  const wall = onPath[0];
  cells[wall[1]][wall[0]] = '.+O';
  // button + a box that can be pushed onto it: box at b, button at b+d, open cell at b-d for the pusher
  const spots = openCells(cells).filter(([x, y]) => !near([x, y], player, 1) && !near([x, y], gem, 1) && !near([x, y], wall, 1));
  rnd.shuffle(spots);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [bx, by] of spots) {
    for (const [dx, dy] of rnd.shuffle(dirs.slice())) {
      const button = [bx + dx, by + dy], behind = [bx - dx, by - dy];
      const ok = (c) => c[0] > 0 && c[1] > 0 && c[0] < SIZE - 1 && c[1] < SIZE - 1 && cells[c[1]][c[0]] === '.';
      if (ok(button) && ok(behind)) {
        cells[by][bx] = '.+M0';
        cells[button[1]][button[0]] = '.+o';
        return;
      }
    }
  }
}

function buildRoom(rnd, seed, type, layoutName) {
  const layout = layoutName === 'maze' ? mazeLayout(rnd, seed) : fieldLayout(rnd);
  const cells = layout.cells;
  if (type === 'ice') applyIce(cells, rnd);
  if (type === 'boxes') applyBoxes(cells, rnd, layout);
  if (type === 'holes') applyHoles(cells, rnd, layout);
  if (type === 'orange') applyOrange(cells, rnd, layout);
  return cells;
}

(async () => {
  const rnd = MazeGen.mulberry32(MazeGen.normalizeSeed(OPTS.seed));
  fs.writeFileSync(OPTS.out, '');
  const log = (m) => process.stderr.write(m + '\n');
  let made = 0, attempts = 0, baseUnsolved = 0, baseCapped = 0;
  const maxAttempts = OPTS.maxAttempts || OPTS.n * 8;
  while (made < OPTS.n && attempts < maxAttempts) {
    attempts++;
    const type = OPTS.type === 'mixed' ? TYPES[attempts % TYPES.length] : OPTS.type;
    // pushing puzzles need room to get behind things: prefer open fields for them
    const fieldShare = type === 'boxes' || type === 'holes' || type === 'orange' ? 0.75 : 0.4;
    const layoutName = OPTS.layout === 'mixed' ? (rnd() < fieldShare ? 'field' : 'maze') : OPTS.layout;
    const roomSeed = MazeGen.normalizeSeed(OPTS.seed + ':' + attempts);
    const cells = buildRoom(rnd, roomSeed, type, layoutName);
    const roomId = `gen-${type}-${layoutName}-${roomSeed}`;
    const res = await V.makePairs(cells, { rnd, cap: OPTS.cap, budgetSeconds: OPTS.roomBudget, pairsPerRoom: OPTS.pairsPerRoom, perType: 6 });
    if (res.skipped) { if (res.skipped === 'unsolved') baseUnsolved++; else baseCapped++; log(`${roomId}: base ${res.skipped}`); continue; }
    log(`${roomId}: base ${res.base.moves} moves; tried ${res.tried}: ${res.solved} solvable, ${res.unsolved} unsolvable, ${res.capped} capped; ${res.pairs.length} pairs (${Math.round(res.seconds)}s) [${res.stats.tags.join(',')}]`);
    if (!res.pairs.length) continue;
    res.pairs.forEach((pair, k) => {
      V.pairRecords(roomId, null, k, res, pair).forEach((rec) => { rec.generated = { type, layout: layoutName, seed: roomSeed }; fs.appendFileSync(OPTS.out, JSON.stringify(rec) + '\n'); });
    });
    made++;
  }
  log(`done: ${made} rooms with pairs from ${attempts} attempts (${baseUnsolved} base unsolvable, ${baseCapped} base capped) -> ${OPTS.out}`);
})();

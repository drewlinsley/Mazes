#!/usr/bin/env node
/*
 * perturb.js — turn shipped MazeBench rooms into matched pairs of a solvable
 * and an unsolvable variant, each one edit away from the original room.
 *
 *   node mazebench/perturb.js [--rooms mazebench/rooms.jsonl] [--only id,id] [--limit-rooms N]
 *        [--out mazebench/variants.jsonl] [--cap 60000] [--room-budget 90] [--pairs-per-room 2]
 *        [--per-type 8] [--seed 1]
 *
 * For every room the engine's solver proves solvable, candidate single-cell
 * edits are generated (add or remove a wall, move the gem, the player or a
 * box, flip an ice slope, toggle a lift, swap floor and ice, open a hole).
 * Every candidate is solved with the engine's A* search. A candidate whose
 * whole state space is searched without a solution is proven unsolvable.
 * Pairs prefer two edits of the same kind (for example a wall added at two
 * different cells), so the two members differ in nothing but where the edit
 * sits. Rooms whose search hits the state budget are skipped.
 */
const fs = require('node:fs');
const path = require('node:path');
const E = require('./engine');
const V = require('./variants');
const MazeGen = require(path.join(__dirname, '..', 'web', 'maze.js'));

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const OPTS = {
  rooms: path.resolve(opt('--rooms', path.join(__dirname, 'rooms.jsonl'))),
  only: opt('--only', '') ? new Set(opt('--only', '').split(',')) : null,
  limitRooms: Number(opt('--limit-rooms', 0)),
  out: path.resolve(opt('--out', path.join(__dirname, 'variants.jsonl'))),
  cap: Number(opt('--cap', 60000)),
  roomBudget: Number(opt('--room-budget', 90)),
  pairsPerRoom: Number(opt('--pairs-per-room', 2)),
  perType: Number(opt('--per-type', 8)),
  seed: opt('--seed', '1')
};

(async () => {
  const rnd = MazeGen.mulberry32(MazeGen.normalizeSeed(OPTS.seed));
  const known = new Map();
  if (fs.existsSync(OPTS.rooms)) {
    fs.readFileSync(OPTS.rooms, 'utf8').split('\n').filter(Boolean).forEach((line) => { const r = JSON.parse(line); known.set(r.id, r); });
  }
  let rooms = E.listShippedRooms().filter((r) => !OPTS.only || OPTS.only.has(r.id));
  rooms.forEach((r) => { if (known.has(r.id)) r.result = known.get(r.id); });
  rooms = rooms.filter((r) => !r.result || r.result.status === 'solved');
  if (OPTS.limitRooms) rooms = rooms.slice(0, OPTS.limitRooms);
  const map = E.worldMap();
  fs.writeFileSync(OPTS.out, '');
  const log = (m) => process.stderr.write(m + '\n');
  let nPairs = 0, nRooms = 0;
  for (const room of rooms) {
    const { cells } = E.parseLevelText(room.text);
    const res = await V.makePairs(cells, { rnd, cap: OPTS.cap, budgetSeconds: OPTS.roomBudget, pairsPerRoom: OPTS.pairsPerRoom, perType: OPTS.perType, baseResult: room.result });
    if (res.skipped) { log(`${room.id}: skipped (${res.skipped})`); continue; }
    log(`${room.id}: base ${res.base.moves} moves; tried ${res.tried}: ${res.solved} solvable, ${res.unsolved} unsolvable, ${res.capped} capped; ${res.pairs.length} pairs (${Math.round(res.seconds)}s) [${res.stats.tags.join(',')}]`);
    if (!res.pairs.length) continue;
    nRooms++;
    res.pairs.forEach((pair, k) => {
      V.pairRecords(room.id, map[room.file] ? map[room.file].join('') : null, k, res, pair).forEach((rec) => fs.appendFileSync(OPTS.out, JSON.stringify(rec) + '\n'));
      nPairs++;
    });
  }
  log(`done: ${nPairs} pairs from ${nRooms} rooms -> ${OPTS.out}`);
})();

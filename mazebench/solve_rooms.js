#!/usr/bin/env node
/*
 * Solve every shipped MazeBench room with the engine's own A* search and
 * record the result, one JSON line per room, in mazebench/rooms.jsonl.
 *
 *   node mazebench/solve_rooms.js [--cap 60000] [--out mazebench/rooms.jsonl] [--only id,id] [--resume] [--world DIR]
 *
 * 'solved'   : the player can collect every gem in the room (solution length in `moves`)
 * 'unsolved' : the whole reachable state space was searched without success
 * 'capped'   : the search hit the state budget (label unknown)
 */
const fs = require('node:fs');
const path = require('node:path');
const E = require('./engine');

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const cap = Number(opt('--cap', 60000));
const resume = args.includes('--resume');
const out = path.resolve(opt('--out', path.join(__dirname, 'rooms.jsonl')));
const only = opt('--only', '') ? new Set(opt('--only', '').split(',')) : null;
const world = opt('--world', '') || null;   // room directory from import_world.js (default: the shipped world)

(async () => {
  const map = E.worldMap(world);
  let rooms = E.listRooms(world).filter((r) => !only || only.has(r.id));
  const done = new Set();
  if (resume && fs.existsSync(out)) {
    fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).forEach((line) => { try { done.add(JSON.parse(line).id); } catch (e) { /* skip */ } });
    rooms = rooms.filter((r) => !done.has(r.id));
    process.stderr.write(`resuming: ${done.size} rooms already recorded, ${rooms.length} to go\n`);
  } else {
    fs.writeFileSync(out, '');
  }
  const counts = {};
  for (const room of rooms) {
    const { cells } = E.parseLevelText(room.text);
    const stats = E.roomStats(cells);
    const result = await E.solve(cells, { cap });
    const record = {
      id: room.id, file: room.file, world: map[room.file] ? map[room.file].join('') : null,
      status: result.status, moves: result.moves ?? null, path: result.path ?? null, expanded: result.expanded,
      seconds: Number((result.seconds || 0).toFixed(3)), gems: stats.gems, tags: stats.tags, actors: stats.actors,
      maxStack: stats.maxStack, error: result.error || null
    };
    counts[record.status] = (counts[record.status] || 0) + 1;
    fs.appendFileSync(out, JSON.stringify(record) + '\n');
    process.stderr.write(`${room.id} ${record.status} moves=${record.moves ?? '-'} expanded=${record.expanded} ${record.seconds}s [${stats.tags.join(',')}]\n`);
  }
  process.stderr.write('done: ' + JSON.stringify(counts) + ' -> ' + out + '\n');
})();

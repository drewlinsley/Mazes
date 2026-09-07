#!/usr/bin/env node
/*
 * import_world.js — turn a MazeBench world export into a room directory the
 * pipeline can read.
 *
 *   node mazebench/import_world.js --json my-world.json --id community-foo
 *   node mazebench/import_world.js --dir vendor/MazeBenchEngine/games/draft-abc --id my-draft
 *
 * Input is either the editor state the Build page exports ("mazebench-build-world-v1":
 * {title, world:{width,height}, levels:[{id:"level_AxB", cells:[[token,...],...]}]})
 * or a local draft world directory (games/draft-*). Output goes to
 * mazebench/worlds/<id>/ with levels/level_XxY.txt, world_map.json and
 * world_parsing.json, which solve_rooms.js and perturb.js accept via --world.
 */
const fs = require('node:fs');
const path = require('node:path');
const E = require('./engine');

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const json = opt('--json', '');
const dir = opt('--dir', '');
const id = opt('--id', '') || (json ? path.parse(json).name : path.basename(dir)).replace(/[^a-z0-9-]/gi, '-').toLowerCase();
const outDir = path.resolve(opt('--out', path.join(__dirname, 'worlds', id)));
if (!json && !dir) { console.error('usage: import_world.js (--json export.json | --dir games/draft-x) [--id name]'); process.exit(1); }

const LEVEL_ID = /^level_([A-Z])x([A-Z])$/;
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, 'levels'), { recursive: true });
const map = {};
let worldWidth = 16, worldHeight = 16, title = id, count = 0;
if (json) {
  const state = JSON.parse(fs.readFileSync(json, 'utf8'));
  if (state.version && state.version !== 'mazebench-build-world-v1') throw new Error('unsupported export version ' + state.version);
  title = state.title || id;
  worldWidth = Number(state.world && state.world.width) || 16;
  worldHeight = Number(state.world && state.world.height) || 16;
  (state.levels || []).forEach((level) => {
    const m = LEVEL_ID.exec(String(level.id || ''));
    if (!m || !Array.isArray(level.cells)) return;
    const cells = level.cells.map((row) => row.map((v) => (String(v ?? '').trim() === '' ? E.LAYER : String(v).trim())));
    fs.writeFileSync(path.join(outDir, 'levels', level.id + '.txt'), E.serializeCells(cells));
    map[level.id + '.txt'] = [m[1], m[2]];
    count++;
  });
} else {
  const src = path.resolve(dir);
  const srcMap = JSON.parse(fs.readFileSync(path.join(src, 'world_map.json'), 'utf8')).levels || {};
  const parsing = fs.existsSync(path.join(src, 'world_parsing.json')) ? JSON.parse(fs.readFileSync(path.join(src, 'world_parsing.json'), 'utf8')) : null;
  if (parsing && parsing.rules && parsing.rules.world_size) [worldWidth, worldHeight] = parsing.rules.world_size;
  const meta = fs.existsSync(path.join(src, 'draft.json')) ? JSON.parse(fs.readFileSync(path.join(src, 'draft.json'), 'utf8')) : null;
  if (meta && meta.title) title = meta.title;
  Object.entries(srcMap).forEach(([file, pos]) => {
    const from = path.join(src, 'levels', file);
    if (!fs.existsSync(from)) return;
    fs.copyFileSync(from, path.join(outDir, 'levels', file));
    map[file] = pos;
    count++;
  });
}
fs.writeFileSync(path.join(outDir, 'world_map.json'), JSON.stringify({ levels: map }, null, 1) + '\n');
fs.writeFileSync(path.join(outDir, 'world_parsing.json'), JSON.stringify({ rules: { world_size: [worldWidth, worldHeight], level_size: [16, 16], camera_view: [16, 16] } }, null, 2) + '\n');
fs.writeFileSync(path.join(outDir, 'world.json'), JSON.stringify({ id, title, source: json || dir, rooms: count }, null, 2) + '\n');
console.log(`imported ${count} rooms of "${title}" into ${outDir}`);

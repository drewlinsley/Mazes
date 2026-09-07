#!/usr/bin/env node
/*
 * render.js — render room variants with the MazeBench engine's own renderer
 * and ASCII observer, verify every label through the engine's level loader,
 * and write a manifest for the website and the evaluation script.
 *
 *   node mazebench/render.js --variants mazebench/variants.jsonl --out data/mazebench
 *        [--size 640] [--views perspective,top] [--yaws 0,90,180,270] [--tilt 58] [--zoom auto|1.4] [--limit N] [--cap 60000] [--no-verify]
 *
 * --zoom auto (default) fills the frame with flat rooms (1.4) and backs off for rooms with tall stacks so nothing is cropped.
 *
 * Variants are written into throwaway "draft" worlds inside the engine's games
 * directory (the same mechanism the MazeBench Build mode uses), placed on a
 * checkerboard with void rooms around them so each frame shows one room.
 * Output: OUT/images/<id>-perspective.png (yaw 0) and <id>-perspective-y<yaw>.png for other yaws,
 *         OUT/images/<id>-top.png, OUT/ascii/<id>.txt, OUT/json/<id>.json, OUT/manifest.jsonl, OUT/config.json
 */
const fs = require('node:fs');
const path = require('node:path');
const E = require('./engine');

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const OPTS = {
  variants: path.resolve(opt('--variants', path.join(__dirname, 'variants.jsonl'))),
  out: path.resolve(opt('--out', 'data/mazebench')),
  size: Number(opt('--size', 640)),
  views: opt('--views', 'perspective,top').split(',').map((v) => v.trim()).filter(Boolean),
  yaws: opt('--yaws', '0').split(',').map((v) => ((Number(v) % 360) + 360) % 360).filter((v) => v % 90 === 0),
  tilt: Number(opt('--tilt', 58)),
  zoom: opt('--zoom', 'auto') === 'auto' ? 'auto' : Number(opt('--zoom', 1.4)),
  limit: Number(opt('--limit', 0)),
  cap: Number(opt('--cap', 60000)),
  verify: !args.includes('--no-verify'),
  keepWorlds: args.includes('--keep-worlds')
};
process.env.MAZEBENCH_PLAYWRIGHT_CORE = process.env.MAZEBENCH_PLAYWRIGHT_CORE || path.join(__dirname, 'pw-shim.mjs');

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const SLOTS = []; // even coordinates only: neighbours are void rooms
for (let y = 0; y < 26; y += 2) for (let x = 0; x < 26; x += 2) SLOTS.push([LETTERS[x], LETTERS[y]]);
const AIR_ROOM = Array.from({ length: 16 }, () => Array(16).fill('+').join(' ')).join('\n') + '\n';

function writeWorld(worldId, variants) {
  const dir = path.join(E.ENGINE_DIR, 'games', worldId);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'levels'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'previews'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'draft.json'), JSON.stringify({ title: 'snapshot stimuli ' + worldId }, null, 2));
  fs.copyFileSync(path.join(E.GAME_DIR, 'level_parsing.json'), path.join(dir, 'level_parsing.json'));
  fs.writeFileSync(path.join(dir, 'world_parsing.json'), JSON.stringify({ rules: { world_size: [26, 26], level_size: [16, 16], camera_view: [16, 16] } }, null, 2));
  for (const asset of ['images', 'assets_3d']) fs.symlinkSync(path.join('..', 'maze', asset), path.join(dir, asset));
  const map = {};
  for (let y = 0; y < 26; y++) for (let x = 0; x < 26; x++) {
    const id = `level_${LETTERS[x]}x${LETTERS[y]}`;
    map[id + '.txt'] = [LETTERS[x], LETTERS[y]];
    fs.writeFileSync(path.join(dir, 'levels', id + '.txt'), AIR_ROOM);
  }
  variants.forEach((v, i) => {
    const [x, y] = SLOTS[i];
    v.levelId = `level_${x}x${y}`;
    v.worldId = worldId;
    fs.writeFileSync(path.join(dir, 'levels', v.levelId + '.txt'), v.level);
  });
  fs.writeFileSync(path.join(dir, 'world_map.json'), JSON.stringify({ levels: map }, null, 1));
  return dir;
}

/** glyph -> object name for everything visible in the room (from the engine's own inventory) */
function legendFor(term, ctx) {
  const legend = {};
  (term.buildObservationInventory(ctx) || []).forEach((entry) => {
    if (!entry || !entry.glyph) return;
    const name = String(entry.name || entry.sourceType || '').replace(/_/g, ' ');
    const pair = typeof entry.glyph === 'object' ? entry.glyph : { top: String(entry.glyph), side: ' ' };
    if (pair.top && pair.top !== ' ' && !legend[pair.top]) legend[pair.top] = name;
    if (pair.side && pair.side !== ' ' && !legend[pair.side]) legend[pair.side] = name + ' (side)';
  });
  return legend;
}

/** camera zoom from the tallest stack in the room: flat rooms fill the frame, tall rooms back off */
function autoZoom(levelText) {
  const { cells } = E.parseLevelText(levelText);
  let maxStack = 1;
  cells.forEach((row) => row.forEach((value) => { maxStack = Math.max(maxStack, E.cellTokens(value).length); }));
  return maxStack <= 3 ? 1.4 : maxStack <= 5 ? 1.15 : 0.9;
}

function stripHeader(screen) {
  const lines = screen.split('\n');
  return lines.slice(1).join('\n').replace(/\s+$/, '') + '\n';
}

async function main() {
  const variants = fs.readFileSync(OPTS.variants, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const selected = OPTS.limit ? variants.slice(0, OPTS.limit) : variants;
  fs.mkdirSync(path.join(OPTS.out, 'images'), { recursive: true });
  fs.mkdirSync(path.join(OPTS.out, 'ascii'), { recursive: true });
  fs.mkdirSync(path.join(OPTS.out, 'json'), { recursive: true });
  const term = require(path.join(E.ENGINE_DIR, 'scripts', 'maze-terminal.js'));
  const rf = require(path.join(E.ENGINE_DIR, 'scripts', 'maze-render-frame.js'));
  const mazeEngine = term.loadMazeEngine();
  const manifestPath = path.join(OPTS.out, 'manifest.jsonl');
  fs.writeFileSync(manifestPath, '');
  const log = (m) => process.stderr.write(m + '\n');
  let done = 0, mismatches = 0;
  const started = Date.now();
  const worlds = [];
  for (let i = 0; i < selected.length; i += SLOTS.length) worlds.push(selected.slice(i, i + SLOTS.length));
  for (let w = 0; w < worlds.length; w++) {
    const worldId = `draft-snap-${Date.now().toString(36)}-${w}`;
    const worldVariants = worlds[w];
    writeWorld(worldId, worldVariants);
    // ASCII + verification through the engine's own level loader
    for (const v of worldVariants) {
      const ctx = term.createTerminalContext(mazeEngine, { gameId: worldId, levelId: v.levelId, pitch: 1, yaw: 0, observationMode: 'text', maxExpandedStates: OPTS.cap });
      v.ascii = stripHeader(term.renderScreen(ctx));
      v.legend = legendFor(term, ctx);
      if (typeof term.buildModelJsonPayload === 'function') {
        try {
          const payload = await term.buildModelJsonPayload(ctx);
          fs.writeFileSync(path.join(OPTS.out, 'json', v.id + '.json'), JSON.stringify(payload.json_observation || payload, null, 1) + '\n');
          v.json = path.join('json', v.id + '.json');
        } catch (e) { log('json observation failed for ' + v.id + ': ' + e.message); }
      }
      fs.writeFileSync(path.join(OPTS.out, 'ascii', v.id + '.txt'), v.ascii);
      if (OPTS.verify) {
        const r = await term.solveContext(ctx);
        v.verified = r.status === 'solved' ? true : r.status === 'unsolved' ? false : null;
        if (v.verified !== null && v.verified !== v.solvable) { mismatches++; log(`LABEL MISMATCH ${v.id}: variants says ${v.solvable}, engine loader says ${r.status}`); }
        else if (v.verified === null) log(`verify capped for ${v.id} (${r.status})`);
      }
    }
    // frames: one browser session per world, hop between rooms
    let session = null;
    if (OPTS.views.length) {
      session = await rf.createRenderSession({ gameId: worldId, levelId: worldVariants[0].levelId, width: OPTS.size, height: OPTS.size, view: 1, draft: true, edges: true, fast: true, cameraTiltDegrees: OPTS.tilt, cameraZoom: OPTS.zoom === 'auto' ? autoZoom(worldVariants[0].level) : OPTS.zoom });
    }
    for (const v of worldVariants) {
      v.images = {};
      if (session) {
        if (v !== worldVariants[0]) await rf.applySessionAction(session, `go to level ${v.levelId[6]} ${v.levelId[8]}`);
        if (OPTS.views.includes('perspective')) {
          session.options.cameraZoom = OPTS.zoom === 'auto' ? autoZoom(v.level) : OPTS.zoom;
          v.zoom = session.options.cameraZoom;
          v.images.yaws = {};
          for (const yaw of OPTS.yaws) {
            const turns = yaw / 90;
            while ((((session.cameraYawTurns % 4) + 4) % 4) !== turns) await rf.applySessionAction(session, 'rotate camera right');
            const frame = await rf.captureSessionFrame(session);
            const file = path.join('images', yaw === 0 ? `${v.id}-perspective.png` : `${v.id}-perspective-y${yaw}.png`);
            fs.writeFileSync(path.join(OPTS.out, file), Buffer.from(frame.split(',')[1], 'base64'));
            if (yaw === 0) v.images.perspective = file;
            v.images.yaws[yaw] = file;
          }
          while ((((session.cameraYawTurns % 4) + 4) % 4) !== 0) await rf.applySessionAction(session, 'rotate camera right');
        }
        if (OPTS.views.includes('top')) {
          await session.page.evaluate(() => { if (window.__MAZEBENCH_NATIVE_RAF__) { window.requestAnimationFrame = window.__MAZEBENCH_NATIVE_RAF__; delete window.__MAZEBENCH_NATIVE_RAF__; } });
          const frame = await session.page.evaluate(async () => {
            const app = window.__PIXEL_GAME_APP__;
            app.threeRenderer.useLevelPreviewCamera();
            app.render();
            await new Promise((r) => window.requestAnimationFrame(r));
            await new Promise((r) => window.requestAnimationFrame(r));
            return app.canvas.toDataURL('image/png');
          });
          const file = path.join('images', `${v.id}-top.png`);
          fs.writeFileSync(path.join(OPTS.out, file), Buffer.from(frame.split(',')[1], 'base64'));
          v.images.top = file;
        }
      }
      fs.appendFileSync(manifestPath, JSON.stringify({
        id: v.id, room: v.room, world: v.world, pair: v.pair, solvable: v.solvable, verified: v.verified ?? null,
        edit: v.edit, sameType: v.sameType, tags: v.tags, gems: v.gems, baseMoves: v.baseMoves, moves: v.moves, expanded: v.expanded,
        generated: v.generated || null, zoom: v.zoom || null, images: v.images, ascii: path.join('ascii', v.id + '.txt'), json: v.json || null, legend: v.legend || {}, level: v.level
      }) + '\n');
      done++;
      if (done % 10 === 0 || done === selected.length) log(`${done}/${selected.length} rendered (${Math.round((Date.now() - started) / 1000)}s)`);
    }
    if (session) await rf.closeRenderSession(session);
    if (!OPTS.keepWorlds) fs.rmSync(path.join(E.ENGINE_DIR, 'games', worldId), { recursive: true, force: true });
  }
  fs.writeFileSync(path.join(OPTS.out, 'config.json'), JSON.stringify({
    source: OPTS.variants, count: selected.length, solvable: selected.filter((v) => v.solvable).length, views: OPTS.views, yaws: OPTS.yaws, size: OPTS.size, tilt: OPTS.tilt, zoom: OPTS.zoom,
    verify: OPTS.verify, mismatches, engine: E.ENGINE_DIR, generated: new Date().toISOString()
  }, null, 2));
  log(`done: ${done} variants, ${mismatches} label mismatches -> ${OPTS.out}`);
  if (mismatches) process.exitCode = 2;
}

main().catch((e) => { console.error(e); process.exit(1); });

/*
 * engine.js — load the MazeBench game engine (vendor/MazeBenchEngine) into
 * this Node process and expose the few operations the snapshot task needs:
 *
 *   parseLevelText / serializeCells   level text  <->  cell grid
 *   buildPlayData                     cell grid    ->  engine input
 *   solve                             A* / exhaustive search (solved | unsolved | capped)
 *   roomStats                         which mechanics a room uses
 *   cellTokens / joinTokens           per-cell token stacks ("."+"#" ...)
 *
 * The engine files are the browser scripts the MazeBench site itself runs
 * (public/maze-engine.js, maze-solver.js, author-play-data.js), executed in
 * this process with a fake `window`, exactly as the engine's own bench and
 * test scripts do. Nothing in the engine is modified.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ENGINE_DIR = process.env.MAZEBENCH_ENGINE_DIR
  ? path.resolve(process.env.MAZEBENCH_ENGINE_DIR)
  : path.resolve(__dirname, '..', 'vendor', 'MazeBenchEngine');
const GAME_DIR = path.join(ENGINE_DIR, 'games', 'maze');
const LEVELS_DIR = path.join(GAME_DIR, 'levels');

let loaded = null;

function assertEngine() {
  if (!fs.existsSync(path.join(ENGINE_DIR, 'public', 'maze-engine.js'))) {
    throw new Error(
      'MazeBenchEngine not found at ' + ENGINE_DIR + '. Run `git submodule update --init` ' +
      'or set MAZEBENCH_ENGINE_DIR to a checkout of https://github.com/mazebench/MazeBenchEngine'
    );
  }
}

function loadBrowserScript(relativePath) {
  const absolutePath = path.join(ENGINE_DIR, relativePath);
  vm.runInThisContext(fs.readFileSync(absolutePath, 'utf8'), { filename: absolutePath, displayErrors: true });
}

/** Load the engine once; returns { MazeEngine, MazeSolver, adapter, parsing }. */
function load() {
  if (loaded) return loaded;
  assertEngine();
  if (typeof global.window === 'undefined') global.window = {};
  loadBrowserScript('public/maze-token-patterns.js');
  loadBrowserScript('public/author-play-data.js');
  loadBrowserScript('public/maze-engine.js');
  loadBrowserScript('public/maze-solver.js');
  const parsing = JSON.parse(fs.readFileSync(path.join(GAME_DIR, 'level_parsing.json'), 'utf8'));
  const palette = [];
  for (const [name, def] of Object.entries(parsing.objects)) {
    const tokens = Array.isArray(def.tokens) ? def.tokens : [def];
    tokens.forEach((entry) => {
      const token = typeof entry === 'string' ? entry : entry.token;
      if (!token) return;
      palette.push({
        direction: typeof entry === 'object' ? entry.direction ?? null : null,
        raised: typeof entry === 'object' ? entry.raised === true : false,
        groupId: typeof entry === 'object' ? entry.groupId : undefined,
        imageUrl: null,
        label: (typeof entry === 'object' && entry.label) || name,
        name,
        token,
        type: name
      });
    });
  }
  const adapter = window.AuthorPlayData.createAdapter({
    blockAdder: parsing.rules.block_adder || '+',
    defaultFloorToken: '.',
    game: { id: 'maze' },
    palette
  });
  loaded = { MazeEngine: window.MazeEngine, MazeSolver: window.MazeSolver, adapter, parsing, palette };
  return loaded;
}

/* ------------------------------------------------------------------ */
/* Level text                                                           */
/* ------------------------------------------------------------------ */
const SEPARATOR = ' ';
const LAYER = '+';

/** "a b c\n..." -> { cells: string[][], width, height } (rows padded with air). */
function parseLevelText(text) {
  const rows = String(text).split('\n').filter((line) => line.trim().length > 0);
  const cells = rows.map((line) => line.trim().split(SEPARATOR).filter((t) => t.length > 0));
  const width = Math.max(...cells.map((row) => row.length));
  cells.forEach((row) => { while (row.length < width) row.push(LAYER); });
  return { cells, width, height: cells.length };
}

function serializeCells(cells) {
  return cells.map((row) => row.join(SEPARATOR)).join('\n') + '\n';
}

/** Token stack of a cell value, bottom first; '' means air. "+M0" -> ['', 'M0']; "." -> ['.']. */
function cellTokens(value) {
  const v = String(value ?? '').trim();
  if (v === '' || v === LAYER) return [''];
  return v.split(LAYER).map((t) => (t === 'h' ? '' : t.trim()));
}

function joinTokens(tokens) {
  const t = tokens.slice();
  while (t.length > 1 && t[t.length - 1] === '') t.pop();
  if (t.length === 1 && t[0] === '') return LAYER;
  return t.join(LAYER);
}

function copyCells(cells) {
  return cells.map((row) => row.slice());
}

function buildPlayData(cells, id) {
  const { adapter } = load();
  const width = Math.max(...cells.map((row) => row.length));
  return adapter.buildPlayData({
    cells: cells.map((row) => row.slice()),
    height: cells.length,
    levelId: id || 'room',
    levelLabel: id || 'room',
    sourceFileName: (id || 'room') + '.txt',
    width
  });
}

/* ------------------------------------------------------------------ */
/* Solving                                                              */
/* ------------------------------------------------------------------ */
/**
 * Solve a room: can the player collect every gem?
 * Returns { status: 'solved'|'unsolved'|'capped'|'no-gem'|'error', moves, path, expanded, seconds }.
 * 'unsolved' means the whole reachable state space was searched: proven unsolvable.
 */
async function solve(cellsOrPlayData, options = {}) {
  const { MazeEngine, MazeSolver } = load();
  const playData = Array.isArray(cellsOrPlayData) ? buildPlayData(cellsOrPlayData) : cellsOrPlayData;
  if (!(playData.actors || []).some((a) => a.type === 'gem' && !a.removed)) return { status: 'no-gem', expanded: 0, seconds: 0 };
  if (!(playData.actors || []).some((a) => a.type === 'player' && !a.removed)) return { status: 'no-player', expanded: 0, seconds: 0 };
  const started = process.hrtime.bigint();
  let engine;
  try {
    engine = MazeEngine.createEngine(playData);
  } catch (error) {
    return { status: 'error', error: String(error && error.message || error), expanded: 0, seconds: 0 };
  }
  try {
    const result = await MazeSolver.solveWithAStar(engine, {
      algorithm: options.algorithm || 'astar',
      maxExpandedStates: options.cap || 100000,
      progressYieldStateInterval: 1000000
    });
    return {
      status: result.status,
      moves: result.moves ?? null,
      path: result.path ?? null,
      expanded: result.expanded,
      seconds: Number(process.hrtime.bigint() - started) / 1e9,
      loadWarnings: engine.loadWarnings ? engine.loadWarnings.length : 0
    };
  } catch (error) {
    return { status: 'error', error: String(error && error.message || error), expanded: 0, seconds: Number(process.hrtime.bigint() - started) / 1e9 };
  }
}

/** Cells the player occupies after each move of a solver path ("UDLR" string). */
function replayPath(cellsOrPlayData, pathString) {
  const { MazeEngine } = load();
  const playData = Array.isArray(cellsOrPlayData) ? buildPlayData(cellsOrPlayData) : cellsOrPlayData;
  const engine = MazeEngine.createEngine(playData);
  const state = engine.cloneState(engine.initialState);
  const player = engine.actorTypes.indexOf('player');
  const visited = [];
  const record = () => { if (player >= 0 && !state.actorRemoved[player]) visited.push([state.actorX[player], state.actorY[player]]); };
  record();
  const D = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] };
  for (const ch of String(pathString || '')) {
    const d = D[ch];
    if (!d) continue;
    engine.moveForSearch(state, d[0], d[1]);
    record();
  }
  return visited;
}

/* ------------------------------------------------------------------ */
/* Room statistics                                                      */
/* ------------------------------------------------------------------ */
const TERRAIN_TAGS = {
  ice: 'ice', ice_block: 'ice', ice_slope: 'slope', player_lift: 'lift', orange_wall: 'orange', orange_button: 'orange',
  player_gate: 'gate', wall: 'wall', floor: 'floor', exit: 'exit'
};
const ACTOR_TAGS = { box: 'box', weightless_box: 'box', floating_floor: 'floating_floor', puncher: 'puncher', clone: 'clone' };

function roomStats(cells) {
  const playData = buildPlayData(cells);
  const stats = { width: playData.width, height: playData.height, gems: 0, players: 0, actors: {}, terrain: {}, tags: new Set(), maxStack: 0, air: 0, cellsUsed: 0 };
  (playData.actors || []).forEach((a) => {
    stats.actors[a.type] = (stats.actors[a.type] || 0) + 1;
    if (a.type === 'gem') stats.gems++;
    if (a.type === 'player') stats.players++;
    if (ACTOR_TAGS[a.type]) stats.tags.add(ACTOR_TAGS[a.type]);
  });
  cells.forEach((row) => row.forEach((value) => {
    const tokens = cellTokens(value);
    if (tokens.length === 1 && tokens[0] === '') { stats.air++; return; }
    stats.cellsUsed++;
    stats.maxStack = Math.max(stats.maxStack, tokens.length);
  }));
  (playData.terrain || []).forEach((row) => row.forEach((cell) => {
    const layers = Array.isArray(cell.layers) && cell.layers.length ? cell.layers : [cell];
    layers.forEach((layer) => {
      const type = layer.type;
      if (!type || type === 'empty') return;
      stats.terrain[type] = (stats.terrain[type] || 0) + 1;
      if (TERRAIN_TAGS[type] && type !== 'floor' && type !== 'wall') stats.tags.add(TERRAIN_TAGS[type]);
    });
  }));
  if (stats.air > 0) stats.tags.add('holes');
  if (stats.maxStack > 2) stats.tags.add('elevation');
  stats.tags = Array.from(stats.tags).sort();
  return stats;
}

/** Rooms of a world directory (levels/*.txt + world_map.json); default: the shipped MazeBench world. */
function listRooms(worldDir) {
  const dir = worldDir ? path.resolve(worldDir) : GAME_DIR;
  const levelsDir = path.join(dir, 'levels');
  return fs.readdirSync(levelsDir).filter((f) => f.endsWith('.txt')).sort().map((file) => ({
    file,
    id: path.parse(file).name,
    text: fs.readFileSync(path.join(levelsDir, file), 'utf8')
  }));
}
const listShippedRooms = () => listRooms(null);

function worldMap(worldDir) {
  const dir = worldDir ? path.resolve(worldDir) : GAME_DIR;
  const file = path.join(dir, 'world_map.json');
  if (!fs.existsSync(file)) return {};
  const map = JSON.parse(fs.readFileSync(file, 'utf8'));
  return map.levels || {};
}

module.exports = {
  ENGINE_DIR, GAME_DIR, LEVELS_DIR, LAYER, SEPARATOR,
  load, parseLevelText, serializeCells, cellTokens, joinTokens, copyCells,
  buildPlayData, solve, replayPath, roomStats, listRooms, listShippedRooms, worldMap
};

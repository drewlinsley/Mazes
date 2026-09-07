/*
 * maze.js — maze generation with controlled solvability.
 *
 * Reference implementation shared by the website and the Python package.
 * mazes/generate.py mirrors this file draw-for-draw, so the same seed and
 * parameters produce the identical maze in the browser and in Python
 * (tests/test_parity.py checks this).
 *
 * Design
 * ------
 * 1. Draw a random spanning tree T over a W x H grid of cells (a "perfect"
 *    maze: every pair of cells is joined by exactly one path).
 * 2. Place a start S and a goal G.
 * 3. Pick one edge e on the unique S->G path of T. Removing it splits the
 *    maze into a component A (containing S) and B (containing G).
 * 4. Choose `loops` extra passages X whose endpoints lie in the same
 *    component, plus one more such passage w.
 *
 *    solvable   = T + X            (S and G connected)
 *    unsolvable = T - e + X + w    (S and G disconnected)
 *
 * The two members of a pair have the same number of walls, the same S/G
 * positions and differ at exactly two wall segments, so a classifier cannot
 * read the label off wall counts, endpoint positions or a local pocket.
 * The only global difference: the unsolvable maze has one more cycle.
 *
 * Difficulty knobs: grid size, `cut` (where along the path the maze is
 * split: 'balanced' makes both halves large so the missing link cannot be
 * found by inspecting a small pocket), `placement` ('far' maximises the
 * path length), `loops` and the spanning-tree `algorithm`.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.MazeGen = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = '1.0.0';

  /* ------------------------------------------------------------------ */
  /* PRNG: mulberry32 with explicit 32-bit state (portable to Python)    */
  /* ------------------------------------------------------------------ */
  function mulberry32(seed) {
    let a = seed >>> 0;
    const rnd = function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    /** integer in [0, n) */
    rnd.int = function (n) { return Math.floor(rnd() * n); };
    /** in-place Fisher-Yates shuffle */
    rnd.shuffle = function (arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
      }
      return arr;
    };
    return rnd;
  }

  /** FNV-1a 32-bit hash of the UTF-8 bytes of a string. */
  function fnv1a32(str) {
    const bytes = new TextEncoder().encode(String(str));
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i];
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  /** Any seed (integer, digit string, arbitrary string) -> uint32. */
  function normalizeSeed(seed) {
    if (typeof seed === 'number' && Number.isFinite(seed)) {
      const n = Math.trunc(seed);
      return ((n % 4294967296) + 4294967296) % 4294967296;
    }
    const s = String(seed === undefined || seed === null ? '' : seed).trim();
    const m = /^(-?)(\d+)$/.exec(s);
    if (m) {
      let h = 0;
      for (let i = 0; i < m[2].length; i++) h = (h * 10 + (m[2].charCodeAt(i) - 48)) % 4294967296;
      return m[1] === '-' ? (4294967296 - h) % 4294967296 : h;
    }
    return fnv1a32(s);
  }

  /* ------------------------------------------------------------------ */
  /* Grid helpers. Passages are stored flat: right[i] = 1 if there is an  */
  /* opening between cell i and i+1; down[i] = 1 between i and i+W.       */
  /* ------------------------------------------------------------------ */
  function makeGrid(W, H) {
    return { W: W, H: H, N: W * H, right: new Uint8Array(W * H), down: new Uint8Array(W * H) };
  }
  function copyGrid(g) {
    return { W: g.W, H: g.H, N: g.N, right: new Uint8Array(g.right), down: new Uint8Array(g.down) };
  }
  function setEdge(g, a, b, value) {
    if (b === a + 1) g.right[a] = value;
    else if (b === a - 1) g.right[b] = value;
    else if (b === a + g.W) g.down[a] = value;
    else if (b === a - g.W) g.down[b] = value;
    else throw new Error('setEdge: cells ' + a + ' and ' + b + ' are not adjacent');
  }
  function carve(g, a, b) { setEdge(g, a, b, 1); }
  function isOpen(g, a, b) {
    if (b === a + 1) return g.right[a] === 1;
    if (b === a - 1) return g.right[b] === 1;
    if (b === a + g.W) return g.down[a] === 1;
    if (b === a - g.W) return g.down[b] === 1;
    return false;
  }
  /** Grid neighbours of cell i in the fixed order up, right, down, left. */
  function gridNeighbors(W, H, i) {
    const x = i % W, y = (i - x) / W, out = [];
    if (y > 0) out.push(i - W);
    if (x < W - 1) out.push(i + 1);
    if (y < H - 1) out.push(i + W);
    if (x > 0) out.push(i - 1);
    return out;
  }
  /** Neighbours reachable through an open passage, same fixed order. */
  function openNeighbors(g, i) {
    const W = g.W, x = i % W, y = (i - x) / W, out = [];
    if (y > 0 && g.down[i - W]) out.push(i - W);
    if (x < W - 1 && g.right[i]) out.push(i + 1);
    if (y < g.H - 1 && g.down[i]) out.push(i + W);
    if (x > 0 && g.right[i - 1]) out.push(i - 1);
    return out;
  }
  /** Every grid edge exactly once, in a fixed order, as [a, b] with a < b. */
  function allEdges(W, H) {
    const out = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (x < W - 1) out.push([i, i + 1]);
        if (y < H - 1) out.push([i, i + W]);
      }
    }
    return out;
  }
  function manhattan(W, a, b) {
    const ax = a % W, ay = (a - ax) / W, bx = b % W, by = (b - bx) / W;
    return Math.abs(ax - bx) + Math.abs(ay - by);
  }

  /* ------------------------------------------------------------------ */
  /* Spanning-tree algorithms (each carves N-1 passages into g)           */
  /* ------------------------------------------------------------------ */
  function treeBacktracker(g, rnd) {
    const visited = new Uint8Array(g.N);
    const stack = [rnd.int(g.N)];
    visited[stack[0]] = 1;
    while (stack.length) {
      const cur = stack[stack.length - 1];
      const nb = gridNeighbors(g.W, g.H, cur).filter(function (j) { return !visited[j]; });
      if (nb.length === 0) { stack.pop(); continue; }
      const nxt = nb[rnd.int(nb.length)];
      visited[nxt] = 1;
      carve(g, cur, nxt);
      stack.push(nxt);
    }
  }
  function treeKruskal(g, rnd) {
    const edges = rnd.shuffle(allEdges(g.W, g.H));
    const parent = new Int32Array(g.N);
    for (let i = 0; i < g.N; i++) parent[i] = i;
    const find = function (i) {
      while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
      return i;
    };
    for (let k = 0; k < edges.length; k++) {
      const a = edges[k][0], b = edges[k][1];
      const ra = find(a), rb = find(b);
      if (ra !== rb) { parent[ra] = rb; carve(g, a, b); }
    }
  }
  function treePrim(g, rnd) {
    const inTree = new Uint8Array(g.N);
    const start = rnd.int(g.N);
    inTree[start] = 1;
    const frontier = gridNeighbors(g.W, g.H, start).map(function (j) { return [start, j]; });
    while (frontier.length) {
      const k = rnd.int(frontier.length);
      const a = frontier[k][0], b = frontier[k][1];
      frontier[k] = frontier[frontier.length - 1];
      frontier.pop();
      if (inTree[b]) continue;
      inTree[b] = 1;
      carve(g, a, b);
      const nb = gridNeighbors(g.W, g.H, b);
      for (let q = 0; q < nb.length; q++) if (!inTree[nb[q]]) frontier.push([b, nb[q]]);
    }
  }
  const TREE_ALGORITHMS = { backtracker: treeBacktracker, kruskal: treeKruskal, prim: treePrim };

  /* ------------------------------------------------------------------ */
  /* Graph utilities                                                      */
  /* ------------------------------------------------------------------ */
  function bfs(g, src) {
    const dist = new Int32Array(g.N).fill(-1);
    const parent = new Int32Array(g.N).fill(-1);
    const order = [src];
    dist[src] = 0;
    let head = 0;
    while (head < order.length) {
      const cur = order[head++];
      const nb = openNeighbors(g, cur);
      for (let q = 0; q < nb.length; q++) {
        const j = nb[q];
        if (dist[j] < 0) { dist[j] = dist[cur] + 1; parent[j] = cur; order.push(j); }
      }
    }
    return { dist: dist, parent: parent, order: order };
  }
  function pathFrom(parent, dist, src, dst) {
    if (dist[dst] < 0) return null;
    const p = [];
    for (let c = dst; c !== -1; c = parent[c]) { p.push(c); if (c === src) break; }
    return p.reverse();
  }
  function componentLabels(g) {
    const comp = new Int32Array(g.N).fill(-1);
    const sizes = [];
    let c = 0;
    for (let i = 0; i < g.N; i++) {
      if (comp[i] >= 0) continue;
      const q = [i];
      comp[i] = c;
      let h = 0;
      while (h < q.length) {
        const u = q[h++];
        const nb = openNeighbors(g, u);
        for (let k = 0; k < nb.length; k++) if (comp[nb[k]] < 0) { comp[nb[k]] = c; q.push(nb[k]); }
      }
      sizes.push(q.length);
      c++;
    }
    return { comp: comp, sizes: sizes };
  }
  /** Size of every subtree when the tree is rooted at `root`. */
  function subtreeSizes(tree, root) {
    const r = bfs(tree, root);
    const size = new Int32Array(tree.N).fill(1);
    for (let k = r.order.length - 1; k > 0; k--) {
      const v = r.order[k];
      size[r.parent[v]] += size[v];
    }
    return size;
  }

  /* ------------------------------------------------------------------ */
  /* Endpoint placement and cut selection                                 */
  /* ------------------------------------------------------------------ */
  function placeEndpoints(tree, placement, rnd, minDistance) {
    const W = tree.W, H = tree.H, N = tree.N;
    if (placement === 'corners') return [0, N - 1];
    if (placement === 'border') {
      const side = rnd.int(4);  // 0 left->right, 1 right->left, 2 top->bottom, 3 bottom->top
      const span = side < 2 ? H : W;
      const a = rnd.int(span), b = rnd.int(span);
      if (side === 0) return [a * W, b * W + (W - 1)];
      if (side === 1) return [a * W + (W - 1), b * W];
      if (side === 2) return [a, (H - 1) * W + b];
      return [(H - 1) * W + a, b];
    }
    if (placement === 'far') {
      const s = rnd.int(N);
      const dist = bfs(tree, s).dist;
      let best = -1, t = -1;
      for (let i = 0; i < N; i++) if (dist[i] > best) { best = dist[i]; t = i; }
      return [s, t];
    }
    if (placement === 'random') {
      for (let attempt = 0; attempt < 10000; attempt++) {
        const s = rnd.int(N), t = rnd.int(N);
        if (s !== t && manhattan(W, s, t) >= minDistance) return [s, t];
      }
      throw new Error('placeEndpoints: could not satisfy minDistance=' + minDistance);
    }
    throw new Error('unknown placement: ' + placement);
  }

  /**
   * Choose which edge of the S->G tree path to remove. Edge k joins
   * pathCells[k] and pathCells[k+1]; removing it leaves size[pathCells[k]]
   * cells on the start side (subtree sizes are computed with the tree
   * rooted at the goal).
   */
  function chooseCut(pathCells, size, N, cut, rnd) {
    const L = pathCells.length - 1;
    if (L <= 0) throw new Error('start and goal coincide');
    if (cut === 'random') return rnd.int(L);
    if (typeof cut === 'number') {
      const k = Math.floor(cut * L);
      return Math.max(0, Math.min(L - 1, k));
    }
    if (cut === 'balanced') {
      const idx = [];
      for (let k = 0; k < L; k++) idx.push(k);
      const score = function (k) { return Math.min(size[pathCells[k]], N - size[pathCells[k]]); };
      idx.sort(function (a, b) { return (score(b) - score(a)) || (a - b); });
      return idx[rnd.int(Math.min(3, L))];
    }
    throw new Error('unknown cut: ' + cut);
  }

  /* ------------------------------------------------------------------ */
  /* Public generation API                                                */
  /* ------------------------------------------------------------------ */
  const DEFAULTS = {
    width: 10,
    height: 10,
    seed: 0,
    algorithm: 'backtracker',   // backtracker | kruskal | prim
    placement: 'random',        // random | border | corners | far
    minDistance: null,          // min Manhattan distance for 'random' (default: half the larger side)
    cut: 'balanced',            // balanced | random | number in [0, 1] (position along the path)
    loops: 3                    // extra passages added to BOTH members of a pair
  };

  const PRESETS = {
    easy:    { width: 6,  height: 6,  loops: 1,  cut: 'random',   placement: 'random', algorithm: 'backtracker' },
    medium:  { width: 10, height: 10, loops: 3,  cut: 'balanced', placement: 'random', algorithm: 'backtracker' },
    hard:    { width: 16, height: 16, loops: 6,  cut: 'balanced', placement: 'far',    algorithm: 'backtracker' },
    extreme: { width: 24, height: 24, loops: 12, cut: 'balanced', placement: 'far',    algorithm: 'backtracker' }
  };

  function normalizeParams(userParams) {
    const p = Object.assign({}, DEFAULTS, userParams || {});
    p.width = Math.trunc(Number(p.width));
    p.height = Math.trunc(Number(p.height));
    if (!(p.width >= 3 && p.width <= 100) || !(p.height >= 3 && p.height <= 100)) {
      throw new Error('width and height must be integers between 3 and 100');
    }
    if (!TREE_ALGORITHMS[p.algorithm]) throw new Error('unknown algorithm: ' + p.algorithm);
    if (['random', 'border', 'corners', 'far'].indexOf(p.placement) < 0) throw new Error('unknown placement: ' + p.placement);
    if (typeof p.cut === 'string' && /^\d*\.?\d+$/.test(p.cut)) p.cut = Number(p.cut);
    if (typeof p.cut === 'number') {
      if (!(p.cut >= 0 && p.cut <= 1)) throw new Error('numeric cut must lie in [0, 1]');
    } else if (p.cut !== 'balanced' && p.cut !== 'random') {
      throw new Error('unknown cut: ' + p.cut);
    }
    p.loops = Math.max(0, Math.trunc(Number(p.loops)));
    p.minDistance = (p.minDistance === null || p.minDistance === undefined || p.minDistance === '')
      ? Math.max(2, Math.ceil(Math.max(p.width, p.height) / 2))
      : Math.trunc(Number(p.minDistance));
    p.seed = normalizeSeed(p.seed);
    return p;
  }

  function toRows(flat, W, H) {
    const rows = [];
    for (let y = 0; y < H; y++) {
      const row = [];
      for (let x = 0; x < W; x++) row.push(flat[y * W + x]);
      rows.push(row);
    }
    return rows;
  }
  function xy(W, i) { const x = i % W; return [x, (i - x) / W]; }
  function edgeXY(W, e) { return [xy(W, e[0]), xy(W, e[1])]; }

  function buildMaze(g, s, t, solvable, p, meta) {
    return {
      version: VERSION,
      width: g.W,
      height: g.H,
      seed: p.seed,
      params: {
        width: p.width, height: p.height, seed: p.seed, algorithm: p.algorithm,
        placement: p.placement, minDistance: p.minDistance, cut: p.cut, loops: p.loops
      },
      solvable: solvable,
      start: xy(g.W, s),
      goal: xy(g.W, t),
      right: toRows(Array.from(g.right), g.W, g.H),
      down: toRows(Array.from(g.down), g.W, g.H),
      meta: meta
    };
  }

  function generatePairInternal(userParams) {
    const p = normalizeParams(userParams);
    const W = p.width, H = p.height, N = W * H;
    const rnd = mulberry32(p.seed);

    // 1. spanning tree
    const tree = makeGrid(W, H);
    TREE_ALGORITHMS[p.algorithm](tree, rnd);

    // 2. endpoints and the unique tree path between them
    const st = placeEndpoints(tree, p.placement, rnd, p.minDistance);
    const s = st[0], t = st[1];
    const r = bfs(tree, s);
    const pathCells = pathFrom(r.parent, r.dist, s, t);
    const L = pathCells.length - 1;

    // 3. cut edge
    const size = subtreeSizes(tree, t);
    const k = chooseCut(pathCells, size, N, p.cut, rnd);
    const cutA = pathCells[k], cutB = pathCells[k + 1];
    const startSide = size[cutA];
    const componentSizes = [startSide, N - startSide];

    // 4. within-component candidate passages (walls whose two cells stay
    //    connected after the cut)
    setEdge(tree, cutA, cutB, 0);
    const comp = componentLabels(tree).comp;
    setEdge(tree, cutA, cutB, 1);
    const candidates = [];
    const edges = allEdges(W, H);
    for (let q = 0; q < edges.length; q++) {
      const e = edges[q];
      if (!isOpen(tree, e[0], e[1]) && comp[e[0]] === comp[e[1]]) candidates.push(e);
    }
    rnd.shuffle(candidates);
    const loops = Math.min(p.loops, Math.max(0, candidates.length - 1));
    const X = candidates.slice(0, loops);
    const w = candidates.length > loops ? candidates[loops] : null;

    // 5. assemble both members of the pair
    const pos = copyGrid(tree);
    const neg = copyGrid(tree);
    setEdge(neg, cutA, cutB, 0);
    for (let q = 0; q < X.length; q++) { carve(pos, X[q][0], X[q][1]); carve(neg, X[q][0], X[q][1]); }
    if (w) carve(neg, w[0], w[1]);

    const rp = bfs(pos, s);
    const solution = pathFrom(rp.parent, rp.dist, s, t);
    const passages = N - 1 + X.length;

    const shared = {
      algorithm: p.algorithm,
      placement: p.placement,
      cut: p.cut,
      loopsRequested: p.loops,
      loops: X.length,
      treePathLength: L,
      treePath: pathCells.map(function (i) { return xy(W, i); }),
      cutEdge: edgeXY(W, [cutA, cutB]),
      cutIndex: k,
      openedEdge: w ? edgeXY(W, w) : null,
      loopEdges: X.map(function (e) { return edgeXY(W, e); }),
      componentSizes: componentSizes,
      pocketFrac: Math.min(componentSizes[0], componentSizes[1]) / N,
      passages: passages,
      wallsBalanced: !!w
    };
    const metaPos = Object.assign({}, shared, {
      solutionLength: solution.length - 1,
      solution: solution.map(function (i) { return xy(W, i); })
    });
    const metaNeg = Object.assign({}, shared, { solutionLength: null, solution: null, passages: w ? passages : passages - 1 });

    return {
      positive: buildMaze(pos, s, t, true, p, metaPos),
      negative: buildMaze(neg, s, t, false, p, metaNeg),
      rnd: rnd
    };
  }

  /** Both members of a minimal pair for the given seed/params. */
  function generatePair(params) {
    const r = generatePairInternal(params);
    return { positive: r.positive, negative: r.negative };
  }

  /**
   * One maze. `params.solvable` may be true, false, or null/undefined, in
   * which case the label is a fair coin drawn from the same seeded stream.
   */
  function generate(params) {
    const r = generatePairInternal(params);
    let solvable = params && params.solvable;
    if (solvable === null || solvable === undefined || solvable === '') solvable = r.rnd() < 0.5;
    else if (typeof solvable === 'string') solvable = (solvable === 'true' || solvable === '1');
    return solvable ? r.positive : r.negative;
  }

  /* ------------------------------------------------------------------ */
  /* Analysis helpers on maze objects (nested-row representation)         */
  /* ------------------------------------------------------------------ */
  function gridFromMaze(maze) {
    const g = makeGrid(maze.width, maze.height);
    for (let y = 0; y < maze.height; y++) {
      for (let x = 0; x < maze.width; x++) {
        g.right[y * maze.width + x] = maze.right[y][x] ? 1 : 0;
        g.down[y * maze.width + x] = maze.down[y][x] ? 1 : 0;
      }
    }
    return g;
  }

  /** Independent check: BFS from start; also labels connected components. */
  function solve(maze) {
    const g = gridFromMaze(maze);
    const W = g.W;
    const s = maze.start[1] * W + maze.start[0];
    const t = maze.goal[1] * W + maze.goal[0];
    const r = bfs(g, s);
    const path = pathFrom(r.parent, r.dist, s, t);
    const cl = componentLabels(g);
    return {
      solvable: path !== null,
      path: path ? path.map(function (i) { return xy(W, i); }) : null,
      pathLength: path ? path.length - 1 : null,
      dist: toRows(Array.from(r.dist), g.W, g.H),
      components: toRows(Array.from(cl.comp), g.W, g.H),
      componentSizes: cl.sizes,
      startComponent: cl.comp[s],
      goalComponent: cl.comp[t]
    };
  }

  function countPassages(maze) {
    let n = 0;
    for (let y = 0; y < maze.height; y++) for (let x = 0; x < maze.width; x++) n += (maze.right[y][x] ? 1 : 0) + (maze.down[y][x] ? 1 : 0);
    return n;
  }

  /**
   * Block representation: (2H+1) x (2W+1) grid where 1 = wall, 0 = open.
   * Cell (x, y) sits at block (2x+1, 2y+1).
   */
  function toBlockGrid(maze) {
    const W = maze.width, H = maze.height;
    const rows = [];
    for (let by = 0; by < 2 * H + 1; by++) {
      const row = new Array(2 * W + 1).fill(1);
      rows.push(row);
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        rows[2 * y + 1][2 * x + 1] = 0;
        if (maze.right[y][x]) rows[2 * y + 1][2 * x + 2] = 0;
        if (maze.down[y][x]) rows[2 * y + 2][2 * x + 1] = 0;
      }
    }
    return rows;
  }

  /** ASCII rendering (block grid) with S and G markers. */
  function toAscii(maze, opts) {
    const o = Object.assign({ wall: '#', floor: '.', start: 'S', goal: 'G', path: null }, opts || {});
    const blocks = toBlockGrid(maze);
    const chars = blocks.map(function (row) { return row.map(function (v) { return v ? o.wall : o.floor; }); });
    if (o.path && maze.meta && maze.meta.solution) {
      const sol = maze.meta.solution;
      for (let k = 0; k < sol.length; k++) {
        chars[2 * sol[k][1] + 1][2 * sol[k][0] + 1] = o.path;
        if (k + 1 < sol.length) {
          const nx = sol[k + 1][0], ny = sol[k + 1][1];
          chars[sol[k][1] + ny + 1][sol[k][0] + nx + 1] = o.path;
        }
      }
    }
    chars[2 * maze.start[1] + 1][2 * maze.start[0] + 1] = o.start;
    chars[2 * maze.goal[1] + 1][2 * maze.goal[0] + 1] = o.goal;
    return chars.map(function (row) { return row.join(''); }).join('\n');
  }

  return {
    VERSION: VERSION,
    DEFAULTS: DEFAULTS,
    PRESETS: PRESETS,
    mulberry32: mulberry32,
    fnv1a32: fnv1a32,
    normalizeSeed: normalizeSeed,
    normalizeParams: normalizeParams,
    generate: generate,
    generatePair: generatePair,
    solve: solve,
    countPassages: countPassages,
    toBlockGrid: toBlockGrid,
    toAscii: toAscii
  };
}));

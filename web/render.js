/*
 * render.js — draw a maze (from maze.js) onto a canvas, export PNG data URLs.
 * mazes/render.py reproduces the same geometry with PIL.
 *
 * Geometry: pitch = cellPx + wallPx. Cell (x, y) occupies the square at
 * (margin + wallPx + x*pitch, margin + wallPx + y*pitch) of size cellPx.
 * Wall slots are wallPx wide; lattice pillars are wallPx squares.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.MazeRender = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_OPTIONS = {
    style: 'lines',       // lines: pillars only where walls meet | blocks: every lattice pillar filled
    cellPx: 24,
    wallPx: 4,
    margin: 12,
    theme: 'light',       // light: black walls on white | dark: white walls on black (Pathfinder-like)
    markers: 'sg',        // sg: green S / red G discs | dots: two identical discs | letters: S and G
    markerScale: 0.6,     // disc diameter as a fraction of cellPx
    grayscale: false,     // gray markers (S = filled disc, G = ring for 'sg')
    overlay: null         // null | 'solution' | 'components'
  };

  const THEMES = {
    light: { bg: '#ffffff', wall: '#000000', start: '#2ca02c', goal: '#d62728', dot: '#1f77b4', gray: '#6e6e6e' },
    dark:  { bg: '#000000', wall: '#ffffff', start: '#5ee65e', goal: '#ff6b6b', dot: '#ffd166', gray: '#9a9a9a' }
  };

  function options(opts) { return Object.assign({}, DEFAULT_OPTIONS, opts || {}); }

  function measure(maze, opts) {
    const o = options(opts);
    const pitch = o.cellPx + o.wallPx;
    return {
      width: 2 * o.margin + o.wallPx + maze.width * pitch,
      height: 2 * o.margin + o.wallPx + maze.height * pitch,
      pitch: pitch
    };
  }

  /** Wall slots: h[j][x] = wall above cell (x, j) (j = H means below the last row); v[y][i] = wall left of cell (i, y). */
  function wallSlots(maze) {
    const W = maze.width, H = maze.height;
    const h = [], v = [];
    for (let j = 0; j <= H; j++) {
      const row = [];
      for (let x = 0; x < W; x++) row.push(j === 0 || j === H || !maze.down[j - 1][x]);
      h.push(row);
    }
    for (let y = 0; y < H; y++) {
      const row = [];
      for (let i = 0; i <= W; i++) row.push(i === 0 || i === W || !maze.right[y][i - 1]);
      v.push(row);
    }
    return { h: h, v: v };
  }

  function cellOrigin(o, pitch, x, y) {
    return [o.margin + o.wallPx + x * pitch, o.margin + o.wallPx + y * pitch];
  }

  function solutionCells(maze) {
    if (maze.meta && maze.meta.solution) return maze.meta.solution;
    if (typeof MazeGen !== 'undefined') { const r = MazeGen.solve(maze); return r.path; }
    return null;
  }

  function draw(canvas, maze, opts) {
    const o = options(opts);
    const t = THEMES[o.theme] || THEMES.light;
    const m = measure(maze, o);
    const W = maze.width, H = maze.height, pitch = m.pitch;
    canvas.width = m.width;
    canvas.height = m.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = t.bg;
    ctx.fillRect(0, 0, m.width, m.height);

    // component tint (drawn under the walls)
    if (o.overlay === 'components' && typeof MazeGen !== 'undefined') {
      const r = MazeGen.solve(maze);
      const colors = {};
      colors[r.startComponent] = 'rgba(44,160,44,0.28)';
      colors[r.goalComponent] = 'rgba(214,39,40,0.28)';
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const c = r.components[y][x];
          ctx.fillStyle = colors[c] || 'rgba(128,128,128,0.18)';
          const p = cellOrigin(o, pitch, x, y);
          ctx.fillRect(p[0], p[1], o.cellPx, o.cellPx);
          if (x < W - 1 && maze.right[y][x]) ctx.fillRect(p[0] + o.cellPx, p[1], o.wallPx, o.cellPx);
          if (y < H - 1 && maze.down[y][x]) ctx.fillRect(p[0], p[1] + o.cellPx, o.cellPx, o.wallPx);
        }
      }
      if (!r.solvable && maze.meta && maze.meta.cutEdge) {
        // highlight the missing link
        const a = maze.meta.cutEdge[0], b = maze.meta.cutEdge[1];
        const p = cellOrigin(o, pitch, Math.min(a[0], b[0]), Math.min(a[1], b[1]));
        ctx.fillStyle = 'rgba(255,140,0,0.95)';
        if (a[1] === b[1]) ctx.fillRect(p[0] + o.cellPx - o.wallPx, p[1], 3 * o.wallPx, o.cellPx);
        else ctx.fillRect(p[0], p[1] + o.cellPx - o.wallPx, o.cellPx, 3 * o.wallPx);
      }
    }

    // walls
    const s = wallSlots(maze);
    ctx.fillStyle = t.wall;
    for (let j = 0; j <= H; j++) {
      for (let x = 0; x < W; x++) {
        if (s.h[j][x]) ctx.fillRect(o.margin + o.wallPx + x * pitch, o.margin + j * pitch, o.cellPx, o.wallPx);
      }
    }
    for (let y = 0; y < H; y++) {
      for (let i = 0; i <= W; i++) {
        if (s.v[y][i]) ctx.fillRect(o.margin + i * pitch, o.margin + o.wallPx + y * pitch, o.wallPx, o.cellPx);
      }
    }
    for (let j = 0; j <= H; j++) {
      for (let i = 0; i <= W; i++) {
        let fill = o.style === 'blocks';
        if (!fill) {
          fill = (i > 0 && s.h[j][i - 1]) || (i < W && s.h[j][i]) || (j > 0 && s.v[j - 1][i]) || (j < H && s.v[j][i]);
        }
        if (fill) ctx.fillRect(o.margin + i * pitch, o.margin + j * pitch, o.wallPx, o.wallPx);
      }
    }

    // solution overlay
    if (o.overlay === 'solution') {
      const sol = solutionCells(maze);
      if (sol && sol.length > 1) {
        ctx.strokeStyle = 'rgba(30,144,255,0.75)';
        ctx.lineWidth = Math.max(2, o.cellPx * 0.3);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (let k = 0; k < sol.length; k++) {
          const p = cellOrigin(o, pitch, sol[k][0], sol[k][1]);
          const cx = p[0] + o.cellPx / 2, cy = p[1] + o.cellPx / 2;
          if (k === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
        }
        ctx.stroke();
      }
    }

    // markers
    const r = o.cellPx * o.markerScale / 2;
    const ps = cellOrigin(o, pitch, maze.start[0], maze.start[1]);
    const pg = cellOrigin(o, pitch, maze.goal[0], maze.goal[1]);
    const cs = [ps[0] + o.cellPx / 2, ps[1] + o.cellPx / 2];
    const cg = [pg[0] + o.cellPx / 2, pg[1] + o.cellPx / 2];
    if (o.markers === 'letters') {
      ctx.fillStyle = t.wall;
      ctx.font = 'bold ' + Math.round(o.cellPx * 0.75) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('S', cs[0], cs[1] + o.cellPx * 0.04);
      ctx.fillText('G', cg[0], cg[1] + o.cellPx * 0.04);
    } else if (o.markers === 'dots') {
      ctx.fillStyle = o.grayscale ? t.gray : t.dot;
      ctx.beginPath(); ctx.arc(cs[0], cs[1], r, 0, 2 * Math.PI); ctx.fill();
      ctx.beginPath(); ctx.arc(cg[0], cg[1], r, 0, 2 * Math.PI); ctx.fill();
    } else {
      ctx.fillStyle = o.grayscale ? t.gray : t.start;
      ctx.beginPath(); ctx.arc(cs[0], cs[1], r, 0, 2 * Math.PI); ctx.fill();
      if (o.grayscale) {
        ctx.strokeStyle = t.gray;
        ctx.lineWidth = Math.max(2, r * 0.45);
        ctx.beginPath(); ctx.arc(cg[0], cg[1], r - ctx.lineWidth / 2, 0, 2 * Math.PI); ctx.stroke();
      } else {
        ctx.fillStyle = t.goal;
        ctx.beginPath(); ctx.arc(cg[0], cg[1], r, 0, 2 * Math.PI); ctx.fill();
      }
    }
    return canvas;
  }

  function toDataURL(maze, opts) {
    const canvas = document.createElement('canvas');
    draw(canvas, maze, opts);
    return canvas.toDataURL('image/png');
  }

  /** Largest cellPx (>= 4) such that the image fits within maxPx. */
  function fitCellPx(maze, maxPx, opts) {
    const o = options(opts);
    const longest = Math.max(maze.width, maze.height);
    const cell = Math.floor((maxPx - 2 * o.margin - o.wallPx) / longest) - o.wallPx;
    return Math.max(4, cell);
  }

  return { DEFAULT_OPTIONS: DEFAULT_OPTIONS, THEMES: THEMES, measure: measure, draw: draw, toDataURL: toDataURL, fitCellPx: fitCellPx, wallSlots: wallSlots };
}));

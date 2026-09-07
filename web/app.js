/* app.js — UI for the maze-solvability task: human trials, exploration, model evaluation. */
(function () {
  'use strict';

  const $ = function (sel, root) { return (root || document).querySelector(sel); };
  const buildPrompt = MazePrompt.buildPrompt;
  const parseAnswer = MazePrompt.parseAnswer;
  const $$ = function (sel, root) { return Array.from((root || document).querySelectorAll(sel)); };
  const MAX_PX = 560;

  /* ------------------------------------------------------------------ */
  /* Tabs                                                                 */
  /* ------------------------------------------------------------------ */
  $$('.tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      $$('.tab').forEach(function (b) { b.classList.toggle('active', b === btn); });
      $$('.tab-panel').forEach(function (p) { p.classList.toggle('active', p.id === 'tab-' + btn.dataset.tab); });
      if (btn.dataset.tab === 'explore') { if (sourceMode() === 'rooms') renderRooms(); else renderExplore(); }
      if (btn.dataset.tab === 'model') $('#model-prompt').textContent = currentPrompt($('#model-repr').value);
    });
  });

  /* ------------------------------------------------------------------ */
  /* Shared configuration panel                                           */
  /* ------------------------------------------------------------------ */
  const cfg = {
    preset: $('#preset'), width: $('#width'), height: $('#height'), algorithm: $('#algorithm'),
    placement: $('#placement'), cut: $('#cut'), loops: $('#loops'),
    style: $('#style'), theme: $('#theme'), markers: $('#markers'), wallPx: $('#wallPx'), grayscale: $('#grayscale')
  };
  function applyPreset(name) {
    const p = MazeGen.PRESETS[name];
    if (!p) return;
    cfg.width.value = p.width; cfg.height.value = p.height; cfg.algorithm.value = p.algorithm;
    cfg.placement.value = p.placement; cfg.cut.value = String(p.cut); cfg.loops.value = p.loops;
  }
  cfg.preset.addEventListener('change', function () { applyPreset(cfg.preset.value); renderExplore(); });
  ['width', 'height', 'algorithm', 'placement', 'cut', 'loops'].forEach(function (k) {
    cfg[k].addEventListener('change', function () { cfg.preset.value = 'custom'; renderExplore(); });
  });
  ['style', 'theme', 'markers', 'wallPx', 'grayscale'].forEach(function (k) {
    cfg[k].addEventListener('change', function () { renderExplore(); $('#model-prompt').textContent = currentPrompt($('#model-repr').value); });
  });
  applyPreset('medium');

  /* ------------------------------------------------------------------ */
  /* Stimulus source: generated mazes or pre-rendered MazeBench rooms      */
  /* ------------------------------------------------------------------ */
  const STIM = (window.MAZEBENCH_STIMULI && window.MAZEBENCH_STIMULI.sets) || {};
  const src = { source: $('#source'), set: $('#rooms-set'), view: $('#rooms-view'), tag: $('#rooms-tag'), count: $('#rooms-count') };
  function sourceMode() { return src.source.value === 'rooms' && Object.keys(STIM).length ? 'rooms' : 'maze'; }
  function roomView() { return src.view.value; }
  function roomItems() {
    const set = STIM[src.set.value];
    if (!set) return [];
    const tag = src.tag.value;
    return set.items.filter(function (it) { return !tag || (it.tags || []).indexOf(tag) >= 0; });
  }
  function roomPairs(items) {
    const byPair = new Map();
    (items || roomItems()).forEach(function (it) { if (!byPair.has(it.pair)) byPair.set(it.pair, []); byPair.get(it.pair).push(it); });
    return Array.from(byPair.values()).filter(function (p) { return p.length === 2 && p[0].solvable !== p[1].solvable; })
      .map(function (p) { return p[0].solvable ? p : [p[1], p[0]]; });
  }
  function roomImage(item) { return item.images[roomView()] || item.images.perspective || item.images.top || ''; }
  function populateRoomSets() {
    const keys = Object.keys(STIM);
    src.set.innerHTML = keys.map(function (k) { return '<option value="' + k + '">' + (STIM[k].label || k) + '</option>'; }).join('');
    if (!keys.length) { src.source.querySelector('option[value="rooms"]').disabled = true; src.source.querySelector('option[value="rooms"]').textContent = 'MazeBench rooms (no stimuli exported yet)'; }
    refreshRoomTags();
  }
  function refreshRoomTags() {
    const set = STIM[src.set.value];
    const tags = new Set();
    ((set && set.items) || []).forEach(function (it) { (it.tags || []).forEach(function (t) { tags.add(t); }); });
    const current = src.tag.value;
    src.tag.innerHTML = '<option value="">all rooms</option>' + Array.from(tags).sort().map(function (t) { return '<option value="' + t + '">' + t + '</option>'; }).join('');
    src.tag.value = tags.has(current) ? current : '';
    const pairs = roomPairs();
    const rooms = new Set(pairs.map(function (p) { return p[0].room; }));
    src.count.textContent = pairs.length + ' pairs from ' + rooms.size + ' rooms';
  }
  function applySourceMode() {
    const rooms = sourceMode() === 'rooms';
    $('#rooms-config').hidden = !rooms;
    $('#maze-config').hidden = rooms;
    $('#explore-rooms').hidden = !rooms;
    $('#explore-maze').hidden = rooms;
    $('#task-question').textContent = rooms ? 'Can the player collect the gem?' : 'Is there a path from S to G?';
    $('#task-intro').innerHTML = rooms
      ? 'Each trial shows one MazeBench room. Answer <b>solvable</b> if the player can collect the gem and <b>not solvable</b> if it cannot. Exactly half of the trials are solvable, and every room appears with its twin that differs by a single edit.'
      : 'Each trial shows one maze. Answer <b>solvable</b> or <b>not solvable</b> as quickly and accurately as you can. Exactly half of the trials are solvable.';
    $('#model-prompt').textContent = currentPrompt($('#model-repr').value);
    if (rooms) renderRooms(); else renderExplore();
  }
  function currentPrompt(repr) {
    if (sourceMode() === 'rooms') {
      const items = roomItems();
      return MazePrompt.buildRoomPrompt(repr, items.length ? items[0].legend : {}, roomView());
    }
    return buildPrompt(renderBase(), repr);
  }
  populateRoomSets();
  src.source.addEventListener('change', applySourceMode);
  src.set.addEventListener('change', function () { refreshRoomTags(); roomsIndex = 0; applySourceMode(); });
  src.tag.addEventListener('change', function () { refreshRoomTags(); roomsIndex = 0; applySourceMode(); });
  src.view.addEventListener('change', applySourceMode);

  function mazeParams() {
    return {
      width: Number(cfg.width.value), height: Number(cfg.height.value), algorithm: cfg.algorithm.value,
      placement: cfg.placement.value, cut: cfg.cut.value, loops: Number(cfg.loops.value)
    };
  }
  function renderBase() {
    return { style: cfg.style.value, theme: cfg.theme.value, markers: cfg.markers.value, wallPx: Number(cfg.wallPx.value) || 1, grayscale: cfg.grayscale.checked, margin: 12 };
  }
  function renderOpts(maze, overlay, maxPx) {
    const o = renderBase();
    o.cellPx = MazeRender.fitCellPx(maze, maxPx || MAX_PX, o);
    o.overlay = overlay || null;
    return o;
  }
  function makeMaze(seed, solvable) {
    const p = mazeParams();
    p.seed = seed;
    p.solvable = solvable;
    return MazeGen.generate(p);
  }

  /* ------------------------------------------------------------------ */
  /* Helpers                                                              */
  /* ------------------------------------------------------------------ */
  function download(filename, content, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: type || 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function copyText(text, btn) {
    const done = function () { if (btn) { const old = btn.textContent; btn.textContent = 'copied'; setTimeout(function () { btn.textContent = old; }, 1200); } };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { window.prompt('Copy:', text); });
    else window.prompt('Copy:', text);
  }
  /** one key per line, arrays inline */
  function compactJson(obj) {
    const lines = [];
    const walk = function (o, indent) {
      Object.keys(o).forEach(function (k) {
        const v = o[k];
        if (v && typeof v === 'object' && !Array.isArray(v)) { lines.push(indent + k + ':'); walk(v, indent + '  '); }
        else lines.push(indent + k + ': ' + JSON.stringify(v));
      });
    };
    walk(obj, '');
    return lines.join('\n');
  }
  function csvOf(rows) {
    if (!rows.length) return '';
    const keys = Object.keys(rows[0]);
    const esc = function (v) { v = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    return keys.join(',') + '\n' + rows.map(function (r) { return keys.map(function (k) { return esc(r[k]); }).join(','); }).join('\n') + '\n';
  }
  /** inverse of the standard normal CDF (Acklam's rational approximation) */
  function probit(p) {
    const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    const pl = 0.02425, ph = 1 - pl;
    let q, r;
    if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    if (p > ph) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  /** signal-detection summary; rows need {solvable, answer ('yes'|'no'|other), rt?} */
  function summarize(rows) {
    const answered = rows.filter(function (r) { return r.answer === 'yes' || r.answer === 'no'; });
    const pos = answered.filter(function (r) { return r.solvable; });
    const neg = answered.filter(function (r) { return !r.solvable; });
    const hits = pos.filter(function (r) { return r.answer === 'yes'; }).length;
    const fas = neg.filter(function (r) { return r.answer === 'yes'; }).length;
    const correct = hits + (neg.length - fas);
    const H = (hits + 0.5) / (pos.length + 1), F = (fas + 0.5) / (neg.length + 1);   // log-linear correction
    const rts = answered.filter(function (r) { return typeof r.rt === 'number' && r.correct; }).map(function (r) { return r.rt; }).sort(function (a, b) { return a - b; });
    return {
      n: rows.length, answered: answered.length, correct: correct,
      accuracy: answered.length ? correct / answered.length : NaN,
      hitRate: pos.length ? hits / pos.length : NaN, faRate: neg.length ? fas / neg.length : NaN,
      dprime: (pos.length && neg.length) ? probit(H) - probit(F) : NaN,
      medianRt: rts.length ? rts[Math.floor(rts.length / 2)] : NaN,
      unanswered: rows.length - answered.length
    };
  }
  function fmt(x, digits) { return isNaN(x) ? '–' : x.toFixed(digits === undefined ? 2 : digits); }
  function statsHtml(s, extra) {
    const stat = function (label, value) { return '<div class="stat"><b>' + value + '</b><span>' + label + '</span></div>'; };
    let html = stat('accuracy', isNaN(s.accuracy) ? '–' : Math.round(100 * s.accuracy) + '%') +
      stat('hit rate (solvable → yes)', fmt(s.hitRate)) + stat('false alarms (unsolvable → yes)', fmt(s.faRate)) +
      stat("d′", fmt(s.dprime)) + stat('answered', s.answered + ' / ' + s.n);
    if (!isNaN(s.medianRt)) html += stat('median RT (correct)', Math.round(s.medianRt) + ' ms');
    return html + (extra || '');
  }
  /** Rooms: sample n/2 pairs, keep both members, shuffle. Returns trials with .item. */
  function buildRoomTrials(n, sessionSeed) {
    const rnd = MazeGen.mulberry32(MazeGen.normalizeSeed(sessionSeed));
    const pairs = roomPairs();
    rnd.shuffle(pairs);
    const chosen = pairs.slice(0, Math.max(1, Math.min(pairs.length, Math.floor(n / 2))));
    const trials = [];
    chosen.forEach(function (p) { p.forEach(function (item) { trials.push({ item: item, solvable: item.solvable, seed: item.id }); }); });
    rnd.shuffle(trials);
    trials.forEach(function (t, i) { t.index = i; });
    return trials;
  }
  function buildTrials(n, sessionSeed) {
    const rnd = MazeGen.mulberry32(MazeGen.normalizeSeed(sessionSeed));
    const labels = [];
    for (let i = 0; i < n; i++) labels.push(i % 2 === 0);
    rnd.shuffle(labels);
    return labels.map(function (solvable, i) { return { index: i, seed: MazeGen.normalizeSeed(String(sessionSeed) + ':' + i), solvable: solvable }; });
  }
  function sessionSeedFrom(input) {
    const v = input.value.trim();
    if (v) return v;
    const s = String(Date.now() % 1000000000);
    input.value = s;
    return s;
  }
  function roomRow(t) {
    const it = t.item;
    return {
      trial: t.index, id: it.id, room: it.room, pair: it.pair, solvable: it.solvable ? 1 : 0, editType: it.edit ? it.edit.type : '',
      tags: (it.tags || []).join('|'), moves: it.moves === null || it.moves === undefined ? '' : it.moves, baseMoves: it.baseMoves || '', view: roomView(), set: src.set.value
    };
  }
  function trialRow(t, maze) {
    return {
      trial: t.index, seed: t.seed, solvable: t.solvable ? 1 : 0, width: maze.width, height: maze.height,
      treePathLength: maze.meta.treePathLength, pocketFrac: Number(maze.meta.pocketFrac.toFixed(4)),
      params: JSON.stringify(maze.params)
    };
  }

  /* ------------------------------------------------------------------ */
  /* Task: human trials                                                   */
  /* ------------------------------------------------------------------ */
  const task = { trials: [], i: 0, rows: [], t0: 0, timers: [], accepting: false, feedback: true, stimMs: 0, fixMs: 400 };
  const taskCanvas = $('#task-canvas');

  function clearTimers() { task.timers.forEach(clearTimeout); task.timers = []; }
  function showPanel(which) {
    $('#task-setup').hidden = which !== 'setup';
    $('#task-stage').hidden = which !== 'stage';
    $('#task-results').hidden = which !== 'results';
  }
  $('#task-start').addEventListener('click', function () {
    let n = Math.max(2, Math.round(Number($('#task-n').value) / 2) * 2);
    $('#task-n').value = n;
    task.mode = sourceMode();
    task.trials = task.mode === 'rooms' ? buildRoomTrials(n, sessionSeedFrom($('#task-seed'))) : buildTrials(n, sessionSeedFrom($('#task-seed')));
    if (task.mode === 'rooms' && task.trials.length < n) $('#task-n').value = task.trials.length;
    task.i = 0; task.rows = []; task.feedback = $('#task-feedback').checked;
    task.stimMs = Number($('#task-stim').value) || 0; task.fixMs = Number($('#task-fix').value) || 0;
    showPanel('stage');
    nextTrial();
  });
  $('#task-abort').addEventListener('click', function () { clearTimers(); task.accepting = false; finishTask(); });
  $('#task-restart').addEventListener('click', function () { showPanel('setup'); });

  function nextTrial() {
    clearTimers();
    $('#task-feedback-box').hidden = true;
    if (task.i >= task.trials.length) { finishTask(); return; }
    const t = task.trials[task.i];
    $('#task-progress').textContent = 'Trial ' + (task.i + 1) + ' of ' + task.trials.length;
    $('#task-mask').hidden = true;
    const img = $('#task-image');
    const fix = $('#task-fixation');
    task.accepting = false;
    fix.hidden = false;
    let ready;
    if (task.mode === 'rooms') {
      taskCanvas.hidden = true; img.hidden = false;
      task.current = { trial: t, item: t.item };
      img.src = roomImage(t.item);
      ready = (img.decode ? img.decode() : Promise.resolve()).catch(function () { });
    } else {
      taskCanvas.hidden = false; img.hidden = true;
      const maze = makeMaze(t.seed, t.solvable);
      task.current = { trial: t, maze: maze };
      MazeRender.draw(taskCanvas, maze, renderOpts(maze));
      ready = Promise.resolve();
    }
    const startedAt = performance.now();
    ready.then(function () {
      const remaining = Math.max(0, task.fixMs - (performance.now() - startedAt));
      if (remaining > 0) task.timers.push(setTimeout(showStimulus, remaining)); else showStimulus();
    });
  }
  function showStimulus() {
    $('#task-fixation').hidden = true;
    task.t0 = performance.now();
    task.accepting = true;
    task.masked = false;
    if (task.stimMs > 0) task.timers.push(setTimeout(maskStimulus, task.stimMs));
  }
  function maskStimulus() {
    $('#task-mask').hidden = false;
    task.masked = true;
  }
  function respond(answerYes) {
    if (!task.accepting) return;
    task.accepting = false;
    clearTimers();
    const rt = performance.now() - task.t0;
    const t = task.current.trial, maze = task.current.maze;
    const row = task.mode === 'rooms' ? roomRow(t) : trialRow(t, maze);
    row.answer = answerYes ? 'yes' : 'no';
    row.correct = (answerYes === t.solvable) ? 1 : 0;
    row.rt = Math.round(rt);
    row.maskedBeforeAnswer = task.masked ? 1 : 0;
    task.rows.push(row);
    task.i++;
    const box = $('#task-feedback-box');
    if (task.feedback) {
      box.hidden = false;
      box.textContent = row.correct ? 'Correct' : ('Wrong — this ' + (task.mode === 'rooms' ? 'room' : 'maze') + ' was ' + (t.solvable ? 'solvable' : 'not solvable'));
      box.className = 'feedback ' + (row.correct ? 'ok' : 'bad');
      if (!row.correct && task.mode !== 'rooms') MazeRender.draw(taskCanvas, maze, renderOpts(maze, t.solvable ? 'solution' : 'components'));
      if (task.masked) $('#task-mask').hidden = true;
      task.timers.push(setTimeout(nextTrial, row.correct ? 500 : 1600));
    } else task.timers.push(setTimeout(nextTrial, 150));
  }
  $('#btn-yes').addEventListener('click', function () { respond(true); });
  $('#btn-no').addEventListener('click', function () { respond(false); });
  document.addEventListener('keydown', function (ev) {
    if (!$('#tab-task').classList.contains('active') || $('#task-stage').hidden) return;
    if (ev.target && (ev.target.tagName === 'INPUT' || ev.target.tagName === 'SELECT' || ev.target.tagName === 'TEXTAREA')) return;
    const k = ev.key.toLowerCase();
    if (k === 'f' || k === 'y' || k === 'arrowleft') { ev.preventDefault(); respond(true); }
    else if (k === 'j' || k === 'n' || k === 'arrowright') { ev.preventDefault(); respond(false); }
  });
  function finishTask() {
    showPanel('results');
    const rows = task.rows.map(function (r) { return Object.assign({}, r, { solvable: !!r.solvable, correct: !!r.correct }); });
    const s = summarize(rows);
    $('#task-summary').innerHTML = statsHtml(s);
    const tbl = $('#task-table');
    const cols = task.mode === 'rooms' ? ['trial', 'id', 'solvable', 'answer', 'correct', 'rt', 'editType', 'tags'] : ['trial', 'seed', 'solvable', 'answer', 'correct', 'rt', 'treePathLength', 'pocketFrac'];
    tbl.innerHTML = '<tr>' + cols.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr>' +
      task.rows.map(function (r) { return '<tr>' + cols.map(function (c) { return '<td class="' + (c === 'correct' ? (r.correct ? 'ok' : 'bad') : '') + '">' + r[c] + '</td>'; }).join('') + '</tr>'; }).join('');
  }
  $('#task-export-csv').addEventListener('click', function () { download('maze-task-' + $('#task-seed').value + '.csv', csvOf(task.rows), 'text/csv'); });
  $('#task-export-json').addEventListener('click', function () {
    download('maze-task-' + $('#task-seed').value + '.json', JSON.stringify({ sessionSeed: $('#task-seed').value, source: task.mode, roomSet: task.mode === 'rooms' ? src.set.value : null, roomView: task.mode === 'rooms' ? roomView() : null, params: mazeParams(), render: renderBase(), stimulusMs: task.stimMs, fixationMs: task.fixMs, feedback: task.feedback, summary: summarize(task.rows.map(function (r) { return Object.assign({}, r, { solvable: !!r.solvable, correct: !!r.correct }); })), trials: task.rows }, null, 2), 'application/json');
  });

  /* ------------------------------------------------------------------ */
  /* Explore                                                              */
  /* ------------------------------------------------------------------ */
  const ex = { seed: $('#explore-seed'), view: $('#explore-view'), overlay: $('#explore-overlay'), a: $('#explore-canvas-a'), b: $('#explore-canvas-b'), figB: $('#explore-fig-b'), capA: $('#explore-caption-a'), capB: $('#explore-caption-b'), meta: $('#explore-meta'), ascii: $('#explore-ascii') };
  let exploreCurrent = null;
  function seedStep(delta) {
    const v = ex.seed.value.trim();
    if (/^-?\d+$/.test(v)) ex.seed.value = String(Number(v) + delta);
    else ex.seed.value = String(MazeGen.normalizeSeed(v) + delta);
    renderExplore();
  }
  $('#explore-prev').addEventListener('click', function () { seedStep(-1); });
  $('#explore-next').addEventListener('click', function () { seedStep(1); });
  $('#explore-random').addEventListener('click', function () { ex.seed.value = String(Math.floor(Math.random() * 1e9)); renderExplore(); });
  [ex.seed, ex.view, ex.overlay].forEach(function (el) { el.addEventListener('change', renderExplore); });
  ex.seed.addEventListener('keydown', function (e) { if (e.key === 'Enter') renderExplore(); });

  function caption(m) {
    return (m.solvable ? 'solvable' : 'not solvable') + ' · seed ' + m.seed + ' · ' + m.width + '×' + m.height +
      ' · path ' + (m.solvable ? m.meta.solutionLength : '—') + ' · pocket ' + Math.round(100 * m.meta.pocketFrac) + '%';
  }
  function renderExplore() {
    if (!$('#tab-explore').classList.contains('active')) return;
    let p;
    try {
      p = mazeParams();
      p.seed = ex.seed.value;
      const view = ex.view.value;
      const overlay = ex.overlay.value || null;
      const maxPx = view === 'pair' ? 440 : MAX_PX;
      let a, b = null;
      if (view === 'pair') { const pair = MazeGen.generatePair(p); a = pair.positive; b = pair.negative; }
      else if (view === 'coin') { a = MazeGen.generate(p); }
      else { p.solvable = view === 'true'; a = MazeGen.generate(p); }
      MazeRender.draw(ex.a, a, renderOpts(a, overlay, maxPx));
      ex.capA.textContent = caption(a);
      ex.figB.hidden = !b;
      if (b) { MazeRender.draw(ex.b, b, renderOpts(b, overlay, maxPx)); ex.capB.textContent = caption(b); }
      exploreCurrent = a;
      const meta = Object.assign({}, a.meta);
      delete meta.treePath; delete meta.solution; delete meta.loopEdges;
      ex.meta.textContent = compactJson({ seed: a.seed, solvable: a.solvable, start: a.start, goal: a.goal, params: a.params, meta: meta });
      ex.ascii.textContent = MazeGen.toAscii(a) + (b ? '\n\n' + MazeGen.toAscii(b) : '');
    } catch (err) {
      ex.meta.textContent = 'Error: ' + err.message;
    }
  }
  $('#explore-png').addEventListener('click', function () {
    if (!exploreCurrent) return;
    ex.a.toBlob(function (blob) { download('maze-' + exploreCurrent.seed + '-' + (exploreCurrent.solvable ? 'solvable' : 'unsolvable') + '.png', blob); }, 'image/png');
  });
  $('#explore-json').addEventListener('click', function () {
    if (!exploreCurrent) return;
    download('maze-' + exploreCurrent.seed + '-' + (exploreCurrent.solvable ? 'solvable' : 'unsolvable') + '.json', JSON.stringify(exploreCurrent, null, 1), 'application/json');
  });
  $('#explore-ascii-copy').addEventListener('click', function (e) { if (exploreCurrent) copyText(MazeGen.toAscii(exploreCurrent), e.target); });
  $('#explore-prompt-copy').addEventListener('click', function (e) { copyText(buildPrompt(renderBase(), 'image'), e.target); });

  /* ------------------------------------------------------------------ */
  /* Explore: MazeBench room pairs                                        */
  /* ------------------------------------------------------------------ */
  let roomsIndex = 0;
  function currentPair() {
    const pairs = roomPairs();
    if (!pairs.length) return null;
    roomsIndex = ((roomsIndex % pairs.length) + pairs.length) % pairs.length;
    return { pair: pairs[roomsIndex], n: pairs.length };
  }
  function roomCaption(it, reveal) {
    const edit = it.edit ? it.edit.type.replace(/_/g, ' ') + ' at ' + it.edit.changes.map(function (c) { return '(' + c.x + ',' + c.y + ')'; }).join(' ') : '';
    return (reveal ? (it.solvable ? 'solvable' : 'not solvable') + ' · ' : '') + it.id + (edit ? ' · ' + edit : '') + (reveal && it.moves ? ' · ' + it.moves + ' moves' : '');
  }
  function renderRooms() {
    const cur = currentPair();
    const reveal = $('#rooms-reveal').checked;
    if (!cur) { $('#rooms-pos').textContent = 'no rooms in this set'; return; }
    const a = cur.pair[0], b = cur.pair[1];
    // present the pair in a stable but label-agnostic order: lower id first
    const left = a.id < b.id ? a : b, right = left === a ? b : a;
    $('#rooms-img-a').src = roomImage(left);
    $('#rooms-img-b').src = roomImage(right);
    $('#rooms-cap-a').textContent = roomCaption(left, reveal);
    $('#rooms-cap-b').textContent = roomCaption(right, reveal);
    $('#rooms-pos').textContent = 'pair ' + (roomsIndex + 1) + ' of ' + cur.n + ' · room ' + a.room + (a.world ? ' (world ' + a.world + ')' : '') + ' · ' + (a.tags || []).join(', ');
    const meta = { pair: a.pair, room: a.room, world: a.world, tags: a.tags, baseMoves: a.baseMoves, generated: a.generated || null, left: { id: left.id, solvable: reveal ? left.solvable : '(hidden)', edit: left.edit, moves: reveal ? left.moves : '(hidden)' }, right: { id: right.id, solvable: reveal ? right.solvable : '(hidden)', edit: right.edit, moves: reveal ? right.moves : '(hidden)' }, legend: left.legend };
    $('#rooms-meta').textContent = compactJson(meta);
    $('#rooms-ascii').textContent = left.ascii || '';
    renderRooms.left = left;
  }
  $('#rooms-prev').addEventListener('click', function () { roomsIndex--; renderRooms(); });
  $('#rooms-next').addEventListener('click', function () { roomsIndex++; renderRooms(); });
  $('#rooms-random').addEventListener('click', function () { roomsIndex = Math.floor(Math.random() * 1e9); renderRooms(); });
  $('#rooms-reveal').addEventListener('change', renderRooms);
  $('#rooms-json').addEventListener('click', function () { const cur = currentPair(); if (cur) download(cur.pair[0].pair + '.json', JSON.stringify(cur.pair, null, 1), 'application/json'); });
  $('#rooms-ascii-copy').addEventListener('click', function (e) { if (renderRooms.left) copyText(renderRooms.left.ascii || '', e.target); });
  $('#rooms-prompt-copy').addEventListener('click', function (e) { copyText(currentPrompt('image'), e.target); });

  /* ------------------------------------------------------------------ */
  /* Model evaluation (direct browser -> Anthropic API)                   */
  /* ------------------------------------------------------------------ */
  const model = { running: false, rows: [], abort: null };
  const keyInput = $('#api-key');
  try { if (sessionStorage.getItem('maze-api-key')) { keyInput.value = sessionStorage.getItem('maze-api-key'); $('#api-remember').checked = true; } } catch (e) { /* storage blocked */ }
  $('#api-remember').addEventListener('change', function () { try { if ($('#api-remember').checked) sessionStorage.setItem('maze-api-key', keyInput.value); else sessionStorage.removeItem('maze-api-key'); } catch (e) { /* ignore */ } });
  keyInput.addEventListener('change', function () { try { if ($('#api-remember').checked) sessionStorage.setItem('maze-api-key', keyInput.value); } catch (e) { /* ignore */ } });
  $('#model-repr').addEventListener('change', function () { $('#model-prompt').textContent = currentPrompt($('#model-repr').value); });

  async function imageFileToBase64(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('could not load ' + url + ' (serve the site over HTTP to send room images)');
    const blob = await res.blob();
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result).split(',')[1]); };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  async function askModel(stimulus, opts, signal) {
    const content = [];
    const item = stimulus.item, maze = stimulus.maze;
    if (opts.repr !== 'ascii') {
      const data = item ? await imageFileToBase64(roomImage(item)) : MazeRender.toDataURL(maze, renderOpts(maze, null, 640)).split(',')[1];
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: data } });
    }
    let text = item ? MazePrompt.buildRoomPrompt(opts.repr, item.legend || {}, roomView()) : opts.prompt;
    if (opts.repr !== 'image') text += '\n\n' + (item ? (item.ascii || '') : MazeGen.toAscii(maze));
    content.push({ type: 'text', text: text });
    const body = { model: opts.model, max_tokens: 16000, messages: [{ role: 'user', content: content }] };
    if (opts.effort) body.output_config = { effort: opts.effort };
    const started = performance.now();
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: signal,
      headers: { 'content-type': 'application/json', 'x-api-key': opts.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify(body)
    });
    const latency = Math.round(performance.now() - started);
    const json = await res.json().catch(function () { return {}; });
    if (!res.ok) { const msg = json && json.error && json.error.message ? json.error.message : ('HTTP ' + res.status); throw new Error(msg); }
    const reply = (json.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('\n');
    return { reply: reply, stopReason: json.stop_reason, usage: json.usage || {}, latency: latency, answer: json.stop_reason === 'refusal' ? 'refused' : parseAnswer(reply) };
  }
  function renderModelTable() {
    const cols = model.mode === 'rooms' ? ['trial', 'id', 'solvable', 'answer', 'correct', 'latency', 'editType', 'tags', 'reply'] : ['trial', 'seed', 'solvable', 'answer', 'correct', 'latency', 'treePathLength', 'pocketFrac', 'reply'];
    $('#model-table').innerHTML = '<tr>' + cols.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr>' +
      model.rows.map(function (r) {
        return '<tr>' + cols.map(function (c) {
          let v = r[c]; if (c === 'reply') v = (v || '').replace(/\s+/g, ' ').slice(-90);
          return '<td class="' + (c === 'correct' ? (r.correct ? 'ok' : 'bad') : '') + '" title="' + (c === 'reply' ? String(r.reply || '').replace(/"/g, '&quot;') : '') + '">' + (v === undefined ? '' : v) + '</td>';
        }).join('') + '</tr>';
      }).join('');
    const s = summarize(model.rows.map(function (r) { return Object.assign({}, r, { solvable: !!r.solvable, correct: !!r.correct }); }));
    const tokens = model.rows.reduce(function (acc, r) { return { i: acc.i + (r.inputTokens || 0), o: acc.o + (r.outputTokens || 0) }; }, { i: 0, o: 0 });
    $('#model-summary').innerHTML = model.rows.length ? statsHtml(s, '<div class="stat"><b>' + tokens.i + ' / ' + tokens.o + '</b><span>input / output tokens</span></div>') : '';
  }
  $('#model-run').addEventListener('click', async function () {
    if (model.running) return;
    const apiKey = keyInput.value.trim();
    if (!apiKey) { $('#model-status').textContent = 'Enter an API key first.'; return; }
    const n = Math.max(2, Math.round(Number($('#model-n').value) / 2) * 2);
    $('#model-n').value = n;
    model.mode = sourceMode();
    const opts = { apiKey: apiKey, model: $('#model-name').value, effort: $('#model-effort').value, repr: $('#model-repr').value, prompt: currentPrompt($('#model-repr').value) };
    $('#model-prompt').textContent = opts.prompt;
    const trials = model.mode === 'rooms' ? buildRoomTrials(n, sessionSeedFrom($('#model-seed'))) : buildTrials(n, sessionSeedFrom($('#model-seed')));
    model.running = true; model.rows = []; model.abort = new AbortController();
    $('#model-run').disabled = true; $('#model-stop').disabled = false;
    renderModelTable();
    for (let i = 0; i < trials.length && model.running; i++) {
      const t = trials[i];
      const maze = model.mode === 'rooms' ? null : makeMaze(t.seed, t.solvable);
      $('#model-status').textContent = 'Trial ' + (i + 1) + ' of ' + trials.length + '…';
      const row = model.mode === 'rooms' ? roomRow(t) : trialRow(t, maze);
      try {
        const r = await askModel({ maze: maze, item: t.item }, opts, model.abort.signal);
        row.answer = r.answer; row.correct = (r.answer === 'yes') === t.solvable && (r.answer === 'yes' || r.answer === 'no') ? 1 : 0;
        row.latency = r.latency; row.reply = r.reply; row.stopReason = r.stopReason;
        row.inputTokens = r.usage.input_tokens; row.outputTokens = r.usage.output_tokens;
      } catch (err) {
        if (err.name === 'AbortError') break;
        row.answer = 'error'; row.correct = 0; row.reply = String(err.message || err);
        $('#model-status').textContent = 'Error: ' + row.reply;
        model.rows.push(row); renderModelTable();
        if (/api key|authentication|401|403/i.test(row.reply)) break;
        continue;
      }
      model.rows.push(row);
      renderModelTable();
    }
    model.running = false;
    $('#model-run').disabled = false; $('#model-stop').disabled = true;
    if (!/^Error/.test($('#model-status').textContent)) $('#model-status').textContent = 'Done: ' + model.rows.length + ' trials.';
  });
  $('#model-stop').addEventListener('click', function () { model.running = false; if (model.abort) model.abort.abort(); });
  $('#model-export-csv').addEventListener('click', function () { download('maze-model-' + $('#model-seed').value + '.csv', csvOf(model.rows), 'text/csv'); });
  $('#model-export-json').addEventListener('click', function () {
    download('maze-model-' + $('#model-seed').value + '.json', JSON.stringify({ sessionSeed: $('#model-seed').value, source: model.mode, roomSet: model.mode === 'rooms' ? src.set.value : null, roomView: model.mode === 'rooms' ? roomView() : null, model: $('#model-name').value, effort: $('#model-effort').value, representation: $('#model-repr').value, prompt: $('#model-prompt').textContent, params: mazeParams(), render: renderBase(), summary: summarize(model.rows.map(function (r) { return Object.assign({}, r, { solvable: !!r.solvable, correct: !!r.correct }); })), trials: model.rows }, null, 2), 'application/json');
  });

  // initial state
  applySourceMode();
  window.MazeApp = { buildTrials: buildTrials, buildRoomTrials: buildRoomTrials, roomPairs: roomPairs, summarize: summarize, probit: probit, buildPrompt: buildPrompt, parseAnswer: parseAnswer, renderExplore: renderExplore, renderRooms: renderRooms };
}());

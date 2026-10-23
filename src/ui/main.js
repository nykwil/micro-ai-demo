import { Level, FLOOR, SOLID, PIT, WALL, FLOOR_SOCKET } from '../core/level.js';
import { MarioAnalyzer, JUMP_POLICIES } from '../core/mario.js';
import { analyzeLevel, summarize, changeReport } from '../core/analysis.js';
import { solve, describeAction } from '../core/solver.js';
import { computeMetrics } from '../core/metrics.js';
import { replaySolution } from '../core/replay.js';
import { repairShortcut, DEFAULT_TARGETS } from '../core/generator.js';
import { Game } from '../core/game.js';
import { MARIO } from '../core/physics.js';
import { SAMPLES } from '../core/samples.js';
import { drawLevel, bodyForState } from './render.js';
import { initInput, readInputs } from './input.js';

const $ = (id) => document.getElementById(id);
const canvas = $('canvas');
const ctx = canvas.getContext('2d');

const S = {
  level: null,
  analyzer: new MarioAnalyzer(),
  analysis: null,
  result: null,
  metrics: null,
  summary: null,
  tool: 'floor',
  tab: 'edit',
  overlays: { regions: true, platforms: true, jumps: false, launches: false, ids: false },
  selectedEdge: -1,
  step: -1,
  anim: null,
  game: null,
  undo: [],
  stroke: null,
  hover: null,
  candidate: null,
  candidates: [],
  ts: 48,
  dirty: true,
};

// ---------------------------------------------------------------------------
// Level lifecycle
// ---------------------------------------------------------------------------

function loadLevel(level, { candidate = null } = {}) {
  S.level = level;
  S.candidate = candidate;
  S.undo = [];
  S.analyzer = new MarioAnalyzer();
  S.summary = null;
  $('report').textContent = 'Edit the level to see how reachability changes.';
  reanalyze(null);
  resize();
  if (S.tab === 'play') startGame();
}

function reanalyze(desc) {
  const L = S.level;
  $('levelName').textContent = L.name;
  const errors = L.validate();
  const before = S.summary;
  S.analysis = analyzeLevel(L, S.analyzer);
  S.result = errors.length ? { status: 'invalid', errors } : solve(S.analysis);
  S.metrics = S.result.status === 'solved' ? computeMetrics(L, S.analysis, S.result) : null;
  S.summary = summarize(S.analysis, S.result);
  S.step = -1;
  S.anim = null;
  S.selectedEdge = -1;
  if (desc && before) {
    const rep = changeReport(desc, before, S.summary);
    $('report').textContent = rep.text;
  }
  setStatus();
  renderAnalysis();
  renderSolve();
  S.dirty = true;
}

function setStatus(text, cls) {
  const st = $('status');
  if (text === undefined) {
    const r = S.result;
    if (r.status === 'invalid') { text = `Invalid level: ${r.errors.join('; ')}`; cls = 'bad'; }
    else if (r.status === 'solved') { text = `Solvable in ${r.minActions} actions (${r.explored} states searched)`; cls = 'good'; }
    else if (r.status === 'unsolvable') { text = `Proven unsolvable (${r.explored} states searched)`; cls = 'bad'; }
    else { text = `Search budget exhausted after ${r.stateCount} states: inconclusive`; cls = 'bad'; }
  }
  st.textContent = text;
  st.className = cls || '';
}

function pushUndo() {
  S.undo.push(JSON.stringify(S.level.toJSON()));
  if (S.undo.length > 100) S.undo.shift();
}

function undo() {
  const j = S.undo.pop();
  if (!j) return;
  S.level = Level.fromJSON(JSON.parse(j));
  reanalyze('Undo');
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

const TILE_OF_TOOL = { floor: FLOOR, solid: SOLID, pit: PIT };
const TILE_NAME = ['floor', 'solid', 'pit'];

function cellAt(ev) {
  const r = canvas.getBoundingClientRect();
  const fx = ((ev.clientX - r.left) / r.width) * S.level.width;
  const fy = ((ev.clientY - r.top) / r.height) * S.level.height;
  return { x: Math.floor(fx), y: Math.floor(fy), fx, fy };
}

function applyTool(c, first) {
  const L = S.level;
  if (!L.inBounds(c.x, c.y)) return null;
  const tool = S.tool;
  if (TILE_OF_TOOL[tool] !== undefined) {
    const t = TILE_OF_TOOL[tool];
    if (L.get(c.x, c.y) === t) return null;
    L.set(c.x, c.y, t);
    L.sockets = L.sockets.filter((s) => L.socketValid(s));
    L.rebuildIndex();
    return `${t === SOLID ? 'Added solid' : `Painted ${TILE_NAME[t]}`} at (${c.x}, ${c.y})`;
  }
  if (!first) return null;
  if (tool === 'exit') {
    L.set(c.x, c.y, FLOOR);
    const i = L.exits.findIndex((e) => e.x === c.x && e.y === c.y);
    if (i >= 0 && L.exits.length > 1) L.exits.splice(i, 1);
    else if (i < 0) L.exits.push({ x: c.x, y: c.y });
    L.rebuildIndex();
    return `Toggled exit at (${c.x}, ${c.y})`;
  }
  if (tool === 'startA' || tool === 'startB') {
    L.set(c.x, c.y, FLOOR);
    L[tool] = { x: c.x, y: c.y };
    L.rebuildIndex();
    return `Moved ${tool === 'startA' ? 'A' : 'B'} start to (${c.x}, ${c.y})`;
  }
  if (tool === 'floorSocket') {
    const i = L.sockets.findIndex((s) => s.type === FLOOR_SOCKET && s.x === c.x && s.y === c.y);
    if (i >= 0) L.sockets.splice(i, 1);
    else {
      L.set(c.x, c.y, FLOOR);
      L.sockets.push({ type: FLOOR_SOCKET, x: c.x, y: c.y });
    }
    L.rebuildIndex();
    return `${i >= 0 ? 'Removed' : 'Added'} floor socket at (${c.x}, ${c.y})`;
  }
  if (tool === 'wallSocket') {
    if (L.get(c.x, c.y) !== SOLID) return null;
    const n = c.fx - c.x < 0.5 ? -1 : 1;
    const i = L.sockets.findIndex((s) => s.type === WALL && s.x === c.x && s.y === c.y && s.n === n);
    if (i >= 0) L.sockets.splice(i, 1);
    else {
      const s = { type: WALL, x: c.x, y: c.y, n };
      if (!L.socketValid(s)) return null;
      L.sockets.push(s);
    }
    L.rebuildIndex();
    return `${i >= 0 ? 'Removed' : 'Added'} wall socket on ${n < 0 ? 'left' : 'right'} face of (${c.x}, ${c.y})`;
  }
  return null;
}

canvas.addEventListener('pointerdown', (ev) => {
  if (S.tab !== 'edit') return;
  canvas.setPointerCapture(ev.pointerId);
  pushUndo();
  const c = cellAt(ev);
  const d = applyTool(c, true);
  S.stroke = { changes: d ? [d] : [], last: `${c.x},${c.y}` };
  S.dirty = true;
});
canvas.addEventListener('pointermove', (ev) => {
  const c = cellAt(ev);
  S.hover = S.level.inBounds(c.x, c.y) ? c : null;
  S.dirty = true;
  if (!S.stroke) return;
  const key = `${c.x},${c.y}`;
  if (key === S.stroke.last) return;
  S.stroke.last = key;
  const d = applyTool(c, false);
  if (d) S.stroke.changes.push(d);
});
canvas.addEventListener('pointerleave', () => { S.hover = null; S.dirty = true; });
canvas.addEventListener('pointerup', () => {
  if (!S.stroke) return;
  const { changes } = S.stroke;
  S.stroke = null;
  if (!changes.length) { S.undo.pop(); return; }
  reanalyze(changes.length === 1 ? changes[0] : `${changes[0]} (+${changes.length - 1} more tiles)`);
});

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

function renderAnalysis() {
  const a = S.analysis;
  const s = S.summary;
  const m = a.mario;
  const lines = [
    `Zelda connected regions: ${s.zeldaRegions}`,
    `Mario platforms:         ${s.platforms}`,
    `Jump connections:        ${s.jumpConnections} validated / ${s.jumpCandidates} jump-table candidates`,
    `Portal launch outcomes:  ${s.portalLaunches}`,
    `Trajectories:            ${m.stats.simulated} simulated, ${m.stats.cached} reused from cache`,
    `Analysis time:           ${a.ms.toFixed(0)} ms`,
  ];
  $('analysisStats').textContent = lines.join('\n');
  const list = $('edgeList');
  list.innerHTML = '';
  m.edges.filter((e) => e.from !== e.to).forEach((e) => {
    const div = document.createElement('div');
    div.className = 'item' + (e.id === S.selectedEdge ? ' sel' : '');
    const p = JUMP_POLICIES[e.plan.policy];
    div.textContent = `P${e.from} → P${e.to}  ${p.kind}${p.kind !== 'walk' ? ` hold ${e.holdRange[0]}–${e.holdRange[1]}f` : ''}  takeoff x ${e.takeoffRange[0].toFixed(2)}–${e.takeoffRange[1].toFixed(2)}  variants ${e.variants}${e.touched.length ? `  touches s${e.touched.join(',s')}` : ''}`;
    div.onclick = () => {
      S.selectedEdge = S.selectedEdge === e.id ? -1 : e.id;
      renderAnalysis();
      S.dirty = true;
    };
    list.appendChild(div);
  });
}

const METRIC_LABELS = [
  ['minActions', 'Minimum actions'],
  ['parallelSteps', 'Parallel steps (both acting)'],
  ['portalRelocations', 'Portal relocations'],
  ['physicsSwitches', 'Physics switches'],
  ['floorToWall', 'Floor → wall traversals'],
  ['wallToFloor', 'Wall → floor traversals'],
  ['wallToWall', 'Wall → wall traversals'],
  ['jumps', 'Mario trajectories used'],
  ['coopDeps', 'Cooperative dependencies'],
  ['relays', 'Portal relays'],
  ['alternationDepth', 'Alternation depth'],
  ['solutionDiversity', 'Distinct shortest solutions'],
  ['decisionComplexity', 'Avg. alternatives per step'],
  ['executionTolerance', 'Execution tolerance (min)'],
  ['executionDifficulty', 'Execution difficulty'],
  ['replayFrames', 'Replay time (frames)'],
  ['navigationFrames', 'Navigation frames'],
];

function renderSolve() {
  const r = S.result;
  const sol = $('solution');
  sol.innerHTML = '';
  const tbl = $('metrics');
  tbl.innerHTML = '';
  if (r.status !== 'solved') {
    $('solveSummary').textContent = r.status === 'invalid' ? r.errors.join('\n') : `Status: ${r.status}`;
  } else {
    $('solveSummary').textContent = `Solved: ${r.minActions} actions, ${r.explored} states expanded, ${r.stateCount} states seen.`;
    r.actions.forEach((a, i) => {
      const li = document.createElement('li');
      li.textContent = describeAction(S.level, S.analysis, a);
      li.className = S.step === i + 1 ? 'sel' : '';
      li.onclick = () => {
        S.step = S.step === i + 1 ? -1 : i + 1;
        S.anim = null;
        renderSolve();
        S.dirty = true;
      };
      sol.appendChild(li);
    });
    for (const [k, label] of METRIC_LABELS) {
      if (S.metrics[k] === null || S.metrics[k] === undefined) continue;
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${label}</td><td>${S.metrics[k]}</td>`;
      tbl.appendChild(tr);
    }
  }
  const box = $('intended');
  box.innerHTML = '';
  if (S.candidate) {
    const c = S.candidate;
    const h = document.createElement('h2');
    h.textContent = 'Intended (grammar)';
    const pre = document.createElement('pre');
    const motifs = c.motifs.map((m) => `${m.present ? '✓' : '✗'} ${m.motif}`).join('\n');
    pre.textContent = `${c.intended.tree}\nMotifs required by the grammar (checked against the actual solution):\n${motifs}\n\nEstimated intended length: ${c.intended.estActions} actions${c.shortcut ? '\nWarning: actual shortest solution is shorter than intended (shortcut)' : ''}`;
    box.append(h, pre);
  }
}

$('replayBtn').onclick = () => {
  if (S.result.status !== 'solved') return;
  const rp = replaySolution(S.level, S.analysis, S.result, { record: true });
  S.metrics = computeMetrics(S.level, S.analysis, S.result, rp);
  renderSolve();
  S.anim = { frames: rp.frames, i: 0, rp };
  S.step = -1;
  setStatus(rp.ok ? `Replay verified: the solution works with gameplay physics (${rp.totalFrames} frames)` : `Replay failed: ${rp.error}`, rp.ok ? 'good' : 'bad');
};

$('repairBtn').onclick = () => {
  if (S.result.status !== 'solved') return;
  setStatus('Searching for a geometry change that removes the current shortest route…');
  setTimeout(() => {
    const fix = repairShortcut({ level: S.level, analysis: S.analysis, result: S.result }, { ...DEFAULT_TARGETS, minActions: [S.result.minActions + 1, 99] }, [], new MarioAnalyzer());
    if (!fix) { setStatus('No single-tile block lengthens the solution while keeping it solvable', 'bad'); return; }
    pushUndo();
    S.level = fix.level;
    reanalyze(fix.desc.replace('shortcut repair: block', 'Shortcut repair: added solid at'));
  }, 10);
};

// ---------------------------------------------------------------------------
// Play mode
// ---------------------------------------------------------------------------

function startGame() {
  S.game = new Game(S.level);
  S.acc = 0;
}

$('restart').onclick = startGame;
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && S.tab === 'edit') { e.preventDefault(); undo(); }
  if (e.code === 'KeyR' && S.tab === 'play') startGame();
});

function updatePlayInfo() {
  const g = S.game;
  const name = (c) => (c.body.mode === MARIO ? 'Mario' : 'Zelda');
  const sk = (sid) => (sid < 0 ? '—' : `s${sid} (${S.level.sockets[sid].type})`);
  $('playInfo').textContent = [
    `A: ${name(g.chars[0])} mode, portal ${sk(g.portals[0])}`,
    `B: ${name(g.chars[1])} mode, portal ${sk(g.portals[1])}`,
    `Portal pair: ${g.active() ? 'active' : 'inactive'}`,
    g.won ? '\nBoth characters reached the exit!' : '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

let worker = null;
let jobId = 0;

$('generateBtn').onclick = () => {
  const num = (id) => Number($(id).value);
  const params = {
    seed: num('gSeed'),
    count: num('gCount'),
    iterations: num('gIter'),
    targets: {
      minActions: [num('gMinLo'), num('gMinHi')],
      physicsSwitches: num('gSwitch'),
      portalRelocations: num('gReloc'),
      coopDeps: num('gCoop'),
      alternationDepth: num('gAlt'),
      maxDifficulty: $('gDiff').value,
    },
  };
  if (worker) worker.terminate();
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  const id = ++jobId;
  S.candidates = [];
  renderCandidates();
  const t0 = performance.now();
  $('genStatus').textContent = `Generating ${params.count} candidates…`;
  $('generateBtn').disabled = true;
  worker.onmessage = (e) => {
    if (e.data.id !== id) return;
    if (e.data.type === 'result') {
      S.candidates.push(e.data.result);
      renderCandidates();
      $('genStatus').textContent = `${S.candidates.length}/${params.count} candidates (${((performance.now() - t0) / 1000).toFixed(1)} s)`;
    } else if (e.data.type === 'done') {
      $('genStatus').textContent += ' — done';
      $('generateBtn').disabled = false;
    }
  };
  worker.postMessage({ id, params });
};
$('gAccepted').onchange = renderCandidates;
$('gSort').onchange = renderCandidates;

function renderCandidates() {
  const list = $('candidates');
  list.innerHTML = '';
  let cs = S.candidates.slice();
  if ($('gAccepted').checked) cs = cs.filter((c) => c.accepted);
  const sort = $('gSort').value;
  const key = { actions: (c) => -(c.metrics.minActions || 0), alternation: (c) => -(c.metrics.alternationDepth || 0), score: (c) => c.score, index: (c) => c.batchIndex }[sort];
  cs.sort((a, b) => key(a) - key(b));
  for (const c of cs) {
    const m = c.metrics;
    const div = document.createElement('div');
    div.className = 'item' + (S.candidate === c ? ' sel' : '');
    div.innerHTML = `#${c.batchIndex} seed ${c.seed} <span class="tag ${c.accepted ? 'ok' : 'no'}">${c.accepted ? 'accepted' : `score ${c.score}`}</span><br>` +
      (m.solved ? `${m.minActions} actions · ${m.physicsSwitches} switches · ${m.portalRelocations} relocations · coop ${m.coopDeps} · alternation ${m.alternationDepth} · ${m.executionDifficulty}` : m.status);
    div.onclick = () => {
      const L = Level.fromJSON(c.level);
      L.name = `Generated #${c.batchIndex} (seed ${c.seed})`;
      loadLevel(L, { candidate: c });
      renderCandidates();
    };
    list.appendChild(div);
  }
}

// ---------------------------------------------------------------------------
// Import / export
// ---------------------------------------------------------------------------

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

$('exportJson').onclick = () => {
  const out = { ...S.level.toJSON(), metrics: S.metrics, solution: S.result.actions ? S.result.actions.map((a) => describeAction(S.level, S.analysis, a)) : null };
  if (S.candidate) out.generation = { seed: S.candidate.seed, targets: S.candidate.targets, intended: S.candidate.intended };
  download(`${S.level.name.replace(/[^a-z0-9]+/gi, '_')}.json`, JSON.stringify(out, null, 2));
};
$('importJson').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const obj = JSON.parse(await f.text());
    loadLevel(Level.fromJSON(obj.level || obj));
  } catch (err) {
    setStatus(`Import failed: ${err.message}`, 'bad');
  }
  e.target.value = '';
};
$('copyAscii').onclick = async () => {
  const text = S.level.toAscii().join('\n');
  try { await navigator.clipboard.writeText(text); setStatus('ASCII copied to clipboard'); }
  catch { setStatus('Clipboard unavailable'); }
};

const sel = $('samples');
SAMPLES.forEach((s, i) => {
  const o = document.createElement('option');
  o.value = i;
  o.textContent = s.name;
  sel.appendChild(o);
});
sel.onchange = () => loadSample(Number(sel.value));
function loadSample(i) {
  const s = SAMPLES[i];
  loadLevel(Level.fromAscii(s.rows, s.name));
}
$('newLevel').onclick = () => {
  const rows = [];
  for (let y = 0; y < 12; y++) rows.push(y === 0 || y === 11 ? '#'.repeat(12) : '#' + '.'.repeat(10) + '#');
  rows[1] = '#A........B#';
  rows[10] = '#.........E#';
  rows[3] = ']...o......#';
  loadLevel(Level.fromAscii(rows, 'New level'));
};

// ---------------------------------------------------------------------------
// Tabs, overlays, tools
// ---------------------------------------------------------------------------

document.querySelectorAll('#tabs button').forEach((b) => {
  b.onclick = () => {
    S.tab = b.dataset.tab;
    document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('hidden', t.id !== `tab-${S.tab}`));
    S.anim = null;
    if (S.tab === 'play') startGame();
    S.dirty = true;
  };
});
document.querySelectorAll('#tools button').forEach((b) => {
  b.onclick = () => {
    S.tool = b.dataset.tool;
    document.querySelectorAll('#tools button').forEach((x) => x.classList.toggle('active', x === b));
  };
});
document.querySelectorAll('#overlays input').forEach((cb) => {
  S.overlays[cb.dataset.ov] = cb.checked;
  cb.onchange = () => { S.overlays[cb.dataset.ov] = cb.checked; S.dirty = true; };
});

function resize() {
  const L = S.level;
  const avail = Math.min(window.innerWidth - 40, 720);
  S.ts = Math.max(20, Math.min(56, Math.floor(avail / L.width)));
  const dpr = window.devicePixelRatio || 1;
  canvas.width = L.width * S.ts * dpr;
  canvas.height = L.height * S.ts * dpr;
  canvas.style.width = `${L.width * S.ts}px`;
  canvas.style.height = `${L.height * S.ts}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  S.dirty = true;
}
window.addEventListener('resize', resize);

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  let bodies = null;
  let portals = [-1, -1];
  if (S.tab === 'play' && S.game) {
    S.acc += dt;
    while (S.acc >= 1 / 60) {
      const inp = readInputs();
      inp.place.forEach((p, i) => p && S.game.placePortal(i));
      if (!S.game.won) S.game.step(inp.moves);
      S.acc -= 1 / 60;
    }
    bodies = S.game.chars.map((c) => c.body);
    portals = S.game.portals;
    updatePlayInfo();
    S.dirty = true;
  } else if (S.anim) {
    const a = S.anim;
    const f = a.frames[Math.min(a.i, a.frames.length - 1)];
    bodies = f.bodies;
    portals = f.portals;
    a.i += 1;
    if (a.i >= a.frames.length + 60) S.anim = null;
    S.dirty = true;
  } else if (S.step >= 0 && S.result.states) {
    const st = S.result.states[S.step];
    bodies = [bodyForState(S.level, S.analysis, st[0], st[1]), bodyForState(S.level, S.analysis, st[2], st[3])];
    portals = [st[4], st[5]];
  }
  if (S.dirty) {
    const overlays = S.tab === 'play' ? {} : S.overlays;
    drawLevel(ctx, S.level, S.ts, { analysis: S.analysis, overlays, portals, bodies, selectedEdge: S.selectedEdge, hover: S.tab === 'edit' ? S.hover : null });
    S.dirty = S.tab === 'play' || !!S.anim;
  }
  requestAnimationFrame(frame);
}

initInput();
loadSample(1);
requestAnimationFrame(frame);

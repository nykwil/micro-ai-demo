// Grammar-driven, solver-guided level generation.
//
//   1. Expand the grammar into motifs and an intended dependency tree.
//   2. Stamp a geometry skeleton that gives each motif somewhere to happen.
//   3. Analyze reachability (incrementally) and solve for both characters.
//   4. Score the measured metrics against the targets and the motif signatures.
//   5. Repair: directed shortcut removal plus local mutations, hill-climbing.
//   6. Verify the final shortest solution by replaying it through gameplay.

import { Level, FLOOR, SOLID, PIT, WALL, FLOOR_SOCKET, socketKey } from './level.js';
import { Rng, hashSeed } from './rng.js';
import { MarioAnalyzer } from './mario.js';
import { analyzeLevel } from './analysis.js';
import { solve, describeAction } from './solver.js';
import { computeMetrics, DIFFICULTY_RANK } from './metrics.js';
import { expandGrammar, motifReport, treeToText } from './grammar.js';
import { replaySolution } from './replay.js';
import { PHYS } from './physics.js';

export const DEFAULT_TARGETS = Object.freeze({
  minActions: [8, 14],
  physicsSwitches: 2,
  portalRelocations: 1,
  coopDeps: 1,
  alternationDepth: 2,
  maxDifficulty: 'medium',
});

// ---------------------------------------------------------------------------
// Skeleton geometry
// ---------------------------------------------------------------------------

function blankLevel(W, H) {
  const tiles = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x === 0 || y === 0 || x === W - 1 || y === H - 1) tiles[y * W + x] = SOLID;
  return new Level({ name: 'generated', width: W, height: H, tiles, startA: { x: 1, y: 1 }, startB: { x: 2, y: 1 }, exits: [{ x: 3, y: 1 }], sockets: [] });
}

function randomFloorCell(L, rng, x0, y0, x1, y1, avoid = []) {
  const cells = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (L.get(x, y) === FLOOR && !avoid.some((p) => p.x === x && p.y === y)) cells.push({ x, y });
  }
  return cells.length ? rng.pick(cells) : null;
}

function wallFaces(L, filter = () => true) {
  const out = [];
  for (let y = 0; y < L.height; y++) for (let x = 0; x < L.width; x++) {
    if (L.get(x, y) !== SOLID) continue;
    for (const n of [-1, 1]) {
      const s = { type: WALL, x, y, n };
      if (L.socketValid(s) && L.socketAtFace(x, y, n) < 0 && filter(s)) out.push(s);
    }
  }
  return out;
}

function addSocket(L, s) {
  if (!s || !L.socketValid(s)) return;
  if (L.sockets.some((o) => socketKey(o) === socketKey(s))) return;
  L.sockets.push(s);
  L.rebuildIndex();
}

export function buildSkeleton(motifs, rng, W = 12, H = 12) {
  const L = blankLevel(W, H);
  const has = (m) => motifs.includes(m);
  const band = rng.int(Math.max(3, Math.floor(H * 0.3)), Math.floor(H * 0.5));
  const thick = rng.int(1, 2);
  for (let y = band; y < band + thick; y++) for (let x = 1; x < W - 1; x++) L.set(x, y, PIT);
  const lowerTop = band + thick;
  const bottom = H - 2;
  const pits = has('PlatformAccess') || has('DualPurposeObstacle');
  let exit = null;
  let pocketW = 0;
  if (pits) {
    for (let y = lowerTop; y <= bottom; y++) for (let x = 1; x < W - 1; x++) L.set(x, y, PIT);
    pocketW = rng.int(2, 3);
    for (let y = bottom - 1; y <= bottom; y++) for (let x = 1; x <= pocketW; x++) L.set(x, y, FLOOR);
    const pillars = rng.int(2, 4);
    let tallest = null;
    for (let i = 0; i < pillars; i++) {
      const px = rng.int(pocketW + 2, W - 2);
      const h = rng.int(1, Math.min(4, bottom - lowerTop));
      for (let k = 0; k < h; k++) L.set(px, bottom - k, SOLID);
      if (!tallest || h > tallest.h) tallest = { x: px, h };
    }
    exit = { x: tallest.x, y: bottom - tallest.h };
    L.set(exit.x, exit.y, FLOOR);
  } else {
    exit = randomFloorCell(L, rng, Math.floor(W / 2), lowerTop, W - 2, bottom);
  }
  if (has('DualPurposeObstacle')) {
    const x = rng.int(2, W - 3);
    for (let y = Math.max(1, band - 2); y < band; y++) L.set(x, y, SOLID);
  }
  const mid = Math.floor(W / 2);
  if (has('CooperativeHandoff')) for (let y = 1; y < band; y++) L.set(mid, y, SOLID);

  const startA = randomFloorCell(L, rng, 1, 1, mid - 1, band - 1);
  const startB = randomFloorCell(L, rng, mid + 1, 1, W - 2, band - 1, [startA]);
  L.startA = startA;
  L.startB = startB;
  L.exits = [exit];

  const avoid = [startA, startB];
  const upperFace = (s) => s.y < band;
  const lowerFace = (s) => s.y >= lowerTop;
  addSocket(L, { type: FLOOR_SOCKET, ...randomFloorCell(L, rng, 1, 1, W - 2, band - 1, avoid) });
  addSocket(L, rng.pick(wallFaces(L, (s) => upperFace(s) && (s.x === 0 || s.x === W - 1))));
  if (has('CooperativeHandoff')) {
    addSocket(L, rng.pick(wallFaces(L, (s) => upperFace(s) && s.x === mid)));
    addSocket(L, { type: FLOOR_SOCKET, ...randomFloorCell(L, rng, mid + 1, 1, W - 2, band - 1, avoid) });
  }
  if (has('PortalRelay')) {
    const standable = (s) => lowerFace(s) && L.get(s.x + s.n, s.y + 1) === SOLID;
    addSocket(L, rng.pick(wallFaces(L, standable)));
  }
  if (has('ReturnTransition')) {
    const c = pits ? randomFloorCell(L, rng, 1, bottom - 1, pocketW, bottom) : randomFloorCell(L, rng, 1, lowerTop, W - 2, bottom, [exit]);
    if (c) addSocket(L, { type: FLOOR_SOCKET, ...c });
  }
  if (has('PortalTransfer')) addSocket(L, rng.pick(wallFaces(L)));
  return L;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

function sanitize(L) {
  const seen = new Set();
  L.sockets = L.sockets.filter((s) => {
    const k = socketKey(s);
    if (seen.has(k) || !L.socketValid(s)) return false;
    seen.add(k);
    return true;
  });
  L.rebuildIndex();
  return L.validate().length === 0;
}

const MUTATIONS = [
  ['tile', 6],
  ['pillar', 2],
  ['moveSocket', 3],
  ['addSocket', 1],
  ['removeSocket', 1],
  ['moveExit', 1],
  ['moveStart', 1],
];

export function mutate(src, rng) {
  const L = src.clone();
  const W = L.width;
  const H = L.height;
  const op = rng.weighted(MUTATIONS);
  const fixed = [L.startA, L.startB, ...L.exits];
  const isFixed = (x, y) => fixed.some((p) => p.x === x && p.y === y);
  let desc = op;
  if (op === 'tile' || op === 'pillar') {
    const x = rng.int(1, W - 2);
    const y = rng.int(1, H - 2);
    const t = rng.weighted([[SOLID, 4], [PIT, 3], [FLOOR, 3]]);
    const len = op === 'pillar' ? rng.int(2, 3) : 1;
    for (let k = 0; k < len; k++) if (y + k <= H - 2 && !isFixed(x, y + k)) L.set(x, y + k, t);
    desc = `${op} ${['floor', 'solid', 'pit'][t]} at (${x}, ${y})`;
  } else if (op === 'moveSocket' || op === 'removeSocket') {
    if (!L.sockets.length) return null;
    const i = rng.int(0, L.sockets.length - 1);
    const old = L.sockets[i];
    L.sockets.splice(i, 1);
    L.rebuildIndex();
    if (op === 'moveSocket') {
      const s = old.type === WALL ? rng.pick(wallFaces(L)) : (() => { const c = randomFloorCell(L, rng, 1, 1, W - 2, H - 2); return c && { type: FLOOR_SOCKET, ...c }; })();
      if (!s) return null;
      L.sockets.splice(i, 0, s);
      L.rebuildIndex();
    }
    desc = `${op} ${i}`;
  } else if (op === 'addSocket') {
    if (L.sockets.length >= 8) return null;
    if (rng.chance(0.6)) addSocket(L, rng.pick(wallFaces(L)));
    else {
      const c = randomFloorCell(L, rng, 1, 1, W - 2, H - 2);
      if (c) addSocket(L, { type: FLOOR_SOCKET, ...c });
    }
  } else if (op === 'moveExit') {
    const c = randomFloorCell(L, rng, 1, 1, W - 2, H - 2, [L.startA, L.startB]);
    if (!c) return null;
    L.exits = [c];
  } else if (op === 'moveStart') {
    const which = rng.chance(0.5) ? 'startA' : 'startB';
    const c = randomFloorCell(L, rng, 1, 1, W - 2, H - 2, [L.startA, L.startB, ...L.exits]);
    if (!c) return null;
    L[which] = c;
  }
  L.rebuildIndex();
  if (!sanitize(L)) return null;
  return { level: L, desc };
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export function evaluate(level, targets, motifs, analyzer, { maxStates = 150000 } = {}) {
  const analysis = analyzeLevel(level, analyzer);
  const result = solve(analysis, { maxStates });
  const metrics = computeMetrics(level, analysis, result);
  let score = 0;
  let motifs_ = [];
  if (!metrics.solved) {
    score = 1000 - Math.min(99, (result.stateCount || 0) / 40);
  } else {
    const [lo, hi] = targets.minActions;
    if (metrics.minActions < lo) score += (lo - metrics.minActions) * 3;
    if (metrics.minActions > hi) score += (metrics.minActions - hi) * 3;
    score += Math.max(0, targets.physicsSwitches - metrics.physicsSwitches) * 4;
    score += Math.max(0, targets.portalRelocations - metrics.portalRelocations) * 3;
    score += Math.max(0, targets.coopDeps - metrics.coopDeps) * 4;
    score += Math.max(0, targets.alternationDepth - metrics.alternationDepth) * 3;
    if (DIFFICULTY_RANK[metrics.executionDifficulty] > DIFFICULTY_RANK[targets.maxDifficulty]) score += 5;
    motifs_ = motifReport(motifs, { level, analysis, result, metrics });
    score += motifs_.filter((m) => !m.present).length * 4;
  }
  return { level, analysis, result, metrics, motifs: motifs_, score };
}

// Section 11: remove an unintended short solution by blocking the trajectories
// it depends on, keeping the level solvable.
export function repairShortcut(ev, targets, motifs, analyzer) {
  const { level, analysis, result } = ev;
  if (result.status !== 'solved') return null;
  const mario = analysis.mario;
  const fixed = [level.startA, level.startB, ...level.exits, ...level.sockets.map((s) => level.accessCell(s))];
  const cells = new Set();
  const addPath = (path) => {
    for (let i = 1; i < path.length - 1; i++) {
      const [cx, cy] = path[i];
      const x = Math.floor(cx);
      const y = Math.floor(cy);
      if (level.get(x, y) === SOLID || fixed.some((p) => p.x === x && p.y === y)) continue;
      cells.add(level.idx(x, y));
    }
  };
  for (const a of result.actions) {
    if (a.type === 'jump') addPath(mario.edges[a.edge].path);
    if (a.type === 'enter' && a.via && a.via.kind === 'jump') addPath(mario.edges[a.via.edge].path);
    for (const step of a.chain || []) addPath(mario.launches[step.sid][step.launch].path);
  }
  let best = null;
  for (const c of cells) {
    const L = level.clone();
    L.tiles[c] = SOLID;
    if (!sanitize(L)) continue;
    const e = evaluate(L, targets, motifs, analyzer);
    if (!e.metrics.solved || e.metrics.minActions <= result.minActions) continue;
    if (!best || e.score < best.score) best = { ...e, desc: `shortcut repair: block (${c % level.width}, ${Math.floor(c / level.width)})` };
  }
  return best;
}

// Mutation leaves isolated noise tiles. Replace each tile with the majority of
// its neighbours whenever that keeps every target satisfied.
export function smooth(ev, targets, motifs, analyzer, rng) {
  let cur = ev;
  const L0 = ev.level;
  const fixed = new Set([L0.startA, L0.startB, ...L0.exits].map((p) => L0.idx(p.x, p.y)));
  const order = [];
  for (let y = 1; y < L0.height - 1; y++) for (let x = 1; x < L0.width - 1; x++) order.push([x, y]);
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (const [x, y] of order) {
    const L = cur.level;
    if (fixed.has(L.idx(x, y))) continue;
    const counts = [0, 0, 0];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) counts[L.get(x + dx, y + dy)]++;
    const major = counts.indexOf(Math.max(...counts));
    if (counts[major] < 3 || major === L.get(x, y)) continue;
    const C = L.clone();
    C.set(x, y, major);
    if (!sanitize(C) || C.sockets.length !== L.sockets.length) continue;
    const e = evaluate(C, targets, motifs, analyzer);
    if (e.score <= cur.score) cur = { ...e, desc: `smooth (${x}, ${y})` };
  }
  return cur;
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

export function generateLevel({ seed = 1, targets = DEFAULT_TARGETS, width = 12, height = 12, iterations = 300, onProgress = null } = {}) {
  const rng = new Rng(hashSeed('level', seed));
  const grammar = expandGrammar(targets, rng);
  const analyzer = new MarioAnalyzer();
  let cur = evaluate(buildSkeleton(grammar.motifs, rng, width, height), targets, grammar.motifs, analyzer);
  let best = cur;
  const history = [];
  let sinceImprove = 0;
  let restarts = 0;
  for (let it = 0; it < iterations && best.score > 0; it++) {
    let cand = null;
    if (cur.metrics.solved && cur.metrics.minActions < targets.minActions[0] && rng.chance(0.3)) {
      cand = repairShortcut(cur, targets, grammar.motifs, analyzer);
    }
    if (!cand) {
      const m = mutate(cur.level, rng);
      if (!m) continue;
      cand = { ...evaluate(m.level, targets, grammar.motifs, analyzer), desc: m.desc };
    }
    // Simulated annealing: occasionally accept a slightly worse level to escape plateaus.
    const temp = 2 * (1 - it / iterations) + 0.05;
    if (cand.score <= cur.score || (cand.metrics.solved && rng.chance(Math.exp(-(cand.score - cur.score) / temp)))) {
      if (cand.score < cur.score) history.push({ it, desc: cand.desc, score: cand.score });
      cur = cand;
    }
    if (cur.score < best.score) {
      best = cur;
      sinceImprove = 0;
    } else if (++sinceImprove > 120) {
      cur = evaluate(buildSkeleton(grammar.motifs, rng, width, height), targets, grammar.motifs, analyzer);
      sinceImprove = 0;
      restarts++;
    }
    if (onProgress && it % 10 === 0) onProgress({ it, score: best.score });
  }

  if (best.score === 0) best = smooth(best, targets, grammar.motifs, analyzer, rng);

  // Step 8: verify via gameplay replay and record everything.
  const replay = best.metrics.solved ? replaySolution(best.level, best.analysis, best.result, { record: false }) : null;
  const metrics = computeMetrics(best.level, best.analysis, best.result, replay);
  const solved = metrics.solved;
  return {
    seed,
    targets,
    level: best.level.toJSON(),
    score: best.score,
    accepted: solved && best.score === 0 && replay && replay.ok,
    metrics,
    motifs: best.motifs,
    intended: { motifs: grammar.motifs, tree: treeToText(grammar.tree), estActions: grammar.estActions },
    shortcut: solved && metrics.minActions < Math.min(grammar.estActions, targets.minActions[0]),
    solution: solved ? best.result.actions.map((a) => describeAction(best.level, best.analysis, a)) : [],
    replay: replay ? { ok: replay.ok, error: replay.error || null, frames: replay.totalFrames } : null,
    history,
    restarts,
  };
}

export function generateBatch({ seed = 1, count = 4, ...rest } = {}, onResult = null) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const r = generateLevel({ ...rest, seed: hashSeed(seed, i) });
    r.batchIndex = i;
    out.push(r);
    if (onResult) onResult(r);
  }
  return out;
}

export { PHYS };

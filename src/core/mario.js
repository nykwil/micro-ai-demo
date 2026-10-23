// Mario-mode reachability.
//
// States are platforms (maximal runs of standable cells in a row, freely
// walkable). Transitions are trajectories found by simulating the real
// gameplay physics from sampled takeoff positions with a fixed set of control
// policies (walk off, short hop .. full jump, standing or running, with and
// without letting go of the stick mid-air). Each trajectory records every
// wall face it pushes against so the solver can tell when a jump would fly
// into an active portal instead of landing.
//
// Results are cached per (takeoff, policy) together with the bounding box of
// tiles that trajectory consulted, so after an edit only nearby trajectories
// are re-simulated.

import { Level, SOLID, WALL, diffTiles } from './level.js';
import { PHYS, MARIO, bodyAtCell, stepBody, supportCell, newTracker } from './physics.js';
import { exitBody } from './portals.js';

export const HOLDS = [0, 3, 6, 10, 15];
export const TAKEOFF_OFFSETS = [0.05, 0.125, 0.2]; // body left edge within the cell

function buildJumpPolicies() {
  const P = [];
  for (const hold of HOLDS) {
    P.push({ kind: 'jump', dir: 0, jumpFrame: 0, hold, release: -1 });
    for (const dir of [-1, 1]) for (const release of [-1, 10, 20]) P.push({ kind: 'jump', dir, jumpFrame: 0, hold, release });
    for (const dir of [-1, 1]) for (const release of [-1, 18, 28]) P.push({ kind: 'run', dir, jumpFrame: 8, hold, release });
  }
  for (const dir of [-1, 1]) {
    P.push({ kind: 'walk', dir, jumpFrame: -1, hold: 0, release: -1 });
    P.push({ kind: 'walk', dir, jumpFrame: -1, hold: 0, release: -1, releaseOnAir: true });
  }
  return P;
}

function buildLaunchPolicies() {
  const P = [{ kind: 'launch', dir: 0, jumpFrame: -1, hold: 0, release: -1 }];
  for (const dir of [-1, 1]) for (const release of [-1, 8, 16]) P.push({ kind: 'launch', dir, jumpFrame: -1, hold: 0, release });
  return P;
}

export const JUMP_POLICIES = buildJumpPolicies();
export const LAUNCH_POLICIES = buildLaunchPolicies();

const ZERO_INPUT = Object.freeze({ mx: 0, my: 0, jump: false });

// Controller input for frame f of a policy. Once the body has landed after
// being airborne the stick is released so it settles where it landed.
export function policyInput(p, f, st) {
  if (st.released) return ZERO_INPUT;
  let mx = p.dir;
  if (p.release >= 0 && f >= p.release) mx = 0;
  if (p.releaseOnAir && st.airborne) mx = 0;
  const jump = p.jumpFrame >= 0 && f >= p.jumpFrame && f <= p.jumpFrame + p.hold;
  return { mx, my: 0, jump };
}

// Advance policy bookkeeping after a physics step.
export function policyAdvance(b, st) {
  if (!b.grounded) st.airborne = true;
  else if (st.airborne) st.released = true;
  return st.released && b.grounded && b.vx === 0;
}

export function simulate(level, body, policy, { maxFrames = 300, pathEvery = 2 } = {}) {
  const b = { ...body };
  const tr = newTracker();
  const ev = { touch: null };
  const contacts = [];
  const path = [[b.x + PHYS.w / 2, b.y + PHYS.h / 2]];
  const st = { airborne: !b.grounded, released: false };
  let land = -1;
  let frames = 0;
  for (let f = 0; f < maxFrames; f++) {
    stepBody(level, b, policyInput(policy, f, st), ev, tr);
    frames = f + 1;
    if (ev.touch) {
      const k = level.faceKey(ev.touch.x, ev.touch.y, ev.touch.n);
      if (!contacts.includes(k)) contacts.push(k);
    }
    const settled = policyAdvance(b, st);
    if (f % pathEvery === 0) path.push([b.x + PHYS.w / 2, b.y + PHYS.h / 2]);
    if (settled) {
      const c = supportCell(level, b, tr);
      if (c) land = level.idx(c.x, c.y);
      break;
    }
    if (!st.airborne && f >= 60) break; // walked into a wall, never left the ground
  }
  path.push([b.x + PHYS.w / 2, b.y + PHYS.h / 2]);
  return { land, contacts, frames, path, endX: b.x, bbox: tr };
}

export function standableCells(level) {
  const { width: W, height: H } = level;
  const s = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (level.get(x, y) !== SOLID && level.get(x, y + 1) === SOLID) s[y * W + x] = 1;
    }
  }
  return s;
}

export function extractPlatforms(level, standable = standableCells(level)) {
  const { width: W, height: H } = level;
  const platformOf = new Int16Array(W * H).fill(-1);
  const platforms = [];
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      if (!standable[y * W + x]) { x++; continue; }
      const x0 = x;
      while (x < W && standable[y * W + x]) x++;
      const id = platforms.length;
      platforms.push({ id, y, x0, x1: x - 1 });
      for (let i = x0; i < x; i++) platformOf[y * W + i] = id;
    }
  }
  return { platformOf, platforms };
}

// ---------------------------------------------------------------------------
// Grid-relative jump template table, simulated once in empty space.
//
// Takeoff stands at cell (0,0) on a ledge that extends left; everything else is
// open. For each policy the table records the tile offsets (dx, dy) whose floor
// the trajectory descends through, i.e. cells a jump could land in if a surface
// were there. Leftward policies are mirrored from rightward ones.
// ---------------------------------------------------------------------------

let jumpTableCache = null;

export function jumpTable() {
  if (jumpTableCache) return jumpTableCache;
  const W = 41;
  const H = 40;
  const ox = 20;
  const oy = 12;
  const rows = [];
  for (let y = 0; y < H; y++) {
    let r = '';
    for (let x = 0; x < W; x++) r += y === oy + 1 && x <= ox ? '#' : '.';
    rows.push(r);
  }
  const world = Level.fromJSON({ tiles: rows, startA: { x: 0, y: 0 }, startB: { x: 0, y: 0 }, exits: [], sockets: [] });
  const templates = [];
  const offsets = new Map(); // "dx,dy" -> [{ template, frame, vy }]
  JUMP_POLICIES.forEach((policy, pi) => {
    if (policy.dir < 0) return;
    TAKEOFF_OFFSETS.forEach((off, oi) => {
      const b = bodyAtCell(ox, oy, MARIO);
      b.x = ox + off;
      const st = { airborne: false, released: false };
      const frames = [];
      const seen = new Set();
      let prevFeet = b.y + PHYS.h;
      for (let f = 0; f < 120; f++) {
        stepBody(world, b, policyInput(policy, f, st), null, null);
        if (!b.grounded) st.airborne = true;
        frames.push([b.x - ox, b.y - oy, b.vx, b.vy]);
        const feet = b.y + PHYS.h;
        if (st.airborne && b.vy > 0) {
          for (let Y = Math.floor(prevFeet) + 1; Y <= feet; Y++) {
            const x0 = Math.floor(b.x + 1e-9);
            const x1 = Math.floor(b.x + PHYS.w - 1e-9);
            for (let X = x0; X <= x1; X++) {
              const dx = X - ox;
              const dy = Y - 1 - oy;
              const k = `${dx},${dy}`;
              if (seen.has(k)) continue;
              seen.add(k);
              const entry = { policy: pi, offset: oi, frame: f, vy: b.vy };
              for (const sx of policy.dir === 0 ? [1] : [1, -1]) {
                const key = `${dx * sx},${dy}`;
                if (!offsets.has(key)) offsets.set(key, []);
                offsets.get(key).push({ ...entry, mirrored: sx < 0 });
              }
            }
          }
        }
        prevFeet = feet;
        if (b.grounded && st.airborne) break;
        if (b.y - oy > 20) break;
      }
      templates.push({ policy: pi, offset: oi, frames });
    });
  });
  jumpTableCache = { templates, offsets };
  return jumpTableCache;
}

// Candidate connections suggested by the template table: standable cells at a
// reachable offset from a standable takeoff cell. Not yet collision-checked.
export function candidateConnections(level, standable, platformOf) {
  const { offsets } = jumpTable();
  const W = level.width;
  const out = new Set();
  for (let c = 0; c < standable.length; c++) {
    if (!standable[c]) continue;
    const x = c % W;
    const y = (c - x) / W;
    for (const key of offsets.keys()) {
      const [dx, dy] = key.split(',').map(Number);
      const tx = x + dx;
      const ty = y + dy;
      if (!level.inBounds(tx, ty) || !standable[ty * W + tx]) continue;
      const a = platformOf[c];
      const b = platformOf[ty * W + tx];
      if (a !== b) out.add(`${a}>${b}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Level analysis
// ---------------------------------------------------------------------------

export class MarioAnalyzer {
  constructor() {
    this.cache = new Map();
    this.prevLevel = null;
    this.stats = { simulated: 0, cached: 0 };
  }

  invalidate(level) {
    const changed = diffTiles(this.prevLevel, level);
    if (changed === null) {
      this.cache.clear();
      return;
    }
    if (changed.length === 0) return;
    const W = level.width;
    const pts = changed.map((i) => [i % W, Math.floor(i / W)]);
    for (const [k, r] of this.cache) {
      const bb = r.bbox;
      for (const [x, y] of pts) {
        if (x >= bb.x0 && x <= bb.x1 && y >= bb.y0 && y <= bb.y1) {
          this.cache.delete(k);
          break;
        }
      }
    }
  }

  run(key, level, makeBodyFn, policy) {
    let r = this.cache.get(key);
    if (r) {
      this.stats.cached++;
      return r;
    }
    r = simulate(level, makeBodyFn(), policy);
    this.cache.set(key, r);
    this.stats.simulated++;
    return r;
  }

  analyze(level) {
    this.stats = { simulated: 0, cached: 0 };
    this.invalidate(level);
    this.prevLevel = level.clone();

    const W = level.width;
    const standable = standableCells(level);
    const { platformOf, platforms } = extractPlatforms(level, standable);
    const facesToSockets = (faces) => {
      const out = [];
      for (const f of faces) {
        const sid = level.faceSocket.get(f);
        if (sid !== undefined && !out.includes(sid)) out.push(sid);
      }
      return out;
    };

    // Jump / fall connections.
    const groups = new Map();
    for (let c = 0; c < standable.length; c++) {
      if (!standable[c]) continue;
      const cx = c % W;
      const cy = (c - cx) / W;
      const from = platformOf[c];
      JUMP_POLICIES.forEach((policy, pi) => {
        TAKEOFF_OFFSETS.forEach((off, oi) => {
          const r = this.run(`j:${c}:${oi}:${pi}`, level, () => {
            const b = bodyAtCell(cx, cy, MARIO);
            b.x = cx + off;
            return b;
          }, policy);
          if (r.land < 0 || platformOf[r.land] < 0) return;
          const to = platformOf[r.land];
          const touched = facesToSockets(r.contacts);
          if (to === from && touched.length === 0) return;
          const key = `${from}|${to}|${touched.join(',')}`;
          if (!groups.has(key)) groups.set(key, { from, to, touched, samples: [] });
          groups.get(key).samples.push({ cell: c, offset: oi, policy: pi, r, startX: cx + off });
        });
      });
    }

    const edges = [];
    for (const g of groups.values()) {
      const inGroup = new Set(g.samples.map((s) => `${s.cell}:${s.offset}:${s.policy}`));
      let best = null;
      let bestScore = -1;
      for (const s of g.samples) {
        let score = 0;
        for (const d of [-1, 1]) if (inGroup.has(`${s.cell}:${s.offset + d}:${s.policy}`)) score += 2;
        if (s.offset === 1) score += 1;
        if (score > bestScore) { best = s; bestScore = score; }
      }
      const xs = g.samples.map((s) => s.startX);
      const lx = g.samples.map((s) => s.r.endX);
      const holds = g.samples.map((s) => JUMP_POLICIES[s.policy].hold);
      edges.push({
        id: edges.length,
        from: g.from,
        to: g.to,
        touched: g.touched,
        variants: g.samples.length,
        plan: { cell: best.cell, offset: best.offset, policy: best.policy, startX: best.startX },
        path: best.r.path,
        frames: best.r.frames,
        takeoffRange: [Math.min(...xs), Math.max(...xs) + PHYS.w],
        landingRange: [Math.min(...lx), Math.max(...lx) + PHYS.w],
        holdRange: [Math.min(...holds), Math.max(...holds)],
      });
    }
    const edgesFrom = platforms.map(() => []);
    for (const e of edges) edgesFrom[e.from].push(e.id);

    // Walking into a wall socket from the platform its access cell lies on.
    const walkIn = platforms.map(() => []);
    level.sockets.forEach((s, sid) => {
      if (s.type !== WALL) return;
      const a = level.accessCell(s);
      const p = platformOf[level.idx(a.x, a.y)];
      if (p >= 0) walkIn[p].push(sid);
    });

    // Portal launches out of each wall socket.
    const launches = level.sockets.map(() => []);
    level.sockets.forEach((s, sid) => {
      if (s.type !== WALL || !level.socketValid(s)) return;
      const outcomes = new Map();
      LAUNCH_POLICIES.forEach((policy, pi) => {
        const r = this.run(`l:${level.faceKey(s.x, s.y, s.n)}:${pi}`, level, () => exitBody(level, sid, MARIO), policy);
        if (r.land < 0 || platformOf[r.land] < 0) return;
        const to = platformOf[r.land];
        const touched = facesToSockets(r.contacts);
        const key = `${to}|${touched.join(',')}`;
        if (outcomes.has(key)) { outcomes.get(key).variants++; return; }
        outcomes.set(key, { to, touched, policy: pi, path: r.path, frames: r.frames, variants: 1 });
      });
      launches[sid] = [...outcomes.values()];
    });

    const candidates = candidateConnections(level, standable, platformOf);
    const validated = new Set(edges.filter((e) => e.from !== e.to).map((e) => `${e.from}>${e.to}`));

    return { standable, platformOf, platforms, edges, edgesFrom, walkIn, launches, candidates, validated, stats: { ...this.stats } };
  }
}

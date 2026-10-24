// Exact Mario reachability.
//
// Question answered: from standing on platform P, which places can a
// Mario-mode character come to rest on, and which wall faces can it fly into,
// with ANY controller input? Not a sample of jumps: every analog stick value on
// every frame is accounted for.
//
// Why this is possible. The physics is integer-exact (see physics.js):
// positions are whole SUB units and speeds whole SUB units per frame. The
// vertical motion of a move does not depend on the stick, only on when jump is
// pressed and released, so a takeoff has only 17 vertical profiles: walk off a
// ledge, or jump and hold for 0..15 frames. Pressing jump at a different time
// just starts the same profile from a different ground state. Within a profile
// the remaining state is (X, vx). The analysis tracks, frame by frame, the
// exact set of reachable (X, vx) as integer intervals of X for each vx,
// applies the physics' collision rules to whole intervals at once, and records
// every way the set meets the level.
//
// The move model (a move goes from rest to rest):
//   1. Start at rest anywhere on P and walk or run with any input, on P.
//   2. Jump with any hold length, or walk off the edge.
//   3. Steer freely in the air.
//   4. On first landing, let go of the stick and slide to a stop. Sliding off a
//      ledge falls (stick still released) and lands again.
// A move is dropped if, while airborne, the character bumps its head or hits a
// wall. Hitting a wall face airborne at centre height IS recorded as a "face"
// outcome, because a portal on that face would take the character through it.
//
// Every outcome can produce a witness: a start position and an input for every
// frame that reproduces it with the real physics. Tests replay witnesses, and
// search random inputs for anything the analysis missed.

import { PHYS, SUBX, SUBY, MARIO, makeBody, stepBody, marioVelocity, supportCell } from './physics.js';
import { SOLID } from './level.js';

const S = SUBX; // horizontal units per tile
const SY = SUBY; // vertical units per tile
const W = PHYS.w * S;
const H = PHYS.h * SY;
const FALL_DY = PHYS.gravity; // vertical move on the first frame without support

export const MAX_LEVEL = 16; // vertical profiles are recorded this far down

// Tile spans of a body at X (or Y), matching physics.js exactly.
const firstCol = (X) => Math.floor(X / S);
const lastCol = (X) => Math.ceil((X + W) / S) - 1;
const firstRow = (Y) => Math.floor(Y / SY);
const lastRow = (Y) => Math.ceil((Y + H) / SY) - 1;
const centerCol = (X) => Math.floor((X + W / 2) / S);
const centerRow = (Y) => Math.floor((Y + H / 2) / SY);

// X residues (mod S) where a span changes value.
const R_FIRST = 0;
const R_LAST = (S - W + 1) % S;
const R_CENTER = (S - W / 2) % S;

// ---------------------------------------------------------------------------
// Velocity successors: every vx' reachable in one frame, with a stick value
// that produces it, built by asking physics.marioVelocity about every distinct
// stick input. Exact by construction.
// ---------------------------------------------------------------------------

const VMAX = PHYS.launchSpeed;
const STICKS = [0, 1e-9, -1e-9];
for (let t = -PHYS.runSpeed; t <= PHYS.runSpeed; t++) if (t !== 0) STICKS.push(t / PHYS.runSpeed);

function buildSucc(grounded) {
  const out = [];
  for (let vx = -VMAX; vx <= VMAX; vx++) {
    const m = new Map();
    for (const mx of STICKS) {
      const v = marioVelocity(vx, mx, grounded);
      if (!m.has(v)) m.set(v, mx);
    }
    out.push(m);
  }
  return out;
}
const SUCC = [buildSucc(false), buildSucc(true)];
const succ = (vx, grounded) => SUCC[grounded ? 1 : 0][vx + VMAX];

// PRED[g][v2 + VMAX]: runs [lo, hi] of velocity indices v + VMAX with v2 in succ(v).
const NV = 2 * VMAX + 1;
const PRED = [0, 1].map((g) => {
  const out = [];
  for (let i = 0; i < NV; i++) {
    const v2 = i - VMAX;
    const runs = [];
    for (let j = 0; j < NV; j++) {
      if (!SUCC[g][j].has(v2)) continue;
      if (runs.length && runs[runs.length - 1] === j - 1) runs[runs.length - 1] = j;
      else runs.push(j, j);
    }
    out.push(runs);
  }
  return out;
});

// ---------------------------------------------------------------------------
// Vertical profiles, recorded by running the real physics in empty space.
// Entry f: y0 = Y at the start of frame f (relative), dy = that frame's
// vertical move, jump = jump button state that frame.
// ---------------------------------------------------------------------------

const OPEN = { get: () => 0 };

function recordProfile(body, jumpFrames) {
  const b = { ...body };
  const out = [];
  for (let f = 0; f < 400; f++) {
    const y0 = b.y;
    const jump = f < jumpFrames;
    stepBody(OPEN, b, { mx: 0, jump }, null);
    out.push({ y0: Math.round(y0 * SY), dy: Math.round((b.y - y0) * SY), jump });
    if (b.y > MAX_LEVEL + 2) break;
  }
  return out;
}

function standingBody() {
  const b = makeBody(0, 0, MARIO);
  b.grounded = true;
  return b;
}

// PROFILES[0]: walk off a ledge. PROFILES[1 + h]: jump, button held on frames 0..h.
export const PROFILES = [recordProfile(standingBody(), 0)];
for (let h = 0; h <= PHYS.maxHoldFrames; h++) PROFILES.push(recordProfile(standingBody(), h + 1));
export const LAUNCH_PROFILE = (() => {
  const b = makeBody(0, 0, MARIO);
  b.jumpWasDown = true;
  return recordProfile(b, 0);
})();

// ---------------------------------------------------------------------------
// Integer interval lists: flat arrays [lo0, hi0, lo1, hi1, ...], sorted,
// disjoint, inclusive.
// ---------------------------------------------------------------------------

export function unionAll(lists) {
  const pairs = [];
  for (const l of lists) for (let i = 0; i < l.length; i += 2) pairs.push(l[i], l[i + 1]);
  if (pairs.length === 0) return [];
  const idx = [];
  for (let i = 0; i < pairs.length; i += 2) idx.push(i);
  idx.sort((a, b) => pairs[a] - pairs[b]);
  const out = [pairs[idx[0]], pairs[idx[0] + 1]];
  for (let k = 1; k < idx.length; k++) {
    const lo = pairs[idx[k]];
    const hi = pairs[idx[k] + 1];
    if (lo <= out[out.length - 1] + 1) {
      if (hi > out[out.length - 1]) out[out.length - 1] = hi;
    } else out.push(lo, hi);
  }
  return out;
}

// Union of two interval lists in linear time.
function merge2(a, b) {
  if (!a.length) return b;
  if (!b.length) return a;
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    let lo;
    let hi;
    if (j >= b.length || (i < a.length && a[i] <= b[j])) {
      lo = a[i];
      hi = a[i + 1];
      i += 2;
    } else {
      lo = b[j];
      hi = b[j + 1];
      j += 2;
    }
    const n = out.length;
    if (n && out[n - 1] + 1 >= lo) {
      if (hi > out[n - 1]) out[n - 1] = hi;
    } else out.push(lo, hi);
  }
  return out;
}

// Segment tree over velocity indices: union of the lists in any index range.
class UnionTree {
  constructor(lists) {
    let size = 1;
    while (size < lists.length) size *= 2;
    this.size = size;
    this.t = new Array(2 * size).fill(EMPTY);
    for (let i = 0; i < lists.length; i++) this.t[size + i] = lists[i] || EMPTY;
    for (let i = size - 1; i >= 1; i--) this.t[i] = merge2(this.t[2 * i], this.t[2 * i + 1]);
  }

  query(lo, hi) {
    let res = EMPTY;
    let l = lo + this.size;
    let r = hi + this.size + 1;
    while (l < r) {
      if (l & 1) res = merge2(res, this.t[l++]);
      if (r & 1) res = merge2(res, this.t[--r]);
      l >>= 1;
      r >>= 1;
    }
    return res;
  }
}
const EMPTY = [];
const NO_TOUCH = [];

function subtract(a, b) {
  const out = [];
  for (let i = 0; i < a.length; i += 2) {
    let lo = a[i];
    const hi = a[i + 1];
    for (let j = 0; j < b.length && lo <= hi; j += 2) {
      if (b[j + 1] < lo || b[j] > hi) continue;
      if (b[j] > lo) out.push(lo, b[j] - 1);
      lo = b[j + 1] + 1;
    }
    if (lo <= hi) out.push(lo, hi);
  }
  return out;
}

function shift(xs, d) {
  if (d === 0) return xs;
  const out = new Array(xs.length);
  for (let i = 0; i < xs.length; i++) out[i] = xs[i] + d;
  return out;
}

const inSet = (xs, X) => {
  for (let i = 0; i < xs.length; i += 2) if (X >= xs[i] && X <= xs[i + 1]) return true;
  return false;
};

export function measure(l) {
  let n = 0;
  for (let i = 0; i < l.length; i += 2) n += l[i + 1] - l[i] + 1;
  return n;
}

// Split [lo, hi] into runs on which every span named by `residues` is constant.
function segments(lo, hi, residues, fn) {
  let a = lo;
  while (a <= hi) {
    let next = hi + 1;
    const base = a - (((a % S) + S) % S);
    for (const r of residues) {
      let c = base + r;
      if (c <= a) c += S;
      if (c < next) next = c;
    }
    fn(a, Math.min(hi, next - 1));
    a = next;
  }
}

const solidAt = (level, x, y) => level.get(x, y) === SOLID;

// Append [a, b] to a sorted list, merging with the last interval if adjacent.
function push(list, a, b) {
  const n = list.length;
  if (n && list[n - 1] + 1 >= a) {
    if (b > list[n - 1]) list[n - 1] = b;
  } else list.push(a, b);
}

function overlaps(a, b) {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] <= b[j + 1] && b[j] <= a[i + 1]) return true;
    if (a[i + 1] < b[j + 1]) i += 2;
    else j += 2;
  }
  return false;
}

function intersect(a, b) {
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const lo = Math.max(a[i], b[j]);
    const hi = Math.min(a[i + 1], b[j + 1]);
    if (lo <= hi) out.push(lo, hi);
    if (a[i + 1] < b[j + 1]) i += 2;
    else j += 2;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Collision masks. Which tiles a move meets depends only on X once the frame's
// rows are fixed, so for each row band the X ranges that collide are computed
// once and applied to every velocity's interval list.
//   env.x(Y, dir): body at Y moving horizontally in direction dir. For each
//     blocking column, the post-move X range whose leading edge enters it
//     (physics.moveX tests lastCol moving right, firstCol moving left).
//   env.y(ty): X range whose body overlaps a solid tile in row ty.
// ---------------------------------------------------------------------------

const asEnv = (x) => (typeof x.x === 'function' ? x : makeEnv(x));

export function makeEnv(level) {
  const xCache = new Map();
  const yCache = new Map();
  const c0 = -2;
  const c1 = level.width + 1;
  let doorRows = null;
  return {
    level,
    // Columns of the floor sockets (doors in Mario mode) in row r.
    doors(r) {
      if (!doorRows) {
        doorRows = new Map();
        for (const i of level.floorSocket.keys()) {
          const y = Math.floor(i / level.width);
          if (!doorRows.has(y)) doorRows.set(y, []);
          doorRows.get(y).push(i % level.width);
        }
      }
      return doorRows.get(r) || EMPTY;
    },
    x(Y, dir) {
      // The mask depends only on the rows the body spans and its centre row.
      const r0 = firstRow(Y);
      const r1 = lastRow(Y);
      const cy = centerRow(Y);
      const key = (((r0 + 8) * 4 + (r1 - r0)) * 4 + (cy - r0)) * 2 + (dir > 0 ? 1 : 0);
      let m = xCache.get(key);
      if (m) return m;
      const cols = [];
      const lists = [];
      for (let c = c0; c <= c1; c++) {
        let hit = false;
        for (let ty = r0; ty <= r1; ty++) if (solidAt(level, c, ty)) hit = true;
        if (!hit) continue;
        const range = dir > 0 ? [c * S - W + 1, (c + 1) * S - W] : [c * S, c * S + S - 1];
        const face = solidAt(level, c, cy) ? [c, cy, dir > 0 ? -1 : 1] : null;
        const socket = !!face && level.faceSocket.has(level.faceKey(face[0], face[1], face[2]));
        cols.push({ c, range, face, socket, snap: dir > 0 ? c * S - W : (c + 1) * S });
        lists.push(range);
      }
      const rows = [];
      for (let r = r0; r <= r1; r++) rows.push(r);
      if (cy < r0 || cy > r1) rows.push(cy);
      m = { cols, blocked: unionAll(lists), rows };
      xCache.set(key, m);
      return m;
    },
    y(ty) {
      let m = yCache.get(ty);
      if (m) return m;
      const lists = [];
      for (let c = c0; c <= c1; c++) if (solidAt(level, c, ty)) lists.push([c * S - W + 1, c * S + S - 1]);
      m = unionAll(lists);
      yCache.set(ty, m);
      return m;
    },
  };
}

// ---------------------------------------------------------------------------
// One frame of motion for a whole set of positions sharing velocity vx.
// Mirrors physics moveX then moveY. `xs` are X after this frame's horizontal
// move; Y is the vertical position at the start of the frame.
// Returns:
//   free    positions that finished the frame without contact
//   land    positions whose downward move met a floor (they snap to landY)
//   bump    positions whose upward move met a ceiling (they snap to bumpY)
//   hits    [{ list, snap, face, socket }] positions stopped by a wall: the
//           pre-snap positions, the X they snap to, the face at centre height
//           (or null) and whether that face holds a portal socket. Their
//           vertical move still has to be applied at the snapped X.
// ---------------------------------------------------------------------------

function frameMove(env, xs, vx, Y, dy) {
  const res = { free: EMPTY, land: EMPTY, landY: 0, bump: EMPTY, bumpY: 0, hits: EMPTY };
  let moved = xs;
  if (vx !== 0) {
    const m = env.x(Y, vx);
    const hit = overlaps(xs, m.blocked) ? intersect(xs, m.blocked) : EMPTY;
    if (hit.length) {
      moved = subtract(xs, m.blocked);
      res.hits = [];
      for (const col of m.cols) {
        const part = intersect(hit, col.range);
        if (part.length) res.hits.push({ list: part, snap: col.snap, face: col.face, socket: col.socket, col });
      }
    }
  }
  if (dy === 0 || !moved.length) {
    res.free = moved;
    return res;
  }
  const ty = dy > 0 ? lastRow(Y + dy) : firstRow(Y + dy);
  const B = env.y(ty);
  const hit = overlaps(moved, B) ? intersect(moved, B) : EMPTY;
  res.free = hit.length ? subtract(moved, B) : moved;
  if (dy > 0) {
    res.land = hit;
    res.landY = ty * SY - H;
  } else {
    res.bump = hit;
    res.bumpY = (ty + 1) * SY;
  }
  return res;
}

// Rest cell of standing positions, as physics.supportCell computes it.
function restCells(env, xs, Y, fn) {
  const level = env.level;
  const row = Math.round((Y + H) / SY) - 1;
  if (env.touchRow) {
    env.touchRow(row);
    env.touchRow(row + 1);
  }
  let run = null;
  for (let i = 0; i < xs.length; i += 2) {
    segments(xs[i], xs[i + 1], [R_FIRST, R_LAST, R_CENTER], (a, b) => {
      const cx = centerCol(a);
      let best = null;
      for (let x = firstCol(a); x <= lastCol(a); x++) {
        if (!solidAt(level, x, row) && solidAt(level, x, row + 1)) {
          if (best === null || Math.abs(x - cx) < Math.abs(best - cx)) best = x;
        }
      }
      if (best === null) throw new Error('resting body without support');
      // Report maximal runs that rest in the same cell.
      if (run && run.cell === best && run.b + 1 === a) run.b = b;
      else {
        if (run) fn(run.cell, row, run.a, run.b);
        run = { cell: best, a, b };
      }
    });
  }
  if (run) fn(run.cell, row, run.a, run.b);
}

// ---------------------------------------------------------------------------
// Released motion after the first landing: the stick is let go, so all
// positions in a piece share one future except where they meet tiles.
// A piece remembers where it landed: either by a constant offset D (current X
// minus landing X) or, once squeezed to a point by a wall, by `origin`.
// `touched` lists the portal-socket faces met so far.
// ---------------------------------------------------------------------------

function settle(env, piece, out, depth = 0) {
  if (depth > 24) throw new Error('settle recursion too deep');
  let { xs, vx, Y, grounded, pf, Yfall, touched, D, origin } = piece;
  for (let guard = 0; guard < 600 && xs.length; guard++) {
    const originOf = (a, d) => (d === null ? origin : a - d);
    if (grounded && vx === 0) {
      restCells(env, xs, Y, (cx, cy, a, b) => out.rest(cx, cy, touched, a, b, originOf(a, D)));
      return;
    }
    if (grounded) {
      const v2 = marioVelocity(vx, 0, true);
      const r = frameMove(env, shift(xs, v2), v2, Y, FALL_DY);
      const nD = D === null ? null : D + v2;
      for (const h of r.hits) {
        // Stopped by a wall while sliding: one position, at rest unless it falls.
        const t = h.socket ? addTouch(touched, h.face) : touched;
        const o = originOf(h.list[0], nD);
        const r2 = frameMove(env, [h.snap, h.snap], 0, Y, FALL_DY);
        if (r2.land.length) settle(env, { xs: r2.land, vx: 0, Y: r2.landY, grounded: true, pf: 0, Yfall: 0, touched: t, D: null, origin: o }, out, depth + 1);
        if (r2.free.length) settle(env, { xs: r2.free, vx: 0, Y: Y + FALL_DY, grounded: false, pf: 1, Yfall: Y, touched: t, D: null, origin: o }, out, depth + 1);
      }
      if (r.free.length) settle(env, { xs: r.free, vx: v2, Y: Y + FALL_DY, grounded: false, pf: 1, Yfall: Y, touched, D: nD, origin }, out, depth + 1);
      xs = r.land;
      vx = v2;
      Y = r.landY;
      D = nD;
      continue;
    }
    // Airborne with the stick released: velocity unchanged, fall profile.
    const p = PROFILES[0][pf];
    if (!p) return;
    const Yc = Yfall + p.y0;
    const r = frameMove(env, shift(xs, vx), vx, Yc, p.dy);
    const nD = D === null ? null : D + vx;
    for (const h of r.hits) {
      const o = originOf(h.list[0], nD);
      if (h.socket) out.face(h.face, touched, h.list, o);
      const t = h.socket ? addTouch(touched, h.face) : touched;
      const r2 = frameMove(env, [h.snap, h.snap], 0, Yc, p.dy);
      if (r2.land.length) settle(env, { xs: r2.land, vx: 0, Y: r2.landY, grounded: true, pf: 0, Yfall: 0, touched: t, D: null, origin: o }, out, depth + 1);
      if (r2.free.length) settle(env, { xs: r2.free, vx: 0, Y: Yc + p.dy, grounded: false, pf: pf + 1, Yfall, touched: t, D: null, origin: o }, out, depth + 1);
    }
    if (r.land.length) settle(env, { xs: r.land, vx, Y: r.landY, grounded: true, pf: 0, Yfall: 0, touched, D: nD, origin }, out, depth + 1);
    xs = r.free;
    D = nD;
    pf++;
  }
}

function addTouch(touched, face) {
  return touched.some((t) => t[0] === face[0] && t[1] === face[1] && t[2] === face[2]) ? touched : [...touched, face];
}

// ---------------------------------------------------------------------------
// Ground phase: every (X, vx) reachable while standing on platform p,
// starting from rest anywhere on it. Layered so witnesses can be traced back.
// ---------------------------------------------------------------------------

export function restRange(level, p) {
  const r = p.y;
  const lo = solidAt(level, p.x0 - 1, r) ? p.x0 * S : p.x0 * S - W + 1;
  const hi = solidAt(level, p.x1 + 1, r) ? (p.x1 + 1) * S - W : (p.x1 + 1) * S - 1;
  return [lo, hi];
}

// Resting positions on platform p whose centre lies in cell (cx, cy): where a
// standing character can place a portal on a socket with that access cell.
// Returns [lo, hi] in SUBX units, or null.
export function centerRange(level, p, cx, cy) {
  if (cy !== p.y) return null;
  const [lo, hi] = restRange(level, p);
  const a = Math.max(lo, cx * S - W / 2);
  const b = Math.min(hi, cx * S + S - 1 - W / 2);
  return a <= b ? [a, b] : null;
}

function groundSet(env, p) {
  const level = env.level;
  if (env.touchRow) env.touchRow(p.y);
  const Yg = (p.y + 1) * SY - H;
  const all = new Map([[0, restRange(level, p)]]);
  const layers = [new Map(all)];
  let frontier = layers[0];
  for (let iter = 0; iter < 400 && frontier.size; iter++) {
    const buckets = new Map();
    for (const [vx, xs] of frontier) {
      for (const v2 of succ(vx, true).keys()) {
        if (!buckets.has(v2)) buckets.set(v2, []);
        buckets.get(v2).push(shift(xs, v2));
      }
    }
    const next = new Map();
    for (const [v2, lists] of buckets) {
      // Wall stops leave the body at rest against the wall, which is already a
      // rest state. Losing support is the walk-off profile's business.
      const r = frameMove(env, unionAll(lists), v2, Yg, FALL_DY, false);
      const fresh = subtract(r.land, all.get(v2) || []);
      if (fresh.length) {
        next.set(v2, fresh);
        all.set(v2, unionAll([all.get(v2) || [], fresh]));
      }
    }
    if (next.size) layers.push(next);
    frontier = next;
  }
  return { Yg, all, layers };
}

// ---------------------------------------------------------------------------
// Controlled air phase.
//
// A run follows one vertical profile. Its state at the start of each frame is
// a set of partitions, one per list of portal-socket faces touched so far
// (almost always just the empty list); each partition holds an X list per
// velocity. Per frame and velocity:
//   - positions stopped by a wall snap to it with velocity 0 and carry on
//     falling (a socket face there is also reported as a portal entry);
//   - positions that bump a ceiling are handed to a fall run for that ceiling
//     row (every such fall is identical, so one run per row serves them all);
//   - positions that land are settled with the stick released.
// At the start of every airborne frame, a body whose centre is in a door's
// tile can press Up and go through it: that is reported as a door outcome.
// ---------------------------------------------------------------------------

const keyOf = (touched) => touchedKey(touched);

function partFor(map, touched, k = keyOf(touched)) {
  let part = map.get(k);
  if (!part) {
    part = { touched, key: k, sets: new Array(NV) };
    map.set(k, part);
  }
  return part;
}

function addTo(part, i, list) {
  part.sets[i] = part.sets[i] ? merge2(part.sets[i], list) : list;
}

function newRun(A, props) {
  const run = { id: A.runs.length, parent: null, injections: null, startFrame: 0, frames: A.keep ? [] : null, ...props };
  A.runs.push(run);
  return run;
}

// Door outcomes for the state at the start of frame f (airborne).
function doorsAt(env, run, f, cur, out) {
  const Y = run.Ybase + run.prof[f].y0;
  const cy = Math.floor((Y + H / 2) / SY);
  const cols = env.doors(cy);
  if (!cols.length) return;
  for (const cx of cols) {
    const range = [cx * S - W / 2, cx * S + S - 1 - W / 2];
    for (const part of cur.values()) {
      for (let i = 0; i < NV; i++) {
        const xs = part.sets[i];
        if (!xs || !overlaps(xs, range)) continue;
        const hit = intersect(xs, range);
        // Witness: the state after frame f - 1 (or the run's start state).
        out.door([cx, cy], part.touched, hit, hit[0], run, f - 1, i - VMAX);
      }
    }
  }
}

function airPhase(env, A, run, init, out, fork = null) {
  const prof = run.prof;
  let cur = init;
  for (let f = run.startFrame; cur.size && f < prof.length; f++) {
    if (A.keep) run.frames[f] = cur;
    if (!(f === 0 && run.startGrounded)) doorsAt(env, run, f, cur, out);
    const grounded = f === 0 && run.startGrounded;
    const airX = !grounded || run.jumped;
    const Y = run.Ybase + prof[f].y0;
    const dy = prof[f].dy;
    const preds = PRED[grounded ? 1 : 0];
    const next = new Map();
    for (const part of cur.values()) {
      const tree = new UnionTree(part.sets);
      const snaps = new Map(); // touched key -> { touched, list of snapped X }
      for (let i = 0; i < NV; i++) {
        const runs = preds[i];
        let xs = EMPTY;
        for (let k = 0; k < runs.length; k += 2) xs = merge2(xs, tree.query(runs[k], runs[k + 1]));
        if (!xs.length) continue;
        const v2 = i - VMAX;
        const r = frameMove(env, shift(xs, v2), v2, Y, dy);
        // On a ground frame (walking off), wall hits are just standing at the
        // wall and positions still supported have not left the ground.
        if (airX) {
          for (const h of r.hits) {
            if (h.socket) out.face(h.face, part.touched, h.list, h.list[0], run, f, v2, part.touched);
            const t = h.socket ? addTouch(part.touched, h.face) : part.touched;
            const k2 = keyOf(t);
            if (!snaps.has(k2)) snaps.set(k2, { touched: t, list: [] });
            snaps.get(k2).list.push([h.snap, h.snap]);
          }
        }
        if (r.land.length && !grounded) out.landing(r.land, v2, r.landY, run, f, part.touched);
        if (r.bump.length) out.bump(r.bump, v2, r.bumpY, run, f, part.touched);
        if (r.free.length) addTo(partFor(next, part.touched, part.key), i, r.free);
      }
      // Snapped positions finish the frame's vertical move with velocity 0.
      for (const { touched, list } of snaps.values()) {
        const r = frameMove(env, unionAll(list), 0, Y, dy);
        if (r.land.length) out.landing(r.land, 0, r.landY, run, f, touched);
        if (r.bump.length) out.bump(r.bump, 0, r.bumpY, run, f, touched);
        if (r.free.length) addTo(partFor(next, touched), VMAX, r.free);
      }
    }
    if (fork && next.size) fork(f, next);
    cur = next;
  }
}

// ---------------------------------------------------------------------------
// Outcome collection
// ---------------------------------------------------------------------------

function touchedKey(touched) {
  return touched.map((t) => t.join(',')).join(';');
}

// Event witness: in run `run`, frame f, after the horizontal move the body is
// at X with velocity v, in the partition of faces `evTouched`.
function collector(env, A) {
  const outcomes = new Map();
  const add = (kind, where, touched, n, wit) => {
    // Numeric keys for the common untouched case: cells and faces are small integers.
    const cell = (where[1] + 64) * 512 + (where[0] + 64);
    const key = touched.length || kind === 'door' ? `${kind}|${where}|${touchedKey(touched)}` : kind === 'land' ? cell : -1 - (cell * 2 + (where[2] > 0 ? 1 : 0));
    let o = outcomes.get(key);
    if (!o) {
      o = { kind, touched, measure: 0, witness: { source: A.source, ...wit } };
      if (kind === 'land' || kind === 'door') o.cell = where;
      else o.face = where;
      outcomes.set(key, o);
    }
    o.measure += n;
  };
  let ev = null;
  const sink = {
    rest: (cx, cy, touched, a, b, X) => add('land', [cx, cy], touched, b - a + 1, { ...ev, X }),
    face: (face, touched, list, X) => add('face', face, touched, measure(list), { ...ev, X }),
  };
  return {
    outcomes,
    face(face, touched, list, X, run, f, v, evTouched) {
      add('face', face, touched, measure(list), { run: run.id, f, v, X, evTouched });
    },
    door(cell, touched, list, X, run, f, v) {
      add('door', cell, touched, measure(list), { run: run.id, f, v, X, evTouched: touched });
    },
    landing(xs, v, Y, run, f, touched) {
      ev = { run: run.id, f, v, evTouched: touched };
      settle(env, { xs, vx: v, Y, grounded: true, pf: 0, Yfall: 0, touched, D: 0, origin: null }, sink);
    },
    bump(xs, v, Ysnap, run, f, touched) {
      if (!A.bumps.has(Ysnap)) A.bumps.set(Ysnap, []);
      A.bumps.get(Ysnap).push({ run: run.id, f, v, touched, list: xs });
    },
  };
}

// ---------------------------------------------------------------------------
// Analysis of one source: a platform (moves from rest on it) or a wall socket
// (moves out of a portal launch). With keep, every frame's sets are retained
// so witnesses can be traced back.
// ---------------------------------------------------------------------------

function analyzeSource(env, source, { keep = false, profiles = null } = {}) {
  const A = { source, keep, runs: [], bumps: new Map(), ground: null, start: null };
  const out = collector(env, A);
  const initFrom = (entries) => {
    const m = new Map();
    const part = partFor(m, NO_TOUCH);
    for (const [vx, xs] of entries) part.sets[vx + VMAX] = xs;
    return m;
  };
  if (source.plat) {
    const g = groundSet(env, source.plat);
    A.ground = g;
    const init = () => initFrom(g.all);
    const plat = { Ybase: g.Yg, startGrounded: true };
    if (profiles) {
      for (const pi of profiles) airPhase(env, A, newRun(A, { ...plat, prof: PROFILES[pi], jumped: pi > 0 }), init(), out);
    } else {
      airPhase(env, A, newRun(A, { ...plat, prof: PROFILES[0], jumped: false }), init(), out);
      // Jump profiles agree until the button is released, so run the longest
      // hold once and branch every shorter hold off it at its release frame.
      // Events in the shared frames are recorded once, under the longest hold.
      const last = PROFILES.length - 1;
      const main = newRun(A, { ...plat, prof: PROFILES[last], jumped: true });
      const branches = [];
      airPhase(env, A, main, init(), out, (f, next) => {
        if (f + 1 < last) branches.push([f, next]);
      });
      for (const [f, next] of branches) {
        airPhase(env, A, newRun(A, { ...plat, prof: PROFILES[f + 1], jumped: true, startFrame: f + 1, parent: main }), next, out);
      }
    }
  } else {
    const { X0, Y0, vx0 } = launchStart(env.level, source.socket);
    A.start = { X0, vx0 };
    airPhase(env, A, newRun(A, { Ybase: Y0, startGrounded: false, jumped: false, prof: LAUNCH_PROFILE }), initFrom([[vx0, [X0, X0]]]), out);
  }
  // Falls after head bumps: one run per ceiling row, fed by every bump against it.
  const done = new Set();
  for (let guard = 0; guard < 64; guard++) {
    const pending = [...A.bumps.keys()].filter((y) => !done.has(y));
    if (!pending.length) break;
    for (const Ysnap of pending) {
      done.add(Ysnap);
      const injections = A.bumps.get(Ysnap);
      const init = new Map();
      for (const inj of injections) addTo(partFor(init, inj.touched), inj.v + VMAX, inj.list);
      const run = newRun(A, { Ybase: Ysnap, startGrounded: false, jumped: false, prof: LAUNCH_PROFILE, injections });
      airPhase(env, A, run, init, out);
    }
  }
  A.outcomes = out.outcomes;
  return A;
}

// All moves from platform `pid`: Map of outcome key -> outcome.
// `profiles` restricts the analysis to some vertical profiles (used by tests).
export function movesFromPlatform(levelOrEnv, platforms, pid, { profiles = null } = {}) {
  const env = asEnv(levelOrEnv);
  const p = platforms[pid];
  // Sources are identified by geometry, not ids, so cached results stay valid
  // when other platforms or sockets come and go.
  return analyzeSource(env, { plat: { y: p.y, x0: p.x0, x1: p.x1 } }, { profiles }).outcomes;
}

export function launchStart(level, s) {
  if (s.type !== 'wall') {
    // Mario mode out of a floor portal: at rest in the socket's cell (see portals.exitBody).
    return { X0: s.x * S + (S - W) / 2, Y0: (s.y + 1) * SY - H, vx0: 0 };
  }
  const a = level.accessCell(s);
  return {
    X0: s.n > 0 ? (s.x + 1) * S + PHYS.exitGap : s.x * S - W - PHYS.exitGap,
    Y0: (a.y + 1) * SY - H,
    vx0: s.n * PHYS.launchSpeed,
  };
}

// All moves out of wall socket `sid` in Mario mode (a portal launch).
export function movesFromLaunch(levelOrEnv, sid) {
  const env = asEnv(levelOrEnv);
  const s = env.level.sockets[sid];
  return analyzeSource(env, { socket: { type: s.type, x: s.x, y: s.y, n: s.n } }).outcomes;
}

// ---------------------------------------------------------------------------
// Witnesses: re-run the outcome's source keeping every frame's sets, then
// trace the recorded event back to a start, choosing a stick input per frame.
// Returns { startX, inputs: [{ mx, my, jump }], groundFrames }: stand at rest
// at startX (platform sources), play the inputs, then release the stick.
// ---------------------------------------------------------------------------

function framesOf(A, run, k) {
  let r = run;
  while (k < r.startFrame && r.parent) r = r.parent;
  return r.frames[k];
}

// The body is at X with velocity v after frame k's horizontal move, in
// partition `touched`. Find the state at the start of frame k and the stick
// input that leads here.
function stepBack(env, A, run, k, touched, X, v) {
  const frame = framesOf(A, run, k);
  const grounded = k === 0 && run.startGrounded;
  const tryPart = (t, fn) => {
    const part = frame.get(keyOf(t));
    return part ? fn(part) : null;
  };
  // Ordinary move.
  const normal = tryPart(touched, (part) => {
    for (let i = 0; i < NV; i++) {
      const xs = part.sets[i];
      if (!xs) continue;
      const pv = i - VMAX;
      const mx = succ(pv, grounded).get(v);
      if (mx !== undefined && inSet(xs, X - v)) return { pv, X: X - v, mx, touched };
    }
    return null;
  });
  if (normal) return normal;
  // Stopped by a wall this frame: X is that wall's snap position, v is 0.
  const airX = !grounded || run.jumped;
  if (v !== 0 || !airX) return null;
  const Y = run.Ybase + run.prof[k].y0;
  for (const dir of [1, -1]) {
    for (const col of env.x(Y, dir).cols) {
      if (col.snap !== X) continue;
      // Partitions that, after touching this wall, become `touched`.
      const options = [];
      const same = (t) => keyOf(col.socket ? addTouch(t, col.face) : t) === keyOf(touched);
      if (same(touched)) options.push(touched);
      if (col.socket && touched.length) {
        const t = touched.slice(0, -1);
        if (same(t)) options.push(t);
      }
      for (const t of options) {
        const found = tryPart(t, (part) => {
          for (let i = 0; i < NV; i++) {
            const xs = part.sets[i];
            if (!xs) continue;
            const pv = i - VMAX;
            for (const [v2, mx] of succ(pv, grounded)) {
              if (Math.sign(v2) !== dir) continue;
              const hit = intersect(shift(xs, v2), col.range);
              if (hit.length) return { pv, X: hit[0] - v2, mx, touched: t };
            }
          }
          return null;
        });
        if (found) return found;
      }
    }
  }
  return null;
}

export function witnessFor(levelOrEnv, outcome) {
  const env = asEnv(levelOrEnv);
  const w = outcome.witness;
  if (!env.kept) env.kept = new Map();
  const sk = JSON.stringify(w.source);
  let A = env.kept.get(sk);
  if (!A) {
    A = analyzeSource(env, w.source, { keep: true });
    env.kept.set(sk, A);
  }

  // Invariant: after frame k's horizontal move the body is at X with velocity
  // v, in partition `touched`, within run `run` (or its parent for early
  // frames of a branch).
  const inputs = [];
  let run = A.runs[w.run];
  let k = w.f;
  let X = w.X;
  let v = w.v;
  let touched = w.evTouched;
  for (let guard = 0; guard < 5000; guard++) {
    if (k < 0) {
      let root = run;
      while (root.parent) root = root.parent;
      if (!root.injections) break;
      // Start of a fall after a head bump: the bump happened in another run.
      const inj = root.injections.find((j) => j.v === v && keyOf(j.touched) === keyOf(touched) && inSet(j.list, X));
      if (!inj) throw new Error('witness: no bump leads here');
      run = A.runs[inj.run];
      k = inj.f;
      continue;
    }
    const r = stepBack(env, A, run, k, touched, X, v);
    if (!r) throw new Error(`witness: trace-back failed at frame ${k} of run ${run.id}`);
    inputs.push({ mx: r.mx, my: 0, jump: run.prof[k].jump });
    X = r.X;
    v = r.pv;
    touched = r.touched;
    k--;
  }
  if (k !== -1) throw new Error('witness: did not reach the start');
  inputs.reverse();
  // A door outcome ends by pressing Up in the door's tile.
  if (outcome.kind === 'door') inputs.push({ mx: 0, my: -1, jump: false });

  const groundInputs = [];
  if (A.ground) {
    const ground = A.ground;
    let layer = ground.layers.findIndex((L) => L.has(v) && inSet(L.get(v), X));
    if (layer < 0) throw new Error('witness: takeoff state is not a ground state');
    while (layer > 0) {
      let found = null;
      for (let k2 = 0; k2 < layer && !found; k2++) {
        for (const [pv, xs] of ground.layers[k2]) {
          const mx = succ(pv, true).get(v);
          if (mx !== undefined && inSet(xs, X - v)) {
            found = { pv, mx, layer: k2 };
            break;
          }
        }
      }
      if (!found) throw new Error('witness: ground trace-back failed');
      groundInputs.unshift({ mx: found.mx, my: 0, jump: false });
      X -= v;
      v = found.pv;
      layer = found.layer;
    }
    if (v !== 0) throw new Error('witness: did not reach rest');
  } else if (X !== A.start.X0 || v !== A.start.vx0) {
    throw new Error('witness: launch trace-back did not reach the exit state');
  }
  return { startX: X / S, inputs: [...groundInputs, ...inputs], groundFrames: groundInputs.length };
}

// ---------------------------------------------------------------------------
// Reference: one move simulated directly with the real physics, under the same
// move rules as the analysis. `inputAt(f, st)` gives the stick for frame f
// while the move is under control (st.airborne tells whether it has left the
// ground); after the first landing the stick is released. Returns null if the
// move never leaves the ground or runs out of time, else
//   { land: { kind: 'land', cell, touched }, faces: [{ kind: 'face', face, touched }] }
// where touched lists the portal-socket faces met in order, faces lists
// every socket face hit while airborne (with the faces met before it), and
// doors lists every door tile the body's centre is in at the start of an
// airborne frame before the first landing (where Up would take it through).
// Wall pushes before leaving the ground are not reported (walking into a
// portal is a separate walk-in action). Used by tests and audits.
// ---------------------------------------------------------------------------

const RELEASED = Object.freeze({ mx: 0, my: 0, jump: false });

export function simulateMove(level, body, inputAt, { maxFrames = 1200, path = null } = {}) {
  const b = { ...body };
  const st = { airborne: !b.grounded, released: false };
  const ev = {};
  let touched = [];
  const faces = [];
  const doors = [];
  for (let f = 0; f < maxFrames; f++) {
    if (st.airborne && !st.released) {
      const cx = Math.floor(b.x + PHYS.w / 2);
      const cy = Math.floor(b.y + PHYS.h / 2);
      if (level.inBounds(cx, cy) && level.floorSocket.has(level.idx(cx, cy))) doors.push({ kind: 'door', cell: [cx, cy], touched, frame: f });
    }
    stepBody(level, b, st.released ? RELEASED : inputAt(f, st), ev);
    if (path && f % 2 === 0) path.push([b.x + PHYS.w / 2, b.y + PHYS.h / 2]);
    const leftGround = st.airborne || !b.grounded || ev.airHitX;
    if (ev.touch && leftGround) {
      const t = [ev.touch.x, ev.touch.y, ev.touch.n];
      if (level.faceSocket.has(level.faceKey(t[0], t[1], t[2]))) {
        if (ev.airHitX) faces.push({ kind: 'face', face: t, touched });
        if (!touched.some((u) => u[0] === t[0] && u[1] === t[1] && u[2] === t[2])) touched = [...touched, t];
      }
    }
    if (!b.grounded) st.airborne = true;
    if (b.grounded && st.airborne) st.released = true;
    if (st.released && b.grounded && b.vx === 0) {
      const c = supportCell(level, b);
      if (path) path.push([b.x + PHYS.w / 2, b.y + PHYS.h / 2]);
      return { land: { kind: 'land', cell: [c.x, c.y], touched }, faces, doors, frames: f + 1 };
    }
  }
  return null;
}

// Body standing at rest with its left edge at x (tiles) on row `row`'s floor.
export function restingBody(x, row) {
  const b = makeBody(x, row + 1 - PHYS.h, MARIO);
  b.grounded = true;
  return b;
}

// Replays a witness through simulateMove.
export function replayWitness(level, wit, startBody, opts) {
  return simulateMove(level, startBody, (f) => wit.inputs[f] || RELEASED, opts);
}

// Did a reference run produce this outcome (landing, or a face hit on the way)?
export function runProduces(run, o) {
  if (!run) return false;
  const k = outcomeKey(o);
  return outcomeKey(run.land) === k || run.faces.some((f) => outcomeKey(f) === k) || run.doors.some((d) => outcomeKey(d) === k);
}

export function outcomeKey(o) {
  const t = o.touched.map((u) => u.join(',')).join(';');
  return o.kind === 'face' ? `face|${o.face}|${t}` : `${o.kind}|${o.cell}|${t}`;
}

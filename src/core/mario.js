// Mario-mode reachability for a level, built on the exact analysis in reach.js.
//
// States are platforms (maximal runs of standable cells in a row, freely
// walkable). Edges are every distinct way to leave a platform and come to rest
// on another one (or fly into a portal socket), found exactly for any
// controller input. Each edge keeps the wall sockets the move touches, in
// order, so the solver knows when a move would go through an active portal
// instead of landing.
//
// Results are cached per platform together with the rows the analysis looked
// at, so after an edit only platforms that could see the change are redone.

import { SOLID, WALL, diffTiles } from './level.js';
import { MARIO } from './physics.js';
import { exitBody, shotLine } from './portals.js';
import { makeEnv, movesFromPlatform, movesFromLaunch, witnessFor, simulateMove, restingBody, measure, centerRange } from './reach.js';
import { SUBX } from './physics.js';

// Number of landing positions (in tiles) a move needs before it counts as one
// comfortable variant; used for execution tolerance.
const VARIANT_SPAN = SUBX / 8;

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
      if (!standable[y * W + x]) {
        x++;
        continue;
      }
      const x0 = x;
      while (x < W && standable[y * W + x]) x++;
      const id = platforms.length;
      platforms.push({ id, y, x0, x1: x - 1 });
      for (let i = x0; i < x; i++) platformOf[y * W + i] = id;
    }
  }
  return { platformOf, platforms };
}

// A view of a shared collision-mask environment that records which rows an
// analysis looked at: a level change outside them cannot change its result.
function trackedEnv(env) {
  const rows = new Set();
  const token = {};
  return {
    level: env.level,
    rows,
    // Analyses run one at a time, so a mask remembers the last tracker that
    // recorded its rows.
    x(Y, dir) {
      const m = env.x(Y, dir);
      if (m.tracker !== token) {
        m.tracker = token;
        for (const r of m.rows) rows.add(r);
      }
      return m;
    },
    y(ty) {
      rows.add(ty);
      return env.y(ty);
    },
    touchRow(r) {
      rows.add(r);
    },
  };
}

export class MarioAnalyzer {
  constructor() {
    this.cache = new Map();
    this.prevLevel = null;
  }

  invalidate(level) {
    const changed = diffTiles(this.prevLevel, level);
    // Which wall faces hold sockets shapes the analysis (touched faces), so a
    // change to that set starts afresh. Floor sockets do not matter here.
    const sockets = [...level.faceSocket.keys()].sort((a, b) => a - b).join(',');
    const socketsChanged = sockets !== this.prevSockets;
    this.prevSockets = sockets;
    if (changed === null || socketsChanged) {
      this.cache.clear();
      return;
    }
    if (!changed.length) return;
    const rows = new Set(changed.map((i) => Math.floor(i / level.width)));
    for (const [k, r] of this.cache) {
      for (const row of rows) {
        if (r.rows.has(row)) {
          this.cache.delete(k);
          break;
        }
      }
    }
  }

  cached(key, fn, shared) {
    const r = this.cache.get(key);
    if (r) {
      this.stats.cached++;
      return r.outcomes;
    }
    const env = trackedEnv(shared);
    const outcomes = fn(env);
    this.cache.set(key, { outcomes, rows: env.rows });
    this.stats.computed++;
    return outcomes;
  }

  analyze(level) {
    const t0 = now();
    this.stats = { computed: 0, cached: 0 };
    this.invalidate(level);
    this.prevLevel = level.clone();

    const standable = standableCells(level);
    const { platformOf, platforms } = extractPlatforms(level, standable);
    const socketOfFace = (f) => {
      const sid = level.faceSocket.get(level.faceKey(f[0], f[1], f[2]));
      return sid === undefined ? -1 : sid;
    };
    // Map an outcome to (destination platform or -1 for a portal face, sockets touched in order).
    const resolve = (o) => {
      const touched = [];
      for (const f of o.touched) {
        const sid = socketOfFace(f);
        if (sid >= 0 && !touched.includes(sid)) touched.push(sid);
      }
      if (o.kind === 'face') {
        const sid = socketOfFace(o.face);
        if (sid < 0) return null;
        if (!touched.includes(sid)) touched.push(sid);
        return { to: -1, touched };
      }
      return { to: platformOf[level.idx(o.cell[0], o.cell[1])], touched };
    };

    const shared = makeEnv(level);
    const edges = [];
    platforms.forEach((p, pid) => {
      const outcomes = this.cached(`p${p.y},${p.x0},${p.x1}`, (env) => movesFromPlatform(env, platforms, pid), shared);
      const merged = new Map();
      for (const o of outcomes.values()) {
        const r = resolve(o);
        if (!r || (r.to === pid && !r.touched.length)) continue;
        const key = `${r.to}|${r.touched.join(',')}`;
        const e = merged.get(key);
        if (!e) merged.set(key, { from: pid, to: r.to, touched: r.touched, measure: o.measure, outcome: o });
        else {
          e.measure += o.measure;
          if (o.measure > e.outcome.measure) e.outcome = o;
        }
      }
      for (const e of merged.values()) {
        e.id = edges.length;
        e.variants = Math.round(e.measure / VARIANT_SPAN);
        e.kind = 'jump';
        edges.push(e);
      }
    });
    const edgesFrom = platforms.map(() => []);
    for (const e of edges) edgesFrom[e.from].push(e.id);

    // Walking into a wall socket from the platform its access cell lies on.
    const walkIn = platforms.map(() => []);
    // Shooting a portal needs the character standing (grounded) with its
    // centre in a cell on the socket's line of fire. That can be an overhang
    // past the platform's end. shootAt[pid][sid] is a rest X (SUBX units) to
    // shoot from.
    const placeFrom = platforms.map(() => []);
    const shootAt = platforms.map(() => new Map());
    level.sockets.forEach((s, sid) => {
      if (s.type !== WALL) return;
      const a = level.accessCell(s);
      const p = platformOf[level.idx(a.x, a.y)];
      if (p >= 0) walkIn[p].push(sid);
      const line = shotLine(level, s);
      platforms.forEach((pl, pid) => {
        for (const c of line) {
          const r = centerRange(level, pl, c.x, c.y);
          if (!r) continue;
          placeFrom[pid].push(sid);
          shootAt[pid].set(sid, Math.floor((r[0] + r[1]) / 2));
          break;
        }
      });
    });

    // Portal launches out of each wall socket.
    const launches = level.sockets.map((s, sid) => {
      if (s.type !== WALL || !level.socketValid(s)) return [];
      const outcomes = this.cached(`s${s.x},${s.y},${s.n}`, (env) => movesFromLaunch(env, sid), shared);
      const merged = new Map();
      for (const o of outcomes.values()) {
        const r = resolve(o);
        if (!r) continue;
        const key = `${r.to}|${r.touched.join(',')}`;
        const e = merged.get(key);
        if (!e) merged.set(key, { sid, to: r.to, touched: r.touched, measure: o.measure, outcome: o, kind: 'launch' });
        else {
          e.measure += o.measure;
          if (o.measure > e.outcome.measure) e.outcome = o;
        }
      }
      return [...merged.values()].map((e) => ({ ...e, variants: Math.round(e.measure / VARIANT_SPAN) }));
    });

    const witnesses = new Map();
    // Concrete inputs that perform an edge or launch, plus the path they trace.
    const witness = (e) => {
      let w = witnesses.get(e);
      if (w) return w;
      w = witnessFor(shared, e.outcome);
      const path = [];
      const body = e.kind === 'launch' ? exitBody(level, e.sid, MARIO) : restingBody(w.startX, platforms[e.from].y);
      const res = simulateMove(level, body, (f) => w.inputs[f] || { mx: 0, jump: false }, { path });
      w = { ...w, path, result: res };
      witnesses.set(e, w);
      return w;
    };

    return {
      standable,
      platformOf,
      platforms,
      edges,
      edgesFrom,
      walkIn,
      placeFrom,
      shootAt,
      launches,
      witness,
      stats: { ...this.stats, ms: now() - t0 },
    };
  }
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export { measure };

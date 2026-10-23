// Discrete two-character puzzle solver (breadth-first: every action costs 1).
//
// State: [modeA, locA, modeB, locB, portalA, portalB]
//   loc is a cell index in Zelda mode and a platform id in Mario mode.
//   portal is a socket id or -1 (not yet placed).
//
// Actions (any character may act at each step):
//   place  PlacePortal(s)  walk to the socket's access cell and place own portal
//   enter  EnterPortal(s)  walk/jump into an active portal, come out of its partner
//   jump   JumpTo(p)       any Mario move (exact reachability) that comes to rest on platform p
//
// Zelda walking inside a region is folded into the action it leads to, so it is
// never a separate step. Coming out of a wall portal in Mario mode launches the
// character; every distinct landing (chosen by air control) is a successor.

import { WALL } from './level.js';
import { ZELDA, MARIO } from './physics.js';
import { pairActive, partner, blockedCell, transitionMode } from './portals.js';
import { reachableLabels } from './zelda.js';

const MAX_CHAIN = 4;

// Unique numeric key for a state. Radixes come from the level so no field can
// overflow into the next (locations are cells or platforms, both fewer than
// the cell count; portals are -1 or a socket id).
function packer(level) {
  const L = level.tiles.length;
  const P = level.sockets.length + 1;
  return (s) => ((((s[0] * L + s[1]) * 2 + s[2]) * L + s[3]) * P + (s[4] + 1)) * P + (s[5] + 1);
}

export class PuzzleModel {
  constructor(analysis) {
    this.analysis = analysis;
    this.level = analysis.level;
    const L = this.level;
    this.exitPlatforms = new Set();
    for (const c of L.exitCells) {
      const p = analysis.mario.platformOf[c];
      if (p >= 0) this.exitPlatforms.add(p);
    }
    this.access = L.sockets.map((s) => L.accessCell(s)).map((a) => L.idx(a.x, a.y));
  }

  initialState() {
    const L = this.level;
    return [ZELDA, L.idx(L.startA.x, L.startA.y), ZELDA, L.idx(L.startB.x, L.startB.y), -1, -1];
  }

  regions(p0, p1) {
    return this.analysis.zeldaByBlocked.get(blockedCell(this.level, p0, p1));
  }

  atExit(mode, loc, regions) {
    if (mode === MARIO) return this.exitPlatforms.has(loc);
    const set = reachableLabels(this.level, regions, loc);
    for (const c of this.level.exitCells) if (set.has(regions.label[c])) return true;
    return false;
  }

  isGoal(s) {
    const r = this.regions(s[4], s[5]);
    return this.atExit(s[0], s[1], r) && this.atExit(s[2], s[3], r);
  }

  // Resolve coming out of `exitSid` in `mode`. Returns [{ mode, loc, chain }],
  // where chain lists the launch outcome chosen at each Mario exit.
  exitOutcomes(exitSid, mode, p0, p1, depth = 0) {
    const L = this.level;
    if (mode === ZELDA) {
      const s = L.sockets[exitSid];
      const cell = s.type === WALL ? this.access[exitSid] : L.idx(s.x, s.y);
      return [{ mode: ZELDA, loc: cell, chain: [] }];
    }
    if (depth >= MAX_CHAIN) return [];
    const out = [];
    const launches = this.analysis.mario.launches[exitSid];
    launches.forEach((o, li) => {
      const hit = o.touched.find((sid) => sid === p0 || sid === p1);
      if (hit === undefined) {
        // A launch that only reaches a portal face does nothing without a portal there.
        if (o.to >= 0) out.push({ mode: MARIO, loc: o.to, chain: [{ launch: li, sid: exitSid }] });
        return;
      }
      const next = partner(p0, p1, hit);
      const m = transitionMode(L, hit, next, MARIO);
      if (m === null) return;
      for (const r of this.exitOutcomes(next, m, p0, p1, depth + 1)) {
        out.push({ mode: r.mode, loc: r.loc, chain: [{ launch: li, sid: exitSid, via: hit }, ...r.chain] });
      }
    });
    return out;
  }

  // All successors of state s as [{ state, action }].
  successors(s) {
    const out = [];
    for (const c of [0, 1]) this.charSuccessors(s, c, out);
    return out;
  }

  charSuccessors(s, c, out) {
    const L = this.level;
    const mode = s[c * 2];
    const loc = s[c * 2 + 1];
    const own = s[4 + c];
    const other = s[5 - c];
    const p0 = s[4];
    const p1 = s[5];
    const active = pairActive(L, p0, p1);
    const mario = this.analysis.mario;

    const withChar = (m, l, np0 = p0, np1 = p1) => {
      const n = s.slice();
      n[c * 2] = m;
      n[c * 2 + 1] = l;
      n[4] = np0;
      n[5] = np1;
      return n;
    };
    const place = (sid, newLoc) => {
      const np = c === 0 ? [sid, p1] : [p0, sid];
      out.push({ state: withChar(mode, newLoc, np[0], np[1]), action: { c, type: 'place', socket: sid, relocation: own >= 0 } });
    };
    const enter = (sid, via) => {
      const exit = partner(p0, p1, sid);
      const m = transitionMode(L, sid, exit, mode);
      if (m === null) return;
      for (const r of this.exitOutcomes(exit, m, p0, p1)) {
        out.push({ state: withChar(r.mode, r.loc), action: { c, type: 'enter', socket: sid, exit, via, chain: r.chain, fromMode: mode, exitMode: m, toMode: r.mode } });
      }
    };

    if (mode === ZELDA) {
      const regions = this.regions(p0, p1);
      const set = reachableLabels(L, regions, loc);
      // A character standing on an active floor portal (blocked for walking)
      // can still act on that very cell, e.g. place a portal whose access cell it is.
      const reach = (cell) => cell === loc || set.has(regions.label[cell]);
      L.sockets.forEach((sk, sid) => {
        if (sid === own || sid === other) return;
        const a = this.access[sid];
        if (L.tiles[a] !== 0 /* FLOOR */) return;
        if (reach(a)) place(sid, a);
      });
      if (active) {
        for (const sid of [p0, p1]) {
          const sk = L.sockets[sid];
          if (sk.type === WALL) {
            if (L.tiles[this.access[sid]] === 0 && reach(this.access[sid])) enter(sid, { kind: 'walk' });
          } else {
            const cell = L.idx(sk.x, sk.y);
            const W = L.width;
            const nb = [cell - 1, cell + 1, cell - W, cell + W].filter((n) => n >= 0 && n < L.tiles.length && Math.abs((n % W) - (cell % W)) <= 1);
            const from = nb.find((n) => L.tiles[n] === 0 && reach(n));
            if (from !== undefined) enter(sid, { kind: 'step', from });
          }
        }
      }
      return;
    }

    // Mario mode: loc is a platform.
    for (const sid of mario.placeFrom[loc]) if (sid !== own && sid !== other) place(sid, loc);
    if (active) {
      for (const sid of mario.walkIn[loc]) if (sid === p0 || sid === p1) enter(sid, { kind: 'walk' });
    }
    for (const eid of mario.edgesFrom[loc]) {
      const e = mario.edges[eid];
      const hit = active ? e.touched.find((sid) => sid === p0 || sid === p1) : undefined;
      if (hit !== undefined) enter(hit, { kind: 'jump', edge: eid });
      else if (e.to >= 0 && e.to !== loc) out.push({ state: withChar(MARIO, e.to), action: { c, type: 'jump', edge: eid, to: e.to } });
    }
  }
}

// Every state reachable from the start, with the actions between them (no
// goal test). Used by tests and audits; the graph can be large.
export function exploreAll(analysis, { maxStates = 200000 } = {}) {
  const model = new PuzzleModel(analysis);
  const pack = packer(analysis.level);
  const start = model.initialState();
  const states = new Map([[pack(start), start]]);
  const queue = [start];
  for (let i = 0; i < queue.length && states.size <= maxStates; i++) {
    for (const { state } of model.successors(queue[i])) {
      const k = pack(state);
      if (states.has(k)) continue;
      states.set(k, state);
      queue.push(state);
    }
  }
  return { model, states: [...states.values()], complete: states.size <= maxStates };
}

export function solve(analysis, { maxStates = 400000 } = {}) {
  const model = new PuzzleModel(analysis);
  const pack = packer(analysis.level);
  const start = model.initialState();
  const startKey = pack(start);
  const info = new Map([[startKey, { parent: -1, action: null, depth: 0, count: 1 }]]);
  const states = new Map([[startKey, start]]);
  if (model.isGoal(start)) {
    return { status: 'solved', minActions: 0, actions: [], states: [start], explored: 1, shortestCount: 1, model };
  }
  let queue = [startKey];
  let goalDepth = -1;
  const goals = [];
  let explored = 0;
  let timedOut = false;

  outer: for (let depth = 0; queue.length; depth++) {
    const next = [];
    for (const key of queue) {
      explored++;
      const s = states.get(key);
      const inf = info.get(key);
      const seen = new Set();
      for (const { state, action } of model.successors(s)) {
        const k = pack(state);
        if (seen.has(k)) continue;
        seen.add(k);
        const ex = info.get(k);
        if (ex) {
          if (ex.depth === depth + 1) ex.count = Math.min(1e9, ex.count + inf.count);
          continue;
        }
        info.set(k, { parent: key, action, depth: depth + 1, count: inf.count });
        states.set(k, state);
        if (model.isGoal(state)) {
          goalDepth = depth + 1;
          goals.push(k);
        } else {
          next.push(k);
        }
        if (states.size > maxStates) { timedOut = true; break outer; }
      }
    }
    if (goalDepth >= 0) break;
    queue = next;
  }

  if (goalDepth < 0) {
    return { status: timedOut ? 'timeout' : 'unsolvable', explored, stateCount: states.size, model };
  }
  // Reconstruct one shortest solution.
  const actions = [];
  const path = [];
  let k = goals[0];
  while (k !== -1) {
    const inf = info.get(k);
    path.push(states.get(k));
    if (inf.action) actions.push(inf.action);
    k = inf.parent;
  }
  actions.reverse();
  path.reverse();
  const shortestCount = goals.reduce((n, g) => n + info.get(g).count, 0);
  return { status: 'solved', minActions: goalDepth, actions, states: path, explored, stateCount: states.size, shortestCount, model };
}

export function describeAction(level, analysis, a) {
  const who = a.c === 0 ? 'A' : 'B';
  const sk = (sid) => {
    const s = level.sockets[sid];
    return `${s.type === WALL ? 'wall' : 'floor'} socket ${sid} (${s.x},${s.y})`;
  };
  const modeName = (m) => (m === MARIO ? 'Mario' : 'Zelda');
  if (a.type === 'place') return `${who}: ${a.relocation ? 'relocate' : 'place'} portal at ${sk(a.socket)}`;
  if (a.type === 'jump') {
    const p = analysis.mario.platforms[a.to];
    return `${who}: JumpTo platform ${a.to} (row ${p.y}, x ${p.x0}-${p.x1})`;
  }
  let t = `${who}: enter ${sk(a.socket)}${a.via && a.via.kind === 'jump' ? ' mid-jump' : ''} → out of ${sk(a.exit)}`;
  if (a.fromMode !== a.toMode) t += ` [${modeName(a.fromMode)} → ${modeName(a.toMode)}]`;
  return t;
}

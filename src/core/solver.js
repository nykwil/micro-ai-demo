// Discrete two-character puzzle solver (breadth-first: every action costs 1).
//
// State: [modeA, locA, modeB, locB, portalA, portalB, fresh]
//   loc is a cell index in Zelda mode and a platform id in Mario mode.
//   portal is a socket id or -1 (not yet placed).
//   fresh has bit c set while character c is still on its landing spot (see
//   portals.js) and cannot step off it freely. Whenever it can walk off and
//   back without touching anything, the bit is cleared: that state can do
//   everything the fresh one can.
//
// Actions (any character may act at each step):
//   place  PlacePortal(s)  walk somewhere with a straight shot at the socket and shoot
//   enter  EnterPortal(s)  walk/jump into an active portal (or go through a door with
//                          Up, or shoot the door behind you), come out of its partner
//   jump   JumpTo(p)       any Mario move (exact reachability) that comes to rest on platform p
//
// Zelda walking inside a region is folded into the action it leads to, so it is
// never a separate step. Coming out of a wall portal in Mario mode launches the
// character; every distinct landing (chosen by air control) is a successor.

import { WALL, FLOOR, SOLID } from './level.js';
import { ZELDA, MARIO } from './physics.js';
import { pairActive, partner, blockedCell, transitionMode, shotLine, spotCell } from './portals.js';
import { reachableLabels } from './zelda.js';

const MAX_CHAIN = 4;

// Unique numeric key for a state. Radixes come from the level so no field can
// overflow into the next (locations are cells or platforms, both fewer than
// the cell count; portals are -1 or a socket id; fresh is two bits).
function packer(level) {
  const L = level.tiles.length;
  const P = level.sockets.length + 1;
  return (s) => (((((s[0] * L + s[1]) * 2 + s[2]) * L + s[3]) * P + (s[4] + 1)) * P + (s[5] + 1)) * 4 + s[6];
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
    // Floor cells a Zelda character can shoot each socket from, nearest first:
    // the open line in front of a wall socket, or a floor socket's own cell.
    this.shooters = L.sockets.map((s) =>
      s.type === WALL ? shotLine(L, s).map((c) => L.idx(c.x, c.y)).filter((i) => L.tiles[i] === FLOOR) : [L.idx(s.x, s.y)]);
    // Landing spot of each exit, and the Mario platforms a fresh character can
    // never step off: a one-tile pocket closed on both sides and above (any
    // other platform can be walked off, or hopped out of straight up).
    this.spot = L.sockets.map((s, sid) => spotCell(L, sid));
    const solid = (x, y) => L.get(x, y) === SOLID;
    this.pocket = analysis.mario.platforms.map((p) =>
      p.x0 === p.x1 && solid(p.x0 - 1, p.y) && solid(p.x0 + 1, p.y) && solid(p.x0, p.y - 1) ? L.idx(p.x0, p.y) : -1);
  }

  initialState() {
    const L = this.level;
    return [ZELDA, L.idx(L.startA.x, L.startA.y), ZELDA, L.idx(L.startB.x, L.startB.y), -1, -1, 0];
  }

  // Clear fresh bits of characters that can step off their landing spot freely.
  canonical(s) {
    if (!s[6]) return s;
    const L = this.level;
    const W = L.width;
    for (const c of [0, 1]) {
      if (!(s[6] & (1 << c))) continue;
      const loc = s[c * 2 + 1];
      let stuck;
      if (s[c * 2] === MARIO) stuck = this.pocket[loc] >= 0;
      else {
        const blocked = blockedCell(L, s[4], s[5]);
        const x = loc % W;
        const nb = [x > 0 ? loc - 1 : -1, x < W - 1 ? loc + 1 : -1, loc - W, loc + W];
        stuck = !nb.some((n) => n >= 0 && n < L.tiles.length && L.tiles[n] === FLOOR && n !== blocked);
      }
      if (!stuck) s[6] &= ~(1 << c);
    }
    return s;
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

  // Resolve coming out of `exitSid` in `mode`. Returns [{ mode, loc, chain, fresh }],
  // where chain lists the launch outcome chosen at each Mario exit and fresh
  // says the character is still on its landing spot.
  exitOutcomes(exitSid, mode, p0, p1, depth = 0) {
    if (mode === ZELDA) return [{ mode: ZELDA, loc: this.spot[exitSid], chain: [], fresh: 1 }];
    if (depth >= MAX_CHAIN) return [];
    const out = [];
    const spot = this.spot[exitSid];
    const launches = this.analysis.mario.launches[exitSid];
    launches.forEach((o, li) => {
      // Faces bounding the landing spot are disarmed. A launch only meets them
      // while still on the spot: it starts there, never rises, and cannot turn
      // back into the spot's column before dropping out of its row.
      let hit = o.touched.find((sid) => (sid === p0 || sid === p1) && this.spot[sid] !== spot);
      if (hit === undefined && o.door !== undefined) {
        // Pressing Up in a door's tile on the way (optional; the launch's other
        // outcomes cover not pressing it). The door on the landing spot is off.
        if ((o.door === p0 || o.door === p1) && this.spot[o.door] !== spot) hit = o.door;
        else return;
      }
      if (hit === undefined) {
        // A launch that only reaches a portal face does nothing without a portal there.
        if (o.to >= 0) out.push({ mode: MARIO, loc: o.to, chain: [{ launch: li, sid: exitSid }], fresh: this.pocket[o.to] === spot ? 1 : 0 });
        return;
      }
      const next = partner(p0, p1, hit);
      const m = transitionMode(this.level, hit, next, MARIO);
      if (m === null) return;
      for (const r of this.exitOutcomes(next, m, p0, p1, depth + 1)) {
        out.push({ mode: r.mode, loc: r.loc, chain: [{ launch: li, sid: exitSid, via: hit }, ...r.chain], fresh: r.fresh });
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
    const fresh = (s[6] >> c) & 1;
    const active = pairActive(L, p0, p1);
    const mario = this.analysis.mario;

    const withChar = (m, l, f, np0 = p0, np1 = p1) => {
      const n = s.slice();
      n[c * 2] = m;
      n[c * 2 + 1] = l;
      n[4] = np0;
      n[5] = np1;
      n[6] = (n[6] & ~(1 << c)) | (f << c);
      return this.canonical(n);
    };
    const withPortal = (sid) => (c === 0 ? [sid, p1] : [p0, sid]);
    // Shooting a portal onto socket sid from cell `from` (Zelda) or from
    // somewhere on the current platform (Mario).
    const place = (sid, newLoc, from) => {
      const np = withPortal(sid);
      const f = mode === ZELDA && from !== loc ? 0 : fresh;
      out.push({ state: withChar(mode, newLoc, f, np[0], np[1]), action: { c, type: 'place', socket: sid, relocation: own >= 0, from } });
    };
    // Going through portal sid (with portals np0/np1 in place), via `via`.
    const enter = (sid, via, np0 = p0, np1 = p1, extra = null) => {
      const exit = partner(np0, np1, sid);
      const m = transitionMode(L, sid, exit, mode);
      if (m === null) return false;
      for (const r of this.exitOutcomes(exit, m, np0, np1)) {
        out.push({
          state: withChar(r.mode, r.loc, r.fresh, np0, np1),
          action: { c, type: 'enter', socket: sid, exit, via, chain: r.chain, fromMode: mode, exitMode: m, toMode: r.mode, ...extra },
        });
      }
      return true;
    };

    if (mode === ZELDA) {
      const regions = this.regions(p0, p1);
      const set = reachableLabels(L, regions, loc);
      // A character standing on an active floor portal (blocked for walking)
      // can still act on that very cell, e.g. place a portal whose access cell it is.
      const reach = (cell) => cell === loc || set.has(regions.label[cell]);
      L.sockets.forEach((sk, sid) => {
        if (sid === own || sid === other) return;
        // Shoot from the nearest reachable floor cell with a clear line to the socket.
        const from = this.shooters[sid].find((cell) => reach(cell));
        if (from !== undefined) place(sid, from, from);
      });
      if (active) {
        for (const sid of [p0, p1]) {
          const sk = L.sockets[sid];
          if (sk.type === WALL) {
            // A fresh character stands on its landing spot: walls around it are disarmed.
            if (fresh && this.access[sid] === loc) continue;
            if (L.tiles[this.access[sid]] === 0 && reach(this.access[sid])) enter(sid, { kind: 'walk' });
          } else {
            const cell = L.idx(sk.x, sk.y);
            if (fresh && cell === loc) continue;
            const W = L.width;
            const nb = [cell - 1, cell + 1, cell - W, cell + W].filter((n) => n >= 0 && n < L.tiles.length && Math.abs((n % W) - (cell % W)) <= 1);
            const from = nb.find((n) => L.tiles[n] === 0 && reach(n));
            if (from !== undefined) enter(sid, { kind: 'step', from });
          }
        }
      }
      return;
    }

    // Mario mode: loc is a platform. A fresh Mario character is in a closed
    // one-tile pocket where every portal it could reach is disarmed: it can
    // only shoot.
    for (const sid of mario.placeFrom[loc]) if (sid !== own && sid !== other) place(sid, loc, null);
    // Doors: shooting the door behind you takes you straight through it when
    // that makes an active pair; with an active door already there, press Up.
    for (const sid of mario.doorsOn[loc]) {
      if (sid !== own && sid !== other) {
        const np = withPortal(sid);
        const shot = { placed: true, relocation: own >= 0 };
        if (fresh || !pairActive(L, np[0], np[1]) || !enter(sid, { kind: 'shot' }, np[0], np[1], shot)) place(sid, loc, null);
      }
      if (active && !fresh && (sid === p0 || sid === p1)) enter(sid, { kind: 'door' });
    }
    if (fresh) return;
    if (active) {
      for (const sid of mario.walkIn[loc]) if (sid === p0 || sid === p1) enter(sid, { kind: 'walk' });
    }
    for (const eid of mario.edgesFrom[loc]) {
      const e = mario.edges[eid];
      const hit = active ? e.touched.find((sid) => sid === p0 || sid === p1) : undefined;
      if (hit !== undefined) enter(hit, { kind: 'jump', edge: eid });
      else if (e.door !== undefined) {
        // Up in a door's tile mid-jump.
        if (active && (e.door === p0 || e.door === p1)) enter(e.door, { kind: 'jump', edge: eid });
      } else if (e.to >= 0 && e.to !== loc) out.push({ state: withChar(MARIO, e.to, 0), action: { c, type: 'jump', edge: eid, to: e.to } });
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

// Fail conditions: states reachable from the start from which the exit can
// never be reached again (soft-locks), and the moves that lead into them from
// states that could still win.
export function findFailures(analysis, { maxStates = 200000 } = {}) {
  const model = new PuzzleModel(analysis);
  const pack = packer(analysis.level);
  const start = model.initialState();
  const index = new Map([[pack(start), 0]]);
  const states = [start];
  const edges = [[]];
  let complete = true;
  for (let i = 0; i < states.length; i++) {
    for (const { state, action } of model.successors(states[i])) {
      const k = pack(state);
      let j = index.get(k);
      if (j === undefined) {
        if (states.length >= maxStates) {
          complete = false;
          continue;
        }
        j = states.length;
        index.set(k, j);
        states.push(state);
        edges.push([]);
      }
      edges[i].push({ to: j, action });
    }
  }
  // Backwards from every goal state: which states can still win?
  const reverse = states.map(() => []);
  edges.forEach((es, i) => es.forEach((e) => reverse[e.to].push(i)));
  const live = new Uint8Array(states.length);
  const queue = [];
  states.forEach((st, i) => {
    if (model.isGoal(st)) {
      live[i] = 1;
      queue.push(i);
    }
  });
  for (let q = 0; q < queue.length; q++) {
    for (const p of reverse[queue[q]]) {
      if (!live[p]) {
        live[p] = 1;
        queue.push(p);
      }
    }
  }
  const failMoves = [];
  edges.forEach((es, i) => {
    if (!live[i]) return;
    for (const e of es) if (!live[e.to]) failMoves.push({ from: states[i], action: e.action, to: states[e.to] });
  });
  const deadStates = states.filter((_, i) => !live[i]);
  return { complete, solvable: !!live[0], states: states.length, deadStates, failMoves };
}

export function describeState(level, analysis, st) {
  const where = (mode, loc) => {
    if (mode === MARIO) {
      const p = analysis.mario.platforms[loc];
      return `platformer, on row ${p.y} x ${p.x0}-${p.x1}`;
    }
    return `top-down, at (${loc % level.width}, ${Math.floor(loc / level.width)})`;
  };
  return `A ${where(st[0], st[1])}; B ${where(st[2], st[3])}`;
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
  const how = !a.via ? '' : a.via.kind === 'jump' ? ' mid-jump' : a.via.kind === 'door' ? ' (door, Up)' : a.via.kind === 'shot' ? ' (shoot the door behind and go through)' : '';
  let t = `${who}: enter ${sk(a.socket)}${how} → out of ${sk(a.exit)}`;
  if (a.fromMode !== a.toMode) t += ` [${modeName(a.fromMode)} → ${modeName(a.toMode)}]`;
  return t;
}

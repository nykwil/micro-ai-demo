// Replays a solver solution through the real-time game using scripted
// controllers, checking after every action that the game reached the state the
// solver predicted. This is the ground-truth check that discrete reachability
// agrees with gameplay physics.

import { WALL } from './level.js';
import { PHYS, SUBX, SUBY, ZELDA, MARIO, centerCell, marioVelocity, bodyAtCell } from './physics.js';
import { Game } from './game.js';
import { restRange, restingBody } from './reach.js';
import { zeldaPath, reachableLabels } from './zelda.js';
import { blockedCell, SHOOT_FLOOR } from './portals.js';

const IDLE = Object.freeze({ mx: 0, my: 0, jump: false });

class ReplayError extends Error {}

function clamp1(v) {
  return v > 1 ? 1 : v < -1 ? -1 : v;
}

export function replaySolution(level, analysis, result, { record = true } = {}) {
  const game = new Game(level);
  const run = makeRunner(level, analysis, game, record);
  const { frames, marks, doAction, checkState, finish } = run;
  try {
    result.actions.forEach((a, i) => {
      doAction(a);
      checkState(result.states[i + 1], i);
      marks.push(game.frame);
    });
    finish();
    return { ok: true, frames, marks, totalFrames: game.frame, navFrames: run.navFrames() };
  } catch (err) {
    if (!(err instanceof ReplayError)) throw err;
    return { ok: false, error: err.message, frames, marks, totalFrames: game.frame, navFrames: run.navFrames() };
  }
}

// Put the game into a solver state: Zelda characters centred in their cell,
// Mario characters standing at rest in the middle of their platform.
export function gameAtState(level, analysis, state) {
  const game = new Game(level);
  game.portals = [state[4], state[5]];
  for (const c of [0, 1]) {
    const mode = state[c * 2];
    const loc = state[c * 2 + 1];
    if (mode === ZELDA) game.chars[c].body = bodyAtCell(loc % level.width, Math.floor(loc / level.width), ZELDA);
    else {
      const p = analysis.mario.platforms[loc];
      const [lo, hi] = restRange(level, p);
      game.chars[c].body = restingBody(Math.floor((lo + hi) / 2) / SUBX, p.y);
    }
  }
  return game;
}

// Perform one solver action in the real game, starting from `from`, and check
// that the game ends in `to`. Returns { ok, error }.
export function executeAction(level, analysis, from, action, to) {
  const game = gameAtState(level, analysis, from);
  const run = makeRunner(level, analysis, game, false);
  try {
    run.doAction(action);
    run.checkState(to, 0);
    return { ok: true };
  } catch (err) {
    if (!(err instanceof ReplayError)) throw err;
    return { ok: false, error: err.message };
  }
}

function makeRunner(level, analysis, game, record) {
  const mario = analysis.mario;
  const frames = record ? [game.snapshot()] : null;
  const marks = [];
  let navFrames = 0;
  let lastEvent = 0;

  const tick = (c, inp) => {
    const inputs = [IDLE, IDLE];
    inputs[c] = inp;
    game.step(inputs);
    if (frames) frames.push(game.snapshot());
    if (game.frame > 60 * 60 * 10) throw new ReplayError('Replay exceeded time budget');
  };
  const body = (c) => game.chars[c].body;
  const newTeleport = (c) => {
    for (let i = lastEvent; i < game.events.length; i++) {
      const e = game.events[i];
      if (e.type === 'teleport' && e.c === c) {
        lastEvent = game.events.length;
        return e;
      }
    }
    lastEvent = game.events.length;
    return null;
  };
  const noTeleport = (c, what) => {
    const t = newTeleport(c);
    if (t) throw new ReplayError(`Unexpected teleport through socket ${t.socket} while ${what}`);
  };

  const zeldaStepTo = (c, cell) => {
    const W = level.width;
    const tx = (cell % W) + (1 - PHYS.w) / 2;
    const ty = Math.floor(cell / W) + (1 - PHYS.h) / 2;
    for (let i = 0; i < 120; i++) {
      const b = body(c);
      const dx = tx - b.x;
      const dy = ty - b.y;
      if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return;
      const sx = PHYS.zeldaSpeedX / SUBX;
      const sy = PHYS.zeldaSpeedY / SUBY;
      tick(c, Math.abs(dx) >= Math.abs(dy) ? { mx: clamp1(dx / sx), my: 0 } : { mx: 0, my: clamp1(dy / sy) });
      navFrames++;
      const t = newTeleport(c);
      if (t) return t;
    }
    throw new ReplayError(`Zelda walk to cell ${cell} got stuck`);
  };

  const zeldaGoTo = (c, cell) => {
    const b = body(c);
    const cc = centerCell(b);
    const from = level.idx(cc.x, cc.y);
    const path = zeldaPath(level, from, cell, blockedCell(level, game.portals[0], game.portals[1]));
    if (!path) throw new ReplayError(`No walking path from cell ${from} to ${cell}`);
    for (const p of path) {
      if (zeldaStepTo(c, p)) throw new ReplayError('Unexpected teleport while walking');
    }
  };

  const push = (c, mx, my) => {
    for (let i = 0; i < 40; i++) {
      tick(c, { mx, my, jump: false });
      const t = newTeleport(c);
      if (t) return t;
    }
    throw new ReplayError('Walking into the portal did not teleport');
  };

  // Walk a standing Mario character to exactly targetX (tiles) and stop there.
  const marioGoTo = (c, targetX) => {
    const b0 = body(c);
    const p = mario.platforms[marioPlatform(c)];
    if (!p) throw new ReplayError('Not standing on a platform');
    const plan = planWalk(level, p, Math.round(b0.x * SUBX), Math.round(b0.vx * SUBX), Math.round(targetX * SUBX));
    if (!plan) throw new ReplayError(`Cannot walk to x=${targetX} on platform ${p.id}`);
    for (const mx of plan) {
      tick(c, { mx, my: 0, jump: false });
      navFrames++;
      noTeleport(c, 'walking along a platform');
      if (!body(c).grounded) throw new ReplayError('Fell while walking along a platform');
    }
    const b = body(c);
    if (Math.round(b.x * SUBX) !== Math.round(targetX * SUBX) || b.vx !== 0) throw new ReplayError('Walk did not stop on target');
  };

  // Play a witness's inputs, then release the stick until the character
  // stops or goes through a portal. Resolves to { teleport } or { settled }.
  const runWitness = (c, w) => {
    for (let f = 0; f < w.inputs.length; f++) {
      tick(c, w.inputs[f]);
      const t = newTeleport(c);
      if (t) return { teleport: t };
    }
    for (let i = 0; i < 600; i++) {
      const b = body(c);
      if (b.grounded && b.vx === 0) return { settled: true };
      tick(c, IDLE);
      const t = newTeleport(c);
      if (t) return { teleport: t };
    }
    throw new ReplayError('Move never settled');
  };

  const marioPlatform = (c) => game.abstractLoc(c, mario.platformOf).loc;

  const runChain = (c, chain) => {
    for (const step of chain) {
      const o = mario.launches[step.sid][step.launch];
      const r = runWitness(c, mario.witness(o));
      if (step.via !== undefined) {
        if (!r.teleport || r.teleport.socket !== step.via) throw new ReplayError(`Launch from socket ${step.sid} missed portal ${step.via}`);
      } else {
        if (r.teleport) throw new ReplayError(`Launch from socket ${step.sid} hit portal ${r.teleport.socket}`);
        if (marioPlatform(c) !== o.to) throw new ReplayError(`Launch from socket ${step.sid} landed on platform ${marioPlatform(c)}, expected ${o.to}`);
      }
    }
  };

  const doAction = (a) => {
    const c = a.c;
    const s = level.sockets[a.socket ?? 0];
    const access = a.socket !== undefined ? level.accessCell(s) : null;
    const accessX = access ? access.x + (1 - PHYS.w) / 2 : 0;
    if (a.type === 'place') {
      // Walk to a spot with a clear shot and fire at the socket.
      let dir;
      if (body(c).mode === ZELDA) {
        zeldaGoTo(c, a.from);
        dir = s.type === WALL ? { x: -s.n, y: 0 } : SHOOT_FLOOR;
      } else {
        const X = mario.shootAt[marioPlatform(c)].get(a.socket);
        if (X === undefined) throw new ReplayError(`Socket ${a.socket} cannot be shot from this platform`);
        marioGoTo(c, X / SUBX);
        dir = { x: -s.n, y: 0 };
      }
      const r = game.shoot(c, dir);
      if (r.sid !== a.socket) throw new ReplayError(`Shot at socket ${a.socket} failed: ${r.reason || `hit socket ${r.sid}`}`);
      return;
    }
    if (a.type === 'jump') {
      const w = mario.witness(mario.edges[a.edge]);
      marioGoTo(c, w.startX);
      const r = runWitness(c, w);
      if (r.teleport) throw new ReplayError(`Jump hit portal ${r.teleport.socket}`);
      if (marioPlatform(c) !== a.to) throw new ReplayError(`Jump landed on platform ${marioPlatform(c)}, expected ${a.to}`);
      return;
    }
    // enter
    let t = null;
    if (a.fromMode === ZELDA) {
      if (s.type === WALL) {
        zeldaGoTo(c, level.idx(access.x, access.y));
        t = push(c, -s.n, 0);
      } else {
        zeldaGoTo(c, a.via.from);
        t = zeldaStepTo(c, level.idx(s.x, s.y));
      }
    } else if (a.via.kind === 'walk') {
      marioGoTo(c, accessX);
      t = push(c, -s.n, 0);
    } else {
      const w = mario.witness(mario.edges[a.via.edge]);
      marioGoTo(c, w.startX);
      t = runWitness(c, w).teleport;
    }
    if (!t || t.socket !== a.socket) throw new ReplayError(`Expected to enter portal ${a.socket}`);
    if (a.exitMode === MARIO) runChain(c, a.chain);
  };

  const checkState = (expected, i) => {
    for (const c of [0, 1]) {
      const got = game.abstractLoc(c, mario.platformOf);
      const mode = expected[c * 2];
      const loc = expected[c * 2 + 1];
      if (got.mode !== mode || got.loc !== loc) {
        throw new ReplayError(`After action ${i + 1}, character ${'AB'[c]} is at ${got.mode === MARIO ? 'platform' : 'cell'} ${got.loc}; solver expected ${mode === MARIO ? 'platform' : 'cell'} ${loc}`);
      }
    }
    if (game.portals[0] !== expected[4] || game.portals[1] !== expected[5]) throw new ReplayError(`After action ${i + 1}, portals differ from the solver state`);
  };

  // Walk both characters onto the exit and check the game registers the win.
  const finish = () => {
    for (const c of [0, 1]) {
      const b = body(c);
      if (b.mode === ZELDA) {
        const regions = analysis.zeldaByBlocked.get(blockedCell(level, game.portals[0], game.portals[1]));
        const cc = centerCell(b);
        const set = reachableLabels(level, regions, level.idx(cc.x, cc.y));
        const exit = [...level.exitCells].find((e) => set.has(regions.label[e]));
        zeldaGoTo(c, exit);
      } else {
        const p = marioPlatform(c);
        const exit = [...level.exitCells].find((e) => mario.platformOf[e] === p);
        marioGoTo(c, (exit % level.width) + (1 - PHYS.w) / 2);
      }
    }
    for (let i = 0; i < 5; i++) tick(0, IDLE);
    if (!game.won) throw new ReplayError('Both characters walked to the exit but the game did not register a win');
  };

  return { frames, marks, doAction, checkState, finish, navFrames: () => navFrames };
}

// Shortest exact input plan that walks a standing body from X (moving at vx)
// to rest at T, staying on platform p. Breadth-first over (position, speed)
// using the physics' own velocity rule. Returns stick values, or null.
export function planWalk(level, p, X, vx, T) {
  const [lo, hi] = restRange(level, p);
  if (T < lo || T > hi || X < lo || X > hi) return null;
  const V = PHYS.runSpeed;
  const NVEL = 2 * V + 1;
  const key = (x, v) => (x - lo) * NVEL + (v + V);
  const prev = new Map([[key(X, vx), null]]);
  const sticks = [];
  for (let t = -V; t <= V; t++) sticks.push(t / V);
  let frontier = [[X, vx]];
  for (let depth = 0; depth < 2000 && frontier.length; depth++) {
    const next = [];
    for (const [x, v] of frontier) {
      if (x === T && v === 0) {
        const plan = [];
        let k = key(x, v);
        while (prev.get(k)) {
          const [pk, mx] = prev.get(k);
          plan.push(mx);
          k = pk;
        }
        return plan.reverse();
      }
      for (const mx of sticks) {
        const v2 = marioVelocity(v, mx, true);
        const x2 = x + v2;
        if (x2 < lo || x2 > hi) continue;
        const k2 = key(x2, v2);
        if (prev.has(k2)) continue;
        prev.set(k2, [key(x, v), mx]);
        next.push([x2, v2]);
      }
    }
    frontier = next;
  }
  return null;
}

// Replays a solver solution through the real-time game using scripted
// controllers, checking after every action that the game reached the state the
// solver predicted. This is the ground-truth check that discrete reachability
// agrees with gameplay physics.

import { WALL } from './level.js';
import { PHYS, ZELDA, MARIO, centerCell } from './physics.js';
import { Game } from './game.js';
import { JUMP_POLICIES, LAUNCH_POLICIES, policyInput, policyAdvance } from './mario.js';
import { zeldaPath, reachableLabels } from './zelda.js';
import { blockedCell } from './portals.js';

const IDLE = Object.freeze({ mx: 0, my: 0, jump: false });

class ReplayError extends Error {}

function clamp1(v) {
  return v > 1 ? 1 : v < -1 ? -1 : v;
}

export function replaySolution(level, analysis, result, { record = true } = {}) {
  const game = new Game(level);
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
      const step = PHYS.zeldaSpeed * PHYS.dt;
      tick(c, Math.abs(dx) >= Math.abs(dy) ? { mx: clamp1(dx / step), my: 0 } : { mx: 0, my: clamp1(dy / step) });
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

  const marioGoTo = (c, targetX) => {
    for (let i = 0; i < 600; i++) {
      const b = body(c);
      if (!b.grounded && i > 0) throw new ReplayError('Fell while walking along a platform');
      const dx = targetX - b.x;
      if (Math.abs(dx) < 5e-4) {
        if (b.vx === 0) return;
        tick(c, IDLE);
      } else {
        const v = Math.max(-PHYS.runSpeed, Math.min(PHYS.runSpeed, dx * 8));
        // Brake early enough that ground deceleration does not overshoot.
        const brake = (b.vx * b.vx) / (2 * PHYS.groundAccel);
        const m = Math.sign(dx) === Math.sign(b.vx) && Math.abs(dx) <= brake ? 0 : v / PHYS.runSpeed;
        tick(c, { mx: m, my: 0, jump: false });
      }
      navFrames++;
      noTeleport(c, 'walking along a platform');
    }
    throw new ReplayError('Mario walk did not settle');
  };

  // Run a policy from rest. Resolves to { teleport } or { settled }.
  const runPolicy = (c, policy) => {
    const st = { airborne: !body(c).grounded, released: false };
    for (let f = 0; f < 400; f++) {
      tick(c, policyInput(policy, f, st));
      const t = newTeleport(c);
      if (t) return { teleport: t };
      if (policyAdvance(body(c), st)) return { settled: true };
    }
    throw new ReplayError('Trajectory never settled');
  };

  const marioPlatform = (c) => game.abstractLoc(c, mario.platformOf).loc;

  const runChain = (c, chain) => {
    for (const step of chain) {
      const o = mario.launches[step.sid][step.launch];
      const r = runPolicy(c, LAUNCH_POLICIES[o.policy]);
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
      if (body(c).mode === ZELDA) zeldaGoTo(c, level.idx(access.x, access.y));
      else marioGoTo(c, accessX);
      if (!game.placePortal(c, a.socket)) throw new ReplayError(`Could not place portal at socket ${a.socket}`);
      return;
    }
    if (a.type === 'jump') {
      const e = mario.edges[a.edge];
      marioGoTo(c, e.plan.startX);
      const r = runPolicy(c, JUMP_POLICIES[e.plan.policy]);
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
      const e = mario.edges[a.via.edge];
      marioGoTo(c, e.plan.startX);
      t = runPolicy(c, JUMP_POLICIES[e.plan.policy]).teleport;
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

  try {
    result.actions.forEach((a, i) => {
      doAction(a);
      checkState(result.states[i + 1], i);
      marks.push(game.frame);
    });
    // Walk both characters onto the exit.
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
    return { ok: true, frames, marks, totalFrames: game.frame, navFrames };
  } catch (err) {
    if (!(err instanceof ReplayError)) throw err;
    return { ok: false, error: err.message, frames, marks, totalFrames: game.frame, navFrames };
  }
}

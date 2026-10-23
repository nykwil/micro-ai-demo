// Soundness and completeness checks for the exact Mario reachability and the
// solver. These are scaled-down versions of the audits described in the
// README; raise the counts at the top to search harder.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Level } from '../src/core/level.js';
import { SUBX, SUBY, MARIO, ZELDA, stepBody } from '../src/core/physics.js';
import { Rng } from '../src/core/rng.js';
import { buildSkeleton, mutate } from '../src/core/generator.js';
import { expandGrammar } from '../src/core/grammar.js';
import { analyzeLevel } from '../src/core/analysis.js';
import { standableCells, extractPlatforms } from '../src/core/mario.js';
import {
  makeEnv, movesFromPlatform, movesFromLaunch, witnessFor, simulateMove, restingBody, restRange,
  replayWitness, outcomeKey, runProduces,
} from '../src/core/reach.js';
import { exitBody, blockedCell } from '../src/core/portals.js';
import { solve, exploreAll, PuzzleModel } from '../src/core/solver.js';
import { executeAction, gameAtState, planWalk } from '../src/core/replay.js';
import { reachableLabels } from '../src/core/zelda.js';
import { Game } from '../src/core/game.js';
import { SAMPLES } from '../src/core/samples.js';

const RANDOM_MOVES_PER_LEVEL = 3000;
const TRANSITION_STATES_PER_LEVEL = 60;
const PLAY_FRAMES_PER_LEVEL = 30000;

function randomLevels(n, seed) {
  const out = [];
  for (let s = 0; out.length < n; s++) {
    const rng = new Rng(seed + s);
    const g = expandGrammar({ physicsSwitches: 2, coopDeps: 1, alternationDepth: 3, portalRelocations: 1 }, rng);
    let L = buildSkeleton(g.motifs, rng);
    for (let j = 0; j < 25; j++) {
      const m = mutate(L, rng);
      if (m) L = m.level;
    }
    out.push(L);
  }
  return out;
}

function withSocketsEverywhere(L) {
  const C = L.clone();
  for (let y = 0; y < C.height; y++) for (let x = 0; x < C.width; x++) for (const n of [-1, 1]) {
    const s = { type: 'wall', x, y, n };
    if (C.socketValid(s) && C.socketAtFace(x, y, n) < 0) C.sockets.push(s);
  }
  C.rebuildIndex();
  return C;
}

const LEVELS = [...SAMPLES.map((s) => Level.fromAscii(s.rows, s.name)), ...randomLevels(3, 900)];

function allMoves(L) {
  const env = makeEnv(L);
  const { platforms } = extractPlatforms(L, standableCells(L));
  const fromPlatform = platforms.map((_, p) => movesFromPlatform(env, platforms, p));
  const fromLaunch = L.sockets.map((s, sid) => (s.type === 'wall' ? movesFromLaunch(env, sid) : null));
  return { env, platforms, fromPlatform, fromLaunch };
}

test('physics arithmetic is exact: positions stay on the sub-unit grid', () => {
  const L = Level.fromAscii(SAMPLES[2].rows);
  const g = new Game(L);
  const rng = new Rng(1);
  for (let f = 0; f < 20000; f++) {
    if (f % 500 === 0) g.reset();
    const inp = () => ({ mx: rng.next() * 2 - 1, my: rng.int(-1, 1), jump: rng.chance(0.5) });
    if (rng.chance(0.02)) g.placePortal(rng.int(0, 1));
    g.step([inp(), inp()]);
    for (const c of g.chars) {
      const b = c.body;
      assert.ok(Number.isInteger(b.x * SUBX) && Number.isInteger(b.vx * SUBX), `x on grid: ${b.x}`);
      assert.ok(Number.isInteger(b.y * SUBY) && Number.isInteger(b.vy * SUBY), `y on grid: ${b.y}`);
    }
  }
});

test('physics is translation invariant by whole tiles', () => {
  // The same move in a level and in a copy shifted by (3, 2) tiles ends at the same relative place.
  const base = ['#######', '#.....#', '#.....#', '#..#..#', '#.....#', '#######'];
  const pad = (rows, dx, dy) => {
    const w = rows[0].length + dx;
    const out = [];
    for (let y = 0; y < dy; y++) out.push('#'.repeat(w));
    for (const r of rows) out.push('#'.repeat(dx) + r);
    return out;
  };
  const A = Level.fromAscii(base);
  const B = Level.fromAscii(pad(base, 3, 2));
  const rng = new Rng(2);
  for (let i = 0; i < 300; i++) {
    const x = 1 + rng.int(0, 512) / SUBX;
    const seq = Array.from({ length: 80 }, () => ({ mx: rng.next() * 2 - 1, jump: rng.chance(0.5) }));
    const ra = simulateMove(A, restingBody(x, 4), (f) => seq[f % 80]);
    const rb = simulateMove(B, restingBody(x + 3, 6), (f) => seq[f % 80]);
    assert.equal(!!ra, !!rb);
    if (ra) assert.deepEqual([ra.land.cell[0] + 3, ra.land.cell[1] + 2], rb.land.cell);
  }
});

test('every reachable outcome has a witness that the real physics reproduces', () => {
  for (const L of [...LEVELS, withSocketsEverywhere(LEVELS[3])]) {
    const { env, platforms, fromPlatform, fromLaunch } = allMoves(L);
    fromPlatform.forEach((outs, p) => {
      for (const o of outs.values()) {
        const w = witnessFor(env, o);
        const run = replayWitness(L, w, restingBody(w.startX, platforms[p].y));
        assert.ok(runProduces(run, o), `${L.name} platform ${p}: ${outcomeKey(o)}`);
      }
    });
    fromLaunch.forEach((outs, sid) => {
      if (!outs) return;
      for (const o of outs.values()) {
        const w = witnessFor(env, o);
        assert.ok(runProduces(replayWitness(L, w, exitBody(L, sid, MARIO)), o), `${L.name} launch ${sid}: ${outcomeKey(o)}`);
      }
    });
  }
});

test('random controller input never reaches anything the analysis missed', () => {
  const rng = new Rng(3);
  for (const L of [...LEVELS, withSocketsEverywhere(LEVELS[4])]) {
    const { platforms, fromPlatform, fromLaunch } = allMoves(L);
    const launchIds = fromLaunch.map((o, i) => (o ? i : -1)).filter((i) => i >= 0);
    for (let i = 0; i < RANDOM_MOVES_PER_LEVEL; i++) {
      let body;
      let outs;
      if (launchIds.length && rng.chance(0.15)) {
        const sid = rng.pick(launchIds);
        body = exitBody(L, sid, MARIO);
        outs = fromLaunch[sid];
      } else {
        const p = rng.int(0, platforms.length - 1);
        const [lo, hi] = restRange(L, platforms[p]);
        body = restingBody(rng.int(lo, hi) / SUBX, platforms[p].y);
        outs = fromPlatform[p];
      }
      const k = rng.chance(0.2) ? -1 : rng.int(0, 20);
      const hold = rng.int(0, 16);
      const block = rng.int(1, 10);
      const seq = Array.from({ length: 120 }, () => (rng.chance(0.4) ? rng.next() * 2 - 1 : rng.int(-1, 1)));
      const run = simulateMove(L, body, (f) => ({ mx: seq[Math.floor(f / block) % 120], jump: k >= 0 && f >= k && f <= k + hold }));
      if (!run) continue;
      const have = new Set([...outs.values()].map(outcomeKey));
      for (const o of [run.land, ...run.faces]) assert.ok(have.has(outcomeKey(o)), `${L.name}: random input reached ${outcomeKey(o)}`);
    }
  }
});

test('solver: every transition in the state graph works in the real game', () => {
  const rng = new Rng(4);
  for (const L of LEVELS) {
    const an = analyzeLevel(L);
    const ex = exploreAll(an);
    assert.ok(ex.complete);
    const states = ex.states.length > TRANSITION_STATES_PER_LEVEL ? Array.from({ length: TRANSITION_STATES_PER_LEVEL }, () => rng.pick(ex.states)) : ex.states;
    for (const st of states) {
      for (const { state, action } of ex.model.successors(st)) {
        const r = executeAction(L, an, st, action, state);
        assert.ok(r.ok, `${L.name}: ${JSON.stringify(st)} ${action.type} -> ${JSON.stringify(state)}: ${r.error}`);
      }
    }
  }
});

test('solver: shortest solutions agree with an independent breadth-first search', () => {
  for (const L of [...LEVELS, ...randomLevels(6, 4000)]) {
    const an = analyzeLevel(L);
    const r = solve(an);
    // Naive BFS with string keys over the same successor relation.
    const model = new PuzzleModel(an);
    const start = model.initialState();
    const dist = new Map([[start.join(), 0]]);
    const queue = [start];
    let best = model.isGoal(start) ? 0 : -1;
    for (let i = 0; i < queue.length && best < 0; i++) {
      const s = queue[i];
      for (const { state } of model.successors(s)) {
        const k = state.join();
        if (dist.has(k)) continue;
        dist.set(k, dist.get(s.join()) + 1);
        if (model.isGoal(state)) {
          best = dist.get(k);
          break;
        }
        queue.push(state);
      }
    }
    if (best < 0) assert.equal(r.status, 'unsolvable', L.name);
    else {
      assert.equal(r.status, 'solved', L.name);
      assert.equal(r.minActions, best, `${L.name}: shortest solution length`);
      // The reported solution is a real path in the state graph ending at a goal.
      r.actions.forEach((a, i) => {
        const succ = model.successors(r.states[i]).map((x) => x.state.join());
        assert.ok(succ.includes(r.states[i + 1].join()), `${L.name}: step ${i + 1} is a transition`);
      });
      assert.ok(model.isGoal(r.states[r.states.length - 1]));
    }
  }
});

test('solver: random play in the real game stays inside the solver model', () => {
  const rng = new Rng(6);
  const charKey = (L, an, mode, loc, p0, p1) => {
    if (mode === MARIO) return `M${loc}`;
    const regions = an.zeldaByBlocked.get(blockedCell(L, p0, p1));
    return `Z${[...reachableLabels(L, regions, loc)].sort((a, b) => a - b).join('.')}`;
  };
  for (const L of LEVELS) {
    const an = analyzeLevel(L);
    const ex = exploreAll(an);
    const known = ex.states.map((s) => [charKey(L, an, s[0], s[1], s[4], s[5]), charKey(L, an, s[2], s[3], s[4], s[5]), s[4], s[5]]);
    // A situation is covered if a known state has the same portals and Mario
    // platforms and lets each Zelda character reach at least as much.
    const covers = (a, b) => a === b || (a[0] === 'Z' && b[0] === 'Z' && b.slice(1).split('.').every((x) => a.slice(1).split('.').includes(x)));
    let g = null;
    const inp = [{}, {}];
    const hold = [0, 0];
    for (let f = 0; f < PLAY_FRAMES_PER_LEVEL; f++) {
      if (f % 600 === 0) g = gameAtState(L, an, rng.pick(ex.states));
      for (const c of [0, 1]) {
        if (hold[c]-- <= 0) {
          hold[c] = rng.int(1, 40);
          inp[c] = { mx: rng.chance(0.5) ? rng.next() * 2 - 1 : rng.int(-1, 1), my: rng.chance(0.3) ? rng.int(-1, 1) : 0, jump: rng.chance(0.4) };
        }
        if (rng.chance(0.01)) g.placePortal(c);
      }
      g.step(inp);
      if (f % 3 || !g.chars.every((ch) => ch.body.mode === ZELDA || (ch.body.grounded && ch.body.vx === 0))) continue;
      const locs = [0, 1].map((c) => g.abstractLoc(c, an.mario.platformOf));
      if (locs.some((l) => l.loc < 0)) continue;
      const key = [charKey(L, an, locs[0].mode, locs[0].loc, g.portals[0], g.portals[1]), charKey(L, an, locs[1].mode, locs[1].loc, g.portals[0], g.portals[1]), g.portals[0], g.portals[1]];
      const ok = known.some((k) => k[2] === key[2] && k[3] === key[3] && covers(k[0], key[0]) && covers(k[1], key[1]));
      assert.ok(ok, `${L.name}: game reached ${key.join('|')}, which the solver never considers`);
    }
  }
});

test('a standing Mario character can walk to and stop at any rest position on its platform', () => {
  // The analysis assumes moves can start from rest anywhere on a platform.
  const L = Level.fromAscii(SAMPLES[0].rows);
  const an = analyzeLevel(L);
  const p = an.mario.platforms[0];
  const [lo, hi] = restRange(L, p);
  const rng = new Rng(7);
  for (let i = 0; i < 60; i++) {
    const from = rng.int(lo, hi);
    const to = rng.int(lo, hi);
    const plan = planWalk(L, p, from, 0, to);
    assert.ok(plan, `plan from ${from} to ${to}`);
    const b = restingBody(from / SUBX, p.y);
    for (const mx of plan) {
      stepBody(L, b, { mx }, null);
      assert.ok(b.grounded, 'stays on the platform');
    }
    assert.equal(Math.round(b.x * SUBX), to);
    assert.equal(b.vx, 0);
  }
});

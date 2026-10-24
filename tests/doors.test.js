// Doors (floor sockets seen from the side) and landing spots.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Level } from '../src/core/level.js';
import { ZELDA, MARIO, bodyAtCell, centerCell } from '../src/core/physics.js';
import { Game } from '../src/core/game.js';
import { SHOOT_FLOOR, transitionMode } from '../src/core/portals.js';
import { analyzeLevel } from '../src/core/analysis.js';
import { PuzzleModel, exploreAll } from '../src/core/solver.js';
import { executeAction, gameAtState } from '../src/core/replay.js';

const IDLE = { mx: 0, my: 0, jump: false };
const UP = { mx: 0, my: -1, jump: false };
const JUMP = { mx: 0, my: 0, jump: true };
const steps = (g, c, inp, n) => {
  for (let i = 0; i < n; i++) {
    const inputs = [IDLE, IDLE];
    inputs[c] = inp;
    g.step(inputs);
  }
};
const cellOf = (g, c) => {
  const cc = centerCell(g.chars[c].body);
  return [cc.x, cc.y];
};
const teleports = (g) => g.events.filter((e) => e.type === 'teleport').length;

// s0: wall socket on the left border, facing right, access (1,1).
// s1: floor socket at (3,2), a door in platformer mode (row 3 is solid).
const DOOR_ROOM = [
  '########',
  '].A..B.#',
  '#..o...#',
  '########',
];

test('door: Up in front of an active door goes through it into top-down mode', () => {
  const L = Level.fromAscii(DOOR_ROOM);
  assert.equal(transitionMode(L, 1, 0, MARIO), ZELDA, 'door -> wall switches platformer to top-down');
  const g = new Game(L);
  g.portals = [1, 0];
  g.chars[0].body = bodyAtCell(5, 2, MARIO);
  steps(g, 0, UP, 1);
  assert.equal(teleports(g), 0, 'away from the door, Up does nothing');
  assert.equal(g.chars[0].body.grounded, true, 'Up does not jump');
  g.chars[0].body = bodyAtCell(3, 2, MARIO);
  steps(g, 0, JUMP, 1);
  assert.equal(teleports(g), 0, 'the jump button jumps, even in front of a door');
  assert.equal(g.chars[0].body.grounded, false);
  // Up in mid-air, still in the door's tile, goes through.
  steps(g, 0, UP, 1);
  assert.equal(teleports(g), 1);
  assert.equal(g.chars[0].body.mode, ZELDA);
  assert.deepEqual(cellOf(g, 0), [1, 1], 'standing in front of the partner wall portal');
});

test('door: shooting the door behind you in platformer mode goes straight through it', () => {
  const L = Level.fromAscii(DOOR_ROOM);
  const g = new Game(L);
  g.portals = [-1, 0];
  g.chars[0].body = bodyAtCell(3, 2, MARIO);
  const r = g.shoot(0, SHOOT_FLOOR);
  assert.equal(r.sid, 1);
  assert.equal(g.chars[0].body.mode, ZELDA, 'went through on the shot');
  assert.deepEqual(cellOf(g, 0), [1, 1]);
  // With no partner portal the shot only places the door.
  const g2 = new Game(L);
  g2.chars[0].body = bodyAtCell(3, 2, MARIO);
  assert.equal(g2.shoot(0, SHOOT_FLOOR).sid, 1);
  assert.equal(g2.chars[0].body.mode, MARIO);
  assert.equal(teleports(g2), 0);
});

test('landing spot: the portals on the tile you come out in are off until you leave it', () => {
  const L = Level.fromAscii(DOOR_ROOM);
  const g = new Game(L);
  g.portals = [1, 0];
  // Top-down into the wall portal, out of the door in platformer mode.
  g.chars[0].body = bodyAtCell(1, 1, ZELDA);
  steps(g, 0, { mx: -1, my: 0 }, 5);
  assert.equal(teleports(g), 1);
  assert.equal(g.chars[0].body.mode, MARIO);
  steps(g, 0, IDLE, 10);
  assert.deepEqual(cellOf(g, 0), [3, 2], 'dropped out in front of the door');
  steps(g, 0, UP, 1);
  steps(g, 0, IDLE, 60);
  assert.equal(teleports(g), 1, 'Up on the landing spot does not go back through the door');
  // Walk off the tile and back: the door works again.
  steps(g, 0, { mx: 1, my: 0 }, 20);
  steps(g, 0, { mx: -1, my: 0 }, 60);
  for (let i = 0; i < 60 && cellOf(g, 0)[0] !== 3; i++) steps(g, 0, { mx: 1, my: 0 }, 1);
  assert.deepEqual(cellOf(g, 0), [3, 2]);
  steps(g, 0, IDLE, 1);
  steps(g, 0, UP, 1);
  assert.equal(teleports(g), 2, 'back through the door after leaving and coming back');
  assert.deepEqual(cellOf(g, 0), [1, 1]);
  // Out of the wall portal in top-down mode: pushing straight back in does nothing.
  steps(g, 0, { mx: -1, my: 0 }, 20);
  assert.equal(teleports(g), 2);
  steps(g, 0, { mx: 1, my: 0 }, 20);
  steps(g, 0, { mx: -1, my: 0 }, 40);
  assert.equal(teleports(g), 3, 'into the wall after stepping away and back');
});

test('landing spot: facing portals across a one-tile gap no longer bounce a character forever', () => {
  const L = Level.fromAscii([
    '#####',
    '#].[#',
    '##.##',
    '#...#',
    '#####',
  ]);
  const g = new Game(L);
  g.portals = [0, 1];
  g.chars[0].body = bodyAtCell(2, 3, MARIO);
  g.chars[0].body.mode = MARIO;
  assert.ok(g.teleport(0, 1), 'launched out of the left portal towards the right one');
  steps(g, 0, IDLE, 120);
  assert.equal(teleports(g), 1, 'the facing portal is on the landing spot, so it does nothing');
  assert.ok(g.chars[0].body.grounded);
  assert.deepEqual(cellOf(g, 0), [2, 3], 'fell down the gap');
  // The solver sees the same: the launch lands, it doesn't chain.
  const an = analyzeLevel(L);
  const model = new PuzzleModel(an);
  const outs = model.exitOutcomes(0, MARIO, 0, 1);
  assert.ok(outs.length > 0 && outs.every((o) => o.chain.length === 1 && o.chain[0].via === undefined));
});

test('landing spot: a top-down character arriving in a closed-in tile cannot go straight back', () => {
  // Wall portal s1 at (3,4) faces left onto (2,4), a tile closed in by pits and walls.
  const L = Level.fromAscii([
    '#######',
    '#A...[#',
    '#B....#',
    '#~~~~~#',
    '#~.[~~#',
    '#######',
  ]);
  const an = analyzeLevel(L);
  const model = new PuzzleModel(an);
  const W = L.width;
  // A owns s0 on (5,1), B owns s1. A walks into s0 and comes out at (2,4).
  const start = [ZELDA, L.idx(4, 1), ZELDA, L.idx(1, 2), 0, 1, 0];
  const into = model.successors(start).find((x) => x.action.c === 0 && x.action.type === 'enter');
  assert.ok(into);
  assert.equal(into.state[1], 2 + 4 * W);
  assert.equal(into.state[6] & 1, 1, 'fresh: stuck on the landing spot');
  assert.ok(!model.successors(into.state).some((x) => x.action.c === 0 && x.action.type === 'enter'), 'cannot go back in');
  assert.ok(executeAction(L, an, start, into.action, into.state).ok);
  // In the game: pushing into the wall does nothing.
  const g = gameAtState(L, an, into.state);
  steps(g, 0, { mx: 1, my: 0 }, 30);
  assert.equal(teleports(g), 0);
});

test('solver: doors and door shots are transitions the game reproduces', () => {
  const L = Level.fromAscii([
    '#########',
    '#A..B.E.#',
    ']..o....#',
    '#########',
    '#.......#',
    '#..o.~..#',
    '#########',
  ]);
  const an = analyzeLevel(L);
  const model = new PuzzleModel(an);
  // A stands in the lower room in platformer mode; B's portal is on the wall.
  const pid = an.mario.platformOf[L.idx(3, 5)];
  const from = [MARIO, pid, ZELDA, L.idx(4, 1), -1, 0, 0];
  const succ = model.successors(from);
  const shot = succ.find((x) => x.action.c === 0 && x.action.type === 'enter' && x.action.via.kind === 'shot');
  assert.ok(shot, 'shooting the door behind A takes A through it');
  assert.equal(shot.state[0], ZELDA);
  assert.equal(shot.state[1], L.idx(1, 2));
  assert.equal(shot.state[4], 2);
  assert.ok(executeAction(L, an, from, shot.action, shot.state).ok);
  const door = model.successors([MARIO, pid, ZELDA, L.idx(4, 1), 2, 0, 0]).find((x) => x.action.via && x.action.via.kind === 'door');
  assert.ok(door, 'with the door already placed, Up goes through');
  assert.ok(executeAction(L, an, [MARIO, pid, ZELDA, L.idx(4, 1), 2, 0, 0], door.action, door.state).ok);
  // Every transition of the whole state graph works in the game.
  const ex = exploreAll(an);
  let n = 0;
  for (const st of ex.states) for (const { state, action } of ex.model.successors(st)) {
    const r = executeAction(L, an, st, action, state);
    assert.ok(r.ok, `${JSON.stringify(st)} ${action.type}/${action.via?.kind} -> ${JSON.stringify(state)}: ${r.error}`);
    n++;
  }
  assert.ok(n > 50);
});

test('sample levels have no fail conditions', async () => {
  const { SAMPLES } = await import('../src/core/samples.js');
  const { findFailures } = await import('../src/core/solver.js');
  for (const s of SAMPLES) {
    const f = findFailures(analyzeLevel(Level.fromAscii(s.rows)));
    assert.ok(f.complete && f.solvable, s.name);
    assert.equal(f.failMoves.length, 0, `${s.name}: ${f.failMoves.length} fail moves`);
  }
});

test('door: Up in mid-air goes through a door with no ground under it', () => {
  // The door at (3,3) is open air below in platformer mode: only a jump reaches it.
  const L = Level.fromAscii([
    '#########',
    ']A.....B#',
    '#.......#',
    '#..o....#',
    '#.......#',
    '#########',
  ]);
  const an = analyzeLevel(L);
  const pid = an.mario.platformOf[L.idx(3, 4)];
  assert.ok(!an.mario.doorsOn[pid].includes(1), 'not reachable standing');
  const model = new PuzzleModel(an);
  const from = [MARIO, pid, ZELDA, L.idx(7, 1), 1, 0, 0];
  const via = model.successors(from).filter((x) => x.action.c === 0 && x.action.type === 'enter' && x.action.socket === 1);
  assert.ok(via.length, 'jump and press Up in the door tile');
  for (const x of via) {
    assert.equal(x.state[0], ZELDA);
    assert.equal(x.state[1], L.idx(1, 1));
    assert.ok(executeAction(L, an, from, x.action, x.state).ok);
  }
  const ex = exploreAll(an);
  for (const st of ex.states) for (const { state, action } of ex.model.successors(st)) {
    const r = executeAction(L, an, st, action, state);
    assert.ok(r.ok, `${JSON.stringify(st)} ${action.type}/${action.via?.kind} -> ${JSON.stringify(state)}: ${r.error}`);
  }
});

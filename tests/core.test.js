// The 16 required tests from the design plan (section 14), plus tests that the
// exact reachability analysis and the solver are sound and complete.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Level, SOLID } from '../src/core/level.js';
import { PHYS, SUBX, SUBY, ZELDA, MARIO, bodyAtCell, makeBody, stepBody } from '../src/core/physics.js';
import { Game } from '../src/core/game.js';
import { SHOOT_FLOOR } from '../src/core/portals.js';
import { MarioAnalyzer, standableCells, extractPlatforms } from '../src/core/mario.js';
import { movesFromPlatform, simulateMove, restingBody, restRange, outcomeKey } from '../src/core/reach.js';
import { analyzeLevel, summarize, changeReport } from '../src/core/analysis.js';
import { solve, PuzzleModel } from '../src/core/solver.js';
import { replaySolution } from '../src/core/replay.js';
import { generateLevel } from '../src/core/generator.js';
import { SAMPLES } from '../src/core/samples.js';

const run = (level, body, input, frames) => {
  for (let i = 0; i < frames; i++) stepBody(level, body, input, null);
  return body;
};
const solveLevel = (L) => {
  const analysis = analyzeLevel(L);
  return { analysis, result: solve(analysis) };
};
// Rest cells reachable from the platform containing cell (x, y), optionally
// limited to some vertical profiles (0 = walk off, 1 + h = jump held h frames).
function reachableCells(L, x, y, profiles = null) {
  const { platforms, platformOf } = extractPlatforms(L, standableCells(L));
  const pid = platformOf[L.idx(x, y)];
  const out = movesFromPlatform(L, platforms, pid, { profiles });
  return new Set([...out.values()].filter((o) => o.kind === 'land').map((o) => `${o.cell[0]},${o.cell[1]}`));
}

// Two characters, one floor socket, one wall socket on the left border.
const PORTAL_ROOM = [
  '#########',
  '#.......#',
  ']..o....#',
  '#.......#',
  '#..A.B..#',
  '#~~~~~~~#',
  '#......E#',
  '#########',
];

test('1. Zelda movement respects solid grid geometry (and pits)', () => {
  const L = Level.fromAscii(['#######', '#..#..#', '#..~..#', '#######']);
  const b = run(L, bodyAtCell(1, 1, ZELDA), { mx: 1 }, 60);
  assert.ok(Math.abs(b.x + PHYS.w - 3) < 1e-9, 'stops flush against the solid tile');
  const p = run(L, bodyAtCell(1, 2, ZELDA), { mx: 1 }, 60);
  assert.ok(Math.abs(p.x + PHYS.w - 3) < 1e-9, 'a pit blocks Zelda walking');
  const m = run(L, bodyAtCell(1, 1, ZELDA), { my: 1 }, 60);
  assert.ok(Math.abs(m.y + PHYS.h - 3) < 1e-9, 'the floor below the corridor is solid');
});

test('2. Mario movement lands on the upper edges of the same geometry', () => {
  const L = Level.fromAscii(['#####', '#...#', '#...#', '#.#.#', '#...#', '#####']);
  const b = makeBody(2 + (1 - PHYS.w) / 2, 1, MARIO);
  run(L, b, {}, 120);
  assert.equal(b.grounded, true);
  assert.ok(Math.abs(b.y + PHYS.h - 3) < 1e-9, 'stands on the top edge of the solid tile at row 3');
  // The same tile blocks a Zelda walker.
  const z = run(L, bodyAtCell(2, 1, ZELDA), { my: 1 }, 120);
  assert.ok(Math.abs(z.y + PHYS.h - 3) < 1e-9);
});

function portalGame() {
  const L = Level.fromAscii(PORTAL_ROOM);
  const g = new Game(L);
  return { L, g };
}

// Push in one direction until the character goes through a portal.
function walkInto(g, ci, input, frames = 90) {
  for (let i = 0; i < frames && !g.events.some((e) => e.type === 'teleport'); i++) {
    const inputs = [{}, {}];
    inputs[ci] = input;
    g.step(inputs);
  }
}

const LEFT = { x: -1, y: 0 };

test('3. Floor → wall activates Mario physics', () => {
  const { L, g } = portalGame();
  const wall = L.sockets.findIndex((s) => s.type === 'wall');
  const floor = L.sockets.findIndex((s) => s.type === 'floor');
  // B shoots the wall socket from across the room (the shot passes over the floor socket).
  g.chars[1].body = bodyAtCell(6, 2, ZELDA);
  assert.equal(g.shoot(1, LEFT).sid, wall);
  // A must stand on the floor socket to shoot it.
  g.chars[0].body = bodyAtCell(3, 1, ZELDA);
  assert.equal(g.shoot(0, SHOOT_FLOOR).sid, -1);
  g.chars[0].body = bodyAtCell(3, 2, ZELDA);
  assert.equal(g.shoot(0, SHOOT_FLOOR).sid, floor);
  g.chars[0].body = bodyAtCell(3, 1, ZELDA);
  walkInto(g, 0, { my: 1 }, 20);
  assert.equal(g.chars[0].body.mode, MARIO);
  assert.ok(g.events.some((e) => e.type === 'teleport' && e.socket === floor && e.toMode === MARIO));
});

test('4. Wall → floor activates Zelda physics', () => {
  const { L, g } = portalGame();
  const wall = L.sockets.findIndex((s) => s.type === 'wall');
  const floor = L.sockets.findIndex((s) => s.type === 'floor');
  g.chars[1].body = bodyAtCell(3, 2, ZELDA);
  assert.equal(g.shoot(1, SHOOT_FLOOR).sid, floor);
  // A stands in Mario mode on a ledge under the wall socket and shoots it.
  L.set(1, 3, SOLID);
  g.chars[0].body = bodyAtCell(1, 2, MARIO);
  run(L, g.chars[0].body, {}, 5);
  assert.equal(g.shoot(0, LEFT).sid, wall);
  walkInto(g, 0, { mx: -1 }, 20);
  assert.equal(g.chars[0].body.mode, ZELDA);
  const c = g.chars[0].body;
  assert.equal(Math.floor(c.x + PHYS.w / 2), 3);
  assert.equal(Math.floor(c.y + PHYS.h / 2), 2);
});

test('5. Wall → wall preserves the current mode', () => {
  const L = Level.fromAscii([
    '#########',
    '#.......#',
    '].......[',
    '#.......#',
    '#########',
  ]);
  for (const mode of [ZELDA, MARIO]) {
    const g = new Game(L);
    g.portals = [0, 1];
    g.chars[0].body = mode === ZELDA ? bodyAtCell(1, 2, ZELDA) : bodyAtCell(1, 3, MARIO);
    if (mode === MARIO) {
      // Jump up the wall into the socket face at row 2.
      for (let i = 0; i < 40 && !g.events.length; i++) g.step([{ mx: -1, jump: true }, {}]);
    } else {
      walkInto(g, 0, { mx: -1 }, 20);
    }
    const tp = g.events.find((e) => e.type === 'teleport');
    assert.ok(tp, `teleported in mode ${mode}`);
    assert.equal(tp.fromMode, mode);
    assert.equal(tp.toMode, mode);
  }
});

test('6. Variable-height jumps produce different reachable destinations', () => {
  // A wide floor (row 5) and a pillar of height h at x = 6; its top cell is (6, 5 - h).
  const pillar = (h) => {
    const rows = ['##########', '#........#', '#........#', '#........#', '#........#', '#A.......#', '##########'].map((r) => [...r]);
    for (let y = 6 - h; y <= 5; y++) rows[y][6] = '#';
    return Level.fromAscii(rows.map((r) => r.join('')));
  };
  const top = (h) => `6,${5 - h}`;
  const tap = (h) => reachableCells(pillar(h), 1, 5, [1]).has(top(h)); // jump released immediately
  const full = (h) => reachableCells(pillar(h), 1, 5, [16]).has(top(h)); // held as long as possible
  assert.ok(tap(1), 'a tap reaches a one-tile ledge');
  assert.ok(!tap(2), 'a tap cannot reach a two-tile ledge');
  assert.ok(full(2), 'holding jump reaches a two-tile ledge');
  assert.ok(!reachableCells(pillar(3), 1, 5).has(top(3)), 'nothing reaches three tiles up');
});

test('7. Walking off a ledge is handled by JumpTo', () => {
  const L = Level.fromAscii([
    '#######',
    '#.....#',
    '#.....#',
    '##....#',
    '#.....#',
    '#######',
  ]);
  // Walking off (profile 0) alone already reaches the floor below.
  assert.ok(reachableCells(L, 1, 2, [0]).has('3,4'));
  const a = analyzeLevel(L);
  const high = a.mario.platformOf[L.idx(1, 2)];
  const low = a.mario.platformOf[L.idx(3, 4)];
  assert.ok(a.mario.edges.some((e) => e.from === high && e.to === low), 'one JumpTo edge covers the fall');
});

test('8. Reachable tile offsets match the movement limits', () => {
  // One-tile takeoff pillar at (1,7) and a one-tile target pillar at offset (dx, dy).
  const reach = (dx, dy) => {
    const rows = [];
    for (let y = 0; y < 10; y++) rows.push([...('#' + '~'.repeat(12) + '#')]);
    rows[9] = [...'#'.repeat(14)];
    for (let y = 8; y <= 8; y++) rows[y][1] = '#';
    rows[7][1] = '.';
    const tx = 1 + dx;
    const ty = 7 + dy;
    rows[ty][tx] = '.';
    for (let y = ty + 1; y <= 8; y++) rows[y][tx] = '#';
    const L = Level.fromAscii(rows.map((r) => r.join('')));
    return reachableCells(L, 1, 7).has(`${tx},${ty}`);
  };
  // From a one-tile ledge (no run-up beyond the tile): up to 2 tiles up, and up
  // to 4 tiles across going up or 5 across on the level or lower.
  for (const [dx, dy] of [[1, 0], [3, 0], [5, 0], [1, -1], [4, -1], [1, -2], [4, -2], [5, 1]]) assert.ok(reach(dx, dy), `offset (${dx}, ${dy}) is reachable`);
  for (const [dx, dy] of [[1, -3], [2, -3], [5, -1], [5, -2], [6, 0], [6, 1], [8, 0]]) assert.ok(!reach(dx, dy), `offset (${dx}, ${dy}) is out of reach`);
});

test('9. Obstacles invalidate otherwise valid jumps', () => {
  const open = Level.fromAscii([
    '########',
    '#......#',
    '#......#',
    '#......#',
    '#......#',
    '##..####',
    '########',
  ]);
  const walled = open.clone();
  for (let y = 1; y <= 4; y++) walled.set(3, y, SOLID);
  assert.ok(reachableCells(open, 1, 4).has('4,4'), 'the gap can be jumped');
  assert.ok(!reachableCells(walled, 1, 4).has('4,4'), 'a wall in the way blocks every jump');
});

test('10. Equivalent trajectories do not create redundant solver states', () => {
  const L = Level.fromAscii(SAMPLES[1].rows);
  const a = analyzeLevel(L);
  const keys = a.mario.edges.map((e) => `${e.from}|${e.to}|${e.touched}`);
  assert.equal(new Set(keys).size, keys.length, 'one edge per distinct (destination, portals touched)');
  assert.ok(a.mario.edges.some((e) => e.variants > 10), 'many trajectories collapse into one edge');
  const model = new PuzzleModel(a);
  const p = a.mario.platformOf[L.idx(6, 8)];
  const s = [MARIO, p, ZELDA, L.idx(9, 2), -1, -1];
  const succ = model.successors(s).filter((x) => x.action.c === 0 && x.action.type === 'jump');
  const states = new Set(succ.map((x) => x.state.join(',')));
  assert.equal(states.size, succ.length);
});

test('11. A pillar can reduce Zelda reachability and increase Mario reachability', () => {
  // A floor walkway over pits; the pillar rises from the bottom through it.
  const rows = [
    '#########',
    '#~~~~~~~#',
    '#~~~~~~~#',
    '#.......#',
    '#~~~~~~~#',
    '#~~~~~~~#',
    '#########',
  ];
  const before = analyzeLevel(Level.fromAscii(rows));
  const pillar = rows.map((r, y) => (y >= 3 && y <= 5 ? `${r.slice(0, 4)}#${r.slice(5)}` : r));
  const after = analyzeLevel(Level.fromAscii(pillar));
  const sb = summarize(before);
  const sa = summarize(after);
  assert.ok(sa.zeldaRegions > sb.zeldaRegions, 'pillar splits the Zelda region');
  assert.ok(sa.platforms > sb.platforms, 'pillar top is a new Mario platform');
  assert.ok(sa.jumpConnections > sb.jumpConnections, 'and creates new jump connections');
});

test('12. The solver requires both characters to reach the exit', () => {
  // B is sealed in a cell with no sockets: A can finish, B cannot.
  const L = Level.fromAscii([
    '#########',
    '#A..o...#',
    ']......E#',
    '#########',
    '#B#######',
    '#########',
  ]);
  const { result, analysis } = solveLevel(L);
  assert.equal(result.status, 'unsolvable');
  const model = new PuzzleModel(analysis);
  const s = model.initialState();
  s[1] = L.idx(7, 2);
  assert.equal(model.isGoal(s), false, 'A alone at the exit is not a goal');
});

test('13. Portal ownership is enforced', () => {
  const { L, g } = portalGame();
  const wall = L.sockets.findIndex((s) => s.type === 'wall');
  g.chars[0].body = bodyAtCell(1, 2, ZELDA);
  g.chars[1].body = bodyAtCell(2, 2, ZELDA);
  assert.equal(g.shoot(1, LEFT).sid, wall);
  assert.equal(g.shoot(0, LEFT).sid, -1, "A cannot take B's socket");
  assert.deepEqual(g.portals, [-1, wall]);
  // In the solver every placement only ever changes the acting character's portal.
  const { result } = solveLevel(Level.fromAscii(PORTAL_ROOM));
  result.actions.forEach((a, i) => {
    if (a.type !== 'place') return;
    const before = result.states[i];
    const after = result.states[i + 1];
    assert.equal(after[4 + (1 - a.c)], before[4 + (1 - a.c)]);
    assert.equal(after[4 + a.c], a.socket);
  });
});

test('14. The solver detects unintended shortcuts', () => {
  const intended = Level.fromAscii(SAMPLES[1].rows);
  const { analysis: a1, result: r1 } = solveLevel(intended);
  assert.equal(r1.status, 'solved');
  // Filling the pit band opens a walking route: the solver must find the shorter solution.
  const shortcut = intended.clone();
  for (let x = 1; x <= 10; x++) shortcut.set(x, 5, 0);
  for (let y = 6; y <= 7; y++) shortcut.set(8, y, 0);
  for (let x = 1; x <= 10; x++) shortcut.set(x, 6, 0);
  const { analysis: a3, result: r3 } = solveLevel(shortcut);
  assert.equal(r3.status, 'solved');
  assert.ok(r3.minActions < r1.minActions, `shortcut found (${r3.minActions} < ${r1.minActions})`);
  const rep2 = changeReport('Filled the pit band', summarize(a1, r1), summarize(a3, r3));
  assert.ok(rep2.warnings.includes('New shortcut discovered'));
});

test('15. Solver solutions replay successfully with gameplay physics', () => {
  for (const s of SAMPLES) {
    const L = Level.fromAscii(s.rows, s.name);
    const { analysis, result } = solveLevel(L);
    assert.equal(result.status, 'solved', s.name);
    const rp = replaySolution(L, analysis, result, { record: false });
    assert.ok(rp.ok, `${s.name}: ${rp.error}`);
  }
});

test('16. Identical generation seeds produce identical results', () => {
  const a = generateLevel({ seed: 42, iterations: 40 });
  const b = generateLevel({ seed: 42, iterations: 40 });
  assert.deepEqual(a.level, b.level);
  assert.deepEqual(a.metrics, b.metrics);
  assert.deepEqual(a.solution, b.solution);
  const c = generateLevel({ seed: 43, iterations: 40 });
  assert.notDeepEqual(a.level, c.level);
});

test('extra: a search timeout is reported as inconclusive, not impossible', () => {
  const L = Level.fromAscii(SAMPLES[2].rows);
  const r = solve(analyzeLevel(L), { maxStates: 20 });
  assert.equal(r.status, 'timeout');
});

test('extra: incremental analysis matches a fresh analysis', () => {
  const L = Level.fromAscii(SAMPLES[1].rows);
  const analyzer = new MarioAnalyzer();
  analyzeLevel(L, analyzer);
  const edited = L.clone();
  edited.set(4, 9, SOLID);
  const inc = analyzeLevel(edited, analyzer);
  const fresh = analyzeLevel(edited);
  assert.ok(inc.mario.stats.cached > 0, 'cache reused');
  const key = (a) => a.mario.edges.map((e) => `${e.from}|${e.to}|${e.touched}|${e.measure}`).sort();
  assert.deepEqual(key(inc), key(fresh));
});

test('shooting: straight cardinal lines to marked sockets only', () => {
  const L = Level.fromAscii([
    '##########',
    '#........#',
    ']..~..#..#',
    '#........#',
    '#.....A..#',
    '##########',
  ]);
  const g = new Game(L);
  const at = (x, y, mode = ZELDA) => {
    g.chars[0].body = bodyAtCell(x, y, mode);
  };
  at(5, 2);
  assert.equal(g.shoot(0, LEFT).sid, 0, 'the shot flies over the pit to the socket');
  g.portals = [-1, -1];
  at(8, 2);
  assert.equal(g.shoot(0, LEFT).sid, -1, 'a solid tile in the way stops the shot');
  at(1, 1);
  assert.equal(g.shoot(0, { x: 0, y: 1 }).sid, -1, 'up/down shots hit no socket (sockets are on side faces)');
  at(4, 3);
  assert.equal(g.shoot(0, LEFT).sid, -1, 'a plain wall takes no portal');
  // Platformer mode: only while standing.
  const L2 = Level.fromAscii(['#######', '].....#', '#.....#', '#######']);
  const g2 = new Game(L2);
  g2.chars[0].body = bodyAtCell(4, 1, MARIO);
  g2.chars[0].body.grounded = false;
  assert.equal(g2.shoot(0, LEFT).sid, -1, 'no shooting in mid-air');
  assert.match(g2.aimShot(0, LEFT).reason, /Land first/);
  g2.chars[0].body = bodyAtCell(4, 2, MARIO);
  assert.equal(g2.shoot(0, LEFT).sid, -1, 'standing a row lower: the socket is not in line');
  assert.equal(g2.shoot(0, SHOOT_FLOOR).sid, -1, 'no floor shots in platformer mode');
});

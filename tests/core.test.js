// The 16 required tests from the design plan (section 14), plus a few extras.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Level, SOLID } from '../src/core/level.js';
import { PHYS, ZELDA, MARIO, bodyAtCell, makeBody, stepBody } from '../src/core/physics.js';
import { Game } from '../src/core/game.js';
import { JUMP_POLICIES, simulate, jumpTable, MarioAnalyzer } from '../src/core/mario.js';
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
const policy = (match) => JUMP_POLICIES.findIndex((p) => Object.entries(match).every(([k, v]) => p[k] === v));

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

test('3. Floor → wall activates Mario physics', () => {
  const { L, g } = portalGame();
  const wall = L.sockets.findIndex((s) => s.type === 'wall');
  const floor = L.sockets.findIndex((s) => s.type === 'floor');
  g.chars[1].body = bodyAtCell(1, 2, ZELDA);
  assert.ok(g.placePortal(1, wall));
  g.chars[0].body = bodyAtCell(3, 1, ZELDA);
  // A must stand on the floor socket to place on it.
  assert.equal(g.placePortal(0, floor), false);
  g.chars[0].body = bodyAtCell(3, 2, ZELDA);
  assert.ok(g.placePortal(0, floor));
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
  g.placePortal(1, floor);
  g.chars[0].body = bodyAtCell(1, 2, MARIO);
  g.chars[0].body.mode = MARIO;
  g.chars[0].body.y = 2 + 1 - PHYS.h;
  // Put a ledge under the access cell so A can stand there in Mario mode.
  L.set(1, 3, SOLID);
  run(L, g.chars[0].body, {}, 5);
  assert.ok(g.placePortal(0, wall));
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
  // Ledges 1 and 2 tiles high to the right of the takeoff cell.
  const L = Level.fromAscii([
    '########',
    '#......#',
    '#......#',
    '#.....##',
    '#...#.##',
    '#.A.####',
    '########',
  ]);
  const shortHop = policy({ kind: 'jump', dir: 1, hold: 0, release: -1 });
  const fullJump = policy({ kind: 'jump', dir: 1, hold: 15, release: -1 });
  const start = bodyAtCell(3, 5, MARIO);
  const a = simulate(L, start, JUMP_POLICIES[shortHop]);
  const b = simulate(L, start, JUMP_POLICIES[fullJump]);
  const cellOf = (r) => ({ x: r.land % L.width, y: Math.floor(r.land / L.width) });
  assert.notEqual(a.land, b.land);
  assert.ok(cellOf(b).y < cellOf(a).y, 'holding jump reaches a higher ledge');
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
  const walk = policy({ kind: 'walk', dir: 1 });
  const r = simulate(L, bodyAtCell(1, 2, MARIO), JUMP_POLICIES[walk]);
  assert.equal(Math.floor(r.land / L.width), 4, 'walked off the ledge and fell to the floor');
  const a = analyzeLevel(L);
  const high = a.mario.platformOf[L.idx(1, 2)];
  const low = a.mario.platformOf[L.idx(3, 4)];
  assert.ok(a.mario.edges.some((e) => e.from === high && e.to === low), 'single JumpTo edge covers the fall');
});

test('8. The jump table identifies reachable tile offsets', () => {
  const { offsets } = jumpTable();
  for (const k of ['1,0', '2,0', '3,0', '4,0', '1,-1', '1,-2', '0,-2', '-1,-1', '2,2']) assert.ok(offsets.has(k), `offset ${k} reachable`);
  for (const k of offsets.keys()) {
    const [, dy] = k.split(',').map(Number);
    assert.ok(dy > -3, `no jump clears three tiles (found ${k})`);
  }
  const fullOnly = offsets.get('1,-2').every((e) => JUMP_POLICIES[e.policy].hold >= 6);
  assert.ok(fullOnly, 'two-tile climbs need a held jump');
});

test('9. Obstacles invalidate otherwise valid jump templates', () => {
  const open = Level.fromAscii([
    '########',
    '#......#',
    '#......#',
    '#......#',
    '#A~~E..#',
    '########',
  ]);
  const walled = Level.fromAscii([
    '########',
    '#......#',
    '#..#...#',
    '#..#...#',
    '#A~#E..#',
    '########',
  ]);
  assert.ok(jumpTable().offsets.has('3,0'));
  const from = (L, a) => a.mario.platformOf[L.idx(1, 4)];
  const to = (L, a) => a.mario.platformOf[L.idx(4, 4)];
  const a1 = analyzeLevel(open);
  // In the open level everything on row 4 is one platform; in the walled level
  // the template's candidate exists but no validated trajectory crosses.
  assert.equal(from(open, a1), to(open, a1));
  const a2 = analyzeLevel(walled);
  const f = from(walled, a2);
  const t = to(walled, a2);
  assert.ok(a2.mario.candidates.has(`${f}>${t}`), 'jump table proposes the connection');
  assert.ok(!a2.mario.edges.some((e) => e.from === f && e.to === t), 'collision check rejects it');
});

test('10. Equivalent trajectories do not create redundant solver states', () => {
  const L = Level.fromAscii(SAMPLES[1].rows);
  const a = analyzeLevel(L);
  const keys = a.mario.edges.map((e) => `${e.from}|${e.to}|${e.touched}`);
  assert.equal(new Set(keys).size, keys.length, 'one edge per distinct outcome');
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
  g.chars[1].body = bodyAtCell(1, 2, ZELDA);
  assert.ok(g.placePortal(1, wall));
  assert.equal(g.placePortal(0, wall), false, "A cannot take B's socket");
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
  const key = (a) => a.mario.edges.map((e) => `${e.from}|${e.to}|${e.touched}|${e.variants}`).sort();
  assert.deepEqual(key(inc), key(fresh));
});

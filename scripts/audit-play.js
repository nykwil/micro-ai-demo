// Audit of the solver model against real play: episodes of random input for
// both characters, started from random reachable states; every situation they
// come to rest in must be covered by a state the solver considers reachable.
//   node scripts/audit-play.js [levels=6] [frames=200000]
import { Level } from '../src/core/level.js';
import { buildSkeleton, mutate } from '../src/core/generator.js';
import { expandGrammar } from '../src/core/grammar.js';
import { Rng } from '../src/core/rng.js';
import { analyzeLevel } from '../src/core/analysis.js';
import { exploreAll } from '../src/core/solver.js';
import { Game } from '../src/core/game.js';
import { gameAtState } from '../src/core/replay.js';
import { ZELDA, MARIO, centerCell } from '../src/core/physics.js';
import { blockedCell } from '../src/core/portals.js';
import { reachableLabels } from '../src/core/zelda.js';
import { SAMPLES } from '../src/core/samples.js';
const NLEV = +process.argv[2] || 6, FRAMES = +process.argv[3] || 200000;
const levels = SAMPLES.map(s => Level.fromAscii(s.rows));
for (let s = 0; levels.length < NLEV; s++) { const rng = new Rng(3100 + s); const g = expandGrammar({ physicsSwitches: 2, coopDeps: 1, alternationDepth: 3, portalRelocations: 1 }, rng);
  let L = buildSkeleton(g.motifs, rng); for (let j = 0; j < 25; j++) { const m = mutate(L, rng); if (m) L = m.level; } levels.push(L); }
// Normalise a character's location: Zelda -> the set of regions it can walk to; Mario -> platform.
function charKey(level, an, mode, loc, p0, p1) {
  if (mode === MARIO) return `M${loc}`;
  const regions = an.zeldaByBlocked.get(blockedCell(level, p0, p1));
  return `Z${[...reachableLabels(level, regions, loc)].sort((a, b) => a - b).join('.')}`;
}
let totalChecks = 0, missing = 0, incomplete = 0, visitedTotal = 0, knownTotal = 0;
const rng = new Rng(77);
for (const [li, L] of levels.entries()) {
  const an = analyzeLevel(L);
  const ex = exploreAll(an, { maxStates: 400000 });
  if (!ex.complete) { incomplete++; continue; }
  const known = new Set(ex.states.map(s => `${charKey(L, an, s[0], s[1], s[4], s[5])}|${charKey(L, an, s[2], s[3], s[4], s[5])}|${s[4]}|${s[5]}`));
  // A game situation is covered if some known state has the same portals and
  // Mario platforms, and lets each Zelda character reach at least as much.
  const covers = (a, b) => a === b || (a[0] === 'Z' && b[0] === 'Z' && b.slice(1).split('.').every((x) => a.slice(1).split('.').includes(x)));
  const knownList = [...known].map((k) => k.split('|'));
  const covered = (key) => known.has(key) || knownList.some((k) => { const g = key.split('|'); return k[2] === g[2] && k[3] === g[3] && covers(k[0], g[0]) && covers(k[1], g[1]); });
  const visited = new Set(); knownTotal += known.size;
  let g = new Game(L);
  const inp = [{ mx: 0, my: 0, jump: false }, { mx: 0, my: 0, jump: false }];
  let hold = [0, 0];
  for (let f = 0; f < FRAMES; f++) {
    // Episodes of 600 frames, each starting from a random reachable state.
    if (f % 600 === 0) g = gameAtState(L, an, rng.pick(ex.states));
    for (const c of [0, 1]) {
      if (hold[c]-- <= 0) { hold[c] = rng.int(1, 40); inp[c] = { mx: rng.chance(0.5) ? rng.next() * 2 - 1 : rng.int(-1, 1), my: rng.chance(0.3) ? rng.int(-1, 1) : 0, jump: rng.chance(0.4) }; }
      if (rng.chance(0.01)) g.placePortal(c);
    }
    g.step(inp);
    // Check at moments when both characters are at rest (Zelda: anywhere; Mario: grounded and stopped).
    const rest = g.chars.every(ch => ch.body.mode === ZELDA || (ch.body.grounded && ch.body.vx === 0));
    if (!rest || f % 3) continue;
    const locs = [0, 1].map(c => g.abstractLoc(c, an.mario.platformOf));
    if (locs.some(l => l.loc < 0)) continue;
    const key = `${charKey(L, an, locs[0].mode, locs[0].loc, g.portals[0], g.portals[1])}|${charKey(L, an, locs[1].mode, locs[1].loc, g.portals[0], g.portals[1])}|${g.portals[0]}|${g.portals[1]}`;
    totalChecks++; visited.add(key);
    if (!covered(key)) { missing++; if (missing <= 5) console.log('NOT IN MODEL', li, key, 'frame', f, JSON.stringify(g.chars.map(c => ({ x: c.body.x, y: c.body.y, m: c.body.mode })))); known.add(key); }
  }
  visitedTotal += visited.size; console.log('level', li, 'visited', visited.size, 'of', known.size);
}
  // (per level)
console.log({ levels: levels.length, checks: totalChecks, missing, incomplete });

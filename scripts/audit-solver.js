// Audit of the solver: every transition of the state graph is executed in the
// real game from that state and must end in the state the solver predicts.
//   node scripts/audit-solver.js [levels=8] [statesPerLevel=400]

import { Level } from '../src/core/level.js';
import { buildSkeleton, mutate } from '../src/core/generator.js';
import { expandGrammar } from '../src/core/grammar.js';
import { Rng } from '../src/core/rng.js';
import { analyzeLevel } from '../src/core/analysis.js';
import { exploreAll } from '../src/core/solver.js';
import { executeAction } from '../src/core/replay.js';
import { SAMPLES } from '../src/core/samples.js';
const NLEV = +process.argv[2] || 8, MAXS = +process.argv[3] || 400;
const levels = SAMPLES.map(s => Level.fromAscii(s.rows));
for (let s = 0; levels.length < NLEV; s++) { const rng = new Rng(3100 + s); const g = expandGrammar({ physicsSwitches: 2, coopDeps: 1, alternationDepth: 3, portalRelocations: 1 }, rng);
  let L = buildSkeleton(g.motifs, rng); for (let j = 0; j < 25; j++) { const m = mutate(L, rng); if (m) L = m.level; } levels.push(L); }
let ok = 0, bad = 0; const errs = {}; const kinds = {};
const rng = new Rng(5);
for (const [li, L] of levels.entries()) {
  const an = analyzeLevel(L);
  const ex = exploreAll(an, { maxStates: 400000 });
  const states = ex.states.length > MAXS ? Array.from({ length: MAXS }, () => rng.pick(ex.states)) : ex.states;
  for (const st of states) {
    for (const { state, action } of ex.model.successors(st)) {
      const r = executeAction(L, an, st, action, state);
      kinds[action.type + '/' + (action.via?.kind ?? '-')] = (kinds[action.type + '/' + (action.via?.kind ?? '-')] || 0) + 1;
      if (r.ok) ok++; else { bad++; const k = r.error.replace(/\d+/g, '#'); errs[k] = (errs[k] || 0) + 1; if (bad <= 5) console.log('FAIL level', li, JSON.stringify(st), JSON.stringify({ ...action, chain: action.chain }), '->', JSON.stringify(state), r.error); }
    }
  }
  console.log('level', li, 'states', ex.states.length, 'ok', ok, 'bad', bad);
}
console.log({ ok, bad }, errs, kinds);

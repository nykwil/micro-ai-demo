// CLI: generate levels and report how complex they are.
//   node scripts/level-stats.js [seed=1] [count=4] [iterations=500] [outDir]
//   node scripts/level-stats.js samples
// For each level: shortest solution length (actions), states on that path
// (nodes), the size of the whole state graph, and the options (distinct next
// states) at each node, with how many of them stay on a shortest route.
import { mkdirSync, writeFileSync } from 'node:fs';
import { generateBatch, DEFAULT_TARGETS } from '../src/core/generator.js';
import { Level } from '../src/core/level.js';
import { analyzeLevel } from '../src/core/analysis.js';
import { solve, describeAction, findFailures } from '../src/core/solver.js';
import { stateGraphStats } from '../src/core/metrics.js';
import { SAMPLES } from '../src/core/samples.js';

function report(name, L) {
  const an = analyzeLevel(L);
  const r = solve(an);
  const g = stateGraphStats(an);
  const f = findFailures(an);
  console.log(`\n=== ${name} ===`);
  console.log(L.toAscii().join('\n'));
  if (r.status !== 'solved') {
    console.log('status:', r.status);
    return null;
  }
  console.log(`actions ${g.minActions}  path nodes ${g.minActions + 1}  states ${g.states} (${g.winnableStates} can still win)  transitions ${g.transitions}`);
  console.log(`options per node: mean ${g.avgOptions}, max ${g.maxOptions}  shortest solutions ${r.shortestCount}  fail moves ${f.failMoves.length}`);
  r.actions.forEach((a, i) => {
    const p = g.path[i];
    console.log(`  ${String(i + 1).padStart(2)}. [${p.options} options, ${p.forward} on a shortest route] ${describeAction(L, an, a)}`);
  });
  return { name, actions: g.minActions, nodes: g.minActions + 1, states: g.states, avgOptions: g.avgOptions, maxOptions: g.maxOptions, pathOptions: g.path.map((p) => p.options), pathForward: g.path.map((p) => p.forward), shortest: r.shortestCount, failMoves: f.failMoves.length, rows: L.toAscii() };
}

const args = process.argv.slice(2);
const rows = [];
if (args[0] === 'samples') {
  for (const s of SAMPLES) rows.push(report(s.name, Level.fromAscii(s.rows)));
} else {
  const [seed = '1', count = '4', iterations = '500', outDir = ''] = args;
  generateBatch({ seed: Number(seed), count: Number(count), iterations: Number(iterations), targets: DEFAULT_TARGETS }, (res) => {
    const out = report(`candidate ${res.batchIndex} (seed ${res.seed}) ${res.accepted ? 'ACCEPTED' : 'rejected'}`, Level.fromJSON(res.level));
    if (out) rows.push({ ...out, accepted: res.accepted, seed: res.seed });
    if (outDir) {
      mkdirSync(outDir, { recursive: true });
      writeFileSync(`${outDir}/level_${res.seed}.json`, JSON.stringify(res, null, 2));
    }
  });
}
console.log('\nSUMMARY ' + JSON.stringify(rows.filter(Boolean)));

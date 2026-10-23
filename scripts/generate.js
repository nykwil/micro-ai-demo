// CLI: generate levels without the browser.
//   node scripts/generate.js [seed] [count] [iterations] [outDir]
import { mkdirSync, writeFileSync } from 'node:fs';
import { generateBatch, DEFAULT_TARGETS } from '../src/core/generator.js';
import { Level } from '../src/core/level.js';

const [seed = '1', count = '3', iterations = '300', outDir = ''] = process.argv.slice(2);
const t0 = Date.now();
generateBatch({ seed: Number(seed), count: Number(count), iterations: Number(iterations), targets: DEFAULT_TARGETS }, (r) => {
  const m = r.metrics;
  console.log(`\n=== candidate ${r.batchIndex} (seed ${r.seed}) score ${r.score} ${r.accepted ? 'ACCEPTED' : 'rejected'} ===`);
  console.log(Level.fromJSON(r.level).toAscii().join('\n'));
  console.log('motifs:', r.motifs.map((x) => `${x.motif}${x.present ? '' : '(missing)'}`).join(', '));
  if (m.solved) {
    console.log(`actions ${m.minActions}  parallel ${m.parallelSteps}  switches ${m.physicsSwitches}  relocations ${m.portalRelocations}  coop ${m.coopDeps}  alternation ${m.alternationDepth}  difficulty ${m.executionDifficulty}  diversity ${m.solutionDiversity}`);
    r.solution.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
  } else console.log('status:', m.status);
  console.log('replay:', JSON.stringify(r.replay), ' shortcut:', r.shortcut, ' restarts:', r.restarts);
  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(`${outDir}/level_${r.seed}.json`, JSON.stringify(r, null, 2));
  }
});
console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)}s`);

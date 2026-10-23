// Audit of the exact Mario reachability (see README "Verification").
//   node scripts/audit-reach.js [levels=6] [randomMovesPerLevel=20000] [allsockets]
// (1) every outcome's witness must replay to that outcome with the real physics;
// (2) random analog input must never reach an outcome the analysis missed.
// 'allsockets' puts a portal socket on every wall face to stress the touched-face bookkeeping.

import { Level } from '../src/core/level.js';
import { buildSkeleton, mutate } from '../src/core/generator.js';
import { expandGrammar } from '../src/core/grammar.js';
import { Rng } from '../src/core/rng.js';
import { standableCells, extractPlatforms } from '../src/core/mario.js';
import { makeEnv, movesFromPlatform, movesFromLaunch, witnessFor, simulateMove, restingBody, replayWitness, outcomeKey, restRange, launchStart, runProduces } from '../src/core/reach.js';
import { exitBody } from '../src/core/portals.js';
import { MARIO, SUBX } from '../src/core/physics.js';
import { SAMPLES } from '../src/core/samples.js';
const NLEV = +process.argv[2] || 6, NRAND = +process.argv[3] || 20000;
const levels = SAMPLES.map(s => Level.fromAscii(s.rows));
for (let s = 0; levels.length < NLEV; s++) { const rng = new Rng(900 + s); const g = expandGrammar({ physicsSwitches: 2, coopDeps: 1, alternationDepth: 3, portalRelocations: 1 }, rng);
  let L = buildSkeleton(g.motifs, rng); for (let j = 0; j < 25; j++) { const m = mutate(L, rng); if (m) L = m.level; } levels.push(L); }
if (process.argv[4] === 'allsockets') {
  // Stress the touched-socket bookkeeping: put a socket on every valid wall face.
  for (const L of levels) {
    for (let y = 0; y < L.height; y++) for (let x = 0; x < L.width; x++) for (const n of [-1, 1]) {
      const s = { type: 'wall', x, y, n };
      if (L.socketValid(s) && L.socketAtFace(x, y, n) < 0) L.sockets.push(s);
    }
    L.rebuildIndex();
  }
}
const rng = new Rng(4242);
let wOk = 0, wBad = 0, missed = 0, randHits = 0, t0 = Date.now(), tA = 0;
for (const [li, L] of levels.entries()) {
  const env = makeEnv(L); const sc = standableCells(L); const { platforms } = extractPlatforms(L, sc);
  const t1 = Date.now();
  const per = platforms.map((_, p) => movesFromPlatform(env, platforms, p));
  const launches = L.sockets.map((s, sid) => L.socketValid(s) ? movesFromLaunch(env, sid) : null);
  tA += Date.now() - t1;
  // (1) soundness
  per.forEach((outs, p) => { for (const o of outs.values()) { const w = witnessFor(env, o);
    const r = replayWitness(L, w, restingBody(w.startX, platforms[p].y)); if (runProduces(r, o)) wOk++; else { wBad++; if (wBad < 5) console.log('BAD witness', li, p, outcomeKey(o), '->', r && JSON.stringify(r)); } } });
  launches.forEach((outs, sid) => { if (!outs) return; for (const o of outs.values()) { const w = witnessFor(env, o);
    const r = replayWitness(L, w, exitBody(L, sid, MARIO)); if (runProduces(r, o)) wOk++; else { wBad++; if (wBad < 5) console.log('BAD launch witness', li, sid, outcomeKey(o), '->', r && JSON.stringify(r)); } } });
  // (2) completeness vs random analog input
  for (let i = 0; i < NRAND; i++) {
    const useLaunch = rng.chance(0.15) && launches.some(Boolean);
    let body, keys;
    if (useLaunch) { const sids = launches.map((o, i) => o ? i : -1).filter(i => i >= 0); const sid = rng.pick(sids); body = exitBody(L, sid, MARIO); keys = launches[sid]; }
    else { const p = rng.int(0, platforms.length - 1); const [lo, hi] = restRange(L, platforms[p]); body = restingBody(rng.int(lo, hi) / SUBX, platforms[p].y); keys = per[p]; }
    const k = rng.chance(0.2) ? -1 : rng.int(0, 20), hold = rng.int(0, 16), block = rng.int(1, 10);
    const seq = Array.from({ length: 120 }, () => rng.chance(0.4) ? rng.next() * 2 - 1 : rng.int(-1, 1));
    const gseq = Array.from({ length: 30 }, () => rng.chance(0.5) ? rng.next() * 2 - 1 : rng.int(-1, 1));
    const r = simulateMove(L, body, (f, st) => st.airborne ? { mx: seq[Math.floor(f / block) % 120], jump: k >= 0 && f >= k && f <= k + hold } : { mx: gseq[Math.min(29, Math.floor(f / 3))], jump: k >= 0 && f >= k && f <= k + hold });
    if (!r) continue; randHits++;
    const have = new Set([...keys.values()].map(outcomeKey));
    for (const x of [r.land, ...r.faces]) if (!have.has(outcomeKey(x))) { missed++; if (missed < 6) console.log('MISSED', li, useLaunch ? 'launch' : 'platform', outcomeKey(x)); }
  }
}
console.log({ levels: levels.length, witnessesOk: wOk, witnessesBad: wBad, randomMoves: randHits, missed, analysisMs: tA, totalS: (Date.now() - t0) / 1000 });

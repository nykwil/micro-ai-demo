// Combined reachability analysis for a level: Zelda regions (per floor-portal
// configuration) plus the Mario platform graph. Also produces the summary
// numbers used by the geometry-change report.

import { FLOOR_SOCKET } from './level.js';
import { zeldaRegions } from './zelda.js';
import { MarioAnalyzer } from './mario.js';

export function analyzeLevel(level, analyzer = new MarioAnalyzer()) {
  const t0 = now();
  const zeldaByBlocked = new Map();
  zeldaByBlocked.set(-1, zeldaRegions(level, -1));
  level.sockets.forEach((s) => {
    if (s.type !== FLOOR_SOCKET) return;
    const c = level.idx(s.x, s.y);
    if (!zeldaByBlocked.has(c)) zeldaByBlocked.set(c, zeldaRegions(level, c));
  });
  const mario = analyzer.analyze(level);
  const ms = now() - t0;
  return { level, zeldaByBlocked, zelda: zeldaByBlocked.get(-1), mario, ms };
}

export function summarize(analysis, solveResult) {
  const { zelda, mario } = analysis;
  const jumps = new Set(mario.edges.filter((e) => e.from !== e.to).map((e) => `${e.from}>${e.to}`));
  return {
    zeldaRegions: zelda.regions.length,
    platforms: mario.platforms.length,
    jumpConnections: jumps.size,
    jumpCandidates: mario.candidates.size,
    portalLaunches: mario.launches.reduce((n, l) => n + l.length, 0),
    shortest: solveResult && solveResult.status === 'solved' ? solveResult.minActions : null,
    status: solveResult ? solveResult.status : null,
  };
}

// Geometry-change report in the format of the design plan.
export function changeReport(description, before, after) {
  const lines = [description, ''];
  const row = (label, a, b) => `    ${label}: ${a ?? '-'} → ${b ?? '-'}`;
  lines.push('Zelda:', row('Connected regions', before.zeldaRegions, after.zeldaRegions), '');
  lines.push('Mario:', row('Platforms', before.platforms, after.platforms), row('Jump connections', before.jumpConnections, after.jumpConnections), row('Portal launches', before.portalLaunches, after.portalLaunches), '');
  const fmt = (s) => (s.status === 'solved' ? `${s.shortest} actions` : s.status || '-');
  lines.push('Puzzle:', row('Shortest solution', fmt(before), fmt(after)));
  const warnings = [];
  if (before.status === 'solved' && after.status === 'solved' && after.shortest < before.shortest) warnings.push('New shortcut discovered');
  if (before.status === 'solved' && after.status === 'unsolvable') warnings.push('Level became unsolvable');
  if (before.status !== 'solved' && after.status === 'solved') warnings.push('Level became solvable');
  if (warnings.length) lines.push('', 'Warning:', ...warnings.map((w) => `    ${w}`));
  return { text: lines.join('\n'), warnings };
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

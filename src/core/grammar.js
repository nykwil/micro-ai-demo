// Puzzle grammar: motifs describe required relationships, expanded into an
// intended dependency tree before any geometry exists. Each motif also has a
// signature that is checked against the solver's actual shortest solution, so
// a motif only counts if the real puzzle needs it.

import { FLOOR, SOLID } from './level.js';
import { MARIO } from './physics.js';

export const MOTIFS = {
  PortalTransfer: {
    description: 'Wall-to-wall portal connects two disconnected regions',
    estActions: 2,
    signature: (ctx) => ctx.metrics.wallToWall >= 1,
  },
  PhysicsTransition: {
    description: 'Floor-to-wall traversal switches a character into Mario mode',
    estActions: 3,
    signature: (ctx) => ctx.metrics.floorToWall >= 1,
  },
  PlatformAccess: {
    description: 'Mario movement reaches a platform Zelda mode can never stand on',
    estActions: 2,
    signature: (ctx) => usedPlatforms(ctx).some((p) => !platformHasFloor(ctx, p)),
  },
  ReturnTransition: {
    description: 'Wall-to-floor traversal restores Zelda movement',
    estActions: 2,
    signature: (ctx) => ctx.metrics.wallToFloor >= 1,
  },
  PortalRelay: {
    description: 'One player relocates their portal to enable the other',
    estActions: 2,
    signature: (ctx) => ctx.metrics.relays >= 1,
  },
  CooperativeHandoff: {
    description: 'A helps B, then B helps A',
    estActions: 3,
    signature: (ctx) => ctx.metrics.alternationDepth >= 3,
  },
  DualPurposeObstacle: {
    description: 'A solid block splits Zelda regions while supporting a used Mario platform',
    estActions: 1,
    signature: (ctx) => dualPurposeTiles(ctx).length > 0,
  },
};

function usedPlatforms(ctx) {
  const out = new Set();
  const { result } = ctx;
  result.states.forEach((s) => {
    if (s[0] === MARIO) out.add(s[1]);
    if (s[2] === MARIO) out.add(s[3]);
  });
  return [...out];
}

function platformHasFloor(ctx, pid) {
  const { level, analysis } = ctx;
  const p = analysis.mario.platforms[pid];
  for (let x = p.x0; x <= p.x1; x++) if (level.get(x, p.y) === FLOOR) return true;
  return false;
}

export function dualPurposeTiles(ctx) {
  const { level, analysis } = ctx;
  const label = analysis.zelda.label;
  const out = [];
  for (const pid of usedPlatforms(ctx)) {
    const p = analysis.mario.platforms[pid];
    for (let x = p.x0; x <= p.x1; x++) {
      const y = p.y + 1;
      if (level.get(x, y) !== SOLID || !level.inBounds(x, y)) continue;
      const regions = new Set();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (level.inBounds(nx, ny) && level.get(nx, ny) === FLOOR) regions.add(label[level.idx(nx, ny)]);
      }
      if (regions.size >= 2) out.push({ x, y });
    }
  }
  return out;
}

export function motifReport(motifs, ctx) {
  return motifs.map((m) => ({ motif: m, present: !!MOTIFS[m].signature(ctx) }));
}

// Expand targets into motifs and an intended dependency tree.
export function expandGrammar(targets, rng) {
  const motifs = ['PhysicsTransition'];
  if (targets.physicsSwitches >= 2) motifs.push('ReturnTransition');
  if (targets.coopDeps >= 1 || targets.portalRelocations >= 1) motifs.push('PortalRelay');
  if (targets.alternationDepth >= 3) motifs.push('CooperativeHandoff');
  if (rng.chance(0.75)) motifs.push('PlatformAccess');
  if (rng.chance(0.4)) motifs.push('DualPurposeObstacle');
  if (rng.chance(0.3)) motifs.push('PortalTransfer');

  const [first, second] = rng.chance(0.5) ? ['A', 'B'] : ['B', 'A'];
  const node = (label, children = []) => ({ label, children });
  const reach = node(`${first}_REACHES_PLATFORM`, [node('PLACE_PORTALS'), node('ENTER_MARIO')]);
  if (motifs.includes('PlatformAccess')) reach.children.push(node('JumpTo(PLATFORM)'));
  if (motifs.includes('DualPurposeObstacle')) reach.children.push(node('USE_OBSTACLE_AS_STEP'));
  const root = node('BOTH_REACH_EXIT', [reach]);
  if (motifs.includes('PortalRelay')) {
    root.children.push(node(`${first}_REPOSITIONS_PORTAL`));
    root.children.push(node(`${second}_REACHES_NEW_REGION`));
  }
  if (motifs.includes('CooperativeHandoff')) {
    root.children.push(node(`${second}_REPOSITIONS_PORTAL`));
    root.children.push(node(`${first}_REACHES_NEW_REGION`));
  }
  if (motifs.includes('ReturnTransition')) root.children.push(node('ENTER_ZELDA', [node('WALL_TO_FLOOR')]));
  if (motifs.includes('PortalTransfer')) root.children.push(node('WALL_TO_WALL_TRANSFER'));
  root.children.push(node('BOTH_REACH_EXIT'));

  const estActions = motifs.reduce((n, m) => n + MOTIFS[m].estActions, 0) + 2;
  return { motifs, tree: root, estActions };
}

export function treeToText(node, prefix = '', isLast = true, root = true) {
  let s = root ? `${node.label}\n` : `${prefix}+-- ${node.label}\n`;
  const childPrefix = root ? '' : prefix + (isLast ? '    ' : '|   ');
  node.children.forEach((c, i) => {
    s += treeToText(c, childPrefix, i === node.children.length - 1, false);
  });
  return s;
}

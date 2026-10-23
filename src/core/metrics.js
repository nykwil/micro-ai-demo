// Puzzle complexity metrics, all derived from the solver's actual shortest
// solution (never from the generator's intentions).

import { WALL } from './level.js';
import { MARIO } from './physics.js';
import { partner } from './portals.js';

// A move whose successful landing positions add up to this many variants
// (eighths of a tile, summed over every speed and jump-hold that works) is
// considered forgiving to execute.
const COMFORT_VARIANTS = 24;

export function computeMetrics(level, analysis, result, replay = null) {
  if (result.status !== 'solved') return { solved: false, status: result.status };
  const { actions, states, model } = result;
  const mario = analysis.mario;

  let relocations = 0;
  let placements = 0;
  let jumps = 0;
  let physicsSwitches = 0;
  const transitions = { floorToWall: 0, wallToFloor: 0, wallToWall: 0 };
  const tolerances = [];
  const kind = (sid) => (level.sockets[sid].type === WALL ? 'wall' : 'floor');
  const countTransition = (entry, exit) => {
    const k = `${kind(entry)}>${kind(exit)}`;
    if (k === 'floor>wall') transitions.floorToWall++;
    else if (k === 'wall>floor') transitions.wallToFloor++;
    else transitions.wallToWall++;
  };

  actions.forEach((a, i) => {
    const [p0, p1] = [states[i][4], states[i][5]];
    if (a.type === 'place') {
      placements++;
      if (a.relocation) relocations++;
    } else if (a.type === 'jump') {
      jumps++;
      tolerances.push(mario.edges[a.edge].variants / COMFORT_VARIANTS);
    } else {
      if (a.placed) {
        // Shooting the door behind you: a placement and an entry in one.
        placements++;
        if (a.relocation) relocations++;
      }
      countTransition(a.socket, a.exit);
      if (a.fromMode !== a.exitMode) physicsSwitches++;
      if (a.exitMode !== a.toMode) physicsSwitches++;
      if (a.via && a.via.kind === 'jump') {
        jumps++;
        tolerances.push(mario.edges[a.via.edge].variants / COMFORT_VARIANTS);
      }
      for (const step of a.chain || []) {
        const o = mario.launches[step.sid][step.launch];
        tolerances.push(o.variants / COMFORT_VARIANTS);
        if (step.via !== undefined) countTransition(step.via, partner(p0, p1, step.via));
      }
    }
  });

  // Dependency DAG between actions, used for parallel time and cooperation.
  const n = actions.length;
  const deps = actions.map(() => []);
  for (let j = 0; j < n; j++) {
    let prevSame = -1;
    for (let i = j - 1; i >= 0; i--) if (actions[i].c === actions[j].c) { prevSame = i; break; }
    if (prevSame >= 0) deps[j].push(prevSame);
    for (let i = 0; i < j; i++) {
      if (actions[i].c === actions[j].c) continue;
      const a = actions[i];
      const b = actions[j];
      if (a.type === 'place' && b.type === 'enter') deps[j].push(i); // needs the other's portal
      if (a.type === 'enter' && b.type === 'place') deps[j].push(i); // must not move it before it is used
    }
  }
  const finish = new Array(n).fill(0);
  const switches = new Array(n).fill(0);
  for (let j = 0; j < n; j++) {
    finish[j] = 1 + Math.max(0, ...deps[j].map((i) => finish[i]));
    switches[j] = Math.max(0, ...deps[j].map((i) => switches[i] + (actions[i].c !== actions[j].c ? 1 : 0)));
  }
  const parallelSteps = n ? Math.max(...finish) : 0;
  const alternationDepth = n ? 1 + Math.max(...switches) : 0;

  // Cooperative dependency: one character enters a portal right after the
  // other character (re)placed it, since its own previous action.
  let coopDeps = 0;
  let relays = 0;
  for (let j = 0; j < n; j++) {
    const b = actions[j];
    if (b.type !== 'enter') continue;
    let prevSame = -1;
    for (let i = j - 1; i >= 0; i--) if (actions[i].c === b.c) { prevSame = i; break; }
    for (let i = j - 1; i > prevSame; i--) {
      const a = actions[i];
      if (a.c !== b.c && a.type === 'place') {
        coopDeps++;
        if (a.relocation) relays++;
        break;
      }
    }
  }

  // Decision complexity: distinct successor states along the solution.
  let branching = 0;
  for (let i = 0; i < states.length - 1; i++) {
    branching += new Set(model.successors(states[i]).map((s) => s.state.join(','))).size;
  }

  const minTol = tolerances.length ? Math.min(1, ...tolerances) : 1;
  const difficulty = minTol >= 1 ? 'low' : minTol >= 1 / 3 ? 'medium' : 'high';

  return {
    solved: true,
    minActions: n,
    parallelSteps,
    portalPlacements: placements,
    portalRelocations: relocations,
    physicsSwitches,
    ...transitions,
    jumps,
    coopDeps,
    relays,
    alternationDepth,
    solutionDiversity: result.shortestCount,
    decisionComplexity: states.length > 1 ? +(branching / (states.length - 1)).toFixed(2) : 0,
    executionTolerance: +minTol.toFixed(2),
    executionDifficulty: difficulty,
    statesExplored: result.explored,
    replayFrames: replay ? replay.totalFrames : null,
    navigationFrames: replay ? replay.navFrames : null,
    replayOk: replay ? replay.ok : null,
    endsInMario: states.length ? [states[states.length - 1][0], states[states.length - 1][2]].filter((m) => m === MARIO).length : 0,
  };
}

export const DIFFICULTY_RANK = { low: 0, medium: 1, high: 2 };

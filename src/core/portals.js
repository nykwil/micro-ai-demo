// Portal rules shared by gameplay, analysis and the solver.
//
//   Wall  -> Wall   preserve movement mode
//   Floor -> Wall   switch to Mario mode (launched out of the wall)
//   Wall  -> Floor  switch to Zelda mode
//   Floor -> Floor  excluded: such a pair is inactive
//
// A Zelda-mode character can only come out of a wall portal onto a FLOOR
// access cell; otherwise that traversal is unavailable and the portal acts as
// a plain wall.

import { FLOOR, WALL } from './level.js';
import { PHYS, ZELDA, MARIO, bodyAtCell } from './physics.js';

export function pairActive(level, p0, p1) {
  if (p0 < 0 || p1 < 0) return false;
  return !(level.sockets[p0].type !== WALL && level.sockets[p1].type !== WALL);
}

export function partner(p0, p1, sid) {
  return sid === p0 ? p1 : sid === p1 ? p0 : -1;
}

// Cell of the active floor portal (a hole for Zelda walkers), or -1.
export function blockedCell(level, p0, p1) {
  if (!pairActive(level, p0, p1)) return -1;
  for (const sid of [p0, p1]) {
    const s = level.sockets[sid];
    if (s.type !== WALL) return level.idx(s.x, s.y);
  }
  return -1;
}

// Mode after travelling entry -> exit, or null if the traversal is not allowed.
export function transitionMode(level, entrySid, exitSid, entryMode) {
  const a = level.sockets[entrySid];
  const b = level.sockets[exitSid];
  const aWall = a.type === WALL;
  const bWall = b.type === WALL;
  if (!aWall && !bWall) return null;
  if (!aWall && entryMode !== ZELDA) return null;
  if (!aWall && bWall) return MARIO;
  if (aWall && !bWall) return ZELDA;
  if (entryMode === ZELDA) {
    const c = level.accessCell(b);
    if (level.get(c.x, c.y) !== FLOOR) return null;
  }
  return entryMode;
}

export function exitBody(level, exitSid, mode) {
  const s = level.sockets[exitSid];
  if (s.type !== WALL) return bodyAtCell(s.x, s.y, ZELDA);
  const c = level.accessCell(s);
  if (mode === ZELDA) return bodyAtCell(c.x, c.y, ZELDA);
  const b = bodyAtCell(c.x, c.y, MARIO);
  b.x = s.n > 0 ? s.x + 1 + 0.01 : s.x - PHYS.w - 0.01;
  b.vx = s.n * PHYS.launchSpeed;
  b.grounded = false;
  b.jumpWasDown = true;
  return b;
}

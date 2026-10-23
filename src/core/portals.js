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

import { FLOOR, SOLID, WALL } from './level.js';
import { PHYS, SUBX, ZELDA, MARIO, bodyAtCell } from './physics.js';

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
  const gap = PHYS.exitGap / SUBX;
  b.x = s.n > 0 ? s.x + 1 + gap : s.x - PHYS.w - gap;
  b.vx = (s.n * PHYS.launchSpeed) / SUBX;
  b.grounded = false;
  b.jumpWasDown = true;
  return b;
}

// ---------------------------------------------------------------------------
// Shooting. A shot travels in a straight cardinal line from the shooter's cell
// through open tiles (floor and pit) and stops at the first solid tile. It
// places the shooter's portal if the face it hits holds a wall socket. A shot
// "at the floor" targets a floor socket in the shooter's own cell.
// ---------------------------------------------------------------------------

export const SHOOT_FLOOR = 'floor';

// First solid tile along the ray from cell (x, y) in direction d.
export function traceShot(level, x, y, d) {
  let cx = x;
  let cy = y;
  for (let k = 0; k < level.width + level.height; k++) {
    cx += d.x;
    cy += d.y;
    if (level.get(cx, cy) === SOLID) return { x: cx, y: cy };
  }
  return { x: cx, y: cy };
}

// Socket hit by a shot from cell (x, y) in direction d (or SHOOT_FLOOR), or -1.
export function shotSocket(level, x, y, d) {
  if (d === SHOOT_FLOOR) {
    const sid = level.floorSocket.get(level.idx(x, y));
    return sid === undefined ? -1 : sid;
  }
  if (d.y !== 0) return -1; // wall sockets sit on left/right faces only
  const hit = traceShot(level, x, y, d);
  return level.socketAtFace(hit.x, hit.y, -d.x);
}

// Cells a wall socket can be shot from: the open cells in front of its face,
// out to the first solid tile. The shot direction is towards the face (-n).
export function shotLine(level, s) {
  const out = [];
  if (s.type !== WALL) return out;
  for (let x = s.x + s.n; level.inBounds(x, s.y) && level.get(x, s.y) !== SOLID; x += s.n) out.push({ x, y: s.y });
  return out;
}

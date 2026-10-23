// Gameplay physics. This single step function is used by the real-time game,
// by the reachability analyzer's trajectory simulation and by solution replay,
// so analysis and gameplay can never disagree about where a jump lands.
//
// Units are tiles and seconds; the step is a fixed 1/60 s.

import { SOLID, PIT } from './level.js';

export const ZELDA = 0;
export const MARIO = 1;

export const PHYS = Object.freeze({
  dt: 1 / 60,
  w: 0.75,
  h: 0.75,
  zeldaSpeed: 5,
  laneAssist: 0.5, // fraction of speed used to centre on the current lane in Zelda mode
  runSpeed: 5,
  groundAccel: 60,
  airAccel: 35,
  jumpVel: 10,
  gravity: 50,
  gravityHold: 18, // reduced gravity while the jump button is held (variable jump height)
  maxHoldFrames: 15,
  maxFall: 16,
  launchSpeed: 9, // horizontal speed when exiting a wall portal in Mario mode
});

const EPS = 1e-9;

export function makeBody(x, y, mode) {
  return { x, y, vx: 0, vy: 0, mode, grounded: false, holdLeft: 0, jumpWasDown: false };
}

// Body resting in a cell: centred for Zelda, standing on the cell's floor for Mario.
export function bodyAtCell(cx, cy, mode) {
  const x = cx + (1 - PHYS.w) / 2;
  const y = mode === MARIO ? cy + 1 - PHYS.h : cy + (1 - PHYS.h) / 2;
  const b = makeBody(x, y, mode);
  b.grounded = mode === MARIO;
  return b;
}

export function centerCell(b) {
  return { x: Math.floor(b.x + PHYS.w / 2), y: Math.floor(b.y + PHYS.h / 2) };
}

// Tracker records the bounding box of every tile a simulation consults, which
// lets the analyzer cache trajectories and re-run only those near an edit.
function track(tr, tx, ty) {
  if (!tr) return;
  if (tx < tr.x0) tr.x0 = tx;
  if (ty < tr.y0) tr.y0 = ty;
  if (tx > tr.x1) tr.x1 = tx;
  if (ty > tr.y1) tr.y1 = ty;
}

export function newTracker() {
  return { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
}

export function blocks(level, tx, ty, mode, tr) {
  track(tr, tx, ty);
  const t = level.get(tx, ty);
  return t === SOLID || (mode === ZELDA && t === PIT);
}

function approach(v, target, delta) {
  if (v < target) return Math.min(v + delta, target);
  if (v > target) return Math.max(v - delta, target);
  return v;
}

function moveX(level, b, dx, ev, tr) {
  if (dx === 0) return false;
  b.x += dx;
  const { w, h } = PHYS;
  const y0 = Math.floor(b.y + EPS);
  const y1 = Math.floor(b.y + h - EPS);
  const tx = dx > 0 ? Math.floor(b.x + w - EPS) : Math.floor(b.x + EPS);
  let hit = false;
  for (let ty = y0; ty <= y1; ty++) if (blocks(level, tx, ty, b.mode, tr)) hit = true;
  if (!hit) return false;
  b.x = dx > 0 ? tx - w : tx + 1;
  b.vx = 0;
  // A face counts as touched when the body's centre is level with it.
  const cy = Math.floor(b.y + h / 2);
  if (ev && level.get(tx, cy) === SOLID) ev.touch = { x: tx, y: cy, n: dx > 0 ? -1 : 1 };
  return true;
}

function moveY(level, b, dy, tr) {
  if (dy === 0) return false;
  b.y += dy;
  const { w, h } = PHYS;
  const x0 = Math.floor(b.x + EPS);
  const x1 = Math.floor(b.x + w - EPS);
  const ty = dy > 0 ? Math.floor(b.y + h - EPS) : Math.floor(b.y + EPS);
  let hit = false;
  for (let tx = x0; tx <= x1; tx++) if (blocks(level, tx, ty, b.mode, tr)) hit = true;
  if (!hit) return false;
  if (dy > 0) {
    b.y = ty - h;
    if (b.mode === MARIO) b.grounded = true;
  } else {
    b.y = ty + 1;
    b.holdLeft = 0;
  }
  b.vy = 0;
  return true;
}

function clamp1(v) {
  return v > 1 ? 1 : v < -1 ? -1 : v;
}

// input: { mx, my, jump } with mx/my in [-1, 1]. ev receives { touch } where
// touch is the solid face pushed against this step (or null).
export function stepBody(level, b, input, ev, tr) {
  const { dt } = PHYS;
  if (ev) ev.touch = null;
  const mx = clamp1(input.mx || 0);
  const my = clamp1(input.my || 0);

  if (b.mode === ZELDA) {
    // Four-directional: only the dominant axis moves.
    b.grounded = false;
    b.vy = 0;
    const speed = PHYS.zeldaSpeed;
    const assist = speed * PHYS.laneAssist * dt;
    if (Math.abs(mx) >= Math.abs(my) && mx !== 0) {
      b.vx = mx * speed;
      moveX(level, b, b.vx * dt, ev, tr);
      const target = Math.floor(b.y + PHYS.h / 2) + (1 - PHYS.h) / 2;
      moveY(level, b, approach(b.y, target, assist) - b.y, tr);
    } else if (my !== 0) {
      b.vx = 0;
      moveY(level, b, my * speed * dt, tr);
      const target = Math.floor(b.x + PHYS.w / 2) + (1 - PHYS.w) / 2;
      moveX(level, b, approach(b.x, target, assist) - b.x, null, tr);
    } else {
      b.vx = 0;
    }
    return;
  }

  // Mario mode.
  const target = mx * PHYS.runSpeed;
  if (b.grounded) {
    b.vx = approach(b.vx, target, PHYS.groundAccel * dt);
  } else if (mx !== 0) {
    // Keep portal-launch momentum unless steering against it.
    const keep = Math.sign(b.vx) === Math.sign(mx) && Math.abs(b.vx) > Math.abs(target);
    if (!keep) b.vx = approach(b.vx, target, PHYS.airAccel * dt);
  }

  const jumpDown = !!input.jump;
  if (jumpDown && !b.jumpWasDown && b.grounded) {
    b.vy = -PHYS.jumpVel;
    b.grounded = false;
    b.holdLeft = PHYS.maxHoldFrames;
  }
  b.jumpWasDown = jumpDown;

  if (b.vy < 0 && jumpDown && b.holdLeft > 0) {
    b.vy += PHYS.gravityHold * dt;
    b.holdLeft--;
  } else {
    if (!jumpDown) b.holdLeft = 0;
    b.vy += PHYS.gravity * dt;
  }
  if (b.vy > PHYS.maxFall) b.vy = PHYS.maxFall;

  moveX(level, b, b.vx * dt, ev, tr);
  b.grounded = false;
  moveY(level, b, b.vy * dt, tr);
}

// Cell a grounded Mario body is standing in (an open cell over a solid tile).
export function supportCell(level, b, tr) {
  const row = Math.round(b.y + PHYS.h) - 1;
  const x0 = Math.floor(b.x + EPS);
  const x1 = Math.floor(b.x + PHYS.w - EPS);
  const cx = Math.floor(b.x + PHYS.w / 2);
  let best = null;
  for (let x = x0; x <= x1; x++) {
    track(tr, x, row);
    track(tr, x, row + 1);
    if (level.get(x, row) !== SOLID && level.get(x, row + 1) === SOLID) {
      if (best === null || Math.abs(x - cx) < Math.abs(best - cx)) best = x;
    }
  }
  return best === null ? null : { x: best, y: row };
}

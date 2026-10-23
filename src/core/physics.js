// Gameplay physics. This single step function is used by the real-time game,
// by the reach-table builder and by solution replay, so analysis and gameplay
// can never disagree about where a jump lands.
//
// Exactness: positions are in tiles, but horizontally every position is a
// whole number of SUBX units (1/128 tile) and every speed a whole number of
// SUBX units per frame; vertically the same with SUBY (1/1024 tile). All
// arithmetic is therefore exact in double precision, which makes the physics
// exactly translation invariant by whole tiles, and lets the reachability
// analysis enumerate every horizontal speed (there are only a few dozen).
//
// The physics reads the level only through level.get(x, y).

import { SOLID, PIT } from './level.js';

export const ZELDA = 0;
export const MARIO = 1;

export const SUBX = 128; // horizontal sub-units per tile
export const SUBY = 1024; // vertical sub-units per tile

// Horizontal speeds/accelerations in SUBX units per frame (per frame), vertical
// ones in SUBY units.
export const PHYS = Object.freeze({
  dt: 1 / 60,
  w: 96 / SUBX, // body size in tiles (0.75)
  h: 768 / SUBY,
  zeldaSpeedX: 11, // ~5.2 tiles/s
  zeldaSpeedY: 88, // same speed vertically
  laneAssistX: 5, // per-frame nudge towards the lane centre while walking in Zelda mode
  laneAssistY: 40,
  runSpeed: 11, // ~5.2 tiles/s
  groundAccel: 2, // ~56 tiles/s^2
  airAccel: 1, // ~28 tiles/s^2
  launchSpeed: 19, // ~8.9 tiles/s, horizontal speed out of a wall portal in Mario mode
  exitGap: 1, // gap between a wall portal face and the body that comes out of it
  jumpVel: 171, // ~10 tiles/s
  gravity: 14, // ~49 tiles/s^2
  gravityHold: 5, // ~18 tiles/s^2 while the jump button is held (variable jump height)
  maxHoldFrames: 15,
  maxFall: 273, // ~16 tiles/s
});

const ux = (n) => n / SUBX;
const uy = (n) => n / SUBY;

// Analog stick values are quantised so the resulting speed is a whole number
// of sub-units per frame.
export function quantize(m, speed) {
  const v = m > 1 ? 1 : m < -1 ? -1 : m || 0;
  return Math.round(v * speed);
}

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

export function blocks(level, tx, ty, mode) {
  const t = level.get(tx, ty);
  return t === SOLID || (mode === ZELDA && t === PIT);
}

// Mario horizontal velocity update in SUBX units per frame. Exported so the
// reachability analysis uses exactly the same rule as the game.
export function marioVelocity(vx, mx, grounded) {
  const target = quantize(mx, PHYS.runSpeed);
  if (grounded) return approach(vx, target, PHYS.groundAccel);
  if (mx === 0) return vx;
  // Keep portal-launch momentum unless steering against it.
  const keep = Math.sign(vx) === Math.sign(mx) && Math.abs(vx) > Math.abs(target);
  return keep ? vx : approach(vx, target, PHYS.airAccel);
}

function approach(v, target, delta) {
  if (v < target) return Math.min(v + delta, target);
  if (v > target) return Math.max(v - delta, target);
  return v;
}

// Tile columns/rows overlapped by [a, a + size).
const first = (a) => Math.floor(a);
const last = (a, size) => Math.ceil(a + size) - 1;

function moveX(level, b, dx, ev) {
  if (dx === 0) return;
  b.x += dx;
  const { w, h } = PHYS;
  const y0 = first(b.y);
  const y1 = last(b.y, h);
  const tx = dx > 0 ? last(b.x, w) : first(b.x);
  let hit = false;
  for (let ty = y0; ty <= y1; ty++) if (blocks(level, tx, ty, b.mode)) hit = true;
  if (!hit) return;
  b.x = dx > 0 ? tx - w : tx + 1;
  b.vx = 0;
  if (!ev) return;
  ev.hitX = true;
  ev.airHitX = !b.grounded;
  // A face counts as touched when the body's centre is level with it.
  const cy = Math.floor(b.y + h / 2);
  if (level.get(tx, cy) === SOLID) ev.touch = { x: tx, y: cy, n: dx > 0 ? -1 : 1 };
}

function moveY(level, b, dy, ev) {
  if (dy === 0) return;
  b.y += dy;
  const { w, h } = PHYS;
  const x0 = first(b.x);
  const x1 = last(b.x, w);
  const ty = dy > 0 ? last(b.y, h) : first(b.y);
  let hit = false;
  for (let tx = x0; tx <= x1; tx++) if (blocks(level, tx, ty, b.mode)) hit = true;
  if (!hit) return;
  if (dy > 0) {
    b.y = ty - h;
    if (b.mode === MARIO) b.grounded = true;
  } else {
    b.y = ty + 1;
    b.holdLeft = 0;
    if (ev) ev.hitUp = true;
  }
  b.vy = 0;
}

// input: { mx, my, jump } with mx/my in [-1, 1].
// ev (optional) receives: touch (solid face pushed against, or null),
// hitX (any horizontal collision), airHitX (horizontal collision while not
// standing, including the frame of a jump), hitUp (head bump).
export function stepBody(level, b, input, ev) {
  if (ev) {
    ev.touch = null;
    ev.hitX = false;
    ev.airHitX = false;
    ev.hitUp = false;
  }
  const mx = input.mx || 0;
  const my = input.my || 0;

  if (b.mode === ZELDA) {
    // Four-directional: only the dominant axis moves.
    b.grounded = false;
    b.vy = 0;
    if (Math.abs(mx) >= Math.abs(my) && mx !== 0) {
      b.vx = ux(quantize(mx, PHYS.zeldaSpeedX));
      moveX(level, b, b.vx, ev);
      const target = Math.floor(b.y + PHYS.h / 2) + (1 - PHYS.h) / 2;
      moveY(level, b, approach(b.y, target, uy(PHYS.laneAssistY)) - b.y, null);
    } else if (my !== 0) {
      b.vx = 0;
      moveY(level, b, uy(quantize(my, PHYS.zeldaSpeedY)), null);
      const target = Math.floor(b.x + PHYS.w / 2) + (1 - PHYS.w) / 2;
      moveX(level, b, approach(b.x, target, ux(PHYS.laneAssistX)) - b.x, null);
    } else {
      b.vx = 0;
    }
    return;
  }

  // Mario mode.
  b.vx = ux(marioVelocity(Math.round(b.vx * SUBX), mx, b.grounded));

  const jumpDown = !!input.jump;
  if (jumpDown && !b.jumpWasDown && b.grounded) {
    b.vy = -uy(PHYS.jumpVel);
    b.grounded = false;
    b.holdLeft = PHYS.maxHoldFrames;
  }
  b.jumpWasDown = jumpDown;

  if (b.vy < 0 && jumpDown && b.holdLeft > 0) {
    b.vy += uy(PHYS.gravityHold);
    b.holdLeft--;
  } else {
    if (!jumpDown) b.holdLeft = 0;
    b.vy += uy(PHYS.gravity);
  }
  if (b.vy > uy(PHYS.maxFall)) b.vy = uy(PHYS.maxFall);

  moveX(level, b, b.vx, ev);
  b.grounded = false;
  moveY(level, b, b.vy, ev);
}

// Cell a grounded Mario body is standing in (an open cell over a solid tile).
export function supportCell(level, b) {
  const row = Math.round(b.y + PHYS.h) - 1;
  const x0 = first(b.x);
  const x1 = last(b.x, PHYS.w);
  const cx = Math.floor(b.x + PHYS.w / 2);
  let best = null;
  for (let x = x0; x <= x1; x++) {
    if (level.get(x, row) !== SOLID && level.get(x, row + 1) === SOLID) {
      if (best === null || Math.abs(x - cx) < Math.abs(best - cx)) best = x;
    }
  }
  return best === null ? null : { x: best, y: row };
}

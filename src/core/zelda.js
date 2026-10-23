// Zelda-mode reachability: 4-connected flood fill over FLOOR tiles.
//
// An active floor portal is a hole a walking character would fall into, so it
// is treated as blocked. Region labels are therefore computed per "blocked
// cell" configuration (at most one floor portal can be active at a time).

import { FLOOR } from './level.js';

export function zeldaRegions(level, blockedCell = -1) {
  const { width: W, height: H } = level;
  const label = new Int16Array(W * H).fill(-1);
  const regions = [];
  for (let start = 0; start < W * H; start++) {
    if (label[start] !== -1 || level.tiles[start] !== FLOOR || start === blockedCell) continue;
    const id = regions.length;
    const cells = [start];
    label[start] = id;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const x = c % W;
      const y = (c - x) / W;
      const nb = [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, y > 0 ? c - W : -1, y < H - 1 ? c + W : -1];
      for (const n of nb) {
        if (n < 0 || label[n] !== -1 || level.tiles[n] !== FLOOR || n === blockedCell) continue;
        label[n] = id;
        cells.push(n);
      }
    }
    regions.push(cells);
  }
  return { label, regions, blockedCell };
}

export function floorNeighbors(level, c) {
  const W = level.width;
  const x = c % W;
  const y = (c - x) / W;
  const out = [];
  if (x > 0) out.push(c - 1);
  if (x < W - 1) out.push(c + 1);
  if (y > 0) out.push(c - W);
  if (y < level.height - 1) out.push(c + W);
  return out.filter((n) => level.tiles[n] === FLOOR);
}

// Labels reachable by a character standing on `cell`. A character standing on
// the blocked cell (it placed or arrived on that portal) can still step off.
export function reachableLabels(level, regions, cell) {
  const set = new Set();
  const l = regions.label[cell];
  if (l >= 0) set.add(l);
  else if (cell === regions.blockedCell) {
    for (const n of floorNeighbors(level, cell)) if (regions.label[n] >= 0) set.add(regions.label[n]);
  }
  return set;
}

// Shortest walking path between floor cells (used by replay and metrics).
export function zeldaPath(level, from, to, blockedCell = -1) {
  if (from === to) return [from];
  const prev = new Int32Array(level.tiles.length).fill(-2);
  prev[from] = -1;
  const q = [from];
  for (let i = 0; i < q.length; i++) {
    const c = q[i];
    for (const n of floorNeighbors(level, c)) {
      if (prev[n] !== -2 || (n === blockedCell && n !== to)) continue;
      prev[n] = c;
      if (n === to) {
        const path = [to];
        let p = c;
        while (p !== -1) { path.push(p); p = prev[p]; }
        return path.reverse();
      }
      q.push(n);
    }
  }
  return null;
}

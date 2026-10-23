// Shared grid geometry. Both movement systems read the same tiles.
//
// Coordinates: x grows right, y grows down (towards the bottom of the screen,
// which is also the direction of Mario-mode gravity). Out-of-bounds is solid.
//
// Tile semantics:
//   FLOOR  walkable in Zelda mode, open air in Mario mode
//   SOLID  blocks both modes; its top edge is a Mario platform
//   PIT    blocks Zelda mode (a chasm), open air in Mario mode
//
// A PIT tile is what lets Mario mode reach places Zelda mode cannot. With only
// FLOOR and SOLID, Mario reachability is a strict subset of Zelda reachability
// (both are confined to the same open region, and Mario adds gravity).

export const FLOOR = 0;
export const SOLID = 1;
export const PIT = 2;

const TILE_CHARS = { '.': FLOOR, '#': SOLID, '~': PIT };
const CHAR_OF_TILE = ['.', '#', '~'];

// Socket types. Wall sockets live on the left/right face of a SOLID tile; the
// face normal `n` (-1 or +1) points into the open "access" cell. Floor sockets
// live on a FLOOR tile and are only usable in Zelda mode.
export const WALL = 'wall';
export const FLOOR_SOCKET = 'floor';

export class Level {
  constructor({ name = 'untitled', width, height, tiles, startA, startB, exits = [], sockets = [], hints = false }) {
    this.name = name;
    this.hints = !!hints; // tutorial level: show "you can shoot here" prompts
    this.width = width;
    this.height = height;
    this.tiles = tiles instanceof Uint8Array ? tiles : Uint8Array.from(tiles);
    this.startA = { ...startA };
    this.startB = { ...startB };
    this.exits = exits.map((e) => ({ x: e.x, y: e.y }));
    this.sockets = sockets.map((s) => (s.type === WALL ? { type: WALL, x: s.x, y: s.y, n: s.n } : { type: FLOOR_SOCKET, x: s.x, y: s.y }));
    this.rebuildIndex();
  }

  rebuildIndex() {
    this.faceSocket = new Map(); // faceKey -> socket id
    this.floorSocket = new Map(); // cell -> socket id
    this.sockets.forEach((s, i) => {
      if (s.type === WALL) this.faceSocket.set(this.faceKey(s.x, s.y, s.n), i);
      else this.floorSocket.set(this.idx(s.x, s.y), i);
    });
    this.exitCells = new Set(this.exits.map((e) => this.idx(e.x, e.y)));
  }

  idx(x, y) {
    return y * this.width + x;
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  get(x, y) {
    if (!this.inBounds(x, y)) return SOLID;
    return this.tiles[y * this.width + x];
  }

  set(x, y, t) {
    if (this.inBounds(x, y)) this.tiles[y * this.width + x] = t;
  }

  faceKey(x, y, n) {
    return (y * this.width + x) * 2 + (n > 0 ? 1 : 0);
  }

  socketAtFace(x, y, n) {
    const id = this.faceSocket.get(this.faceKey(x, y, n));
    return id === undefined ? -1 : id;
  }

  // Cell a character must occupy to place (or walk into) this socket.
  accessCell(s) {
    return s.type === WALL ? { x: s.x + s.n, y: s.y } : { x: s.x, y: s.y };
  }

  socketValid(s) {
    if (s.type === WALL) {
      if (this.get(s.x, s.y) !== SOLID || !this.inBounds(s.x, s.y)) return false;
      const a = this.accessCell(s);
      return this.inBounds(a.x, a.y) && this.get(a.x, a.y) !== SOLID;
    }
    return this.inBounds(s.x, s.y) && this.get(s.x, s.y) === FLOOR;
  }

  validate() {
    const errors = [];
    const floorAt = (p, what) => {
      if (!p || !this.inBounds(p.x, p.y) || this.get(p.x, p.y) !== FLOOR) errors.push(`${what} must be on a floor tile`);
    };
    floorAt(this.startA, 'Start A');
    floorAt(this.startB, 'Start B');
    if (this.exits.length === 0) errors.push('Level needs an exit');
    this.exits.forEach((e) => floorAt(e, 'Exit'));
    const seen = new Set();
    this.sockets.forEach((s, i) => {
      if (!this.socketValid(s)) errors.push(`Socket ${i} is not on a valid surface`);
      const k = socketKey(s);
      if (seen.has(k)) errors.push(`Socket ${i} duplicates another socket`);
      seen.add(k);
    });
    if (this.sockets.length < 2) errors.push('Level needs at least two portal sockets');
    return errors;
  }

  clone() {
    return Level.fromJSON(this.toJSON());
  }

  toJSON() {
    const rows = [];
    for (let y = 0; y < this.height; y++) {
      let r = '';
      for (let x = 0; x < this.width; x++) r += CHAR_OF_TILE[this.get(x, y)];
      rows.push(r);
    }
    return {
      name: this.name,
      hints: this.hints,
      width: this.width,
      height: this.height,
      tiles: rows,
      startA: { ...this.startA },
      startB: { ...this.startB },
      exits: this.exits.map((e) => ({ ...e })),
      sockets: this.sockets.map((s) => ({ ...s })),
    };
  }

  static fromJSON(obj) {
    const height = obj.tiles.length;
    const width = obj.tiles[0].length;
    const tiles = new Uint8Array(width * height);
    obj.tiles.forEach((row, y) => {
      for (let x = 0; x < width; x++) tiles[y * width + x] = TILE_CHARS[row[x]] ?? FLOOR;
    });
    return new Level({ ...obj, width, height, tiles });
  }

  // ASCII shorthand used by tests and hand-authored samples:
  //   # solid   . floor   ~ pit   A/B start   E exit   o floor socket
  //   [ solid with a socket on its left face   ] solid with a socket on its right face
  static fromAscii(rows, name = 'ascii') {
    const height = rows.length;
    const width = rows[0].length;
    const tiles = new Uint8Array(width * height);
    let startA = null;
    let startB = null;
    const exits = [];
    const sockets = [];
    for (let y = 0; y < height; y++) {
      if (rows[y].length !== width) throw new Error(`Row ${y} has length ${rows[y].length}, expected ${width}`);
      for (let x = 0; x < width; x++) {
        const c = rows[y][x];
        let t = FLOOR;
        if (c === '#') t = SOLID;
        else if (c === '~') t = PIT;
        else if (c === '[') { t = SOLID; sockets.push({ type: WALL, x, y, n: -1 }); }
        else if (c === ']') { t = SOLID; sockets.push({ type: WALL, x, y, n: 1 }); }
        else if (c === 'o') sockets.push({ type: FLOOR_SOCKET, x, y });
        else if (c === 'A') startA = { x, y };
        else if (c === 'B') startB = { x, y };
        else if (c === 'E') exits.push({ x, y });
        else if (c !== '.') throw new Error(`Unknown tile '${c}' at ${x},${y}`);
        tiles[y * width + x] = t;
      }
    }
    return new Level({ name, width, height, tiles, startA, startB, exits, sockets });
  }

  toAscii() {
    const grid = [];
    for (let y = 0; y < this.height; y++) {
      const row = [];
      for (let x = 0; x < this.width; x++) row.push(CHAR_OF_TILE[this.get(x, y)]);
      grid.push(row);
    }
    for (const s of this.sockets) {
      if (s.type === WALL) grid[s.y][s.x] = s.n < 0 ? '[' : ']';
      else grid[s.y][s.x] = 'o';
    }
    for (const e of this.exits) grid[e.y][e.x] = 'E';
    if (this.startA) grid[this.startA.y][this.startA.x] = 'A';
    if (this.startB) grid[this.startB.y][this.startB.x] = 'B';
    return grid.map((r) => r.join(''));
  }
}

export function socketKey(s) {
  return s.type === WALL ? `w${s.x},${s.y},${s.n}` : `f${s.x},${s.y}`;
}

// Changed cells between two same-sized levels (used for incremental analysis).
export function diffTiles(a, b) {
  if (!a || !b || a.width !== b.width || a.height !== b.height) return null;
  const changed = [];
  for (let i = 0; i < a.tiles.length; i++) if (a.tiles[i] !== b.tiles[i]) changed.push(i);
  return changed;
}

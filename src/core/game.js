// Real-time gameplay state: two characters, two portals, shared geometry.
// Used by the playable game and by solution replay.

import { FLOOR_SOCKET } from './level.js';
import { PHYS, ZELDA, MARIO, bodyAtCell, stepBody, centerCell, supportCell } from './physics.js';
import { pairActive, partner, transitionMode, exitBody } from './portals.js';

export class Game {
  constructor(level) {
    this.level = level;
    this.reset();
  }

  reset() {
    const L = this.level;
    this.chars = [L.startA, L.startB].map((p, i) => ({ id: i, body: bodyAtCell(p.x, p.y, ZELDA), touch: null }));
    this.portals = [-1, -1];
    this.frame = 0;
    this.won = false;
    this.events = [];
  }

  active() {
    return pairActive(this.level, this.portals[0], this.portals[1]);
  }

  // Socket the character is in position to place a portal on, or -1.
  placeableSocket(ci) {
    const L = this.level;
    const b = this.chars[ci].body;
    const cc = centerCell(b);
    if (b.mode === MARIO && !b.grounded) return -1;
    let best = -1;
    L.sockets.forEach((s, sid) => {
      if (best >= 0 || sid === this.portals[0] || sid === this.portals[1]) return;
      if (b.mode === MARIO && s.type === FLOOR_SOCKET) return;
      const a = L.accessCell(s);
      if (a.x === cc.x && a.y === cc.y) best = sid;
    });
    return best;
  }

  placePortal(ci, sid = this.placeableSocket(ci)) {
    if (sid < 0) return false;
    if (sid === this.portals[1 - ci]) return false;
    const L = this.level;
    const s = L.sockets[sid];
    const b = this.chars[ci].body;
    const cc = centerCell(b);
    const a = L.accessCell(s);
    if (a.x !== cc.x || a.y !== cc.y) return false;
    if (b.mode === MARIO && (s.type === FLOOR_SOCKET || !b.grounded)) return false;
    const relocation = this.portals[ci] >= 0;
    this.portals[ci] = sid;
    this.events.push({ frame: this.frame, type: 'place', c: ci, socket: sid, relocation });
    return true;
  }

  teleport(ci, entrySid) {
    const [p0, p1] = this.portals;
    const exit = partner(p0, p1, entrySid);
    const ch = this.chars[ci];
    const mode = transitionMode(this.level, entrySid, exit, ch.body.mode);
    if (mode === null) return false;
    const from = ch.body.mode;
    ch.body = exitBody(this.level, exit, mode);
    this.events.push({ frame: this.frame, type: 'teleport', c: ci, socket: entrySid, exit, fromMode: from, toMode: mode });
    return true;
  }

  // inputs: [{ mx, my, jump }, { mx, my, jump }]
  step(inputs) {
    const L = this.level;
    const ev = { touch: null };
    this.chars.forEach((ch, ci) => {
      const before = centerCell(ch.body);
      stepBody(L, ch.body, inputs[ci] || {}, ev);
      ch.touch = ev.touch;
      if (!this.active()) return;
      if (ev.touch) {
        const sid = L.socketAtFace(ev.touch.x, ev.touch.y, ev.touch.n);
        if (sid >= 0 && this.portals.includes(sid) && this.teleport(ci, sid)) return;
      }
      if (ch.body.mode === ZELDA) {
        const cc = centerCell(ch.body);
        if (cc.x !== before.x || cc.y !== before.y) {
          const sid = L.floorSocket.get(L.idx(cc.x, cc.y));
          if (sid !== undefined && this.portals.includes(sid)) this.teleport(ci, sid);
        }
      }
    });
    this.frame++;
    this.won = this.chars.every((ch) => this.atExit(ch));
  }

  atExit(ch) {
    const L = this.level;
    const b = ch.body;
    if (b.mode === MARIO) {
      if (!b.grounded) return false;
      const c = supportCell(L, b);
      return !!c && L.exitCells.has(L.idx(c.x, c.y));
    }
    const cc = centerCell(b);
    return L.exitCells.has(L.idx(cc.x, cc.y));
  }

  // Abstract location used to compare against solver states.
  abstractLoc(ci, platformOf) {
    const L = this.level;
    const b = this.chars[ci].body;
    if (b.mode === ZELDA) {
      const cc = centerCell(b);
      return { mode: ZELDA, loc: L.idx(cc.x, cc.y) };
    }
    const c = b.grounded ? supportCell(L, b) : null;
    return { mode: MARIO, loc: c ? platformOf[L.idx(c.x, c.y)] : -1 };
  }

  snapshot() {
    return {
      frame: this.frame,
      bodies: this.chars.map((c) => ({ x: c.body.x, y: c.body.y, mode: c.body.mode, grounded: c.body.grounded })),
      portals: this.portals.slice(),
    };
  }
}

export { PHYS };

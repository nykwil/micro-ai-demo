// Real-time gameplay state: two characters, two portals, shared geometry.
// Used by the playable game and by solution replay.

import { FLOOR_SOCKET, WALL } from './level.js';
import { PHYS, ZELDA, MARIO, bodyAtCell, stepBody, centerCell, supportCell } from './physics.js';
import { pairActive, partner, transitionMode, exitBody, traceShot, shotSocket, SHOOT_FLOOR } from './portals.js';

export class Game {
  constructor(level) {
    this.level = level;
    this.reset();
  }

  reset() {
    const L = this.level;
    // facing: last direction the player pushed (for drawing, and later aiming).
    this.chars = [L.startA, L.startB].map((p, i) => ({ id: i, body: bodyAtCell(p.x, p.y, ZELDA), touch: null, facing: { x: i === 0 ? 1 : -1, y: 0 } }));
    this.portals = [-1, -1];
    this.frame = 0;
    this.won = false;
    this.events = [];
  }

  active() {
    return pairActive(this.level, this.portals[0], this.portals[1]);
  }

  // Where a shot from this character would go. dir is a cardinal {x, y} or
  // SHOOT_FLOOR. Returns { sid, hit, reason }: sid is the socket the portal
  // would land on (or -1, with reason saying why), hit the tile the shot stops at.
  aimShot(ci, dir) {
    const L = this.level;
    const ch = this.chars[ci];
    const b = ch.body;
    const cc = centerCell(b);
    const res = { sid: -1, hit: null, reason: '' };
    if (b.mode === MARIO && !b.grounded) {
      res.reason = 'Land first: you can only shoot while standing.';
      return res;
    }
    if (dir === SHOOT_FLOOR) {
      res.hit = cc;
      if (b.mode === MARIO) {
        res.reason = 'Floor sockets only work in top-down mode.';
        return res;
      }
      res.sid = shotSocket(L, cc.x, cc.y, dir);
      if (res.sid < 0) res.reason = 'No floor socket under you.';
    } else {
      res.hit = traceShot(L, cc.x, cc.y, dir);
      res.sid = shotSocket(L, cc.x, cc.y, dir);
      if (res.sid < 0) res.reason = 'The shot hit a wall with no socket.';
    }
    if (res.sid >= 0 && res.sid === this.portals[1 - ci]) {
      res.reason = "That socket holds the other player's portal.";
      res.sid = -1;
    }
    return res;
  }

  // Fire a portal shot. Returns the aimShot result; the portal moves if sid >= 0.
  shoot(ci, dir) {
    const ch = this.chars[ci];
    if (dir !== SHOOT_FLOOR) ch.facing = { x: dir.x, y: dir.y };
    const r = this.aimShot(ci, dir);
    const cc = centerCell(ch.body);
    this.events.push({ frame: this.frame, type: 'shot', c: ci, from: cc, hit: r.hit, dir, socket: r.sid });
    if (r.sid < 0) return r;
    const relocation = this.portals[ci] >= 0;
    this.portals[ci] = r.sid;
    this.events.push({ frame: this.frame, type: 'place', c: ci, socket: r.sid, relocation });
    return r;
  }

  teleport(ci, entrySid) {
    const [p0, p1] = this.portals;
    const exit = partner(p0, p1, entrySid);
    const ch = this.chars[ci];
    const mode = transitionMode(this.level, entrySid, exit, ch.body.mode);
    if (mode === null) return false;
    const from = ch.body.mode;
    ch.body = exitBody(this.level, exit, mode);
    const out = this.level.sockets[exit];
    if (out.type === WALL) ch.facing = { x: out.n, y: 0 };
    this.events.push({ frame: this.frame, type: 'teleport', c: ci, socket: entrySid, exit, fromMode: from, toMode: mode });
    return true;
  }

  // inputs: [{ mx, my, jump }, { mx, my, jump }]
  step(inputs) {
    const L = this.level;
    const ev = { touch: null };
    this.chars.forEach((ch, ci) => {
      const before = centerCell(ch.body);
      const inp = inputs[ci] || {};
      const mx = inp.mx || 0;
      const my = inp.my || 0;
      if (ch.body.mode === MARIO) {
        if (mx) ch.facing = { x: Math.sign(mx), y: 0 };
      } else if (mx || my) {
        ch.facing = Math.abs(mx) >= Math.abs(my) ? { x: Math.sign(mx), y: 0 } : { x: 0, y: Math.sign(my) };
      }
      stepBody(L, ch.body, inp, ev);
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
      bodies: this.chars.map((c) => ({ x: c.body.x, y: c.body.y, mode: c.body.mode, grounded: c.body.grounded, facing: c.facing })),
      portals: this.portals.slice(),
    };
  }
}

export { PHYS };

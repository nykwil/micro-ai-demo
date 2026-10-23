// Canvas rendering of the shared grid plus debug overlays.

import { FLOOR, SOLID, PIT, WALL } from '../core/level.js';
import { PHYS, MARIO } from '../core/physics.js';
import { pairActive } from '../core/portals.js';

export const COLORS = {
  floor: '#d8c8a0',
  floorLine: '#c7b68c',
  pit: '#15131f',
  pitDot: '#2c2840',
  solid: '#3c4456',
  solidTop: '#9aa7c0',
  exit: '#3fbf6a',
  socket: '#e8e8f0',
  portal: ['#ff8a1f', '#2f8cff'],
  text: '#111',
};

function hue(i, a = 1) {
  return `hsla(${(i * 137.508) % 360}, 75%, 55%, ${a})`;
}

export function drawLevel(ctx, level, ts, opts = {}) {
  const { analysis, overlays = {}, portals = [-1, -1], bodies = null, selectedEdge = -1, hover = null, hints = [], flash = null } = opts;
  const W = level.width;
  const H = level.height;
  ctx.save();
  ctx.clearRect(0, 0, W * ts, H * ts);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = level.get(x, y);
      const px = x * ts;
      const py = y * ts;
      if (t === FLOOR) {
        ctx.fillStyle = COLORS.floor;
        ctx.fillRect(px, py, ts, ts);
        ctx.strokeStyle = COLORS.floorLine;
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 0.5, py + 0.5, ts - 1, ts - 1);
      } else if (t === PIT) {
        ctx.fillStyle = COLORS.pit;
        ctx.fillRect(px, py, ts, ts);
        ctx.fillStyle = COLORS.pitDot;
        for (const [dx, dy] of [[0.25, 0.3], [0.7, 0.2], [0.5, 0.7], [0.15, 0.8]]) ctx.fillRect(px + dx * ts, py + dy * ts, 2, 2);
      } else {
        ctx.fillStyle = COLORS.solid;
        ctx.fillRect(px, py, ts, ts);
        if (level.get(x, y - 1) !== SOLID && y > 0) {
          ctx.fillStyle = COLORS.solidTop;
          ctx.fillRect(px, py, ts, Math.max(2, ts * 0.08));
        }
      }
    }
  }

  for (const e of level.exits) {
    const px = e.x * ts;
    const py = e.y * ts;
    ctx.fillStyle = 'rgba(63,191,106,0.55)';
    ctx.fillRect(px + 2, py + 2, ts - 4, ts - 4);
    ctx.strokeStyle = '#1f7a3e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px + ts * 0.35, py + ts * 0.85);
    ctx.lineTo(px + ts * 0.35, py + ts * 0.18);
    ctx.stroke();
    ctx.fillStyle = '#1f7a3e';
    ctx.beginPath();
    ctx.moveTo(px + ts * 0.37, py + ts * 0.18);
    ctx.lineTo(px + ts * 0.75, py + ts * 0.3);
    ctx.lineTo(px + ts * 0.37, py + ts * 0.45);
    ctx.fill();
  }

  if (analysis && overlays.regions) {
    const { label } = analysis.zelda;
    for (let c = 0; c < label.length; c++) {
      if (label[c] < 0) continue;
      ctx.fillStyle = hue(label[c], 0.28);
      ctx.fillRect((c % W) * ts, Math.floor(c / W) * ts, ts, ts);
    }
  }

  if (analysis && overlays.platforms) {
    const { platforms } = analysis.mario;
    ctx.font = `${Math.max(9, ts * 0.3)}px sans-serif`;
    for (const p of platforms) {
      ctx.strokeStyle = hue(p.id);
      ctx.lineWidth = Math.max(3, ts * 0.12);
      ctx.beginPath();
      ctx.moveTo(p.x0 * ts + 2, (p.y + 1) * ts - 2);
      ctx.lineTo((p.x1 + 1) * ts - 2, (p.y + 1) * ts - 2);
      ctx.stroke();
      ctx.fillStyle = hue(p.id);
      ctx.fillText(String(p.id), p.x0 * ts + 3, (p.y + 1) * ts - ts * 0.12 - 3);
    }
  }

  const drawPath = (path, color, width, dash = []) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.beginPath();
    path.forEach(([x, y], i) => (i ? ctx.lineTo(x * ts, y * ts) : ctx.moveTo(x * ts, y * ts)));
    ctx.stroke();
    ctx.setLineDash([]);
    const [ex, ey] = path[path.length - 1];
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(ex * ts, ey * ts, Math.max(2, ts * 0.08), 0, Math.PI * 2);
    ctx.fill();
  };

  // Each connection is drawn with one concrete way to perform it (its witness).
  if (analysis && overlays.jumps) {
    for (const e of analysis.mario.edges) {
      if (e.from === e.to || e.id === selectedEdge) continue;
      drawPath(analysis.mario.witness(e).path, hue(e.from, 0.55), 1.5, e.to < 0 ? [2, 3] : []);
    }
  }
  if (analysis && overlays.launches) {
    analysis.mario.launches.forEach((outs) => outs.forEach((o) => drawPath(analysis.mario.witness(o).path, 'rgba(255,255,255,0.6)', 1.5, [4, 3])));
  }
  if (analysis && selectedEdge >= 0 && analysis.mario.edges[selectedEdge]) {
    const e = analysis.mario.edges[selectedEdge];
    const w = analysis.mario.witness(e);
    const p = analysis.mario.platforms[e.from];
    ctx.fillStyle = 'rgba(255,225,77,0.6)';
    ctx.fillRect(w.startX * ts, (p.y + 1) * ts - 5, PHYS.w * ts, 5);
    drawPath(w.path, '#ffe14d', 3);
  }

  // Sockets (faint outlines) and placed portals (solid, in the owner's colour).
  const active = pairActive(level, portals[0], portals[1]);
  level.sockets.forEach((s, sid) => {
    const owner = portals[0] === sid ? 0 : portals[1] === sid ? 1 : -1;
    const color = owner >= 0 ? COLORS.portal[owner] : COLORS.socket;
    ctx.save();
    if (s.type === WALL) {
      const fx = (s.n > 0 ? s.x + 1 : s.x) * ts;
      if (owner < 0) {
        const th = Math.max(3, ts * 0.1);
        ctx.strokeStyle = 'rgba(232,232,240,0.7)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(s.n > 0 ? fx - th : fx, s.y * ts + ts * 0.12, th, ts * 0.76);
      } else {
        // A portal is an upright oval on the wall face, opening towards the access cell.
        const cx = fx + s.n * ts * 0.06;
        const cy = (s.y + 0.5) * ts;
        if (active) {
          ctx.shadowColor = color;
          ctx.shadowBlur = ts * 0.4;
        }
        // Placed but not yet connected: solid colour, no glow, slightly faded.
        ctx.fillStyle = color;
        ctx.globalAlpha = active ? 1 : 0.7;
        ctx.strokeStyle = active ? color : '#111';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(cx, cy, ts * 0.16, ts * 0.46, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.globalAlpha = 1;
        if (active) {
          ctx.shadowBlur = 0;
          ctx.fillStyle = 'rgba(255,255,255,0.55)';
          ctx.beginPath();
          ctx.ellipse(cx, cy, ts * 0.06, ts * 0.3, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else {
      const cx = (s.x + 0.5) * ts;
      const cy = (s.y + 0.5) * ts;
      if (owner < 0) {
        ctx.strokeStyle = 'rgba(232,232,240,0.7)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.ellipse(cx, cy, ts * 0.36, ts * 0.28, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        // A floor portal is a hole in the floor ringed in the owner's colour.
        if (active) {
          ctx.shadowColor = color;
          ctx.shadowBlur = ts * 0.4;
        }
        // Placed but not yet connected: solid colour, no glow, slightly faded.
        ctx.fillStyle = color;
        ctx.globalAlpha = active ? 1 : 0.7;
        ctx.strokeStyle = active ? color : '#111';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(cx, cy, ts * 0.42, ts * 0.34, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.globalAlpha = 1;
        if (active) {
          ctx.shadowBlur = 0;
          ctx.fillStyle = '#0b0b14';
          ctx.beginPath();
          ctx.ellipse(cx, cy, ts * 0.26, ts * 0.2, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();
    if (overlays.ids) {
      ctx.fillStyle = '#fff';
      ctx.font = `${Math.max(9, ts * 0.28)}px sans-serif`;
      const a = level.accessCell(s);
      ctx.fillText(`s${sid}`, a.x * ts + 2, a.y * ts + ts * 0.3);
    }
  });

  // "You can place a portal here" prompts: pulse the socket in the player's colour.
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 150);
  for (const { sid, c, key } of hints) {
    const sk = level.sockets[sid];
    const a = level.accessCell(sk);
    ctx.strokeStyle = COLORS.portal[c];
    ctx.lineWidth = 2 + 2 * pulse;
    if (sk.type === WALL) {
      const fx = (sk.n > 0 ? sk.x + 1 : sk.x) * ts;
      ctx.strokeRect(fx - ts * 0.15, sk.y * ts + 2, ts * 0.3, ts - 4);
    } else {
      ctx.beginPath();
      ctx.ellipse((sk.x + 0.5) * ts, (sk.y + 0.5) * ts, ts * 0.45, ts * 0.38, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.font = `bold ${Math.max(10, ts * 0.3)}px sans-serif`;
    const label = `[${key}]`;
    const tw = ctx.measureText(label).width;
    const lx = (a.x + 0.5) * ts - tw / 2;
    const ly = a.y * ts - 4;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(lx - 3, ly - ts * 0.3, tw + 6, ts * 0.36);
    ctx.fillStyle = COLORS.portal[c];
    ctx.fillText(label, lx, ly);
  }

  // Start markers when no bodies are shown.
  const starts = [level.startA, level.startB];
  if (!bodies) {
    starts.forEach((p, i) => {
      if (!p) return;
      ctx.strokeStyle = COLORS.portal[i];
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 2]);
      ctx.strokeRect(p.x * ts + ts * 0.15, p.y * ts + ts * 0.15, ts * 0.7, ts * 0.7);
      ctx.setLineDash([]);
      ctx.fillStyle = COLORS.portal[i];
      ctx.font = `bold ${Math.max(10, ts * 0.4)}px sans-serif`;
      ctx.fillText('AB'[i], p.x * ts + ts * 0.36, p.y * ts + ts * 0.64);
    });
  } else {
    bodies.forEach((b, i) => drawBody(ctx, b, i, ts));
  }

  // Message above a player after pressing the place key.
  if (flash && bodies) {
    const b = bodies[flash.c];
    ctx.font = `${Math.max(11, ts * 0.28)}px sans-serif`;
    const w = ctx.measureText(flash.text).width;
    const x = Math.max(4, Math.min(level.width * ts - w - 4, (b.x + PHYS.w / 2) * ts - w / 2));
    const y = Math.max(ts * 0.4, b.y * ts - 8);
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(x - 4, y - ts * 0.3, w + 8, ts * 0.4);
    ctx.fillStyle = flash.ok ? '#9fe6b6' : '#ffd27a';
    ctx.fillText(flash.text, x, y);
  }

  if (hover) {
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 2;
    ctx.strokeRect(hover.x * ts + 1, hover.y * ts + 1, ts - 2, ts - 2);
  }
  ctx.restore();
}

export function drawBody(ctx, b, i, ts) {
  const x = b.x * ts;
  const y = b.y * ts;
  const w = PHYS.w * ts;
  const h = PHYS.h * ts;
  const HEAD = '#f1d2b0';
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 2;
  ctx.font = `bold ${Math.max(8, ts * 0.24)}px sans-serif`;
  if (b.mode === MARIO) {
    // Side view (XY): head on top, body below, feet on the ground.
    const r = w * 0.24;
    const bodyTop = y + r * 1.6;
    ctx.fillStyle = COLORS.portal[i];
    ctx.fillRect(x + w * 0.12, bodyTop, w * 0.76, y + h - bodyTop);
    ctx.strokeRect(x + w * 0.12, bodyTop, w * 0.76, y + h - bodyTop);
    ctx.fillStyle = '#111';
    ctx.fillRect(x + w * 0.12, y + h - 3, w * 0.76, 3);
    ctx.fillStyle = HEAD;
    ctx.beginPath();
    ctx.arc(x + w / 2, y + r, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#111';
    ctx.fillText('AB'[i], x + w / 2 - ts * 0.07, y + h - ts * 0.1);
  } else {
    // Top-down view (XZ): shoulders seen from above with the head in the middle.
    ctx.fillStyle = COLORS.portal[i];
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = HEAD;
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h / 2, w * 0.26, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#111';
    ctx.fillText('AB'[i], x + w / 2 - ts * 0.07, y + h / 2 + ts * 0.08);
  }
  // Facing direction: a triangle just outside the body.
  if (b.facing) {
    const { x: fx, y: fy } = b.facing;
    const cx = x + w / 2 + fx * (w / 2 + ts * 0.06);
    const cy = y + h / 2 + fy * (h / 2 + ts * 0.06);
    const s = ts * 0.14;
    ctx.fillStyle = COLORS.portal[i];
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx + fx * s, cy + fy * s);
    ctx.lineTo(cx - fy * s - fx * s * 0.2, cy + fx * s - fy * s * 0.2);
    ctx.lineTo(cx + fy * s - fx * s * 0.2, cy - fx * s - fy * s * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

// Approximate body for a solver state (for stepping through a solution).
export function bodyForState(level, analysis, mode, loc) {
  if (mode === MARIO) {
    const p = analysis.mario.platforms[loc];
    const x = Math.floor((p.x0 + p.x1) / 2);
    return { x: x + (1 - PHYS.w) / 2, y: p.y + 1 - PHYS.h, mode };
  }
  return { x: (loc % level.width) + (1 - PHYS.w) / 2, y: Math.floor(loc / level.width) + (1 - PHYS.h) / 2, mode };
}

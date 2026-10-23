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
  const { analysis, overlays = {}, portals = [-1, -1], bodies = null, selectedEdge = -1, hover = null } = opts;
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

  if (analysis && overlays.jumps) {
    for (const e of analysis.mario.edges) {
      if (e.from === e.to || e.id === selectedEdge) continue;
      drawPath(e.path, hue(e.from, 0.55), 1.5);
    }
  }
  if (analysis && overlays.launches) {
    analysis.mario.launches.forEach((outs) => outs.forEach((o) => drawPath(o.path, 'rgba(255,255,255,0.6)', 1.5, [4, 3])));
  }
  if (analysis && selectedEdge >= 0 && analysis.mario.edges[selectedEdge]) {
    const e = analysis.mario.edges[selectedEdge];
    ctx.fillStyle = 'rgba(255,255,0,0.35)';
    const p = analysis.mario.platforms[e.from];
    ctx.fillRect(e.takeoffRange[0] * ts, (p.y + 1) * ts - 4, (e.takeoffRange[1] - e.takeoffRange[0]) * ts, 4);
    drawPath(e.path, '#ffe14d', 3);
  }

  // Sockets and portals.
  const active = pairActive(level, portals[0], portals[1]);
  level.sockets.forEach((s, sid) => {
    const owner = portals[0] === sid ? 0 : portals[1] === sid ? 1 : -1;
    const color = owner >= 0 ? COLORS.portal[owner] : COLORS.socket;
    if (s.type === WALL) {
      const fx = (s.n > 0 ? s.x + 1 : s.x) * ts;
      const th = Math.max(4, ts * 0.16);
      ctx.fillStyle = owner >= 0 ? color : 'rgba(232,232,240,0.35)';
      ctx.fillRect(s.n > 0 ? fx - th : fx, s.y * ts + ts * 0.1, th, ts * 0.8);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      if (owner >= 0 && !active) ctx.setLineDash([3, 3]);
      ctx.strokeRect(s.n > 0 ? fx - th : fx, s.y * ts + ts * 0.1, th, ts * 0.8);
      ctx.setLineDash([]);
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = owner >= 0 ? 3 : 2;
      if (owner >= 0 && !active) ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.ellipse((s.x + 0.5) * ts, (s.y + 0.5) * ts, ts * 0.36, ts * 0.3, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      if (owner >= 0) {
        ctx.fillStyle = active ? color : 'rgba(0,0,0,0.25)';
        ctx.globalAlpha = 0.45;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    if (overlays.ids) {
      ctx.fillStyle = '#fff';
      ctx.font = `${Math.max(9, ts * 0.28)}px sans-serif`;
      const a = level.accessCell(s);
      ctx.fillText(`s${sid}`, a.x * ts + 2, a.y * ts + ts * 0.3);
    }
  });

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
  ctx.fillStyle = COLORS.portal[i];
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 2;
  if (b.mode === MARIO) {
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = '#111';
    ctx.fillRect(x, y + h - 3, w, 3); // feet: gravity points down
  } else {
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = '#111';
  ctx.font = `bold ${Math.max(9, ts * 0.32)}px sans-serif`;
  ctx.fillText('AB'[i], x + w * 0.3, y + h * 0.68);
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

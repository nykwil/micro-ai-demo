// Keyboard and gamepad input for the two characters.
//
// Keyboard:  A = WASD (W jumps in Mario mode), E places portal
//            B = arrow keys (Up jumps in Mario mode), Enter or / places portal
// Gamepad:   one pad  -> left stick = A, right stick = B, LB/RB place, LT/RT jump
//            two pads -> each pad's left stick, A button jumps, X places

const keys = new Set();
const pressed = new Set();

export function initInput(target = window) {
  target.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
    if (!keys.has(e.code)) pressed.add(e.code);
    keys.add(e.code);
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  });
  target.addEventListener('keyup', (e) => keys.delete(e.code));
  target.addEventListener('blur', () => keys.clear());
}

const DEAD = 0.3;
const dz = (v) => (Math.abs(v) < DEAD ? 0 : v);

function axisInput(x, y, jumpBtn) {
  // Up doubles as jump so the same stick drives both modes.
  return { mx: dz(x), my: dz(y), jump: y < -0.5 || !!jumpBtn };
}

export function readInputs() {
  const k = (c) => keys.has(c);
  const kb = [
    axisInput((k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0), (k('KeyS') ? 1 : 0) - (k('KeyW') ? 1 : 0), k('Space')),
    axisInput((k('ArrowRight') ? 1 : 0) - (k('ArrowLeft') ? 1 : 0), (k('ArrowDown') ? 1 : 0) - (k('ArrowUp') ? 1 : 0), false),
  ];
  const place = [pressed.has('KeyE') || pressed.has('KeyQ'), pressed.has('Enter') || pressed.has('Slash') || pressed.has('Numpad0')];
  pressed.clear();

  const pads = (navigator.getGamepads ? [...navigator.getGamepads()] : []).filter(Boolean);
  if (pads.length === 1) {
    const p = pads[0];
    const btn = (i) => p.buttons[i] && p.buttons[i].pressed;
    const a = axisInput(p.axes[0], p.axes[1], btn(6));
    const b = axisInput(p.axes[2] ?? 0, p.axes[3] ?? 0, btn(7));
    merge(kb[0], a);
    merge(kb[1], b);
    place[0] = place[0] || edge('p0l', btn(4));
    place[1] = place[1] || edge('p0r', btn(5));
  } else if (pads.length >= 2) {
    pads.slice(0, 2).forEach((p, i) => {
      const btn = (j) => p.buttons[j] && p.buttons[j].pressed;
      merge(kb[i], axisInput(p.axes[0], p.axes[1], btn(0)));
      place[i] = place[i] || edge(`p${i}x`, btn(2));
    });
  }
  return { moves: kb, place };
}

function merge(into, from) {
  if (from.mx) into.mx = from.mx;
  if (from.my) into.my = from.my;
  into.jump = into.jump || from.jump;
}

const prevBtn = new Map();
function edge(id, down) {
  const was = prevBtn.get(id) || false;
  prevBtn.set(id, !!down);
  return !!down && !was;
}

// Keyboard and gamepad input for the two characters.
//
// Each player has two buttons, shoot and jump. Jump only does something in
// Mario mode for now (it is free for a top-down action later). Up does not
// jump: in Mario mode it goes through a door.
// Keyboard:  A = WASD, Space jumps, E shoots
//            B = arrow keys, Right Shift jumps, Enter or / shoots
// Gamepad:   one pad  -> left stick = A, right stick = B, LB/RB shoot, LT/RT jump
//            two pads -> each pad's left stick, A button jumps, X shoots
// The shoot button is reported as held; shots fire on release (see main.js).

const keys = new Set();
const pressed = new Set();

export function initInput(target = window) {
  target.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    // Game keys belong to the game, not to a button or list that still has focus
    // (Enter would re-click it, arrows would change a list).
    const t = e.target && e.target.tagName;
    if ((t === 'BUTTON' || t === 'SELECT') && /^(Arrow|Enter|Space|Slash|Key[WASDEQ])/.test(e.code)) {
      e.preventDefault();
      e.target.blur();
    }
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
  return { mx: dz(x), my: dz(y), jump: !!jumpBtn };
}

export function readInputs() {
  const k = (c) => keys.has(c);
  const kb = [
    axisInput((k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0), (k('KeyS') ? 1 : 0) - (k('KeyW') ? 1 : 0), k('Space')),
    axisInput((k('ArrowRight') ? 1 : 0) - (k('ArrowLeft') ? 1 : 0), (k('ArrowDown') ? 1 : 0) - (k('ArrowUp') ? 1 : 0), k('ShiftRight')),
  ];
  // A key pressed and released between two reads still counts as held once,
  // so a very quick tap is never lost.
  const held = (...codes) => codes.some((c) => keys.has(c) || pressed.has(c));
  const shoot = [held('KeyE', 'KeyQ'), held('Enter', 'Slash', 'Numpad0')];
  pressed.clear();

  const pads = (navigator.getGamepads ? [...navigator.getGamepads()] : []).filter(Boolean);
  if (pads.length === 1) {
    const p = pads[0];
    const btn = (i) => p.buttons[i] && p.buttons[i].pressed;
    const a = axisInput(p.axes[0], p.axes[1], btn(6));
    const b = axisInput(p.axes[2] ?? 0, p.axes[3] ?? 0, btn(7));
    merge(kb[0], a);
    merge(kb[1], b);
    shoot[0] = shoot[0] || !!btn(4);
    shoot[1] = shoot[1] || !!btn(5);
  } else if (pads.length >= 2) {
    pads.slice(0, 2).forEach((p, i) => {
      const btn = (j) => p.buttons[j] && p.buttons[j].pressed;
      merge(kb[i], axisInput(p.axes[0], p.axes[1], btn(0)));
      shoot[i] = shoot[i] || !!btn(2);
    });
  }
  return { moves: kb, shoot };
}

function merge(into, from) {
  if (from.mx) into.mx = from.mx;
  if (from.my) into.my = from.my;
  into.jump = into.jump || from.jump;
}

// Hand-authored sample levels (ASCII shorthand, see Level.fromAscii).
//   # solid  . floor  ~ pit  A/B start  E exit  o floor socket
//   [ solid with socket on its left face   ] solid with socket on its right face

export const SAMPLES = [
  {
    name: 'First Fall',
    note: 'Floor → wall drops a character into Mario mode; gravity carries them past the pits.',
    rows: [
      '############',
      '#..........#',
      '#.A......B.#',
      ']..o.......#',
      '#..........#',
      '#~~~~~~~~~~#',
      '#..........#',
      '#..........#',
      '#..........#',
      '#..........#',
      '].........E#',
      '############',
    ],
  },
  {
    name: 'Pillar Steps',
    note: 'The exit sits on a pillar in a pit field: only Mario jumps reach it.',
    rows: [
      '############',
      '#..........#',
      '#.A......B.#',
      ']..o.......#',
      '#..........#',
      '#~~~~~~~~~~#',
      '#~~~~~~~~~~#',
      '#~~~~~~~E~~#',
      '#~~~~~~~#~~#',
      '#~~~~~#~#~~#',
      ']~~~~~#~#~~#',
      '############',
    ],
  },
  {
    name: 'Relay Climb (generated)',
    note: 'Generated (seed 7, candidate 2). A drops through the floor portal and comes out of the top-right wall in Mario mode, hops down the ledges, then both players relocate so A can return to the top as Zelda.',
    rows: [
      '############',
      '#..E......B#',
      '#.......o#.[',
      '#~.~~~~~~#~#',
      '#~~~~~~~~~##',
      '#~~~~~~~~~~#',
      '#~~~...~~~~#',
      '#~~~.~#~~~##',
      '#~~~.~#~~~##',
      '#A.~~~#~~~##',
      '#o.~~~]~~~##',
      '############',
    ],
  },
];

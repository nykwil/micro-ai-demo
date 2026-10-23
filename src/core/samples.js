// Hand-authored sample levels (ASCII shorthand, see Level.fromAscii).
//   # solid  . floor  ~ pit  A/B start  E exit  o floor socket
//   [ solid with socket on its left face   ] solid with socket on its right face

export const SAMPLES = [
  {
    name: 'Tutorial: First Fall',
    note: 'Tutorial. Shoot the wall and the floor socket, step into the floor portal: you come out of the wall in platformer mode and gravity carries you past the pits.',
    hints: true,
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
      '#~~~~~~~####',
      '#~~~~~#~####',
      ']~~~~~#~####',
      '############',
    ],
  },
  {
    name: 'Relay Drop (generated)',
    note: 'Generated (seed 7, candidate 1) with no fail conditions. A goes through to platformer mode, works its way down to the bottom-left, then moves its portal to the wall there so B can follow.',
    rows: [
      '############',
      '#...~~...o.[',
      '#........o##',
      '#......#BA##',
      '#~~~~..#..##',
      '##~~##~~#~##',
      '##~~##~~.###',
      '#~~~~~~~~###',
      '#~~.~~~~~~##',
      '#]..~~~~~~##',
      '##E.~#######',
      '############',
    ],
  },
];

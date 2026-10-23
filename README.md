# Dual-Mode Portal Lab

A design tool and playable prototype for a cooperative two-character portal puzzle game with two movement systems on the same grid:

- **Zelda mode**: top-down, four-directional, walls block walking.
- **Mario mode**: side-on platforming, gravity pulls to the bottom of the screen, and the top edges of solid tiles are platforms.

Each character owns one portal endpoint. Floor → wall switches to Mario, wall → floor switches to Zelda, and wall → wall keeps the current mode. Floor → floor is excluded. Both characters must reach the exit.

The tool generates levels from a puzzle grammar, works out real reachability in both movement modes, solves for both characters, and replays the solution through the gameplay physics to verify it.

## Running

Plain JavaScript with Vite; no other runtime dependencies. These commands work the same in Windows `cmd`/PowerShell and in bash.

```
npm install
npm run dev          # http://localhost:5000
npm test             # 16 required tests + extras (node:test)
npm run generate -- 1 4 800 out   # seed, count, iterations, optional output folder
npm run build        # static build in dist/
```

## The tool

| Tab | What it does |
| --- | --- |
| **Edit** | Paint floor / solid / pit, exits, starts and sockets. Every edit re-runs analysis and the solver and prints a geometry-change report (regions, platforms, jump connections, shortest solution, shortcut warning). Overlays show Zelda regions, Mario platforms, jump connections and portal launches; each connection is drawn as one concrete way to perform it (click one in the list to highlight it and its takeoff spot). Supports undo, JSON export/import and ASCII copy. |
| **Solve** | Shortest solution for both characters, complexity metrics, step-through of solver states, **Replay with physics** (runs the solution through the real game loop with scripted controllers), and **Find shortcut fix**. |
| **Play** | Real-time game. A: WASD (W/Space jumps), E places portal. B: arrows (Up jumps), Enter or `/` places portal. One gamepad: left stick = A, right stick = B. Two gamepads: one each. |
| **Generate** | Set complexity targets, generate candidates in a Web Worker, filter/sort them, and load one to inspect its intended grammar tree next to the actual solution. |

## Architecture (`src/core`, no DOM dependencies)

| Module | Plan section |
| --- | --- |
| `level.js` | Shared geometry, sockets, JSON/ASCII formats |
| `physics.js` | One fixed-step, integer-exact body update used by gameplay, analysis and replay (§5.5) |
| `portals.js` | Transition rules, exit placement, launch velocity |
| `zelda.js` | Flood-fill regions per floor-portal configuration (§4.1) |
| `reach.js` | Exact Mario reachability for any controller input, witnesses, reference simulation (§4.2, §5, §6) |
| `mario.js` | Platforms, platform graph for the solver, incremental cache |
| `analysis.js` | Combined analysis, summary, geometry-change report (§12) |
| `solver.js` | Two-character BFS over `[mode, loc]×2 + portals`; solved / unsolvable / timeout (§7) |
| `metrics.js` | Actions, parallel steps, relocations, switches, cooperation, alternation, diversity, branching, tolerance (§8) |
| `grammar.js` | Motifs, dependency-tree expansion, motif signatures checked against the real solution (§9) |
| `generator.js` | Skeleton → analyze → solve → score → repair (shortcut blocking + annealed mutation) → smooth → replay-verify (§10, §11) |
| `replay.js` | Executes solver actions with scripted controllers and checks each resulting state (§14 test 15) |
| `game.js` | Real-time two-character game state |

### How Mario reachability works

The analysis is exact rather than sampled. It finds every place a Mario-mode character can get to with **any** controller input: every analog stick value on every frame, and every way of pressing and holding jump.

This is possible because the physics is integer-exact. Horizontal positions are whole multiples of 1/128 tile, vertical positions of 1/1024 tile, and every speed is a whole number of those units per frame. The vertical motion of a move doesn't depend on the stick, only on when jump is pressed and released. So a takeoff has just 17 vertical profiles (walk off, or jump and hold 0–15 frames), and the only other state is horizontal position and speed (`X`, `vx`). For each platform and each profile, `reach.js` tracks frame by frame the exact set of reachable (`X`, `vx`), stored as integer intervals of `X` for each `vx`. It applies the physics' own collision rules to whole intervals at once:

- Positions that hit a wall stop there and keep falling. If the wall face holds a portal socket, that's also recorded as a possible portal entry.
- Positions that bump a ceiling become a fall from that height.
- Positions that land slide to a stop with the stick released.

The velocity rule is taken directly from `physics.marioVelocity`, and the vertical profiles are recorded by running the real physics. So the analysis and the game share the same rules rather than two hand-written copies.

A **move** goes from rest to rest:

1. Stand anywhere on a platform, walk or run with any input.
2. Jump with any hold, or walk off the edge.
3. Steer freely in the air.
4. After the first landing, let go and slide to a stop.

Portal launches are moves that start from the fixed state a character has when it comes out of a wall portal. Each distinct outcome becomes a solver edge: the platform it comes to rest on (or the portal socket it flies into), plus the socket faces it touches on the way, in order, so the solver knows when an active portal would take the character somewhere else instead.

Every outcome can produce a **witness**: a start position and an input for every frame, traced back through the stored frame sets. Replay and the jump overlay use witnesses, and tests check that each one reproduces its outcome in the real physics.

Analysis takes about 100 ms for a 12×12 level. After an edit, only platforms whose analysis looked at a changed row are redone.

## Design decisions and deviations from the plan

- **Added a `PIT` tile.** With only floor and solid tiles, Mario reachability is provably a subset of Zelda reachability: both are confined to the same open region, and Mario adds gravity. That would make "Platform Access" impossible. A pit blocks Zelda walking but is open air in Mario mode.
- **Wall sockets are on left/right faces only.** A socket on a top face would also be a floor that Mario characters stand on, which makes portal placement change the platform graph. This can be added later if needed.
- **Portals are placed by touch.** A character must stand in the socket's access cell. A Mario character must be grounded and can't use floor sockets.
- **Portal launch speed is a constant** (about 9 tiles/s along the face normal). Entry momentum is not preserved yet.
- **Mid-jump portal entry is modelled.** A jump that passes an active portal goes through it, so the solver treats it as `EnterPortal`, not `JumpTo`.
- **Physics units were chosen for exact analysis.** Horizontal speeds come in steps of 1/128 tile per frame (about 0.47 tiles/s), so an analog stick has 11 run speeds each way. Running is about 5.2 tiles/s, ground acceleration about 56 tiles/s² and air control about 28 tiles/s². Vertical motion uses 1/1024 tile.
- **A Mario move ends at its first landing.** The character then comes to rest before its next move. This is the analysis's one known gap. A character launched out of a portal at about 9 tiles/s can land and jump again on the very next frame, keeping speed it could never reach from a standstill (maximum about 5.2 tiles/s), and jump much further: about 5.3 tiles instead of 3.4 for a full jump. The adversarial audit built a level that is only solvable this way (the solver calls it unsolvable). It's rare in generated levels (2 of 199 dense random levels), but it is real.
- **Walking inside a Zelda region is folded into the next action** and is not a separate step. Zelda locations are exact cells, because an active floor portal is a hole that can split regions.
- **Characters do not collide with each other.**
- **Execution tolerance is a heuristic.** For each move used, it counts how many landing positions (in eighths of a tile, summed over every speed and jump hold that works) produce the same result. 24 or more counts as forgiving.

## Verification

The claims are that the analysis finds everything (complete), everything it finds really works (sound), and the solver agrees with the game. Each is checked against the real physics in `game.js` and `physics.js`.

`npm test` (about 30 s) runs the 16 tests from §14 plus:

- the physics arithmetic stays exact, and moves are identical when shifted by whole tiles;
- every reachable outcome's witness reproduces it in the real physics (including a level with a socket on every wall face);
- random analog input never reaches anything the analysis missed;
- every transition of the solver's state graph is executed in the real game from that state and ends where the solver says;
- shortest solutions agree with an independent breadth-first search;
- random two-player play, started from random reachable states, never reaches a situation outside the solver's model;
- a standing character can stop at any position on its platform (the "start anywhere" assumption).

For deeper searches, the audit scripts run the same checks at larger scale:

```
node scripts/audit-reach.js 40 60000            # witnesses + random-input search
node scripts/audit-reach.js 16 30000 allsockets # same, with a socket on every wall face
node scripts/audit-solver.js 8 400              # every solver transition, executed in the game
node scripts/audit-play.js 14 400000            # random play vs the solver model
```

Results during development:

| Audit | Result |
| --- | --- |
| Witnesses replayed | 3,386 across 40 levels, plus 87,813 with a socket on every face. No mismatches. |
| Random analog moves | 2.2 M plus 445 k. Nothing missed. |
| Solver transitions executed in the game | 12,098. All ended in the predicted state. |
| Random-play checks | 913 k. All covered by the model. |

An adversarial agent then spent about 2.5 hours trying to break these claims. Its independent exhaustive search covered every full body state (about 6.4 billion states over 960 levels, up to 16×16), and it found no mismatch with the reachability analysis in either direction. It also replayed 334k witnesses, ran 480k solver transitions in the game, ran 9k incremental-cache checks, and ran 16M random-play checks. It found two solver bugs (below) and the momentum gap described above.

Bugs found and fixed:

- The first version of the analysis dropped moves that touch walls in mid-air, such as falling down a shaft after a launch.
- The solver didn't allow placing a portal while standing on the overhanging edge of a platform, which the game allows.
- Solver state keys could collide in levels with 128 or more sockets, so a solvable level was reported unsolvable.
- A Zelda character standing on an active floor portal couldn't place a portal whose access cell is that tile in the model, though the game allows it. No solver answer was found that this changed.

Performance limit: analysis cost grows with the number of wall-socket faces, because each distinct sequence of sockets touched is tracked separately. A 16×16 level with 116 sockets took 26 s.

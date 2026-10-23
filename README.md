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
| **Edit** | Paint floor / solid / pit, exits, starts and sockets. Every edit re-runs analysis and the solver and prints a geometry-change report (regions, platforms, jump connections, shortest solution, shortcut warning). Overlays show Zelda regions, Mario platforms, jump trajectories (click one to see its takeoff range) and portal launches. Supports undo, JSON export/import and ASCII copy. |
| **Solve** | Shortest solution for both characters, complexity metrics, step-through of solver states, **Replay with physics** (runs the solution through the real game loop with scripted controllers), and **Find shortcut fix**. |
| **Play** | Real-time game. A: WASD (W/Space jumps), E places portal. B: arrows (Up jumps), Enter or `/` places portal. One gamepad: left stick = A, right stick = B. Two gamepads: one each. |
| **Generate** | Set complexity targets, generate candidates in a Web Worker, filter/sort them, and load one to inspect its intended grammar tree next to the actual solution. |

## Architecture (`src/core`, no DOM dependencies)

| Module | Plan section |
| --- | --- |
| `level.js` | Shared geometry, sockets, JSON/ASCII formats |
| `physics.js` | One fixed-step body update used by gameplay, analysis and replay (§5.5) |
| `portals.js` | Transition rules, exit placement, launch velocity |
| `zelda.js` | Flood-fill regions per floor-portal configuration (§4.1) |
| `mario.js` | Platforms, policy-based trajectory simulation, jump-template table, incremental cache (§4.2, §5, §6) |
| `analysis.js` | Combined analysis, summary, geometry-change report (§12) |
| `solver.js` | Two-character BFS over `[mode, loc]×2 + portals`; solved / unsolvable / timeout (§7) |
| `metrics.js` | Actions, parallel steps, relocations, switches, cooperation, alternation, diversity, branching, tolerance (§8) |
| `grammar.js` | Motifs, dependency-tree expansion, motif signatures checked against the real solution (§9) |
| `generator.js` | Skeleton → analyze → solve → score → repair (shortcut blocking + annealed mutation) → smooth → replay-verify (§10, §11) |
| `replay.js` | Executes solver actions with scripted controllers and checks each resulting state (§14 test 15) |
| `game.js` | Real-time two-character game state |

### How Mario reachability works

Each standable cell is a takeoff point, sampled at three positions. From each one, 69 control policies are simulated with the real physics: walk-off, standing and running jumps with 0/3/6/10/15 frames of jump hold, and stick release at several times. Each trajectory records the wall faces it pushes against. Outcomes are grouped per `(from platform, to platform, sockets touched)` into one `JumpTo` edge. That edge keeps a representative execution plan, the takeoff and landing ranges, the jump-hold range, and a variant count used for execution tolerance. Falling is just a policy with no jump.

The free-space jump-template table (`jumpTable()`) lists the grid offsets a jump can reach. It proposes candidate connections, and simulation against the actual level validates them. The Edit tab shows both counts.

Every trajectory caches the bounding box of the tiles it touched, so after an edit only nearby trajectories are re-simulated.

## Design decisions and deviations from the plan

- **Added a `PIT` tile.** With only floor and solid tiles, Mario reachability is provably a subset of Zelda reachability: both are confined to the same open region, and Mario adds gravity. That would make "Platform Access" impossible. A pit blocks Zelda walking but is open air in Mario mode.
- **Wall sockets are on left/right faces only.** A socket on a top face would also be a floor that Mario characters stand on, which makes portal placement change the platform graph. This can be added later if needed.
- **Portals are placed by touch.** A character must stand in the socket's access cell. A Mario character must be grounded and can't use floor sockets.
- **Portal launch speed is a constant** (9 tiles/s along the face normal). Entry momentum is not preserved yet.
- **Mid-jump portal entry is modelled.** A jump that passes an active portal goes through it, so the solver treats it as `EnterPortal`, not `JumpTo`.
- **Walking inside a Zelda region is folded into the next action** and is not a separate step. Zelda locations are exact cells, because an active floor portal is a hole that can split regions.
- **Characters do not collide with each other.**
- **"Unsolvable" is relative to the sampled control policies.** The solver is sound: every solution it returns replays in the real physics. It is not complete for frame-perfect inputs outside the sampled set.
- **Execution tolerance is a heuristic.** It is the number of sampled variants that reach the same outcome (12 or more counts as forgiving).

## Verification

- `npm test`: the 16 tests from §14, plus a test that a timeout is reported as inconclusive and a test that incremental analysis matches fresh analysis.
- Stress check during development: 322 solutions from randomly mutated levels and 40 from fully generated levels were replayed through gameplay physics, with no mismatches.

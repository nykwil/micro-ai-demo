# Portal transitions: full matrix

Status: **draft for review.** Cells marked *today* are implemented. Cells marked *proposed* are suggestions waiting on a decision. Cells marked *needs top/bottom sockets* can't happen yet, because only L/R faces and floor tiles take portals today.

## Surfaces (box names)

Both views show the same grid, so every portal surface is one face of the "box" (a tile), named the same in both views. What that face *is* depends on your current mode.

| Face | Normal points | In XZ (top-down) it is | In XY (side view) it is |
| --- | --- | --- | --- |
| **Left** | −x (screen left) | a wall facing west | a wall facing left |
| **Right** | +x (screen right) | a wall facing east | a wall facing right |
| **Top** | −y (screen up) | a wall facing north | **ground**: you stand on it |
| **Bottom** | +y (screen down) | a wall facing south | **ceiling** |
| **Back** | towards the camera | **ground** (a floor tile) | the backdrop behind you |

Left and right are mirror images of each other, so the tables below treat them as one case: **L/R**.

## How you get into a portal

| Face | Entering in XZ | Entering in XY |
| --- | --- | --- |
| L/R | walk into the wall face | walk, jump or fly into the face |
| Top | walk into the north-facing wall | fall onto it or land on it. Standing on a ground portal means falling in. |
| Bottom | walk into the south-facing wall | jump up into it |
| Back | step onto the floor tile | **cannot**: there is no movement into the screen in XY |

## Mode rule

Proposed general rule, which extends today's rule:

> Going between **back** and any other face switches mode: XZ ↔ XY. Any other trip keeps your mode.

This is exactly today's behaviour for L/R and back. It extends naturally to top/bottom, because top and bottom are walls in XZ and ground/ceiling in XY, never the back plane. Back → back is inactive.

## Matrix 1: entering in XZ (top-down)

Rows: the face you go **in**. Columns: the face you come **out of**.

| In \ Out | L/R | Top | Bottom | Back |
| --- | --- | --- | --- | --- |
| **L/R** | stay XZ: stand on the tile in front of the exit, facing out, still. *today* | stay XZ: stand on the tile north of the block, facing north. *needs top/bottom sockets* | stay XZ: stand on the tile south of the block, facing south. *needs top/bottom sockets* | **→ XY**: appear in the floor tile's cell at rest, then fall. *today* |
| **Top** | same as row 1 *(needs sockets)* | same *(needs sockets)* | same *(needs sockets)* | **→ XY**: appear in the cell at rest, fall *(needs sockets)* |
| **Bottom** | same as row 1 *(needs sockets)* | same *(needs sockets)* | same *(needs sockets)* | **→ XY**: appear in the cell at rest, fall *(needs sockets)* |
| **Back** | **→ XY**: *today* launched sideways at ~9 tiles/s. *Proposed*: appear in the tile in front of the wall at rest, then fall. **Decision A** | **→ XY**: you come out of a ground surface. **Decision B** *(needs sockets)* | **→ XY**: drop out of the ceiling at rest and fall *(needs sockets)* | inactive |

XZ has no momentum (top-down walking stops when you let go), so staying in XZ always means "stand in front of the exit, facing out".

## Matrix 2: entering in XY (side view)

You can't enter a back face in XY, so there are four rows. Momentum exists in XY, so the speed you go in with matters.

| In \ Out | L/R | Top | Bottom | Back |
| --- | --- | --- | --- | --- |
| **L/R** (moving sideways at speed *v*) | stay XY: come out moving away from the exit face. *Today*: fixed ~9 tiles/s. *Proposed*: at speed *v*. **Decision C** | stay XY: shot **up** out of the ground at *v* (or a fixed speed), fall back down. **Decision D** *(needs sockets)* | stay XY: shot **down** out of the ceiling *(needs sockets)* | **→ XZ**: *today* stand on the floor tile (on the hole), still, and you must walk off. **Decision E** |
| **Top** (falling onto it at *v*) | stay XY: shot sideways out of the wall at *v*, a classic Portal fling *(needs sockets)* | stay XY: up out of the other ground. With *v* kept, you bounce between the two forever unless you steer out of the column. **Decision D** *(needs sockets)* | stay XY: down out of the ceiling, falling faster *(needs sockets)* | **→ XZ**: as row 1 *(needs sockets)* |
| **Bottom** (jumping into it at *v*) | stay XY: out of the wall at *v* *(needs sockets)* | stay XY: up out of the ground *(needs sockets)* | stay XY: down out of the other ceiling *(needs sockets)* | **→ XZ**: as row 1 *(needs sockets)* |

## Decisions

- **A. Back → side wall, into XY.** Keep today's launch, or appear at rest in front of the wall and drop? Dropping matches "changing physics needs a landing spot". *Suggest: drop at rest.*
- **B. Back → top (ground) in XY.** Arriving at rest *on* a ground portal means falling straight back in, an instant loop.
  - **(i)** pop out upwards at a fixed small speed so there's a moment to steer aside;
  - **(ii)** place the character on the nearest free ground tile next to the portal;
  - **(iii)** refuse the trip.

  *Suggest (ii): it's the landing-spot rule again.*
- **C. Side → side in XY: keep entry speed?** Portal-style momentum makes flings depend on how you entered. Exact analysis handles it because speeds are capped, but it makes the "speed carried through a landing" gap matter more. *Suggest: keep speed.*
- **D. Ground → ground in XY.** With speed kept, you bounce until you steer out. Is an endless bounce acceptable, or should the speed cap/decay so it settles? The analysis needs the bounce to end: a capped number of passes, or steering out within the column. *Suggest: allow it, and analyse up to the point you steer out.*
- **E. Side → back, into XZ.** You appear on the hole.
  - **(i)** today's behaviour: stand on it and walk off yourself;
  - **(ii)** step automatically onto a free neighbouring floor tile, preferring the direction you were moving, then the others in a fixed order, and refuse the trip if none is free.

  *Suggest (ii).*
- **F. All trips:** a ~0.4 s take-over with a portal animation, no control during it. Speed decisions above apply after the take-over.

Whatever is decided, each cell becomes one rule that the game, the exact analysis and the solver all follow. The fail-condition check then reports any trip that can strand a character.

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
| **Back** | towards the camera | **ground** (a floor tile) | a **door** in the backdrop behind you |

Left and right are mirror images of each other, so the tables below treat them as one case: **L/R**.

## How you get into a portal

| Face | Entering in XZ | Entering in XY |
| --- | --- | --- |
| L/R | walk into the wall face | walk, jump or fly into the face |
| Top | walk into the north-facing wall | fall onto it or land on it. Standing on a ground portal means falling in. |
| Bottom | walk into the south-facing wall | jump up into it |
| Back | step onto the floor tile | **door**: press **Up** while your centre is in its tile, standing or in mid-air, or shoot it (long hold, no direction, standing) and go straight through. *today* |

Shooting works the same way in both modes: a long hold with no direction shoots the back face of the tile you're standing in. In XZ that's the floor under you, in XY it's the backdrop behind you. In XY you only shoot while standing.

Up never jumps. Each player has two buttons, shoot and jump (Space, Right Shift, LT/RT); jump does nothing in top-down mode yet. So Up works on a door at any moment of a jump.

## Landing spot

> When you come out of a portal, the tile you come out in is your **landing spot**. Until you leave that tile, the portals on it do nothing for you: the wall faces around it, and the floor portal or door in it. Once you've stepped off, they work again. *today*

This stops every "straight back in" loop with one rule:

- Out of a wall in XZ, pushing straight back into it does nothing until you've stepped away and come back.
- Out of a door in XY, holding Up doesn't send you back through.
- Two portals facing each other across a one-tile gap used to bounce an XY character between them forever. Now the far one is on the landing spot, so you stop against it and fall.
- Coming out onto a floor portal in XZ (you stand on the hole), you step off whenever you like.

Stepping from your landing spot onto a *different* tile that holds a portal (a neighbouring floor portal) takes you through it, because that tile isn't your landing spot.

A character whose landing spot is closed in (an XZ tile with no floor next to it, or an XY one-tile pocket with walls on both sides and a ceiling) can't step off it, so it can't use the portals there at all. The solver tracks this, and the fail-condition check reports it if it strands you.

## Mode rule

> Going between **back** and any other face switches mode: XZ ↔ XY. Any other trip keeps your mode. *today*

Back → back is inactive. Top and bottom are walls in XZ and ground/ceiling in XY, never the back plane, so the rule extends to them unchanged.

## Matrix 1: entering in XZ (top-down)

Rows: the face you go **in**. Columns: the face you come **out of**.

| In \ Out | L/R | Top | Bottom | Back |
| --- | --- | --- | --- | --- |
| **L/R** | stay XZ: stand on the tile in front of the exit, facing out, still. *today* | stay XZ: stand on the tile north of the block, facing north. *needs top/bottom sockets* | stay XZ: stand on the tile south of the block, facing south. *needs top/bottom sockets* | **→ XY**: appear in the floor tile's cell at rest, then fall. With ground under it you're standing in front of the door (landing spot: Up does nothing until you step off). *today* |
| **Top** | same as row 1 *(needs sockets)* | same *(needs sockets)* | same *(needs sockets)* | **→ XY**: appear in the cell at rest, fall *(needs sockets)* |
| **Bottom** | same as row 1 *(needs sockets)* | same *(needs sockets)* | same *(needs sockets)* | **→ XY**: appear in the cell at rest, fall *(needs sockets)* |
| **Back** | **→ XY**: *today* launched sideways at ~9 tiles/s. *Proposed*: appear in the tile in front of the wall at rest, then fall. **Decision A** | **→ XY**: come out standing on a ground portal. The landing spot keeps you from falling straight back in; walk off. *(needs sockets)* | **→ XY**: drop out of the ceiling at rest and fall *(needs sockets)* | inactive |

XZ has no momentum (top-down walking stops when you let go), so staying in XZ always means "stand in front of the exit, facing out".

## Matrix 2: entering in XY (side view)

Momentum exists in XY, so the speed you go in with matters (except through a door, which you enter standing).

| In \ Out | L/R | Top | Bottom | Back |
| --- | --- | --- | --- | --- |
| **L/R** (moving sideways at speed *v*) | stay XY: come out moving away from the exit face. *Today*: fixed ~9 tiles/s. *Proposed*: at speed *v*. **Decision C** | stay XY: shot **up** out of the ground at *v* (or a fixed speed), fall back down. **Decision D** *(needs sockets)* | stay XY: shot **down** out of the ceiling *(needs sockets)* | **→ XZ**: stand on the floor tile (on the hole), still. It's your landing spot, so step off when you like. *today* |
| **Top** (falling onto it at *v*) | stay XY: shot sideways out of the wall at *v*, a classic Portal fling *(needs sockets)* | stay XY: up out of the other ground. With *v* kept, you bounce between the two until you steer out of the column. **Decision D** *(needs sockets)* | stay XY: down out of the ceiling, falling faster *(needs sockets)* | **→ XZ**: as row 1 *(needs sockets)* |
| **Bottom** (jumping into it at *v*) | stay XY: out of the wall at *v* *(needs sockets)* | stay XY: up out of the ground *(needs sockets)* | stay XY: down out of the other ceiling *(needs sockets)* | **→ XZ**: as row 1 *(needs sockets)* |
| **Back** (door, standing) | **→ XZ**: stand on the tile in front of the wall, facing out. Refused if that tile isn't floor. *today* | **→ XZ**: stand on the tile north of the block *(needs sockets)* | **→ XZ**: stand on the tile south of the block *(needs sockets)* | inactive |

## Decisions

Settled:

- **Back in XY** is a door: Up, or shoot it and go straight through. Same shot as the XZ floor.
- **Straight-back-in loops** are handled by the landing spot. This settles the old **B** (back → top: arriving at rest on a ground portal no longer drops you straight back in) and **E** (side → back into XZ: you stand on the hole and step off when you like; no automatic step needed).

Still open:

- **A. Back → side wall, into XY.** Keep today's launch, or appear at rest in front of the wall and drop? Dropping matches "changing physics needs a landing spot". *Suggest: drop at rest.*
- **C. Side → side in XY: keep entry speed?** Portal-style momentum makes flings depend on how you entered. Exact analysis handles it because speeds are capped, but it makes the "speed carried through a landing" gap matter more. *Suggest: keep speed.*
- **D. Ground → ground in XY.** With speed kept, you bounce until you steer out of the column. You leave the landing spot on every bounce, so it doesn't stop this one. Is an endless bounce acceptable, or should the speed cap/decay so it settles? *Suggest: allow it, and analyse up to the point you steer out.*
- **F. All trips:** a ~0.4 s take-over with a portal animation, no control during it. Speed decisions above apply after the take-over.

Each cell is one rule that the game, the exact analysis and the solver all follow. The fail-condition check then reports any trip that can strand a character.

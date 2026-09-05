# The floor plan

The house is the Greenville 4868B plan, main floor and upper floor. This page explains how it was digitised and how to model a different house. An in-browser editor is on the roadmap; for now the plan is data.

## Coordinates

- 1 tile = 16 world pixels ≈ 2 ft.
- Each floor is a 43 × 26 tile grid in **world coordinates**: x to the right, y down.
- The architect's drawing is portrait (north up). To fill a landscape monitor it was rotated 90° counter-clockwise:

  | Drawing | Screen |
  | --- | --- |
  | top (patio, backyard) | left |
  | bottom (porch, street) | right |
  | left (garage) | bottom |
  | right (den, bedrooms) | top |

Rooms and doors are authored in the drawing's orientation ("plan coordinates") in `tools/plan-source.mjs`, which rotates them and writes `house/floorplan.json`. Furniture and stations are authored directly in world coordinates inside `house/floorplan.json`.

## Regenerate the plan

```bash
npm run plan          # node tools/plan-source.mjs
```

This rewrites the rooms, doors and stair data in `house/floorplan.json`, **keeps** the existing `furniture` and `stations` arrays for each floor, and prints an ASCII map of each floor with a letter per room so you can see the result. Then validate:

```bash
node tools/validate-floorplan.mjs
```

The validator checks that every station sits on a walkable tile, that stations and the stair transfer cells are reachable from the front door, and that furniture does not overlap walls or void.

## Model your own house

### 1. Rooms and doors (`tools/plan-source.mjs`)

Measure your plan in feet, divide by 2 for tiles, and edit the `floors` array. Each floor has:

- `rooms`: `{ id, name, kind, floor, rects }`. `kind` is `indoor`, `outdoor` or `void` (a hole such as "open to below"). `floor` is the texture: `wood`, `tile`, `carpet`, `concrete`, `pavers`, `lawn`, `asphalt`, `void`. `rects` is a list of `r(x, y, w, h)` rectangles in plan tiles; an L-shaped room is two rects with the same id. Later rooms in the list win where rects overlap, so list outdoor areas first. Add `stairs: true` on the stairwell room.
- `open`: pairs of room ids with no wall between them (open-plan kitchen/dining/family, hall/entry).
- `doors`: `[[x1,y1], [x2,y2], kind]` for two adjacent cells. `kind` is `door`, `double`, `slider`, `garage` or `opening` (a gap with no door leaf).
- `stairTransfer`: the cell inside the stairwell where an agent switches floors. Both floors need one.
- `spawn` (main floor only): the sidewalk cell where agents appear and leave. `frontDoor`: the cell just inside the front door.
- `outside`: texture for cells that belong to no room. `lawn` is walkable, `roof` (upper floors) is not.

Margins around the hull (`ML`, `MR`, `MT`, `MB`) become the yard, driveway and street. Change `PW`/`PH` if your hull is not 22 × 35 tiles. Keep both floors the same grid size so they can sit side by side.

Walls are derived: an edge between two cells with different room ids is a wall, unless the pair is in `open`, both cells are outdoors, or a door covers the edge.

### 2. Furniture (`house/floorplan.json`, world coordinates)

```json
{ "type": "sofa", "x": 8, "y": 3, "w": 3, "h": 1, "facing": "down", "solid": true }
```

`w`/`h` default to the type's natural size, `facing` is `up`, `down`, `left` or `right`, and `solid` defaults to true (rugs, mats and doormats default to false). Solid furniture blocks walking, so leave a tile free next to anything an agent should use.

Available types (natural size in tiles):

| Area | Types |
| --- | --- |
| Kitchen | counter 1×1, stove 1×1, sink 1×1, fridge 1×1, island w×1, dishwasher 1×1, microwave 1×1 |
| Dining | table 3×2, chair 1×1, stool 1×1 |
| Living | sofa 3×1, loveseat 2×1, armchair 1×1, coffee_table 2×1, tv 2×1 (on wall), tv_stand 2×1, fireplace 1×2, bookshelf 1×1 or 2×1, plant 1×1, lamp 1×1, rug w×h, painting 1×1 |
| Bedroom | bed_king 3×3, bed_queen 2×3, bed_single 2×3 (facing = head side), nightstand 1×1, dresser 2×1, wardrobe 1×1, desk 2×1, office_chair 1×1, computer 1×1 |
| Bath | toilet 1×1, vanity 1×1 or 2×1, tub 2×1, shower 1×1, towel_rack 1×1, mirror 1×1 |
| Utility | washer 1×1, dryer 1×1, laundry_basket 1×1, shelves 1×1, bench 2×1, coat_rack 1×1, furnace 1×1, water_heater 1×1, closet w×1, boxes 1×1 |
| Garage and outdoors | car 2×4 or 4×2 by facing, workbench 2×1, toolwall 2×1, trash_bin 1×1, recycle_bin 1×1, mower 1×1, bike 1×1, grill 1×1, patio_chair 1×1, patio_table 1×1, tree 2×2, bush 1×1, flowerbed w×1, mailbox 1×1, fence 1×1, stairs w×h, railing, pool_table 3×2, beanbag 1×1, doormat 1×1 |

Unknown types render as a labelled grey box rather than breaking the page.

### 3. Stations (`house/floorplan.json`, world coordinates)

A station is the tile an agent stands on to do a chore, plus the direction it faces.

```json
{ "id": "stove1", "chore": "cook", "x": 15, "y": 12, "facing": "down" }
{ "id": "lawn_front", "chore": "mow", "x": 39, "y": 3, "facing": "right",
  "area": { "x": 38, "y": 2, "w": 3, "h": 6 } }
```

- `id` must be unique per floor.
- `chore` is one of the chores in [CHORES.md](CHORES.md). Give the house at least one station for each of: desk, read, cook, chop, dishes, mow, trash, tv, sit, coffee, nap. Several of each spreads agents out.
- `x`, `y` must be a walkable, non-solid tile.
- `area` is only for `mow`, `vacuum` and `rake`: the rectangle the agent sweeps.

Run the validator after editing, then reload the browser; the server serves `house/floorplan.json` as is.

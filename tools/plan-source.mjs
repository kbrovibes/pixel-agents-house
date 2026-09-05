// Authoring source for house/floorplan.json.
// Rooms and doors are written in "plan" coordinates: the orientation of the
// architect's drawing (north = up), 1 tile = 2 ft, origin = top-left corner of
// the house hull. The script rotates everything 90° counter-clockwise so the
// long axis of the house runs horizontally on a landscape monitor.
//   image-top (patio / backyard)  -> screen LEFT
//   image-bottom (porch / street) -> screen RIGHT
//   image-left (garage)           -> screen BOTTOM
//   image-right (den / bedrooms)  -> screen TOP
// Run: node tools/plan-source.mjs  (writes house/floorplan.json and prints ASCII maps)
import fs from 'node:fs';

const PW = 22, PH = 35;              // house hull in plan tiles
const ML = 2, MR = 2, MT = 3, MB = 5; // margins: left/right/top/bottom (plan orientation)
const PWm = PW + ML + MR;            // 26
const PHm = PH + MT + MB;            // 43
const WORLD_W = PHm, WORLD_H = PWm;  // 43 x 26 after rotation

// r(x,y,w,h) in plan coords (may be negative into margins)
const r = (x, y, w, h) => ({ x, y, w, h });
const rotRect = ({ x, y, w, h }) => {
  const sx = x + ML, sy = y + MT;
  return { x: sy, y: PWm - sx - w, w: h, h: w };
};
const rotCell = ([x, y]) => [y + MT, PWm - 1 - (x + ML)];

const floors = [
  {
    id: 'main', name: 'Main Floor', outside: 'lawn',
    rooms: [
      // outdoors (listed first; later rooms win overlaps)
      { id: 'street',    name: 'Street',      kind: 'outdoor', floor: 'asphalt',  rects: [r(-2, 39, PWm, 1)] },
      { id: 'sidewalk',  name: 'Sidewalk',    kind: 'outdoor', floor: 'pavers',   rects: [r(-2, 38, PWm, 1)] },
      { id: 'driveway',  name: 'Driveway',    kind: 'outdoor', floor: 'concrete', rects: [r(0, 32, 11, 6)] },
      { id: 'path',      name: 'Path',        kind: 'outdoor', floor: 'pavers',   rects: [r(12, 34, 1, 4)] },
      { id: 'backyard',  name: 'Backyard',    kind: 'outdoor', floor: 'lawn',     rects: [r(-2, -3, PWm, 3)] },
      { id: 'frontyard', name: 'Front Yard',  kind: 'outdoor', floor: 'lawn',     rects: [r(13, 34, 9, 4), r(11, 34, 1, 4)] },
      { id: 'sideyard',  name: 'Side Yard',   kind: 'outdoor', floor: 'lawn',     rects: [r(16, 0, 6, 9), r(18, 9, 4, 9), r(22, 0, 2, 35), r(-2, 0, 2, 35)] },
      // covered / semi-outdoor
      { id: 'patio',     name: 'Cov. Patio',  kind: 'outdoor', floor: 'pavers',   rects: [r(0, 0, 7, 6)] },
      { id: 'porch',     name: 'Porch',       kind: 'outdoor', floor: 'pavers',   rects: [r(11, 31, 4, 3)] },
      // indoors
      { id: 'family',    name: 'Family Room', kind: 'indoor',  floor: 'wood',     rects: [r(7, 0, 9, 9), r(7, 9, 7, 2)] },
      { id: 'dining',    name: 'Dining',      kind: 'indoor',  floor: 'wood',     rects: [r(0, 6, 7, 5)] },
      { id: 'kitchen',   name: 'Kitchen',     kind: 'indoor',  floor: 'wood',     rects: [r(0, 11, 14, 7)] },
      { id: 'stairs',    name: 'Stairs',      kind: 'indoor',  floor: 'wood',     rects: [r(14, 9, 4, 7)], stairs: true },
      { id: 'storage',   name: 'Storage',     kind: 'indoor',  floor: 'tile',     rects: [r(14, 16, 4, 2)] },
      { id: 'pantry',    name: 'Pantry',      kind: 'indoor',  floor: 'tile',     rects: [r(0, 18, 3, 3)] },
      { id: 'mud',       name: 'Mud Room',    kind: 'indoor',  floor: 'tile',     rects: [r(3, 18, 8, 3)] },
      { id: 'hall',      name: 'Hall',        kind: 'indoor',  floor: 'wood',     rects: [r(11, 18, 3, 9)] },
      { id: 'den',       name: 'Den',         kind: 'indoor',  floor: 'carpet',   rects: [r(14, 18, 8, 5)] },
      { id: 'pwdr',      name: 'Powder Rm',   kind: 'indoor',  floor: 'tile',     rects: [r(14, 23, 4, 4)] },
      { id: 'gbath',     name: 'Guest Bath',  kind: 'indoor',  floor: 'tile',     rects: [r(18, 23, 4, 4)] },
      { id: 'garage',    name: '2-Car Garage',kind: 'indoor',  floor: 'concrete', rects: [r(0, 21, 11, 11)] },
      { id: 'entry',     name: 'Entry',       kind: 'indoor',  floor: 'wood',     rects: [r(11, 27, 4, 4)] },
      { id: 'guest',     name: 'Guest Suite', kind: 'indoor',  floor: 'carpet',   rects: [r(15, 27, 7, 8)] },
    ],
    // pairs of room ids with no wall between them (open plan)
    open: [
      ['family', 'dining'], ['family', 'kitchen'], ['dining', 'kitchen'],
      ['kitchen', 'hall'], ['hall', 'entry'],
      ['patio', 'backyard'], ['patio', 'sideyard'], ['porch', 'frontyard'], ['porch', 'path'],
    ],
    // doors: [cellA, cellB, kind]  (cells are adjacent; kind: door|double|slider|garage|opening)
    doors: [
      [[6, 3], [7, 3], 'slider'],      // patio <-> family
      [[3, 5], [3, 6], 'slider'],      // patio <-> dining
      [[13, 10], [14, 10], 'opening'], // family <-> stairs
      [[13, 11], [14, 11], 'opening'], // kitchen <-> stairs
      [[13, 12], [14, 12], 'opening'],
      [[13, 16], [14, 16], 'door'],    // kitchen <-> storage
      [[1, 17], [1, 18], 'door'],      // kitchen <-> pantry
      [[7, 17], [7, 18], 'door'],      // kitchen <-> mud
      [[10, 19], [11, 19], 'door'],    // mud <-> hall
      [[5, 20], [5, 21], 'door'],      // mud <-> garage
      [[13, 19], [14, 19], 'double'],  // hall <-> den
      [[13, 20], [14, 20], 'double'],
      [[13, 24], [14, 24], 'door'],    // hall <-> pwdr
      [[17, 24], [18, 24], 'door'],    // pwdr <-> gbath
      [[19, 26], [19, 27], 'door'],    // gbath <-> guest
      [[14, 28], [15, 28], 'door'],    // entry <-> guest
      [[12, 30], [12, 31], 'door'],    // entry <-> porch (front door)
      [[3, 31], [3, 32], 'garage'], [[4, 31], [4, 32], 'garage'],
      [[6, 31], [6, 32], 'garage'], [[7, 31], [7, 32], 'garage'],
    ],
    // stairs: [cell where agent transfers on this floor]; entrance cells are the doors above
    stairTransfer: [17, 14],
    // where new agents appear / leave (street side of the front path)
    spawn: [12, 38],
    frontDoor: [12, 31],
  },
  {
    id: 'upper', name: 'Upper Floor', outside: 'roof',
    rooms: [
      { id: 'mbath',   name: 'M. Bath',     kind: 'indoor', floor: 'tile',   rects: [r(0, 0, 10, 7)] },
      { id: 'msuite',  name: 'M. Suite',    kind: 'indoor', floor: 'carpet', rects: [r(10, 0, 9, 10)] },
      { id: 'mvest',   name: 'Vestibule',   kind: 'indoor', floor: 'carpet', rects: [r(7, 7, 3, 3)] },
      { id: 'wic',     name: 'M. WIC',      kind: 'indoor', floor: 'carpet', rects: [r(0, 7, 7, 7)] },
      { id: 'laundry', name: 'Laundry',     kind: 'indoor', floor: 'tile',   rects: [r(7, 10, 3, 4)] },
      { id: 'uhall',   name: 'Upper Hall',  kind: 'indoor', floor: 'wood',   rects: [r(10, 10, 4, 17), r(7, 14, 3, 2), r(7, 22, 3, 2), r(14, 25, 2, 2)] },
      { id: 'ustairs', name: 'Stairs',      kind: 'indoor', floor: 'wood',   rects: [r(14, 10, 4, 8)], stairs: true },
      { id: 'bdrm2',   name: 'Bedroom 2',   kind: 'indoor', floor: 'carpet', rects: [r(0, 14, 7, 6)] },
      { id: 'bath2',   name: 'Bath',        kind: 'indoor', floor: 'tile',   rects: [r(7, 16, 3, 4)] },
      { id: 'mech',    name: 'Mech',        kind: 'indoor', floor: 'concrete', rects: [r(7, 20, 3, 2)] },
      { id: 'hallbath',name: 'Hall Bath',   kind: 'indoor', floor: 'tile',   rects: [r(0, 20, 7, 3)] },
      { id: 'bdrm3',   name: 'Bedroom 3',   kind: 'indoor', floor: 'carpet', rects: [r(14, 18, 8, 7)] },
      { id: 'rec',     name: 'Rec Room',    kind: 'indoor', floor: 'carpet', rects: [r(0, 23, 10, 12), r(10, 32, 4, 3)] },
      { id: 'openbelow', name: 'Open Below', kind: 'void',  floor: 'void',   rects: [r(10, 27, 4, 5)] },
      { id: 'bdrm4',   name: 'Bedroom 4',   kind: 'indoor', floor: 'carpet', rects: [r(16, 25, 6, 2), r(14, 27, 8, 8)] },
    ],
    open: [['msuite', 'mvest'], ['uhall', 'rec']],
    doors: [
      [[7, 8], [6, 8], 'door'],        // mvest <-> wic
      [[8, 7], [8, 6], 'door'],        // mvest <-> mbath
      [[12, 10], [12, 9], 'double'],   // uhall <-> msuite
      [[13, 10], [13, 9], 'double'],
      [[10, 11], [9, 11], 'door'],     // uhall <-> laundry
      [[13, 16], [14, 16], 'opening'], // uhall <-> stairs
      [[13, 17], [14, 17], 'opening'],
      [[7, 14], [6, 14], 'door'],      // uhall <-> bdrm2
      [[10, 17], [9, 17], 'door'],     // uhall <-> bath2
      [[10, 20], [9, 20], 'door'],     // uhall <-> mech
      [[7, 22], [6, 22], 'door'],      // uhall <-> hallbath
      [[13, 21], [14, 21], 'door'],    // uhall <-> bdrm3
      [[15, 25], [16, 25], 'door'],    // uhall <-> bdrm4
    ],
    stairTransfer: [17, 10],
  },
];

const out = { name: 'Greenville 4868B', tile: 16, width: WORLD_W, height: WORLD_H, feetPerTile: 2, floors: [] };
for (const f of floors) {
  const wf = {
    id: f.id, name: f.name, outside: f.outside,
    rooms: f.rooms.map(rm => ({ id: rm.id, name: rm.name, kind: rm.kind, floor: rm.floor, stairs: !!rm.stairs, rects: rm.rects.map(rotRect) })),
    open: f.open,
    doors: f.doors.map(([a, b, kind]) => ({ a: rotCell(a), b: rotCell(b), kind })),
    stairTransfer: rotCell(f.stairTransfer),
    furniture: [], stations: [],
  };
  if (f.spawn) wf.spawn = rotCell(f.spawn);
  if (f.frontDoor) wf.frontDoor = rotCell(f.frontDoor);
  out.floors.push(wf);
}

// keep furniture/stations previously authored in house/floorplan.json (world coords)
const target = new URL('../house/floorplan.json', import.meta.url);
try {
  const prev = JSON.parse(fs.readFileSync(target, 'utf8'));
  for (const wf of out.floors) {
    const p = prev.floors?.find(x => x.id === wf.id);
    if (p) { wf.furniture = p.furniture || []; wf.stations = p.stations || []; }
  }
} catch {}
fs.writeFileSync(target, JSON.stringify(out, null, 1));

// ASCII maps
for (const wf of out.floors) {
  const grid = Array.from({ length: WORLD_H }, () => Array(WORLD_W).fill('.'));
  const letters = {};
  wf.rooms.forEach((rm, i) => {
    const ch = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'[i];
    letters[ch] = rm.id;
    for (const rc of rm.rects) for (let y = rc.y; y < rc.y + rc.h; y++) for (let x = rc.x; x < rc.x + rc.w; x++) grid[y][x] = ch;
  });
  console.log(`\n== ${wf.name} (${WORLD_W}x${WORLD_H}) ==`);
  console.log('    ' + Array.from({ length: WORLD_W }, (_, x) => String(x % 10)).join(''));
  grid.forEach((row, y) => console.log(String(y).padStart(3) + ' ' + row.join('')));
  console.log(Object.entries(letters).map(([k, v]) => `${k}=${v}`).join('  '));
  console.log('doors:', wf.doors.map(d => `${d.a}-${d.b}(${d.kind})`).join(' '));
  console.log('stairTransfer:', wf.stairTransfer, 'spawn:', wf.spawn, 'frontDoor:', wf.frontDoor);
}

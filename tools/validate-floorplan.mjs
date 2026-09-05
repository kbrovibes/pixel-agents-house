// Validates house/floorplan.json: station reachability from spawn (cross-floor
// via stairs), furniture vs doors/stations, and prints ASCII maps.
// Run: node tools/validate-floorplan.mjs
import fs from 'node:fs';
import { buildWorld, distanceMap, CHORES_BY_ACTIVITY, FURNITURE_SIZES } from '../public/js/world.js';

const plan = JSON.parse(fs.readFileSync(new URL('../house/floorplan.json', import.meta.url), 'utf8'));
const world = buildWorld(plan);
const problems = [];
const main = world.mainFloor;

const doorCells = (f) => { const s = new Set(); for (const d of f.doors) { s.add(d.a.join(',')); s.add(d.b.join(',')); } return s; };

// reachability from spawn
const dists = {};
dists[main.id] = distanceMap(main, main.spawn[0], main.spawn[1]);
for (const f of world.floorList) {
  if (f === main) continue;
  const t = main.stairTransfer;
  if (dists[main.id][t[1] * main.width + t[0]] < 0) problems.push(`main stairTransfer ${t} unreachable from spawn`);
  if (!f.stairTransfer) { problems.push(`${f.id}: no stairTransfer`); continue; }
  dists[f.id] = distanceMap(f, f.stairTransfer[0], f.stairTransfer[1]);
}
if (main.frontDoor && dists[main.id][main.frontDoor[1] * main.width + main.frontDoor[0]] < 0) problems.push('front door unreachable from spawn');

const allChores = new Set(Object.values(CHORES_BY_ACTIVITY).flat().concat(['helper']));
const counts = {};
for (const f of world.floorList) {
  const dc = doorCells(f);
  const stationCells = new Map(f.stations.map(s => [`${s.x},${s.y}`, s]));
  const seen = new Set();
  for (const s of f.stations) {
    if (seen.has(s.id)) problems.push(`${f.id}: duplicate station id ${s.id}`);
    seen.add(s.id);
    if (!allChores.has(s.chore)) problems.push(`${f.id}: station ${s.id} has unknown chore ${s.chore}`);
    if (!f.walkable(s.x, s.y)) problems.push(`${f.id}: station ${s.id} at ${s.x},${s.y} not walkable`);
    else if (!dists[f.id] || dists[f.id][s.y * f.width + s.x] < 0) problems.push(`${f.id}: station ${s.id} at ${s.x},${s.y} unreachable`);
    if (s.area) for (let y = s.area.y; y < s.area.y + s.area.h; y++) for (let x = s.area.x; x < s.area.x + s.area.w; x++)
      if (!f.walkable(x, y)) problems.push(`${f.id}: station ${s.id} area cell ${x},${y} not walkable`);
    counts[f.id] ||= {}; counts[f.id][s.chore] = (counts[f.id][s.chore] || 0) + 1;
  }
  for (const it of f.furniture) {
    if (!FURNITURE_SIZES[it.type]) problems.push(`${f.id}: unknown furniture type ${it.type} at ${it.x},${it.y}`);
    for (let y = it.y; y < it.y + it.h; y++) for (let x = it.x; x < it.x + it.w; x++) {
      if (x < 0 || y < 0 || x >= f.width || y >= f.height) problems.push(`${f.id}: ${it.type} at ${it.x},${it.y} out of bounds`);
      if (f.solidAt(x, y) && dc.has(`${x},${y}`)) problems.push(`${f.id}: solid ${it.type} covers door cell ${x},${y}`);
      if (f.solidAt(x, y) && stationCells.has(`${x},${y}`)) problems.push(`${f.id}: solid ${it.type} covers station ${stationCells.get(`${x},${y}`).id}`);
      const rm = f.roomAt(x, y);
      if (rm && rm.kind === 'void' && it.type !== 'railing') problems.push(`${f.id}: ${it.type} at ${x},${y} sits in void room ${rm.id}`);
      if (!rm && f.outside === 'roof') problems.push(`${f.id}: ${it.type} at ${x},${y} sits on the roof`);
    }
    if (f.stairTransfer && f.solidAt(f.stairTransfer[0], f.stairTransfer[1])) problems.push(`${f.id}: stairTransfer blocked`);
  }
  // every room with walkable cells must be reachable
  for (const rm of f.rooms) {
    if (rm.kind === 'void') continue;
    let reach = false, any = false;
    for (const rc of rm.rects) for (let y = rc.y; y < rc.y + rc.h; y++) for (let x = rc.x; x < rc.x + rc.w; x++) {
      if (f.roomAt(x, y) !== rm || !f.walkable(x, y)) continue;
      any = true;
      if (dists[f.id] && dists[f.id][y * f.width + x] >= 0) reach = true;
    }
    if (any && !reach) problems.push(`${f.id}: room ${rm.id} has no reachable cell`);
  }
}

// ASCII maps
for (const f of world.floorList) {
  const grid = Array.from({ length: f.height }, () => Array(f.width).fill(' '));
  for (let y = 0; y < f.height; y++) for (let x = 0; x < f.width; x++) {
    const rm = f.roomAt(x, y);
    grid[y][x] = rm ? (rm.kind === 'void' ? 'X' : rm.kind === 'outdoor' ? ',' : '.') : (f.outside === 'roof' ? ' ' : ',');
  }
  for (const it of f.furniture) for (let y = it.y; y < it.y + it.h; y++) for (let x = it.x; x < it.x + it.w; x++)
    if (x >= 0 && y >= 0 && x < f.width && y < f.height) grid[y][x] = f.solidAt(x, y) ? '#' : (it.type === 'rug' ? '~' : '=');
  for (const d of f.doors) { grid[d.a[1]][d.a[0]] = '+'; grid[d.b[1]][d.b[0]] = '+'; }
  for (const s of f.stations) grid[s.y][s.x] = s.chore[0].toUpperCase();
  if (f.stairTransfer) grid[f.stairTransfer[1]][f.stairTransfer[0]] = '^';
  if (f.spawn) grid[f.spawn[1]][f.spawn[0]] = '@';
  console.log(`\n== ${f.name} ==  (# solid  = non-solid furniture  ~ rug  + door  ^ stairs transfer  @ spawn  letters = station chore initial)`);
  console.log('    ' + Array.from({ length: f.width }, (_, x) => String(x % 10)).join(''));
  grid.forEach((row, y) => console.log(String(y).padStart(3) + ' ' + row.join('')));
  console.log('stations by chore:', Object.entries(counts[f.id] || {}).sort().map(([k, v]) => `${k}=${v}`).join(' '));
}
const total = {};
for (const c of Object.values(counts)) for (const [k, v] of Object.entries(c)) total[k] = (total[k] || 0) + v;
const missing = [...allChores].filter(c => !total[c]);
console.log('\nchores with zero stations:', missing.length ? missing.join(', ') : 'none');
console.log('total stations:', Object.values(total).reduce((a, b) => a + b, 0));
if (problems.length) { console.log('\nPROBLEMS:'); problems.forEach(p => console.log(' -', p)); process.exitCode = 1; }
else console.log('\nOK: floorplan valid');

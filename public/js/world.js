// World model: floorplan.json -> per-floor grids, walls, furniture solids,
// stations and A* pathfinding. Browser ES module, no dependencies (also
// importable from Node for tools/validate-floorplan.mjs).

export const TILE = 16;

// Natural sizes and defaults for the furniture vocabulary in docs/ARCHITECTURE.md.
// sit: agents stand/sit on it (non-solid by default). wall: decorative, non-solid.
export const FURNITURE_SIZES = {
  counter: { w: 1, h: 1 }, stove: { w: 1, h: 1 }, sink: { w: 1, h: 1 }, fridge: { w: 1, h: 1 },
  island: { w: 3, h: 1 }, dishwasher: { w: 1, h: 1 }, microwave: { w: 1, h: 1 },
  table: { w: 3, h: 2 }, chair: { w: 1, h: 1, sit: true }, stool: { w: 1, h: 1, sit: true },
  sofa: { w: 3, h: 1, sit: true }, loveseat: { w: 2, h: 1, sit: true }, armchair: { w: 1, h: 1, sit: true },
  coffee_table: { w: 2, h: 1 }, tv: { w: 2, h: 1 }, tv_stand: { w: 2, h: 1 }, fireplace: { w: 1, h: 2 },
  bookshelf: { w: 1, h: 1 }, plant: { w: 1, h: 1 }, lamp: { w: 1, h: 1 }, rug: { w: 2, h: 2, solid: false },
  painting: { w: 1, h: 1, solid: false },
  bed_king: { w: 3, h: 3, sit: true }, bed_queen: { w: 2, h: 3, sit: true }, bed_single: { w: 2, h: 3, sit: true },
  nightstand: { w: 1, h: 1 }, dresser: { w: 2, h: 1 }, wardrobe: { w: 1, h: 1 }, desk: { w: 2, h: 1 },
  office_chair: { w: 1, h: 1, sit: true }, computer: { w: 1, h: 1, solid: false },
  toilet: { w: 1, h: 1 }, vanity: { w: 1, h: 1 }, tub: { w: 2, h: 1 }, shower: { w: 1, h: 1 },
  towel_rack: { w: 1, h: 1, solid: false }, mirror: { w: 1, h: 1, solid: false },
  washer: { w: 1, h: 1 }, dryer: { w: 1, h: 1 }, laundry_basket: { w: 1, h: 1 }, shelves: { w: 1, h: 1 },
  bench: { w: 2, h: 1, sit: true }, coat_rack: { w: 1, h: 1 }, furnace: { w: 1, h: 1 }, water_heater: { w: 1, h: 1 },
  closet: { w: 2, h: 1 }, boxes: { w: 1, h: 1 },
  car: { w: 4, h: 2 }, workbench: { w: 2, h: 1 }, toolwall: { w: 2, h: 1, solid: false }, trash_bin: { w: 1, h: 1 },
  recycle_bin: { w: 1, h: 1 }, mower: { w: 1, h: 1 }, bike: { w: 1, h: 1 }, grill: { w: 1, h: 1 },
  patio_chair: { w: 1, h: 1, sit: true }, patio_table: { w: 1, h: 1 }, tree: { w: 2, h: 2, trunkOnly: true },
  bush: { w: 1, h: 1 }, flowerbed: { w: 3, h: 1 }, mailbox: { w: 1, h: 1 }, fence: { w: 1, h: 1 },
  stairs: { w: 2, h: 2, solid: false }, railing: { w: 1, h: 1, solid: false }, pool_table: { w: 3, h: 2 },
  beanbag: { w: 1, h: 1, sit: true }, doormat: { w: 1, h: 1, solid: false }, mat: { w: 1, h: 1, solid: false },
};

export const CHORES_BY_ACTIVITY = {
  read: ['desk', 'read', 'bookshelf', 'mail', 'pantry'],
  write: ['cook', 'chop', 'grill', 'workbench', 'fold', 'makebed', 'dishes'],
  bash: ['mow', 'trash', 'washcar', 'fix', 'laundry', 'vacuum', 'rake', 'dishes', 'scrub', 'workbench'],
  web: ['tv', 'phone', 'pool', 'desk'],
  agent: ['helper', 'water'],
  idle: ['sit', 'coffee', 'water'],
  nap: ['nap'],
  think: [],
};

const DIRS = {
  up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0],
};
const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

export function furnitureSize(type) {
  const s = FURNITURE_SIZES[type];
  return s ? { w: s.w, h: s.h } : { w: 1, h: 1 };
}

export function furnitureSolid(type) {
  const s = FURNITURE_SIZES[type];
  if (!s) return true;
  if (s.solid === false || s.sit) return false;
  return true;
}

function resolveItem(raw, floor) {
  const spec = FURNITURE_SIZES[raw.type] || {};
  const item = {
    type: raw.type,
    x: raw.x | 0, y: raw.y | 0,
    w: raw.w ?? spec.w ?? 1,
    h: raw.h ?? spec.h ?? 1,
    facing: raw.facing || 'down',
    solid: raw.solid !== undefined ? !!raw.solid : furnitureSolid(raw.type),
    sit: !!spec.sit,
    room: null,
  };
  const rm = floor.roomAt(item.x, item.y);
  item.room = rm ? rm.id : null;
  return item;
}

// Cells an item makes solid (trees: only the trunk row).
function solidCells(item) {
  const cells = [];
  if (!item.solid) return cells;
  const spec = FURNITURE_SIZES[item.type];
  const y0 = spec && spec.trunkOnly ? item.y + item.h - 1 : item.y;
  for (let y = y0; y < item.y + item.h; y++)
    for (let x = item.x; x < item.x + item.w; x++) cells.push([x, y]);
  return cells;
}

function buildFloor(plan, fp) {
  const W = plan.width, H = plan.height;
  const rooms = (fp.rooms || []).map(r => ({
    id: r.id, name: r.name, kind: r.kind || 'indoor', floor: r.floor || 'wood',
    stairs: !!r.stairs, rects: r.rects || [], cells: 0,
  }));
  const cellRoom = new Int16Array(W * H).fill(-1);
  rooms.forEach((rm, i) => {
    for (const rc of rm.rects)
      for (let y = rc.y; y < rc.y + rc.h; y++)
        for (let x = rc.x; x < rc.x + rc.w; x++)
          if (x >= 0 && y >= 0 && x < W && y < H) cellRoom[y * W + x] = i;
  });
  for (let i = 0; i < cellRoom.length; i++) if (cellRoom[i] >= 0) rooms[cellRoom[i]].cells++;

  const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const roomAt = (x, y) => inb(x, y) && cellRoom[y * W + x] >= 0 ? rooms[cellRoom[y * W + x]] : null;

  const openSet = new Set();
  for (const [a, b] of fp.open || []) { openSet.add(a + '|' + b); openSet.add(b + '|' + a); }

  // doors keyed by "x,y,dir" from both sides
  const doorMap = new Map();
  const doors = [];
  for (const d of fp.doors || []) {
    const [ax, ay] = d.a, [bx, by] = d.b;
    const dx = bx - ax, dy = by - ay;
    if (Math.abs(dx) + Math.abs(dy) !== 1) continue;
    const dir = dx === 1 ? 'right' : dx === -1 ? 'left' : dy === 1 ? 'down' : 'up';
    const ra = roomAt(ax, ay), rb = roomAt(bx, by);
    const indoor = (ra && ra.kind === 'indoor') || (rb && rb.kind === 'indoor');
    const door = { a: [ax, ay], b: [bx, by], kind: d.kind || 'door', indoor: !!indoor };
    doors.push(door);
    doorMap.set(`${ax},${ay},${dir}`, door);
    doorMap.set(`${bx},${by},${OPPOSITE[dir]}`, door);
  }
  const doorAt = (x, y, dir) => doorMap.get(`${x},${y},${dir}`) || null;

  const isOutdoorish = (rm) => rm ? rm.kind === 'outdoor' : fp.outside !== 'roof';

  // Wall between (x,y) and its neighbour in dir (ignores doors: doors are gaps in walls).
  const wallBetween = (x, y, dir) => {
    const [dx, dy] = DIRS[dir];
    const nx = x + dx, ny = y + dy;
    const ra = roomAt(x, y), rb = roomAt(nx, ny);
    if (!inb(nx, ny)) return !!ra && ra.kind === 'indoor';
    if (ra === rb) return false;
    const ida = ra ? ra.id : null, idb = rb ? rb.id : null;
    if (ida && idb && openSet.has(ida + '|' + idb)) return false;
    if (isOutdoorish(ra) && isOutdoorish(rb)) return false;
    return true;
  };
  const hasWall = (x, y, dir) => {
    if (!DIRS[dir]) return false;
    if (doorAt(x, y, dir)) return false;
    return wallBetween(x, y, dir);
  };

  // Edge list for rendering (right/down edges only, plus outer top/left borders)
  const edges = [];
  for (let y = -1; y < H; y++) {
    for (let x = -1; x < W; x++) {
      for (const dir of ['right', 'down']) {
        const [dx, dy] = DIRS[dir];
        const nx = x + dx, ny = y + dy;
        if (!inb(x, y) && !inb(nx, ny)) continue;
        // evaluate from whichever side is in bounds
        let wall, door, ra, rb;
        if (inb(x, y)) { wall = wallBetween(x, y, dir); door = doorAt(x, y, dir); ra = roomAt(x, y); rb = roomAt(nx, ny); }
        else { wall = wallBetween(nx, ny, OPPOSITE[dir]); door = doorAt(nx, ny, OPPOSITE[dir]); ra = roomAt(x, y); rb = roomAt(nx, ny); }
        if (!wall && !door) continue;
        const indoor = (ra && ra.kind === 'indoor') || (rb && rb.kind === 'indoor');
        edges.push({ x, y, dir, kind: door ? door.kind : 'wall', indoor: !!indoor });
      }
    }
  }

  const floor = {
    id: fp.id, name: fp.name, outside: fp.outside || 'lawn',
    rooms, doors, edges,
    stairTransfer: fp.stairTransfer ? [fp.stairTransfer[0], fp.stairTransfer[1]] : null,
    spawn: fp.spawn ? [fp.spawn[0], fp.spawn[1]] : null,
    frontDoor: fp.frontDoor ? [fp.frontDoor[0], fp.frontDoor[1]] : null,
    furniture: [], stations: [],
    width: W, height: H,
    roomAt, hasWall, doorAt,
  };

  floor.furniture = (fp.furniture || []).map(it => resolveItem(it, floor));
  const solid = new Uint8Array(W * H);
  const softCost = new Uint8Array(W * H); // non-solid furniture (sofas, beds, rugs) is walkable but discouraged
  for (const it of floor.furniture) {
    for (const [x, y] of solidCells(it)) if (inb(x, y)) solid[y * W + x] = 1;
    if (!it.solid && it.type !== 'rug' && it.type !== 'doormat' && it.type !== 'mat' && it.type !== 'stairs' && it.type !== 'computer' && it.type !== 'painting' && it.type !== 'toolwall' && it.type !== 'towel_rack' && it.type !== 'mirror')
      for (let y = it.y; y < it.y + it.h; y++) for (let x = it.x; x < it.x + it.w; x++) if (inb(x, y)) softCost[y * W + x] = 1;
  }
  floor.solidAt = (x, y) => inb(x, y) && solid[y * W + x] === 1;
  floor.walkable = (x, y) => {
    if (!inb(x, y)) return false;
    const rm = roomAt(x, y);
    if (rm ? rm.kind === 'void' : fp.outside === 'roof') return false;
    return solid[y * W + x] === 0;
  };
  floor.stepCost = (x, y) => (inb(x, y) && softCost[y * W + x]) ? 6 : 1;
  floor.labelPos = (room) => {
    let best = null;
    for (const rc of room.rects) if (!best || rc.w * rc.h > best.w * best.h) best = rc;
    return best ? { x: best.x + best.w / 2, y: best.y + best.h / 2 } : { x: 0, y: 0 };
  };
  floor.stations = (fp.stations || []).map(s => ({
    id: s.id, chore: s.chore, x: s.x | 0, y: s.y | 0, facing: s.facing || 'down',
    area: s.area ? { ...s.area } : undefined, floorId: fp.id, occupant: null,
    type: s.type || furnitureTypeAt(floor, s.x | 0, s.y | 0),
  }));
  return floor;
}

function furnitureTypeAt(floor, x, y) {
  for (const it of floor.furniture)
    if (x >= it.x && x < it.x + it.w && y >= it.y && y < it.y + it.h && it.type !== 'rug') return it.type;
  return undefined;
}

export function buildWorld(planJson) {
  const plan = planJson || {};
  const world = {
    tile: plan.tile || TILE, width: plan.width || 43, height: plan.height || 26, plan,
    floorList: [], floors: {}, mainFloor: null,
    otherFloor(floor) {
      const id = typeof floor === 'string' ? floor : floor && floor.id;
      return world.floorList.find(f => f.id !== id) || null;
    },
  };
  for (const fp of plan.floors || []) {
    try {
      const f = buildFloor(world, fp);
      world.floorList.push(f);
      world.floors[f.id] = f;
    } catch (e) {
      console.error('floor build failed', fp && fp.id, e);
    }
  }
  world.mainFloor = world.floors.main || world.floorList[0] || null;
  return world;
}

// ---------- pathfinding ----------

class MinHeap {
  constructor() { this.a = []; }
  push(n) { const a = this.a; a.push(n); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a; const top = a[0]; const last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l].f < a[m].f) m = l; if (r < a.length && a[r].f < a[m].f) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
  get size() { return this.a.length; }
}

function astar(floor, sx, sy, tx, ty) {
  if (!floor.walkable(tx, ty) || !floor.walkable(sx, sy)) return null;
  const W = floor.width, H = floor.height;
  const g = new Float32Array(W * H).fill(Infinity);
  const from = new Int32Array(W * H).fill(-1);
  const closed = new Uint8Array(W * H);
  const h = (x, y) => Math.abs(x - tx) + Math.abs(y - ty);
  const heap = new MinHeap();
  g[sy * W + sx] = 0;
  heap.push({ x: sx, y: sy, f: h(sx, sy) });
  while (heap.size) {
    const cur = heap.pop();
    const ci = cur.y * W + cur.x;
    if (closed[ci]) continue;
    closed[ci] = 1;
    if (cur.x === tx && cur.y === ty) {
      const path = [];
      let i = ci;
      while (i >= 0) { path.push({ x: i % W, y: (i / W) | 0 }); i = from[i]; }
      return path.reverse();
    }
    for (const dir in DIRS) {
      if (floor.hasWall(cur.x, cur.y, dir)) continue;
      const nx = cur.x + DIRS[dir][0], ny = cur.y + DIRS[dir][1];
      if (!floor.walkable(nx, ny)) continue;
      const ni = ny * W + nx;
      if (closed[ni]) continue;
      const ng = g[ci] + floor.stepCost(nx, ny);
      if (ng < g[ni]) { g[ni] = ng; from[ni] = ci; heap.push({ x: nx, y: ny, f: ng + h(nx, ny) }); }
    }
  }
  return null;
}

// BFS distances (in steps) from a cell, respecting walls/solids.
export function distanceMap(floor, sx, sy) {
  const W = floor.width, H = floor.height;
  const dist = new Int32Array(W * H).fill(-1);
  if (!floor.walkable(sx, sy)) return dist;
  const q = [sy * W + sx];
  dist[sy * W + sx] = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi], x = i % W, y = (i / W) | 0;
    for (const dir in DIRS) {
      if (floor.hasWall(x, y, dir)) continue;
      const nx = x + DIRS[dir][0], ny = y + DIRS[dir][1];
      if (!floor.walkable(nx, ny)) continue;
      const ni = ny * W + nx;
      if (dist[ni] >= 0) continue;
      dist[ni] = dist[i] + 1;
      q.push(ni);
    }
  }
  return dist;
}

// from/to = {floorId, x, y}. Returns [{floorId,x,y}] or null. Cross-floor via stairTransfer.
export function findPath(world, from, to) {
  const fa = world.floors[from.floorId], fb = world.floors[to.floorId];
  if (!fa || !fb) return null;
  const tag = (floor, p) => p.map(c => ({ floorId: floor.id, x: c.x, y: c.y }));
  if (fa === fb) {
    const p = astar(fa, from.x | 0, from.y | 0, to.x | 0, to.y | 0);
    return p ? tag(fa, p) : null;
  }
  if (!fa.stairTransfer || !fb.stairTransfer) return null;
  const p1 = astar(fa, from.x | 0, from.y | 0, fa.stairTransfer[0], fa.stairTransfer[1]);
  if (!p1) return null;
  const p2 = astar(fb, fb.stairTransfer[0], fb.stairTransfer[1], to.x | 0, to.y | 0);
  if (!p2) return null;
  return tag(fa, p1).concat(tag(fb, p2));
}

export function stationsFor(world, chore) {
  const out = [];
  for (const f of world.floorList) for (const s of f.stations) if (s.chore === chore) out.push(s);
  return out;
}

// chores: string[]; free station on preferFloor first (nearest by walking distance
// from `from` when given), then free on the other floor, then nearest occupied.
export function findStation(world, chores, preferFloorId, from) {
  const wanted = new Set(Array.isArray(chores) ? chores : [chores]);
  const pref = world.floors[preferFloorId] || world.mainFloor;
  if (!pref) return null;
  const other = world.otherFloor(pref);
  const dmaps = {};
  const distTo = (st) => {
    const f = world.floors[st.floorId];
    if (!from || !world.floors[from.floorId]) return 0;
    const ff = world.floors[from.floorId];
    if (f === ff) {
      dmaps[f.id] ||= distanceMap(f, from.x | 0, from.y | 0);
      const d = dmaps[f.id][st.y * f.width + st.x];
      return d < 0 ? 1e6 : d;
    }
    // other floor: distance to own stairs + distance from other stairs
    if (!ff.stairTransfer || !f.stairTransfer) return 1e6;
    dmaps[ff.id] ||= distanceMap(ff, from.x | 0, from.y | 0);
    const d1 = dmaps[ff.id][ff.stairTransfer[1] * ff.width + ff.stairTransfer[0]];
    const key = 'stairs:' + f.id;
    dmaps[key] ||= distanceMap(f, f.stairTransfer[0], f.stairTransfer[1]);
    const d2 = dmaps[key][st.y * f.width + st.x];
    if (d1 < 0 || d2 < 0) return 1e6;
    return d1 + d2 + 4;
  };
  const pick = (list) => {
    let best = null, bd = Infinity;
    for (const st of list) { const d = distTo(st); if (d < bd) { bd = d; best = st; } }
    return best;
  };
  const cand = (floor, free) => floor ? floor.stations.filter(s => wanted.has(s.chore) && (free ? !s.occupant : true)) : [];
  return pick(cand(pref, true)) || pick(cand(other, true)) || pick(cand(pref, false).concat(cand(other, false))) || null;
}

export function nearestWalkable(floor, x, y, maxR = 4) {
  x |= 0; y |= 0;
  if (floor.walkable(x, y)) return [x, y];
  for (let r = 1; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      if (floor.walkable(x + dx, y + dy)) return [x + dx, y + dy];
    }
  }
  return null;
}

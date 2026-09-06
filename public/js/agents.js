// Agent entities: chore assignment, state machine, movement, animation timers.
import { findPath, findStation, nearestWalkable, CHORES_BY_ACTIVITY } from './world.js';
import { TILE, makePalette, choreFx } from './sprites.js';

const SPEED = 2.0;          // tiles / s, before temperament
const SPEED_SMALL = 2.3;
const COMMIT_MS = { calm: 180000, normal: 110000, busy: 45000 };   // how long an agent sticks with a chore before switching
const STROLL_MS = { calm: 70000, normal: 120000, busy: 200000 };   // how often a resting agent wanders to another spot
const VERB = { read: 'reading', write: 'editing', bash: 'running a command', web: 'browsing the web', agent: 'delegating', error: 'hit a snag', think: 'thinking' };
const DEBOUNCE_MS = 2500;   // activity must be stable this long before the chore changes
const BUBBLE_MS = 6000;
const FADE_S = 0.6;
const MAX_PARTICLES = 40;

const SIT_CHORES = new Set(['tv', 'phone', 'read', 'sit', 'coffee', 'desk', 'eat']);
const AREA_CHORES = new Set(['mow', 'vacuum', 'rake']);
const REST_KEYS = new Set(['idle', 'nap']);

const rnd = (x) => Math.round(x);
const sameCell = (a, b) => a && b && a.x === b.x && a.y === b.y && a.floorId === b.floorId;

function choresForKey(key) {
  if (key === 'idle') return CHORES_BY_ACTIVITY.idle || ['sit'];
  if (key === 'nap') return CHORES_BY_ACTIVITY.nap || ['nap'];
  return CHORES_BY_ACTIVITY[key] || [];
}

class Agent {
  constructor(info, world, mgr) {
    this.id = info.id;
    this.info = info;
    this.world = world;
    this.mgr = mgr;
    this.small = !!info.isSubagent;
    this.palette = makePalette(info.isSubagent && info.parentId ? info.parentId : info.id);

    const floor = world.mainFloor || world.floorList?.[0];
    this.floorId = floor.id;
    const spawn = floor.spawn || nearestWalkable(floor, 0, Math.floor(world.height / 2), 60) || [0, 0];
    this.x = spawn[0]; this.y = spawn[1];
    this.px = 0; this.py = 0;
    this.facing = 'left';
    this.state = 'arriving';
    this.chore = null;
    this.station = null;
    this.pose = 'walk';
    this.frame = 0;
    this.animT = Math.random() * 10;
    this.bubble = null;
    this.particles = [];
    this.enteredAt = Date.now();
    this.alpha = 1;
    this.path = [];
    this.sweep = null;
    this.room = null;
    this.key = null;            // committed behaviour key
    this.pendingKey = null;
    this.pendingSince = 0;
    this.fx = null;
    this.fxAcc = 0;
    this.leaveStage = 0;
    this.restBubbled = false;
    this.lastTool = null;
    this.lastDetail = null;
    const h = parseInt(this.id.replace(/[^0-9a-f]/gi, '').slice(-4) || '0', 16);
    this.temperament = ['calm', 'normal', 'normal', 'busy'][h % 4];
    this.speedMul = { calm: 0.7, normal: 0.95, busy: 1.35 }[this.temperament] + ((h % 100) / 100) * 0.15;
    this.committedUntil = 0;
    this.nextStrollAt = 0;
    this.holdUntil = mgr.nextArrivalSlot();
    this.alpha = 0;
    this.updatePx();

    const door = floor.frontDoor;
    if (door && !this.goTo({ floorId: floor.id, x: door[0], y: door[1] })) {
      this.x = door[0]; this.y = door[1];
    }
    if (!door) this.state = 'walking';
  }

  get floor() { return this.world.floors?.[this.floorId] || this.world.mainFloor; }
  get cell() { return { floorId: this.floorId, x: rnd(this.x), y: rnd(this.y) }; }

  updatePx() {
    this.px = Math.round((this.x + 0.5) * TILE);
    this.py = Math.round((this.y + 1) * TILE);
  }

  setInfo(info) {
    const prev = this.info;
    this.info = info;
    if (info.status === 'working' && (info.tool !== this.lastTool || info.toolDetail !== this.lastDetail)) {
      this.lastTool = info.tool; this.lastDetail = info.toolDetail;
      if (info.tool && info.activity !== prev.activity) {
        const text = info.activity === 'error' ? `⚠ ${VERB.error}` : (VERB[info.activity] || info.activity);
        this.bubble = { text, until: Date.now() + BUBBLE_MS };
      }
    } else if (info.activity === 'error' && prev.activity !== 'error') {
      this.bubble = { text: `⚠ ${VERB.error}`, until: Date.now() + BUBBLE_MS };
    }
    if (info.status !== 'idle') this.restBubbled = false;
  }

  // ---------- behaviour keys ----------
  desiredKey(now) {
    const s = this.info.status;
    if (s === 'gone') return 'gone';
    if (s === 'idle') {
      const idleFor = now - (this.info.lastActivityAt || now);
      return idleFor > this.mgr.napAfterMs ? 'nap' : 'idle';
    }
    if (s === 'thinking') return 'think';
    const a = this.info.activity;
    if (!a || a === 'think' || a === 'idle' || a === 'error') return this.key && this.key !== 'gone' && this.key !== 'think' ? this.key : 'think';
    return a;
  }

  decide(now) {
    if (this.state === 'arriving' || this.state === 'leaving' || this.state === 'gone') return;
    let want = this.desiredKey(now);
    // a freshly arrived agent that is only thinking heads for a seat first instead of pondering on the porch
    if (want === 'think' && !this.station) want = 'idle';
    if (want !== this.pendingKey) { this.pendingKey = want; this.pendingSince = now; }
    if (want === this.key) { this.maybeStroll(now); return; }
    const immediate = want === 'gone' || this.key === null;
    const restWanted = REST_KEYS.has(want) || want === 'think';
    // working agents stick with their current chore for a while: fewer laps around the house
    if (!immediate && !restWanted && this.station && this.state === 'chore' && now < this.committedUntil) return;
    if (!immediate && now - this.pendingSince < DEBOUNCE_MS) {
      // stop chore animation the moment the session goes quiet; the walk to the couch follows after the debounce
      if ((REST_KEYS.has(want) || want === 'think') && this.state === 'chore' && this.pose === 'work') { this.pose = 'stand'; this.fx = null; this.stopSweep(); this.path = []; }
      return;
    }
    this.commit(want, now);
  }

  commit(key, now) {
    if (key === 'gone') { this.key = key; this.startLeaving(); return; }
    if (key === 'think') {
      this.key = key;
      this.stopSweep();
      this.path = [];
      this.state = 'thinking';
      this.pose = 'think';
      this.bubble = { text: '…', until: Infinity };
      return;
    }
    if (this.bubble && this.bubble.until === Infinity) this.bubble = null;
    const chores = choresForKey(key);
    this.key = key;

    if (this.station && chores.includes(this.station.chore)) {
      // Same chore family: keep the station. Resume if we were paused there.
      if (this.atStation()) this.arriveAtStation();
      else if (!this.path.length) this.walkToStation();
      return;
    }

    let st = findStation(this.world, chores, this.floorId, this.cell);
    if (!st && !REST_KEYS.has(key)) st = findStation(this.world, choresForKey('idle'), this.floorId, this.cell);
    this.releaseStation();
    this.stopSweep();
    if (!st) {
      // Nowhere to go: rest or work in place, but never chore-animate while idle.
      this.path = [];
      this.chore = null;
      this.state = REST_KEYS.has(key) ? 'resting' : 'chore';
      this.pose = key === 'nap' ? 'sleep' : REST_KEYS.has(key) ? 'stand' : 'work';
      return;
    }
    st.occupant = this.id;
    this.station = st;
    this.chore = st.chore;
    this.fx = null;
    this.committedUntil = now + COMMIT_MS[this.temperament] * (0.7 + Math.random() * 0.6);
    this.nextStrollAt = now + STROLL_MS[this.temperament] * (0.6 + Math.random() * 0.8);
    this.walkToStation();
  }

  walkToStation() {
    const st = this.station;
    this.state = 'walking';
    this.pose = 'walk';
    if (!this.goTo({ floorId: st.floorId, x: st.x, y: st.y })) {
      // unreachable: teleport rather than stand confused forever
      this.floorId = st.floorId; this.x = st.x; this.y = st.y; this.path = [];
      this.arriveAtStation();
    }
  }

  atStation() {
    const st = this.station;
    return !!st && !this.path.length && this.floorId === st.floorId && rnd(this.x) === st.x && rnd(this.y) === st.y;
  }

  arriveAtStation() {
    const st = this.station;
    if (!st) return;
    this.strolling = false;
    this.x = st.x; this.y = st.y;
    if (st.facing) this.facing = st.facing;
    const rest = REST_KEYS.has(this.key);
    this.state = rest ? 'resting' : 'chore';
    this.stopSweep();
    if (this.key === 'nap') {
      this.pose = 'sleep';
    } else if (rest) {
      this.pose = SIT_CHORES.has(st.chore) ? 'sit' : 'stand';
      if (!this.restBubbled) { this.restBubbled = true; this.bubble = { text: '☕', until: Date.now() + 4000 }; }
    } else if (AREA_CHORES.has(st.chore) && st.area) {
      this.startSweep(st.area);
    } else {
      this.pose = SIT_CHORES.has(st.chore) ? 'sit' : 'work';
    }
    this.fx = rest ? null : (choreFx(st.chore) || null);
  }

  releaseStation() {
    if (this.station && this.station.occupant === this.id) this.station.occupant = null;
    this.station = null;
    this.chore = null;
    this.fx = null;
  }

  startLeaving() {
    this.releaseStation();
    this.stopSweep();
    this.bubble = { text: '👋', until: Date.now() + 3000 };
    this.state = 'leaving';
    this.pose = 'walk';
    this.leaveStage = 0;
    const floor = this.world.mainFloor || this.floor;
    const door = floor.frontDoor;
    if (door && this.goTo({ floorId: floor.id, x: door[0], y: door[1] })) return;
    this.leaveStage = 1;
    const spawn = floor.spawn;
    if (!(spawn && this.goTo({ floorId: floor.id, x: spawn[0], y: spawn[1] }))) { this.leaveStage = 2; this.path = []; }
  }

  // ---------- movement ----------
  goTo(target) {
    if (!target) return false;
    let p = null;
    try { p = findPath(this.world, this.cell, target); } catch (e) { console.warn('findPath failed', e); }
    if (!p || !p.length) { this.path = []; return false; }
    if (sameCell(p[0], this.cell)) p = p.slice(1);
    this.path = p;
    return true;
  }

  moveAlong(dt, speed) {
    let budget = speed * dt;
    while (budget > 0 && this.path.length) {
      const t = this.path[0];
      if (t.floorId !== this.floorId) {
        // stairs hop
        this.floorId = t.floorId; this.x = t.x; this.y = t.y; this.path.shift();
        continue;
      }
      const dx = t.x - this.x, dy = t.y - this.y;
      const d = Math.hypot(dx, dy);
      if (Math.abs(dx) > Math.abs(dy)) this.facing = dx > 0 ? 'right' : 'left';
      else if (dy !== 0) this.facing = dy > 0 ? 'down' : 'up';
      if (d <= budget) { this.x = t.x; this.y = t.y; budget -= d; this.path.shift(); }
      else { this.x += (dx / d) * budget; this.y += (dy / d) * budget; budget = 0; }
    }
  }

  onPathEnd() {
    switch (this.state) {
      case 'arriving':
        this.state = 'walking';
        this.pose = 'stand';
        this.key = null; // decide() picks a station immediately
        break;
      case 'walking':
        if (this.station) this.arriveAtStation();
        else this.pose = 'stand';
        break;
      case 'leaving': {
        const floor = this.world.mainFloor || this.floor;
        if (this.leaveStage === 0) {
          this.leaveStage = 1;
          const spawn = floor.spawn;
          if (spawn && this.goTo({ floorId: floor.id, x: spawn[0], y: spawn[1] })) break;
        }
        this.leaveStage = 2;
        break;
      }
      default: break;
    }
  }

  // ---------- area sweeps (mow / vacuum / rake) ----------
  startSweep(area) {
    const floor = this.world.floors?.[this.station.floorId] || this.floor;
    const cells = [];
    for (let y = area.y; y < area.y + area.h; y++) {
      const row = [];
      for (let x = area.x; x < area.x + area.w; x++) if (floor.walkable(x, y)) row.push({ floorId: floor.id, x, y });
      if ((y - area.y) % 2 === 1) row.reverse();
      cells.push(...row);
    }
    if (cells.length < 2) { this.pose = 'work'; return; }
    this.sweep = { cells, i: 0, dir: 1 };
    this.pose = 'walk';
  }

  // resting agents occasionally get up and amble to another rest spot
  maybeStroll(now) {
    if (this.key !== 'idle' || this.state !== 'resting' || now < this.nextStrollAt) return;
    this.nextStrollAt = now + STROLL_MS[this.temperament] * (0.6 + Math.random() * 0.8);
    const st = findStation(this.world, choresForKey('idle'), this.floorId, this.cell);
    if (!st || st === this.station || st.occupant) return;
    this.releaseStation();
    st.occupant = this.id;
    this.station = st;
    this.chore = st.chore;
    this.strolling = true;
    this.walkToStation();
  }

  stopSweep() { this.sweep = null; }

  advanceSweep() {
    const s = this.sweep;
    if (!s) return;
    s.i += s.dir;
    if (s.i >= s.cells.length) { s.i = s.cells.length - 2; s.dir = -1; }
    if (s.i < 0) { s.i = 1; s.dir = 1; }
    const t = s.cells[s.i];
    const here = this.cell;
    const adjacent = Math.abs(t.x - here.x) + Math.abs(t.y - here.y) <= 1 && t.floorId === here.floorId;
    if (adjacent) this.path = [t];
    else if (!this.goTo(t)) { this.x = t.x; this.y = t.y; }
    this.pose = 'walk';
  }

  // ---------- particles ----------
  updateParticles(dt, now) {
    const fx = this.fx;
    const active = fx && (this.state === 'chore') && this.pose !== 'think';
    if (active) {
      this.fxAcc += dt * 1000;
      const every = Math.max(30, fx.every || 250);
      while (this.fxAcc >= every) {
        this.fxAcc -= every;
        if (this.particles.length >= MAX_PARTICLES) break;
        try {
          const p = fx.spawn(this.px, this.py - 8, Math.random);
          if (p) { if (p.maxLife == null) p.maxLife = p.life; this.particles.push(p); }
        } catch (e) { this.fx = null; break; }
      }
    } else this.fxAcc = 0;
    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.x += (p.vx || 0) * dt;
      p.y += (p.vy || 0) * dt;
      // life may be authored in seconds or ms; treat > 20 as ms
      p.life -= (p.maxLife > 20 ? dt * 1000 : dt);
      if (p.life <= 0) { ps[i] = ps[ps.length - 1]; ps.pop(); }
    }
  }

  // ---------- per frame ----------
  update(dt, now) {
    if (this.state === 'gone') return;
    if (this.holdUntil) {
      if (now < this.holdUntil && this.info.status !== 'gone') return;
      this.holdUntil = 0;
      this.alpha = 1;
    }
    this.animT += dt;
    this.decide(now);
    if (this.state === 'gone') return;

    const speed = (this.small ? SPEED_SMALL : SPEED) * this.speedMul * (this.strolling ? 0.6 : 1);
    if (this.path.length) {
      this.pose = 'walk';
      this.moveAlong(dt, speed);
      if (!this.path.length) {
        if (this.sweep) this.advanceSweep();
        else this.onPathEnd();
      }
    } else if (this.sweep) {
      this.advanceSweep();
    }

    if (this.state === 'leaving' && this.leaveStage === 2) {
      this.alpha -= dt / FADE_S;
      if (this.alpha <= 0) { this.alpha = 0; this.state = 'gone'; }
    }

    switch (this.pose) {
      case 'walk': this.frame = Math.floor(this.animT * 8) % 4; break;
      case 'work': this.frame = Math.floor(this.animT * 5) % 4; break;
      case 'think': this.frame = Math.floor(this.animT * 1.5) % 4; break;
      case 'sleep': this.frame = Math.floor(this.animT * 0.8) % 4; break;
      default: this.frame = Math.floor(this.animT * 2) % 4; break;
    }

    if (this.bubble && now > this.bubble.until) this.bubble = null;
    this.updateParticles(dt, now);
    this.updatePx();
    const fl = this.floor;
    this.room = fl?.roomAt ? fl.roomAt(rnd(this.x), rnd(this.y)) : null;
  }
}

export class AgentManager {
  constructor(world) {
    this.world = world;
    this.agents = new Map();
    this.config = {};
    this.listeners = { arrive: [], leave: [] };
  }

  get napAfterMs() { return (Number(this.config.napAfterMin) || 8) * 60000; }

  // arrivals are spaced out so a burst of sessions walks in as a line, not a stack
  nextArrivalSlot() {
    const now = Date.now();
    this.lastSlot = Math.max(now, (this.lastSlot || 0) + 700);
    return this.lastSlot;
  }

  on(evt, fn) { (this.listeners[evt] ||= []).push(fn); return this; }
  emit(evt, a) { for (const fn of this.listeners[evt] || []) { try { fn(a); } catch (e) { console.warn(e); } } }

  upsert(info) {
    if (!info || !info.id) return;
    let a = this.agents.get(info.id);
    if (!a) {
      if (info.status === 'gone') return;
      a = new Agent(info, this.world, this);
      this.agents.set(info.id, a);
      this.emit('arrive', a);
    } else {
      a.setInfo(info);
    }
  }

  applySnapshot(list) {
    const seen = new Set();
    for (const info of list || []) { seen.add(info.id); this.upsert(info); }
    for (const a of this.agents.values()) {
      if (!seen.has(a.id) && a.info.status !== 'gone') a.setInfo({ ...a.info, status: 'gone' });
    }
  }

  applyUpdate(list, removed) {
    for (const info of list || []) this.upsert(info);
    for (const id of removed || []) {
      const a = this.agents.get(id);
      if (a && a.info.status !== 'gone') a.setInfo({ ...a.info, status: 'gone' });
    }
  }

  update(dt, now) {
    for (const a of this.agents.values()) {
      const wasLeaving = a.state === 'leaving';
      a.update(dt, now);
      if (!wasLeaving && a.state === 'leaving') this.emit('leave', a);
      if (a.state === 'gone') { a.releaseStation(); this.agents.delete(a.id); }
    }
  }

  get list() { return [...this.agents.values()]; }

  hitTest(floorId, wx, wy, pad = 0) {
    let best = null;
    for (const a of this.agents.values()) {
      if (a.floorId !== floorId || a.state === 'gone') continue;
      const h = a.small ? 16 : 20;
      if (Math.abs(wx - a.px) <= 7 + pad && wy >= a.py - h - pad && wy <= a.py + 2 + pad) {
        if (!best || a.py > best.py) best = a;
      }
    }
    return best;
  }

  floorsInUse() {
    const s = new Set();
    for (const a of this.agents.values()) if (a.state !== 'gone') s.add(a.floorId);
    return s;
  }
}

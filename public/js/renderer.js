// Draws the world edge to edge like a security camera feed: a primary floor filling the viewport,
// an optional picture-in-picture inset for the other floor, crisp screen-space overlays.
import { TILE, drawFloorTile, drawWallEdge, drawFurniture, drawFurnitureFront, drawCharacter, drawParticle, drawStairs, CHORE_LABEL } from './sprites.js';

const ANIMATED = new Set(['tv', 'washer', 'dryer', 'fireplace', 'computer', 'lamp']);
const GLOW = { lamp: ['#ffd27a', 60], tv: ['#9fc4ff', 70], fireplace: ['#ffa24d', 80], computer: ['#a9d4ff', 40] };
const SIT_TYPES = new Set(['sofa', 'loveseat', 'armchair', 'bed_king', 'bed_queen', 'bed_single']);
const FONT = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const MAX_CROP = 1.5 * TILE;   // how much lawn may be cropped per side when filling the screen

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return { c, ctx };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function createRenderer(canvas, world) {
  const ctx = canvas.getContext('2d');
  const W = world.width * TILE, H = world.height * TILE;
  const layers = {};
  const layout = { floors: [] };
  let cssW = 0, cssH = 0, dpr = 1;

  function buildStatic(floor) {
    const { c, ctx: g } = makeCanvas(W, H);
    for (let y = 0; y < floor.height; y++)
      for (let x = 0; x < floor.width; x++) {
        const rm = floor.roomAt(x, y);
        drawFloorTile(g, rm ? rm.floor : floor.outside, x, y);
      }
    for (const rm of floor.rooms) if (rm.stairs) drawStairs(g, rm, floor);
    for (const item of floor.furniture) if (!item.solid && !ANIMATED.has(item.type)) drawFurniture(g, item, 0);
    for (const item of floor.furniture) if (item.solid && !ANIMATED.has(item.type)) drawFurniture(g, item, 0);
    for (const e of floor.edges) drawWallEdge(g, e);
    return c;
  }

  function layerFor(floor) {
    let l = layers[floor.id];
    if (!l) { l = { static: buildStatic(floor), frame: makeCanvas(W, H), k: 1 }; layers[floor.id] = l; }
    return l;
  }

  // frame buffer at an integer multiple k >= target scale, then downsampled: crisp pixels at any fit
  function frameFor(l, scale) {
    const k = Math.min(4, Math.max(1, Math.ceil(scale - 0.001)));
    if (l.k !== k) { l.frame = makeCanvas(W * k, H * k); l.k = k; }
    return l.frame;
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    cssW = canvas.clientWidth || window.innerWidth;
    cssH = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
  }

  // view.mode: { primary, pip, split }
  function computeLayout(mode) {
    const floors = [];
    if (mode.split) {
      const gap = 12, m = 12;
      const availW = cssW - m * 2, availH = cssH - m * 2;
      const side = Math.min(availW / (2 * W + gap), availH / H);
      const stack = Math.min(availW / W, availH / (2 * H + gap));
      const horizontal = side >= stack;
      const s = horizontal ? side : stack;
      const totalW = horizontal ? (2 * W + gap) * s : W * s, totalH = horizontal ? H * s : (2 * H + gap) * s;
      const ox = (cssW - totalW) / 2, oy = (cssH - totalH) / 2;
      ['main', 'upper'].forEach((id, i) => floors.push({
        id, scale: s, x: horizontal ? ox + i * (W + gap) * s : ox, y: horizontal ? oy : oy + i * (H + gap) * s, w: W * s, h: H * s, pip: false,
      }));
    } else {
      const contain = Math.min(cssW / W, cssH / H);
      const cover = Math.max(cssW / W, cssH / H);
      const s = Math.max(contain, Math.min(cover, cssW / (W - 2 * MAX_CROP), cssH / (H - 2 * MAX_CROP)));
      floors.push({ id: mode.primary, scale: s, x: (cssW - W * s) / 2, y: (cssH - H * s) / 2, w: W * s, h: H * s, pip: false });
      if (mode.pip) {
        const pw = Math.round(Math.min(cssW * 0.28, 520)), ps = pw / W, ph = H * ps, m = 16;
        floors.push({ id: mode.pip, scale: ps, x: cssW - pw - m, y: cssH - ph - m, w: pw, h: ph, pip: true });
      }
    }
    layout.floors = floors;
  }

  function drawDynamic(floor, g, view) {
    const { agents, tick } = view;
    for (const item of floor.furniture) if (ANIMATED.has(item.type)) drawFurniture(g, item, tick);
    const onFloor = agents.filter(a => a.floorId === floor.id && a.state !== 'gone').sort((a, b) => a.py - b.py);
    const solids = floor.furniture.filter(i => i.solid);
    for (const a of onFloor) {
      g.globalAlpha = a.alpha ?? 1;
      drawCharacter(g, { x: a.px, y: a.py, facing: a.facing, frame: a.frame, pose: a.pose, chore: a.chore, palette: a.palette, small: a.small, tick, id: a.id });
      g.globalAlpha = 1;
      const top = a.py - 22, left = a.px - 8, right = a.px + 8;
      for (const it of solids) {
        const bx = it.x * TILE, by = it.y * TILE, bw = it.w * TILE, bh = it.h * TILE;
        if (by + bh > a.py + 1 && by < a.py && bx < right && bx + bw > left && by + bh > top) drawFurniture(g, it, tick);
      }
      const tx = Math.round(a.x), ty = Math.round(a.y);
      for (const it of floor.furniture) {
        if (!SIT_TYPES.has(it.type)) continue;
        if (tx >= it.x && tx < it.x + it.w && ty >= it.y && ty < it.y + it.h) drawFurnitureFront(g, it, tick);
      }
    }
    for (const a of onFloor) for (const p of a.particles) drawParticle(g, p);
    if (view.night) {
      g.save();
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = 'rgba(27,35,64,0.42)';
      g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'screen';
      for (const it of floor.furniture) {
        const gl = GLOW[it.type];
        if (!gl) continue;
        const cx = (it.x + it.w / 2) * TILE, cy = (it.y + it.h / 2) * TILE, r = gl[1];
        const grad = g.createRadialGradient(cx, cy, 2, cx, cy, r);
        grad.addColorStop(0, gl[0]); grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.globalAlpha = 0.45; g.fillStyle = grad;
        g.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
      g.restore();
      g.globalAlpha = 1;
    }
  }

  const screenPos = (fl, wx, wy) => ({ x: fl.x + wx * fl.scale, y: fl.y + wy * fl.scale });

  function tagFor(a) {
    return { name: a.info.name || '?', where: a.info.tmux?.session || a.info.project || '' };
  }

  function drawAgentOverlays(fl, view) {
    const { agents, selectedId, hoverId, now } = view;
    const onFloor = agents.filter(a => a.floorId === fl.id && a.state !== 'gone');
    for (const a of onFloor) {
      const p = screenPos(fl, a.px, a.py);
      const s = fl.scale;
      const isSel = a.id === selectedId, isHover = a.id === hoverId;
      if (isSel || isHover) {
        const pulse = isSel ? 1 + 0.12 * Math.sin(now / 180) : 1;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y + 1 * s, 9 * s * pulse, 4 * s * pulse, 0, 0, Math.PI * 2);
        ctx.strokeStyle = isSel ? 'rgba(79,109,245,0.95)' : 'rgba(79,109,245,0.5)';
        ctx.lineWidth = isSel ? 2 : 1.5;
        ctx.stroke();
      }
      if (fl.pip && !isSel) continue;   // the inset stays clean: only a selected agent gets a tag
      ctx.globalAlpha = a.alpha ?? 1;
      const { name, where } = tagFor(a);
      const sub = where ? ` · ${where}` : '';
      ctx.font = `600 11px ${FONT}`;
      const nw = ctx.measureText(name).width;
      ctx.font = `400 11px ${FONT}`;
      const sw = ctx.measureText(sub).width;
      const tw = nw + sw + 12, ty = p.y + 4 * s + 9;
      ctx.fillStyle = 'rgba(255,255,255,0.86)';
      roundRect(ctx, p.x - tw / 2, ty - 8, tw, 16, 8); ctx.fill();
      ctx.textAlign = 'left';
      ctx.fillStyle = '#1f2937'; ctx.font = `600 11px ${FONT}`;
      ctx.fillText(name, p.x - tw / 2 + 6, ty + 0.5);
      ctx.fillStyle = '#6b7280'; ctx.font = `400 11px ${FONT}`;
      ctx.fillText(sub, p.x - tw / 2 + 6 + nw, ty + 0.5);
      if (a.bubble && a.bubble.text) {
        let text = String(a.bubble.text);
        if (text.length > 28) text = text.slice(0, 27) + '…';
        ctx.font = `500 11px ${FONT}`;
        const bw = ctx.measureText(text).width + 14;
        const bx = p.x - bw / 2, by = p.y - (a.small ? 16 : 20) * s - 24;
        ctx.fillStyle = 'rgba(255,255,255,0.96)'; ctx.strokeStyle = 'rgba(17,24,39,0.12)'; ctx.lineWidth = 1;
        roundRect(ctx, bx, by, bw, 20, 7); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(p.x - 4, by + 20); ctx.lineTo(p.x, by + 25); ctx.lineTo(p.x + 4, by + 20); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#1f2937'; ctx.textAlign = 'center';
        ctx.fillText(text, p.x, by + 10.5);
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawRoomLabels(fl, floor) {
    ctx.font = `600 10px ${FONT}`;
    ctx.textAlign = 'center';
    for (const rm of floor.rooms) {
      if (rm.kind === 'void' || rm.cells < 6) continue;
      if (!rm.rects.some(r => r.w > 1 && r.h > 1)) continue;
      const lp = floor.labelPos ? floor.labelPos(rm) : null;
      if (!lp) continue;
      const p = screenPos(fl, (lp.x + 0.5) * TILE, (lp.y + 0.5) * TILE);
      const label = rm.name.toUpperCase();
      const tw = ctx.measureText(label).width + 10;
      ctx.fillStyle = 'rgba(255,255,255,0.72)';
      roundRect(ctx, p.x - tw / 2, p.y - 8, tw, 16, 4); ctx.fill();
      ctx.fillStyle = 'rgba(55,65,81,0.85)';
      ctx.fillText(label, p.x, p.y + 0.5);
    }
  }

  function camLabel(fl) {
    return `CAM ${fl.id === 'main' ? '01' : '02'} · ${world.floors[fl.id].name.toUpperCase()}`;
  }

  // CCTV-style stamp at the top centre: REC dot, camera, date and time
  function drawStamp(view) {
    const fl = layout.floors.find(f => !f.pip) || layout.floors[0];
    const d = new Date(view.now);
    const pad = (n) => String(n).padStart(2, '0');
    const text = `${camLabel(fl)}   ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}  ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    ctx.font = `600 12px ${MONO}`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const tw = ctx.measureText(text).width + 34;
    const x = (cssW - tw) / 2, y = 14;
    ctx.fillStyle = 'rgba(17,24,39,0.72)';
    roundRect(ctx, x, y, tw, 26, 6); ctx.fill();
    const blink = Math.floor(view.now / 700) % 2 === 0;
    ctx.fillStyle = blink ? '#ef4444' : 'rgba(239,68,68,0.35)';
    ctx.beginPath(); ctx.arc(x + 14, y + 13, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f9fafb';
    ctx.fillText(text, x + 26, y + 13.5);
  }

  function render(view) {
    computeLayout(view.mode);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#e9ebe6';
    ctx.fillRect(0, 0, cssW, cssH);
    ctx.imageSmoothingEnabled = false;
    for (const fl of layout.floors) {
      const floor = world.floors[fl.id];
      const l = layerFor(floor);
      const fb = frameFor(l, fl.scale);
      const g = fb.ctx;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      g.imageSmoothingEnabled = false;
      g.drawImage(l.static, 0, 0, W * l.k, H * l.k);
      g.setTransform(l.k, 0, 0, l.k, 0, 0);
      drawDynamic(floor, g, view);
      g.setTransform(1, 0, 0, 1, 0, 0);
      ctx.save();
      if (fl.pip) {
        ctx.shadowColor = 'rgba(17,24,39,0.35)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 8;
        ctx.fillStyle = '#111827';
        roundRect(ctx, fl.x - 3, fl.y - 3, fl.w + 6, fl.h + 6, 8); ctx.fill();
        ctx.restore(); ctx.save();
        roundRect(ctx, fl.x, fl.y, fl.w, fl.h, 5); ctx.clip();
      } else if (view.mode.split) {
        ctx.shadowColor = 'rgba(17,24,39,0.18)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 8;
        ctx.fillStyle = '#e4e6e0'; ctx.fillRect(fl.x, fl.y, fl.w, fl.h);
        ctx.restore(); ctx.save();
      }
      const integer = Math.abs(fl.scale - Math.round(fl.scale)) < 0.01;
      ctx.imageSmoothingEnabled = !integer;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(fb.c, 0, 0, W * l.k, H * l.k, fl.x, fl.y, fl.w, fl.h);
      ctx.imageSmoothingEnabled = false;
      ctx.restore();
      // overlays per floor right after its image, so a primary floor's tags never spill over the inset
      ctx.textBaseline = 'middle';
      if (view.showLabels && !fl.pip) drawRoomLabels(fl, world.floors[fl.id]);
      drawAgentOverlays(fl, view);
      if (fl.pip || view.mode.split) {
        ctx.font = `600 11px ${MONO}`;
        ctx.textAlign = 'left';
        const label = camLabel(fl);
        const tw = ctx.measureText(label).width + 16;
        ctx.fillStyle = 'rgba(17,24,39,0.72)';
        roundRect(ctx, fl.x + 8, fl.y + 8, tw, 20, 5); ctx.fill();
        ctx.fillStyle = '#f9fafb';
        ctx.fillText(label, fl.x + 16, fl.y + 18.5);
      }
    }
    drawStamp(view);
  }

  function screenToWorld(sx, sy) {
    const order = [...layout.floors].sort((a, b) => (b.pip ? 1 : 0) - (a.pip ? 1 : 0));   // insets sit on top
    for (const fl of order) {
      if (sx < fl.x || sy < fl.y || sx >= fl.x + fl.w || sy >= fl.y + fl.h) continue;
      const wx = (sx - fl.x) / fl.scale, wy = (sy - fl.y) / fl.scale;
      return { floorId: fl.id, x: Math.floor(wx / TILE), y: Math.floor(wy / TILE), wx, wy, pip: fl.pip };
    }
    return null;
  }

  function worldToScreen(floorId, wx, wy) {
    const fl = layout.floors.find(f => f.id === floorId);
    if (!fl) return null;
    return { x: fl.x + wx * fl.scale, y: fl.y + wy * fl.scale, scale: fl.scale };
  }

  resize();
  return { resize, render, screenToWorld, worldToScreen, layout, choreLabel: (c) => CHORE_LABEL[c] || c };
}

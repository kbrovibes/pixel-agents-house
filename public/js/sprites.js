// Procedural pixel art for Pixel Agents House. Everything is fillRect on a
// 16px tile grid; no image assets. See docs/ARCHITECTURE.md for the API.

export const TILE = 16;

export function hashString(s) {
  let h = 2166136261 >>> 0;
  const str = String(s ?? '');
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
const hash2 = (x, y, salt = 0) => {
  let h = (x * 374761393 + y * 668265263 + salt * 1442695041) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
};

function px(ctx, x, y, w, h, c) {
  ctx.fillStyle = c;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}
// shaded box: outline, base fill, light top strip, dark bottom strip
function box(ctx, x, y, w, h, base, light, dark, outline) {
  if (outline) px(ctx, x, y, w, h, outline);
  const i = outline ? 1 : 0;
  px(ctx, x + i, y + i, w - 2 * i, h - 2 * i, base);
  if (light && h > 3) px(ctx, x + i, y + i, w - 2 * i, 1, light);
  if (dark && h > 3) px(ctx, x + i, y + h - 1 - i, w - 2 * i, 1, dark);
}

// ---------------------------------------------------------------- palettes
const SKIN = [
  ['#f6d5b5', '#dfb391'], ['#eab88f', '#cf976b'], ['#cf9265', '#aa7047'],
  ['#a06b47', '#7f5033'], ['#6d4630', '#4f3121'],
];
const HAIR = ['#2b2118', '#5a3a22', '#8b5a2b', '#c48a3f', '#e0c27a', '#b4442f', '#3b3f52', '#6b6b6b'];
const SHIRT = [
  '#d95f4b', '#e0913c', '#d9b53f', '#7cae4d', '#3f9c7a', '#3d8fb3', '#4d6fd0',
  '#8a63c9', '#c95d9c', '#c7583f', '#5b9c9c', '#a3b04f', '#e08a7a', '#6b8fc9',
];
const PANTS = ['#3a4a6b', '#4d4d57', '#6b4a3a', '#2f5d4f', '#7a7a8a'];
const SHOES = ['#2a2320', '#4a3626', '#33333a'];
const ACCENT = ['#ff6b6b', '#ffd166', '#06d6a0', '#118ab2', '#ef476f', '#9b5de5'];

export function makePalette(seed) {
  const h = hashString(seed);
  const pick = (arr, shift) => arr[(h >>> shift) % arr.length];
  const skin = pick(SKIN, 0);
  return {
    skin: skin[0], skinDark: skin[1],
    hair: pick(HAIR, 5),
    shirt: pick(SHIRT, 9),
    pants: pick(PANTS, 14),
    shoes: pick(SHOES, 18),
    accent: pick(ACCENT, 22),
  };
}

// ---------------------------------------------------------------- character
const DIMS = {
  big: { hw: 4, headH: 8, bodyHW: 4, bodyH: 6, legH: 4, armW: 2, legW: 3 },
  small: { hw: 3, headH: 6, bodyHW: 3, bodyH: 5, legH: 3, armW: 1, legW: 2 },
};

function darken(hex, f = 0.75) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) * f, g = ((n >> 8) & 255) * f, b = (n & 255) * f;
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

export function drawCharacter(ctx, c) {
  const p = c.palette || makePalette(c.id || 'x');
  const d = c.small ? DIMS.small : DIMS.big;
  const facing = c.facing || 'down';
  const pose = c.pose || 'stand';
  const frame = (c.frame | 0) & 3;
  const tick = c.tick || 0;
  const x = Math.round(c.x), y = Math.round(c.y);

  if (pose === 'sleep') return drawSleeping(ctx, x, y, p, d);

  const total = d.headH + d.bodyH + d.legH;
  let bob = 0;
  if (pose === 'walk' && (frame === 1 || frame === 3)) bob = 1;
  const sit = pose === 'sit';
  // feet at y; when sitting the legs are hidden and the body drops 4px
  const top = y - total + (sit ? 4 : 0) - bob;
  const headTop = top, bodyTop = top + d.headH, legTop = bodyTop + d.bodyH;
  const side = facing === 'left' || facing === 'right';
  const dir = facing === 'left' ? -1 : 1;
  const hw = side ? d.hw - 1 : d.hw;

  // legs
  if (!sit) {
    const legW = side ? d.legW : d.legW;
    let lUp = 0, rUp = 0;
    if (pose === 'walk') { if (frame === 1) lUp = 1; if (frame === 3) rUp = 1; }
    if (side) {
      // legs stacked front/back
      const bx = x - hw;
      const bw = hw * 2;
      if (pose === 'walk' && (frame === 1 || frame === 3)) {
        const f = frame === 1 ? 1 : -1;
        px(ctx, bx + (f > 0 ? 1 : 0), legTop, bw - 1, d.legH - 1, p.pants);
        px(ctx, bx - f, legTop + d.legH - 2, Math.ceil(bw / 2), 2, p.shoes);
        px(ctx, bx + f + Math.floor(bw / 2) - 1, legTop + d.legH - 1, Math.ceil(bw / 2), 1, p.shoes);
      } else {
        px(ctx, bx, legTop, bw, d.legH - 1, p.pants);
        px(ctx, bx, legTop + d.legH - 2, bw, 2, p.shoes);
      }
    } else {
      const gap = d.hw * 2 - legW * 2;
      const lx = x - d.hw, rx = x - d.hw + legW + gap;
      px(ctx, lx, legTop, legW, d.legH - lUp, p.pants);
      px(ctx, lx, legTop + d.legH - 2 - lUp, legW, 2, p.shoes);
      px(ctx, rx, legTop, legW, d.legH - rUp, p.pants);
      px(ctx, rx, legTop + d.legH - 2 - rUp, legW, 2, p.shoes);
    }
  } else {
    // little lap strip so sitting reads as legs bent forward
    px(ctx, x - hw, legTop, hw * 2, 2, p.pants);
  }

  // body
  px(ctx, x - hw, bodyTop, hw * 2, d.bodyH, p.shirt);
  px(ctx, x - hw, bodyTop + d.bodyH - 1, hw * 2, 1, darken(p.shirt));
  // arms
  const armSwing = pose === 'work' ? (frame & 1 ? -1 : 1) : 0;
  const walkSwing = pose === 'walk' ? (frame === 1 ? -1 : frame === 3 ? 1 : 0) : 0;
  if (side) {
    // one visible arm in front
    const ax = x + dir * hw - (dir < 0 ? d.armW : 0);
    const ay = bodyTop + 1 + (armSwing > 0 ? -2 : 0) + walkSwing;
    px(ctx, ax, ay, d.armW, d.bodyH - 2, p.shirt);
    px(ctx, ax, ay + d.bodyH - 2, d.armW, 2, p.skin);
  } else {
    const la = bodyTop + 1 + (armSwing < 0 ? -2 : 0) - walkSwing;
    const ra = bodyTop + 1 + (armSwing > 0 ? -2 : 0) + walkSwing;
    px(ctx, x - hw - d.armW, la, d.armW, d.bodyH - 2, p.shirt);
    px(ctx, x - hw - d.armW, la + d.bodyH - 2, d.armW, 2, p.skin);
    px(ctx, x + hw, ra, d.armW, d.bodyH - 2, p.shirt);
    px(ctx, x + hw, ra + d.bodyH - 2, d.armW, 2, p.skin);
  }

  // head
  const headW = d.hw * 2;
  const hx = x - d.hw;
  px(ctx, hx, headTop, headW, d.headH, p.skin);
  const hairH = Math.max(2, Math.round(d.headH * 0.45));
  if (facing === 'up') {
    px(ctx, hx, headTop, headW, d.headH - 1, p.hair);
  } else {
    px(ctx, hx, headTop, headW, hairH, p.hair);
    // hair sides
    px(ctx, hx, headTop + hairH, 1, 2, p.hair);
    px(ctx, hx + headW - 1, headTop + hairH, 1, 2, p.hair);
    const blink = pose === 'think' ? ((tick >> 6) % 7 === 0) : ((tick >> 5) % 23 === 0);
    const eyeY = headTop + hairH + (d.small ? 1 : 2);
    const eyeH = blink ? 1 : (d.small ? 1 : 2);
    if (side) {
      const ex = dir > 0 ? hx + headW - 2 : hx + 1;
      px(ctx, ex, eyeY, 1, eyeH, '#2a2222');
    } else {
      px(ctx, hx + 2, eyeY, 1, eyeH, '#2a2222');
      px(ctx, hx + headW - 3, eyeY, 1, eyeH, '#2a2222');
      if (!d.small) px(ctx, hx + 1, eyeY + 2, 1, 1, p.skinDark), px(ctx, hx + headW - 2, eyeY + 2, 1, 1, p.skinDark);
    }
  }
  // neck shadow
  px(ctx, hx + 1, headTop + d.headH - 1, headW - 2, 1, p.skinDark);

  if (pose === 'think') {
    // hand to chin
    const cx = side ? x + dir * (hw + 1) - (dir < 0 ? 1 : 0) : x + hw - 1;
    px(ctx, cx, headTop + d.headH - 2, 2, 2, p.skin);
  }

  // props
  if (c.chore) drawProp(ctx, c.chore, x, y, facing, frame, tick, d, p, pose);
}

function drawSleeping(ctx, x, y, p, d) {
  // lying horizontally, head to the left, centered on (x, y-4)
  const w = d.small ? 14 : 18, h = d.small ? 8 : 10;
  const left = x - (w >> 1), top = y - h;
  const headW = d.small ? 6 : 8;
  // legs / pants (right side)
  px(ctx, left + headW + 6, top + 2, w - headW - 6, h - 4, p.pants);
  px(ctx, left + w - 2, top + 2, 2, h - 4, p.shoes);
  // body
  px(ctx, left + headW, top + 1, 6, h - 2, p.shirt);
  // head
  px(ctx, left, top, headW, h - 2, p.skin);
  px(ctx, left, top, headW, 2, p.hair);
  px(ctx, left, top, 2, h - 3, p.hair);
  // closed eye
  px(ctx, left + headW - 3, top + 4, 2, 1, '#2a2222');
  // arm
  px(ctx, left + headW, top + 3, 5, 2, p.skin);
}

// hand position for props
function handPos(x, y, facing, d, pose) {
  const total = d.headH + d.bodyH + d.legH;
  const sit = pose === 'sit' ? 4 : 0;
  const hy = y - total + d.headH + d.bodyH - 1 + sit;
  switch (facing) {
    case 'left': return { hx: x - d.hw - 3, hy, dir: -1 };
    case 'right': return { hx: x + d.hw + 1, hy, dir: 1 };
    case 'up': return { hx: x - d.hw - 4, hy: hy - 2, dir: -1 };
    default: return { hx: x + d.hw + 1, hy, dir: 1 };
  }
}

function drawProp(ctx, chore, x, y, facing, frame, tick, d, p, pose) {
  const { hx, hy, dir } = handPos(x, y, facing, d, pose);
  const wob = frame & 1;
  const fx = facing === 'left' ? -1 : facing === 'right' ? 1 : 0;
  const fy = facing === 'up' ? -1 : facing === 'down' ? 1 : 0;
  switch (chore) {
    case 'cook': // frying pan
      px(ctx, hx, hy - 1, 2, 1, '#6b4a3a');
      px(ctx, hx + (dir > 0 ? 2 : -3), hy - 2, 4, 3, '#3a3a3a');
      px(ctx, hx + (dir > 0 ? 3 : -2), hy - 1, 2, 1, '#e8b04a');
      break;
    case 'chop': // knife
      px(ctx, hx, hy - wob, 1, 2, '#6b4a3a');
      px(ctx, hx + dir, hy - 1 - wob, 3, 1, '#d8dde3');
      break;
    case 'dishes': case 'washcar': // sponge (+bucket for washcar)
      px(ctx, hx, hy - 1 - wob, 3, 2, '#f2d75b');
      px(ctx, hx, hy - wob, 3, 1, '#4caf50');
      if (chore === 'washcar') { px(ctx, x - d.hw - 6, y - 5, 4, 5, '#5b7fb5'); px(ctx, x - d.hw - 6, y - 5, 4, 1, '#8fb3e0'); }
      break;
    case 'grill': // tongs
      px(ctx, hx, hy - 1, 4, 1, '#9aa0a6');
      px(ctx, hx, hy + 1, 4, 1, '#9aa0a6');
      px(ctx, hx, hy - 1, 1, 3, '#6b7075');
      break;
    case 'workbench': case 'fix': // hammer / wrench
      if (chore === 'workbench') {
        px(ctx, hx + 1, hy - 3 + wob, 1, 5, '#8b5a2b');
        px(ctx, hx, hy - 4 + wob, 3, 2, '#555a60');
      } else {
        px(ctx, hx + 1, hy - 3 + wob, 1, 5, '#9aa0a6');
        px(ctx, hx, hy - 4 + wob, 3, 2, '#9aa0a6');
        px(ctx, hx + 1, hy - 4 + wob, 1, 1, '#5a5f66');
      }
      break;
    case 'mow': { // push mower in front
      const mx = x + fx * (d.hw + 6) - 4 + (fy !== 0 ? 0 : 0);
      const my = y + fy * (fy > 0 ? 2 : (d.headH + d.bodyH + d.legH + 2)) - 4;
      const ox = fx !== 0 ? mx : x - 4, oy = fy !== 0 ? my : y - 5;
      px(ctx, ox, oy, 8, 5, '#c0392b');
      px(ctx, ox, oy, 8, 1, '#e06b5c');
      px(ctx, ox, oy + 4, 2, 2, '#2a2a2a'); px(ctx, ox + 6, oy + 4, 2, 2, '#2a2a2a');
      px(ctx, ox + 3, oy - 1, 2, 1, '#555');
      break;
    }
    case 'vacuum': { // vacuum head in front + hose
      const ox = fx !== 0 ? x + fx * (d.hw + 5) - 2 : x - 3;
      const oy = fy > 0 ? y - 2 : fy < 0 ? y - (d.headH + d.bodyH + d.legH) - 3 : y - 3;
      px(ctx, ox, oy, 6, 3, '#556b8f');
      px(ctx, ox, oy, 6, 1, '#7f95b8');
      px(ctx, hx, hy - 3, 1, 4, '#3a3a3a');
      break;
    }
    case 'rake':
      px(ctx, hx + 1, hy - 5, 1, 7, '#8b5a2b');
      px(ctx, hx - 1, hy + 1, 5, 1, '#7a7f85');
      px(ctx, hx - 1, hy + 2, 1, 1, '#7a7f85'); px(ctx, hx + 1, hy + 2, 1, 1, '#7a7f85'); px(ctx, hx + 3, hy + 2, 1, 1, '#7a7f85');
      break;
    case 'trash': // trash bag
      px(ctx, hx - 1, hy - 1, 5, 5, '#2f3640');
      px(ctx, hx, hy - 2, 3, 1, '#4a5260');
      px(ctx, hx, hy, 1, 1, '#4a5260');
      break;
    case 'laundry': case 'fold': // basket / folded shirt
      if (chore === 'laundry') {
        px(ctx, x - d.hw - 1, hy - 2, d.hw * 2 + 2, 4, '#d9a066');
        px(ctx, x - d.hw - 1, hy - 2, d.hw * 2 + 2, 1, '#f0c48a');
        px(ctx, x - d.hw, hy - 3, 2, 1, '#e74c3c'); px(ctx, x + 1, hy - 3, 2, 1, '#3498db');
      } else {
        px(ctx, hx - 1, hy - 1 + wob, 4, 3, '#3498db');
        px(ctx, hx - 1, hy - 1 + wob, 4, 1, '#7fc0e8');
      }
      break;
    case 'scrub': // spray bottle
      px(ctx, hx, hy - 3, 2, 5, '#3fa9f5');
      px(ctx, hx, hy - 4, 3, 1, '#e8e8e8');
      px(ctx, hx + 2, hy - 3, 1, 1, '#e8e8e8');
      break;
    case 'read': case 'bookshelf': case 'pantry': // open book
      px(ctx, hx - 2, hy - 1, 6, 4, '#f4ecd8');
      px(ctx, hx + 1, hy - 1, 1, 4, '#8b5a2b');
      px(ctx, hx - 1, hy, 1, 1, '#999'); px(ctx, hx + 3, hy, 1, 1, '#999');
      break;
    case 'mail': // envelope
      px(ctx, hx - 1, hy - 1, 5, 3, '#f7f3e8');
      px(ctx, hx, hy - 1, 3, 1, '#c9b89a');
      px(ctx, hx + 1, hy, 1, 1, '#c9b89a');
      break;
    case 'tv': // remote
      px(ctx, hx, hy - 1, 2, 4, '#333');
      px(ctx, hx, hy, 1, 1, '#e74c3c');
      break;
    case 'phone': // phone with glow
      px(ctx, hx - 1, hy - 2, 3, 5, '#222');
      px(ctx, hx, hy - 1, 1, 3, (tick >> 4) & 1 ? '#8ce0ff' : '#5fb8e8');
      break;
    case 'pool': // cue
      px(ctx, hx - 3, hy - 4, 1, 1, '#c9a063'); px(ctx, hx - 2, hy - 3, 1, 1, '#c9a063'); px(ctx, hx - 1, hy - 2, 1, 1, '#c9a063');
      px(ctx, hx, hy - 1, 1, 1, '#c9a063'); px(ctx, hx + 1, hy, 1, 1, '#8b5a2b'); px(ctx, hx + 2, hy + 1, 1, 1, '#8b5a2b');
      break;
    case 'water': // watering can
      px(ctx, hx, hy - 1, 4, 3, '#4d8f5a');
      px(ctx, hx, hy - 1, 4, 1, '#7fc08a');
      px(ctx, hx + 4, hy - 2, 1, 2, '#4d8f5a');
      break;
    case 'coffee': // mug
      px(ctx, hx, hy - 2, 3, 3, '#f0ede6');
      px(ctx, hx, hy - 2, 3, 1, '#6b4a3a');
      px(ctx, hx + 3, hy - 1, 1, 1, '#f0ede6');
      if ((tick >> 3) & 1) px(ctx, hx + 1, hy - 4, 1, 1, 'rgba(255,255,255,0.7)');
      break;
    case 'helper': // megaphone
      px(ctx, hx, hy - 1, 2, 2, '#d35400');
      px(ctx, hx + 2 * (dir > 0 ? 1 : -1), hy - 2, 2, 4, '#e67e22');
      px(ctx, hx + (dir > 0 ? 4 : -3), hy - 3, 1, 6, '#f39c12');
      break;
    case 'makebed': // pillow
      px(ctx, hx - 1, hy - 1, 5, 3, '#ffffff');
      px(ctx, hx - 1, hy + 1, 5, 1, '#d8d8e0');
      break;
    default: break; // desk, sit, nap, think, chop handled elsewhere or no prop
  }
}

// ---------------------------------------------------------------- floors
const FLOOR_BASE = {
  wood: '#c99763', tile: '#e6e2d8', carpet: '#b8a58c', concrete: '#a8a8a3', pavers: '#c4b8a4',
  lawn: '#7fb35a', asphalt: '#6e6f73', void: '#2a2c33', roof: '#cfc9c0',
};

export function drawFloorTile(ctx, texture, x, y) {
  const X = x * TILE, Y = y * TILE;
  const h = hash2(x, y, 7);
  switch (texture) {
    case 'wood': {
      const shade = (h & 3);
      const base = ['#c99763', '#c4915d', '#cd9c69', '#c08b58'][shade];
      px(ctx, X, Y, 16, 16, base);
      // plank seams: horizontal every 4px, stagger vertical seam
      for (let r = 0; r < 16; r += 4) px(ctx, X, Y + r, 16, 1, '#b07f4e');
      const off = ((x + (y >> 2)) & 1) ? 8 : 3;
      px(ctx, X + off, Y, 1, 4, '#a9774a');
      px(ctx, X + ((off + 9) % 16), Y + 8, 1, 4, '#a9774a');
      if ((h >> 5) % 9 === 0) px(ctx, X + (h >> 8) % 12, Y + 5 + (h >> 12) % 2, 2, 1, '#b5845a');
      break;
    }
    case 'tile': {
      const dark = ((x + y) & 1) === 0;
      px(ctx, X, Y, 16, 16, dark ? '#d9d4c8' : '#e9e5db');
      px(ctx, X, Y, 16, 1, '#c8c2b4'); px(ctx, X, Y, 1, 16, '#c8c2b4');
      break;
    }
    case 'carpet': {
      px(ctx, X, Y, 16, 16, '#b8a58c');
      for (let i = 0; i < 6; i++) {
        const hh = hash2(x, y, 20 + i);
        px(ctx, X + hh % 16, Y + (hh >> 4) % 16, 1, 1, (hh >> 8) & 1 ? '#ad9a81' : '#c2b096');
      }
      break;
    }
    case 'concrete': {
      px(ctx, X, Y, 16, 16, (h & 1) ? '#a8a8a3' : '#a4a49f');
      if ((h >> 3) % 5 === 0) px(ctx, X + (h >> 6) % 12, Y + (h >> 10) % 14, 3, 1, '#98989a');
      break;
    }
    case 'pavers': {
      px(ctx, X, Y, 16, 16, '#b5a894');
      const rowOff = (y & 1) ? 8 : 0;
      px(ctx, X, Y, 16, 1, '#a1927c'); px(ctx, X, Y + 8, 16, 1, '#a1927c');
      px(ctx, X + rowOff, Y, 1, 8, '#a1927c'); px(ctx, X + ((rowOff + 8) & 15), Y + 8, 1, 8, '#a1927c');
      px(ctx, X + 1 + rowOff, Y + 1, 7, 1, '#cbbfab'); px(ctx, X + 1 + ((rowOff + 8) & 15), Y + 9, 7, 1, '#cbbfab');
      break;
    }
    case 'lawn': {
      px(ctx, X, Y, 16, 16, (h & 1) ? '#7fb35a' : '#7aae55');
      for (let i = 0; i < 4; i++) {
        const hh = hash2(x, y, 40 + i);
        px(ctx, X + hh % 15, Y + (hh >> 4) % 14, 1, 2, '#6a9e48');
      }
      if ((h >> 7) % 11 === 0) { px(ctx, X + (h >> 9) % 13 + 1, Y + (h >> 13) % 13 + 1, 2, 2, ['#f6e58d', '#ff8fa3', '#ffffff'][(h >> 3) % 3]); }
      if ((h >> 2) % 7 === 0) px(ctx, X + (h >> 11) % 14, Y + (h >> 5) % 14, 2, 1, '#93c46e');
      break;
    }
    case 'asphalt': {
      px(ctx, X, Y, 16, 16, (h & 1) ? '#6e6f73' : '#6a6b6f');
      if ((h >> 4) % 6 === 0) px(ctx, X + (h >> 8) % 14, Y + (h >> 12) % 14, 1, 1, '#7c7d81');
      break;
    }
    case 'void': {
      px(ctx, X, Y, 16, 16, '#2a2c33');
      if ((h >> 3) % 4 === 0) px(ctx, X + (h >> 8) % 15, Y + (h >> 12) % 15, 1, 1, '#33363f');
      break;
    }
    case 'roof': {
      px(ctx, X, Y, 16, 16, '#d3cdc4');
      for (let r = 0; r < 16; r += 4) {
        px(ctx, X, Y + r + 3, 16, 1, '#c3bcb2');
        const off = (r >> 2) & 1 ? 8 : 0;
        px(ctx, X + off, Y + r, 1, 3, '#c9c2b8');
        px(ctx, X + ((off + 8) & 15), Y + r, 1, 3, '#c9c2b8');
      }
      break;
    }
    default:
      px(ctx, X, Y, 16, 16, FLOOR_BASE[texture] || '#d0d0d0');
  }
}

// ---------------------------------------------------------------- walls
export function drawWallEdge(ctx, edge) {
  const { x, y, dir } = edge;
  const kind = edge.kind || 'wall';
  const indoor = edge.indoor !== false;
  const X = x * TILE, Y = y * TILE;
  const vertical = dir === 'right';
  const base = indoor ? '#ece3d3' : '#cdbfa8';
  const outline = indoor ? '#5c4a3a' : '#4f4033';
  // rect covering the 4px-thick wall centered on the edge
  const rx = vertical ? X + TILE - 2 : X, ry = vertical ? Y : Y + TILE - 2;
  const rw = vertical ? 4 : TILE, rh = vertical ? TILE : 4;

  if (kind === 'wall') {
    px(ctx, rx, ry, rw, rh, outline);
    if (vertical) px(ctx, rx + 1, ry, 2, rh, base); else px(ctx, rx, ry + 1, rw, 2, base);
    return;
  }
  // door kinds: frame stubs (2px) at each end, then a leaf across the gap
  const stub = 2;
  if (vertical) {
    px(ctx, rx, ry, rw, stub, outline);
    px(ctx, rx, ry + rh - stub, rw, stub, outline);
  } else {
    px(ctx, rx, ry, stub, rh, outline);
    px(ctx, rx + rw - stub, ry, stub, rh, outline);
  }
  const gx = vertical ? rx + 1 : rx + stub, gy = vertical ? ry + stub : ry + 1;
  const gw = vertical ? 2 : rw - 2 * stub, gh = vertical ? rh - 2 * stub : 2;
  switch (kind) {
    case 'door':
      px(ctx, gx, gy, gw, gh, '#8b5a2b');
      if (vertical) px(ctx, gx, gy + 2, 1, 1, '#e8c14a'); else px(ctx, gx + 2, gy, 1, 1, '#e8c14a');
      break;
    case 'double':
      px(ctx, gx, gy, gw, gh, '#8b5a2b');
      if (vertical) px(ctx, gx, gy + (gh >> 1), gw, 1, '#5c3a1c'); else px(ctx, gx + (gw >> 1), gy, 1, gh, '#5c3a1c');
      break;
    case 'slider':
      px(ctx, gx, gy, gw, gh, '#a9d8ea');
      if (vertical) px(ctx, gx, gy + (gh >> 1), gw, 1, '#6c7a86'); else px(ctx, gx + (gw >> 1), gy, 1, gh, '#6c7a86');
      break;
    case 'garage':
      px(ctx, rx, ry, rw, rh, '#8f9296');
      if (vertical) { for (let i = 0; i < rh; i += 4) px(ctx, rx, ry + i, rw, 1, '#6f7276'); px(ctx, rx + 1, ry, 1, rh, '#a9acb0'); }
      else { for (let i = 0; i < rw; i += 4) px(ctx, rx + i, ry, 1, rh, '#6f7276'); px(ctx, rx, ry + 1, rw, 1, '#a9acb0'); }
      break;
    case 'opening':
    default:
      break;
  }
}

// ---------------------------------------------------------------- furniture
const SIZES = {
  counter: [1, 1], stove: [1, 1], sink: [1, 1], fridge: [1, 1], island: [2, 1], dishwasher: [1, 1], microwave: [1, 1],
  table: [3, 2], chair: [1, 1], stool: [1, 1],
  sofa: [3, 1], loveseat: [2, 1], armchair: [1, 1], coffee_table: [2, 1], tv: [2, 1], tv_stand: [2, 1], fireplace: [1, 2],
  bookshelf: [1, 1], plant: [1, 1], lamp: [1, 1], rug: [2, 2], painting: [1, 1],
  bed_king: [3, 3], bed_queen: [2, 3], bed_single: [2, 3], nightstand: [1, 1], dresser: [2, 1], wardrobe: [1, 1],
  desk: [2, 1], office_chair: [1, 1], computer: [1, 1],
  toilet: [1, 1], vanity: [1, 1], tub: [2, 1], shower: [1, 1], towel_rack: [1, 1], mirror: [1, 1],
  washer: [1, 1], dryer: [1, 1], laundry_basket: [1, 1], shelves: [1, 1], bench: [2, 1], coat_rack: [1, 1],
  furnace: [1, 1], water_heater: [1, 1], closet: [2, 1], boxes: [1, 1],
  car: [2, 4], workbench: [2, 1], toolwall: [2, 1], trash_bin: [1, 1], recycle_bin: [1, 1], mower: [1, 1], bike: [1, 1],
  grill: [1, 1], patio_chair: [1, 1], patio_table: [1, 1], tree: [2, 2], bush: [1, 1], flowerbed: [2, 1], mailbox: [1, 1],
  fence: [1, 1], stairs: [3, 3], railing: [1, 1], pool_table: [3, 2], beanbag: [1, 1], doormat: [1, 1], mat: [1, 1],
};
const NON_SOLID = new Set(['rug', 'mat', 'doormat', 'railing', 'stairs', 'painting', 'tv', 'toolwall', 'mirror']);

export function furnitureSize(type) {
  const s = SIZES[type];
  return s ? { w: s[0], h: s[1] } : { w: 1, h: 1 };
}
export function furnitureSolid(type) { return !NON_SOLID.has(type); }

const WOOD = { base: '#a8703f', light: '#c48c55', dark: '#7d5230', line: '#5c3a1c' };
const WOOD_LIGHT = { base: '#d3a877', light: '#e6c193', dark: '#b08655', line: '#7a5535' };
const METAL = { base: '#c9ccd1', light: '#e6e8eb', dark: '#9ea2a8', line: '#5f636a' };
const WHITE = { base: '#f2f0ea', light: '#ffffff', dark: '#cfcbc2', line: '#6e6a63' };

function geom(item) {
  const nat = furnitureSize(item.type);
  const w = (item.w || nat.w), h = (item.h || nat.h);
  return { X: item.x * TILE, Y: item.y * TILE, W: w * TILE, H: h * TILE, w, h, facing: item.facing || 'down' };
}
function tiled(ctx, item, fn) {
  const { w, h } = geom(item);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) fn((item.x + i) * TILE, (item.y + j) * TILE, i, j);
}

function cushionColor(seed) {
  return ['#5b7fb5', '#7a9a6b', '#b5695b', '#8a7ab5', '#c9a35b'][hashString(seed) % 5];
}

export function drawFurniture(ctx, item, tick = 0) {
  try {
    const f = FURN[item.type];
    if (f) f(ctx, item, tick | 0);
    else drawUnknown(ctx, item);
  } catch (e) {
    drawUnknown(ctx, item);
  }
}
function drawUnknown(ctx, item) {
  const { X, Y, W, H } = geom(item);
  box(ctx, X, Y, W, H, '#b8b8b8', '#d0d0d0', '#9a9a9a', '#666');
  const s = String(item.type || '?').slice(0, 3);
  // tiny 3-letter label via dots (approximation: one dark px per letter)
  for (let i = 0; i < s.length; i++) px(ctx, X + 3 + i * 3, Y + (H >> 1) - 1, 2, 2, '#444');
}

const FURN = {
  counter(ctx, item) {
    tiled(ctx, item, (X, Y) => {
      box(ctx, X, Y, 16, 16, '#d9d4c7', '#eeeae0', '#b9b3a5', '#6b6156');
      px(ctx, X + 1, Y + 12, 14, 3, '#8b6a4a');
    });
  },
  stove(ctx, item) {
    const { X, Y } = geom(item);
    box(ctx, X, Y, 16, 16, '#d8dadc', '#f0f1f2', '#a9acb0', '#4f5257');
    px(ctx, X + 3, Y + 3, 4, 4, '#2b2b2b'); px(ctx, X + 9, Y + 3, 4, 4, '#2b2b2b');
    px(ctx, X + 3, Y + 9, 4, 4, '#2b2b2b'); px(ctx, X + 9, Y + 9, 4, 4, '#2b2b2b');
    px(ctx, X + 4, Y + 4, 2, 2, '#e05a2b'); px(ctx, X + 10, Y + 10, 2, 2, '#444');
    px(ctx, X + 2, Y + 14, 12, 1, '#7b7f84');
  },
  sink(ctx, item) {
    const { X, Y } = geom(item);
    box(ctx, X, Y, 16, 16, '#d9d4c7', '#eeeae0', '#b9b3a5', '#6b6156');
    box(ctx, X + 3, Y + 4, 10, 9, '#b8c4cc', '#d8e2e8', '#8f9ca4', '#5f6a72');
    px(ctx, X + 7, Y + 2, 2, 3, '#7d8288'); px(ctx, X + 6, Y + 1, 4, 1, '#9aa0a6');
  },
  fridge(ctx, item) {
    const { X, Y } = geom(item);
    box(ctx, X + 1, Y, 14, 16, '#e3e6e8', '#f5f6f7', '#b6babe', '#5a5e63');
    px(ctx, X + 2, Y + 6, 12, 1, '#b6babe');
    px(ctx, X + 12, Y + 2, 1, 3, '#7c8085'); px(ctx, X + 12, Y + 8, 1, 5, '#7c8085');
  },
  island(ctx, item) {
    const { X, Y, W, H } = geom(item);
    box(ctx, X, Y, W, H, '#e3dfd6', '#f3f0ea', '#c2bcb0', '#5f5449');
    px(ctx, X + 1, Y + H - 5, W - 2, 3, '#6b4a3a');
    for (let i = 2; i < W - 2; i += 6) px(ctx, X + i, Y + 3, 2, 1, '#d1cabc');
  },
  dishwasher(ctx, item) {
    const { X, Y } = geom(item);
    box(ctx, X, Y, 16, 16, '#d9d4c7', '#eeeae0', '#b9b3a5', '#6b6156');
    box(ctx, X + 2, Y + 6, 12, 8, '#c4c8cc', '#dfe2e5', '#9a9ea3', '#5f6368');
    px(ctx, X + 4, Y + 8, 8, 1, '#7c8085');
  },
  microwave(ctx, item) {
    const { X, Y } = geom(item);
    box(ctx, X, Y, 16, 16, '#d9d4c7', '#eeeae0', '#b9b3a5', '#6b6156');
    box(ctx, X + 2, Y + 3, 12, 8, '#3a3d42', '#5a5e64', '#26282c', '#1f2124');
    px(ctx, X + 4, Y + 5, 6, 4, '#54585e'); px(ctx, X + 11, Y + 5, 1, 4, '#8fd07a');
  },
  table(ctx, item) {
    const { X, Y, W, H } = geom(item);
    box(ctx, X + 1, Y + 1, W - 2, H - 2, WOOD_LIGHT.base, WOOD_LIGHT.light, WOOD_LIGHT.dark, WOOD_LIGHT.line);
    px(ctx, X + 2, Y + 3, W - 4, 1, WOOD_LIGHT.light);
    // a vase
    px(ctx, X + (W >> 1) - 1, Y + (H >> 1) - 2, 2, 3, '#5b8fb5'); px(ctx, X + (W >> 1) - 1, Y + (H >> 1) - 3, 2, 1, '#e05a7a');
  },
  chair(ctx, item) {
    const { X, Y, facing } = geom(item);
    // seat
    box(ctx, X + 3, Y + 4, 10, 9, WOOD.base, WOOD.light, WOOD.dark, WOOD.line);
    // back on the far side from facing
    if (facing === 'down') px(ctx, X + 3, Y + 2, 10, 3, WOOD.dark);
    else if (facing === 'up') px(ctx, X + 3, Y + 12, 10, 3, WOOD.dark);
    else if (facing === 'left') px(ctx, X + 12, Y + 3, 3, 10, WOOD.dark);
    else px(ctx, X + 1, Y + 3, 3, 10, WOOD.dark);
  },
  stool(ctx, item) {
    const { X, Y } = geom(item);
    box(ctx, X + 4, Y + 5, 8, 7, WOOD.base, WOOD.light, WOOD.dark, WOOD.line);
    px(ctx, X + 5, Y + 12, 1, 3, WOOD.line); px(ctx, X + 10, Y + 12, 1, 3, WOOD.line);
  },
  sofa(ctx, item) { drawCouch(ctx, item); },
  loveseat(ctx, item) { drawCouch(ctx, item); },
  armchair(ctx, item) { drawCouch(ctx, item); },
  coffee_table(ctx, item) {
    const { X, Y, W, H } = geom(item);
    box(ctx, X + 2, Y + 3, W - 4, H - 6, WOOD.base, WOOD.light, WOOD.dark, WOOD.line);
    px(ctx, X + 5, Y + 6, 4, 3, '#f0ede6'); px(ctx, X + 6, Y + 5, 2, 1, '#6b4a3a');
  },
  tv(ctx, item, tick) {
    const { X, Y, W } = geom(item);
    box(ctx, X + 2, Y + 1, W - 4, 9, '#1c1e22', '#3a3d42', '#0f1012', '#0b0c0e');
    const on = (tick >> 3) % 3;
    const cols = ['#4f7fd6', '#6aa0e6', '#3f6ac0'];
    px(ctx, X + 3, Y + 2, W - 6, 7, cols[on]);
    px(ctx, X + 4 + (tick >> 2) % (W - 10), Y + 3, 3, 2, '#d8e8ff');
    px(ctx, X + (W >> 1) - 3, Y + 10, 6, 1, '#3a3d42');
  },
  tv_stand(ctx, item) {
    const { X, Y, W, H } = geom(item);
    box(ctx, X + 1, Y + 6, W - 2, H - 8, WOOD.base, WOOD.light, WOOD.dark, WOOD.line);
    px(ctx, X + 4, Y + 8, W - 8, 1, WOOD.dark);
  },
  fireplace(ctx, item, tick) {
    const { X, Y, W, H } = geom(item);
    box(ctx, X, Y, W, H, '#8f8a82', '#a9a49c', '#6e6a63', '#4a463f');
    px(ctx, X + 3, Y + H - 11, W - 6, 8, '#2b2320');
    const f = (tick >> 2) & 1;
    px(ctx, X + 5, Y + H - 8 + f, W - 10, 4 - f, '#f39c12');
    px(ctx, X + 6, Y + H - 6, W - 12, 2, '#e74c3c');
    px(ctx, X + 7 - f, Y + H - 10 + f, 2, 2, '#f1c40f');
  },
  bookshelf(ctx, item) {
    tiled(ctx, item, (X, Y) => {
      box(ctx, X, Y, 16, 16, WOOD.base, WOOD.light, WOOD.dark, WOOD.line);
      const cols = ['#c0392b', '#2980b9', '#27ae60', '#f39c12', '#8e44ad', '#ecf0f1'];
      for (let r = 0; r < 2; r++) {
        px(ctx, X + 1, Y + 2 + r * 7, 14, 1, WOOD.dark);
        for (let i = 0; i < 6; i++) {
          const h = hash2(X + i, Y + r, 3);
          px(ctx, X + 2 + i * 2, Y + 3 + r * 7 + (h & 1), 2, 4 - (h & 1), cols[(h >> 2) % cols.length]);
        }
      }
    });
  },
  plant(ctx, item) {
    const { X, Y } = geom(item);
    px(ctx, X + 5, Y + 10, 6, 5, '#b5652b'); px(ctx, X + 5, Y + 10, 6, 1, '#d17d3e');
    px(ctx, X + 4, Y + 4, 8, 6, '#3f9c4a'); px(ctx, X + 6, Y + 2, 4, 3, '#4cb85a');
    px(ctx, X + 2, Y + 6, 3, 3, '#3f9c4a'); px(ctx, X + 11, Y + 5, 3, 3, '#3f9c4a');
    px(ctx, X + 7, Y + 5, 2, 1, '#7fd08a');
  },
  lamp(ctx, item, tick) {
    const { X, Y } = geom(item);
    const on = (tick >> 5) % 2 === 0 || true;
    px(ctx, X + 7, Y + 6, 2, 8, '#5f5f66'); px(ctx, X + 5, Y + 13, 6, 2, '#4a4a50');
    px(ctx, X + 3, Y + 2, 10, 5, on ? '#f7e3a0' : '#c9c0a0'); px(ctx, X + 4, Y + 2, 8, 1, on ? '#fff3c4' : '#d8d0b0');
    if (on) { ctx.fillStyle = 'rgba(255,230,150,0.25)'; ctx.fillRect(X + 1, Y + 1, 14, 8); }
  },
  rug(ctx, item) {
    const { X, Y, W, H } = geom(item);
    const c = cushionColor(item.x * 31 + item.y);
    px(ctx, X + 1, Y + 1, W - 2, H - 2, c);
    px(ctx, X + 3, Y + 3, W - 6, H - 6, darken(c, 0.85));
    px(ctx, X + 5, Y + 5, W - 10, H - 10, c);
    for (let i = 1; i < W - 1; i += 2) { px(ctx, X + i, Y, 1, 1, '#f0e6d2'); px(ctx, X + i, Y + H - 1, 1, 1, '#f0e6d2'); }
  },
  painting(ctx, item) {
    const { X, Y } = geom(item);
    box(ctx, X + 3, Y + 1, 10, 8, '#f0e6d2', null, null, '#6b4a3a');
    px(ctx, X + 4, Y + 2, 8, 6, '#8fb8d8'); px(ctx, X + 4, Y + 5, 8, 3, '#6a9e48'); px(ctx, X + 9, Y + 3, 2, 2, '#f7e3a0');
  },
  bed_king(ctx, item) { drawBed(ctx, item); },
  bed_queen(ctx, item) { drawBed(ctx, item); },
  bed_single(ctx, item) { drawBed(ctx, item); },
  nightstand(ctx, item) {
    const { X, Y } = geom(item);
    box(ctx, X + 2, Y + 4, 12, 10, WOOD.base, WOOD.light, WOOD.dark, WOOD.line);
    px(ctx, X + 6, Y + 8, 4, 1, WOOD.dark);
    px(ctx, X + 6, Y + 1, 4, 3, '#f7e3a0'); px(ctx, X + 7, Y + 4, 2, 1, '#5f5f66');
  },
  dresser(ctx, item) {
    const { X, Y, W, H } = geom(item);
    box(ctx, X + 1, Y + 2, W - 2, H - 3, WOOD.base, WOOD.light, WOOD.dark, WOOD.line);
    px(ctx, X + 2, Y + 7, W - 4, 1, WOOD.dark);
    for (let i = 5; i < W - 4; i += 8) { px(ctx, X + i, Y + 5, 2, 1, '#e8c14a'); px(ctx, X + i, Y + 10, 2, 1, '#e8c14a'); }
  },
  wardrobe(ctx, item) {
    tiled(ctx, item, (X, Y) => {
      box(ctx, X + 1, Y, 14, 16, WOOD.base, WOOD.light, WOOD.dark, WOOD.line);
      px(ctx, X + 8, Y + 1, 1, 14, WOOD.dark); px(ctx, X + 6, Y + 7, 1, 2, '#e8c14a'); px(ctx, X + 9, Y + 7, 1, 2, '#e8c14a');
    });
  },
  desk(ctx, item, tick) {
    const { X, Y, W, H, facing } = geom(item);
    box(ctx, X + 1, Y + 2, W - 2, H - 3, WOOD_LIGHT.base, WOOD_LIGHT.light, WOOD_LIGHT.dark, WOOD_LIGHT.line);
    // monitor on the far side from the chair (facing = side the user sits)
    const mx = facing === 'left' ? X + W - 9 : facing === 'right' ? X + 2 : X + (W >> 1) - 4;
    const my = facing === 'up' ? Y + H - 8 : Y + 2;
    drawMonitor(ctx, mx, my, tick);
    // papers
    px(ctx, X + W - 6, Y + H - 6, 4, 3, '#f4f1e8');
  },
  office_chair(ctx, item) {
    const { X, Y, facing } = geom(item);
    box(ctx, X + 3, Y + 4, 10, 9, '#3a3d42', '#55595f', '#26282c', '#1f2124');
    if (facing === 'down') px(ctx, X + 3, Y + 1, 10, 3, '#2b2d31');
    else if (facing === 'up') px(ctx, X + 3, Y + 13, 10, 3, '#2b2d31');
    else if (facing === 'left') px(ctx, X + 13, Y + 3, 3, 10, '#2b2d31');
    else px(ctx, X, Y + 3, 3, 10, '#2b2d31');
  },
  computer(ctx, item, tick) {
    const { X, Y } = geom(item);
    drawMonitor(ctx, X + 4, Y + 3, tick);
  },
  toilet(ctx, item) {
    const { X, Y, facing } = geom(item);
    // tank against the wall opposite to facing
    if (facing === 'up') { box(ctx, X + 3, Y + 11, 10, 4, WHITE.base, WHITE.light, WHITE.dark, WHITE.line); box(ctx, X + 4, Y + 2, 8, 9, WHITE.base, WHITE.light, WHITE.dark, WHITE.line); px(ctx, X + 6, Y + 4, 4, 5, '#c9dbe6'); }
    else { box(ctx, X + 3, Y + 1, 10, 4, WHITE.base, WHITE.light, WHITE.dark, WHITE.line); box(ctx, X + 4, Y + 5, 8, 9, WHITE.base, WHITE.light, WHITE.dark, WHITE.line); px(ctx, X + 6, Y + 7, 4, 5, '#c9dbe6'); }
  },
  vanity(ctx, item) {
    tiled(ctx, item, (X, Y) => {
      box(ctx, X, Y, 16, 16, '#e6e2d8', '#f4f1ea', '#c4bfb3', '#6b6156');
      box(ctx, X + 4, Y + 4, 8, 7, '#c9dbe6', '#e6f0f5', '#a3bac7', '#6f858f');
      px(ctx, X + 7, Y + 2, 2, 3, '#8a8f95');
    });
  },
  tub(ctx, item) {
    const { X, Y, W, H } = geom(item);
    box(ctx, X + 1, Y + 1, W - 2, H - 2, WHITE.base, WHITE.light, WHITE.dark, WHITE.line);
    px(ctx, X + 3, Y + 3, W - 6, H - 6, '#bfe0ee'); px(ctx, X + 4, Y + 4, W - 10, 1, '#e0f2f8');
    px(ctx, X + W - 5, Y + 2, 2, 2, '#8a8f95');
  },
  shower(ctx, item) {
    const { X, Y } = geom(item);
    box(ctx, X, Y, 16, 16, '#d5dde3', '#e9eef2', '#aeb8c0', '#5f6a72');
    px(ctx, X + 2, Y + 2, 12, 12, '#c9dbe6');
    px(ctx, X + 2, Y + 2, 12, 1, '#8a8f95'); px(ctx, X + 7, Y + 3, 2, 2, '#8a8f95');
    for (let i = 3; i < 13; i += 3) px(ctx, X + i, Y + 6, 1, 3, '#a9cde0');
  },
  towel_rack(ctx, item) {
    const { X, Y } = geom(item);
    px(ctx, X + 2, Y + 2, 12, 1, '#8a8f95');
    px(ctx, X + 3, Y + 3, 4, 8, '#e05a7a'); px(ctx, X + 9, Y + 3, 4, 8, '#5b8fb5');
  },
  mirror(ctx, item) {
    const { X, Y } = geom(item);
    box(ctx, X + 3, Y + 1, 10, 7, '#c9dbe6', '#e6f0f5', '#a3bac7', '#6f858f');
    px(ctx, X + 5, Y + 2, 2, 4, '#f1f7fa');
  },
  washer(ctx, item, tick) { drawAppliance(ctx, item, tick, true); },
  dryer(ctx, item, tick) { drawAppliance(ctx, item, tick, false); },
  laundry_basket(ctx, item) {
    const { X, Y } = geom(item);
    box(ctx, X + 3, Y + 6, 10, 8, '#d9a066', '#f0c48a', '#b5824a', '#7a5535');
    px(ctx, X + 4, Y + 4, 3, 2, '#e74c3c'); px(ctx, X + 8, Y + 4, 3, 2, '#3498db'); px(ctx, X + 6, Y + 5, 4, 1, '#f0f0f0');
  },
  shelves(ctx, item) {
    tiled(ctx, item, (X, Y, i, j) => {
      box(ctx, X, Y, 16, 16, '#b9a58a', '#d1bf9f', '#95826b', '#5f5040');
      for (let r = 0; r < 2; r++) {
        px(ctx, X + 1, Y + 6 + r * 6, 14, 1, '#7a6a55');
        for (let k = 0; k < 4; k++) {
          const h = hash2(X + k, Y + r, 11 + i + j);
          px(ctx, X + 2 + k * 3, Y + 3 + r * 6 - (h & 1), 2, 3 + (h & 1), ['#e67e22', '#27ae60', '#f1c40f', '#e74c3c', '#ecf0f1'][(h >> 3) % 5]);
        }
      }
    });
  },
  bench(ctx, item) {
    const { X, Y, W, H } = geom(item);
    box(ctx, X + 1, Y + 5, W - 2, H - 7, WOOD.base, WOOD.light, WOOD.dark, WOOD.line);
    px(ctx, X + 2, Y + H - 2, 2, 2, WOOD.line); px(ctx, X + W - 4, Y + H - 2, 2, 2, WOOD.line);
  },
  coat_rack(ctx, item) {
    const { X, Y } = geom(item);
    px(ctx, X + 7, Y + 2, 2, 12, '#6b4a3a'); px(ctx, X + 4, Y + 13, 8, 2, '#5c3a1c');
    px(ctx, X + 3, Y + 3, 4, 6, '#c0392b'); px(ctx, X + 9, Y + 4, 4, 6, '#2c3e50');
  },
  furnace(ctx, item) {
    const { X, Y } = geom(item);
    box(ctx, X + 2, Y + 1, 12, 14, '#9aa0a6', '#c0c5ca', '#6f757b', '#3f444a');
    px(ctx, X + 4, Y + 4, 8, 1, '#6f757b'); px(ctx, X + 4, Y + 8, 8, 1, '#6f757b'); px(ctx, X + 6, Y + 11, 4, 2, '#e05a2b');
  },
  water_heater(ctx, item) {
    const { X, Y } = geom(item);
    box(ctx, X + 4, Y + 1, 8, 14, '#e3e6e8', '#f5f6f7', '#b6babe', '#5a5e63');
    px(ctx, X + 6, Y, 4, 1, '#7c8085'); px(ctx, X + 7, Y + 6, 2, 2, '#c0392b');
  },
  closet(ctx, item) {
    tiled(ctx, item, (X, Y) => {
      box(ctx, X, Y, 16, 16, '#e8e2d6', '#f5f1ea', '#c4bcae', '#6b6156');
      px(ctx, X + 8, Y + 1, 1, 14, '#c4bcae'); px(ctx, X + 6, Y + 7, 1, 2, '#8a8f95'); px(ctx, X + 9, Y + 7, 1, 2, '#8a8f95');
    });
  },
  boxes(ctx, item) {
    const { X, Y } = geom(item);
    box(ctx, X + 2, Y + 7, 9, 8, '#c9a063', '#e0bd85', '#a67f47', '#7a5535');
    box(ctx, X + 6, Y + 1, 8, 7, '#c9a063', '#e0bd85', '#a67f47', '#7a5535');
    px(ctx, X + 6, Y + 10, 1, 4, '#7a5535'); px(ctx, X + 10, Y + 4, 1, 3, '#7a5535');
  },
  car(ctx, item) {
    const { X, Y, W, H, facing } = geom(item);
    const c = cushionColor('car' + item.x + ',' + item.y);
    const vert = H > W;
    box(ctx, X + 2, Y + 2, W - 4, H - 4, c, lighten(c), darken(c), '#2a2a2a');
    if (vert) {
      px(ctx, X + 4, Y + (H >> 2), W - 8, H >> 2, '#9fc7e0'); // windshield
      px(ctx, X + 4, Y + H - (H >> 2) - 4, W - 8, 4, '#9fc7e0');
      px(ctx, X, Y + 6, 2, 8, '#2a2a2a'); px(ctx, X + W - 2, Y + 6, 2, 8, '#2a2a2a');
      px(ctx, X, Y + H - 14, 2, 8, '#2a2a2a'); px(ctx, X + W - 2, Y + H - 14, 2, 8, '#2a2a2a');
      const ly = facing === 'up' ? Y + 2 : Y + H - 3;
      px(ctx, X + 3, ly, 3, 1, '#fff3a0'); px(ctx, X + W - 6, ly, 3, 1, '#fff3a0');
    } else {
      px(ctx, X + (W >> 2), Y + 4, W >> 2, H - 8, '#9fc7e0');
      px(ctx, X + W - (W >> 2) - 4, Y + 4, 4, H - 8, '#9fc7e0');
      px(ctx, X + 6, Y, 8, 2, '#2a2a2a'); px(ctx, X + 6, Y + H - 2, 8, 2, '#2a2a2a');
      px(ctx, X + W - 14, Y, 8, 2, '#2a2a2a'); px(ctx, X + W - 14, Y + H - 2, 8, 2, '#2a2a2a');
      const lx = facing === 'left' ? X + 2 : X + W - 3;
      px(ctx, lx, Y + 3, 1, 3, '#fff3a0'); px(ctx, lx, Y + H - 6, 1, 3, '#fff3a0');
    }
  },
  workbench(ctx, item) {
    const { X, Y, W, H } = geom(item);
    box(ctx, X + 1, Y + 3, W - 2, H - 4, WOOD.base, WOOD.light, WOOD.dark, WOOD.line);
    px(ctx, X + 3, Y + 5, 4, 2, '#7a7f85'); px(ctx, X + 9, Y + 6, 5, 1, '#555a60'); px(ctx, X + W - 6, Y + 5, 3, 3, '#e8c14a');
    px(ctx, X + 2, Y + H - 2, 2, 2, WOOD.line); px(ctx, X + W - 4, Y + H - 2, 2, 2, WOOD.line);
  },
  toolwall(ctx, item) {
    const { X, Y, W } = geom(item);
    px(ctx, X + 1, Y, W - 2, 9, '#8b6a4a');
    const cols = ['#7a7f85', '#c0392b', '#f1c40f', '#3498db', '#555a60'];
    for (let i = 0; i < W - 4; i += 4) px(ctx, X + 3 + i, Y + 2, 2, 5 - (i >> 2) % 2, cols[(i >> 2) % cols.length]);
  },
  trash_bin(ctx, item) {
    const { X, Y } = geom(item);
    box(ctx, X + 4, Y + 4, 8, 11, '#4d5560', '#6c7580', '#343a42', '#22262b');
    px(ctx, X + 3, Y + 3, 10, 2, '#3a4048');
  },
  recycle_bin(ctx, item) {
    const { X, Y } = geom(item);
    box(ctx, X + 4, Y + 4, 8, 11, '#2e86c1', '#5dade2', '#1f618d', '#154360');
    px(ctx, X + 3, Y + 3, 10, 2, '#1f618d'); px(ctx, X + 6, Y + 8, 4, 3, '#aed6f1');
  },
  mower(ctx, item) {
    const { X, Y } = geom(item);
    box(ctx, X + 3, Y + 6, 10, 6, '#c0392b', '#e06b5c', '#8e2b21', '#5a1a14');
    px(ctx, X + 3, Y + 12, 2, 2, '#2a2a2a'); px(ctx, X + 11, Y + 12, 2, 2, '#2a2a2a');
    px(ctx, X + 7, Y + 2, 2, 4, '#555'); px(ctx, X + 5, Y + 2, 6, 1, '#555');
  },
  bike(ctx, item) {
    const { X, Y } = geom(item);
    px(ctx, X + 1, Y + 8, 5, 5, '#2a2a2a'); px(ctx, X + 10, Y + 8, 5, 5, '#2a2a2a');
    px(ctx, X + 2, Y + 9, 3, 3, '#7a7f85'); px(ctx, X + 11, Y + 9, 3, 3, '#7a7f85');
    px(ctx, X + 4, Y + 6, 8, 2, '#e67e22'); px(ctx, X + 6, Y + 4, 2, 3, '#e67e22'); px(ctx, X + 4, Y + 3, 5, 1, '#333');
  },
  grill(ctx, item) {
    const { X, Y } = geom(item);
    box(ctx, X + 2, Y + 4, 12, 7, '#2f3438', '#4d545a', '#1f2326', '#111');
    px(ctx, X + 3, Y + 3, 10, 1, '#4d545a');
    px(ctx, X + 4, Y + 11, 1, 4, '#333'); px(ctx, X + 11, Y + 11, 1, 4, '#333');
    px(ctx, X + 5, Y + 6, 6, 1, '#e05a2b');
  },
  patio_chair(ctx, item) {
    const { X, Y, facing } = geom(item);
    box(ctx, X + 3, Y + 4, 10, 9, '#d9d4c7', '#f0ece2', '#b0aa9c', '#6b6156');
    if (facing === 'up') px(ctx, X + 3, Y + 12, 10, 3, '#8f8a7e');
    else if (facing === 'left') px(ctx, X + 12, Y + 3, 3, 10, '#8f8a7e');
    else if (facing === 'right') px(ctx, X + 1, Y + 3, 3, 10, '#8f8a7e');
    else px(ctx, X + 3, Y + 2, 10, 3, '#8f8a7e');
  },
  patio_table(ctx, item) {
    const { X, Y } = geom(item);
    box(ctx, X + 2, Y + 3, 12, 10, '#e6e2d8', '#f4f1ea', '#c4bfb3', '#6b6156');
    px(ctx, X + 7, Y + 6, 2, 3, '#e05a7a'); px(ctx, X + 6, Y + 9, 4, 2, '#5b8fb5');
  },
  tree(ctx, item) {
    const { X, Y, W, H } = geom(item);
    px(ctx, X + (W >> 1) - 2, Y + H - 8, 4, 8, '#6b4a3a');
    px(ctx, X + 2, Y + 4, W - 4, H - 10, '#3f8f44');
    px(ctx, X + 5, Y + 1, W - 10, 5, '#3f8f44');
    px(ctx, X, Y + 8, W, H - 16, '#3f8f44');
    px(ctx, X + 4, Y + 3, W - 12, 3, '#5fb15f'); px(ctx, X + 3, Y + 8, 4, 2, '#5fb15f');
    px(ctx, X + 5, Y + H - 12, W - 10, 3, '#2f6f34');
  },
  bush(ctx, item) {
    const { X, Y } = geom(item);
    px(ctx, X + 3, Y + 5, 10, 8, '#4b9a4f'); px(ctx, X + 5, Y + 3, 6, 3, '#4b9a4f');
    px(ctx, X + 1, Y + 8, 3, 4, '#4b9a4f'); px(ctx, X + 12, Y + 8, 3, 4, '#4b9a4f');
    px(ctx, X + 5, Y + 5, 3, 2, '#6fbf70'); px(ctx, X + 4, Y + 12, 8, 1, '#31703a');
  },
  flowerbed(ctx, item) {
    tiled(ctx, item, (X, Y, i, j) => {
      px(ctx, X, Y, 16, 16, '#6b4a3a'); px(ctx, X, Y, 16, 1, '#8b6a4a');
      for (let k = 0; k < 4; k++) {
        const h = hash2(X + k, Y, 5 + i + j);
        const fx = X + 2 + k * 4 + (h & 1), fy = Y + 3 + (h >> 2) % 8;
        px(ctx, fx, fy + 2, 1, 3, '#3f9c4a');
        px(ctx, fx - 1, fy, 3, 2, ['#e74c3c', '#f1c40f', '#e05a7a', '#ffffff', '#9b59b6'][(h >> 3) % 5]);
      }
    });
  },
  mailbox(ctx, item) {
    const { X, Y } = geom(item);
    px(ctx, X + 7, Y + 8, 2, 7, '#6b4a3a');
    box(ctx, X + 3, Y + 3, 10, 6, '#3d5a80', '#6b8fb5', '#2a3f5a', '#1f2d40');
    px(ctx, X + 12, Y + 2, 1, 3, '#e74c3c');
  },
  fence(ctx, item) {
    tiled(ctx, item, (X, Y) => {
      px(ctx, X, Y + 5, 16, 2, '#c9a063'); px(ctx, X, Y + 10, 16, 2, '#c9a063');
      px(ctx, X + 2, Y + 3, 3, 11, '#e0bd85'); px(ctx, X + 10, Y + 3, 3, 11, '#e0bd85');
      px(ctx, X + 2, Y + 3, 3, 1, '#f0d5a5'); px(ctx, X + 10, Y + 3, 3, 1, '#f0d5a5');
    });
  },
  stairs(ctx, item) {
    const { X, Y, W, H, facing } = geom(item);
    drawTreads(ctx, X, Y, W, H, facing);
  },
  railing(ctx, item) {
    const { X, Y, W, H } = geom(item);
    if (W >= H) { px(ctx, X, Y + 6, W, 2, '#6b4a3a'); for (let i = 2; i < W; i += 4) px(ctx, X + i, Y + 4, 1, 8, '#8b6a4a'); }
    else { px(ctx, X + 6, Y, 2, H, '#6b4a3a'); for (let i = 2; i < H; i += 4) px(ctx, X + 4, Y + i, 8, 1, '#8b6a4a'); }
  },
  pool_table(ctx, item) {
    const { X, Y, W, H } = geom(item);
    box(ctx, X + 1, Y + 1, W - 2, H - 2, '#6b4a3a', '#8b6a4a', '#4a3020', '#2f1d12');
    px(ctx, X + 4, Y + 4, W - 8, H - 8, '#2e8b57'); px(ctx, X + 5, Y + 5, W - 10, 1, '#3fa06a');
    px(ctx, X + 8, Y + 9, 2, 2, '#fff'); px(ctx, X + W - 12, Y + 12, 2, 2, '#e74c3c'); px(ctx, X + W - 16, Y + 8, 2, 2, '#f1c40f');
    for (const [cx, cy] of [[3, 3], [W - 5, 3], [3, H - 5], [W - 5, H - 5]]) px(ctx, X + cx, Y + cy, 2, 2, '#111');
  },
  beanbag(ctx, item) {
    const { X, Y } = geom(item);
    const c = cushionColor('bb' + item.x + item.y);
    px(ctx, X + 3, Y + 4, 10, 10, c); px(ctx, X + 2, Y + 6, 12, 6, c); px(ctx, X + 4, Y + 3, 8, 1, lighten(c));
    px(ctx, X + 3, Y + 13, 10, 1, darken(c));
  },
  doormat(ctx, item) {
    const { X, Y } = geom(item);
    px(ctx, X + 1, Y + 3, 14, 10, '#8b6a4a'); px(ctx, X + 2, Y + 4, 12, 8, '#a8845e');
    for (let i = 3; i < 13; i += 3) px(ctx, X + i, Y + 5, 1, 6, '#8b6a4a');
  },
  mat(ctx, item) {
    const { X, Y } = geom(item);
    px(ctx, X + 1, Y + 3, 14, 10, '#7fa8b5'); px(ctx, X + 2, Y + 4, 12, 8, '#9cc2cc');
  },
};

function lighten(hex) {
  const n = parseInt(hex.slice(1), 16);
  const f = v => Math.min(255, (v + 60) | 0);
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function drawMonitor(ctx, x, y, tick) {
  box(ctx, x, y, 8, 6, '#1c1e22', null, null, '#0b0c0e');
  const on = (tick >> 4) & 1;
  px(ctx, x + 1, y + 1, 6, 4, on ? '#5dade2' : '#4a9bd0');
  px(ctx, x + 2, y + 2, 3, 1, '#d8ecff');
  px(ctx, x + 3, y + 6, 2, 1, '#3a3d42');
}

function drawAppliance(ctx, item, tick, washer) {
  const { X, Y } = geom(item);
  box(ctx, X + 1, Y + 1, 14, 14, '#e3e6e8', '#f5f6f7', '#b6babe', '#5a5e63');
  px(ctx, X + 3, Y + 2, 10, 2, '#c4c8cc'); px(ctx, X + 11, Y + 2, 2, 2, washer ? '#3498db' : '#e67e22');
  // drum
  px(ctx, X + 4, Y + 6, 8, 7, '#7c8085'); px(ctx, X + 5, Y + 7, 6, 5, '#3a3d42');
  const a = (tick >> 2) & 3;
  const dots = [[6, 8], [9, 8], [9, 10], [6, 10]];
  const [dx, dy] = dots[a];
  px(ctx, X + dx, Y + dy, 2, 2, washer ? '#5dade2' : '#f5b041');
}

function drawCouch(ctx, item) {
  const { X, Y, W, H, facing } = geom(item);
  const c = cushionColor(item.type + item.x + ',' + item.y);
  const dark = darken(c), light = lighten(c);
  box(ctx, X + 1, Y + 1, W - 2, H - 2, c, light, dark, darken(c, 0.5));
  // back on the side opposite to facing, arms on the perpendicular ends
  if (facing === 'up') { px(ctx, X + 1, Y + H - 5, W - 2, 4, dark); px(ctx, X + 1, Y + 1, 3, H - 2, dark); px(ctx, X + W - 4, Y + 1, 3, H - 2, dark); }
  else if (facing === 'left') { px(ctx, X + W - 5, Y + 1, 4, H - 2, dark); px(ctx, X + 1, Y + 1, W - 2, 3, dark); px(ctx, X + 1, Y + H - 4, W - 2, 3, dark); }
  else if (facing === 'right') { px(ctx, X + 1, Y + 1, 4, H - 2, dark); px(ctx, X + 1, Y + 1, W - 2, 3, dark); px(ctx, X + 1, Y + H - 4, W - 2, 3, dark); }
  else { px(ctx, X + 1, Y + 1, W - 2, 4, dark); px(ctx, X + 1, Y + 1, 3, H - 2, dark); px(ctx, X + W - 4, Y + 1, 3, H - 2, dark); }
  // cushion seams
  if (W > 16 && (facing === 'up' || facing === 'down')) for (let i = 16; i < W; i += 16) px(ctx, X + i, Y + 5, 1, H - 9, dark);
  if (H > 16 && (facing === 'left' || facing === 'right')) for (let i = 16; i < H; i += 16) px(ctx, X + 5, Y + i, W - 9, 1, dark);
}

function drawBed(ctx, item) {
  const { X, Y, W, H, facing } = geom(item);
  const blanket = cushionColor('bed' + item.x + ',' + item.y);
  box(ctx, X + 1, Y + 1, W - 2, H - 2, '#f0ece4', '#ffffff', '#cfc9bd', '#6b5a48');
  // pillows at head side; blanket covers the rest
  const ph = 5, pw = 5;
  if (facing === 'up') {
    for (let i = 3; i + pw < W - 2; i += pw + 2) px(ctx, X + i, Y + 3, pw, 3, '#fff');
    px(ctx, X + 2, Y + 8, W - 4, H - 10, blanket); px(ctx, X + 2, Y + 8, W - 4, 1, lighten(blanket));
  } else if (facing === 'down') {
    for (let i = 3; i + pw < W - 2; i += pw + 2) px(ctx, X + i, Y + H - 6, pw, 3, '#fff');
    px(ctx, X + 2, Y + 2, W - 4, H - 10, blanket); px(ctx, X + 2, Y + H - 9, W - 4, 1, lighten(blanket));
  } else if (facing === 'left') {
    for (let i = 3; i + ph < H - 2; i += ph + 2) px(ctx, X + 3, Y + i, 3, ph, '#fff');
    px(ctx, X + 8, Y + 2, W - 10, H - 4, blanket); px(ctx, X + 8, Y + 2, 1, H - 4, lighten(blanket));
  } else {
    for (let i = 3; i + ph < H - 2; i += ph + 2) px(ctx, X + W - 6, Y + i, 3, ph, '#fff');
    px(ctx, X + 2, Y + 2, W - 10, H - 4, blanket); px(ctx, X + W - 9, Y + 2, 1, H - 4, lighten(blanket));
  }
}

function drawTreads(ctx, X, Y, W, H, facing) {
  const vertical = facing === 'up' || facing === 'down';
  px(ctx, X, Y, W, H, '#b08655');
  if (vertical) {
    for (let i = 0; i < H; i += 4) { px(ctx, X + 1, Y + i, W - 2, 3, '#d3a877'); px(ctx, X + 1, Y + i + 3, W - 2, 1, '#7a5535'); }
    px(ctx, X, Y, 2, H, '#5c3a1c'); px(ctx, X + W - 2, Y, 2, H, '#5c3a1c');
  } else {
    for (let i = 0; i < W; i += 4) { px(ctx, X + i, Y + 1, 3, H - 2, '#d3a877'); px(ctx, X + i + 3, Y + 1, 1, H - 2, '#7a5535'); }
    px(ctx, X, Y, W, 2, '#5c3a1c'); px(ctx, X, Y + H - 2, W, 2, '#5c3a1c');
  }
}

export function drawFurnitureFront(ctx, item, tick = 0) {
  try {
    const { X, Y, W, H, facing } = geom(item);
    switch (item.type) {
      case 'sofa': case 'loveseat': case 'armchair': {
        const c = darken(cushionColor(item.type + item.x + ',' + item.y));
        // front strip in the facing direction, so a seated agent is tucked in
        if (facing === 'down') px(ctx, X + 1, Y + H - 4, W - 2, 3, c);
        else if (facing === 'up') px(ctx, X + 1, Y + 1, W - 2, 3, c);
        else if (facing === 'left') px(ctx, X + 1, Y + 1, 3, H - 2, c);
        else px(ctx, X + W - 4, Y + 1, 3, H - 2, c);
        break;
      }
      case 'bed_king': case 'bed_queen': case 'bed_single': {
        const b = cushionColor('bed' + item.x + ',' + item.y);
        if (facing === 'up') px(ctx, X + 2, Y + H - 6, W - 4, 4, b);
        else if (facing === 'down') px(ctx, X + 2, Y + 2, W - 4, 4, b);
        else if (facing === 'left') px(ctx, X + W - 6, Y + 2, 4, H - 4, b);
        else px(ctx, X + 2, Y + 2, 4, H - 4, b);
        break;
      }
      default: break;
    }
  } catch { /* never throw */ }
}

// ---------------------------------------------------------------- stairs (room decoration)
export function drawStairs(ctx, room, floor) {
  try {
    for (const rc of room.rects || []) {
      const X = rc.x * TILE, Y = rc.y * TILE, W = rc.w * TILE, H = rc.h * TILE;
      const facing = W >= H ? 'left' : 'up';
      drawTreads(ctx, X + 2, Y + 2, W - 4, H - 4, facing);
      // railing along the long side
      if (W >= H) { px(ctx, X, Y + 1, W, 2, '#6b4a3a'); for (let i = 2; i < W; i += 4) px(ctx, X + i, Y, 1, 4, '#8b6a4a'); }
      else { px(ctx, X + 1, Y, 2, H, '#6b4a3a'); for (let i = 2; i < H; i += 4) px(ctx, X, Y + i, 4, 1, '#8b6a4a'); }
    }
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------- particles
const FX = {
  cook: { every: 220, kind: 'steam' },
  grill: { every: 260, kind: 'smoke' },
  workbench: { every: 320, kind: 'spark' },
  fix: { every: 320, kind: 'spark' },
  dishes: { every: 260, kind: 'bubble' },
  washcar: { every: 240, kind: 'bubble' },
  scrub: { every: 300, kind: 'bubble' },
  laundry: { every: 500, kind: 'bubble' },
  mow: { every: 90, kind: 'clip' },
  rake: { every: 260, kind: 'leaf' },
  vacuum: { every: 200, kind: 'dust' },
  nap: { every: 900, kind: 'zzz' },
  water: { every: 140, kind: 'drop' },
  coffee: { every: 700, kind: 'steam' },
};

export function choreFx(chore) {
  const f = FX[chore];
  if (!f) return null;
  return {
    every: f.every,
    spawn(x, y, rng = Math.random) {
      const r = () => rng() - 0.5;
      const k = f.kind;
      const base = { x, y, kind: k, life: 0, maxLife: 900 };
      switch (k) {
        case 'steam': return { ...base, x: x + r() * 6, y: y - 10, vx: r() * 6, vy: -14 - rng() * 8, maxLife: 900 };
        case 'smoke': return { ...base, x: x + r() * 6, y: y - 12, vx: r() * 8, vy: -10 - rng() * 6, maxLife: 1400 };
        case 'spark': return { ...base, x: x + r() * 4, y: y - 8, vx: r() * 50, vy: -30 - rng() * 30, maxLife: 400 };
        case 'bubble': return { ...base, x: x + r() * 10, y: y - 8, vx: r() * 6, vy: -8 - rng() * 8, maxLife: 1100 };
        case 'clip': return { ...base, x: x + r() * 10, y: y - 2, vx: r() * 30, vy: -20 - rng() * 20, maxLife: 450 };
        case 'leaf': return { ...base, x: x + r() * 12, y: y - 6, vx: r() * 14, vy: -6 - rng() * 6, maxLife: 900 };
        case 'dust': return { ...base, x: x + r() * 10, y: y - 2, vx: r() * 10, vy: -4 - rng() * 4, maxLife: 700 };
        case 'zzz': return { ...base, x: x + 6, y: y - 14, vx: 5, vy: -8, maxLife: 1600 };
        case 'drop': return { ...base, x: x + 8 + r() * 4, y: y - 6, vx: r() * 8 + 6, vy: 10 + rng() * 10, maxLife: 500 };
        default: return { ...base, vx: 0, vy: -5 };
      }
    },
  };
}

export function drawParticle(ctx, p) {
  const t = p.maxLife ? Math.min(1, p.life / p.maxLife) : 0;
  const a = 1 - t;
  const x = Math.round(p.x), y = Math.round(p.y);
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, a));
  switch (p.kind) {
    case 'steam': { const s = t < 0.5 ? 2 : 3; px(ctx, x - (s >> 1), y - (s >> 1), s, s, '#f5f5f5'); break; }
    case 'smoke': { const s = t < 0.4 ? 2 : 3; px(ctx, x - (s >> 1), y - (s >> 1), s, s, '#8a8a8a'); break; }
    case 'spark': px(ctx, x, y, 1, 1, t < 0.5 ? '#fff3a0' : '#f39c12'); break;
    case 'bubble': px(ctx, x - 1, y - 1, 3, 3, '#bfe6f5'); px(ctx, x - 1, y - 1, 1, 1, '#ffffff'); break;
    case 'clip': px(ctx, x, y, 2, 1, '#5fa84a'); break;
    case 'leaf': px(ctx, x, y, 2, 2, (p.x | 0) & 1 ? '#d9822b' : '#c0392b'); break;
    case 'dust': px(ctx, x - 1, y - 1, 3, 2, '#c9bfae'); break;
    case 'zzz': {
      // a tiny "z" glyph
      const c = '#5b7fb5';
      px(ctx, x, y, 3, 1, c); px(ctx, x + 1, y + 1, 1, 1, c); px(ctx, x, y + 2, 3, 1, c);
      break;
    }
    case 'drop': px(ctx, x, y, 1, 2, '#5dade2'); break;
    default: px(ctx, x, y, 1, 1, '#fff');
  }
  ctx.restore();
}

// ---------------------------------------------------------------- labels
export const CHORE_LABEL = {
  desk: 'at the computer', read: 'reading a book', bookshelf: 'browsing the bookshelf', mail: 'checking the mail',
  pantry: 'taking stock of the pantry', cook: 'cooking', chop: 'chopping veggies', grill: 'grilling',
  workbench: 'tinkering at the workbench', fold: 'folding laundry', makebed: 'making the bed', mow: 'mowing the lawn',
  rake: 'raking leaves', trash: 'taking out the trash', washcar: 'washing the car', fix: 'fixing the furnace',
  laundry: 'doing laundry', vacuum: 'vacuuming', dishes: 'doing the dishes', scrub: 'scrubbing the bathroom',
  tv: 'watching TV', phone: 'scrolling on the phone', pool: 'playing pool', water: 'watering the plants',
  coffee: 'having a coffee', sit: 'chilling on the couch', nap: 'napping', helper: 'calling for help',
  think: 'thinking',
};

export const FURNITURE_TYPES = Object.keys(SIZES);
export const CHORES = Object.keys(CHORE_LABEL);

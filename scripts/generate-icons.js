/**
 * Generates afterterm's icons (prod + dev) as .ico files, and the logo bitmaps the
 * installer draws on its pages.
 * Run: node scripts/generate-icons.js
 *
 * Design: dark rounded square with a ">" prompt, a cursor, and three colored
 * tab-group dots (teal, orange, purple) at the top.
 * Dev variant: orange-tinted background and a dot badge, so you can tell them apart
 * in the taskbar.
 *
 * Every shape is a signed distance field sampled 4x4 per pixel, so edges are
 * anti-aliased at every size. The first version filled the rounded square by
 * testing each corner pixel against all four corner centres, which cut every
 * corner off square (the notched corners seen in icon-256.png until 2026-10-29).
 */

const { PNG } = require('pngjs');
const fs = require('fs');
const path = require('path');

// ─── Colors ────────────────────────────────────────────────────────────────────

const COLORS = {
  bg:       [26, 26, 26],
  bgDev:    [50, 32, 10],
  prompt:   [224, 224, 224],
  teal:     [32, 178, 170],
  orange:   [210, 140, 50],
  purple:   [148, 103, 189],
};

// ─── Shapes, in the 256-unit design space ──────────────────────────────────────

function sdRoundRect(x, y, x0, y0, x1, y1, r) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const hx = (x1 - x0) / 2 - r, hy = (y1 - y0) / 2 - r;
  const qx = Math.abs(x - cx) - hx, qy = Math.abs(y - cy) - hy;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdCircle(x, y, cx, cy, r) {
  return Math.hypot(x - cx, y - cy) - r;
}

function sdSegment(x, y, ax, ay, bx, by, halfWidth) {
  const px = x - ax, py = y - ay, vx = bx - ax, vy = by - ay;
  const h = Math.max(0, Math.min(1, (px * vx + py * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - vx * h, py - vy * h) - halfWidth;
}

// The logo as a list of layers, back to front: [signed distance fn, colour].
function layers(isDev) {
  const L = [
    [(x, y) => sdRoundRect(x, y, 8, 8, 248, 248, 40), isDev ? COLORS.bgDev : COLORS.bg],
    [(x, y) => sdCircle(x, y, 88, 55, 12), COLORS.teal],
    [(x, y) => sdCircle(x, y, 128, 55, 12), COLORS.orange],
    [(x, y) => sdCircle(x, y, 168, 55, 12), COLORS.purple],
    [(x, y) => Math.min(sdSegment(x, y, 70, 120, 160, 165, 7), sdSegment(x, y, 70, 210, 160, 165, 7)), COLORS.prompt],
    [(x, y) => sdRoundRect(x, y, 175, 145, 187, 190, 1), COLORS.prompt],
  ];
  if (isDev) L.push([(x, y) => sdCircle(x, y, 213, 213, 28), COLORS.orange]);
  return L;
}

// ─── Rasterise ─────────────────────────────────────────────────────────────────

const SS = 4; // samples per pixel per axis

// RGBA pixels of the logo at `size` px. `background` (an [r,g,b]) composites the
// logo onto a solid colour, for the installer's bitmaps, which have no alpha.
function render(size, isDev, background) {
  const out = Buffer.alloc(size * size * 4);
  const L = layers(isDev);
  const scale = 256 / size;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) * scale;
          const y = (py + (sy + 0.5) / SS) * scale;
          let cr = 0, cg = 0, cb = 0, ca = 0;
          for (const [sd, col] of L) {
            if (sd(x, y) <= 0) { cr = col[0]; cg = col[1]; cb = col[2]; ca = 1; }
          }
          r += cr * ca; g += cg * ca; b += cb * ca; a += ca;
        }
      }
      const n = SS * SS;
      const i = (py * size + px) * 4;
      if (background) {
        const t = a / n;
        out[i] = Math.round(r / n + background[0] * (1 - t));
        out[i + 1] = Math.round(g / n + background[1] * (1 - t));
        out[i + 2] = Math.round(b / n + background[2] * (1 - t));
        out[i + 3] = 255;
      } else {
        out[i] = a ? Math.round(r / a) : 0;
        out[i + 1] = a ? Math.round(g / a) : 0;
        out[i + 2] = a ? Math.round(b / a) : 0;
        out[i + 3] = Math.round((a / n) * 255);
      }
    }
  }
  return out;
}

function toPng(size, rgba) {
  const png = new PNG({ width: size, height: size });
  rgba.copy(png.data);
  return PNG.sync.write(png);
}

// 24-bit bottom-up BMP, the one image format NSIS's nsDialogs draws natively.
function toBmp(size, rgba) {
  const row = Math.ceil((size * 3) / 4) * 4;
  const buf = Buffer.alloc(54 + row * size);
  buf.write('BM', 0);
  buf.writeUInt32LE(buf.length, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(size, 18);
  buf.writeInt32LE(size, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(row * size, 34);
  for (let y = 0; y < size; y++) {
    const dst = 54 + (size - 1 - y) * row;
    for (let x = 0; x < size; x++) {
      const s = (y * size + x) * 4;
      buf[dst + x * 3] = rgba[s + 2];
      buf[dst + x * 3 + 1] = rgba[s + 1];
      buf[dst + x * 3 + 2] = rgba[s];
    }
  }
  return buf;
}

// ─── ICO file format ───────────────────────────────────────────────────────────

function createIco(pngBuffers, sizes) {
  const count = pngBuffers.length;
  const headerSize = 6 + count * 16;
  let offset = headerSize;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);     // reserved
  header.writeUInt16LE(1, 2);     // type = ICO
  header.writeUInt16LE(count, 4); // image count
  for (let i = 0; i < count; i++) {
    const e = 6 + i * 16;
    header.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], e);      // width (0 = 256)
    header.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], e + 1);  // height
    header.writeUInt16LE(1, e + 4);                             // color planes
    header.writeUInt16LE(32, e + 6);                            // bits per pixel
    header.writeUInt32LE(pngBuffers[i].length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += pngBuffers[i].length;
  }
  return Buffer.concat([header, ...pngBuffers]);
}

// ─── Generate ──────────────────────────────────────────────────────────────────

const assetsDir = path.join(__dirname, '..', 'assets');
const installerDir = path.join(__dirname, '..', 'installer');
fs.mkdirSync(assetsDir, { recursive: true });
fs.mkdirSync(installerDir, { recursive: true });

const sizes = [256, 64, 48, 40, 32, 24, 20, 16];

for (const variant of ['prod', 'dev']) {
  const isDev = variant === 'dev';
  const pngs = sizes.map(s => toPng(s, render(s, isDev)));
  const name = isDev ? 'icon-dev.ico' : 'icon.ico';
  fs.writeFileSync(path.join(assetsDir, name), createIco(pngs, sizes));
  fs.writeFileSync(path.join(assetsDir, isDev ? 'icon-dev-256.png' : 'icon-256.png'), pngs[0]);
  console.log(`${name}: ${sizes.join(', ')}px`);
}

// The installer's logos, on its window colour (#212121), at 1x and 2x so they stay
// sharp at 200% display scaling. Names say the size in 1x pixels.
const WINDOW_BG = [33, 33, 33];
for (const s of [80, 56, 96]) {
  for (const k of [1, 2]) {
    const px = s * k;
    const file = `logo-${s}${k === 2 ? '@2x' : ''}.bmp`;
    fs.writeFileSync(path.join(installerDir, file), toBmp(px, render(px, false, WINDOW_BG)));
  }
}
console.log('installer logos: 80, 56, 96 (1x and 2x)');

// The check page's status marks, 20 units square: a teal tick, a red cross, and
// eight frames of a spinner (a ring with a bright arc that moves on each frame).
function renderMark(size, layersFn) {
  const out = Buffer.alloc(size * size * 4);
  const scale = 20 / size;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) * scale, y = (py + (sy + 0.5) / SS) * scale;
          let c = WINDOW_BG;
          for (const [sd, col] of layersFn()) if (sd(x, y) <= 0) c = col;
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const n = SS * SS, i = (py * size + px) * 4;
      out[i] = Math.round(r / n); out[i + 1] = Math.round(g / n); out[i + 2] = Math.round(b / n); out[i + 3] = 255;
    }
  }
  return out;
}
const INK = [13, 13, 13];
const MARKS = {
  tick: () => [
    [(x, y) => sdCircle(x, y, 10, 10, 9), [32, 178, 170]],
    [(x, y) => Math.min(sdSegment(x, y, 6, 10.4, 8.6, 13, 1), sdSegment(x, y, 8.6, 13, 14, 7.6, 1)), INK],
  ],
  cross: () => [
    [(x, y) => sdCircle(x, y, 10, 10, 9), [242, 120, 109]],
    [(x, y) => Math.min(sdSegment(x, y, 7, 7, 13, 13, 1), sdSegment(x, y, 13, 7, 7, 13, 1)), INK],
  ],
};
for (let f = 0; f < 8; f++) {
  const start = (f / 8) * Math.PI * 2;
  MARKS[`spin${f}`] = () => [
    [(x, y) => Math.abs(sdCircle(x, y, 10, 10, 6.5)) - 1, [68, 68, 68]],
    [(x, y) => {
      let a = Math.atan2(y - 10, x - 10) - start;
      a = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      return a < Math.PI * 0.6 ? Math.abs(sdCircle(x, y, 10, 10, 6.5)) - 1 : 1;
    }, [236, 236, 236]],
  ];
}
for (const [name, fn] of Object.entries(MARKS)) {
  for (const k of [1, 2]) {
    const px = 20 * k;
    fs.writeFileSync(path.join(installerDir, `${name}${k === 2 ? '@2x' : ''}.bmp`), toBmp(px, renderMark(px, fn)));
  }
}
console.log('installer marks: tick, cross, 8 spinner frames (1x and 2x)');

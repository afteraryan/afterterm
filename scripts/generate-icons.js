/**
 * Generates afterterm icons (prod + dev) as .ico files.
 * Run: node scripts/generate-icons.js
 *
 * Design: dark rounded square with a ">" prompt and three colored
 * tab-group dots (teal, orange, purple) at the top.
 * Dev variant: orange-tinted background so you can tell them apart in the taskbar.
 */

const { PNG } = require('pngjs');
const fs = require('fs');
const path = require('path');

// ─── Colors ────────────────────────────────────────────────────────────────────

const COLORS = {
  bg:       { r: 26,  g: 26,  b: 26  },
  bgDev:    { r: 50,  g: 32,  b: 10  },
  prompt:   { r: 224, g: 224, b: 224 },
  teal:     { r: 32,  g: 178, b: 170 },
  orange:   { r: 210, g: 140, b: 50  },
  purple:   { r: 148, g: 103, b: 189 },
  border:   { r: 50,  g: 50,  b: 50  },
  borderDev:{ r: 80,  g: 55,  b: 20  },
};

// ─── Drawing helpers ───────────────────────────────────────────────────────────

function setPixel(png, x, y, r, g, b, a = 255) {
  if (x < 0 || x >= png.width || y < 0 || y >= png.height) return;
  const idx = (png.width * y + x) << 2;
  png.data[idx] = r;
  png.data[idx + 1] = g;
  png.data[idx + 2] = b;
  png.data[idx + 3] = a;
}

function blendPixel(png, x, y, r, g, b, a) {
  if (x < 0 || x >= png.width || y < 0 || y >= png.height) return;
  const idx = (png.width * y + x) << 2;
  const srcA = a / 255;
  const dstA = png.data[idx + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA === 0) return;
  png.data[idx]     = Math.round((r * srcA + png.data[idx]     * dstA * (1 - srcA)) / outA);
  png.data[idx + 1] = Math.round((g * srcA + png.data[idx + 1] * dstA * (1 - srcA)) / outA);
  png.data[idx + 2] = Math.round((b * srcA + png.data[idx + 2] * dstA * (1 - srcA)) / outA);
  png.data[idx + 3] = Math.round(outA * 255);
}

function fillCircle(png, cx, cy, radius, { r, g, b }) {
  const r2 = radius * radius;
  for (let dy = -radius - 1; dy <= radius + 1; dy++) {
    for (let dx = -radius - 1; dx <= radius + 1; dx++) {
      const dist2 = dx * dx + dy * dy;
      if (dist2 <= r2) {
        setPixel(png, Math.round(cx + dx), Math.round(cy + dy), r, g, b);
      } else if (dist2 <= (radius + 1) * (radius + 1)) {
        const edge = 1 - (Math.sqrt(dist2) - radius);
        if (edge > 0) blendPixel(png, Math.round(cx + dx), Math.round(cy + dy), r, g, b, Math.round(edge * 255));
      }
    }
  }
}

function fillRoundedRect(png, x, y, w, h, radius, { r, g, b }) {
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      let inside = true;
      // Check corners
      const corners = [
        [x + radius, y + radius],
        [x + w - radius - 1, y + radius],
        [x + radius, y + h - radius - 1],
        [x + w - radius - 1, y + h - radius - 1],
      ];
      for (const [cx, cy] of corners) {
        const inCornerRegion =
          (px < x + radius && py < y + radius) ||
          (px >= x + w - radius && py < y + radius) ||
          (px < x + radius && py >= y + h - radius) ||
          (px >= x + w - radius && py >= y + h - radius);
        if (inCornerRegion) {
          const dx = px - cx;
          const dy = py - cy;
          if (dx * dx + dy * dy > radius * radius) {
            inside = false;
            break;
          }
        }
      }
      if (inside) setPixel(png, px, py, r, g, b);
    }
  }
}

// ─── Draw the icon at a given size ─────────────────────────────────────────────

function drawIcon(size, isDev) {
  const png = new PNG({ width: size, height: size, filterType: -1 });

  // Transparent background
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 0; png.data[i+1] = 0; png.data[i+2] = 0; png.data[i+3] = 0;
  }

  const s = size / 256; // scale factor
  const bg = isDev ? COLORS.bgDev : COLORS.bg;
  const border = isDev ? COLORS.borderDev : COLORS.border;

  // Background rounded rectangle
  const margin = Math.round(8 * s);
  const cornerR = Math.round(40 * s);
  fillRoundedRect(png, margin, margin, size - margin * 2, size - margin * 2, cornerR, bg);

  // Border (draw slightly larger rect behind, then bg on top — simple approach)
  // Skip border for simplicity at small sizes; the rounded rect is enough

  // Three tab-group dots at the top
  const dotR = Math.round(12 * s);
  const dotY = Math.round(55 * s);
  const dotSpacing = Math.round(40 * s);
  const dotStartX = Math.round(size / 2 - dotSpacing);
  fillCircle(png, dotStartX, dotY, dotR, COLORS.teal);
  fillCircle(png, dotStartX + dotSpacing, dotY, dotR, COLORS.orange);
  fillCircle(png, dotStartX + dotSpacing * 2, dotY, dotR, COLORS.purple);

  // ">" prompt character — draw as two thick lines forming a chevron
  const promptX = Math.round(70 * s);
  const promptY = Math.round(120 * s);
  const promptW = Math.round(90 * s);
  const promptH = Math.round(90 * s);
  const thickness = Math.max(Math.round(14 * s), 2);

  const midY = promptY + promptH / 2;
  const rightX = promptX + promptW;

  // Top line of > (going right-down)
  for (let t = 0; t <= 1; t += 0.002) {
    const px = promptX + t * promptW;
    const py = promptY + t * (promptH / 2);
    for (let dx = -thickness/2; dx <= thickness/2; dx++) {
      for (let dy = -thickness/2; dy <= thickness/2; dy++) {
        if (dx*dx + dy*dy <= (thickness/2) * (thickness/2)) {
          setPixel(png, Math.round(px + dx), Math.round(py + dy), COLORS.prompt.r, COLORS.prompt.g, COLORS.prompt.b);
        }
      }
    }
  }

  // Bottom line of > (going right-up)
  for (let t = 0; t <= 1; t += 0.002) {
    const px = promptX + t * promptW;
    const py = promptY + promptH - t * (promptH / 2);
    for (let dx = -thickness/2; dx <= thickness/2; dx++) {
      for (let dy = -thickness/2; dy <= thickness/2; dy++) {
        if (dx*dx + dy*dy <= (thickness/2) * (thickness/2)) {
          setPixel(png, Math.round(px + dx), Math.round(py + dy), COLORS.prompt.r, COLORS.prompt.g, COLORS.prompt.b);
        }
      }
    }
  }

  // Cursor block (blinking cursor) — small rectangle to the right of >
  const cursorX = Math.round(175 * s);
  const cursorY = Math.round(145 * s);
  const cursorW = Math.round(12 * s);
  const cursorH = Math.round(45 * s);
  for (let py = cursorY; py < cursorY + cursorH; py++) {
    for (let px = cursorX; px < cursorX + cursorW; px++) {
      setPixel(png, px, py, COLORS.prompt.r, COLORS.prompt.g, COLORS.prompt.b);
    }
  }

  // Dev badge: small "D" indicator in bottom-right corner
  if (isDev && size >= 48) {
    const badgeR = Math.round(28 * s);
    const badgeCx = size - margin - Math.round(35 * s);
    const badgeCy = size - margin - Math.round(35 * s);
    fillCircle(png, badgeCx, badgeCy, badgeR, COLORS.orange);
  }

  return PNG.sync.write(png);
}

// ─── ICO file format ───────────────────────────────────────────────────────────

function createIco(pngBuffers) {
  // ICO header: 2 reserved + 2 type (1=ico) + 2 count
  const count = pngBuffers.length;
  const headerSize = 6 + count * 16;
  let offset = headerSize;

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);     // reserved
  header.writeUInt16LE(1, 2);     // type = ICO
  header.writeUInt16LE(count, 4); // image count

  const entries = [];
  for (let i = 0; i < count; i++) {
    const png = PNG.sync.read(pngBuffers[i]);
    const entryOffset = 6 + i * 16;
    header.writeUInt8(png.width >= 256 ? 0 : png.width, entryOffset);      // width (0 = 256)
    header.writeUInt8(png.height >= 256 ? 0 : png.height, entryOffset + 1); // height
    header.writeUInt8(0, entryOffset + 2);     // color palette
    header.writeUInt8(0, entryOffset + 3);     // reserved
    header.writeUInt16LE(1, entryOffset + 4);  // color planes
    header.writeUInt16LE(32, entryOffset + 6); // bits per pixel
    header.writeUInt32LE(pngBuffers[i].length, entryOffset + 8);  // size
    header.writeUInt32LE(offset, entryOffset + 12);               // offset
    offset += pngBuffers[i].length;
  }

  return Buffer.concat([header, ...pngBuffers]);
}

// ─── Generate ──────────────────────────────────────────────────────────────────

const outDir = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const sizes = [256, 48, 32, 16];

for (const variant of ['prod', 'dev']) {
  const isDev = variant === 'dev';
  const pngs = sizes.map(s => drawIcon(s, isDev));
  const ico = createIco(pngs);
  const name = isDev ? 'icon-dev.ico' : 'icon.ico';
  fs.writeFileSync(path.join(outDir, name), ico);

  // Also save the 256px PNG for reference
  const pngName = isDev ? 'icon-dev-256.png' : 'icon-256.png';
  fs.writeFileSync(path.join(outDir, pngName), pngs[0]);

  console.log(`${name} (${ico.length} bytes) — ${sizes.join(', ')}px`);
}

console.log(`\nIcons written to ${outDir}`);

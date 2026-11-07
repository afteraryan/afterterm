// A project's colour: one of the set names in GROUP_COLORS, or any '#rrggbb' chosen
// on the colour wheel. Everything that draws a project asks groupColors for the look,
// so nothing else needs to know which kind it has. Also the wheel's arithmetic and the
// rule for reading a colour code while it is still being typed. No React, no DOM:
// unit-tested with `node src/renderer/projectColour.test.ts`.
import { GROUP_COLORS } from './components/TabBar/types.ts';
import type { GroupColor, CustomColor } from './components/TabBar/types.ts';

export interface Hsv { h: number; s: number; v: number }

export function isCustomColor(color: string): color is CustomColor {
  return /^#[0-9a-f]{6}$/i.test(color);
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
}

export function rgbToHex(rgb: readonly number[]): CustomColor {
  return `#${rgb.map(x => x.toString(16).padStart(2, '0')).join('')}`;
}

export function hsvToRgb({ h, s, v }: Hsv): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255);
  };
  return [f(5), f(3), f(1)];
}

export const hsvToHex = (hsv: Hsv): CustomColor => rgbToHex(hsvToRgb(hsv));

export function hexToHsv(hex: string): Hsv {
  const [r, g, b] = hexToRgb(hex).map(x => x / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return { h: h * 60, s: max === 0 ? 0 : d / max, v: max };
}

// What a colour code means while it is still being typed, so the colour follows every
// key. Three digits is the usual short form (#fff); anything else short reads from the
// left with zeros after it. Null when it cannot become a code.
export function readHexInput(text: string): CustomColor | null {
  const m = /^#?([0-9a-f]{1,6})$/i.exec(text.trim());
  if (!m) return null;
  const digits = m[1].toLowerCase();
  if (digits.length === 3) return `#${[...digits].map(d => d + d).join('')}`;
  return `#${digits.padEnd(6, '0')}`;
}

// A point on the wheel, x and y from 0 to 1 across its box, as a hue (red at the top,
// going clockwise) and a saturation (white at the centre). A point outside the circle
// counts as its edge, so a drag can run past the wheel.
export function wheelPoint(x: number, y: number): { h: number; s: number } {
  const dx = x - 0.5;
  const dy = y - 0.5;
  let h = Math.atan2(dx, -dy) * 180 / Math.PI;
  if (h < 0) h += 360;
  return { h, s: Math.min(1, Math.hypot(dx, dy) * 2) };
}

// Where the wheel's selector sits for a hue and saturation, in percent of its box.
export function wheelThumb(h: number, s: number): { left: number; top: number } {
  const a = h * Math.PI / 180;
  return { left: 50 + 50 * s * Math.sin(a), top: 50 - 50 * s * Math.cos(a) };
}

// The look of a project's colour. A value that is neither a set name nor a code (only
// a hand-edited session file could hold one) draws as the first set colour.
export function groupColors(color: GroupColor): { bg: string; border: string; text: string } {
  if (isCustomColor(color)) {
    return { bg: `rgba(${hexToRgb(color).join(',')},0.15)`, border: color, text: color };
  }
  return GROUP_COLORS[color] ?? GROUP_COLORS.teal;
}

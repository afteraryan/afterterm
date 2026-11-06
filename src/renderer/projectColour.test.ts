// Unit tests for projectColour.ts (custom project colours, the colour wheel's arithmetic
// and reading a colour code as it is typed). Run directly on Node 24+ (strips types):
//   node src/renderer/projectColour.test.ts
// Exits 0 if all pass, 1 on any failure.

import {
  isCustomColor, hexToRgb, rgbToHex, hsvToRgb, hsvToHex, hexToHsv, readHexInput, wheelPoint, wheelThumb, groupColors,
} from './projectColour.ts';
import { COLOR_CYCLE, GROUP_COLORS, nextGroupColor } from './components/TabBar/types.ts';
import type { GroupColor } from './components/TabBar/types.ts';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}
const near = (a: number, b: number) => Math.abs(a - b) < 0.0001;

console.log('\nprojectColour: isCustomColor\n');
{
  check('a full code is custom', isCustomColor('#e11d48'));
  check('capitals count', isCustomColor('#E11D48'));
  check('a set name is not', !isCustomColor('teal'));
  check('a short code is not (only full codes are saved)', !isCustomColor('#fff'));
  check('text that is not hex is not', !isCustomColor('#zzzzzz'));
}

console.log('\nprojectColour: hex and rgb\n');
{
  check('hexToRgb', hexToRgb('#e11d48').join() === '225,29,72');
  check('rgbToHex pads each part', rgbToHex([0, 10, 255]) === '#000aff');
}

console.log('\nprojectColour: hsv\n');
{
  check('red', hsvToHex({ h: 0, s: 1, v: 1 }) === '#ff0000');
  check('green', hsvToHex({ h: 120, s: 1, v: 1 }) === '#00ff00');
  check('blue', hsvToHex({ h: 240, s: 1, v: 1 }) === '#0000ff');
  check('no saturation is white', hsvToHex({ h: 200, s: 0, v: 1 }) === '#ffffff');
  check('no brightness is black', hsvToHex({ h: 200, s: 1, v: 0 }) === '#000000');
  check('hue 360 is red again', hsvToRgb({ h: 360, s: 1, v: 1 }).join() === '255,0,0');
  check('black reads with no division by zero', hexToHsv('#000000').s === 0 && hexToHsv('#000000').v === 0);
  check('white has no saturation', hexToHsv('#ffffff').s === 0 && hexToHsv('#ffffff').v === 1);

  let broken = '';
  for (let r = 0; r < 256 && !broken; r += 17) {
    for (let g = 0; g < 256 && !broken; g += 17) {
      for (let b = 0; b < 256 && !broken; b += 17) {
        const hex = rgbToHex([r, g, b]);
        if (hsvToHex(hexToHsv(hex)) !== hex) broken = hex;
      }
    }
  }
  check('a code survives going through the wheel and back', broken === '', broken);
  for (const c of COLOR_CYCLE) {
    const hex = GROUP_COLORS[c].border;
    check(`${c} opens on the wheel at its own colour`, hsvToHex(hexToHsv(hex)) === hex);
  }
}

console.log('\nprojectColour: a code as it is typed\n');
{
  check('one digit', readHexInput('f') === '#f00000');
  check('two digits', readHexInput('ff') === '#ff0000');
  check('three digits is the short form', readHexInput('#fff') === '#ffffff');
  check('another short form', readHexInput('0af') === '#00aaff');
  check('four digits', readHexInput('ff00') === '#ff0000');
  check('five digits', readHexInput('#e11d4') === '#e11d40');
  check('six digits', readHexInput('#e11d48') === '#e11d48');
  check('capitals become lower case', readHexInput('#E11D48') === '#e11d48');
  check('spaces around it are ignored', readHexInput('  #0af ') === '#00aaff');
  check('a # alone is nothing yet', readHexInput('#') === null);
  check('empty is nothing', readHexInput('') === null);
  check('a letter that is not hex is nothing', readHexInput('z') === null);
  check('seven digits is nothing', readHexInput('#1234567') === null);
}

console.log('\nprojectColour: the wheel\n');
{
  const top = wheelPoint(0.5, 0);
  check('the top is red', near(top.h, 0) && near(top.s, 1));
  const right = wheelPoint(1, 0.5);
  check('the right is a quarter round', near(right.h, 90) && near(right.s, 1));
  const left = wheelPoint(0, 0.5);
  check('the left is three quarters round', near(left.h, 270));
  check('the centre has no saturation', wheelPoint(0.5, 0.5).s === 0);
  check('halfway out is half saturated', near(wheelPoint(0.5, 0.25).s, 0.5));
  check('past the edge counts as the edge', wheelPoint(3, 0.5).s === 1);
  check('the selector sits at the centre with no saturation', near(wheelThumb(123, 0).left, 50) && near(wheelThumb(123, 0).top, 50));
  check('the selector is at the top for red', near(wheelThumb(0, 1).left, 50) && near(wheelThumb(0, 1).top, 0));
  check('the selector is at the right for a quarter round', near(wheelThumb(90, 1).left, 100) && near(wheelThumb(90, 1).top, 50));
  const back = wheelThumb(217, 0.6);
  const again = wheelPoint(back.left / 100, back.top / 100);
  check('selector and point agree', near(again.h, 217) && near(again.s, 0.6));
}

console.log('\nprojectColour: groupColors\n');
{
  check('a set name uses the table', groupColors('blue') === GROUP_COLORS.blue);
  check('white is a set colour', groupColors('white').border === '#ffffff');
  const custom = groupColors('#e11d48');
  check('a code is its own border and text', custom.border === '#e11d48' && custom.text === '#e11d48');
  check('a code gets the same tint as the set colours', custom.bg === 'rgba(225,29,72,0.15)');
  check('an unknown value draws as the first set colour', groupColors('nonsense' as GroupColor) === GROUP_COLORS.teal);
}

console.log('\nprojectColour: the set colours\n');
{
  check('white is last, beside yellow', COLOR_CYCLE.slice(-2).join() === 'yellow,white');
  check('every set colour has a look', COLOR_CYCLE.every(c => !!GROUP_COLORS[c]));
  check('a new project skips colours in use, custom ones included',
    nextGroupColor([{ color: '#e11d48' }, { color: 'teal' }]) === 'blue');
  check('white comes after the others are used',
    nextGroupColor(COLOR_CYCLE.slice(0, -1).map(color => ({ color }))) === 'white');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

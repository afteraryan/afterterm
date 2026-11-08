// Unit tests for panelWidth.ts. Run directly on Node 24+ (strips types):
//   node src/renderer/panelWidth.test.ts
// Exits 0 if all pass, 1 on any failure.

import {
  PANEL_DEFAULT_WIDTH, PANEL_MIN_WIDTH, PANEL_MAX_SHARE, PANEL_SAVED_MAX,
  panelMaxWidth, clampPanelWidth, widthAfterDrag, asPanelWidth,
} from './panelWidth.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}
const show = (v: unknown) => JSON.stringify(v);

console.log('\npanelWidth: the limits\n');
{
  check('the default is 264, the same as theme.css --sidebar', PANEL_DEFAULT_WIDTH === 264);
  check('the minimum is 180', PANEL_MIN_WIDTH === 180);
  check('the maximum is half the window', PANEL_MAX_SHARE === 0.5);
  check('the default is inside the limits of a normal window', clampPanelWidth(PANEL_DEFAULT_WIDTH, 1280) === PANEL_DEFAULT_WIDTH);

  check('half of a 1280px window is 640', panelMaxWidth(1280) === 640, show(panelMaxWidth(1280)));
  check('half of an odd width rounds down', panelMaxWidth(1281) === 640, show(panelMaxWidth(1281)));
  check('a very narrow window never makes the maximum smaller than the minimum', panelMaxWidth(200) === PANEL_MIN_WIDTH, show(panelMaxWidth(200)));
}

console.log('\npanelWidth: clampPanelWidth\n');
{
  check('a width inside the limits is kept', clampPanelWidth(300, 1280) === 300);
  check('a width below the minimum becomes the minimum', clampPanelWidth(100, 1280) === 180, show(clampPanelWidth(100, 1280)));
  check('a width above half the window becomes half the window', clampPanelWidth(900, 1280) === 640, show(clampPanelWidth(900, 1280)));
  check('exactly the minimum is kept', clampPanelWidth(180, 1280) === 180);
  check('exactly half the window is kept', clampPanelWidth(640, 1280) === 640);
  check('a fraction is rounded to a whole pixel', clampPanelWidth(300.6, 1280) === 301, show(clampPanelWidth(300.6, 1280)));
  check('the same saved width is allowed on a bigger window', clampPanelWidth(700, 1920) === 700);
  check('and held to half on a smaller one', clampPanelWidth(700, 1000) === 500, show(clampPanelWidth(700, 1000)));
}

console.log('\npanelWidth: widthAfterDrag\n');
{
  check('no movement keeps the width', widthAfterDrag(264, 340, 340, 1280) === 264);
  check('moving right 60px widens by 60', widthAfterDrag(264, 340, 400, 1280) === 324, show(widthAfterDrag(264, 340, 400, 1280)));
  check('moving left 40px narrows by 40', widthAfterDrag(264, 340, 300, 1280) === 224, show(widthAfterDrag(264, 340, 300, 1280)));
  check('dragging far left stops at the minimum', widthAfterDrag(264, 340, 0, 1280) === 180, show(widthAfterDrag(264, 340, 0, 1280)));
  check('dragging far right stops at half the window', widthAfterDrag(264, 340, 1270, 1280) === 640, show(widthAfterDrag(264, 340, 1270, 1280)));
  check('it follows the pointer from where it was pressed, not from the edge', widthAfterDrag(264, 345, 365, 1280) === 284, show(widthAfterDrag(264, 345, 365, 1280)));
  check('the result is a whole number of pixels', Number.isInteger(widthAfterDrag(264.4, 340.2, 380.7, 1280)));
}

console.log('\npanelWidth: asPanelWidth (what a saved file may hold)\n');
{
  check('a normal width is kept', asPanelWidth(300) === 300);
  check('the minimum is kept', asPanelWidth(180) === 180);
  check('a wide width from a big window is kept', asPanelWidth(900) === 900);
  check('the largest allowed is kept', asPanelWidth(PANEL_SAVED_MAX) === PANEL_SAVED_MAX);
  check('a fraction is rounded', asPanelWidth(300.4) === 300, show(asPanelWidth(300.4)));

  check('below the minimum is dropped, not clamped', asPanelWidth(179) === undefined);
  check('zero is dropped', asPanelWidth(0) === undefined);
  check('a negative number is dropped', asPanelWidth(-264) === undefined);
  check('above the saved maximum is dropped', asPanelWidth(PANEL_SAVED_MAX + 1) === undefined);
  check('NaN is dropped', asPanelWidth(NaN) === undefined);
  check('Infinity is dropped', asPanelWidth(Infinity) === undefined);
  check('a string is dropped, not coerced', asPanelWidth('300') === undefined);
  check('null is dropped', asPanelWidth(null) === undefined);
  check('undefined is dropped', asPanelWidth(undefined) === undefined);
  check('an object is dropped', asPanelWidth({ width: 300 }) === undefined);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);

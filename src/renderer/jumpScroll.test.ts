// Unit tests for jumpScroll.ts. Run directly on Node 24+ (strips types):
//   node src/renderer/jumpScroll.test.ts
// Exits 0 if all pass, 1 on any failure.

import {
  initialJumpState, onScrollSample, JUMP_THRESHOLD_LINES, JUMP_THRESHOLD_PX,
} from './jumpScroll.ts';
import type { JumpState } from './jumpScroll.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}
const show = (v: unknown) => JSON.stringify(v);

console.log('\njumpScroll: initialJumpState\n');
{
  const s = initialJumpState();
  check('starts with no target', s.target === null);
  check('starts at position 0 by default', s.position === 0);

  const s2 = initialJumpState(40);
  check('an initial position is kept', s2.position === 40, show(s2));
  check('an initial position still starts with no target', s2.target === null);
}

console.log('\njumpScroll: nothing to scroll (max <= 0)\n');
{
  const s = onScrollSample(initialJumpState(), 0, 0, JUMP_THRESHOLD_PX);
  check('max 0 is always hidden', s.target === null, show(s));

  const s2 = onScrollSample(initialJumpState(), 0, -5, JUMP_THRESHOLD_PX);
  check('a negative max is always hidden', s2.target === null, show(s2));
  check('position clamps to 0 when max is negative', s2.position === 0, show(s2));

  // Even a state already showing a target hides once there is nothing left to scroll.
  const showing: JumpState = { target: 'bottom', position: 100 };
  const s3 = onScrollSample(showing, 100, 0, JUMP_THRESHOLD_PX);
  check('an existing target is cleared once max drops to 0', s3.target === null, show(s3));
}

console.log('\njumpScroll: scrolling up (position decreases) shows top\n');
{
  const state = initialJumpState(200);
  const s = onScrollSample(state, 100, 500, JUMP_THRESHOLD_PX);
  check('scrolling up past the threshold shows top', s.target === 'top', show(s));
  check('position is sampled', s.position === 100);
}
{
  // Scrolled up, but landed exactly on the threshold: not "further than" it.
  const state = initialJumpState(200);
  const s = onScrollSample(state, JUMP_THRESHOLD_PX, 500, JUMP_THRESHOLD_PX);
  check('landing exactly on the threshold while scrolling up hides top', s.target === null, show(s));
}
{
  // Scrolled up, but still short of the threshold: no button.
  const state = initialJumpState(200);
  const s = onScrollSample(state, 20, 500, JUMP_THRESHOLD_PX);
  check('scrolling up within the threshold shows nothing', s.target === null, show(s));
}
{
  // Scrolled all the way to the very top.
  const state = initialJumpState(200);
  const s = onScrollSample(state, 0, 500, JUMP_THRESHOLD_PX);
  check('scrolling all the way to the top shows nothing', s.target === null, show(s));
}

console.log('\njumpScroll: scrolling down (position increases) shows bottom\n');
{
  const state = initialJumpState(100);
  const s = onScrollSample(state, 300, 500, JUMP_THRESHOLD_PX);
  check('scrolling down with plenty of room left shows bottom', s.target === 'bottom', show(s));
}
{
  // Edge case from the spec: already at the bottom and scrolling down shows nothing.
  const state = initialJumpState(500);
  const s = onScrollSample(state, 500, 500, JUMP_THRESHOLD_PX);
  check('already at the bottom, scrolling down (no-op) shows nothing', s.target === null, show(s));
}
{
  // Edge case from the spec: a little way from the bottom (within threshold)
  // and scrolling down shows nothing.
  const state = initialJumpState(400);
  const s = onScrollSample(state, 500 - JUMP_THRESHOLD_PX + 1, 500, JUMP_THRESHOLD_PX);
  check('within the threshold of the bottom, scrolling down shows nothing', s.target === null, show(s));
}
{
  // Landed exactly on the threshold distance from the bottom: not "further than" it.
  const state = initialJumpState(300);
  const s = onScrollSample(state, 500 - JUMP_THRESHOLD_PX, 500, JUMP_THRESHOLD_PX);
  check('landing exactly threshold-distance from the bottom hides the button', s.target === null, show(s));
}

console.log('\njumpScroll: unchanged position keeps the target, dropping it once in reach\n');
{
  // Following the bottom already (target null there), a resample at the same
  // position (nothing scrolled, output unchanged) stays hidden.
  const state: JumpState = { target: null, position: 500 };
  const s = onScrollSample(state, 500, 500, JUMP_THRESHOLD_PX);
  check('an unchanged position at the bottom stays hidden', s.target === null, show(s));
}
{
  // A 'top' target still showing, resampled at the same position (nothing
  // scrolled): the target is kept since its own distance has not changed.
  const state: JumpState = { target: 'top', position: 200 };
  const s = onScrollSample(state, 200, 500, JUMP_THRESHOLD_PX);
  check('an unchanged position keeps a showing top target', s.target === 'top', show(s));
}
{
  // A 'bottom' target still showing, resampled at the same position: kept.
  const state: JumpState = { target: 'bottom', position: 100 };
  const s = onScrollSample(state, 100, 500, JUMP_THRESHOLD_PX);
  check('an unchanged position keeps a showing bottom target', s.target === 'bottom', show(s));
}
{
  // A 'top' target showing, but max shrank so the same position is now within
  // threshold of the top (rare, but the rule is defined on remaining distance).
  const state: JumpState = { target: 'top', position: 10 };
  const s = onScrollSample(state, 10, 500, JUMP_THRESHOLD_PX);
  check('an unchanged position drops top once its own distance is within threshold', s.target === null, show(s));
}
{
  // Symmetric case for bottom: max shrinks until the unchanged position sits
  // within threshold of the new bottom.
  const state: JumpState = { target: 'bottom', position: 470 };
  const s = onScrollSample(state, 470, 500, JUMP_THRESHOLD_PX);
  check('an unchanged position drops bottom once its own distance is within threshold', s.target === null, show(s));
}

console.log('\njumpScroll: the two edge cases the spec calls out explicitly\n');
{
  // "A jump to top (position becomes 0) then hides the button": a 'top'
  // target was showing, the jump button's own click sets scrollTop/viewportY
  // to 0, and the very next sample must report hidden.
  const state: JumpState = { target: 'top', position: 300 };
  const s = onScrollSample(state, 0, 500, JUMP_THRESHOLD_PX);
  check('jumping to the top hides the button on the next sample', s.target === null, show(s));
  check('the jumped-to position is recorded', s.position === 0);
}
{
  // "new output arriving while following the bottom (position and max both
  // grow, remaining 0) hides it": simulates an auto-scrolling terminal that
  // tracks new output, so position tracks max exactly on every sample.
  let state: JumpState = { target: null, position: 500 };
  state = onScrollSample(state, 540, 540, JUMP_THRESHOLD_PX);
  check('new output that grows position and max together stays hidden', state.target === null, show(state));
  state = onScrollSample(state, 600, 600, JUMP_THRESHOLD_PX);
  check('repeated new output while following the bottom stays hidden', state.target === null, show(state));
}

console.log('\njumpScroll: threshold is a parameter, not hardcoded (lines vs pixels)\n');
{
  // The terminal scroller samples in buffer lines (JUMP_THRESHOLD_LINES, 3),
  // far smaller than the asleep pane's pixel threshold; scrolling up to land
  // exactly on the line threshold hides the button, one line further shows it.
  const far = initialJumpState(200);
  const atThreshold = onScrollSample(far, JUMP_THRESHOLD_LINES, 100, JUMP_THRESHOLD_LINES);
  check('landing exactly on the 3-line threshold while scrolling up hides top', atThreshold.target === null, show(atThreshold));

  const pastThreshold = onScrollSample(far, JUMP_THRESHOLD_LINES + 1, 100, JUMP_THRESHOLD_LINES);
  check('one line past the 3-line threshold while scrolling up shows top', pastThreshold.target === 'top', show(pastThreshold));
}
{
  check('JUMP_THRESHOLD_LINES is 3', JUMP_THRESHOLD_LINES === 3);
  check('JUMP_THRESHOLD_PX is 48', JUMP_THRESHOLD_PX === 48);
}

console.log('\njumpScroll: position is always clamped to 0..max\n');
{
  const s = onScrollSample(initialJumpState(0), -20, 500, JUMP_THRESHOLD_PX);
  check('a negative sampled position clamps to 0', s.position === 0, show(s));
  const s2 = onScrollSample(initialJumpState(0), 9999, 500, JUMP_THRESHOLD_PX);
  check('a sampled position beyond max clamps to max', s2.position === 500, show(s2));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);

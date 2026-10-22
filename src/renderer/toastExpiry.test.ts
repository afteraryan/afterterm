// Unit tests for toastExpiry.ts. Run directly on Node 24+ (strips types):
//   node src/renderer/toastExpiry.test.ts
// Exits 0 if all pass, 1 on any failure.

import {
  TOAST_LIFETIME_MS, initialToastClock, clockRuns, syncToasts, setMainFocus,
  setHoveredToast, expiredToasts, nextDeadline,
} from './toastExpiry.ts';
import type { ToastClock } from './toastExpiry.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}
const show = (v: unknown) => JSON.stringify(v);
const L = TOAST_LIFETIME_MS;

console.log('\ntoastExpiry: the lifetime and the starting clock\n');
{
  check('a toast lives 5 seconds', L === 5000);
  const c = initialToastClock();
  check('starts not focused', c.focused === false);
  check('starts with nothing hovered', c.hoveredId === null);
  check('starts with no toasts', Object.keys(c.deadlines).length === 0);
  check('not focused: the clock is stopped', clockRuns(c) === false);
  check('focused and nothing hovered: the clock runs', clockRuns(initialToastClock(true)) === true);
  check('no toasts: no next deadline', nextDeadline(c) === null);
}

console.log('\ntoastExpiry: a toast that arrives while the window is focused\n');
{
  const c = syncToasts(initialToastClock(true), ['a'], 1000);
  check('gets now + 5s', c.deadlines.a === 1000 + L, show(c));
  check('is not expired just before', expiredToasts(c, 1000 + L - 1).length === 0);
  check('is expired at its deadline', show(expiredToasts(c, 1000 + L)) === '["a"]');
  check('is the next deadline', nextDeadline(c) === 1000 + L);

  const c2 = syncToasts(c, ['a', 'b'], 3000);
  check('a second toast gets its own 5s', c2.deadlines.b === 3000 + L, show(c2));
  check('the first keeps its deadline', c2.deadlines.a === 1000 + L, show(c2));
  check('the next deadline is the sooner one', nextDeadline(c2) === 1000 + L);
  check('only the first is expired at its deadline', show(expiredToasts(c2, 1000 + L)) === '["a"]');
  check('both are expired later', expiredToasts(c2, 3000 + L).length === 2);
}

console.log('\ntoastExpiry: a toast that arrives while the window is not focused\n');
{
  const c = syncToasts(initialToastClock(false), ['a'], 1000);
  check('waits (null deadline)', c.deadlines.a === null, show(c));
  check('never expires while unfocused', expiredToasts(c, 1000 + 60 * L).length === 0);
  check('no next deadline', nextDeadline(c) === null);

  const f = setMainFocus(c, true, 50_000);
  check('focus gives it 5s from that moment', f.deadlines.a === 50_000 + L, show(f));

  const b = setMainFocus(f, false, 52_000);
  check('losing focus before it goes pauses it again', b.deadlines.a === null, show(b));
  const f2 = setMainFocus(b, true, 70_000);
  check('focus again gives a fresh 5s', f2.deadlines.a === 70_000 + L, show(f2));
}

console.log('\ntoastExpiry: the pointer on a card\n');
{
  let c = syncToasts(initialToastClock(true), ['a', 'b'], 1000);
  c = setHoveredToast(c, 'a', 2000);
  check('pauses the card under it', c.deadlines.a === null, show(c));
  check('and every other card', c.deadlines.b === null, show(c));
  check('the clock is stopped', clockRuns(c) === false);
  check('nothing expires while hovered', expiredToasts(c, 1000 + 10 * L).length === 0);

  const moved = setHoveredToast(c, 'b', 2500);
  check('moving to another card keeps them paused', moved.deadlines.a === null && moved.deadlines.b === null, show(moved));

  const off = setHoveredToast(moved, null, 9000);
  check('pointer off: every toast gets a fresh 5s', off.deadlines.a === 9000 + L && off.deadlines.b === 9000 + L, show(off));

  const added = syncToasts(c, ['a', 'b', 'c'], 3000);
  check('a toast arriving while a card is hovered waits too', added.deadlines.c === null, show(added));
}
{
  // The hovered card is dismissed with its x (or clicked): the pointer is no
  // longer on a live card, so the others count down again.
  let c = syncToasts(initialToastClock(true), ['a', 'b'], 1000);
  c = setHoveredToast(c, 'a', 2000);
  const d = syncToasts(c, ['b'], 4000);
  check('the hovered card is dropped', !('a' in d.deadlines), show(d));
  check('the others start a fresh 5s', d.deadlines.b === 4000 + L, show(d));
  check('the clock runs again', clockRuns(d) === true);
}
{
  // Hover while unfocused changes nothing that matters: the clock stays stopped.
  let c = syncToasts(initialToastClock(false), ['a'], 1000);
  c = setHoveredToast(c, 'a', 2000);
  check('hover while unfocused keeps it waiting', c.deadlines.a === null, show(c));
  const f = setMainFocus(c, true, 3000);
  check('focus with the pointer still on the card keeps it waiting', f.deadlines.a === null, show(f));
  const off = setHoveredToast(f, null, 4000);
  check('then the pointer off starts its 5s', off.deadlines.a === 4000 + L, show(off));
}

console.log('\ntoastExpiry: changes that change nothing\n');
{
  const c = syncToasts(initialToastClock(true), ['a'], 1000);
  check('the same ids return the same object', syncToasts(c, ['a'], 2000) === c);
  check('the same focus returns the same object', setMainFocus(c, true, 2000) === c);
  check('the same hover returns the same object', setHoveredToast(c, null, 2000) === c);

  // A hover change that does not flip the clock (unfocused) keeps deadlines as they are.
  const u = syncToasts(initialToastClock(false), ['a'], 1000);
  const h = setHoveredToast(u, 'a', 2000);
  check('a hover that does not flip the clock keeps the deadlines', h.deadlines.a === null && h.hoveredId === 'a', show(h));

  // A hovered id that is not a live card, while focused and running: no restart.
  const r = setHoveredToast(syncToasts(initialToastClock(true), ['a'], 1000), 'nope', 3000);
  check('a hovered id that is not a live card does not pause', r.deadlines.a === 1000 + L, show(r));
}

console.log('\ntoastExpiry: a toast replaced by a newer one for the same thread\n');
{
  // The overlay replaces a thread's toast with the new push, which has a new id.
  const c = syncToasts(initialToastClock(true), ['t1'], 1000);
  const r = syncToasts(c, ['t2'], 4000);
  check('the old id is gone', !('t1' in r.deadlines), show(r));
  check('the new one gets a full 5s', r.deadlines.t2 === 4000 + L, show(r));
}

console.log('\ntoastExpiry: the last toast goes\n');
{
  const c: ToastClock = syncToasts(initialToastClock(true), ['a'], 1000);
  const e = syncToasts(c, [], 1000 + L);
  check('no deadlines left', Object.keys(e.deadlines).length === 0, show(e));
  check('no next deadline', nextDeadline(e) === null);
  check('focus is kept', e.focused === true);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);

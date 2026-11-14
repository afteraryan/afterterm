// Unit tests for tours.ts (when a one-time tour shows, what is remembered). Run on Node 24+:
//   node src/tours.test.ts

import { shouldShowTour, toursSeenFrom, withTourSeen } from './tours.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

console.log('toursSeenFrom');
check('no prefs: nothing seen', eq(toursSeenFrom(undefined), []));
check('empty prefs (a fresh install): nothing seen', eq(toursSeenFrom({}), []));
check('an update from a version without tours: nothing seen', eq(toursSeenFrom({ lastOpenedAt: 1 } as never), []));
check('loops seen', eq(toursSeenFrom({ toursSeen: ['loops'] }), ['loops']));
check('a string instead of a list: nothing seen', eq(toursSeenFrom({ toursSeen: 'loops' }), []));
check('unknown ids and wrong types are dropped', eq(toursSeenFrom({ toursSeen: [1, null, 'later-tour', 'loops'] }), ['loops']));
check('a repeated id is read once', eq(toursSeenFrom({ toursSeen: ['loops', 'loops'] }), ['loops']));

console.log('shouldShowTour');
check('shows when not seen', shouldShowTour([], 'loops'));
check('never after it was seen (Done or Skip)', !shouldShowTour(['loops'], 'loops'));
check('a later tour seen does not hide this one', shouldShowTour(['later-tour'], 'loops'));

console.log('withTourSeen');
check('adds the tour', eq(withTourSeen(undefined, 'loops'), ['loops']));
check('adds to a list', eq(withTourSeen([], 'loops'), ['loops']));
check('keeps a newer version\'s tour already in the file', eq(withTourSeen(['later-tour'], 'loops'), ['later-tour', 'loops']));
check('seen twice is written once', eq(withTourSeen(['loops'], 'loops'), ['loops']));
check('a broken value is replaced, not kept', eq(withTourSeen('loops', 'loops'), ['loops']));
check('non-strings are dropped', eq(withTourSeen([3, 'loops'], 'loops'), ['loops']));
check('round trip: after Done the tour does not show on the next launch',
  !shouldShowTour(toursSeenFrom({ toursSeen: withTourSeen(undefined, 'loops') }), 'loops'));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

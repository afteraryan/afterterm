// Unit tests for the streak calendar's arithmetic (design-07). Run directly on Node 24+:
//   node src/renderer/streakView.test.ts
// Exits 0 if all pass, 1 on any failure.

import { addDays, calendarWeeks, shade, streaks, weekday } from './streakView.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}

console.log('\nstreak: shades\n');
{
  const want: [number, number][] = [[0, 0], [-3, 0], [NaN, 0], [1, 1], [4, 1], [5, 2], [14, 2], [15, 3], [39, 3], [40, 4], [187, 4]];
  for (const [n, s] of want) check(`${n} messages is shade ${s}`, shade(n) === s, String(shade(n)));
}

console.log('\nstreak: days\n');
{
  check('addDays forward over a month end', addDays('2026-10-31', 1) === '2026-11-01');
  check('addDays back over a year end', addDays('2026-01-01', -1) === '2025-12-31');
  check('addDays over a leap day', addDays('2028-02-28', 1) === '2028-02-29');
  check('addDays over the end of daylight saving (Europe, 2026-10-25)', addDays('2026-10-24', 2) === '2026-10-26');
  check('2026-11-14 is a Saturday', weekday('2026-11-14') === 6);
  check('2026-11-08 is a Sunday', weekday('2026-11-08') === 0);
}

console.log('\nstreak: current and longest\n');
{
  const today = '2026-11-14';
  const run = (from: string, n: number, v = 3) => Object.fromEntries(Array.from({ length: n }, (_, i) => [addDays(from, i), v]));

  let s = streaks({}, today);
  check('no days: 0 and 0', s.current === 0 && s.longest === 0 && s.currentStart === null);

  s = streaks(run('2026-11-10', 5), today);
  check('five days up to today: current 5', s.current === 5 && s.currentStart === '2026-11-10', JSON.stringify(s));
  check('longest is at least current', s.longest === 5);

  s = streaks(run('2026-11-10', 4), today);
  check('today empty, a run to yesterday: current still 4', s.current === 4 && s.currentStart === '2026-11-10', JSON.stringify(s));

  s = streaks(run('2026-11-10', 3), today);
  check('today and yesterday empty: current 0', s.current === 0 && s.currentStart === null && s.longest === 3, JSON.stringify(s));

  s = streaks({ ...run('2026-10-01', 9), ...run('2026-11-13', 2) }, today);
  check('longest from an older run', s.longest === 9 && s.current === 2, JSON.stringify(s));

  s = streaks({ ...run('2026-11-10', 5), '2026-11-12': 0 }, today);
  check('a zero day breaks a run', s.current === 2 && s.longest === 2, JSON.stringify(s));

  s = streaks({ ...run('2026-12-24', 1), '2026-12-31': 5, '2027-01-01': 5, '2027-01-02': 5 }, '2027-01-02');
  check('a run across a year end', s.current === 3 && s.longest === 3, JSON.stringify(s));

  s = streaks({ ...run('2026-11-14', 4) }, today);
  check('days after today do not count', s.current === 1 && s.longest === 1, JSON.stringify(s));

  s = streaks({ junk: 5, '2026-11-14': 1 } as Record<string, number>, today);
  check('a key that is not a day is ignored', s.current === 1 && s.longest === 1);
}

console.log('\nstreak: the calendar weeks\n');
{
  const today = '2026-11-14'; // a Saturday
  let w = calendarWeeks(today);
  check('22 columns by default', w.length === 22);
  check('7 days a column', w.every((c) => c.length === 7));
  check('every column starts on a Sunday', w.every((c) => weekday(c[0].day) === 0));
  check('the last column holds today', w[21].some((d) => d.day === today));
  check('the last column is Sun 2026-11-08 to Sat 2026-11-14', w[21][0].day === '2026-11-08' && w[21][6].day === today);
  check('days follow each other with no gap', w.flat().every((d, i, a) => i === 0 || addDays(a[i - 1].day, 1) === d.day));
  check('nothing is in the future on a Saturday', w.flat().every((d) => !d.future));

  w = calendarWeeks('2026-11-11'); // a Wednesday
  check('a Wednesday: Thursday to Saturday are future', w[21].filter((d) => d.future).map((d) => d.day).join() === '2026-11-12,2026-11-13,2026-11-14');

  w = calendarWeeks(today, 22, 4);
  check('offset 4 moves four weeks back', w[21][0].day === '2026-10-11' && !w.flat().some((d) => d.future), w[21][0].day);
  check('a negative offset is the newest view', calendarWeeks(today, 22, -3)[21][6].day === today);
  check('a smaller count', calendarWeeks(today, 3).length === 3 && calendarWeeks(today, 3)[0][0].day === '2026-10-25');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

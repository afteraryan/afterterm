// Unit tests for homeView (date heading, relative time, Home's sections and
// fold, totals, search filter, live/asleep split). Run directly on Node 24+
// (strips types):
//   node src/renderer/homeView.test.ts
// Exits 0 if all pass, 1 on any failure.

import {
  dateHeading, relativeTime, homeSections, homeTotals, filterThreads, splitLiveAsleep,
  lastHereLine,
} from './homeView.ts';
import type { Tab, Group } from './components/TabBar/types.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}
const show = (v: unknown) => JSON.stringify(v);

// Fixture builders, same shape and casting style as threadView.test.ts.
function tab(id: string, extra: Partial<Tab> = {}): Tab {
  return { id, title: id, lastActiveAt: 0, asleep: false, ...extra } as Tab;
}
function group(id: string, extra: Partial<Group> = {}): Group {
  return {
    id, label: id, color: 'teal', collapsed: false,
    pinned: false, archived: false, lastActiveAt: 0, ...extra,
  } as Group;
}

console.log('\nhomeView: dateHeading\n');
{
  // en-GB's weekday+day+month CLDR pattern has no comma once year is dropped
  // (verified against this Node's Intl, which uses the same ICU as Chromium):
  // "Sunday 6 September", not "Sunday, 6 September".
  check('formats a fixed Sunday with no year',
    dateHeading(new Date(2026, 8, 6, 9, 15, 0).getTime()) === 'Sunday, 6 September',
    dateHeading(new Date(2026, 8, 6, 9, 15, 0).getTime()));
  check('a different weekday and month',
    dateHeading(new Date(2026, 0, 1, 0, 0, 0).getTime()) === 'Thursday, 1 January',
    dateHeading(new Date(2026, 0, 1, 0, 0, 0).getTime()));
  check('never includes a year',
    !dateHeading(new Date(2026, 8, 6).getTime()).includes('2026'));
}

console.log('\nhomeView: relativeTime\n');
{
  const now = new Date(2026, 8, 6, 12, 0, 0).getTime();
  check('the same instant is now', relativeTime(now, now) === 'now');
  check('59s is now', relativeTime(now - 59_000, now) === 'now');
  check('60s is 1m', relativeTime(now - 60_000, now) === '1m');
  check('5m is 5m', relativeTime(now - 5 * 60_000, now) === '5m');
  check('59m is 59m', relativeTime(now - 59 * 60_000, now) === '59m');
  check('1h (3600s) is 1h', relativeTime(now - 3_600_000, now) === '1h');
  check('23h is 23h', relativeTime(now - 23 * 3_600_000, now) === '23h');
  check('1d (24h) is 1d', relativeTime(now - 24 * 3_600_000, now) === '1d');
  check('6d is 6d', relativeTime(now - 6 * 86_400_000, now) === '6d');
  check('7d is 1w', relativeTime(now - 7 * 86_400_000, now) === '1w');
  check('29d is 4w', relativeTime(now - 29 * 86_400_000, now) === '4w');
  check('30d is 1mo', relativeTime(now - 30 * 86_400_000, now) === '1mo');
  check('364d is 12mo', relativeTime(now - 364 * 86_400_000, now) === '12mo');
  check('365d is 1y', relativeTime(now - 365 * 86_400_000, now) === '1y');
  check('two years', relativeTime(now - 730 * 86_400_000, now) === '2y');
}

console.log('\nhomeView: homeSections\n');
{
  const groups: Group[] = [
    group('p1', { pinned: true, lastActiveAt: 500 }),
    group('a1', { pinned: false, lastActiveAt: 300 }),
    group('a2', { pinned: false, lastActiveAt: 900 }),
    group('a3', { pinned: false, lastActiveAt: 300 }), // ties a1; a1 comes first in the array
    group('arch1', { archived: true, lastActiveAt: 100 }),
    group('arch2', { archived: true, pinned: true, lastActiveAt: 700 }),
  ];
  const sections = homeSections(groups, [], { showAll: false });

  check('pinned holds only the non-archived pinned project',
    sections.pinned.map(g => g.id).join(',') === 'p1', show(sections.pinned.map(g => g.id)));

  check('projects excludes pinned and archived, sorted by lastActiveAt desc',
    sections.projects.map(g => g.id).join(',') === 'a2,a1,a3', show(sections.projects.map(g => g.id)));

  check('ties in lastActiveAt keep the caller\'s array order (sidebar order)',
    sections.projects.findIndex(g => g.id === 'a1') < sections.projects.findIndex(g => g.id === 'a3'));

  check('archived projects (even a pinned one) end up only in archived, sorted by lastActiveAt desc',
    sections.archived.map(g => g.id).join(',') === 'arch2,arch1', show(sections.archived.map(g => g.id)));

  check('an archived project never appears in pinned or projects',
    !sections.pinned.some(g => g.id === 'arch2') && !sections.projects.some(g => g.id === 'arch2'));
}

console.log('\nhomeView: homeSections Show more fold\n');
{
  const many: Group[] = Array.from({ length: 6 }, (_, i) => group(`g${i}`, { lastActiveAt: i }));

  const collapsed = homeSections(many, [], { showAll: false });
  check('shownProjects is limited to 4 by default', collapsed.shownProjects.length === 4, show(collapsed.shownProjects.map(g => g.id)));
  check('hiddenCount is the remainder', collapsed.hiddenCount === 2);

  const expanded = homeSections(many, [], { showAll: true });
  check('showAll shows every project', expanded.shownProjects.length === 6);
  check('showAll: hiddenCount is 0', expanded.hiddenCount === 0);

  const customLimit = homeSections(many, [], { showAll: false, limit: 2 });
  check('a custom limit is respected', customLimit.shownProjects.length === 2);
  check('a custom limit: hiddenCount matches', customLimit.hiddenCount === 4);

  const few = homeSections(many.slice(0, 3), [], { showAll: false });
  check('fewer than the limit: nothing hidden', few.hiddenCount === 0 && few.shownProjects.length === 3);
}

console.log('\nhomeView: homeTotals\n');
{
  const groups: Group[] = [
    group('live1'),
    group('archivedProj', { archived: true }),
  ];
  const tabs: Tab[] = [
    tab('t1', { groupId: 'live1', notification: 'attention' }),
    tab('t2', { groupId: 'live1', notification: 'working' }),
    tab('t3', { notification: 'attention' }), // General: no groupId
    tab('t4', { notification: 'working' }), // General
    tab('t5', { groupId: 'archivedProj', notification: 'attention' }), // excluded
    tab('t6', { groupId: 'archivedProj', notification: 'working' }), // excluded
    tab('t7', { groupId: 'live1', notification: 'done' }), // neither bucket
  ];
  const totals = homeTotals(groups, tabs);
  check('needsYou counts non-archived project threads plus General, not archived',
    totals.needsYou === 2, show(totals));
  check('running counts working threads the same way',
    totals.running === 2, show(totals));

  const zero = homeTotals([], []);
  check('no tabs: both totals are zero', zero.needsYou === 0 && zero.running === 0);
}

console.log('\nhomeView: filterThreads\n');
{
  const tabs: Tab[] = [
    tab('a', { title: '✅ Fix the Sidebar Overlap' }),
    tab('b', { title: 'Reimagine Threads' }),
    tab('c', { title: 'vite' }),
  ];
  check('empty query returns every thread, unchanged order',
    filterThreads(tabs, '').map(t => t.id).join(',') === 'a,b,c');
  check('matches case-insensitively against the glyph-stripped title',
    filterThreads(tabs, 'sidebar').map(t => t.id).join(',') === 'a');
  check('matches from the start of the stripped title, past where the glyph was',
    filterThreads(tabs, 'fix the').map(t => t.id).join(',') === 'a');
  check('a query with no match returns nothing',
    filterThreads(tabs, 'xyz').length === 0);
  check('whitespace-only query behaves like empty',
    filterThreads(tabs, '   ').length === 3);
}

console.log('\nhomeView: splitLiveAsleep\n');
{
  const tabs: Tab[] = [
    tab('x', { asleep: false }),
    tab('y', { asleep: true }),
    tab('z', { asleep: false }),
  ];
  const split = splitLiveAsleep(tabs);
  check('live holds the awake tabs, in order', split.live.map(t => t.id).join(',') === 'x,z');
  check('asleep holds the sleeping tabs, in order', split.asleep.map(t => t.id).join(',') === 'y');
  check('an empty list splits into two empty lists',
    splitLiveAsleep([]).live.length === 0 && splitLiveAsleep([]).asleep.length === 0);
}

console.log('\nhomeView: lastHereLine\n');
{
  const now = new Date(2026, 8, 6, 12, 0, 0).getTime();
  check('null (first launch) shows nothing', lastHereLine(null, now) === null);
  check('59 minutes ago shows nothing (within the hour)', lastHereLine(now - 59 * 60_000, now) === null);
  check('exactly 1 hour ago shows nothing (boundary is exclusive)', lastHereLine(now - 60 * 60_000, now) === null);
  check('61 minutes ago shows the line', lastHereLine(now - 61 * 60_000, now) === 'Last here 1h ago',
    show(lastHereLine(now - 61 * 60_000, now)));
  check('2 days ago shows the line', lastHereLine(now - 2 * 86_400_000, now) === 'Last here 2d ago');
  check('a future timestamp shows nothing', lastHereLine(now + 60 * 60_000, now) === null);
  check('NaN shows nothing', lastHereLine(NaN, now) === null);
  check('Infinity shows nothing', lastHereLine(Infinity, now) === null);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);

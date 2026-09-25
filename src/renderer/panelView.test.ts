// Unit tests for panelView.ts (the sidebar panel's sections, search filter and
// keyboard cycle order, Phase 8). Run directly on Node 24+ (strips types):
//   node src/renderer/panelView.test.ts
// Exits 0 if all pass, 1 on any failure.

import { computeSegments } from './sidebarWalk.ts';
import { panelSections, filterPanel, visibleThreadIds, cycleThreadId, revealScrollTop } from './panelView.ts';
import type { PanelSections } from './panelView.ts';
import type { Tab, Group, TabNotification } from './components/TabBar/types.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}
const show = (v: unknown) => JSON.stringify(v);
const names = (tabs: Tab[]) => tabs.map(t => t.title);
const nameOf = (t: Tab) => t.title;

function tab(id: string, extra: Partial<Tab> = {}): Tab {
  return { id, title: id, groupId: undefined, lastActiveAt: 0, asleep: false, ...extra } as Tab;
}
function group(id: string, extra: Partial<Group> = {}): Group {
  return {
    id, label: id, color: 'teal', collapsed: false,
    pinned: false, archived: false, lastActiveAt: 0, history: [], ...extra,
  } as Group;
}

const NOW = 1_757_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

console.log('\npanelView: panelSections\n');
{
  const g1 = group('G1', { pinned: true, lastActiveAt: NOW });          // pinned
  const g2 = group('G2', { lastActiveAt: NOW - DAY });                  // recent (1 day old)
  const g3 = group('G3', { lastActiveAt: NOW - 30 * DAY });             // stale, no awake tab: other
  const g4 = group('G4', { archived: true, lastActiveAt: NOW });        // archived: nowhere
  const tabs = [
    tab('t0'),                                          // general
    tab('t1', { groupId: 'G1' }),
    tab('t2', { groupId: 'G2' }),
    tab('t3', { groupId: 'G3', asleep: true }),
    tab('t4', { groupId: 'G4' }),
  ];
  const segments = computeSegments(tabs, [g1, g2, g3, g4]);
  const sections = panelSections(segments, NOW);

  check('general holds the loose tab', sections.general.map(t => t.id).join(',') === 't0', show(sections.general));
  check('pinned holds G1 with its tab', sections.pinned.length === 1 && sections.pinned[0].group.id === 'G1'
    && sections.pinned[0].tabs.map(t => t.id).join(',') === 't1');
  check('recent holds G2', sections.recent.length === 1 && sections.recent[0].group.id === 'G2');
  check('other holds the stale G3', sections.other.length === 1 && sections.other[0].group.id === 'G3');
  check('archived G4 appears in no list', ![...sections.pinned, ...sections.recent, ...sections.other]
    .some(e => e.group.id === 'G4'));
  check('a pinned project never appears in recent or other',
    !sections.recent.some(e => e.group.id === 'G1') && !sections.other.some(e => e.group.id === 'G1'));
}
{
  // A group with zero tabs still gets an entry with an empty tabs array.
  const g = group('EMPTY', { lastActiveAt: NOW });
  const segments = computeSegments([], [g]);
  const sections = panelSections(segments, NOW);
  check('an empty project still appears with an empty tabs list',
    sections.recent.length === 1 && sections.recent[0].tabs.length === 0);
}
{
  // Pinned keeps dragged (walk) order, not activity order.
  const gA = group('A', { pinned: true, lastActiveAt: NOW - 5 * DAY });
  const gB = group('B', { pinned: true, lastActiveAt: NOW });
  const tabs = [tab('ta', { groupId: 'A' }), tab('tb', { groupId: 'B' })];
  const segments = computeSegments(tabs, [gA, gB]);
  const sections = panelSections(segments, NOW);
  check('pinned keeps walk order regardless of activity',
    sections.pinned.map(e => e.group.id).join(',') === 'A,B');
}
{
  // Recent is sorted by lastActiveAt descending, even though the walk order differs.
  const gA = group('A', { lastActiveAt: NOW - DAY });
  const gB = group('B', { lastActiveAt: NOW });
  const tabs = [tab('ta', { groupId: 'A' }), tab('tb', { groupId: 'B' })];
  const segments = computeSegments(tabs, [gA, gB]);
  const sections = panelSections(segments, NOW);
  check('recent sorts by lastActiveAt descending',
    sections.recent.map(e => e.group.id).join(',') === 'B,A', show(sections.recent.map(e => e.group.id)));
}

console.log('\npanelView: filterPanel\n');
{
  const g1 = group('afterterm', { label: 'afterterm', lastActiveAt: NOW });
  const g2 = group('aftertales', { label: 'aftertales', lastActiveAt: NOW - DAY });
  const tabs = [
    tab('t0', { title: 'General shell' }),
    tab('t1', { groupId: 'afterterm', title: 'Fix the spinner' }),
    tab('t2', { groupId: 'afterterm', title: 'npm start' }),
    tab('t3', { groupId: 'aftertales', title: 'cmd.exe' }),
  ];
  const segments = computeSegments(tabs, [g1, g2]);
  const sections = panelSections(segments, NOW);

  {
    const r = filterPanel(sections, '', nameOf);
    check('an empty query is unfiltered', r.filtered === false && r.noMatches === false);
    check('an empty query returns every section unchanged', r.general.length === 1 && r.recent.length === 2);
  }
  {
    const r = filterPanel(sections, '   ', nameOf);
    check('a whitespace-only query is treated as empty', r.filtered === false);
  }
  {
    // Project name match keeps every one of its threads.
    const r = filterPanel(sections, 'aftertales', nameOf);
    check('a project name match keeps all of its threads',
      r.recent.find(e => e.group.id === 'aftertales')?.tabs.length === 1);
    check('a non-matching project is dropped entirely',
      !r.recent.some(e => e.group.id === 'afterterm'));
  }
  {
    // Thread name match keeps only the matching threads under their project.
    const r = filterPanel(sections, 'spinner', nameOf);
    const entry = r.recent.find(e => e.group.id === 'afterterm');
    check('a thread name match keeps only the matching thread',
      !!entry && names(entry.tabs).join(',') === 'Fix the spinner', show(entry));
    check('the general list is empty when nothing there matches', r.general.length === 0);
  }
  {
    const r = filterPanel(sections, 'npm', nameOf);
    check('other is always empty while filtered', r.other.length === 0);
    check('filtered is true', r.filtered === true);
  }
  {
    const r = filterPanel(sections, 'nothing matches this', nameOf);
    check('noMatches is true when general, pinned and recent are all empty',
      r.noMatches === true && r.general.length === 0 && r.pinned.length === 0 && r.recent.length === 0);
  }
  {
    const r = filterPanel(sections, 'GENERAL', nameOf);
    check('the match is case-insensitive', r.general.length === 1);
  }
}

console.log('\npanelView: visibleThreadIds\n');
{
  const isWaitingByNotification = (t: Tab) => t.notification === 'attention' || !!t.unread;

  {
    // Basic order: general, then pinned, then recent, each in their own entry order.
    const g1 = group('P', { pinned: true, lastActiveAt: NOW });
    const g2 = group('R', { lastActiveAt: NOW });
    const tabs = [
      tab('g0'),
      tab('p0', { groupId: 'P' }), tab('p1', { groupId: 'P' }),
      tab('r0', { groupId: 'R' }),
    ];
    const segments = computeSegments(tabs, [g1, g2]);
    const sections = panelSections(segments, NOW);
    const ids = visibleThreadIds(sections, {
      activeTabId: '', expandedLists: {}, limit: 5, isWaiting: isWaitingByNotification,
    });
    check('order is general, then pinned, then recent',
      ids.join(',') === 'g0,p0,p1,r0', show(ids));
  }
  {
    // A collapsed project contributes nothing.
    const g1 = group('P', { pinned: true, collapsed: true, lastActiveAt: NOW });
    const tabs = [tab('p0', { groupId: 'P' })];
    const segments = computeSegments(tabs, [g1]);
    const sections = panelSections(segments, NOW);
    const ids = visibleThreadIds(sections, {
      activeTabId: '', expandedLists: {}, limit: 5, isWaiting: isWaitingByNotification,
    });
    check('a collapsed project contributes no rows', ids.length === 0);
  }
  {
    // The five-row fold hides rows past the limit, unless one is waiting.
    const many = Array.from({ length: 7 }, (_, i) => tab(`t${i}`, { groupId: 'R' }));
    const g = group('R', { lastActiveAt: NOW });
    const segments = computeSegments(many, [g]);
    const sections = panelSections(segments, NOW);
    const ids = visibleThreadIds(sections, {
      activeTabId: '', expandedLists: {}, limit: 5, isWaiting: isWaitingByNotification,
    });
    check('fold-hidden rows past the limit are not visible',
      ids.join(',') === 't0,t1,t2,t3,t4', show(ids));
  }
  {
    // A waiting thread hidden past the fold forces that project's fold open.
    const many = Array.from({ length: 7 }, (_, i) =>
      tab(`t${i}`, { groupId: 'R', notification: (i === 6 ? 'attention' : undefined) as TabNotification | undefined }));
    const g = group('R', { lastActiveAt: NOW });
    const segments = computeSegments(many, [g]);
    const sections = panelSections(segments, NOW);
    const ids = visibleThreadIds(sections, {
      activeTabId: '', expandedLists: {}, limit: 5, isWaiting: isWaitingByNotification,
    });
    check('a waiting thread past the fold keeps the whole project visible',
      ids.length === 7 && ids.includes('t6'), show(ids));
  }
  {
    // Other never contributes rows, even with tabs sitting behind it.
    const g = group('O', { lastActiveAt: NOW - 30 * DAY });
    const tabs = [tab('o0', { groupId: 'O', asleep: true })];
    const segments = computeSegments(tabs, [g]);
    const sections = panelSections(segments, NOW);
    const ids = visibleThreadIds(sections, {
      activeTabId: '', expandedLists: {}, limit: 5, isWaiting: isWaitingByNotification,
    });
    check('other contributes no rows to the cycle', ids.length === 0, show({ sections, ids }));
  }
  {
    // Crossing from the last thread of one project into the first of the next.
    const g1 = group('P1', { pinned: true, lastActiveAt: NOW });
    const g2 = group('P2', { pinned: true, lastActiveAt: NOW });
    const tabs = [tab('a0', { groupId: 'P1' }), tab('a1', { groupId: 'P1' }), tab('b0', { groupId: 'P2' })];
    const segments = computeSegments(tabs, [g1, g2]);
    const sections = panelSections(segments, NOW);
    const ids = visibleThreadIds(sections, {
      activeTabId: '', expandedLists: {}, limit: 5, isWaiting: isWaitingByNotification,
    });
    check('crossing project boundaries keeps a single flat order', ids.join(',') === 'a0,a1,b0');
  }
}

console.log('\npanelView: cycleThreadId\n');
{
  const ids = ['a', 'b', 'c'];
  check('dir 1 moves to the next id', cycleThreadId(ids, 'a', 1) === 'b');
  check('dir -1 moves to the previous id', cycleThreadId(ids, 'b', -1) === 'a');
  check('dir 1 wraps from the last to the first', cycleThreadId(ids, 'c', 1) === 'a');
  check('dir -1 wraps from the first to the last', cycleThreadId(ids, 'a', -1) === 'c');
  check('an id not in the list starts at the first for dir 1', cycleThreadId(ids, 'zzz', 1) === 'a');
  check('an id not in the list starts at the last for dir -1', cycleThreadId(ids, 'zzz', -1) === 'c');
  check('an empty list returns null', cycleThreadId([], 'a', 1) === null);
  check('a single-element list wraps to itself', cycleThreadId(['a'], 'a', 1) === 'a');
}

console.log('\npanelView: revealScrollTop\n');
{
  // A 500px view scrolled to 1000, so rows 1000..1500 are in view.
  check('a region already in view does not move', revealScrollTop(1000, 500, 1100, 1300) === null);
  check('a region below the view moves just far enough to show its bottom',
    revealScrollTop(1000, 500, 1600, 1700) === 1700 + 8 - 500);
  check('a region above the view moves to its top', revealScrollTop(1000, 500, 200, 300) === 192);
  check('a region cut at the top of the view moves to its top', revealScrollTop(1000, 500, 1004, 1200) === 996);
  check('a region taller than the view aligns to its top',
    revealScrollTop(1000, 500, 1400, 2200) === 1392);
  check('never scrolls above 0', revealScrollTop(300, 500, 2, 40) === 0);
  check('a stop close to the start snaps to 0 so the first heading shows',
    revealScrollTop(1081, 546, 26, 76) === 0);
  check('no snap when the region would not fit from 0',
    revealScrollTop(1081, 100, 30, 120) === 22);
  check('the margin counts: a row flush with the bottom edge still moves',
    revealScrollTop(1000, 500, 1450, 1500) === 1508 - 500);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);

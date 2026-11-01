// Unit tests for attention.ts (the one aggregate every count in the app reads
// from). Run directly on Node 24+ (strips types):
//   node src/renderer/attention.test.ts
// Exits 0 if all pass, 1 on any failure.

import {
  countStates, countTabs, projectAttention, totalAttention, railProjects,
  panelLists, isRecentProject, enteringRecent, moveGroupsToTop, firstThreadToOpen, lastWorkedThread, RECENT_WINDOW_MS, isWaitingState,
} from './attention.ts';
import type { AttentionCounts } from './attention.ts';
import type { ThreadState } from './threadView.ts';
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
const zero: AttentionCounts = { waiting: 0, working: 0, running: 0, finished: 0, compacting: 0, background: 0 };

console.log('\nattention: countStates\n');
{
  check('needs-you counts as waiting', countStates(['needs-you']).waiting === 1);
  check('unread counts as waiting', countStates(['unread']).waiting === 1);
  check('needs-you and unread together both count as waiting',
    countStates(['needs-you', 'unread']).waiting === 2);
  check('working counts as working, not running',
    countStates(['working']).working === 1 && countStates(['working']).running === 0);
  check('running counts as running, not working',
    countStates(['running']).running === 1 && countStates(['running']).working === 0);
  check('done counts as finished', countStates(['done']).finished === 1);
  check('compacting counts as its own bucket, not working (Phase 8)',
    countStates(['compacting']).compacting === 1 && countStates(['compacting']).working === 0);
  check('background counts only in its own bucket, not working (the rail leaves it out)',
    isDeepStrictEqualCounts(countStates(['background']), { ...zero, background: 1 }));
  check('asleep counts as nothing', isDeepStrictEqualCounts(countStates(['asleep']), zero));
  check('quiet counts as nothing', isDeepStrictEqualCounts(countStates(['quiet']), zero));
  check('empty list is all zero', isDeepStrictEqualCounts(countStates([]), zero));

  const mixed: ThreadState[] = ['needs-you', 'unread', 'working', 'working', 'running', 'done', 'done', 'quiet', 'asleep', 'compacting'];
  const c = countStates(mixed);
  check('a mixed list tallies each bucket correctly',
    c.waiting === 2 && c.working === 2 && c.running === 1 && c.finished === 2 && c.compacting === 1, show(c));

  check('isWaitingState is true for needs-you', isWaitingState('needs-you'));
  check('isWaitingState is true for unread', isWaitingState('unread'));
  check('isWaitingState is false for every other state',
    (['working', 'running', 'done', 'quiet', 'asleep', 'compacting', 'background'] as ThreadState[])
      .every(s => !isWaitingState(s)));
}

function isDeepStrictEqualCounts(a: AttentionCounts, b: AttentionCounts): boolean {
  return a.waiting === b.waiting && a.working === b.working && a.running === b.running
    && a.finished === b.finished && a.compacting === b.compacting && a.background === b.background;
}

console.log('\nattention: countTabs\n');
{
  const tabs = [
    tab('t1', { notification: 'attention' }),
    tab('t2', { unread: true }),
    tab('t3', { notification: 'working' }),
    tab('t4', { port: 5173 }),
    tab('t5', { notification: 'done' }),
  ];
  const c = countTabs(tabs);
  check('countTabs maps every tab through threadState before counting',
    c.waiting === 2 && c.working === 1 && c.running === 1 && c.finished === 1, show(c));
  check('an asleep unread tab counts as waiting even though it has no process',
    countTabs([tab('t', { asleep: true, unread: true })]).waiting === 1);
  check('empty tabs is all zero', isDeepStrictEqualCounts(countTabs([]), zero));
}

console.log('\nattention: projectAttention\n');
{
  const tabs = [
    tab('t1', { groupId: 'A', notification: 'attention' }),
    tab('t2', { groupId: 'A', notification: 'working' }),
    tab('t3', { groupId: 'B', notification: 'done' }),
    tab('t4' /* general, no groupId */),
  ];
  const groups = [group('A'), group('B'), group('C'), group('D', { archived: true })];
  const map = projectAttention(groups, tabs);

  check('map has an entry per non-archived group', map.size === 3, show([...map.keys()]));
  check('archived group D has no entry', !map.has('D'));
  check('group A counts its own two tabs', map.get('A')!.waiting === 1 && map.get('A')!.working === 1, show(map.get('A')));
  check('group B counts its one finished tab', map.get('B')!.finished === 1, show(map.get('B')));
  check('a project with zero tabs gets a present all-zero entry, not omitted',
    map.has('C') && isDeepStrictEqualCounts(map.get('C')!, zero));
  check('a general (no groupId) tab is not attributed to any project',
    map.get('A')!.waiting === 1 && map.get('B')!.waiting === 0);
}

console.log('\nattention: totalAttention\n');
{
  const tabs = [
    tab('t1', { groupId: 'A', notification: 'attention' }),
    tab('t2', { groupId: 'Z', notification: 'attention' }), // Z is archived below
    tab('t3' /* general */, { notification: 'attention' }),
    tab('t4', { groupId: 'ghost', notification: 'attention' }), // groupId names no group: counts as General
  ];
  const groups = [group('A'), group('Z', { archived: true })];
  const total = totalAttention(groups, tabs);
  check('a needs-you thread in an archived project is not in the total',
    total.waiting === 3, show(total));
  check('a groupId naming no group is treated as General and counted',
    totalAttention(groups, [tab('x', { groupId: 'ghost', notification: 'attention' })]).waiting === 1);
  check('no tabs is all zero', isDeepStrictEqualCounts(totalAttention([], []), zero));
}

console.log('\nattention: railProjects\n');
{
  const tabs = [
    tab('t1', { groupId: 'A', notification: 'attention' }), // A: waiting
    tab('t2', { groupId: 'B', notification: 'done' }),      // B: finished
    tab('t3', { groupId: 'C', notification: 'working' }),   // C: working only, on the rail (2026-09-29)
    tab('t4', { groupId: 'D', notification: 'attention' }), // D archived: excluded regardless
    tab('t5', { groupId: 'F', notification: 'compacting' }), // F: compacting only, on the rail (Phase 8)
    tab('t6', { groupId: 'G', notification: 'background' }), // G: background only, not on the rail
    tab('t7', { groupId: 'H', port: 5173 }),                 // H: a server only, not on the rail
    tab('t8', { groupId: 'I', notification: 'working' }),   // I archived: excluded regardless
  ];
  const groups = [group('C'), group('A'), group('B'), group('D', { archived: true }), group('E'), group('F'),
    group('G'), group('H'), group('I', { archived: true })];
  const rail = railProjects(groups, tabs);
  check('only projects with something waiting, finished, working or compacting are on the rail',
    rail.map(g => g.id).join(',') === 'C,A,B,F', show(rail.map(g => g.id)));
  check('an archived project with a needs-you thread never appears on the rail',
    !rail.some(g => g.id === 'D'));
  check('a project with only a working thread is on the rail (Aryan 2026-09-29: its tile shows the working count)',
    rail.some(g => g.id === 'C'));
  check('an archived project with a working thread never appears on the rail',
    !rail.some(g => g.id === 'I'));
  check('a project with only background tasks is not on the rail',
    !rail.some(g => g.id === 'G'));
  check('a project with only a running server is not on the rail',
    !rail.some(g => g.id === 'H'));
  check('a project with nothing pending is not on the rail',
    !rail.some(g => g.id === 'E'));
  check('a project with only a compacting thread is on the rail (Phase 8, Aryan 2026-09-19)',
    rail.some(g => g.id === 'F'));
  check('caller order is kept among the ones shown (not resorted)',
    railProjects([group('B'), group('A')], tabs).map(g => g.id).join(',') === 'B,A');
}

console.log('\nattention: panelLists\n');
{
  const NOW = 1_757_000_000_000;
  const DAY = 24 * 60 * 60 * 1000;

  check('RECENT_WINDOW_MS is exactly 3 days', RECENT_WINDOW_MS === 3 * DAY);

  {
    // Exactly 3 days old, no awake tab: still recent (inclusive boundary).
    const g = group('A', { lastActiveAt: NOW - RECENT_WINDOW_MS });
    const { recent, other } = panelLists([g], [tab('t', { groupId: 'A', asleep: true })], NOW);
    check('exactly 3 days old is recent', recent.map(x => x.id).join(',') === 'A', show(recent));
    check('exactly 3 days old is not in other', other.length === 0);
  }
  {
    // One ms past 3 days, no awake tab: no longer recent.
    const g = group('A', { lastActiveAt: NOW - RECENT_WINDOW_MS - 1 });
    const { recent, other } = panelLists([g], [tab('t', { groupId: 'A', asleep: true })], NOW);
    check('one ms past 3 days with no awake tab falls to other', other.map(x => x.id).join(',') === 'A', show(other));
    check('one ms past 3 days is not in recent', recent.length === 0);
  }
  {
    // Long past the window, but an awake tab keeps it recent.
    const g = group('A', { lastActiveAt: NOW - 30 * DAY });
    const { recent, other } = panelLists([g], [tab('t', { groupId: 'A', asleep: false })], NOW);
    check('an awake tab keeps a project recent past the window', recent.map(x => x.id).join(',') === 'A');
    check('and it is not also in other', other.length === 0);
  }
  {
    // A project with no tabs at all, old activity: goes to other.
    const g = group('A', { lastActiveAt: NOW - 30 * DAY });
    const { recent, other } = panelLists([g], [], NOW);
    check('a stale project with no tabs is in other', other.map(x => x.id).join(',') === 'A');
  }
  {
    // Pinned is excluded from both lists; archived goes to Other (2026-11-01).
    const pinned = group('P', { pinned: true, lastActiveAt: NOW });
    const archived = group('X', { archived: true, lastActiveAt: NOW });
    const { recent, other } = panelLists([pinned, archived], [tab('x', { groupId: 'X' })], NOW);
    check('a pinned project is in neither list', !recent.some(g => g.id === 'P') && !other.some(g => g.id === 'P'));
    check('an archived project is in Other, even with fresh activity and an awake thread',
      other.map(g => g.id).join(',') === 'X' && !recent.some(g => g.id === 'X'), show({ recent, other }));
  }
  {
    // Nothing moves because it was used: Recent keeps the saved order, whatever the activity.
    const a = group('A', { lastActiveAt: NOW - 1 * DAY });
    const b = group('B', { lastActiveAt: NOW - 2 * DAY });
    const c = group('C', { lastActiveAt: NOW }); // the one used last
    const { recent } = panelLists([a, b, c], [], NOW);
    check('recent keeps the saved order, not activity order', recent.map(g => g.id).join(',') === 'A,B,C', show(recent.map(g => g.id)));
    const used = panelLists([a, { ...b, lastActiveAt: NOW + 5 }, c], [], NOW + 10).recent;
    check('using a project in Recent does not move it', used.map(g => g.id).join(',') === 'A,B,C', show(used.map(g => g.id)));
  }
  {
    // Archive's hold: a quiet project whose last thread just went to sleep stays in Recent until it folds.
    const g = group('A', { lastActiveAt: NOW - 30 * DAY });
    const asleep = [tab('t', { groupId: 'A', asleep: true })];
    check('without the hold it is in Other', panelLists([g], asleep, NOW).other.map(x => x.id).join(',') === 'A');
    check('held, it stays in Recent', panelLists([g], asleep, NOW, new Set(['A'])).recent.map(x => x.id).join(',') === 'A');
    check('once archived the hold no longer keeps it',
      panelLists([{ ...g, archived: true }], asleep, NOW, new Set(['A'])).other.map(x => x.id).join(',') === 'A');
  }
  {
    // Other keeps caller order, not resorted.
    const a = group('A', { lastActiveAt: NOW - 30 * DAY });
    const b = group('B', { lastActiveAt: NOW - 60 * DAY });
    const { other } = panelLists([b, a], [], NOW);
    check('other keeps caller order', other.map(g => g.id).join(',') === 'B,A');
  }
}

console.log('\nattention: isRecentProject, enteringRecent, moveGroupsToTop (the order rules)\n');
{
  const NOW = 1_757_000_000_000;
  const DAY = 24 * 60 * 60 * 1000;
  const old = (id: string, extra: Partial<Group> = {}) => group(id, { lastActiveAt: NOW - 30 * DAY, ...extra });

  check('a project used today is recent', isRecentProject(group('A', { lastActiveAt: NOW }), [], NOW));
  check('an old project with an awake thread is recent', isRecentProject(old('A'), [tab('t', { groupId: 'A' })], NOW));
  check('an old project with only asleep threads is not', !isRecentProject(old('A'), [tab('t', { groupId: 'A', asleep: true })], NOW));
  check('a pinned project is not in Recent', !isRecentProject(group('A', { pinned: true, lastActiveAt: NOW }), [], NOW));
  check('an archived project is not in Recent', !isRecentProject(group('A', { archived: true, lastActiveAt: NOW }), [], NOW));

  {
    // Opening a stale project from Home or the drawer stamps its activity: it enters.
    const before = { groups: [group('R', { lastActiveAt: NOW }), old('O')], tabs: [] };
    const after = { groups: [group('R', { lastActiveAt: NOW }), old('O', { lastActiveAt: NOW })], tabs: [] };
    check('a project stamped back into the window is entering', enteringRecent(before, after, NOW).join(',') === 'O');
  }
  {
    // Waking a thread in a stale project brings it in.
    const groups = [old('O')];
    const before = { groups, tabs: [tab('t', { groupId: 'O', asleep: true })] };
    const after = { groups, tabs: [tab('t', { groupId: 'O', asleep: false })] };
    check('waking a thread in an Other project is entering', enteringRecent(before, after, NOW).join(',') === 'O');
  }
  {
    // A project already in Recent that is used (activity, wake, notification) is not entering.
    const before = { groups: [group('A', { lastActiveAt: NOW - DAY })], tabs: [tab('t', { groupId: 'A', asleep: true })] };
    const after = { groups: [group('A', { lastActiveAt: NOW })], tabs: [tab('t', { groupId: 'A', asleep: false, notification: 'done' })] };
    check('using a project already in Recent is not entering', enteringRecent(before, after, NOW).length === 0);
  }
  {
    // Restoring an archived project with fresh activity: it enters.
    const before = { groups: [group('X', { archived: true, lastActiveAt: NOW })], tabs: [] };
    const after = { groups: [group('X', { lastActiveAt: NOW })], tabs: [] };
    check('an archived project coming back is entering', enteringRecent(before, after, NOW).join(',') === 'X');
  }
  {
    // Moving from Pinned to Recent is a placement of its own, not an entry.
    const before = { groups: [group('P', { pinned: true, lastActiveAt: NOW })], tabs: [] };
    const after = { groups: [group('P', { lastActiveAt: NOW })], tabs: [] };
    check('unpinning is not entering', enteringRecent(before, after, NOW).length === 0);
  }
  {
    // A project created just now (not in before at all) enters at the top.
    const before = { groups: [group('A', { lastActiveAt: NOW })], tabs: [] };
    const after = { groups: [group('A', { lastActiveAt: NOW }), group('NEW', { lastActiveAt: NOW })], tabs: [] };
    check('a new project is entering', enteringRecent(before, after, NOW).join(',') === 'NEW');
  }
  {
    // Both sides at the same now: a project that went quiet while the app was idle counts as out before.
    const g = group('A', { lastActiveAt: NOW - 4 * DAY });
    const before = { groups: [g], tabs: [] };
    const after = { groups: [{ ...g, lastActiveAt: NOW }], tabs: [] };
    check('a project that aged out and comes back enters again', enteringRecent(before, after, NOW).join(',') === 'A');
  }

  const ids = (gs: Group[]) => gs.map(g => g.id).join(',');
  const gs = [group('P', { pinned: true }), group('A'), group('B'), group('C'), group('Q', { pinned: true })];
  check('moveGroupsToTop puts one project first', ids(moveGroupsToTop(gs, ['C'])) === 'C,P,A,B,Q');
  check('several keep their own order', ids(moveGroupsToTop(gs, ['C', 'A'])) === 'A,C,P,B,Q');
  check('the pinned order is untouched', ids(moveGroupsToTop(gs, ['C']).filter(g => g.pinned)) === 'P,Q');
  check('no ids returns the same array', moveGroupsToTop(gs, []) === gs);
  check('already at the top returns the same array', moveGroupsToTop(gs, ['P']) === gs);
  {
    // End to end: the rows below an entering project each shift down one and keep their order.
    const groups = [group('A', { lastActiveAt: NOW }), group('B', { lastActiveAt: NOW }), old('O')];
    const after = groups.map(g => g.id === 'O' ? { ...g, lastActiveAt: NOW } : g);
    const entering = enteringRecent({ groups, tabs: [] }, { groups: after, tabs: [] }, NOW);
    const recent = panelLists(moveGroupsToTop(after, entering), [], NOW).recent;
    check('the entering project is at the top of Recent and the rest keep their order', ids(recent) === 'O,A,B', ids(recent));
  }
}

console.log('\nattention: lastWorkedThread\n');
{
  check('null for a project with no threads', lastWorkedThread([]) === null);
  const tabs = [
    tab('t1', { lastActiveAt: 100 }),
    tab('t2', { lastActiveAt: 300, asleep: true }),
    tab('t3', { lastActiveAt: 200 }),
  ];
  check('the highest lastActiveAt wins, asleep or not', lastWorkedThread(tabs)?.id === 't2');
  check('a tie goes to the earlier thread in tab order',
    lastWorkedThread([tab('a', { lastActiveAt: 5 }), tab('b', { lastActiveAt: 5 })])?.id === 'a');
  check('a waiting thread does not jump the queue (that is the rail tile rule, not this one)',
    lastWorkedThread([tab('old', { notification: 'attention', lastActiveAt: 1 }), tab('new', { lastActiveAt: 9 })])?.id === 'new');
}

console.log('\nattention: firstThreadToOpen\n');
{
  check('null for an empty list', firstThreadToOpen([]) === null);

  {
    const tabs = [
      tab('t1', { lastActiveAt: 100 }),
      tab('t2', { notification: 'attention', lastActiveAt: 50 }),
      tab('t3', { unread: true, lastActiveAt: 10 }),
      tab('t4', { notification: 'done', lastActiveAt: 200 }),
    ];
    check('the first thread waiting for you wins, even when it is not the most recently active',
      firstThreadToOpen(tabs)!.id === 't2');
  }
  {
    // unread also counts as "waiting for you", and caller order (not recency) picks among them.
    const tabs = [
      tab('t1', { unread: true, lastActiveAt: 5 }),
      tab('t2', { notification: 'attention', lastActiveAt: 999 }),
    ];
    check('the first waiting thread in list order wins, unread included', firstThreadToOpen(tabs)!.id === 't1');
  }
  {
    // No thread waiting: falls to the first finished one.
    const tabs = [
      tab('t1', { lastActiveAt: 100 }),
      tab('t2', { notification: 'done', lastActiveAt: 10 }),
      tab('t3', { notification: 'done', lastActiveAt: 500 }),
    ];
    check('falls back to the first finished thread in list order',
      firstThreadToOpen(tabs)!.id === 't2');
  }
  {
    // Nothing waiting, nothing finished: the most recently active awake thread.
    const tabs = [
      tab('t1', { lastActiveAt: 100 }),
      tab('t2', { lastActiveAt: 500 }),
      tab('t3', { lastActiveAt: 200, asleep: true }), // asleep: skipped even though most recent
    ];
    check('falls back to the most recently active awake thread',
      firstThreadToOpen(tabs)!.id === 't2');
  }
  {
    // Every thread asleep, nothing waiting or finished: null.
    const tabs = [tab('t1', { asleep: true, lastActiveAt: 100 }), tab('t2', { asleep: true, lastActiveAt: 200 })];
    check('null when every thread is asleep with nothing pending', firstThreadToOpen(tabs) === null);
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);

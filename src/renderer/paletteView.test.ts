// Unit tests for paletteView (paletteResults, rankMatch). Run directly on
// Node 24+ (strips types):
//   node src/renderer/paletteView.test.ts
// Exits 0 if all pass, 1 on any failure.

import { paletteResults, rankMatch } from './paletteView.ts';
import type { Group, Tab, HistoryEntry } from './components/TabBar/types.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}
const show = (v: unknown) => JSON.stringify(v);

function group(id: string, extra: Partial<Group> = {}): Group {
  return {
    id, label: id, color: 'teal', collapsed: false,
    pinned: false, archived: false, lastActiveAt: 0, history: [], ...extra,
  } as Group;
}
function tab(id: string, extra: Partial<Tab> = {}): Tab {
  return { id, title: id, lastActiveAt: 0, asleep: false, ...extra } as Tab;
}
function historyEntry(id: string, extra: Partial<HistoryEntry> = {}): HistoryEntry {
  return { id, title: id, kind: 'shell', closedAt: 0, ...extra };
}

console.log('\npaletteView: rankMatch\n');
{
  check('prefix match ranks 0', rankMatch('afterterm', 'after') === 0);
  check('non-prefix substring match ranks 1', rankMatch('go afterterm', 'after') === 1);
  check('no match still gets a rank (caller is responsible for filtering)',
    typeof rankMatch('afterterm', 'zzz') === 'number');
  check('case-insensitive prefix match', rankMatch('AfterTerm', 'after') === 0);
  check('empty query ranks everything 0', rankMatch('anything', '') === 0);
}

console.log('\npaletteView: paletteResults, empty query\n');
{
  const groups = [
    group('A', { label: 'afterterm', lastActiveAt: 100 }),
    group('B', { label: 'aftertales', lastActiveAt: 300 }),
    group('C', { label: 'archived', archived: true, lastActiveAt: 500 }),
  ];
  const tabs = [
    tab('t1', { groupId: 'A', lastActiveAt: 50 }),
    tab('t2', { groupId: 'B', lastActiveAt: 400 }),
    tab('t3', { lastActiveAt: 200 }), // General
  ];
  const r = paletteResults(groups, tabs, '');
  check('lists all non-archived projects', r.projects.map(g => g.id).join(',') === 'B,A', show(r.projects.map(g => g.id)));
  check('lists all threads, including General, ordered by lastActiveAt desc',
    r.threads.map(t => t.tab.id).join(',') === 't2,t3,t1', show(r.threads.map(t => t.tab.id)));
}

console.log('\npaletteView: paletteResults, substring match\n');
{
  const groups = [group('A', { label: 'afterterm' }), group('B', { label: 'other' })];
  const tabs = [
    tab('t1', { title: '✅ afterterm - done', groupId: 'A' }),
    tab('t2', { title: 'unrelated thing', groupId: 'B' }),
  ];
  const r = paletteResults(groups, tabs, 'afterterm');
  check('substring match on group label', r.projects.map(g => g.id).join(',') === 'A', show(r.projects));
  check('substring match on displayTitle with the hook glyph stripped',
    r.threads.map(t => t.tab.id).join(',') === 't1', show(r.threads.map(t => t.tab.id)));
}

console.log('\npaletteView: paletteResults, prefix ranks above substring\n');
{
  const groups = [
    group('A', { label: 'go afterterm', lastActiveAt: 999 }),
    group('B', { label: 'afterterm', lastActiveAt: 1 }),
  ];
  const r = paletteResults(groups, [], 'after');
  check('prefix match (B) ranks above substring match (A) despite lower lastActiveAt',
    r.projects.map(g => g.id).join(',') === 'B,A', show(r.projects.map(g => g.id)));

  const tabs = [
    tab('t1', { title: 'go afterterm', lastActiveAt: 999 }),
    tab('t2', { title: 'afterterm', lastActiveAt: 1 }),
  ];
  const rt = paletteResults([], tabs, 'after');
  check('prefix match (t2) ranks above substring match (t1) among threads',
    rt.threads.map(t => t.tab.id).join(',') === 't2,t1', show(rt.threads.map(t => t.tab.id)));
}

console.log('\npaletteView: paletteResults, archived projects excluded\n');
{
  const groups = [group('A', { archived: true, label: 'afterterm' })];
  const tabs = [tab('t1', { groupId: 'A', title: 'afterterm thread' })];
  const r = paletteResults(groups, tabs, '');
  check('archived project excluded', r.projects.length === 0, show(r.projects));
  check('threads of an archived project excluded', r.threads.length === 0, show(r.threads));
}

console.log('\npaletteView: paletteResults, each thread carries its group\n');
{
  const groups = [group('A', { label: 'afterterm' })];
  const tabs = [tab('t1', { groupId: 'A' }), tab('t2')];
  const r = paletteResults(groups, tabs, '');
  const t1 = r.threads.find(t => t.tab.id === 't1');
  const t2 = r.threads.find(t => t.tab.id === 't2');
  check('a thread with a project carries that group', t1?.group?.id === 'A', show(t1));
  check('a General thread carries no group', t2?.group === undefined, show(t2));
}

console.log('\npaletteView: paletteResults, threadName fallback\n');
{
  // A chat with no Claude title yet is searched by its threadName (the first
  // prompt fallback), not its live shell title.
  const tabs = [
    tab('t1', { title: 'cmd.exe', claudeSessionId: 's1', firstPrompt: 'Refactor the login flow' }),
  ];
  const byPrompt = paletteResults([], tabs, 'login');
  check('matches a word of the first prompt', byPrompt.threads.map(t => t.tab.id).join(',') === 't1', show(byPrompt.threads));

  const byShellTitle = paletteResults([], tabs, 'cmd');
  check('does not match the live shell title once a first prompt stands in for it',
    byShellTitle.threads.length === 0, show(byShellTitle.threads));
}

console.log('\npaletteView: paletteResults, no results\n');
{
  const r = paletteResults([group('A', { label: 'afterterm' })], [tab('t1', { title: 'afterterm' })], 'zzzzz');
  check('no results gives an empty projects array', r.projects.length === 0, show(r.projects));
  check('no results gives an empty threads array', r.threads.length === 0, show(r.threads));
  check('no results gives an empty history array', r.history.length === 0, show(r.history));
}

console.log('\npaletteView: paletteResults, history\n');
{
  const groups = [
    group('A', { label: 'afterterm', history: [
      historyEntry('h1', { title: 'Fix the spinner', closedAt: 100 }),
      historyEntry('h2', { title: 'unrelated shell', closedAt: 200 }),
    ] }),
  ];
  const r = paletteResults(groups, [], 'spinner');
  check('a query matching a history title returns it', r.history.map(h => h.entry.id).join(',') === 'h1', show(r.history));
  check('the returned history row carries its owning group', r.history[0]?.group.id === 'A', show(r.history));
  check('existing project and thread results are unchanged by the new field',
    r.projects.length === 0 && r.threads.length === 0);
}
{
  // Archived projects' history is excluded, same as their projects and threads.
  const groups = [group('A', { archived: true, label: 'afterterm', history: [historyEntry('h1', { title: 'afterterm thread' })] })];
  const r = paletteResults(groups, [], '');
  check('archived project history excluded', r.history.length === 0, show(r.history));
}
{
  // Ranked by prefix match first, then newest closedAt.
  const groups = [
    group('A', { label: 'A', history: [
      historyEntry('h1', { title: 'go afterterm', closedAt: 999 }),
      historyEntry('h2', { title: 'afterterm', closedAt: 1 }),
    ] }),
  ];
  const r = paletteResults(groups, [], 'after');
  check('prefix match (h2) ranks above substring match (h1) despite an older closedAt',
    r.history.map(h => h.entry.id).join(',') === 'h2,h1', show(r.history.map(h => h.entry.id)));
}
{
  const groups = [
    group('A', { label: 'A', history: [
      historyEntry('h1', { title: 'thread', closedAt: 300 }),
      historyEntry('h2', { title: 'thread', closedAt: 100 }),
      historyEntry('h3', { title: 'thread', closedAt: 200 }),
    ] }),
  ];
  const r = paletteResults(groups, [], 'thread');
  check('same rank, ordered by closedAt descending', r.history.map(h => h.entry.id).join(',') === 'h1,h3,h2', show(r.history));
}
{
  // Cap at 8 across all projects combined.
  const entries = Array.from({ length: 12 }, (_, i) => historyEntry(`h${i}`, { title: 'closed thread', closedAt: i }));
  const groups = [group('A', { label: 'A', history: entries })];
  const r = paletteResults(groups, [], 'closed');
  check('history results capped at 8', r.history.length === 8, show(r.history.length));
  check('the 8 kept are the newest by closedAt', r.history.map(h => h.entry.id).join(',') === 'h11,h10,h9,h8,h7,h6,h5,h4', show(r.history.map(h => h.entry.id)));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);

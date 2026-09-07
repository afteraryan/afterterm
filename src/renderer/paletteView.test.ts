// Unit tests for paletteView (paletteResults, rankMatch). Run directly on
// Node 24+ (strips types):
//   node src/renderer/paletteView.test.ts
// Exits 0 if all pass, 1 on any failure.

import { paletteResults, rankMatch } from './paletteView.ts';
import type { Group, Tab } from './components/TabBar/types.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}
const show = (v: unknown) => JSON.stringify(v);

function group(id: string, extra: Partial<Group> = {}): Group {
  return {
    id, label: id, color: 'teal', collapsed: false,
    pinned: false, archived: false, lastActiveAt: 0, ...extra,
  } as Group;
}
function tab(id: string, extra: Partial<Tab> = {}): Tab {
  return { id, title: id, lastActiveAt: 0, asleep: false, ...extra } as Tab;
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

console.log('\npaletteView: paletteResults, no results\n');
{
  const r = paletteResults([group('A', { label: 'afterterm' })], [tab('t1', { title: 'afterterm' })], 'zzzzz');
  check('no results gives an empty projects array', r.projects.length === 0, show(r.projects));
  check('no results gives an empty threads array', r.threads.length === 0, show(r.threads));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);

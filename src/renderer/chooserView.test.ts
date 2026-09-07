// Unit tests for chooserView (chooserItems, defaultShell). Run directly on
// Node 24+ (strips types):
//   node src/renderer/chooserView.test.ts
// Exits 0 if all pass, 1 on any failure.

import { chooserItems, defaultShell } from './chooserView.ts';
import type { Group } from './components/TabBar/types.ts';

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

const ids = (items: ReturnType<typeof chooserItems>) => items.map(it => it.group?.id ?? 'none').join(',');
const tags = (items: ReturnType<typeof chooserItems>) => items.map(it => it.tag || '-').join(',');

console.log('\nchooserView: chooserItems, current project\n');
{
  const groups = [group('A', { label: 'afterterm' }), group('B', { label: 'aftertales' })];
  const r = chooserItems(groups, 'A', '');
  check('current project is first', r[0].group?.id === 'A', show(r));
  check('current project is tagged current', r[0].tag === 'current');

  const noMatch = chooserItems(groups, 'A', 'zzz');
  check('current project dropped when the query does not match it',
    !noMatch.some(it => it.group?.id === 'A' && it.tag === 'current'), show(noMatch));

  const matches = chooserItems(groups, 'A', 'after');
  check('current project kept when the query matches it (substring of both)',
    matches[0].group?.id === 'A' && matches[0].tag === 'current', show(matches));

  const noCurrent = chooserItems(groups, undefined, '');
  check('no current project: nothing tagged current', !noCurrent.some(it => it.tag === 'current'), show(noCurrent));
}

console.log('\nchooserView: chooserItems, No project\n');
{
  const groups = [group('A')];
  check('No project present on empty query', chooserItems(groups, undefined, '').some(it => it.group === null));
  check('No project present when query matches "no"', chooserItems(groups, undefined, 'no').some(it => it.group === null));
  check('No project present when query matches "general"', chooserItems(groups, undefined, 'general').some(it => it.group === null));
  check('No project present when query matches "no project"', chooserItems(groups, undefined, 'no project').some(it => it.group === null));
  check('No project absent when the query matches nothing about it',
    !chooserItems(groups, undefined, 'zzz').some(it => it.group === null));
}

console.log('\nchooserView: chooserItems, ordering of other projects\n');
{
  const groups = [
    group('A', { pinned: false, lastActiveAt: 300 }),
    group('B', { pinned: true, lastActiveAt: 100 }),
    group('C', { pinned: true, lastActiveAt: 200 }),
    group('D', { pinned: false, lastActiveAt: 400 }),
  ];
  const r = chooserItems(groups, undefined, '');
  const others = r.filter(it => it.group !== null).map(it => it.group!.id);
  check('pinned first (by lastActiveAt desc within pinned), then unpinned (by lastActiveAt desc)',
    others.join(',') === 'C,B,D,A', show(others));
}

console.log('\nchooserView: chooserItems, archived excluded\n');
{
  const groups = [group('A'), group('B', { archived: true })];
  const r = chooserItems(groups, undefined, '');
  check('archived project excluded', !r.some(it => it.group?.id === 'B'), show(r));
}

console.log('\nchooserView: chooserItems, case-insensitive substring\n');
{
  const groups = [group('A', { label: 'AfterTerm' })];
  check('matches regardless of case', chooserItems(groups, undefined, 'AFTER').some(it => it.group?.id === 'A'));
  check('matches a lowercase substring of a mixed-case label',
    chooserItems(groups, undefined, 'term').some(it => it.group?.id === 'A'));
}

console.log('\nchooserView: chooserItems, current project not repeated\n');
{
  const groups = [group('A', { label: 'afterterm' })];
  const r = chooserItems(groups, 'A', '');
  const count = r.filter(it => it.group?.id === 'A').length;
  check('current project appears exactly once', count === 1, show(r));
}

console.log('\nchooserView: defaultShell\n');
{
  const groups = [group('A', { shellId: 'pwsh' }), group('B')];
  check('returns the project shellId', defaultShell(groups, 'A') === 'pwsh');
  check('returns undefined when the project has no shellId', defaultShell(groups, 'B') === undefined);
  check('returns undefined when there is no current project', defaultShell(groups, undefined) === undefined);
  check('returns undefined when the current id does not match any group', defaultShell(groups, 'zzz') === undefined);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);

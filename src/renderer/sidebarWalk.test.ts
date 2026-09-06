// Unit tests for the sidebar walk (groups first, then their tabs). Run directly on
// Node 24+ (strips types):
//   node src/renderer/sidebarWalk.test.ts
// Exits 0 if all pass, 1 on any failure.

import { computeSegments } from './sidebarWalk.ts';
import type { Segment } from './sidebarWalk.ts';
import type { Tab, Group } from './components/TabBar/types.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}

// Fixture builders. The literals carry the Phase 0 fields (lastActiveAt, asleep,
// pinned, archived) so these tests type-check once those land in types.ts; the cast
// keeps them compiling before that too.
function tab(id: string, groupId?: string): Tab {
  return { id, title: id, groupId, lastActiveAt: 0, asleep: false } as Tab;
}
function group(id: string): Group {
  return {
    id, label: id, color: 'teal', collapsed: false,
    pinned: false, archived: false, lastActiveAt: 0,
  } as Group;
}

// Compact string form of a segment list, for readable equality checks:
// "t1 | A[t2,t3] | B[]"
function shape(segments: Segment[]): string {
  return segments.map(s =>
    s.type === 'tab' ? s.tab.id : `${s.group.id}[${s.tabs.map(t => t.id).join(',')}]`
  ).join(' | ');
}

console.log('\nsidebarWalk: computeSegments\n');

// Only ungrouped tabs
{
  const segs = computeSegments([tab('t1'), tab('t2'), tab('t3')], []);
  check('only ungrouped tabs: one tab segment per tab in order', shape(segs) === 't1 | t2 | t3', shape(segs));
  check('only ungrouped tabs: no group segments', segs.every(s => s.type === 'tab'));
}

// Nothing at all
{
  check('no tabs and no groups: empty list', computeSegments([], []).length === 0);
}

// One group with tabs
{
  const segs = computeSegments([tab('t1', 'A'), tab('t2', 'A')], [group('A')]);
  check('one group with tabs: a single group segment holding both tabs', shape(segs) === 'A[t1,t2]', shape(segs));
}

// A group with zero tabs renders as a segment with empty tabs
{
  const segs = computeSegments([tab('t1')], [group('A')]);
  check('zero-tab group: still produces a group segment', segs.some(s => s.type === 'group' && s.group.id === 'A'));
  const a = segs.find(s => s.type === 'group' && s.group.id === 'A');
  check('zero-tab group: its tabs list is empty', a?.type === 'group' && a.tabs.length === 0);
  check('zero-tab group: comes after the ungrouped tab', shape(segs) === 't1 | A[]', shape(segs));
}

// Zero-tab groups come after everything else, in `groups` order
{
  const segs = computeSegments(
    [tab('t1', 'B'), tab('t2')],
    [group('C'), group('B'), group('A')],
  );
  check('zero-tab groups: appended after every tab and live group, in groups order',
    shape(segs) === 'B[t1] | t2 | C[] | A[]', shape(segs));
}

// Order of first appearance preserved for groups with tabs and interleaved ungrouped tabs
{
  const segs = computeSegments(
    [tab('t1'), tab('t2', 'A'), tab('t3', 'A'), tab('t4'), tab('t5', 'B'), tab('t6')],
    [group('B'), group('A')], // groups array order differs from tab order on purpose
  );
  check('interleaved: visible order follows the tabs, not the groups array',
    shape(segs) === 't1 | A[t2,t3] | t4 | B[t5] | t6', shape(segs));
}

// A non-contiguous group collapses to one segment at its first appearance
{
  const segs = computeSegments(
    [tab('t1', 'A'), tab('t2'), tab('t3', 'A'), tab('t4', 'B'), tab('t5', 'A')],
    [group('A'), group('B')],
  );
  check('non-contiguous group: exactly one segment for the group',
    segs.filter(s => s.type === 'group' && s.group.id === 'A').length === 1);
  check('non-contiguous group: emitted at its first appearance with all its tabs in tabs order',
    shape(segs) === 'A[t1,t3,t5] | t2 | B[t4]', shape(segs));
}

// A tab whose groupId matches no group renders as an ungrouped tab
{
  const segs = computeSegments([tab('t1', 'ghost'), tab('t2')], [group('A')]);
  check('orphan groupId: rendered as a plain tab segment', segs[0]?.type === 'tab' && segs[0].tab.id === 't1');
  check('orphan groupId: no group segment invented for the unknown id',
    !segs.some(s => s.type === 'group' && s.group.id === 'ghost'));
  check('orphan groupId: full shape', shape(segs) === 't1 | t2 | A[]', shape(segs));
}

// No tabs and two groups yields two group segments
{
  const segs = computeSegments([], [group('A'), group('B')]);
  check('no tabs, two groups: two group segments in groups order', shape(segs) === 'A[] | B[]', shape(segs));
  check('no tabs, two groups: every segment is a group with empty tabs',
    segs.every(s => s.type === 'group' && s.tabs.length === 0));
}

// Every group appears exactly once, whatever the mix
{
  const groups = [group('A'), group('B'), group('C'), group('D')];
  const tabs = [
    tab('t1', 'C'), tab('t2'), tab('t3', 'A'), tab('t4', 'C'), tab('t5', 'A'), tab('t6', 'nope'), tab('t7', 'B'),
  ];
  const segs = computeSegments(tabs, groups);
  const counts = new Map<string, number>();
  for (const s of segs) if (s.type === 'group') counts.set(s.group.id, (counts.get(s.group.id) ?? 0) + 1);
  check('mixed: every group appears exactly once',
    groups.every(g => counts.get(g.id) === 1) && counts.size === groups.length,
    JSON.stringify([...counts]));
  check('mixed: every tab appears exactly once across all segments',
    segs.flatMap(s => s.type === 'tab' ? [s.tab.id] : s.tabs.map(t => t.id)).sort().join() ===
    tabs.map(t => t.id).sort().join());
  check('mixed: full shape', shape(segs) === 'C[t1,t4] | t2 | A[t3,t5] | t6 | B[t7] | D[]', shape(segs));
}

// The segment carries the same Group and Tab objects it was given (no copies), so
// React keys and identity-based lookups keep working.
{
  const g = group('A');
  const t = tab('t1', 'A');
  const segs = computeSegments([t], [g]);
  check('identity: group segment holds the original group object', segs[0]?.type === 'group' && segs[0].group === g);
  check('identity: group segment holds the original tab object', segs[0]?.type === 'group' && segs[0].tabs[0] === t);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);

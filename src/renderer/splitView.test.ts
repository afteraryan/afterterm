// Unit tests for splitView.ts (two threads side by side, design-06). Run
// directly on Node 24+ (strips types):
//   node src/renderer/splitView.test.ts
// Exits 0 if all pass, 1 on any failure.

import {
  createSplit, dissolveSplitOf, setSplitRatio, activeAfterClose, placeThreadKeepingSplits,
  paneDropTarget, panesFor, partnerOf, restoreSplits, foldLimit, clampRatio, maxSplitNumber,
  REFUSE_SAME_PROJECT, REFUSE_TWO_AT_MOST, SPLIT_DEFAULT,
} from './splitView.ts';
import type { Split } from './splitView.ts';
import { panelSections, visibleThreadIds, cycleThreadId } from './panelView.ts';
import type { Tab, Group } from './components/TabBar/types.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}
const show = (v: unknown) => JSON.stringify(v);
const ids = (tabs: { id: string }[]) => tabs.map(t => t.id).join(',');

function tab(id: string, groupId?: string): Tab {
  const t = { id, title: id, lastActiveAt: 0, asleep: false } as Tab;
  if (groupId) t.groupId = groupId;
  return t;
}
function group(id: string, extra: Partial<Group> = {}): Group {
  return { id, label: id, color: 'teal', collapsed: false, pinned: true, archived: false, lastActiveAt: 0, history: [], ...extra } as Group;
}
const split = (a: string, b: string, id = 's1', ratio = 0.5): Split => ({ id, a, b, ratio });

const G = [group('p'), group('q')];
const NOW = 1_757_000_000_000;

console.log('\ncreateSplit');
{
  // p: 1 2 3 4, General: g1
  const tabs = [tab('1', 'p'), tab('2', 'p'), tab('3', 'p'), tab('4', 'p'), tab('g1')];
  const r = createSplit(tabs, [], '1', '4', 'b', 's1');
  check('dropped on the right half: dragged thread is b', show(r.splits) === show([split('1', '4')]));
  check('dragged row moves just after the other', ids(r.tabs) === '1,4,2,3,g1', ids(r.tabs));
  const l = createSplit(tabs, [], '3', '1', 'a', 's1');
  check('dropped on the left half: dragged thread is a', l.splits[0].a === '1' && l.splits[0].b === '3');
  check('dragged row moves just before the other', ids(l.tabs) === '2,1,3,4,g1', ids(l.tabs));
  check('new split starts at half and half', r.splits[0].ratio === SPLIT_DEFAULT);
  check('a thread with itself makes nothing', createSplit(tabs, [], '1', '1', 'a', 's1').splits.length === 0);
  check('an unknown thread makes nothing', createSplit(tabs, [], '1', 'zz', 'a', 's1').splits.length === 0);

  // Dragging a thread that is already in a split into a new one ends the old one.
  const s = [split('1', '2', 's1')];
  const t2 = [tab('1', 'p'), tab('2', 'p'), tab('3', 'p')];
  const moved = createSplit(t2, s, '3', '2', 'a', 's2');
  check('old split of the dragged thread ends', !moved.splits.some(x => x.id === 's1'));
  check('new split holds the two', show(moved.splits) === show([split('2', '3', 's2')]));
  check('rows reordered for the new split', ids(moved.tabs) === '1,2,3', ids(moved.tabs));
}

console.log('\npanes on screen');
{
  const s = [split('2', '3')];
  check('active in a split: both halves, left to right', show(panesFor(s, '3')) === show(['2', '3']));
  check('active not in a split: alone', show(panesFor(s, '1')) === show(['1']));
  check('nothing active: nothing', show(panesFor(s, '')) === show([]));
  check('partner of a', partnerOf(s, '2') === '3');
  check('partner of b', partnerOf(s, '3') === '2');
  check('no partner', partnerOf(s, '1') === undefined);
}

console.log('\nrefused drops');
{
  const tabs = [tab('1', 'p'), tab('2', 'p'), tab('3', 'q'), tab('g1'), tab('g2'), tab('x', 'gone')];
  check('same project: allowed, on the half under the pointer',
    show(paneDropTarget(tabs, G, [], '1', '2', 'b')) === show({ kind: 'half', side: 'b' }));
  check('other project: Same project only',
    paneDropTarget(tabs, G, [], '1', '3', 'a')?.bad === REFUSE_SAME_PROJECT);
  check('General onto a project thread: Same project only',
    paneDropTarget(tabs, G, [], '1', 'g1', 'a')?.bad === REFUSE_SAME_PROJECT);
  check('General onto General: allowed',
    paneDropTarget(tabs, G, [], 'g1', 'g2', 'a')?.bad === undefined);
  check('a thread of a deleted project counts as General',
    paneDropTarget(tabs, G, [], 'g1', 'x', 'a')?.bad === undefined);
  const s = [split('1', '2')];
  check('a split on screen: Two at most over the whole pane',
    show(paneDropTarget(tabs, G, s, '1', 'g1', 'a')) === show({ kind: 'whole', bad: REFUSE_TWO_AT_MOST }));
  check('a split on screen refuses even a same-project thread',
    paneDropTarget([...tabs, tab('5', 'p')], G, s, '2', '5', 'b')?.bad === REFUSE_TWO_AT_MOST);
  check('dragging a half of the split on screen: no target', paneDropTarget(tabs, G, s, '1', '2', 'a') === null);
  check('dragging the thread on screen onto itself: no target', paneDropTarget(tabs, G, [], '1', '1', 'a') === null);
  check('nothing on screen: no target', paneDropTarget(tabs, G, [], '', '1', 'a') === null);
  // A thread in some other split, dropped on a lone thread: allowed (its old split ends).
  check('a thread from another split onto a lone thread: allowed',
    paneDropTarget([...tabs, tab('5', 'p')], G, s, '5', '1', 'a')?.bad === undefined);
}

console.log('\nending a split');
{
  const s = [split('2', '3', 's1'), split('5', '6', 's2')];
  check('Ungroup ends only that split', show(dissolveSplitOf(s, '3')) === show([split('5', '6', 's2')]));
  check('a thread in no split: same array back', dissolveSplitOf(s, '1') === s);

  const tabs = [tab('1'), tab('2'), tab('3'), tab('4')];
  check('closing the focused half leaves the other half on screen',
    activeAfterClose(tabs, [split('2', '3')], '2', '2') === '3');
  check('closing the focused right half leaves the left on screen',
    activeAfterClose(tabs, [split('2', '3')], '3', '3') === '2');
  check('closing the other half keeps the focused one',
    activeAfterClose(tabs, [split('2', '3')], '2', '3') === '2');
  check('closing a lone active thread: the next in the list',
    activeAfterClose(tabs, [], '2', '2') === '3');
  check('closing the last thread in the list: the one before',
    activeAfterClose(tabs, [], '4', '4') === '3');
  check('closing the only thread: nothing', activeAfterClose([tab('1')], [], '1', '1') === '');
}

console.log('\nmoving threads in the panel');
{
  const tabs = [tab('1', 'p'), tab('2', 'p'), tab('3', 'p'), tab('4', 'p'), tab('5', 'q')];
  const s = [split('2', '3')];

  const away = placeThreadKeepingSplits(tabs, s, '3', 'q', null);
  check('a split thread moved to another project ends its split', away.splits.length === 0);
  check('...and lands in that project', away.tabs.find(t => t.id === '3')?.groupId === 'q');
  const general = placeThreadKeepingSplits(tabs, s, '2', undefined, null);
  check('a split thread moved to General ends its split', general.splits.length === 0);

  const down = placeThreadKeepingSplits(tabs, s, '2', 'p', null);
  check('the left half moved to the end takes its partner along', ids(down.tabs) === '1,4,2,3,5', ids(down.tabs));
  check('...and the split stays', down.splits === s);
  const up = placeThreadKeepingSplits(tabs, s, '3', 'p', '1');
  check('the right half moved to the top takes its partner along, order kept', ids(up.tabs) === '2,3,1,4,5', ids(up.tabs));
  const self = placeThreadKeepingSplits(tabs, s, '3', 'p', '2');
  check('the right half dropped above its partner stays put', ids(self.tabs) === ids(tabs), ids(self.tabs));

  const between = placeThreadKeepingSplits(tabs, s, '4', 'p', '3');
  check('another thread dropped between a split lands below it', ids(between.tabs) === '1,2,3,4,5', ids(between.tabs));
  const between1 = placeThreadKeepingSplits(tabs, s, '1', 'p', '3');
  check('...from above as well', ids(between1.tabs) === '2,3,1,4,5', ids(between1.tabs));
  const fromOther = placeThreadKeepingSplits(tabs, s, '5', 'p', '3');
  check('...and from another project', ids(fromOther.tabs) === '1,2,3,5,4' && fromOther.tabs[3].groupId === 'p', ids(fromOther.tabs));

  // Found in review: the two split branches did not check where they landed.
  const two = [tab('A', 'p'), tab('B', 'p'), tab('E', 'q'), tab('F', 'q')];
  const twoSplits = [split('A', 'B', 's1'), split('E', 'F', 's2')];
  const outBetween = placeThreadKeepingSplits(two, twoSplits, 'A', 'q', 'F');
  check('a split thread moved to another project between that project\'s pair lands below the pair',
    ids(outBetween.tabs) === 'B,E,F,A', ids(outBetween.tabs));
  check('...its own split ends, the other stays', show(outBetween.splits) === show([split('E', 'F', 's2')]));
  const four = [tab('A', 'p'), tab('B', 'p'), tab('C', 'p'), tab('D', 'p')];
  const fourSplits = [split('A', 'B', 's1'), split('C', 'D', 's2')];
  const pairBetween = placeThreadKeepingSplits(four, fourSplits, 'A', 'p', 'D');
  check('a pair dropped between another pair lands below it, both pairs whole',
    ids(pairBetween.tabs) === 'C,D,A,B', ids(pairBetween.tabs));
}

console.log('\nthe divider');
{
  const s = [split('1', '2')];
  check('ratio set', setSplitRatio(s, 's1', 0.3)[0].ratio === 0.3);
  check('ratio clamped to a quarter', setSplitRatio(s, 's1', 0.05)[0].ratio === 0.25);
  check('ratio clamped to three quarters', setSplitRatio(s, 's1', 0.95)[0].ratio === 0.75);
  check('unchanged ratio: same array', setSplitRatio(s, 's1', 0.5) === s);
  check('not a number: half', clampRatio('x') === 0.5 && clampRatio(NaN) === 0.5);
}

console.log('\nthe cycle order (Aryan\'s 1, 2+3, 4)');
{
  // Threads 1 to 4 in one project, 2 and 3 a split, made by dragging 3 onto
  // the right half of 2 from the bottom of the list.
  const start = [tab('1', 'p'), tab('2', 'p'), tab('4', 'p'), tab('3', 'p')];
  const made = createSplit(start, [], '2', '3', 'b', 's1');
  check('the split puts 3 right after 2', ids(made.tabs) === '1,2,3,4', ids(made.tabs));
  const sections = panelSections(made.tabs, [group('p')], NOW);
  const order = visibleThreadIds(sections, { activeTabId: '1', expandedLists: {}, limit: 5, isWaiting: () => false, splits: made.splits });
  check('panel order passes through both halves', order.join(',') === '1,2,3,4', order.join(','));
  const walk: string[] = [];
  let cur = '1';
  for (let i = 0; i < 4; i++) { cur = cycleThreadId(order, cur, 1)!; walk.push(cur); }
  check('Down from 1: 2, 3, 4, then back to 1', walk.join(',') === '2,3,4,1', walk.join(','));
  const screens = walk.map(id => panesFor(made.splits, id).join('+'));
  check('what Down shows: the split with 2 focused, still the split with 3, then 4 alone',
    screens.join(' ') === '2+3 2+3 4 1', screens.join(' '));
  const back: string[] = [];
  cur = '4';
  for (let i = 0; i < 3; i++) { cur = cycleThreadId(order, cur, -1)!; back.push(cur); }
  check('Up from 4: 3, 2, 1', back.join(',') === '3,2,1', back.join(','));
  // Ctrl+Tab walks the tab list itself, where the halves are next to each other too.
  const i2 = made.tabs.findIndex(t => t.id === '2');
  check('session order has the halves together', made.tabs[i2 + 1].id === '3');
}

console.log('\nthe fold never cuts a split');
{
  const t = ['1', '2', '3', '4', '5', '6', '7'].map(id => tab(id, 'p'));
  check('a split across the fold line: one more row shows', foldLimit(t, 5, [split('5', '6')]) === 6);
  check('a split inside the fold: the limit stays', foldLimit(t, 5, [split('3', '4')]) === 5);
  check('a split starting just past the fold: the limit stays', foldLimit(t, 5, [split('6', '7')]) === 5);
  check('fewer rows than the limit: the limit stays', foldLimit(t.slice(0, 3), 5, [split('1', '2')]) === 5);
  const sections = panelSections(t, [group('p')], NOW);
  const order = visibleThreadIds(sections, { activeTabId: '1', expandedLists: {}, limit: 5, isWaiting: () => false, splits: [split('5', '6')] });
  check('the cycle sees the sixth row too', order.join(',') === '1,2,3,4,5,6', order.join(','));
}

console.log('\nrestoring splits from session.json');
{
  const tabs = [tab('1', 'p'), tab('2', 'p'), tab('3', 'p'), tab('4', 'q'), tab('g1'), tab('g2')];
  const ok = restoreSplits([{ id: 's1', a: '1', b: '2', ratio: 0.4 }], tabs, G);
  check('a good split comes back with its sides and ratio', show(ok.splits) === show([split('1', '2', 's1', 0.4)]));
  check('...and the tabs are unchanged', ok.tabs === tabs);
  check('a thread that is gone: dropped', restoreSplits([{ id: 's1', a: '1', b: 'zz', ratio: 0.5 }], tabs, G).splits.length === 0);
  check('two projects: dropped', restoreSplits([{ id: 's1', a: '1', b: '4', ratio: 0.5 }], tabs, G).splits.length === 0);
  check('a project thread and a General one: dropped', restoreSplits([{ id: 's1', a: '1', b: 'g1', ratio: 0.5 }], tabs, G).splits.length === 0);
  check('two General threads: kept', restoreSplits([{ id: 's1', a: 'g1', b: 'g2', ratio: 0.5 }], tabs, G).splits.length === 1);
  check('a thread with itself: dropped', restoreSplits([{ id: 's1', a: '1', b: '1', ratio: 0.5 }], tabs, G).splits.length === 0);
  check('a thread in two splits: only the first kept',
    restoreSplits([{ id: 's1', a: '1', b: '2' }, { id: 's2', a: '2', b: '3' }], tabs, G).splits.map(s => s.id).join() === 's1');
  check('a missing ratio is half', restoreSplits([{ id: 's1', a: '1', b: '2' }], tabs, G).splits[0].ratio === 0.5);
  check('a ratio out of range is clamped', restoreSplits([{ id: 's1', a: '1', b: '2', ratio: 9 }], tabs, G).splits[0].ratio === 0.75);
  check('no id: dropped', restoreSplits([{ a: '1', b: '2' }], tabs, G).splits.length === 0);
  check('not a list: none', restoreSplits('nope', tabs, G).splits.length === 0);
  check('junk entries skipped', restoreSplits([null, 3, 'x', [], { id: 's1', a: '1', b: '2' }], tabs, G).splits.length === 1);
  const apart = restoreSplits([{ id: 's1', a: '3', b: '1', ratio: 0.5 }], tabs, G);
  check('halves that are apart are put next to each other, a then b', ids(apart.tabs) === '2,3,1,4,g1,g2', ids(apart.tabs));
  check('split ids are counted', maxSplitNumber([split('1', '2', 'split-4'), split('3', '5', 'split-11'), split('6', '7', 'x')]) === 11);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

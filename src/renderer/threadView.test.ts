// Unit tests for threadView (kind, state, labels, fold, counts, sections, toast
// wording). Run directly on Node 24+ (strips types):
//   node src/renderer/threadView.test.ts
// Exits 0 if all pass, 1 on any failure.

import {
  threadKind, threadState, stateLabel, stateBreathes, displayTitle,
  foldThreads, projectCounts, sidebarSections, toastMessage,
} from './threadView.ts';
import type { ThreadState } from './threadView.ts';
import { computeSegments } from './sidebarWalk.ts';
import type { Tab, Group, TabNotification } from './components/TabBar/types.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}
const show = (v: unknown) => JSON.stringify(v);

// Fixture builders, same shape and casting style as sidebarWalk.test.ts.
function tab(id: string, extra: Partial<Tab> = {}): Tab {
  return { id, title: id, lastActiveAt: 0, asleep: false, ...extra } as Tab;
}
function group(id: string, extra: Partial<Group> = {}): Group {
  return {
    id, label: id, color: 'teal', collapsed: false,
    pinned: false, archived: false, lastActiveAt: 0, ...extra,
  } as Group;
}

console.log('\nthreadView: threadKind\n');
{
  check('a tab with a claude session id is a chat',
    threadKind({ claudeSessionId: '3d71b0f2-26cb-4ad3-8371-6504ab2e37e2' }) === 'chat');
  check('a tab with no claude session id is a shell', threadKind({}) === 'shell');
  check('an empty-string session id is a shell, not a chat', threadKind({ claudeSessionId: '' }) === 'shell');
}

console.log('\nthreadView: threadState\n');
{
  check('asleep wins over a pending notification',
    threadState({ asleep: true, notification: 'attention' }) === 'asleep');
  check('asleep with no notification is still asleep', threadState({ asleep: true }) === 'asleep');
  check('attention maps to needs-you', threadState({ asleep: false, notification: 'attention' }) === 'needs-you');
  check('working maps to working', threadState({ asleep: false, notification: 'working' }) === 'working');
  check('done maps to done', threadState({ asleep: false, notification: 'done' }) === 'done');
  check('compacting maps to compacting', threadState({ asleep: false, notification: 'compacting' }) === 'compacting');
  check('background maps to background', threadState({ asleep: false, notification: 'background' }) === 'background');
  check('no notification maps to quiet', threadState({ asleep: false }) === 'quiet');
}

console.log('\nthreadView: stateLabel\n');
{
  check('needs-you label', stateLabel('needs-you') === 'Needs you');
  check('working label', stateLabel('working') === 'Working');
  check('running label', stateLabel('running') === 'Running');
  check('done label', stateLabel('done') === 'Done');
  check('asleep label', stateLabel('asleep') === 'Asleep');
  check('compacting label', stateLabel('compacting') === 'Compacting');
  check('background label', stateLabel('background') === 'Background tasks');
  check('quiet label is empty (chip hidden)', stateLabel('quiet') === '');
}

console.log('\nthreadView: stateBreathes\n');
{
  const all: ThreadState[] = ['needs-you', 'working', 'running', 'done', 'quiet', 'asleep', 'compacting', 'background'];
  check('needs-you breathes', stateBreathes('needs-you') === true);
  check('done breathes', stateBreathes('done') === true);
  check('exactly needs-you and done breathe, nothing else',
    all.filter(stateBreathes).sort().join(',') === ['done', 'needs-you'].sort().join(','),
    show(all.filter(stateBreathes)));
}

console.log('\nthreadView: displayTitle\n');
{
  check('strips done glyph', displayTitle('\u2705 project - done') === 'project - done');
  check('strips attention glyph', displayTitle('\u26A0 project - needs permission') === 'project - needs permission');
  check('strips background glyph', displayTitle('\u23F3 project - bg (2 running)') === 'project - bg (2 running)');
  check('strips compacting glyph', displayTitle('\u2699 project - compacting') === 'project - compacting');
  check('strips working glyph', displayTitle('\u25B6 project - working') === 'project - working');
  check('strips the restorable marker glyph', displayTitle('\u2733 Fix the spinner') === 'Fix the spinner');
  check('strips a braille spinner glyph', displayTitle('\u2820 Loading') === 'Loading');
  check('a plain path is untouched', displayTitle('C:\\') === 'C:\\');
  check('a title with no glyph is untouched', displayTitle('Terminal') === 'Terminal');
  check('empty title falls back to Terminal', displayTitle('') === 'Terminal');
  check('a glyph with nothing after it falls back to Terminal', displayTitle('\u25B6') === 'Terminal');
}

console.log('\nthreadView: foldThreads\n');
{
  const t = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `t${i}` }));

  {
    const threads = t(3);
    const r = foldThreads(threads, 't1', false);
    check('fewer than limit: nothing hidden', r.shown.length === 3 && r.hiddenCount === 0, show(r));
    check('fewer than limit: showMore is false', r.showMore === false);
    check('fewer than limit: not forced open', r.forcedOpen === false);
    check('fewer than limit: shown is the full list in order', r.shown.map(x => x.id).join(',') === 't0,t1,t2');
  }
  {
    const threads = t(5);
    const r = foldThreads(threads, 't4', false);
    check('exactly limit: nothing hidden', r.shown.length === 5 && r.hiddenCount === 0, show(r));
    check('exactly limit: showMore is false', r.showMore === false);
    check('exactly limit: not forced open (last index is inside the fold)', r.forcedOpen === false);
  }
  {
    const threads = t(7);
    const r = foldThreads(threads, 't2', false);
    check('more than limit, collapsed, active inside fold: shows first 5', r.shown.map(x => x.id).join(',') === 't0,t1,t2,t3,t4');
    check('more than limit, collapsed: hiddenCount is 2', r.hiddenCount === 2);
    check('more than limit: showMore is true', r.showMore === true);
    check('active inside fold: not forced open', r.forcedOpen === false);
  }
  {
    const threads = t(7);
    const r = foldThreads(threads, 't2', true);
    check('expanded: shows everything', r.shown.length === 7);
    check('expanded: hiddenCount is 0', r.hiddenCount === 0);
    check('expanded: showMore still true (there is more than the limit)', r.showMore === true);
    check('expanded with active inside fold: not forced open', r.forcedOpen === false);
  }
  {
    const threads = t(7);
    const r = foldThreads(threads, 't6', false);
    check('active beyond the fold forces the list open even though expanded is false',
      r.shown.length === 7 && r.hiddenCount === 0, show(r));
    check('active beyond the fold: forcedOpen is true', r.forcedOpen === true);
    check('active beyond the fold: showMore stays true', r.showMore === true);
  }
  {
    const threads = t(7);
    const r = foldThreads(threads, 't6', true);
    check('active beyond the fold and expanded: forcedOpen is still true (regardless of expanded)', r.forcedOpen === true);
  }
  {
    const threads = t(5);
    const r = foldThreads(threads, 't1', false, 3);
    check('custom limit: shows first 3', r.shown.map(x => x.id).join(',') === 't0,t1,t2');
    check('custom limit: hiddenCount is 2', r.hiddenCount === 2);
    check('custom limit: active inside custom fold, not forced', r.forcedOpen === false);
  }
  {
    const threads = t(5);
    const r = foldThreads(threads, 't3', false, 3);
    check('custom limit: active beyond the custom fold forces open', r.forcedOpen === true && r.shown.length === 5);
  }
  {
    const threads = t(3);
    const r = foldThreads(threads, 'missing', false);
    check('active id not present in the list: treated as not beyond the fold', r.forcedOpen === false);
  }
}

console.log('\nthreadView: projectCounts\n');
{
  const mixed: ThreadState[] = ['needs-you', 'needs-you', 'working', 'running', 'done', 'quiet', 'asleep'];
  const c = projectCounts(mixed);
  check('needsYou counts only needs-you', c.needsYou === 2, show(c));
  check('running counts running plus working', c.running === 2, show(c));
  const none = projectCounts(['quiet', 'done', 'asleep']);
  check('both zero when nothing needs-you/working/running', none.needsYou === 0 && none.running === 0, show(none));
  check('empty list is zero and zero', projectCounts([]).needsYou === 0 && projectCounts([]).running === 0);
}

console.log('\nthreadView: sidebarSections\n');
{
  const tabs: Tab[] = [
    tab('t1'),
    tab('t2', { groupId: 'A' }),
    tab('t3', { groupId: 'A' }),
    tab('t4', { groupId: 'B' }),
    tab('t6'),
    tab('t5', { groupId: 'C' }),
  ];
  const groups: Group[] = [
    group('E', { pinned: true }),                     // pinned, zero tabs
    group('A', { pinned: true }),                      // pinned, has tabs
    group('B', { pinned: false }),                      // unpinned, has tabs
    group('C', { pinned: true, archived: true }),       // archived: dropped even though pinned
    group('D', { pinned: false }),                       // unpinned, zero tabs
  ];
  const segments = computeSegments(tabs, groups);
  const sections = sidebarSections(segments);

  check('general is the ungrouped tabs in walk order',
    sections.general.map(t => t.id).join(',') === 't1,t6', show(sections.general.map(t => t.id)));

  check('pinned holds A and E, in walk order, archived C excluded',
    sections.pinned.map(p => p.group.id).join(',') === 'A,E', show(sections.pinned.map(p => p.group.id)));
  check('pinned A carries its tabs',
    sections.pinned.find(p => p.group.id === 'A')?.tabs.map(t => t.id).join(',') === 't2,t3');
  check('pinned E (zero tabs) carries an empty list',
    sections.pinned.find(p => p.group.id === 'E')?.tabs.length === 0);

  check('projects holds B and D, in walk order',
    sections.projects.map(p => p.group.id).join(',') === 'B,D', show(sections.projects.map(p => p.group.id)));
  check('projects B carries its tabs',
    sections.projects.find(p => p.group.id === 'B')?.tabs.map(t => t.id).join(',') === 't4');
  check('projects D (zero tabs) carries an empty list',
    sections.projects.find(p => p.group.id === 'D')?.tabs.length === 0);

  check('archived group C appears in neither pinned nor projects',
    !sections.pinned.some(p => p.group.id === 'C') && !sections.projects.some(p => p.group.id === 'C'));

  const noUngrouped = sidebarSections(computeSegments([tab('t1', { groupId: 'A' })], [group('A')]));
  check('general is empty when there are no ungrouped tabs', noUngrouped.general.length === 0);
}

console.log('\nthreadView: toastMessage\n');
{
  const cases: [TabNotification, string][] = [
    ['attention', 'Needs permission'],
    ['done', 'Done'],
    ['background', 'Background tasks running'],
    ['compacting', 'Compacting context'],
    ['working', ''],
  ];
  for (const [type, expected] of cases) {
    check(`toastMessage(${type}) is "${expected || '(empty, no toast)'}"`, toastMessage(type) === expected);
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);

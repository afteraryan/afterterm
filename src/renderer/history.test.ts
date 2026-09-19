// Unit tests for history.ts. Run directly on Node 24+ (strips types):
//   node src/renderer/history.test.ts
// Exits 0 if all pass, 1 on any failure.

import { isDeepStrictEqual } from 'util';
import {
  HISTORY_MAX, historyEntryFor, appendHistory, removeHistoryEntry, isResumable, tabFromHistory,
  maxNumericId, historyTitleMatches,
} from './history.ts';
import type { Tab, Group, HistoryEntry } from './components/TabBar/types.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}
const show = (v: unknown) => JSON.stringify(v);

const NOW = 1_757_000_000_000;
const UUID = '3d71b0f2-26cb-4ad3-8371-6504ab2e37e2';

function chatTab(extra: Partial<Tab> = {}): Tab {
  return {
    id: 'tab-5', title: 'cmd.exe', groupId: 'group-1', cwd: 'D:\\Work\\afterterm',
    claudeSessionId: UUID, claudeCwd: 'D:\\Work\\afterterm\\sub',
    lastActiveAt: 100, asleep: false,
    ...extra,
  };
}
function shellTab(extra: Partial<Tab> = {}): Tab {
  return { id: 'tab-7', title: 'aftertales', groupId: 'group-1', cwd: 'D:\\Work\\aftertales', lastActiveAt: 100, asleep: false, ...extra };
}
function entry(extra: Partial<HistoryEntry> = {}): HistoryEntry {
  return { id: 'tab-1', title: 'thread', kind: 'shell', closedAt: 1, ...extra };
}

console.log('\nhistory: HISTORY_MAX\n');
{
  check('HISTORY_MAX is 100', HISTORY_MAX === 100);
}

console.log('\nhistory: historyEntryFor\n');
{
  const e = historyEntryFor(chatTab(), 'Fix the spinner', NOW);
  check('chat entry shape: id, title, kind, sessionId, cwd, closedAt, nothing else',
    isDeepStrictEqual(Object.keys(e).sort(), ['closedAt', 'cwd', 'id', 'kind', 'sessionId', 'title'].sort()), show(e));
  check('chat entry id is the tab id', e.id === 'tab-5');
  check('chat entry kind is chat', e.kind === 'chat');
  check('chat entry sessionId is claudeSessionId', e.sessionId === UUID);
  check('chat entry cwd prefers claudeCwd', e.cwd === 'D:\\Work\\afterterm\\sub');
  check('chat entry closedAt is now', e.closedAt === NOW);
}
{
  const e = historyEntryFor(shellTab(), 'aftertales', NOW);
  check('shell entry shape: id, title, kind, cwd, closedAt, no sessionId key at all',
    isDeepStrictEqual(Object.keys(e).sort(), ['closedAt', 'cwd', 'id', 'kind', 'title'].sort()), show(e));
  check('shell entry kind is shell', e.kind === 'shell');
  check('shell entry has no sessionId key (not even undefined)', !('sessionId' in e));
  check('shell entry cwd falls back to cwd (no claudeCwd)', e.cwd === 'D:\\Work\\aftertales');
}
{
  // No cwd at all: the cwd key is omitted entirely, not written as undefined.
  const bare: Tab = { id: 'tab-9', title: 'bare', lastActiveAt: 1, asleep: false };
  const e = historyEntryFor(bare, 'bare', NOW);
  check('no cwd key when the tab has none', !('cwd' in e), show(e));
}

console.log('\nhistory: appendHistory\n');
{
  const h = [entry({ id: 'a', closedAt: 1 }), entry({ id: 'b', closedAt: 2 })];
  const out = appendHistory(h, entry({ id: 'c', closedAt: 3 }));
  check('newest entry goes first', out[0].id === 'c');
  check('order otherwise preserved', out.map(e => e.id).join(',') === 'c,a,b', show(out.map(e => e.id)));
  check('does not mutate the input array', h.length === 2);
}
{
  // Re-closing the same tab id replaces the old row instead of duplicating it.
  const h = [entry({ id: 'a', closedAt: 1, title: 'old' }), entry({ id: 'b', closedAt: 2 })];
  const out = appendHistory(h, entry({ id: 'a', closedAt: 5, title: 'new' }));
  check('dedupes by id, new entry replaces the old one', out.length === 2 && out[0].title === 'new', show(out));
}
{
  // Cap at 100: the oldest (last) entries fall off.
  const h = Array.from({ length: HISTORY_MAX }, (_, i) => entry({ id: `e${i}`, closedAt: i }));
  const out = appendHistory(h, entry({ id: 'new', closedAt: 999 }));
  check('stays at HISTORY_MAX after the cap', out.length === HISTORY_MAX, show(out.length));
  check('newest entry is first', out[0].id === 'new');
  check('the oldest existing entry (e99, appended last so pushed to the end) is dropped',
    !out.some(e => e.id === 'e99'), show(out.map(e => e.id)));
}

console.log('\nhistory: removeHistoryEntry\n');
{
  const h = [entry({ id: 'a' }), entry({ id: 'b' })];
  const out = removeHistoryEntry(h, 'a');
  check('removes the matching entry', out.length === 1 && out[0].id === 'b');
  check('removing an id not present changes nothing', removeHistoryEntry(h, 'zzz').length === 2);
}

console.log('\nhistory: isResumable\n');
{
  check('chat with a UUID is resumable', isResumable(entry({ kind: 'chat', sessionId: UUID })) === true);
  check('chat without a sessionId is not resumable', isResumable(entry({ kind: 'chat' })) === false);
  check('chat with a garbage sessionId is not resumable', isResumable(entry({ kind: 'chat', sessionId: 'not-a-uuid' })) === false);
  check('shell with a UUID is still not resumable (nothing to resume)', isResumable(entry({ kind: 'shell', sessionId: UUID })) === false);
}

console.log('\nhistory: tabFromHistory\n');
{
  const group: Pick<Group, 'id' | 'shellId' | 'cwd'> = { id: 'group-1', shellId: 'cmd', cwd: 'D:\\Work\\afterterm' };
  const e = entry({ id: 'tab-5', title: 'Fix the spinner', kind: 'chat', sessionId: UUID, cwd: 'D:\\Work\\afterterm\\sub' });
  const t = tabFromHistory(e, group, NOW);
  check('same id as the history entry', t.id === 'tab-5');
  check('title and claudeTitle both set for a chat', t.title === 'Fix the spinner' && t.claudeTitle === 'Fix the spinner');
  check('groupId and shellId from the group', t.groupId === 'group-1' && t.shellId === 'cmd');
  check('cwd prefers the entry cwd over the group cwd', t.cwd === 'D:\\Work\\afterterm\\sub');
  check('claudeSessionId and claudeCwd set for a chat', t.claudeSessionId === UUID && t.claudeCwd === 'D:\\Work\\afterterm\\sub');
  check('asleep is false and wokeAt is now', t.asleep === false && t.wokeAt === NOW);
  check('lastActiveAt is now', t.lastActiveAt === NOW);
}
{
  const group: Pick<Group, 'id' | 'shellId' | 'cwd'> = { id: 'group-1', shellId: 'cmd', cwd: 'D:\\Work\\aftertales' };
  const e = entry({ id: 'tab-7', title: 'aftertales', kind: 'shell', cwd: 'D:\\Work\\aftertales' });
  const t = tabFromHistory(e, group, NOW);
  check('shell has no claudeSessionId', !('claudeSessionId' in t), show(t));
  check('shell has no claudeCwd', !('claudeCwd' in t), show(t));
  check('shell has no claudeTitle', !('claudeTitle' in t), show(t));
  check('shell cwd from the entry', t.cwd === 'D:\\Work\\aftertales');
}
{
  // An entry with no cwd of its own falls back to the group's cwd.
  const group: Pick<Group, 'id' | 'shellId' | 'cwd'> = { id: 'group-1', shellId: 'cmd', cwd: 'D:\\Work\\aftertales' };
  const e = entry({ id: 'tab-8', title: 'aftertales', kind: 'shell' });
  const t = tabFromHistory(e, group, NOW);
  check('cwd falls back to the group cwd when the entry has none', t.cwd === 'D:\\Work\\aftertales');
}

console.log('\nhistory: maxNumericId\n');
{
  check('largest N across mixed ids', maxNumericId('tab-', ['tab-7', 'tab-12', 'group-3', 'tab-x']) === 12);
  check('no matching prefix gives 0', maxNumericId('tab-', ['group-3', 'group-9']) === 0);
  check('empty iterable gives 0', maxNumericId('tab-', []) === 0);
  check('a different prefix ("group-") is scoped independently',
    maxNumericId('group-', ['tab-7', 'tab-12', 'group-3', 'tab-x']) === 3);
}

console.log('\nhistory: historyTitleMatches\n');
{
  check('case-insensitive substring match', historyTitleMatches(entry({ title: 'Fix the Spinner' }), 'spinner') === true);
  check('non-matching substring', historyTitleMatches(entry({ title: 'Fix the Spinner' }), 'zzz') === false);
  check('empty query matches everything', historyTitleMatches(entry({ title: 'anything' }), '') === true);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);

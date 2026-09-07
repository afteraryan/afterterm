// Unit tests for the session.json migration and serializer. Run directly on
// Node 24+ (strips types):
//   node src/renderer/sessionMigration.test.ts
// Exits 0 if all pass, 1 on any failure.

import { isDeepStrictEqual } from 'util';
import { migrateSession, serializeSession, SESSION_FORMAT_VERSION } from './sessionMigration.ts';
import type { SavedSession } from './sessionMigration.ts';
import type { Tab, Group } from './components/TabBar/types.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}
const show = (v: unknown) => JSON.stringify(v);

const NOW = 1_757_000_000_000;

// A session.json exactly as release 0.8.1 writes it: no version field, none of
// the project/thread fields. Built fresh per test so mutation cannot leak.
function fixture081() {
  return {
    tabs: [
      // Two tabs in a project, one of them a Claude chat with a zoomed font.
      { id: 'tab-3', title: 'cmd.exe', groupId: 'group-1', cwd: 'D:\\Work\\afterterm' },
      { id: 'tab-5', title: '✳ Fix the spinner', groupId: 'group-1', cwd: 'D:\\Work\\afterterm', fontSize: 15,
        claudeSessionId: '3d71b0f2-26cb-4ad3-8371-6504ab2e37e2', claudeCwd: 'D:\\Work\\afterterm' },
      // An ungrouped tab with an explicit shell.
      { id: 'tab-7', title: 'bash', shellId: 'gitbash', cwd: 'C:\\Users\\aryan' },
    ],
    groups: [
      { id: 'group-1', label: 'afterterm', color: 'teal', collapsed: false, cwd: 'D:\\Work\\afterterm', shellId: 'cmd' },
      // A project with zero terminals (it lived in the Projects shelf in 0.8.1).
      { id: 'group-2', label: 'aftertales', color: 'blue', collapsed: true, cwd: 'D:\\Work\\aftertales' },
    ],
    activeTabId: 'tab-5',
  };
}

console.log('\nsessionMigration: a 0.8.1 file loads with defaults\n');
{
  const s = migrateSession(fixture081(), NOW)!;
  check('returns a session', s !== null);
  check('version is stamped', s.version === SESSION_FORMAT_VERSION);
  check('all three tabs survive', s.tabs.length === 3, show(s.tabs.map(t => t.id)));
  check('both groups survive, including the empty one', s.groups.length === 2 && s.groups[1].id === 'group-2');
  check('every tab gets lastActiveAt = now and asleep = false',
    s.tabs.every(t => t.lastActiveAt === NOW && t.asleep === false));
  check('every group gets pinned/archived = false and lastActiveAt = now',
    s.groups.every(g => g.pinned === false && g.archived === false && g.lastActiveAt === NOW));
  check('activeTabId is kept', s.activeTabId === 'tab-5');
  check('every group gets history = [] (Phase 4)', s.groups.every(g => isDeepStrictEqual(g.history, [])));
  check('no tab gets a sleptAt out of nowhere (Phase 4)', s.tabs.every(t => t.sleptAt === undefined));
}

console.log('\nsessionMigration: SESSION_FORMAT_VERSION stays 2 (Phase 3 is a fill-defaults pass)\n');
{
  check('the version constant has not been bumped', SESSION_FORMAT_VERSION === 2);
}

console.log('\nsessionMigration: model, branch, worktree (Phase 3)\n');
{
  // A Phase 2 file: version 2, but no model/branch/worktree on any tab.
  const s = migrateSession(fixture081(), NOW)!;
  check('model is absent, not null', s.tabs.every(t => t.model === undefined), show(s.tabs.map(t => t.model)));
  check('branch is absent, not null', s.tabs.every(t => t.branch === undefined));
  check('worktree is absent, not null', s.tabs.every(t => t.worktree === undefined));
}
{
  // A file that already carries them keeps them.
  const raw = fixture081() as any;
  raw.tabs[1].model = 'claude-opus-5[1m]';
  raw.tabs[1].branch = 'phase-3-thread-identity';
  raw.tabs[1].worktree = '.claude\\worktrees\\phase-3-thread-identity';
  const s = migrateSession(raw, NOW)!;
  const chat = s.tabs.find(t => t.id === 'tab-5')!;
  check('model kept', chat.model === 'claude-opus-5[1m]');
  check('branch kept', chat.branch === 'phase-3-thread-identity');
  check('worktree kept', chat.worktree === '.claude\\worktrees\\phase-3-thread-identity');
}
{
  // Wrong types are dropped, not coerced.
  const raw = fixture081() as any;
  raw.tabs[0].model = 42;
  raw.tabs[0].branch = { name: 'main' };
  raw.tabs[0].worktree = ['a'];
  const s = migrateSession(raw, NOW)!;
  check('a numeric model is dropped', s.tabs[0].model === undefined);
  check('an object branch is dropped', s.tabs[0].branch === undefined);
  check('an array worktree is dropped', s.tabs[0].worktree === undefined);
}
{
  // firstPrompt is transient: stripped on load even if a file carries it (a stray
  // write, or a future build sharing the file). claudeTitle is persisted: a chat
  // keeps its name across relaunches even though the restored shell overwrites
  // the raw title.
  const raw = fixture081() as any;
  raw.tabs[1].claudeTitle = 'Fix the spinner';
  raw.tabs[1].firstPrompt = 'help me fix the spinner bug';
  raw.tabs[0].claudeTitle = 42;
  const s = migrateSession(raw, NOW)!;
  check('claudeTitle is kept', s.tabs[1].claudeTitle === 'Fix the spinner');
  check('a non-string claudeTitle is dropped', !('claudeTitle' in s.tabs[0]));
  check('firstPrompt is stripped', !('firstPrompt' in s.tabs[1]));
  const written = serializeSession(s.tabs as unknown as Tab[], s.groups, s.activeTabId);
  check('claudeTitle is written back', written.tabs[1].claudeTitle === 'Fix the spinner');
  check('firstPrompt is never written', !('firstPrompt' in written.tabs[1]));
}

console.log('\nsessionMigration: sleptAt and history (Phase 4)\n');
{
  // A version-2 file with asleep tabs and a sleptAt keeps both.
  const raw = fixture081() as any;
  raw.tabs[1].asleep = true;
  raw.tabs[1].sleptAt = 1_756_000_000_000;
  raw.groups[0].history = [
    { id: 'tab-9', title: 'Old chat', kind: 'chat', sessionId: '3d71b0f2-26cb-4ad3-8371-6504ab2e37e2', cwd: 'D:\\Work\\afterterm', closedAt: 1_755_000_000_000 },
  ];
  const s = migrateSession(raw, NOW)!;
  const chat = s.tabs.find(t => t.id === 'tab-5')!;
  check('asleep kept true', chat.asleep === true);
  check('sleptAt kept', chat.sleptAt === 1_756_000_000_000);
  check('a good history entry survives', s.groups[0].history.length === 1);
  check('history entry fields kept', isDeepStrictEqual(s.groups[0].history[0], {
    id: 'tab-9', title: 'Old chat', kind: 'chat', sessionId: '3d71b0f2-26cb-4ad3-8371-6504ab2e37e2', cwd: 'D:\\Work\\afterterm', closedAt: 1_755_000_000_000,
  }));
}
{
  // A wrongly typed sleptAt is dropped, not coerced.
  const raw = fixture081() as any;
  raw.tabs[0].sleptAt = 'yesterday';
  raw.tabs[1].sleptAt = Infinity;
  raw.tabs[2].sleptAt = NaN;
  const s = migrateSession(raw, NOW)!;
  check('a string sleptAt is dropped', s.tabs[0].sleptAt === undefined);
  check('an Infinity sleptAt is dropped', s.tabs[1].sleptAt === undefined);
  check('a NaN sleptAt is dropped', s.tabs[2].sleptAt === undefined);
}
{
  // A wrongly typed history (a string, an object) becomes [].
  const raw = fixture081() as any;
  raw.groups[0].history = 'nope';
  raw.groups[1].history = { title: 'not an array' };
  const s = migrateSession(raw, NOW)!;
  check('a string history becomes []', isDeepStrictEqual(s.groups[0].history, []));
  check('an object history becomes []', isDeepStrictEqual(s.groups[1].history, []));
}
{
  // One good entry and two bad ones: only the good one survives.
  const raw = fixture081() as any;
  raw.groups[0].history = [
    { id: 'tab-9', title: 'Old chat', kind: 'chat', closedAt: 1_755_000_000_000 },
    { title: 'no id', kind: 'chat', closedAt: 1_755_000_000_000 },
    { id: 'tab-10', title: 'bad kind', kind: 'nope', closedAt: 1_755_000_000_000 },
    null,
    'not even an object',
  ];
  const s = migrateSession(raw, NOW)!;
  check('only the one good entry is kept', s.groups[0].history.length === 1, show(s.groups[0].history));
  check('the surviving entry is the good one', s.groups[0].history[0].id === 'tab-9');
}

console.log('\nsessionMigration: existing values are preserved\n');
{
  const s = migrateSession(fixture081(), NOW)!;
  const chat = s.tabs.find(t => t.id === 'tab-5')!;
  check('claude session id and cwd kept',
    chat.claudeSessionId === '3d71b0f2-26cb-4ad3-8371-6504ab2e37e2' && chat.claudeCwd === 'D:\\Work\\afterterm');
  check('fontSize, title, groupId, cwd kept',
    chat.fontSize === 15 && chat.title === '✳ Fix the spinner' && chat.groupId === 'group-1' && chat.cwd === 'D:\\Work\\afterterm');
  check('ungrouped tab has no groupId and keeps its shellId',
    s.tabs[2].groupId === undefined && s.tabs[2].shellId === 'gitbash');
  const g = s.groups[0];
  check('group label, colour, collapsed, cwd, shellId kept',
    g.label === 'afterterm' && g.color === 'teal' && g.collapsed === false && g.cwd === 'D:\\Work\\afterterm' && g.shellId === 'cmd');
  check('collapsed = true survives', s.groups[1].collapsed === true);
}
{
  // A file already in the new format keeps its own values rather than "now".
  const raw = fixture081() as any;
  raw.tabs[0].lastActiveAt = 12345; raw.tabs[0].asleep = true;
  raw.groups[0].pinned = true; raw.groups[0].archived = true; raw.groups[0].lastActiveAt = 777;
  const s = migrateSession(raw, NOW)!;
  check('explicit tab lastActiveAt/asleep kept', s.tabs[0].lastActiveAt === 12345 && s.tabs[0].asleep === true);
  check('explicit group pinned/archived/lastActiveAt kept',
    s.groups[0].pinned === true && s.groups[0].archived === true && s.groups[0].lastActiveAt === 777);
}

console.log('\nsessionMigration: wrong types fall back to defaults\n');
{
  const raw = fixture081() as any;
  raw.tabs[0].lastActiveAt = 'yesterday';
  raw.tabs[1].lastActiveAt = Infinity;
  raw.tabs[2].lastActiveAt = NaN;
  raw.tabs[0].asleep = 'false';
  raw.groups[0].pinned = 1;
  raw.groups[0].archived = null;
  raw.groups[0].lastActiveAt = '2026';
  raw.groups[1].collapsed = 'yes';
  delete raw.groups[0].collapsed;
  raw.activeTabId = 42;
  const s = migrateSession(raw, NOW)!;
  check('string / Infinity / NaN lastActiveAt on tabs become now',
    s.tabs.every(t => t.lastActiveAt === NOW), show(s.tabs.map(t => t.lastActiveAt)));
  check('string "false" asleep becomes false, not true', s.tabs[0].asleep === false);
  check('numeric pinned and null archived become false', s.groups[0].pinned === false && s.groups[0].archived === false);
  check('string group lastActiveAt becomes now', s.groups[0].lastActiveAt === NOW);
  check('missing collapsed becomes false, string collapsed becomes false',
    s.groups[0].collapsed === false && s.groups[1].collapsed === false);
  check('non-string activeTabId becomes empty', s.activeTabId === '');
}

console.log('\nsessionMigration: bad entries are dropped, bad files rejected\n');
{
  const raw = fixture081() as any;
  raw.tabs.push(null, 'tab-9', 12, { title: 'no id' }, { id: 7 }, { id: '' });
  raw.groups.push(undefined, [], { label: 'no id', color: 'red' });
  const s = migrateSession(raw, NOW)!;
  check('tab entries that are not objects or lack a string id are dropped',
    s.tabs.length === 3 && s.tabs.every(t => typeof t.id === 'string'));
  check('group entries that are not objects or lack a string id are dropped',
    s.groups.length === 2 && s.groups.every(g => typeof g.id === 'string'));
}
{
  const raw = fixture081() as any;
  raw.activeTabId = 'tab-gone';
  check('activeTabId pointing at no surviving tab becomes empty', migrateSession(raw, NOW)!.activeTabId === '');
}
{
  const raw = fixture081() as any;
  delete raw.groups;
  const s = migrateSession(raw, NOW);
  check('missing groups array is treated as empty', s !== null && s.groups.length === 0);
}
{
  check('null returns null', migrateSession(null, NOW) === null);
  check('undefined returns null', migrateSession(undefined, NOW) === null);
  check('a string returns null', migrateSession('{"tabs":[]}', NOW) === null);
  check('{} returns null', migrateSession({}, NOW) === null);
  check('an array returns null', migrateSession([], NOW) === null);
  check('tabs that is not an array returns null', migrateSession({ tabs: 'nope', groups: [] }, NOW) === null);
  check('empty tabs is a session with zero tabs, not null',
    isDeepStrictEqual(migrateSession({ tabs: [] }, NOW), { version: SESSION_FORMAT_VERSION, tabs: [], groups: [], activeTabId: '' }));
}

console.log('\nsessionMigration: transient fields stripped, unknown keys kept, idempotent\n');
{
  const raw = fixture081() as any;
  raw.tabs[0].notification = 'working';
  raw.tabs[0].claudeRestorable = true;
  raw.tabs[1].futureField = { from: 'a newer build' };
  // history is now a validated field (Phase 4), not a passthrough unknown key,
  // so a genuinely unknown group key is used here instead to exercise "unknown
  // keys survive". A history entry with no id/kind/closedAt is invalid and
  // dropped, which the sleptAt-and-history block above already covers.
  raw.groups[0].futureGroupField = { from: 'a newer build' };
  raw.version = 99;
  const s = migrateSession(raw, NOW)!;
  check('notification and claudeRestorable are stripped',
    !('notification' in s.tabs[0]) && !('claudeRestorable' in s.tabs[0]));
  check('unknown tab key survives', isDeepStrictEqual((s.tabs[1] as any).futureField, { from: 'a newer build' }));
  check('unknown group key survives', isDeepStrictEqual((s.groups[0] as any).futureGroupField, { from: 'a newer build' }));
  check('version is normalised to the current format', s.version === SESSION_FORMAT_VERSION);
}
{
  const once = migrateSession(fixture081(), NOW)!;
  const twice = migrateSession(once, NOW + 5_000_000)!;
  check('migrating a migrated session changes nothing (even with a later now)', isDeepStrictEqual(once, twice));
  const raw = fixture081();
  migrateSession(raw, NOW);
  check('migration does not mutate its input',
    !('lastActiveAt' in raw.tabs[0]) && !('pinned' in raw.groups[0]));
}
{
  // Idempotent with sleptAt and a non-empty history present (Phase 4).
  const raw = fixture081() as any;
  raw.tabs[1].asleep = true;
  raw.tabs[1].sleptAt = 1_756_000_000_000;
  raw.groups[0].history = [
    { id: 'tab-9', title: 'Old chat', kind: 'chat', sessionId: '3d71b0f2-26cb-4ad3-8371-6504ab2e37e2', cwd: 'D:\\Work\\afterterm', closedAt: 1_755_000_000_000 },
  ];
  const once = migrateSession(raw, NOW)!;
  const twice = migrateSession(once, NOW + 5_000_000)!;
  check('sleptAt and history survive a second migration unchanged', isDeepStrictEqual(once, twice), show(twice));
}

console.log('\nserializeSession: persisted keys only, 0.8.1 compatible\n');
{
  const tabs: Tab[] = [
    {
      id: 'tab-1', title: 'cmd.exe', groupId: 'group-1', shellId: 'cmd', cwd: 'D:\\Work', fontSize: 14,
      claudeSessionId: 'abc', claudeCwd: 'D:\\Work', lastActiveAt: 111, asleep: true, sleptAt: 444,
      wokeAt: 555, notification: 'working',
      ...({ futureField: 'x' } as object),
    },
    { id: 'tab-2', title: 'Terminal', lastActiveAt: 222, asleep: false },
  ];
  const groups: Group[] = [
    { id: 'group-1', label: 'work', color: 'teal', collapsed: false, cwd: 'D:\\Work', shellId: 'cmd',
      pinned: true, archived: false, lastActiveAt: 333, history: [] },
  ];
  const out = serializeSession(tabs, groups, 'tab-1');
  const PERSISTED = ['id', 'title', 'groupId', 'shellId', 'cwd', 'fontSize', 'claudeSessionId', 'claudeCwd', 'lastActiveAt', 'asleep', 'sleptAt', 'model', 'branch', 'worktree', 'claudeTitle'];
  check('includes version', out.version === SESSION_FORMAT_VERSION);
  check('top-level shape is still {tabs, groups, activeTabId} plus version',
    isDeepStrictEqual(Object.keys(out).sort(), ['activeTabId', 'groups', 'tabs', 'version']));
  check('tab emits only the persisted keys (no notification, claudeRestorable, wokeAt or unknown keys)',
    isDeepStrictEqual(Object.keys(out.tabs[0]).sort(), [...PERSISTED].sort()), show(Object.keys(out.tabs[0])));
  const KEYS_081 = ['id', 'title', 'groupId', 'shellId', 'cwd', 'fontSize', 'claudeSessionId', 'claudeCwd'];
  check('every 0.8.1 tab key is present with the same value',
    KEYS_081.every(k => (out.tabs[0] as any)[k] === (tabs[0] as any)[k]));
  check('0.8.1 group keys unchanged and new group flags written',
    out.groups[0].label === 'work' && out.groups[0].color === 'teal' && out.groups[0].collapsed === false
    && out.groups[0].cwd === 'D:\\Work' && out.groups[0].shellId === 'cmd'
    && out.groups[0].pinned === true && out.groups[0].archived === false && out.groups[0].lastActiveAt === 333);
  check('activeTabId written as given', out.activeTabId === 'tab-1');
  check('sleptAt is written when set', out.tabs[0].sleptAt === 444);
  check('wokeAt is never written, even when set on the in-memory tab', !('wokeAt' in out.tabs[0]));
  // JSON.stringify is what actually hits disk: optional keys that are undefined
  // vanish, exactly as 0.8.1 behaved, so an ungrouped tab has no "groupId" key.
  const onDisk = JSON.parse(JSON.stringify(out));
  check('undefined optionals are absent on disk', !('groupId' in onDisk.tabs[1]) && !('cwd' in onDisk.tabs[1]));
  check('sleptAt is absent on disk for a tab that never slept', !('sleptAt' in onDisk.tabs[1]));
  check('groups are copied, not shared with state', out.groups[0] !== groups[0] && isDeepStrictEqual(out.groups[0], groups[0]));
  check('a group without history serializes with history: [] (defensive)',
    isDeepStrictEqual(serializeSession([], [{ ...groups[0], history: undefined as any }], '').groups[0].history, []));
}

console.log('\nround trip: serialize then migrate is stable\n');
{
  const migrated = migrateSession(fixture081(), NOW)!;
  // What the app holds in memory after restore: transient flags on top of the saved tabs.
  const inMemoryTabs: Tab[] = migrated.tabs.map(t => ({ ...t, claudeRestorable: !!t.claudeSessionId }));
  const written: SavedSession = JSON.parse(JSON.stringify(serializeSession(inMemoryTabs, migrated.groups, migrated.activeTabId)));
  const reloaded = migrateSession(written, NOW + 1)!;
  check('serialize -> JSON -> migrate reproduces the migrated session', isDeepStrictEqual(reloaded, migrated), show(reloaded));
  check('a second save of the reloaded session is byte-identical',
    JSON.stringify(serializeSession(reloaded.tabs as Tab[], reloaded.groups, reloaded.activeTabId)) === JSON.stringify(written));
}
{
  // Phase 3: model, branch and worktree survive the same round trip.
  const migrated = migrateSession(fixture081(), NOW)!;
  const inMemoryTabs: Tab[] = migrated.tabs.map(t => ({
    ...t,
    claudeRestorable: !!t.claudeSessionId,
    ...(t.id === 'tab-5' ? { model: 'claude-opus-5[1m]', branch: 'phase-3-thread-identity', worktree: '.claude\\worktrees\\phase-3-thread-identity' } : {}),
  }));
  const written: SavedSession = JSON.parse(JSON.stringify(serializeSession(inMemoryTabs, migrated.groups, migrated.activeTabId)));
  const reloaded = migrateSession(written, NOW + 1)!;
  const chat = reloaded.tabs.find(t => t.id === 'tab-5')!;
  check('model survives serialize -> migrate', chat.model === 'claude-opus-5[1m]');
  check('branch survives serialize -> migrate', chat.branch === 'phase-3-thread-identity');
  check('worktree survives serialize -> migrate', chat.worktree === '.claude\\worktrees\\phase-3-thread-identity');
  check('a shell tab with none of the three still has none after the round trip',
    reloaded.tabs.find(t => t.id === 'tab-3')!.model === undefined);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);

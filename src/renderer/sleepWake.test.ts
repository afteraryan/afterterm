// Unit tests for sleepWake.ts. Run directly on Node 24+ (strips types):
//   node src/renderer/sleepWake.test.ts
// Exits 0 if all pass, 1 on any failure.

import { isDeepStrictEqual } from 'util';
import {
  sleepTab, wakeTab, restoredTab, sleepAllForShutdown, asleepLabel, asleepSinceText, wakePlan,
} from './sleepWake.ts';
import type { Tab } from './components/TabBar/types.ts';
import type { SavedTab } from './sessionMigration.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}
const show = (v: unknown) => JSON.stringify(v);

const NOW = 1_757_000_000_000;

function chatTab(extra: Partial<Tab> = {}): Tab {
  return {
    id: 'tab-5', title: 'cmd.exe', groupId: 'group-1', cwd: 'D:\\Work\\afterterm', fontSize: 15,
    claudeSessionId: '3d71b0f2-26cb-4ad3-8371-6504ab2e37e2', claudeCwd: 'D:\\Work\\afterterm',
    claudeTitle: 'Fix the spinner', model: 'claude-opus-5[1m]', branch: 'main', worktree: '.claude\\worktrees\\phase-4',
    lastActiveAt: 100, asleep: false,
    ...extra,
  };
}

console.log('\nsleepWake: sleepTab\n');
{
  const tab = chatTab({ notification: 'working' });
  const asleep = sleepTab(tab, NOW);
  check('asleep is true', asleep.asleep === true);
  check('sleptAt is now', asleep.sleptAt === NOW);
  check('notification is removed', !('notification' in asleep));
  check('wokeAt is removed', !('wokeAt' in asleep));
  check('session id, cwd, claudeTitle, model, branch, worktree, fontSize all survive',
    asleep.claudeSessionId === tab.claudeSessionId && asleep.claudeCwd === tab.claudeCwd
    && asleep.claudeTitle === tab.claudeTitle && asleep.model === tab.model
    && asleep.branch === tab.branch && asleep.worktree === tab.worktree && asleep.fontSize === tab.fontSize,
    show(asleep));
  check('id, title, groupId, cwd untouched',
    asleep.id === tab.id && asleep.title === tab.title && asleep.groupId === tab.groupId && asleep.cwd === tab.cwd);
  check('sleepTab does not mutate its input', tab.asleep === false && tab.sleptAt === undefined);
}
{
  // Phase 5: port and lastCommand are a server's identity, kept untouched by sleep.
  const tab = chatTab({ claudeSessionId: undefined, claudeCwd: undefined, port: 5173, lastCommand: 'npm start' });
  const asleep = sleepTab(tab, NOW);
  check('port survives sleep untouched', asleep.port === 5173);
  check('lastCommand survives sleep untouched', asleep.lastCommand === 'npm start');
}
{
  // A tab already carrying wokeAt (woken, then put back to sleep) loses it.
  const tab = chatTab({ wokeAt: 50 });
  const asleep = sleepTab(tab, NOW);
  check('a stale wokeAt is cleared on sleep', !('wokeAt' in asleep));
}

console.log('\nsleepWake: wakeTab\n');
{
  const tab = chatTab({ asleep: true, sleptAt: 900, lastActiveAt: 900 });
  const awake = wakeTab(tab, NOW);
  check('asleep is false', awake.asleep === false);
  check('sleptAt is removed', !('sleptAt' in awake));
  check('wokeAt is now', awake.wokeAt === NOW);
  check('lastActiveAt is now', awake.lastActiveAt === NOW);
  check('identity fields survive', awake.claudeSessionId === tab.claudeSessionId && awake.claudeCwd === tab.claudeCwd);
}
{
  // Phase 5: port and lastCommand survive a wake untouched too.
  const tab = chatTab({ claudeSessionId: undefined, claudeCwd: undefined, asleep: true, sleptAt: 900, port: 5173, lastCommand: 'npm start' });
  const awake = wakeTab(tab, NOW);
  check('port survives wake untouched', awake.port === 5173);
  check('lastCommand survives wake untouched', awake.lastCommand === 'npm start');
}

console.log('\nsleepWake: sleepTab then wakeTab round trip\n');
{
  const tab = chatTab({ notification: 'attention' });
  const roundTripped = wakeTab(sleepTab(tab, NOW), NOW + 1000);
  check('no sleptAt after sleep then wake', !('sleptAt' in roundTripped));
  check('no notification after sleep then wake', !('notification' in roundTripped));
  check('ends awake', roundTripped.asleep === false);
}

console.log('\nsleepWake: restoredTab\n');
{
  // Saved with an explicit sleptAt (a clean quit ran sleepAllForShutdown first).
  const saved: SavedTab = { ...chatTab({ sleptAt: 555, lastActiveAt: 100 }) } as unknown as SavedTab;
  const t = restoredTab(saved, NOW);
  check('starts asleep', t.asleep === true);
  check('sleptAt is the saved sleptAt', t.sleptAt === 555);
  check('no notification', !('notification' in t));
  check('no wokeAt', !('wokeAt' in t));
}
{
  // Saved while awake (no sleptAt at all): falls back to lastActiveAt.
  const saved: SavedTab = { ...chatTab({ lastActiveAt: 4321 }) } as unknown as SavedTab;
  delete (saved as any).sleptAt;
  const t = restoredTab(saved, NOW);
  check('sleptAt falls back to lastActiveAt when the file has none', t.sleptAt === 4321);
  check('still starts asleep', t.asleep === true);
}
{
  // Phase 5: a restored server keeps its port and lastCommand.
  const saved: SavedTab = { ...chatTab({ claudeSessionId: undefined, claudeCwd: undefined, port: 5173, lastCommand: 'npm start' }) } as unknown as SavedTab;
  const t = restoredTab(saved, NOW);
  check('port survives restore untouched', t.port === 5173);
  check('lastCommand survives restore untouched', t.lastCommand === 'npm start');
}

console.log('\nsleepWake: sleepAllForShutdown\n');
{
  const awakeTab = chatTab({ id: 'tab-a', asleep: false });
  const alreadyAsleep = chatTab({ id: 'tab-b', asleep: true, sleptAt: 111 });
  const out = sleepAllForShutdown([awakeTab, alreadyAsleep], NOW);
  const a = out.find(t => t.id === 'tab-a')!;
  const b = out.find(t => t.id === 'tab-b')!;
  check('an awake tab becomes asleep with sleptAt = now', a.asleep === true && a.sleptAt === NOW);
  check('an already-asleep tab keeps its original sleptAt', b.asleep === true && b.sleptAt === 111);
}

console.log('\nsleepWake: asleepLabel\n');
{
  check('undefined sleptAt reads "just now"', asleepLabel(undefined, NOW) === 'Asleep · just now');
  check('59s ago reads "just now"', asleepLabel(NOW - 59_000, NOW) === 'Asleep · just now');
  check('60s ago reads "1m"', asleepLabel(NOW - 60_000, NOW) === 'Asleep · 1m');
  check('5 minutes ago reads "5m"', asleepLabel(NOW - 5 * 60_000, NOW) === 'Asleep · 5m');
  check('2 days ago reads "2d"', asleepLabel(NOW - 2 * 24 * 60 * 60_000, NOW) === 'Asleep · 2d');
  check('3 weeks ago reads "3w"', asleepLabel(NOW - 21 * 24 * 60 * 60_000, NOW) === 'Asleep · 3w');
}

console.log('\nsleepWake: asleepSinceText\n');
{
  // Phase 5: the first parameter is the kind WORD (threadView.kindWord's
  // output: 'Chat' | 'Server' | 'Shell'), not the old chat/shell union.
  check('chat, no sleptAt', asleepSinceText('Chat', undefined, NOW) === 'Chat asleep since just now');
  check('shell, 2 days', asleepSinceText('Shell', NOW - 2 * 24 * 60 * 60_000, NOW) === 'Shell asleep since 2d ago');
  check('chat, 59s (still "just now")', asleepSinceText('Chat', NOW - 59_000, NOW) === 'Chat asleep since just now');
  check('server, 2 days, no lastCommand: plain sentence, no "runs" part',
    asleepSinceText('Server', NOW - 2 * 24 * 60 * 60_000, NOW) === 'Server asleep since 2d ago');
  check('server, 2 days, with a lastCommand: "runs" suffix',
    asleepSinceText('Server', NOW - 2 * 24 * 60 * 60_000, NOW, 'npm start') === 'Server asleep since 2d ago · runs npm start');
  check('server, just now, with a lastCommand',
    asleepSinceText('Server', undefined, NOW, 'npm start') === 'Server asleep since just now · runs npm start');
  check('server with a whitespace-only lastCommand: no "runs" part',
    asleepSinceText('Server', NOW - 60_000, NOW, '   ') === 'Server asleep since 1m ago');
  check('server with an empty lastCommand: no "runs" part',
    asleepSinceText('Server', NOW - 60_000, NOW, '') === 'Server asleep since 1m ago');
  check('server with a lastCommand carrying surrounding whitespace: trimmed in the sentence',
    asleepSinceText('Server', NOW - 60_000, NOW, '  npm start  ') === 'Server asleep since 1m ago · runs npm start');
  check('a Chat with a lastCommand never shows the "runs" part (chats resume, they do not re-run commands)',
    asleepSinceText('Chat', NOW - 60_000, NOW, 'npm start') === 'Chat asleep since 1m ago');
  check('a Shell with a lastCommand never shows the "runs" part (not a server)',
    asleepSinceText('Shell', NOW - 60_000, NOW, 'npm start') === 'Shell asleep since 1m ago');
}

console.log('\nsleepWake: wakePlan\n');
{
  const chat = { cwd: 'D:\\Work', claudeCwd: 'D:\\Work\\sub', claudeSessionId: '3d71b0f2-26cb-4ad3-8371-6504ab2e37e2', shellId: 'cmd' };
  const plan = wakePlan(chat);
  check('chat: cwd prefers claudeCwd', plan.cwd === 'D:\\Work\\sub');
  check('chat: resumeSessionId is the valid uuid', plan.resumeSessionId === chat.claudeSessionId);
  check('chat: shellId passed through', plan.shellId === 'cmd');
  check('chat: runCommand is null (no port)', plan.runCommand === null);
}
{
  const shell = { cwd: 'D:\\Work', claudeCwd: undefined, claudeSessionId: undefined, shellId: 'gitbash' };
  const plan = wakePlan(shell);
  check('shell: cwd is the plain cwd', plan.cwd === 'D:\\Work');
  check('shell: resumeSessionId is null (no session id at all)', plan.resumeSessionId === null);
  check('shell: runCommand is null (no port)', plan.runCommand === null);
}
{
  const bad = { cwd: 'D:\\Work', claudeCwd: undefined, claudeSessionId: 'not-a-uuid', shellId: 'cmd' };
  const plan = wakePlan(bad);
  check('an invalid session id yields resumeSessionId null, not the garbage id',
    plan.resumeSessionId === null, show(plan));
}
{
  const chatNoClaudeCwd = { cwd: 'D:\\Work', claudeCwd: undefined, claudeSessionId: '3d71b0f2-26cb-4ad3-8371-6504ab2e37e2', shellId: undefined };
  const plan = wakePlan(chatNoClaudeCwd);
  check('a chat with no claudeCwd falls back to cwd', plan.cwd === 'D:\\Work');
}

console.log('\nsleepWake: wakePlan runCommand (Phase 5)\n');
{
  const server = { cwd: 'D:\\Work', claudeCwd: undefined, claudeSessionId: undefined, shellId: 'cmd', port: 5173, lastCommand: 'npm start' };
  const plan = wakePlan(server);
  check('server: runCommand is the trimmed lastCommand', plan.runCommand === 'npm start');
  check('server: resumeSessionId is null', plan.resumeSessionId === null);
}
{
  const server = { cwd: 'D:\\Work', claudeCwd: undefined, claudeSessionId: undefined, shellId: 'cmd', port: 5173, lastCommand: '  npm start  ' };
  const plan = wakePlan(server);
  check('server: surrounding whitespace is trimmed', plan.runCommand === 'npm start');
}
{
  const server = { cwd: 'D:\\Work', claudeCwd: undefined, claudeSessionId: undefined, shellId: 'cmd', port: 5173, lastCommand: undefined };
  const plan = wakePlan(server);
  check('server with no lastCommand: runCommand is null', plan.runCommand === null);
}
{
  const server = { cwd: 'D:\\Work', claudeCwd: undefined, claudeSessionId: undefined, shellId: 'cmd', port: 5173, lastCommand: '   ' };
  const plan = wakePlan(server);
  check('server with a whitespace-only lastCommand: runCommand is null (empty after trim)', plan.runCommand === null);
}
{
  const notServer = { cwd: 'D:\\Work', claudeCwd: undefined, claudeSessionId: undefined, shellId: 'cmd', port: undefined, lastCommand: 'npm start' };
  const plan = wakePlan(notServer);
  check('no port at all: runCommand is null even with a lastCommand present', plan.runCommand === null);
}
{
  const withCR = { cwd: 'D:\\Work', claudeCwd: undefined, claudeSessionId: undefined, shellId: 'cmd', port: 5173, lastCommand: 'npm start\r\nrm -rf /' };
  const plan = wakePlan(withCR);
  check('a lastCommand containing CR/LF is rejected (control characters)', plan.runCommand === null);
}
{
  const withEsc = { cwd: 'D:\\Work', claudeCwd: undefined, claudeSessionId: undefined, shellId: 'cmd', port: 5173, lastCommand: 'npm start\x1b[31m' };
  const plan = wakePlan(withEsc);
  check('a lastCommand containing an escape byte is rejected', plan.runCommand === null);
}
{
  const tooLong = { cwd: 'D:\\Work', claudeCwd: undefined, claudeSessionId: undefined, shellId: 'cmd', port: 5173, lastCommand: 'x'.repeat(501) };
  const plan = wakePlan(tooLong);
  check('a lastCommand over 500 characters is rejected', plan.runCommand === null);
}
{
  const exactly500 = { cwd: 'D:\\Work', claudeCwd: undefined, claudeSessionId: undefined, shellId: 'cmd', port: 5173, lastCommand: 'x'.repeat(500) };
  const plan = wakePlan(exactly500);
  check('a lastCommand of exactly 500 characters is accepted', plan.runCommand === 'x'.repeat(500));
}
{
  // A malformed tab that somehow carries both a valid session id and a port
  // with a runnable command: the server behaviour wins, resumeSessionId stays
  // null. A chat never re-runs a shell command.
  const weird = {
    cwd: 'D:\\Work', claudeCwd: undefined,
    claudeSessionId: '3d71b0f2-26cb-4ad3-8371-6504ab2e37e2', shellId: 'cmd',
    port: 5173, lastCommand: 'npm start',
  };
  const plan = wakePlan(weird);
  check('a runnable command always forces resumeSessionId to null, even with a valid session id present',
    plan.runCommand === 'npm start' && plan.resumeSessionId === null, show(plan));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);

// Unit tests for sleepWake.ts. Run directly on Node 24+ (strips types):
//   node src/renderer/sleepWake.test.ts
// Exits 0 if all pass, 1 on any failure.

import { isDeepStrictEqual } from 'util';
import {
  sleepTab, wakeTab, restoredTab, sleepAllForShutdown, asleepLabel, asleepSinceText, wakePlan,
  startsClaudeCode, reattachedTab, restoreWithLive, screenAfterReload, createOutcome, takenTabIds,
} from './sleepWake.ts';
import { maxNumericId } from './history.ts';
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
{
  // Claude Code's live status (plan-02, Fix 5): a sleeping thread has no running Claude.
  const tab = chatTab({ recordStatus: 'busy' });
  const asleep = sleepTab(tab, NOW);
  check('recordStatus is cleared on sleep', !('recordStatus' in asleep));
  check('and the session id stays (Decision 3)', asleep.claudeSessionId === tab.claudeSessionId);
}
{
  // What the shell was doing (plan-02, Fix 8): a woken thread starts from no marks.
  const tab = chatTab({ atPrompt: false, hasChildren: true });
  const asleep = sleepTab(tab, NOW);
  check('atPrompt is cleared on sleep', !('atPrompt' in asleep));
  check('hasChildren is cleared on sleep', !('hasChildren' in asleep));
}
{
  // What a live Claude left running (plan-02, Fix 7): sleep kills it.
  const asleep = sleepTab(chatTab({ backgroundTasks: true }), NOW);
  check('backgroundTasks is cleared on sleep', !('backgroundTasks' in asleep));
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
  // The pane passes wakePlan's runCommand, so the line says only what Wake will do.
  const asleepServer = (lastCommand: string) => ({
    cwd: 'D:\\Work', claudeCwd: undefined, claudeSessionId: undefined, shellId: 'cmd', port: 3000, lastCommand,
  });
  check('a Server whose last command started Claude: no "runs claude", since Wake opens a fresh prompt',
    asleepSinceText('Server', NOW - 60_000, NOW, wakePlan(asleepServer('claude')).runCommand ?? undefined)
      === 'Server asleep since 1m ago');
  check('a Server whose last command is a real server command still names it',
    asleepSinceText('Server', NOW - 60_000, NOW, wakePlan(asleepServer('npm run dev')).runCommand ?? undefined)
      === 'Server asleep since 1m ago · runs npm run dev');
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
console.log('\nsleepWake: wakePlan, a session id wins over the server rule (plan-02, Fix 9)\n');
{
  // A chat that was exited and then ran a server in the same shell: it holds both a
  // valid session id and a port with a runnable command. It stays a chat (Decision 3),
  // so it resumes and the command is not re-run.
  const both = {
    cwd: 'D:\\Work', claudeCwd: undefined,
    claudeSessionId: '3d71b0f2-26cb-4ad3-8371-6504ab2e37e2', shellId: 'cmd',
    port: 5173, lastCommand: 'npm start',
  };
  const plan = wakePlan(both);
  check('a session id plus a port and a command: resumes the chat',
    plan.resumeSessionId === both.claudeSessionId, show(plan));
  check('and does not re-run the command', plan.runCommand === null, show(plan));
}
{
  const server = {
    cwd: 'D:\\Work', claudeCwd: undefined, claudeSessionId: undefined, shellId: 'cmd',
    port: 5173, lastCommand: 'npm start',
  };
  const plan = wakePlan(server);
  check('no session id plus a port and a command: re-runs the command, resumes nothing',
    plan.runCommand === 'npm start' && plan.resumeSessionId === null, show(plan));
}
{
  // An invalid id is no id: the server rule applies.
  const bad = {
    cwd: 'D:\\Work', claudeCwd: undefined, claudeSessionId: 'not-a-uuid', shellId: 'cmd',
    port: 5173, lastCommand: 'npm start',
  };
  const plan = wakePlan(bad);
  check('an invalid session id plus a port and a command: re-runs the command',
    plan.runCommand === 'npm start' && plan.resumeSessionId === null, show(plan));
}
{
  // A Claude that started a dev server itself: the last command entered at the
  // prompt is `claude` and the tree listens on a port. It used to wake by running
  // a fresh `claude`; it resumes its session.
  const claudeServer = {
    cwd: 'D:\\Work', claudeCwd: 'D:\\Work\\app',
    claudeSessionId: '3d71b0f2-26cb-4ad3-8371-6504ab2e37e2', shellId: 'cmd',
    port: 3000, lastCommand: 'claude',
  };
  const plan = wakePlan(claudeServer);
  check('a Claude that started a server itself resumes rather than running `claude` fresh',
    plan.resumeSessionId === claudeServer.claudeSessionId && plan.runCommand === null, show(plan));
  check('and wakes in the folder Claude was in', plan.cwd === 'D:\\Work\\app');
}

console.log('\nsleepWake: wakePlan, a command that starts Claude is never a server command\n');
{
  // No usable id (no prompt sent yet, or the hook and the record never gave one),
  // a port in the tree from something Claude started, and `claude` as the last
  // command: running it again would start a fresh session, not a server.
  const base = { cwd: 'D:\\Work', claudeCwd: undefined, claudeSessionId: undefined, shellId: 'cmd', port: 3000 };
  for (const cmd of ['claude', '  claude  ', 'Claude', 'CLAUDE.EXE', 'claude.exe', 'claude.cmd', 'claude --resume abc', 'claude.exe --model haiku']) {
    const plan = wakePlan({ ...base, lastCommand: cmd });
    check(`no id, a port and ${JSON.stringify(cmd)}: no runCommand and no resume`,
      plan.runCommand === null && plan.resumeSessionId === null, show(plan));
  }
  check('a command that only starts with the letters claude still re-runs',
    wakePlan({ ...base, lastCommand: 'claudette serve' }).runCommand === 'claudette serve');
  check('a command that names claude later on still re-runs',
    wakePlan({ ...base, lastCommand: 'npx claude-server' }).runCommand === 'npx claude-server');
  check('npm run dev with a port still re-runs',
    wakePlan({ ...base, lastCommand: 'npm run dev' }).runCommand === 'npm run dev');

  // Other ways to start Claude Code: npx, a path to the program, the npm package.
  const claudeForms = [
    'npx claude',
    'npx @anthropic-ai/claude-code',
    'npx @anthropic-ai/claude-code@latest --model haiku',
    'npx -y @anthropic-ai/claude-code',
    'NPX Claude',
    '@anthropic-ai/claude-code',
    'C:\\Users\\me\\.local\\bin\\claude.exe',
    'C:\\Users\\me\\.local\\bin\\claude.exe --resume abc',
    '"C:\\Program Files\\Claude\\claude.exe" --model haiku',
    "'C:\\tools\\claude.cmd'",
    'C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd',
    '/c/Users/me/.local/bin/claude.exe',
    '~/.local/bin/claude',
  ];
  for (const cmd of claudeForms) {
    const plan = wakePlan({ ...base, lastCommand: cmd });
    check(`no id, a port and ${JSON.stringify(cmd)}: no runCommand and no resume`,
      plan.runCommand === null && plan.resumeSessionId === null, show(plan));
  }
  for (const cmd of ['claudette serve', 'npx claude-server', 'npx vite', '"C:\\tools\\claude-server.exe" --port 3000', 'C:\\claude\\server.exe']) {
    check(`${JSON.stringify(cmd)} is a server command and re-runs`,
      wakePlan({ ...base, lastCommand: cmd }).runCommand === cmd);
  }
}
{
  check('startsClaudeCode: a bare npx is not Claude', !startsClaudeCode('npx'));
  check('startsClaudeCode: npx with only flags is not Claude', !startsClaudeCode('npx -y'));
  check('startsClaudeCode: an empty line is not Claude', !startsClaudeCode('   '));
  check('startsClaudeCode: an unclosed quote is read as a plain word', !startsClaudeCode('"claude-server --x'));
}

console.log('\nsleepWake: a reload keeps the threads whose shell is still running (AFT-33)\n');
{
  // What the unload flush wrote: every thread stamped asleep (sleepAllForShutdown).
  const flushed = sleepAllForShutdown([
    chatTab({ id: 'tab-1', port: 5173, notification: 'working' }),
    chatTab({ id: 'tab-2', claudeSessionId: undefined, claudeCwd: undefined }),
    chatTab({ id: 'tab-3', asleep: true, sleptAt: NOW - 86_400_000 }),
  ], NOW) as SavedTab[];

  const back = reattachedTab(flushed[0], { tabId: 'tab-1', port: 5173 });
  check('a thread with a live shell comes back awake', back.asleep === false, show(back));
  check('with no sleptAt (it never slept)', !('sleptAt' in back), show(back));
  check('with no notification and no wokeAt', !('notification' in back) && !('wokeAt' in back), show(back));
  check('keeping its session id, folder, name and font size',
    back.claudeSessionId === flushed[0].claudeSessionId && back.claudeCwd === flushed[0].claudeCwd
    && back.claudeTitle === 'Fix the spinner' && back.fontSize === 15, show(back));
  check('the port main sees now wins', reattachedTab(flushed[0], { tabId: 'tab-1', port: 3000 }).port === 3000);
  check('a port main says is gone is dropped', !('port' in reattachedTab(flushed[0], { tabId: 'tab-1', port: null })));
  check('the saved port stands while main has not looked', reattachedTab(flushed[0], { tabId: 'tab-1' }).port === 5173);
  check('the saved record is not changed', flushed[0].asleep === true && flushed[0].sleptAt === NOW);

  const r = restoreWithLive(flushed, [{ tabId: 'tab-1', port: 5173 }, { tabId: 'tab-2', port: null }], NOW + 5);
  check('both live threads are re-attached', show(r.reattached) === '["tab-1","tab-2"]', show(r.reattached));
  check('they come back awake', r.tabs[0].asleep === false && r.tabs[1].asleep === false, show(r.tabs));
  check('a thread with no live shell comes back asleep, as on a launch',
    isDeepStrictEqual(r.tabs[2], restoredTab(flushed[2], NOW + 5)), show(r.tabs[2]));
  check('and keeps when it went to sleep', r.tabs[2].sleptAt === NOW - 86_400_000, show(r.tabs[2]));
  check('the order of the tabs is kept', show(r.tabs.map(t => t.id)) === '["tab-1","tab-2","tab-3"]');
  check('no orphans when every live shell has a tab', r.orphans.length === 0, show(r.orphans));

  const launch = restoreWithLive(flushed, [], NOW + 5);
  check('a launch (no live shells) brings every thread back asleep, unchanged',
    launch.tabs.every(t => t.asleep) && launch.reattached.length === 0
    && isDeepStrictEqual(launch.tabs, flushed.map(t => restoredTab(t, NOW + 5))), show(launch));

  const orphan = restoreWithLive(flushed, [{ tabId: 'tab-1' }, { tabId: 'tab-9' }], NOW + 5);
  check('a live shell no saved tab names is an orphan', show(orphan.orphans) === '["tab-9"]', show(orphan.orphans));
  check('and does not make a tab of its own', orphan.tabs.length === 3, show(orphan.tabs.map(t => t.id)));
}

console.log('\nsleepWake: a re-attached thread attaches only, and keeps what it showed (AFT-33 review 1)\n');
{
  const flushed = sleepAllForShutdown([chatTab({ id: 'tab-1', notification: 'attention', backgroundTasks: true })], NOW) as SavedTab[];
  const back = reattachedTab(flushed[0], { tabId: 'tab-1' });
  check('a re-attached thread is marked to attach only', back.reattach === true, show(back));
  check('with nothing remembered it shows no state', !('notification' in back) && !('backgroundTasks' in back), show(back));

  const waiting = reattachedTab(flushed[0], { tabId: 'tab-1', notification: 'attention' });
  check('a chat that was waiting for Aryan still shows needs-you', waiting.notification === 'attention', show(waiting));
  for (const n of ['done', 'background', 'compacting', 'working'] as const) {
    check(`${n} comes back too`, reattachedTab(flushed[0], { tabId: 'tab-1', notification: n }).notification === n);
  }
  check('background work still counts for the restart window',
    reattachedTab(flushed[0], { tabId: 'tab-1', backgroundTasks: true }).backgroundTasks === true);
  check('backgroundTasks false is left out, as everywhere',
    !('backgroundTasks' in reattachedTab(flushed[0], { tabId: 'tab-1', backgroundTasks: false })));
  check('a state name it does not know is dropped',
    !('notification' in reattachedTab(flushed[0], { tabId: 'tab-1', notification: 'shouting' as 'done' })));
  const r = restoreWithLive(flushed, [{ tabId: 'tab-1', notification: 'attention', backgroundTasks: true }], NOW);
  check('restoreWithLive carries them through', r.tabs[0].notification === 'attention' && r.tabs[0].backgroundTasks === true, show(r.tabs[0]));
  check('a thread restored asleep has no attach mark', !('reattach' in restoreWithLive(flushed, [], NOW).tabs[0]));

  check('sleep clears the attach mark', !('reattach' in sleepTab(back, NOW)));
  check('wake clears the attach mark', !('reattach' in wakeTab(back, NOW)));
}
{
  // What the terminal does with main's answer to pty:create.
  check('re-attached and main held the shell: attached, nothing typed',
    show(createOutcome(true, { attached: true })) === '{"kind":"attached","mayType":false}');
  check('re-attached and the shell ended meanwhile: gone, nothing typed, the thread sleeps',
    show(createOutcome(true, { attached: false, gone: true })) === '{"kind":"gone","mayType":false}');
  check('re-attached and main spawned anyway (never asked to): nothing typed',
    show(createOutcome(true, { attached: false })) === '{"kind":"spawned","mayType":false}');
  check('a wake that got a fresh shell: the resume or the command may be typed',
    show(createOutcome(false, { attached: false })) === '{"kind":"spawned","mayType":true}');
  check('a wake that found a shell main still held: nothing typed into it',
    show(createOutcome(false, { attached: true })) === '{"kind":"attached","mayType":false}');
}
{
  // A live shell no saved thread names keeps its id taken.
  const saved = {
    tabs: [{ id: 'tab-3' }, { id: 'tab-5' }],
    groups: [{ history: [{ id: 'tab-7' }] }, {}],
  };
  check('saved tabs, history and live shells are all taken',
    show(takenTabIds(saved, [{ tabId: 'tab-5' }, { tabId: 'tab-9' }])) === '["tab-3","tab-5","tab-7","tab-5","tab-9"]');
  check('the next new thread is numbered after the orphan, not given its id',
    maxNumericId('tab-', takenTabIds(saved, [{ tabId: 'tab-9' }])) === 9);
  check('with no live shells it is the saved tabs and history, as on a launch',
    maxNumericId('tab-', takenTabIds(saved, [])) === 7);
}

console.log('\nsleepWake: a reloaded page opens where it was (AFT-33)\n');
{
  const groups = ['group-1', 'group-2'];
  const tabs = ['tab-1', 'tab-2'];
  check('nothing remembered (a launch): null, the caller opens Home', screenAfterReload(null, groups, tabs) === null);
  check('undefined counts as nothing remembered', screenAfterReload(undefined, groups, tabs) === null);
  check('the workspace with its active thread',
    show(screenAfterReload({ screen: 'workspace', activeTabId: 'tab-2' }, groups, tabs)) === '{"screen":"workspace","activeTabId":"tab-2"}');
  check('Home stays Home', show(screenAfterReload({ screen: 'home' }, groups, tabs)) === '{"screen":"home"}');
  check('a project page whose project is there',
    show(screenAfterReload({ screen: 'project', projectId: 'group-2', activeTabId: 'tab-1' }, groups, tabs))
      === '{"screen":"project","projectId":"group-2","activeTabId":"tab-1"}');
  check('a project page whose project is gone opens Home',
    show(screenAfterReload({ screen: 'project', projectId: 'group-9' }, groups, tabs)) === '{"screen":"home"}');
  check('a project page with no project id opens Home',
    show(screenAfterReload({ screen: 'project' }, groups, tabs)) === '{"screen":"home"}');
  check('an active thread that is gone is left out',
    show(screenAfterReload({ screen: 'workspace', activeTabId: 'tab-7' }, groups, tabs)) === '{"screen":"workspace"}');
  check('a screen name it does not know: null',
    screenAfterReload({ screen: 'board' as 'home' }, groups, tabs) === null);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);

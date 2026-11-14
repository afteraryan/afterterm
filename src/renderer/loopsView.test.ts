// Unit tests for loopsView.ts (Open chat, the filter, project looks). Run on Node 24+:
//   node src/renderer/loopsView.test.ts

import { createLoop, closeLoop, archiveLoop, deleteLoop, emptyLoopsFile, DAY_MS, type Actor } from '../loops.ts';
import {
  filterIsSet, loopProjects, loopsContextFrom, NO_FILTER, openChatPlan, projectLook, visibleLoops, GENERAL_COLOUR,
} from './loopsView.ts';
import type { Group, Tab } from './components/TabBar/types.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}

const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '22222222-2222-4222-8222-222222222222';
const group = (id: string, label: string, extra: Partial<Group> = {}): Group => ({
  id, label, color: 'blue', collapsed: false, pinned: false, archived: false, lastActiveAt: 0, history: [], ...extra,
});
const tab = (id: string, extra: Partial<Tab> = {}): Tab => ({ id, title: id, lastActiveAt: 0, asleep: false, ...extra });
const user: Actor = { kind: 'user' };
const agent = (chat: object): Actor => ({ kind: 'agent', chat });
const T = new Date(2026, 10, 10, 12).getTime();

console.log('\nloopsView: Open chat\n');
{
  const f = emptyLoopsFile();
  const groups = [group('g1', 'afterterm', { cwd: 'D:\\at', history: [{ id: 'tab-9', title: 'old chat', kind: 'chat', closedAt: 1, sessionId: S2, cwd: 'D:\\at\\wt' }] })];
  const awake = createLoop(f, { title: 'a', project: 'g1' }, T, agent({ threadId: 'tab-1', sessionId: S1 }));
  check('its thread is open: show it', JSON.stringify(openChatPlan(awake, [tab('tab-1', { claudeSessionId: S1 })], groups)) === '{"kind":"tab","tabId":"tab-1","wake":false}');
  check('asleep: show and wake it', (openChatPlan(awake, [tab('tab-1', { claudeSessionId: S1, asleep: true })], groups) as { wake: boolean }).wake === true);
  const moved = openChatPlan(awake, [tab('tab-1', { claudeSessionId: S2 }), tab('tab-5', { claudeSessionId: S1 })], groups);
  check('its thread id now holds another chat: the session wins', moved.kind === 'tab' && moved.tabId === 'tab-5');
  const closed = createLoop(f, { title: 'b', project: 'g1' }, T, agent({ threadId: 'tab-9', sessionId: S2 }));
  check('closed into history: resume from there', JSON.stringify(openChatPlan(closed, [], groups)) === '{"kind":"history","groupId":"g1","entryId":"tab-9"}');
  const gone = createLoop(f, { title: 'c', project: 'g1' }, T, agent({ threadId: 'tab-77', sessionId: S1, cwd: 'D:\\at\\wt2' }));
  const r = openChatPlan(gone, [], groups);
  check('in neither: a new thread resumes the session in its folder', r.kind === 'resume' && r.groupId === 'g1' && r.entry.sessionId === S1 && r.entry.cwd === 'D:\\at\\wt2' && r.entry.kind === 'chat');
  const general = createLoop(f, { title: 'd', project: 'deleted-project' }, T, agent({ sessionId: S1 }));
  check('a project that is gone: General', (openChatPlan(general, [], groups) as { groupId: string | null }).groupId === null);
  const byHand = createLoop(f, { title: 'e' }, T, user);
  check('a loop with no chat: nothing to open', openChatPlan(byHand, [], groups).kind === 'none');
  const noSession = createLoop(f, { title: 'f' }, T, agent({ threadId: 'tab-404', cwd: 'D:\\x' }));
  check('a chat that never had a session and is gone: nothing', openChatPlan(noSession, [], groups).kind === 'none');
  const bad = createLoop(f, { title: 'g' }, T, agent({ sessionId: 'not-a-uuid' }));
  check('a session id that is not a uuid is never resumed', openChatPlan(bad, [], groups).kind === 'none');
}

console.log('\nloopsView: the filter\n');
{
  const f = emptyLoopsFile();
  const a = createLoop(f, { title: 'open bug', label: 'bug', project: 'g1' }, T, user);
  const b = createLoop(f, { title: 'old', project: 'g2' }, T - 10 * DAY_MS, user);
  const c = createLoop(f, { title: 'done', project: null }, T - DAY_MS, user);
  closeLoop(f, c.id, T, user);
  const d = createLoop(f, { title: 'shelved' }, T, user);
  archiveLoop(f, d.id, T, user);
  const e = createLoop(f, { title: 'gone' }, T, user);
  deleteLoop(f, e.id, T, user);
  const names = (fl: Partial<typeof NO_FILTER>) => visibleLoops(f.loops, { ...NO_FILTER, ...fl }, T).map((l) => l.title).join();
  check('all: everything listed, most recent first', names({}) === 'open bug,done,old', names({}));
  check('rotting', names({ status: 'rotting' }) === 'old');
  check('closed', names({ status: 'closed' }) === 'done');
  check('open', names({ status: 'open' }) === 'open bug');
  check('archived shows only the archived', names({ status: 'archived' }) === 'shelved');
  check('label', names({ label: 'bug' }) === 'open bug');
  check('project, General is null', names({ project: null }) === 'done');
  check('filterIsSet', !filterIsSet(NO_FILTER) && filterIsSet({ ...NO_FILTER, label: 'idea' }));
  const groups = [group('g1', 'afterterm'), group('g2', 'minimi')];
  check('the dropdown lists projects with loops, General last', loopProjects(f.loops, groups).map((p) => p.name).join() === 'afterterm,minimi,General');
  check('a project\'s colour, General grey', projectLook('g1', groups).name === 'afterterm' && projectLook(null, groups).color === GENERAL_COLOUR && projectLook('zz', groups).name === 'General');
  check('a, b are used', !!a && !!b);
}

console.log('\nloopsView: the context for main\n');
{
  const ctx = loopsContextFrom([tab('t1', { groupId: 'g1', claudeSessionId: S1, claudeCwd: 'D:\\wt', cwd: 'D:\\x' }), tab('t2')], [group('g1', 'afterterm', { cwd: 'D:\\at' })]);
  check('projects with folders', JSON.stringify(ctx.projects) === '[{"id":"g1","name":"afterterm","folder":"D:\\\\at"}]');
  check('threads with project, session and the chat\'s folder', ctx.threads[0].project === 'g1' && ctx.threads[0].sessionId === S1 && ctx.threads[0].cwd === 'D:\\wt' && ctx.threads[1].project === null);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

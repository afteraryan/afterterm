// Unit tests for the loop rules (design-07). Run directly on Node 24+:
//   node src/loops.test.ts
// Exits 0 if all pass, 1 on any failure. Every rule takes `now`, so the fake
// clock here is just numbers.

import {
  ageText, archiveLoop, closeLoop, createLoop, deleteLoop, editLoop, effectiveActivity, emptyLoopsFile,
  isPurgeable, localDay, loopCounts, loopStatus, LoopError, orderedSubLoops, orderedTopLoops, parseLoopsFile,
  pingLoop, purgeDeleted, recentForCard, reopenLoop, restoreLoop, subLoopFraction, DAY_MS,
  type Actor, type LoopsFile,
} from './loops.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}
function throws(fn: () => unknown, code: string): boolean {
  try { fn(); return false; } catch (e) { return e instanceof LoopError && e.code === code; }
}

const user: Actor = { kind: 'user' };
const agentA: Actor = { kind: 'agent', chat: { threadId: 't1', sessionId: 's-a', cwd: 'C:\\p' } };
const agentB: Actor = { kind: 'agent', chat: { threadId: 't2', sessionId: 's-b', cwd: 'C:\\p\\wt' } };

// Monday 2026-11-02 10:00 local time.
const MON = new Date(2026, 10, 2, 10, 0, 0).getTime();
const at = (days: number, hours = 0) => new Date(2026, 10, 2 + days, 10 + hours, 0, 0).getTime();

console.log('\nloops: rotting\n');
{
  const f = emptyLoopsFile();
  const l = createLoop(f, { title: 'A' }, MON, agentA);
  check('open on the day it starts', loopStatus(l, f.loops, MON) === 'open');
  check('open 4 calendar days later (Friday)', loopStatus(l, f.loops, at(4, 13)) === 'open');
  check('rotting on the 5th calendar day (Saturday morning)', loopStatus(l, f.loops, new Date(2026, 10, 7, 0, 5).getTime()) === 'rotting');
  check('calendar days, not 24h blocks: Mon 23:59 to Sat 00:01 rots', (() => {
    const g = emptyLoopsFile();
    const m = createLoop(g, { title: 'x' }, new Date(2026, 10, 2, 23, 59).getTime(), user);
    return loopStatus(m, g.loops, new Date(2026, 10, 7, 0, 1).getTime()) === 'rotting';
  })());
  const idea = createLoop(f, { title: 'I', label: 'idea' }, MON, user);
  check('an idea never rots', loopStatus(idea, f.loops, at(60)) === 'open');
  const c = createLoop(f, { title: 'C' }, MON, user);
  closeLoop(f, c.id, MON, user);
  check('a closed loop never rots', loopStatus(c, f.loops, at(60)) === 'closed');
  pingLoop(f, l.id, at(6), agentA);
  check('a ping makes a rotting loop open again', loopStatus(l, f.loops, at(6)) === 'open');
  check('rotting again 5 days after the ping', loopStatus(l, f.loops, at(11)) === 'rotting');
  editLoop(f, l.id, { note: 'x' }, at(12), user);
  check('a note by Aryan counts too', loopStatus(l, f.loops, at(12)) === 'open' && loopStatus(l, f.loops, at(16)) === 'open');
  check('...and the loop rots 5 days after that note', loopStatus(l, f.loops, at(17)) === 'rotting');
}

console.log('\nloops: a sub-loop\'s activity counts for its parent\n');
{
  const f = emptyLoopsFile();
  const p = createLoop(f, { title: 'Parent', project: 'g1' }, MON, agentA);
  const s = createLoop(f, { title: 'Sub', parent: p.id, project: 'other' }, MON, agentA);
  check('a sub-loop takes its parent\'s project', s.project === 'g1');
  check('both rot on day 5', loopStatus(p, f.loops, at(5)) === 'rotting' && loopStatus(s, f.loops, at(5)) === 'rotting');
  editLoop(f, s.id, { note: 'progress' }, at(5), agentB);
  check('the parent is open again after its sub-loop\'s note', loopStatus(p, f.loops, at(5)) === 'open');
  check('effective activity is the sub-loop\'s time', effectiveActivity(p, f.loops) === at(5));
  check('the parent\'s own activityAt is unchanged', p.activityAt === MON);
  deleteLoop(f, s.id, at(6), user);
  check('a deleted sub-loop no longer counts', effectiveActivity(p, f.loops) === MON);
}

console.log('\nloops: order and counts\n');
{
  const f = emptyLoopsFile();
  const a = createLoop(f, { title: 'A' }, at(0), user);
  const b = createLoop(f, { title: 'B' }, at(1), user);
  const c = createLoop(f, { title: 'C' }, at(2), user);
  check('most recent activity first', orderedTopLoops(f.loops).map((l) => l.title).join() === 'C,B,A');
  pingLoop(f, a.id, at(3), agentA);
  check('a ping brings a loop to the top', orderedTopLoops(f.loops)[0].id === a.id);
  closeLoop(f, b.id, at(4), user);
  check('closing keeps the loop\'s place', orderedTopLoops(f.loops).map((l) => l.title).join() === 'A,C,B');
  const subs = createLoop(f, { title: 'C1', parent: c.id }, at(4), user);
  check('a sub-loop is not a top-level row', !orderedTopLoops(f.loops).some((l) => l.id === subs.id));
  check('a sub-loop\'s activity lifts its parent', orderedTopLoops(f.loops)[0].id === c.id);
  const counts = loopCounts(f.loops, at(4));
  check('counts: 2 open, 0 rotting, 1 closed, 2 remaining', counts.open === 2 && counts.rotting === 0 && counts.closed === 1 && counts.remaining === 2, JSON.stringify(counts));
  const later = loopCounts(f.loops, at(9));
  check('counts 5 days on: A and C rotting, remaining still 2', later.rotting === 2 && later.remaining === 2 && later.open === 0, JSON.stringify(later));
  archiveLoop(f, a.id, at(5), user);
  check('an archived loop leaves the counts and the list', loopCounts(f.loops, at(5)).total === 2 && !orderedTopLoops(f.loops).some((l) => l.id === a.id));
  archiveLoop(f, a.id, at(5), user, false);
  check('restoring from the archive brings it back', orderedTopLoops(f.loops).some((l) => l.id === a.id));
}

console.log('\nloops: the workspace card\n');
{
  const f = emptyLoopsFile();
  for (let i = 0; i < 8; i++) createLoop(f, { title: `L${i}` }, at(0, i), user);
  createLoop(f, { title: 'old' }, at(-10), user);
  const now = at(0, 9);
  const card = recentForCard(f.loops, now);
  check('5 rows', card.length === 5);
  check('most recent first', card[0].title === 'L7');
  check('never a rotting loop', recentForCard(f.loops, at(20)).length === 0);
  closeLoop(f, card[0].id, now, user);
  check('a closed loop stays on the card', recentForCard(f.loops, now)[0].title === 'L7');
}

console.log('\nloops: the remembered chat\n');
{
  const f = emptyLoopsFile();
  const l = createLoop(f, { title: 'A' }, MON, agentA);
  check('the creating chat is remembered', l.chat?.sessionId === 's-a');
  editLoop(f, l.id, { note: 'by Aryan' }, at(1), user);
  check('Aryan\'s edit keeps it', l.chat?.sessionId === 's-a');
  editLoop(f, l.id, { note: 'by B' }, at(1), agentB);
  check('another agent\'s edit replaces it', l.chat?.sessionId === 's-b' && l.chat.cwd === 'C:\\p\\wt');
  pingLoop(f, l.id, at(2), agentA);
  check('a ping from a chat replaces it too', l.chat?.sessionId === 's-a');
  const u = createLoop(f, { title: 'U' }, MON, user);
  check('a loop Aryan started has no chat', u.chat === null);
}

console.log('\nloops: ping once a day\n');
{
  const f = emptyLoopsFile();
  const l = createLoop(f, { title: 'A' }, MON, agentA);
  check('first ping counts', pingLoop(f, l.id, at(0, 1), agentA).pinged);
  check('a second ping inside a day changes nothing', !pingLoop(f, l.id, at(0, 5), agentA).pinged && l.activityAt === at(0, 1));
  check('a ping after more than a day counts', pingLoop(f, l.id, at(1, 2), agentA).pinged && l.activityAt === at(1, 2));
}

console.log('\nloops: the parent-close rule\n');
{
  const f = emptyLoopsFile();
  const p = createLoop(f, { title: 'P' }, MON, user);
  const s1 = createLoop(f, { title: 'S1', parent: p.id }, MON, user);
  const s2 = createLoop(f, { title: 'S2', parent: p.id }, MON, user);
  check('a parent with open sub-loops refuses to close', throws(() => closeLoop(f, p.id, at(1), agentA), 'open-sub-loops'));
  check('...and stays open', p.status === 'open');
  closeLoop(f, s1.id, at(1), agentA);
  check('1/2 after one sub-loop closes', JSON.stringify(subLoopFraction(p.id, f.loops)) === '{"closed":1,"total":2}');
  const closed = closeLoop(f, p.id, at(2), user, { withSubLoops: true });
  check('closing with its sub-loops closes both', closed.length === 2 && s2.status === 'closed' && p.status === 'closed');
  reopenLoop(f, s2.id, at(3), user);
  check('reopening a sub-loop reopens its closed parent', p.status === 'open' && s2.status === 'open');
}

console.log('\nloops: nesting is one level\n');
{
  const f = emptyLoopsFile();
  const p = createLoop(f, { title: 'P', project: 'g1' }, MON, user);
  const s = createLoop(f, { title: 'S', parent: p.id }, MON, user);
  check('no sub-loop under a sub-loop', throws(() => createLoop(f, { title: 'x', parent: s.id }, MON, user), 'bad-parent'));
  check('a parent cannot become a sub-loop', throws(() => editLoop(f, p.id, { parent: createLoop(f, { title: 'Q' }, MON, user).id }, MON, user), 'bad-parent'));
  check('a sub-loop\'s project cannot be set on its own', throws(() => editLoop(f, s.id, { project: 'g2' }, MON, user), 'bad-input'));
  editLoop(f, p.id, { project: 'g2' }, at(1), user);
  check('moving a parent moves its sub-loops', s.project === 'g2');
  editLoop(f, s.id, { parent: null }, at(1), user);
  check('a sub-loop can be taken out to the top level', s.parent === null && orderedSubLoops(p.id, f.loops).length === 0);
}

console.log('\nloops: delete and the 30 days\n');
{
  const f = emptyLoopsFile();
  const p = createLoop(f, { title: 'P' }, MON, user);
  createLoop(f, { title: 'S', parent: p.id }, MON, user);
  const gone = deleteLoop(f, p.id, at(1), agentA);
  check('deleting a parent deletes its sub-loops', gone.length === 2);
  check('a deleted loop is not found for edits', throws(() => editLoop(f, p.id, { note: 'x' }, at(1), user), 'not-found'));
  check('kept for 29 days', !isPurgeable(p, at(30)));
  check('gone after 30', isPurgeable(p, at(31)));
  restoreLoop(f, p.id);
  check('restore brings both back', f.loops.every((l) => !l.deletedAt));
  deleteLoop(f, p.id, at(1), user);
  check('purge removes them after 30 days', purgeDeleted(f, at(32)) === 2 && f.loops.length === 0);
}

console.log('\nloops: reading a file\n');
{
  const f: LoopsFile = parseLoopsFile({
    nextId: 2,
    loops: [
      { id: '5', title: 'ok', label: 'bug', status: 'closed', createdAt: 10, activityAt: 20, chat: { sessionId: 's' } },
      { id: '6', title: '', createdAt: 1 },
      { id: '7', title: 'orphan', parent: '99', createdAt: 1 },
      { id: '8', title: 'sub', parent: '5', project: 'nope', createdAt: 1 },
      { id: '9', title: 'subsub', parent: '8', createdAt: 1 },
      { id: '5', title: 'dupe', createdAt: 1 },
      'junk',
    ],
  });
  check('valid loops kept, empty title and duplicate dropped', f.loops.map((l) => l.id).join() === '5,7,8,9');
  check('nextId moves past the highest id', f.nextId === 10);
  check('an orphan becomes top-level', f.loops.find((l) => l.id === '7')?.parent === null);
  check('a sub-sub-loop becomes top-level', f.loops.find((l) => l.id === '9')?.parent === null);
  check('a sub-loop takes its parent\'s project', f.loops.find((l) => l.id === '8')?.project === null);
  check('label and status kept', f.loops[0].label === 'bug' && f.loops[0].status === 'closed');
  check('garbage in, empty file out', parseLoopsFile('nope').loops.length === 0 && parseLoopsFile(null).nextId === 1);
}

console.log('\nloops: small things\n');
{
  check('localDay is the same all day', localDay(new Date(2026, 0, 1, 0, 1).getTime()) === localDay(new Date(2026, 0, 1, 23, 59).getTime()));
  check('localDay steps by one', localDay(new Date(2026, 0, 2).getTime()) - localDay(new Date(2026, 0, 1).getTime()) === 1);
  check('across a DST change, still one day a day', localDay(new Date(2026, 2, 30).getTime()) - localDay(new Date(2026, 2, 28).getTime()) === 2);
  const n = MON;
  check('ageText', [ageText(n, n), ageText(n - 5 * 60e3, n), ageText(n - 3 * 3600e3, n), ageText(n - 2 * DAY_MS, n), ageText(n - 21 * DAY_MS, n), ageText(n - 120 * DAY_MS, n)].join() === 'now,5m,3h,2d,3w,4mo');
  check('an empty title is refused', throws(() => createLoop(emptyLoopsFile(), { title: '  ' }, n, user), 'bad-input'));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

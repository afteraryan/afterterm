// Unit tests for `afterterm loops` (the pure part, src/loops-cli.ts). Run on Node 24+:
//   node src/loops-cli.test.ts

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LoopsStore } from './loops-store.ts';
import {
  callerChat, callerProject, chatStartBrief, parseArgs, projectForFolder, resolveProject, runLoopsCommand,
  type CallerEnv, type LoopsContext,
} from './loops-cli.ts';
import { DAY_MS } from './loops.ts';
import { reconcileAftertermSkill, SKILL_MARKER, SKILL_TEXT } from './loops-skill.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}

const ctx: LoopsContext = {
  projects: [
    { id: 'g-at', name: 'afterterm', folder: 'D:\\Work\\afterterm' },
    { id: 'g-wt', name: 'afterterm worktree', folder: 'D:\\Work\\afterterm\\.claude\\worktrees\\x' },
    { id: 'g-mm', name: 'minimi', folder: 'D:/Work/minimi/' },
  ],
  threads: [
    { id: 't1', project: 'g-at', sessionId: 'sess-1', cwd: 'D:\\Work\\afterterm' },
    { id: 't2', project: null, cwd: 'C:\\Users\\x' },
  ],
};
const inT1: CallerEnv = { thread: 't1', session: 'sess-1', cwd: 'D:\\Work\\afterterm\\src' };

console.log('\nloops-cli: arguments\n');
{
  const a = parseArgs(['new', 'Fix', 'the rail', '--label', 'bug', '--note=half done', '--json', '--', '--not-a-flag']);
  check('positionals', a.pos.join('|') === 'new|Fix|the rail|--not-a-flag');
  check('--flag value', a.flags.label === 'bug');
  check('--flag=value', a.flags.note === 'half done');
  check('boolean flag', a.flags.json === true);
  check('a value flag at the end is true', parseArgs(['--note']).flags.note === true);
}

console.log('\nloops-cli: projects\n');
{
  check('the deepest project folder wins', projectForFolder(ctx, 'D:\\Work\\afterterm\\.claude\\worktrees\\x\\src') === 'g-wt');
  check('forward slashes and case do not matter', projectForFolder(ctx, 'd:\\work\\MINIMI\\app') === 'g-mm');
  check('a folder that only starts the same is not inside', projectForFolder(ctx, 'D:\\Work\\afterterm-old') === null);
  check('a thread\'s project wins over its folder', callerProject(ctx, { thread: 't1', cwd: 'D:\\Work\\minimi' }) === 'g-at');
  check('a General thread stays General', callerProject(ctx, { thread: 't2', cwd: 'D:\\Work\\minimi' }) === null);
  check('no thread: the folder decides', callerProject(ctx, { cwd: 'D:\\Work\\minimi' }) === 'g-mm');
  check('by name, any case', JSON.stringify(resolveProject(ctx, 'MINIMI')) === '{"id":"g-mm"}');
  check('general', JSON.stringify(resolveProject(ctx, 'general')) === '{"id":null}');
  check('an unknown name lists the projects', 'error' in resolveProject(ctx, 'nope'));
  check('a command typed by hand remembers no chat, even in a thread where Claude ran', callerChat(ctx, { thread: 't1', cwd: 'D:\\x' }) === null);
  const chat = callerChat(ctx, { thread: 't1', session: 'sess-1', cwd: 'D:\\x' });
  check('a command Claude ran remembers its chat, in the folder of its session', chat?.sessionId === 'sess-1' && chat.cwd === 'D:\\Work\\afterterm' && chat.threadId === 't1');
  const other = callerChat(ctx, { thread: 't1', session: 'sess-new', cwd: 'D:\\y' });
  check('a second Claude chat in the same terminal is remembered as itself, not the first', other?.sessionId === 'sess-new' && other.cwd === 'D:\\y');
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loops-cli-'));
const store = new LoopsStore(dir);
const T0 = new Date(2026, 10, 2, 10).getTime();
const run = (argv: string[], env: CallerEnv = inT1, now = T0) => runLoopsCommand(store, ctx, env, ['loops', ...argv], now);

console.log('\nloops-cli: start, update, ping, close\n');
{
  const r = run(['new', 'Loops on Home', '--label', 'feature', '--desc', 'Progress column', '--note', 'started']);
  check('new answers with the id', r.code === 0 && r.out.startsWith('Started loop #1: Loops on Home (feature, afterterm)'), r.out + r.err);
  const l = store.get('1')!;
  check('...in the thread\'s project, remembering its chat', l.project === 'g-at' && l.chat?.sessionId === 'sess-1');
  const s = run(['new', 'Calendar', '--parent', '1']);
  check('a sub-loop', s.code === 0 && s.out.includes('sub-loop of #1'), s.out);
  run(['new', 'Other project', '--project', 'minimi']);
  check('--project by name', store.get('3')?.project === 'g-mm');
  const u = run(['update', '1', '--note', 'calendar done'], { thread: 't9', session: 'sess-2', cwd: 'D:\\Work\\afterterm' }, T0 + 1000);
  check('update', u.code === 0 && store.get('1')?.note === 'calendar done');
  check('another chat\'s update replaces the remembered chat', store.get('1')?.chat?.sessionId === 'sess-2');
  check('nothing to change is an error', run(['update', '1']).code !== 0);
  check('a bad label is refused', run(['update', '1', '--label', 'chore']).code !== 0);
  check('ping', run(['ping', '1'], inT1, T0 + 2000).out.startsWith('Pinged loop #1'));
  check('a second ping the same day changes nothing', run(['ping', '1'], inT1, T0 + 3000).out.includes('nothing changed'));
  const c = run(['close', '1'], inT1, T0 + 4000);
  check('a parent with an open sub-loop is refused, with code 3', c.code === 3 && c.err.includes('Ask the user'), c.err);
  const c2 = run(['close', '1', '--with-sub-loops'], inT1, T0 + 5000);
  check('...and closes with --with-sub-loops', c2.code === 0 && c2.out.includes('and sub-loops #2'), c2.out);
  check('reopen', run(['reopen', '1']).code === 0 && store.get('1')?.status === 'open');
  check('an unknown loop is code 4', run(['show', '99']).code === 4);
  check('# before an id is fine', run(['show', '#1']).code === 0);
  check('an unknown command', run(['frob']).code === 1);
  check('help', run([]).out.includes('afterterm loops list'));
}

console.log('\nloops-cli: list and show\n');
{
  const here = run(['list']);
  check('list shows this thread\'s project only', here.out.includes('Loops in afterterm') && here.out.includes('#1') && !here.out.includes('Other project'), here.out);
  check('closed sub-loops are left out by default', !here.out.includes('Calendar'));
  check('--closed shows them', run(['list', '--closed']).out.includes('Calendar'));
  check('--all shows every project', run(['list', '--all']).out.includes('Other project'));
  const j = JSON.parse(run(['list', '--all', '--json']).out);
  check('--json gives records', Array.isArray(j) && j.length === 2 && j[0].projectName);
  const show = run(['show', '1']);
  check('show has the description, note and sub-loops', show.out.includes('description: Progress column') && show.out.includes('status note: calendar done') && show.out.includes('sub-loops (1/1 closed)'), show.out);
  run(['archive', '3']);
  check('an archived loop leaves the list', !run(['list', '--all']).out.includes('Other project'));
  check('...and shows under --archived', run(['list', '--all', '--archived']).out.includes('Other project'));
  run(['delete', '3']);
  check('a deleted loop is gone from show', run(['show', '3']).code === 4);
  check('restore brings it back', run(['restore', '3']).code === 0 && run(['show', '3']).code === 0);
}

console.log('\nloops-cli: the chat-start brief\n');
{
  const b = chatStartBrief(store.list(), ctx, { thread: 't1', session: 'sess-x', cwd: 'D:\\Work\\afterterm' }, T0);
  check('lists the folder\'s open loops', b.includes('Open loops in afterterm') && b.includes('#1 Loops on Home'), b);
  check('not other projects\' loops', !b.includes('Other project'));
  check('starts by pointing the chat at the skill', b.startsWith('You\u2019re running inside afterterm. Before you do anything else, read the afterterm skill.'));
  const resumed = chatStartBrief(store.list(), ctx, { thread: 't1', session: 'sess-1', cwd: 'D:\\Work\\afterterm' }, T0);
  check('a resumed chat gets its loop and status note', resumed.includes('This chat was working on loop #') && resumed.includes('Its status note'), resumed);
  const none = chatStartBrief(store.list(), ctx, { cwd: 'C:\\elsewhere' }, T0);
  check('no loops: says so', none.includes('No open loops in General'));
  for (let i = 0; i < 10; i++) run(['new', `Extra ${i}`]);
  const many = chatStartBrief(store.list(), ctx, { thread: 't1', cwd: 'D:\\Work\\afterterm' }, T0);
  check('at most 8 loops, then a count', many.includes('and 3 more'), many);
  const rot = chatStartBrief(store.list(), ctx, { thread: 't1', cwd: 'D:\\Work\\afterterm' }, T0 + 6 * DAY_MS);
  check('rotting shows', rot.includes('rotting'));
}

console.log('\nloops-skill\n');
{
  const cd = fs.mkdtempSync(path.join(os.tmpdir(), 'loops-skill-'));
  // An update from 0.20.0 or earlier: the old afterterm-loops skill, written by afterterm.
  const oldDir = path.join(cd, 'skills', 'afterterm-loops');
  fs.mkdirSync(oldDir, { recursive: true });
  fs.writeFileSync(path.join(oldDir, 'SKILL.md'), ['---', 'name: afterterm-loops', '---', SKILL_MARKER, 'old text'].join('\n'));
  const first = reconcileAftertermSkill({ claudeDir: cd, optedOut: false });
  check('written the first time', first.status === 'written');
  check('the old afterterm-loops skill of ours is removed, folder and all', first.oldSkill === 'removed' && !fs.existsSync(oldDir));
  check('unchanged the second', reconcileAftertermSkill({ claudeDir: cd, optedOut: false }).status === 'unchanged');
  const f = path.join(cd, 'skills', 'afterterm', 'SKILL.md');
  check('the text has its marker and name', fs.readFileSync(f, 'utf8') === SKILL_TEXT && SKILL_TEXT.includes(SKILL_MARKER) && SKILL_TEXT.includes('name: afterterm\n'));
  fs.writeFileSync(f, SKILL_TEXT.replace('Ids are numbers.', 'Ids are numbers!'));
  check('an old version of ours is replaced', reconcileAftertermSkill({ claudeDir: cd, optedOut: false }).status === 'written');
  fs.writeFileSync(f, '# my own skill');
  check('someone else\'s file is left alone', reconcileAftertermSkill({ claudeDir: cd, optedOut: false }).status === 'skipped-not-ours' && fs.readFileSync(f, 'utf8') === '# my own skill');
  fs.mkdirSync(oldDir, { recursive: true });
  fs.writeFileSync(path.join(oldDir, 'SKILL.md'), '# someone wrote their own afterterm-loops skill');
  check('someone else\'s afterterm-loops skill is kept', reconcileAftertermSkill({ claudeDir: cd, optedOut: false }).oldSkill === 'kept-not-ours' && fs.existsSync(path.join(oldDir, 'SKILL.md')));
  const cd2 = fs.mkdtempSync(path.join(os.tmpdir(), 'loops-skill-'));
  check('the opt-out writes nothing', reconcileAftertermSkill({ claudeDir: cd2, optedOut: true }).status === 'skipped-opt-out' && !fs.existsSync(path.join(cd2, 'skills')));
  check('no em dash in the skill', !SKILL_TEXT.includes(String.fromCharCode(0x2014)));
  check('closing is the agent\'s call when the work is done', SKILL_TEXT.includes('**Close a loop when its work is done.** Leave it open if something is still pending. If you are unsure, ask the user.'));
  check('the old wait-for-the-user rule is gone', !SKILL_TEXT.includes('the user will confirm') && !SKILL_TEXT.includes('only when the user says'));
  check('every command once, in the Commands table', SKILL_TEXT.split('afterterm loops close').length === 2 && SKILL_TEXT.includes('### Commands'));
  check('says what afterterm is first', SKILL_TEXT.indexOf('You are running inside afterterm, a terminal for Windows') < SKILL_TEXT.indexOf('## Loops'));
  fs.rmSync(cd, { recursive: true, force: true });
  fs.rmSync(cd2, { recursive: true, force: true });
}

store.flush();
fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

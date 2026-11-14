// Tests for the loops pipe end to end: a real named pipe in this process, the real
// client script (assets/cli/afterterm-cli.js) run with Node, and the real hook
// script run with PowerShell. Run on Node 24+:
//   node src/loops-pipe.test.ts
// The PowerShell part is skipped when neither pwsh nor powershell is found.

import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LoopsStore } from './loops-store.ts';
import { handleRequest, launcherTexts, loopsPipeName, newToken, startLoopsPipe, writeLaunchers } from './loops-pipe.ts';
import type { LoopsContext } from './loops-cli.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const CLIENT = path.join(root, 'assets', 'cli', 'afterterm-cli.js');
const HOOK = path.join(root, 'assets', 'hooks', 'afterterm-notify.ps1');

function run(cmd: string, args: string[], env: Record<string, string | undefined>, input?: string, cwd?: string): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { env: env as NodeJS.ProcessEnv, cwd, windowsHide: true, timeout: 20000 }, (error, stdout, stderr) => {
      const code = error ? (typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : 1) : 0;
      resolve({ code, out: String(stdout), err: String(stderr) });
    });
    if (input !== undefined) { child.stdin?.write(input); child.stdin?.end(); }
  });
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loops-pipe-'));
const store = new LoopsStore(dir);
const ctx: LoopsContext = { projects: [{ id: 'g1', name: 'demo', folder: dir }], threads: [{ id: 'tab-1', project: 'g1', sessionId: 'sess-old' }] };
const token = newToken();
const pipe = loopsPipeName(dir);

console.log('\nloops-pipe: requests\n');
{
  check('pipe names differ per data folder', loopsPipeName('C:\\a') !== loopsPipeName('C:\\b') && pipe.startsWith('\\\\.\\pipe\\afterterm-loops-'));
  check('the same folder in another case gives the same pipe', loopsPipeName('C:\\A') === loopsPipeName('c:\\a'));
  const opts = { token, backend: store, context: () => ctx };
  check('no token is refused', handleRequest(opts, { kind: 'cli', argv: ['loops', 'list'] }).code === 5);
  check('a wrong token is refused', handleRequest(opts, { token: token.slice(0, -1) + 'x', kind: 'cli', argv: ['loops', 'list'] }).code === 5);
  check('garbage is refused', handleRequest(opts, 'junk').code === 2 && handleRequest(opts, { token, kind: 'what' }).code === 2);
  check('a good request runs', handleRequest(opts, { token, kind: 'cli', argv: ['loops', 'list'], env: { thread: 'tab-1', cwd: dir } }).code === 0);
}

console.log('\nloops-pipe: launchers\n');
{
  const t = launcherTexts('C:\\Program Files\\afterterm\\afterterm.exe', 'C:\\Program Files\\afterterm\\resources\\assets\\cli\\afterterm-cli.js');
  check('the cmd launcher sets Node mode and passes every argument', t.cmd.includes('set ELECTRON_RUN_AS_NODE=1') && t.cmd.includes('"C:\\Program Files\\afterterm\\afterterm.exe" "C:\\Program Files\\afterterm\\resources\\assets\\cli\\afterterm-cli.js" %*'));
  check('the sh launcher uses forward slashes', t.sh.includes('exec "C:/Program Files/afterterm/afterterm.exe" "C:/Program Files/afterterm/resources/assets/cli/afterterm-cli.js" "$@"'));
  const bin = path.join(dir, 'bin');
  check('written', writeLaunchers(bin, 'C:\\x.exe', 'C:\\y.js') && fs.existsSync(path.join(bin, 'afterterm.cmd')) && fs.existsSync(path.join(bin, 'afterterm')));
  const before = fs.statSync(path.join(bin, 'afterterm.cmd')).mtimeMs;
  writeLaunchers(bin, 'C:\\x.exe', 'C:\\y.js');
  check('not rewritten when unchanged', fs.statSync(path.join(bin, 'afterterm.cmd')).mtimeMs === before);
}

const server = startLoopsPipe({ pipeName: pipe, token, backend: store, context: () => ctx });
await new Promise((r) => server.once('listening', r));

const clientEnv = (extra: Record<string, string | undefined> = {}) => ({
  ...process.env,
  AFTERTERM_LOOPS_PIPE: pipe,
  AFTERTERM_LOOPS_TOKEN: token,
  AFTERTERM_TAB_ID: 'tab-1',
  CLAUDE_CODE_SESSION_ID: 'sess-cli',
  ...extra,
});

console.log('\nloops-pipe: the real command\n');
{
  const n = await run(process.execPath, [CLIENT, 'loops', 'new', 'Pipe test', '--label', 'bug', '--note', 'from the client'], clientEnv(), undefined, dir);
  check('new over the pipe', n.code === 0 && n.out.startsWith('Started loop #1: Pipe test (bug, demo)'), n.out + n.err);
  check('remembers the chat from CLAUDE_CODE_SESSION_ID', store.get('1')?.chat?.sessionId === 'sess-cli' && store.get('1')?.chat?.threadId === 'tab-1');
  const l = await run(process.execPath, [CLIENT, 'loops', 'list'], clientEnv(), undefined, dir);
  check('list over the pipe', l.code === 0 && l.out.includes('#1') && l.out.includes('Pipe test'), l.out + l.err);
  const sub = await run(process.execPath, [CLIENT, 'loops', 'new', 'Part', '--parent', '1'], clientEnv(), undefined, dir);
  const c = await run(process.execPath, [CLIENT, 'loops', 'close', '1'], clientEnv(), undefined, dir);
  check('the parent-close refusal reaches the shell with code 3', sub.code === 0 && c.code === 3 && c.err.includes('open sub-loop'), c.err);
  const bad = await run(process.execPath, [CLIENT, 'loops', 'list'], clientEnv({ AFTERTERM_LOOPS_TOKEN: 'nope' }), undefined, dir);
  check('a wrong token gets a plain refusal', bad.code === 5 && bad.err.includes('refused'), bad.err);
  const gone = await run(process.execPath, [CLIENT, 'loops', 'list'], clientEnv({ AFTERTERM_LOOPS_PIPE: '\\\\.\\pipe\\afterterm-loops-not-there' }), undefined, dir);
  check('no afterterm: "afterterm is not running"', gone.code === 1 && gone.err.trim() === 'afterterm is not running', gone.err);
  const outside = await run(process.execPath, [CLIENT, 'loops', 'list'], { ...process.env, AFTERTERM_LOOPS_PIPE: undefined, AFTERTERM_LOOPS_TOKEN: undefined }, undefined, dir);
  check('outside afterterm\'s terminals: says so', outside.code === 1 && outside.err.includes('afterterm is not running'), outside.err);
  const other = await run(process.execPath, [CLIENT, 'frob'], clientEnv(), undefined, dir);
  check('only "afterterm loops" exists', other.code === 1 && other.err.includes('the only command here'));
}

console.log('\nloops-pipe: the chat-start hook\n');
let ps: string | null = null;
for (const c of ['pwsh', 'powershell']) {
  try { execFileSync('where.exe', [c], { stdio: 'ignore' }); ps = c; break; } catch { /* next */ }
}
if (!ps) {
  console.log('  SKIP  no PowerShell found');
} else {
  const payload = (source: string, session: string) => JSON.stringify({ hook_event_name: 'SessionStart', source, session_id: session, cwd: dir });
  const hookEnv = (extra: Record<string, string | undefined> = {}) => clientEnv({ AFTERTERM: '1', AFTERTERM_SESSION_DIR: undefined, CLAUDE_CODE_SESSION_ID: undefined, ...extra });
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', HOOK];
  const t0 = Date.now();
  const fresh = await run(ps, args, hookEnv(), payload('startup', 'sess-new'));
  const ms = Date.now() - t0;
  let parsed: any = null;
  try { parsed = JSON.parse(fresh.out); } catch { /* checked below */ }
  const ctxText: string = parsed?.hookSpecificOutput?.additionalContext ?? '';
  check('a new chat gets the folder\'s open loops', parsed?.hookSpecificOutput?.hookEventName === 'SessionStart' && ctxText.includes('Open loops in demo') && ctxText.includes('#1 Pipe test'), fresh.out + fresh.err);
  check('the title is still set', typeof parsed?.terminalSequence === 'string' && parsed.terminalSequence.includes(path.basename(dir)));
  check(`the hook stays quick (${ms} ms)`, ms < 8000);
  const resumed = await run(ps, args, hookEnv(), payload('resume', 'sess-cli'));
  const rText: string = JSON.parse(resumed.out)?.hookSpecificOutput?.additionalContext ?? '';
  check('a resumed chat gets the loop it touched last (the sub-loop #2)', rText.includes('This chat was working on loop #2: Part'), rText);
  const noPipe = await run(ps, args, hookEnv({ AFTERTERM_LOOPS_PIPE: '\\\\.\\pipe\\afterterm-loops-not-there' }), payload('startup', 's'));
  const np = JSON.parse(noPipe.out);
  check('no pipe: the title only, no error', !np.hookSpecificOutput && typeof np.terminalSequence === 'string' && noPipe.code === 0, noPipe.out + noPipe.err);
  const outside = await run(ps, args, { ...process.env, AFTERTERM: undefined }, payload('startup', 's'));
  check('outside afterterm the hook still prints nothing', outside.out.trim() === '');
}

server.close();
store.flush();
fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

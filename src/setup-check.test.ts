// Unit tests for the Claude Code setup check (setup-check.ts), on fake processes
// and an in-memory file system. Run directly on Node 24+:
//   node src/setup-check.test.ts
// Exits 0 if all pass, 1 on any failure.

import path from 'path';
import {
  runSetupCheck, formatReport, anonymize, issueUrl, parseFacts, parseClaudeVersion,
  installKindOf, modeOf, TEST_SESSION_ID, MAX_URL, failureNote,
} from './setup-check.ts';
import type { CheckDeps, CheckFs, Runner, RunResult, CheckOpts } from './setup-check.ts';
import { HOOK_SCRIPT_NAME, hookArgs } from './claude-hook-install.ts';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}

const HOME = 'C:\\Users\\yogan';
const CLAUDE = path.join(HOME, '.claude');
const DATA = path.join(HOME, 'AppData', 'Roaming', 'afterterm');
const SRC = 'C:\\Program Files\\afterterm\\resources\\assets\\hooks\\afterterm-notify.ps1';
const DEST = path.join(CLAUDE, 'hooks', HOOK_SCRIPT_NAME);
const TMP = 'C:\\Temp';

const opts: CheckOpts = { claudeDir: CLAUDE, scriptSource: SRC, userDataDir: DATA, aftertermVersion: '0.10.0', installKind: 'installer' };

// An in-memory file system, enough for the check: files by lower-cased path.
function memFs(files: Record<string, string>): CheckFs & { files: Map<string, string> } {
  const m = new Map(Object.entries(files).map(([k, v]) => [k.toLowerCase(), v]));
  let n = 0;
  return {
    files: m,
    existsSync: (p) => m.has(p.toLowerCase()) || [...m.keys()].some(k => k.startsWith(p.toLowerCase() + '\\')),
    readFileSync: (p) => { const v = m.get(p.toLowerCase()); if (v === undefined) throw new Error('ENOENT ' + p); return v; },
    readdirSync: (p) => {
      const pre = p.toLowerCase() + '\\';
      const names = [...m.keys()].filter(k => k.startsWith(pre)).map(k => k.slice(pre.length).split('\\')[0]);
      if (names.length === 0) throw new Error('ENOENT ' + p);
      return [...new Set(names)];
    },
    mkdtempSync: (prefix) => `${prefix}${++n}`,
    rmSync: (p) => { for (const k of [...m.keys()]) if (k.startsWith(p.toLowerCase())) m.delete(k); },
  };
}

function settingsWith(args: string[], extra: Record<string, unknown> = {}) {
  const entry = (matcher: string) => [{ matcher, hooks: [{ type: 'command', command: 'powershell', args }] }];
  return JSON.stringify({
    ...extra,
    hooks: { SessionStart: entry(''), UserPromptSubmit: entry(''), Notification: entry('permission_prompt'), Stop: entry(''), PreCompact: entry('') },
  });
}

// A fake machine. `helper(args)` decides what running the hook does: whether it
// writes the session file and prints the title, given the arguments it was run with.
function machine(o: {
  claudeOnPath?: boolean;
  settings?: string | null;
  helper?: (args: string[]) => { ok: boolean; stderr?: string };
  extraFiles?: Record<string, string>;
}) {
  const files: Record<string, string> = { [SRC]: '# hook v2', [DEST]: '# hook v2', ...(o.extraFiles ?? {}) };
  if (o.settings !== null) files[path.join(CLAUDE, 'settings.json')] = o.settings ?? settingsWith(hookArgs(DEST));
  const fs = memFs(files);
  const calls: { command: string; args: string[]; env?: Record<string, string | undefined> }[] = [];
  const run: Runner = async (command, args, ro): Promise<RunResult> => {
    calls.push({ command, args, env: ro.env });
    if (command === 'where.exe') return o.claudeOnPath === false ? { code: 1, stdout: '', stderr: 'not found' } : { code: 0, stdout: 'C:\\Users\\yogan\\.local\\bin\\claude.exe\r\n', stderr: '' };
    if (command === 'cmd.exe' || command.toLowerCase().endsWith('claude.exe')) return { code: 0, stdout: '2.1.312 (Claude Code)\n', stderr: '' };
    if (command === 'powershell.exe' && args.includes('-EncodedCommand')) {
      return { code: 0, stdout: JSON.stringify({ os: 'Microsoft Windows 11 Home Single Language', build: '10.0.26200.0', psVersion: '5.1.26100.1', languageMode: 'FullLanguage', policies: [{ scope: 'MachinePolicy', policy: 'Restricted' }, { scope: 'LocalMachine', policy: 'Undefined' }], pwsh: false, antivirus: ['Windows Defender'] }), stderr: '' };
    }
    // The helper itself.
    const h = (o.helper ?? (() => ({ ok: true })))(args);
    if (h.ok) {
      const dir = ro.env!.AFTERTERM_SESSION_DIR!;
      fs.files.set(path.join(dir, 'setup-check.json').toLowerCase(), JSON.stringify({ sessionId: TEST_SESSION_ID, cwd: dir }));
      return { code: 0, stdout: '{"terminalSequence":"\\u001b]0;working\\u0007"}', stderr: '' };
    }
    return { code: 1, stdout: '', stderr: h.stderr ?? 'File C:\\Users\\yogan\\.claude\\hooks\\afterterm-notify.ps1 cannot be loaded because running scripts is disabled on this system.' };
  };
  const deps: CheckDeps = { run, fs, env: { APPDATA: path.join(HOME, 'AppData', 'Roaming'), PATH: 'x' }, homeDir: HOME, tmpDir: TMP };
  return { deps, calls };
}

console.log('\nsetup-check tests\n');

// 1. Everything works: one test, no facts gathered, no report.
{
  const { deps, calls } = machine({});
  const r = await runSetupCheck(opts, deps);
  check('ok: Claude Code found with version and install kind', r.claude.found && r.claude.version === '2.1.312' && r.claude.install === 'native install', JSON.stringify(r.claude));
  check('ok: notifications and resume ok, file mode', r.notifications === 'ok' && r.resume === 'ok' && r.workingMode === 'file');
  check('ok: only the registered entry was tried', r.tests.length === 1);
  check('ok: no report, facts not gathered', r.report === '' && r.facts === null && !calls.some(c => c.args.includes('-EncodedCommand')));
  const helperCall = calls.find(c => c.command === 'powershell');
  check('ok: helper ran with the registered args', JSON.stringify(helperCall?.args) === JSON.stringify(hookArgs(DEST)));
  check('ok: helper got the afterterm env', helperCall?.env?.AFTERTERM === '1' && helperCall?.env?.AFTERTERM_TAB_ID === 'setup-check' && !!helperCall?.env?.AFTERTERM_SESSION_DIR);
}

// 2. No Claude Code: skipped, nothing else runs.
{
  const { deps, calls } = machine({ claudeOnPath: false });
  const r = await runSetupCheck(opts, deps);
  check('none: not found, both skipped', !r.claude.found && r.notifications === 'skipped' && r.resume === 'skipped');
  check('none: no helper test, no report', r.tests.length === 0 && r.report === '' && calls.length === 1);
}

// 3. Not on PATH but in the native install folder: found.
{
  const { deps } = machine({ claudeOnPath: false, extraFiles: { [path.join(HOME, '.local', 'bin', 'claude.exe')]: 'exe' } });
  const r = await runSetupCheck(opts, deps);
  check('known path: found off PATH', r.claude.found && r.claude.install === 'native install');
}

// 4. -File blocked (Yogansh before the fix, or a Group Policy): the second way
//    passes, so the check reports the mode to switch to and no failure.
{
  const { deps } = machine({ settings: settingsWith(['-NoProfile', '-File', DEST]), helper: (a) => ({ ok: a.includes('-Command') }) });
  const r = await runSetupCheck(opts, deps);
  check('fallback: two tests, second passed', r.tests.length === 2 && !r.tests[0].fileWritten && r.tests[1].fileWritten);
  check('fallback: working mode is command, both ok', r.workingMode === 'command' && r.notifications === 'ok' && r.resume === 'ok');
  check('fallback: no report', r.report === '');
}

// 5. Both ways blocked: failed, with facts, a title and a report.
{
  const { deps } = machine({ helper: () => ({ ok: false }) });
  const r = await runSetupCheck(opts, deps);
  check('blocked: both failed', r.notifications === 'failed' && r.resume === 'failed' && r.workingMode === null);
  check('blocked: facts gathered', r.facts?.policies[0]?.policy === 'Restricted' && r.facts?.pwsh === false);
  check('blocked: issue title', r.issueTitle === 'Setup check failed: helper does not run', r.issueTitle);
  check('blocked: report names both tests and the stderr', /Test 1, registered entry \(file\)/.test(r.report) && /Test 2, second way \(command\)/.test(r.report) && /running scripts is disabled/.test(r.report), r.report);
  check('blocked: report has no user name', !/yogan/i.test(r.report), r.report);
  check('blocked: report has the policy table', /MachinePolicy\s+Restricted/.test(r.report));
  check('blocked: the note says Windows blocked it', failureNote(r) === "Windows blocked afterterm's helper on this PC.");
}

// 6. Hooks turned off in settings: failed even though the helper itself runs.
{
  const { deps } = machine({ settings: settingsWith(hookArgs(DEST), { disableAllHooks: true }) });
  const r = await runSetupCheck(opts, deps);
  check('disableAllHooks: failed', r.notifications === 'failed' && r.settings?.disableAllHooks === true);
  check('disableAllHooks: title says so', r.issueTitle === 'Setup check failed: hooks are turned off in Claude Code', r.issueTitle);
  check('disableAllHooks: the note names the cause', failureNote(r) === "Hooks are turned off in Claude Code's settings.", failureNote(r));
}

// 7. Managed settings that allow only managed hooks: failed, named in the report.
{
  const managed = 'C:\\Program Files\\ClaudeCode\\managed-settings.json';
  const { deps } = machine({ extraFiles: { [managed]: '{"allowManagedHooksOnly":true}' } });
  const r = await runSetupCheck(opts, deps);
  check('managed: failed', r.notifications === 'failed' && !!r.settings?.managed);
  check('managed: report names the file', r.report.includes('allowManagedHooksOnly'));
}

// 8. No settings.json at all: nothing registered, failed, no test run.
{
  const { deps } = machine({ settings: null });
  const r = await runSetupCheck(opts, deps);
  check('no settings: failed with no tests', r.notifications === 'failed' && r.tests.length === 0);
  check('no settings: title', r.issueTitle === 'Setup check failed: Claude Code settings file unreadable', r.issueTitle);
}

// 9. Other hooks on the same events are counted, not mistaken for ours.
{
  const s = JSON.parse(settingsWith(hookArgs(DEST)));
  s.hooks.Stop.push({ matcher: '', hooks: [{ type: 'command', command: 'pwsh', args: ['-File', 'C:\\mine\\notify.ps1'] }] });
  const { deps } = machine({ settings: JSON.stringify(s) });
  const r = await runSetupCheck(opts, deps);
  check('other hooks: 5 of ours, 1 other', r.settings?.ourEvents === 5 && r.settings?.otherHooks === 1);
}

// 10. Small pure pieces.
check('version parse', parseClaudeVersion('2.1.312 (Claude Code)') === '2.1.312' && parseClaudeVersion('nonsense') === null);
check('install kinds', installKindOf('C:\\Users\\a\\AppData\\Roaming\\npm\\claude.cmd') === 'npm' && installKindOf('C:\\x\\claude.exe') === 'other');
check('modeOf', modeOf(hookArgs(DEST)) === 'file' && modeOf(hookArgs(DEST, 'command')) === 'command' && modeOf([]) === 'other');
check('anonymize is case-insensitive', anonymize('c:\\users\\YOGAN\\x and C:\\Users\\yogan\\y', HOME) === '%USERPROFILE%\\x and %USERPROFILE%\\y');
check('parseFacts survives junk', parseFacts('not json', 'x64', 'en-IN').policies.length === 0);
{
  const { deps } = machine({ helper: () => ({ ok: false }) });
  const r = await runSetupCheck(opts, deps);
  const url = issueUrl(r);
  check('issue url: repo, title and fenced body', url.startsWith('https://github.com/afteraryan/afterterm/issues/new?title=Setup%20check%20failed') && url.includes('body=%60%60%60'));
  check('issue url: short enough for ShellExecute', url.length <= MAX_URL, String(url.length));
  check('formatReport is stable', formatReport(r, opts, HOME) === r.report);
  const long = { ...r, report: r.report + '\n' + 'x'.repeat(5000) };
  const cut = issueUrl(long);
  check('issue url: a long report is shortened to fit and says so', cut.length <= MAX_URL && decodeURIComponent(cut).includes('(report shortened)'), String(cut.length));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);

// setup-check.ts
//
// The Claude Code setup check: does afterterm's helper (the hook in
// ~/.claude/settings.json) actually run on this machine, and does it save the chat?
// The installer runs it once through `afterterm.exe --setup-check=<file>` and shows
// the answer on its "Checking Claude Code" page; a failure there offers "Report
// issue", which opens a GitHub issue filled in with `report`.
//
// It runs the registered entry exactly as Claude Code would: same command, same
// arguments, the same environment afterterm gives its terminals, and a made-up
// UserPromptSubmit payload on stdin, then looks for the session file and the title.
// What it cannot run is Claude Code itself firing the hook; that needs a real chat.
//
// Why this exists: on Yogansh's machine (2026-10-29) Windows PowerShell's default
// Restricted policy refused the hook's .ps1 file, silently, so no chat was ever
// saved and none came back after Sleep. Nothing told anyone. This is the "tell".
//
// Node built-ins only, and every process and file access goes through `deps`, so
// the decision logic is unit-tested (setup-check.test.ts) without spawning anything.

import path from 'path';
import { HOOK_SCRIPT_NAME, hookArgs, isAftertermHook } from './claude-hook-install.ts';
import type { HookMode } from './claude-hook-install.ts';

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  error?: string; // the process could not be started at all
}

export type Runner = (
  command: string,
  args: string[],
  opts: { env?: Record<string, string | undefined>; input?: string; timeoutMs: number },
) => Promise<RunResult>;

export interface CheckFs {
  existsSync(p: string): boolean;
  readFileSync(p: string, enc: 'utf-8'): string;
  readdirSync(p: string): string[];
  mkdtempSync(prefix: string): string;
  rmSync(p: string, opts: { recursive: boolean; force: boolean }): void;
}

export interface CheckDeps {
  run: Runner;
  fs: CheckFs;
  env: Record<string, string | undefined>;
  homeDir: string;
  tmpDir: string;
}

export interface CheckOpts {
  claudeDir: string; // where Claude Code's settings.json lives (~/.claude, or CLAUDE_CONFIG_DIR)
  scriptSource: string; // the afterterm-notify.ps1 bundled with this build
  userDataDir: string; // %APPDATA%\afterterm (or a sandbox's)
  aftertermVersion: string;
  installKind: 'installer' | 'portable' | 'dev';
}

export interface HelperTest {
  label: string; // 'registered entry' | 'second way'
  mode: HookMode | 'other';
  command: string;
  args: string[];
  exit: number | null;
  fileWritten: boolean;
  titleReturned: boolean;
  stderr: string;
}

export interface Facts {
  os: string | null;
  build: string | null;
  arch: string;
  locale: string;
  psVersion: string | null;
  languageMode: string | null;
  policies: { scope: string; policy: string }[];
  pwsh: boolean | null;
  antivirus: string[];
}

export interface SettingsFacts {
  exists: boolean;
  valid: boolean;
  disableAllHooks: boolean;
  managed: string | null; // a managed-settings.json that limits or disables hooks, by path
  ourEvents: number; // events with an afterterm entry, of 5
  otherHooks: number; // other hooks on those same events
  scriptMatches: boolean;
}

export interface SetupCheckResult {
  claude: { found: boolean; version: string | null; install: string | null };
  notifications: 'ok' | 'failed' | 'skipped';
  resume: 'ok' | 'failed' | 'skipped';
  workingMode: HookMode | null; // the way of running the helper that passed, when one did
  settings: SettingsFacts | null;
  tests: HelperTest[];
  facts: Facts | null;
  sessionsSaved: number;
  notificationsPref: string;
  report: string;
  issueTitle: string;
}

export const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'Notification', 'Stop', 'PreCompact'];
export const TEST_SESSION_ID = '0a0e0c0f-5e7c-4c4e-9c4e-a7e07e7c0001';
const TEST_TAB_ID = 'setup-check';

// ─── Claude Code ─────────────────────────────────────────────────────────────

export function installKindOf(p: string): string {
  const s = p.toLowerCase();
  if (s.includes('\\.local\\bin\\')) return 'native install';
  if (s.includes('\\npm\\')) return 'npm';
  if (s.includes('\\winget\\')) return 'winget';
  return 'other';
}

async function findClaude(deps: CheckDeps): Promise<{ path: string; viaPath: boolean } | null> {
  const where = await deps.run('where.exe', ['claude'], { timeoutMs: 5000 });
  const first = where.code === 0 ? where.stdout.split(/\r?\n/).map(l => l.trim()).find(Boolean) : undefined;
  if (first) return { path: first, viaPath: true };
  const known = [
    path.join(deps.homeDir, '.local', 'bin', 'claude.exe'),
    deps.env.APPDATA ? path.join(deps.env.APPDATA, 'npm', 'claude.cmd') : '',
  ].filter(Boolean);
  const found = known.find(p => deps.fs.existsSync(p));
  return found ? { path: found, viaPath: false } : null;
}

export function parseClaudeVersion(out: string): string | null {
  const m = /(\d+\.\d+\.\d+)/.exec(out);
  return m ? m[1] : null;
}

// ─── Claude Code's settings ──────────────────────────────────────────────────

type HookEntry = { command?: unknown; args?: unknown[] };
type Group = { matcher?: string; hooks?: HookEntry[] };

export function readSettingsFacts(claudeDir: string, scriptSource: string, fs: CheckFs, managedPaths: string[]): {
  facts: SettingsFacts;
  promptEntry: { command: string; args: string[] } | null;
} {
  const settingsPath = path.join(claudeDir, 'settings.json');
  const facts: SettingsFacts = {
    exists: fs.existsSync(settingsPath), valid: false, disableAllHooks: false, managed: null,
    ourEvents: 0, otherHooks: 0, scriptMatches: false,
  };
  let promptEntry: { command: string; args: string[] } | null = null;

  let settings: { disableAllHooks?: unknown; hooks?: Record<string, unknown> } | null = null;
  if (facts.exists) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8').replace(/^\uFEFF/, ''));
      facts.valid = !!settings && typeof settings === 'object';
    } catch { /* invalid JSON: valid stays false */ }
  }
  if (settings && facts.valid) {
    facts.disableAllHooks = settings.disableAllHooks === true;
    const hooks = (settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {}) as Record<string, unknown>;
    for (const event of HOOK_EVENTS) {
      const groups = Array.isArray(hooks[event]) ? hooks[event] as Group[] : [];
      let ours = false;
      for (const g of groups) {
        for (const h of Array.isArray(g?.hooks) ? g.hooks : []) {
          if (isAftertermHook(h)) {
            ours = true;
            if (event === 'UserPromptSubmit' && !promptEntry && typeof h.command === 'string' && Array.isArray(h.args)) {
              promptEntry = { command: h.command, args: h.args.map(String) };
            }
          } else {
            facts.otherHooks++;
          }
        }
      }
      if (ours) facts.ourEvents++;
    }
  }

  for (const p of managedPaths) {
    if (!fs.existsSync(p)) continue;
    try {
      const m = JSON.parse(fs.readFileSync(p, 'utf-8').replace(/^\uFEFF/, ''));
      if (m?.disableAllHooks === true) facts.managed = `${p} (disableAllHooks)`;
      else if (m?.allowManagedHooksOnly === true) facts.managed = `${p} (allowManagedHooksOnly)`;
    } catch { facts.managed = `${p} (unreadable)`; }
  }

  try {
    const dest = path.join(claudeDir, 'hooks', HOOK_SCRIPT_NAME);
    facts.scriptMatches = fs.existsSync(dest) && fs.readFileSync(dest, 'utf-8') === fs.readFileSync(scriptSource, 'utf-8');
  } catch { facts.scriptMatches = false; }

  return { facts, promptEntry };
}

export function modeOf(args: string[]): HookMode | 'other' {
  const lower = args.map(a => a.toLowerCase());
  if (lower.includes('-command')) return 'command';
  if (lower.includes('-file')) return 'file';
  return 'other';
}

// ─── Running the helper ──────────────────────────────────────────────────────

async function testHelper(label: string, command: string, args: string[], deps: CheckDeps): Promise<HelperTest> {
  const dir = deps.fs.mkdtempSync(path.join(deps.tmpDir, 'afterterm-check-'));
  try {
    const payload = JSON.stringify({
      hook_event_name: 'UserPromptSubmit',
      session_id: TEST_SESSION_ID,
      cwd: dir,
      permission_mode: 'default',
    });
    const r = await deps.run(command, args, {
      env: { ...deps.env, AFTERTERM: '1', AFTERTERM_TAB_ID: TEST_TAB_ID, AFTERTERM_SESSION_DIR: dir },
      input: payload,
      timeoutMs: 20000,
    });
    let fileWritten = false;
    try {
      const raw = deps.fs.readFileSync(path.join(dir, `${TEST_TAB_ID}.json`), 'utf-8').replace(/^\uFEFF/, '');
      fileWritten = JSON.parse(raw)?.sessionId === TEST_SESSION_ID;
    } catch { /* not written */ }
    const stderr = (r.error ?? r.stderr ?? '').replace(/\s+/g, ' ').trim().slice(0, 400)
      + (r.timedOut ? ' (timed out)' : '');
    return {
      label, mode: modeOf(args), command, args,
      exit: r.code, fileWritten, titleReturned: /terminalSequence/.test(r.stdout), stderr,
    };
  } finally {
    try { deps.fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp, best effort */ }
  }
}

// ─── Machine facts ───────────────────────────────────────────────────────────

const FACTS_SCRIPT = `
$o = [ordered]@{}
try { $o.os = (Get-CimInstance Win32_OperatingSystem -ErrorAction Stop).Caption } catch { $o.os = $null }
$o.build = [Environment]::OSVersion.Version.ToString()
$o.psVersion = $PSVersionTable.PSVersion.ToString()
$o.languageMode = $ExecutionContext.SessionState.LanguageMode.ToString()
$o.policies = @(Get-ExecutionPolicy -List | ForEach-Object { [ordered]@{ scope = $_.Scope.ToString(); policy = $_.ExecutionPolicy.ToString() } })
$o.pwsh = [bool](Get-Command pwsh -ErrorAction SilentlyContinue)
try { $o.antivirus = @(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction Stop | ForEach-Object { $_.displayName }) } catch { $o.antivirus = @() }
$o | ConvertTo-Json -Compress -Depth 4
`;

export function parseFacts(stdout: string, arch: string, locale: string): Facts {
  const blank: Facts = { os: null, build: null, arch, locale, psVersion: null, languageMode: null, policies: [], pwsh: null, antivirus: [] };
  try {
    const o = JSON.parse(stdout.trim());
    return {
      ...blank,
      os: typeof o.os === 'string' ? o.os : null,
      build: typeof o.build === 'string' ? o.build : null,
      psVersion: typeof o.psVersion === 'string' ? o.psVersion : null,
      languageMode: typeof o.languageMode === 'string' ? o.languageMode : null,
      policies: Array.isArray(o.policies) ? o.policies.filter((p: any) => p && typeof p.scope === 'string').map((p: any) => ({ scope: p.scope, policy: String(p.policy) })) : [],
      pwsh: typeof o.pwsh === 'boolean' ? o.pwsh : null,
      antivirus: Array.isArray(o.antivirus) ? o.antivirus.filter((a: unknown) => typeof a === 'string') : [],
    };
  } catch {
    return blank;
  }
}

async function readFacts(deps: CheckDeps): Promise<Facts> {
  // -EncodedCommand, not a .ps1: execution policy does not apply to it, so the
  // facts arrive even on a machine that blocks scripts (the one we most need them from).
  const encoded = Buffer.from(FACTS_SCRIPT, 'utf16le').toString('base64');
  // Without PSModulePath: one inherited from a PowerShell 7 parent points Windows
  // PowerShell at 7's modules, and Get-ExecutionPolicy then fails to load (seen
  // when afterterm itself was started from pwsh). Left unset, 5.1 uses its own.
  const env = { ...deps.env };
  delete env.PSModulePath;
  const r = await deps.run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { timeoutMs: 20000, env });
  return parseFacts(r.stdout, process.arch, Intl.DateTimeFormat().resolvedOptions().locale);
}

// ─── The check ───────────────────────────────────────────────────────────────

export function managedSettingsPaths(env: Record<string, string | undefined>): string[] {
  const pf = env.ProgramFiles || 'C:\\Program Files';
  const pd = env.ProgramData || 'C:\\ProgramData';
  return [path.join(pf, 'ClaudeCode', 'managed-settings.json'), path.join(pd, 'ClaudeCode', 'managed-settings.json')];
}

export async function runSetupCheck(opts: CheckOpts, deps: CheckDeps): Promise<SetupCheckResult> {
  const claudePath = await findClaude(deps);
  let version: string | null = null;
  if (claudePath) {
    const r = claudePath.viaPath
      ? await deps.run('cmd.exe', ['/d', '/c', 'claude', '--version'], { timeoutMs: 15000, env: deps.env })
      : await deps.run(claudePath.path, ['--version'], { timeoutMs: 15000, env: deps.env });
    version = parseClaudeVersion(r.stdout);
  }

  const sessionsDir = path.join(opts.userDataDir, 'claude-sessions');
  let sessionsSaved = 0;
  try { sessionsSaved = deps.fs.readdirSync(sessionsDir).filter(n => n.endsWith('.json')).length; } catch { /* none yet */ }
  let notificationsPref = 'enabled';
  try {
    const prefs = JSON.parse(deps.fs.readFileSync(path.join(opts.userDataDir, 'prefs.json'), 'utf-8'));
    if (prefs?.claudeNotifications === 'disabled') notificationsPref = 'disabled';
  } catch { /* default */ }

  const base: SetupCheckResult = {
    claude: { found: !!claudePath, version, install: claudePath ? installKindOf(claudePath.path) : null },
    notifications: 'skipped', resume: 'skipped', workingMode: null,
    settings: null, tests: [], facts: null, sessionsSaved, notificationsPref, report: '', issueTitle: '',
  };
  // No Claude Code: nothing to check and nothing to say. afterterm connects to it
  // by itself on the first launch after it is installed (reconcile runs every launch).
  if (!claudePath) return base;

  const { facts: settings, promptEntry } = readSettingsFacts(opts.claudeDir, opts.scriptSource, deps.fs, managedSettingsPaths(deps.env));
  const result: SetupCheckResult = { ...base, settings };

  if (promptEntry) {
    result.tests.push(await testHelper('registered entry', promptEntry.command, promptEntry.args, deps));
    const first = result.tests[0];
    if (!(first.fileWritten && first.titleReturned) && modeOf(promptEntry.args) !== 'command') {
      const scriptDest = path.join(opts.claudeDir, 'hooks', HOOK_SCRIPT_NAME);
      result.tests.push(await testHelper('second way', promptEntry.command, hookArgs(scriptDest, 'command'), deps));
    }
  }

  const passed = result.tests.find(t => t.fileWritten && t.titleReturned);
  const blocked = settings.disableAllHooks || !!settings.managed || !settings.valid;
  result.workingMode = passed && !blocked && passed.mode !== 'other' ? passed.mode : null;
  result.notifications = result.workingMode ? 'ok' : 'failed';
  result.resume = result.workingMode ? 'ok' : 'failed';

  if (result.workingMode === null) {
    result.facts = await readFacts(deps);
    result.issueTitle = issueTitle(result);
    result.report = formatReport(result, opts, deps.homeDir);
  }
  return result;
}

// ─── The report ──────────────────────────────────────────────────────────────

export function issueTitle(r: SetupCheckResult): string {
  const s = r.settings;
  const why = !s?.valid ? 'Claude Code settings file unreadable'
    : s.disableAllHooks ? 'hooks are turned off in Claude Code'
    : s.managed ? 'hooks limited by managed settings'
    : s.ourEvents === 0 ? 'helper not registered'
    : 'helper does not run';
  return `Setup check failed: ${why}`;
}

// The one sentence the installer's Check page shows under a failed row: why, in
// the user's words. The installer adds "afterterm works, without these two."
export function failureNote(r: SetupCheckResult): string {
  const s = r.settings;
  if (!s?.valid) return "Claude Code's settings file could not be read.";
  if (s.disableAllHooks) return "Hooks are turned off in Claude Code's settings.";
  if (s.managed) return "This PC's Claude Code settings allow only hooks its administrator set.";
  if (s.ourEvents === 0) return "afterterm's helper could not be added to Claude Code.";
  return "Windows blocked afterterm's helper on this PC.";
}

function yes(b: boolean): string { return b ? 'yes' : 'no'; }

// Paths are written with %USERPROFILE% in place of the user's home folder, so the
// report carries no user name. It never includes chats, files or project names.
export function anonymize(text: string, homeDir: string): string {
  if (!homeDir) return text;
  const esc = homeDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(esc, 'gi'), '%USERPROFILE%');
}

export function formatReport(r: SetupCheckResult, opts: CheckOpts, homeDir: string): string {
  const f = r.facts;
  const s = r.settings;
  const lines: string[] = [];
  const failed = [r.notifications === 'failed' ? 'Notifications work' : '', r.resume === 'failed' ? 'Chats come back after Sleep' : ''].filter(Boolean);
  lines.push(`Setup check failed: ${failed.join(', ')}`);
  lines.push('');
  lines.push(`afterterm ${opts.aftertermVersion} (${opts.installKind}), ${f?.os ?? 'Windows'} ${f?.build ?? ''}, ${f?.arch ?? process.arch}, ${f?.locale ?? ''}`.replace(/\s+,/g, ','));
  lines.push(`Claude Code ${r.claude.version ?? 'version unknown'} (${r.claude.install ?? 'unknown install'})`);
  lines.push('');
  if (f) {
    lines.push(`PowerShell: Windows PowerShell ${f.psVersion ?? '?'}${f.pwsh === false ? ' (pwsh not installed)' : f.pwsh ? ' (pwsh installed)' : ''}`);
    lines.push(`Language mode: ${f.languageMode ?? 'unknown'}`);
    lines.push('Execution policy:');
    for (const p of f.policies) lines.push(`  ${p.scope.padEnd(14)} ${p.policy}`);
    lines.push(`Antivirus: ${f.antivirus.length ? f.antivirus.join(', ') : 'unknown'}`);
    lines.push('');
  }
  if (s) {
    lines.push('Claude Code settings:');
    lines.push(`  settings.json: ${!s.exists ? 'missing' : s.valid ? 'valid' : 'not valid JSON'}`);
    lines.push(`  disableAllHooks: ${yes(s.disableAllHooks)}`);
    lines.push(`  managed settings: ${s.managed ?? 'none'}`);
    lines.push(`  afterterm helper registered: ${s.ourEvents} of ${HOOK_EVENTS.length} events`);
    lines.push(`  other hooks on those events: ${s.otherHooks}`);
    lines.push(`  helper script matches this version: ${yes(s.scriptMatches)}`);
    lines.push('');
  }
  r.tests.forEach((t, i) => {
    lines.push(`Test ${i + 1}, ${t.label} (${t.mode}):`);
    lines.push(`  ${t.command} ${t.args.join(' ')}`);
    lines.push(`  exit ${t.exit ?? 'none'}, session file ${t.fileWritten ? 'written' : 'not written'}, title ${t.titleReturned ? 'returned' : 'not returned'}`);
    if (t.stderr) lines.push(`  stderr: ${t.stderr}`);
  });
  if (r.tests.length === 0) lines.push('No test ran: afterterm\'s helper is not in Claude Code\'s settings.');
  lines.push('');
  lines.push(`afterterm data: claude-sessions has ${r.sessionsSaved} file${r.sessionsSaved === 1 ? '' : 's'}`);
  lines.push(`Notifications setting: ${r.notificationsPref}`);
  return anonymize(lines.join('\n'), homeDir);
}

// The new-issue page on GitHub, filled in. The user needs a GitHub account to
// submit it.
export const ISSUES_URL = 'https://github.com/afteraryan/afterterm/issues/new';

// Windows hands a URL to the browser through ShellExecute, which is only safe up to
// about 2,000 characters, so a long report is cut to fit (the end goes first:
// the summary, versions and policy table come first in it).
export const MAX_URL = 2000;

export function issueUrl(r: SetupCheckResult): string {
  const build = (report: string) => `${ISSUES_URL}?title=${encodeURIComponent(r.issueTitle)}&body=${encodeURIComponent('```\n' + report + '\n```\n')}`;
  let report = r.report;
  let url = build(report);
  while (url.length > MAX_URL && report.length > 0) {
    report = report.slice(0, Math.max(0, report.length - 100));
    url = build(report.trimEnd() + '\n(report shortened)');
  }
  return url;
}

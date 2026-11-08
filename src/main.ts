import { app, BrowserWindow, ipcMain, dialog, screen, shell, nativeImage, powerMonitor } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execFile, execFileSync, execSync, spawn } from 'child_process';
import * as pty from 'node-pty';
import {
  reconcileClaudeHook,
  hookReconcileAllowed,
  needsHookRepair,
  hookRepairWait,
  HOOK_REPAIR_LIMIT,
  HOOK_REPAIR_WINDOW_MS,
  HOOK_SCRIPT_NAME,
} from './claude-hook-install';
import type { ReconcileResult } from './claude-hook-install';
import { runSetupCheck, issueUrl, failureNote, ISSUES_URL } from './setup-check.ts';
import type { Runner } from './setup-check.ts';
import { initUpdater } from './updater.ts';
import { HANG_GRACE_MS, RELOAD_DELAY_MS, RELOAD_LIMIT, RELOAD_WINDOW_MS, afterChildGone, afterRendererGone, allowReload } from './window-recovery.ts';
import { detectEditors } from './editor-detect.ts';
import type { DetectDeps } from './editor-detect.ts';
import type { EditorInfo } from './editors.ts';
import { readPrefs, updatePrefs } from './prefs.ts';
import { planSpawn } from './shell-integration.ts';
import { readTranscriptMeta, isSessionId, findTranscript, projectDirName, transcriptPath } from './claude-transcript.ts';
import {
  CLAUDE_CWD_RE,
  RECORD_MAX_BYTES,
  holdLastGood,
  isRecordFileName,
  listRefreshPlan,
  parseSessionRecord,
  staleListPids,
  threadFeeds,
} from './claude-session-record.ts';
import type { HeldRecord, ListAsk, RecordRead, RecordStatus, SessionRecord } from './claude-session-record.ts';
import { gitInfo } from './git-info.ts';
import { isThreadId, parseTail, serializeTail, tailFilePath, trimTail } from './thread-tail.ts';
import {
  applyMsysParents,
  descendantPids,
  listenerKey,
  parseMsysPs,
  parseNetstatListeners,
  parseProcessList,
  shellHasChildren,
  tabPorts,
  trackFirstSeen,
} from './server-detect.ts';
import type { MsysProc, Proc as ServerProc } from './server-detect.ts';
import { createSessionFilesStore } from './session-files-store.ts';
import { EMPTY_SESSION_FILES, isAbsolutePath, isSafeForDefaultApp, normalizePath, ownsTempFile, pastedTempPath, transcriptUrls } from './session-files.ts';
import type { ChangedFile, ShellWindow } from './session-files.ts';
import { attributeCommandChanges, isIgnoredChange, mergeSaved, pruneChanges } from './command-files.ts';
import type { FsChange } from './command-files.ts';
import { buildNameIndex, findByName } from './file-index.ts';
import type { IndexFs, NameIndex } from './file-index.ts';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

// The test installer ("afterterm (test)", `npm run installer -- --sandbox`) ships
// resources\afterterm-sandbox.json, which turns that build into a throwaway copy
// that can run beside the real one: its own data folder, its own Claude Code
// settings folder (CLAUDE_CONFIG_DIR, which its terminals inherit, so its hook
// never touches the real ~/.claude) and, optionally, an execution policy forced on
// everything it starts, to reproduce a stock Windows machine (PSExecutionPolicyPreference
// is the Process scope). A normal build has no such file, and none of this runs.
interface SandboxConfig {
  userDataDir?: string;
  claudeDir?: string;
  executionPolicy?: string;
  appId?: string;
  // Start the sandbox's Claude settings with the hook entries 0.9.x wrote (no
  // -ExecutionPolicy Bypass), so a test install begins where Yogansh's machine did.
  seedLegacyHook?: boolean;
}
function expandEnvVars(s: string): string {
  return s.replace(/%([^%]+)%/g, (m, name) => process.env[name] ?? m);
}
function readSandboxConfig(): SandboxConfig | null {
  if (!app.isPackaged) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(process.resourcesPath, 'afterterm-sandbox.json'), 'utf-8')) as SandboxConfig;
  } catch {
    return null;
  }
}
const sandbox = readSandboxConfig();
if (sandbox?.userDataDir) app.setPath('userData', expandEnvVars(sandbox.userDataDir));
if (sandbox?.claudeDir) {
  const dir = expandEnvVars(sandbox.claudeDir);
  process.env.CLAUDE_CONFIG_DIR = dir;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const settingsPath = path.join(dir, 'settings.json');
    if (sandbox.seedLegacyHook && !fs.existsSync(settingsPath)) {
      const script = path.join(dir, 'hooks', HOOK_SCRIPT_NAME);
      const entry = (matcher: string) => [{ matcher, hooks: [{ type: 'command', command: 'powershell', args: ['-NoProfile', '-File', script] }] }];
      const hooks = { SessionStart: entry(''), UserPromptSubmit: entry(''), Notification: entry('permission_prompt'), Stop: entry(''), PreCompact: entry('') };
      fs.writeFileSync(settingsPath, JSON.stringify({ hooks }, null, 2) + '\n', 'utf-8');
    }
  } catch { /* the sandbox runs without it */ }
}
if (sandbox?.executionPolicy) process.env.PSExecutionPolicyPreference = sandbox.executionPolicy;

// The id Windows groups windows, taskbar pins and Start menu shortcuts by. The
// installer stamps the same id on the shortcuts it creates (electron-builder's
// appId), so a pinned shortcut and the running window are one taskbar icon. Before
// 0.10.0 none was set. Packaged builds only: a dev run must not join the real app's
// taskbar button.
const APP_USER_MODEL_ID = sandbox?.appId ?? 'com.afterterm.app';
if (app.isPackaged) app.setAppUserModelId(APP_USER_MODEL_ID);

// Dev/test isolation: point userData (session.json, prefs.json) at a throwaway dir
// so a dev run can't clobber the user's real, possibly-running build. Must be set
// before any app.getPath('userData') call. No-op in normal use.
if (process.env.AFTERTERM_USER_DATA_DIR) {
  app.setPath('userData', process.env.AFTERTERM_USER_DATA_DIR);
}

// Installer mode. The installer runs `afterterm.exe --setup-check=<file>` once,
// after copying the app: register the Claude Code hook, test that it runs, write
// the answer for its "Checking Claude Code" page, and exit without a window. And
// `--open-issue=<file>` opens the filled-in GitHub issue its "Report issue" button
// asks for. See runSetupCheckCli below.
const setupCheckOut = process.argv.find(a => a.startsWith('--setup-check='))?.slice('--setup-check='.length);
const openIssueFile = process.argv.find(a => a.startsWith('--open-issue='))?.slice('--open-issue='.length);
if (setupCheckOut || openIssueFile) app.disableHardwareAcceleration();

// One running copy per data folder. A second launch (a second taskbar pin, a
// double click on the exe while afterterm is open) only brings the open window
// forward and exits: two copies on one session.json overwrite each other's
// projects and threads (seen after 0.10.0 changed the app id, 2026-10-30).
// Electron keys the lock to the userData folder, which is set above, so a harness
// run or the "afterterm (test)" build, each with its own folder, still runs beside
// the real app. The installer's --setup-check and --open-issue runs take no lock:
// they run while afterterm may be open and exit on their own.
const isPrimaryCopy = setupCheckOut || openIssueFile ? true : app.requestSingleInstanceLock();
if (!isPrimaryCopy) app.exit(0);

// Test probe for launch lag: AFTERTERM_LAG_PROBE=1 logs every stall of the main
// thread over 30 ms during the first 15 seconds, then the worst one. The main
// thread also answers Windows' system-wide mouse hook (the toast overlay's
// click-through), so a stall here freezes the mouse everywhere, which is what
// Yogansh saw at launch (2026-10-29).
if (process.env.AFTERTERM_LAG_PROBE === '1') {
  const start = Date.now();
  let last = start;
  let worst = 0;
  const probe = setInterval(() => {
    const now = Date.now();
    const stall = now - last - 10;
    if (stall > 30) console.log(`[lag] main thread stalled ${stall} ms at +${now - start} ms`);
    worst = Math.max(worst, stall);
    last = now;
    if (now - start > 15000) {
      clearInterval(probe);
      console.log(`[lag] worst stall in the first 15 s: ${worst} ms`);
    }
  }, 10);
}

// Agent harness: expose the Chrome DevTools Protocol so scripts/agent-harness can
// drive and screenshot the renderer. Opt-in only: an open debugging port lets any
// local process read and script the app, so it must never be on for normal users.
// Chromium reads the switch at startup, hence module top level, before app ready.
if (process.env.AFTERTERM_REMOTE_DEBUG_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.AFTERTERM_REMOTE_DEBUG_PORT);
}

// Agent harness: AFTERTERM_DISPLAY picks the display every window (main and the
// notifier overlay) is placed on, so an automated dev run stays off the monitor a
// person is working on. Values: "primary" (default), "secondary" (the first
// non-primary display, falling back to primary when there is only one) or an
// integer index into screen.getAllDisplays(). Unset means the behaviour normal
// users get, which is unchanged. The notifier overlay follows the main window
// instead (notifierDisplay below) and only reads this before that window exists.
function getTargetDisplay(): Electron.Display {
  const want = (process.env.AFTERTERM_DISPLAY ?? 'primary').trim().toLowerCase();
  const primary = screen.getPrimaryDisplay();
  if (want === '' || want === 'primary') return primary;
  const all = screen.getAllDisplays();
  if (want === 'secondary') return all.find(d => d.id !== primary.id) ?? primary;
  const index = Number.parseInt(want, 10);
  if (Number.isInteger(index) && index >= 0 && index < all.length) return all[index];
  console.warn(`[afterterm] AFTERTERM_DISPLAY=${want} is not a display; using primary`);
  return primary;
}

// ─── Shell profiles ───────────────────────────────────────────────────────────

interface ShellProfile {
  id: string;
  name: string;
  command: string;
  args: string[];
}

let cachedShells: ShellProfile[] | null = null;

function detectShells(): ShellProfile[] {
  if (cachedShells) return cachedShells;

  const shells: ShellProfile[] = [
    { id: 'cmd', name: 'Command Prompt', command: 'cmd.exe', args: [] },
  ];

  // Looked up on PATH directly rather than through `where.exe`: starting a process
  // here held the main thread on every launch (launch lag, 2026-10-29).
  if (onPath('pwsh.exe')) {
    shells.push({ id: 'pwsh', name: 'PowerShell 7', command: 'pwsh.exe', args: [] });
  }

  shells.push({ id: 'powershell', name: 'Windows PowerShell', command: 'powershell.exe', args: [] });

  const gitBashPaths = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  ];
  for (const p of gitBashPaths) {
    if (fs.existsSync(p)) {
      shells.push({ id: 'gitbash', name: 'Git Bash', command: p, args: ['--login', '-i'] });
      break;
    }
  }

  if (onPath('wsl.exe')) {
    shells.push({ id: 'wsl', name: 'WSL', command: 'wsl.exe', args: [] });
  }

  cachedShells = shells;
  return shells;
}

// Whether `file` is in a folder on PATH, the way `where.exe` finds it. lstat, not
// existsSync: a Microsoft Store install (PowerShell 7 from the Store) puts an
// "app execution alias" on PATH, a link that existsSync and stat report as
// missing (EACCES) although running it works.
function onPath(file: string): boolean {
  const dirs = (process.env.Path ?? process.env.PATH ?? '').replace(/"/g, '').split(';');
  return dirs.some(dir => {
    if (!dir.trim()) return false;
    try { fs.lstatSync(path.join(dir.trim(), file)); return true; } catch { return false; }
  });
}

function getShellById(id?: string): ShellProfile {
  const shells = detectShells();
  if (id) {
    const found = shells.find(s => s.id === id);
    if (found) return found;
  }
  return shells[0];
}

// ─── PTY tracking ─────────────────────────────────────────────────────────────

const ptys = new Map<string, pty.IPty>();
let mainWindow: BrowserWindow | null = null;
let notifierWindow: BrowserWindow | null = null;

// ─── PTY activity stamping ────────────────────────────────────────────────────

// A thread's lastActiveAt is stamped whenever its terminal has input or output.
// A busy shell produces output many times a second, so the renderer is told at
// most once per tab per 15 seconds: the first activity after a quiet period is
// sent straight away, then everything is suppressed until the window passes.
// The cost per chunk is one Map lookup and a Date.now(), nothing allocated.
const ACTIVITY_INTERVAL_MS = 15_000;
// A shell prints its banner and prompt the moment it spawns, and a restored chat
// gets `claude --resume` typed into it by the app. Neither is the user doing
// anything, and on a relaunch every thread would otherwise read "now" at once and
// Home's ordering would be lost. Activity in the first seconds of a PTY's life is
// not stamped; activation already stamps the thread the user actually opened.
const ACTIVITY_GRACE_MS = 5_000;
const lastActivitySent = new Map<string, number>();
const ptyCreatedAt = new Map<string, number>();

function noteActivity(tabId: string): void {
  const now = Date.now();
  const created = ptyCreatedAt.get(tabId);
  if (created !== undefined && now - created < ACTIVITY_GRACE_MS) return;
  const last = lastActivitySent.get(tabId);
  if (last !== undefined && now - last < ACTIVITY_INTERVAL_MS) return;
  lastActivitySent.set(tabId, now);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('pty:activity', { tabId, at: now });
  }
}

// ─── Server watcher: which thread is listening on which port ─────────────────

// A thread running a dev server should say so, with its port, within a couple of
// seconds of the server printing "ready". Getting there means joining two lists:
// the listening TCP sockets with their owning pids, and every process with its
// parent, so a tab's shell pid can be expanded into the tree of things it started
// (`npm start` is cmd.exe, then npm's node, then the server's node). The pure
// parsing and the tree walk live in server-detect.ts; this is only the plumbing.
//
// The two commands cost very different amounts on Windows, and that shapes the
// whole design. Measured on this machine:
//   netstat -ano                          about 45 ms
//   powershell.exe ... Get-CimInstance    about 1 s (a fresh PowerShell start)
//   Get-NetTCPConnection                  about 1.5 s, so it is not used
//   wmic                                  not present on this Windows at all
// So netstat runs on every poll, and the process list is only re-read when the set
// of listening sockets actually changed, when a PTY has been created or destroyed
// since the last read, or when the cache is over a minute old.
//
// Git Bash needs a third list. An MSYS program execs through a fork stub that exits
// immediately, so anything a Git Bash thread starts is left with a Windows parent pid
// that no longer exists: the walk from the shell pid stops at the interactive bash and
// a server started there is neither matched to the thread nor killed with it. MSYS's
// own process table still records the true parent, so for a live Git Bash tab the
// bundled `<git root>\usr\bin\ps.exe -l` is read too (about 55 ms) and its edges are
// folded into the Windows list by applyMsysParents. Native processes below the gap
// (npm's node, cmd, the server) keep intact Windows links, so bridging the MSYS edges
// is enough. ps.exe never runs when no Git Bash tab is live.

const SERVER_POLL_MS = 10_000;
// A server prints its banner and then goes quiet; polling shortly after the last
// output chunk is what makes the port appear right after "ready".
const SERVER_BURST_DELAY_MS = 700;
// A chatty program (a build watcher, a test runner) must not turn that into a poll
// loop, so burst polls are rate limited.
const SERVER_BURST_MIN_GAP_MS = 2_000;
// How long a cached process list may be reused when nothing looks like it changed.
const SERVER_PROC_MAX_AGE_MS = 60_000;

const PROC_LIST_COMMAND =
  'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,'
  + "@{n='c';e={[DateTimeOffset]::new($_.CreationDate).ToUnixTimeMilliseconds()}}"
  + ' | ConvertTo-Json -Compress';
// Single quotes inside the command on purpose: the argument is passed through
// execFile, and Node wraps an argument containing double quotes in a way PowerShell
// does not always unpick. PowerShell treats 'c' and "c" the same here.

/**
 * What a live tab's shell is: its pid, which shell profile it came from, and the
 * executable it was spawned with. The shell id and command are what the Git Bash
 * repair needs (which tabs are MSYS, and where that install's ps.exe lives).
 */
interface ShellInfo {
  pid: number;
  shellId: string;
  command: string;
}

const shellPids = new Map<string, ShellInfo>();
const lastPortSent = new Map<string, number | null>();

/** Just the pids, which is the shape tabPorts takes. */
function shellPidMap(): Map<string, number> {
  const out = new Map<string, number>();
  for (const [tabId, info] of shellPids) out.set(tabId, info.pid);
  return out;
}

/**
 * The MSYS `ps.exe` that ships beside a Git Bash: the profile command is
 * `<git root>\bin\bash.exe`, so ps is `<git root>\usr\bin\ps.exe`. Null when it is
 * not there, which is the signal to skip the repair entirely.
 */
function msysPsPath(shellCommand: string): string | null {
  if (!shellCommand) return null;
  try {
    const candidate = path.join(path.dirname(path.dirname(shellCommand)), 'usr', 'bin', 'ps.exe');
    return fs.existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

/** The ps.exe of the first live Git Bash tab, or null when no such tab exists. */
function liveMsysPsPath(): string | null {
  for (const info of shellPids.values()) {
    if (info.shellId !== 'gitbash') continue;
    const ps = msysPsPath(info.command);
    if (ps) return ps;
  }
  return null;
}

/** Read MSYS's process table. Returns an empty list on any failure, warning once. */
async function readMsysProcs(psPath: string, reason: string): Promise<MsysProc[]> {
  try {
    return parseMsysPs(await runCommand(psPath, ['-l'], 4 * 1024 * 1024, 5_000));
  } catch (err) {
    if (!warnedMsysPs) {
      warnedMsysPs = true;
      console.warn(`[servers] MSYS ps failed (${reason}), Git Bash trees stay unbridged:`, err);
    }
    return [];
  }
}
// When each listening socket ("pid:port") was first seen, so a tree listening on
// several ports can show the one that started latest, which is the one the user just
// started. trackFirstSeen adds and prunes entries; portForTree reads them.
const listenerFirstSeen = new Map<string, number>();

let cachedProcs: ServerProc[] = [];
// MSYS's own parent links, read alongside cachedProcs and with the same lifetime.
// Empty when no Git Bash tab is live, or when ps.exe could not be run.
let cachedMsys: MsysProc[] = [];
let cachedProcsAt = 0;
let lastListenerKey: string | null = null;
// Set whenever a PTY appears or disappears: the cached process list cannot describe
// a tree that did not exist when it was taken.
let treeDirty = true;

let pollRunning = false;
let pollAgain = false;
// Callers waiting for the next poll to finish (nextPollDone).
let pollWaiters: Array<() => void> = [];
let serverPollTimer: NodeJS.Timeout | null = null;
let burstTimer: NodeJS.Timeout | null = null;
let lastBurstPollAt = 0;
// Warn once per failure kind: a machine without netstat would otherwise fill the log.
let warnedNetstat = false;
let warnedProcList = false;
let warnedMsysPs = false;

function runCommand(file: string, args: string[], maxBuffer: number, timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, maxBuffer, timeout }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

function sendPort(tabId: string, port: number | null): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('pty:port', { tabId, port });
  }
}

async function pollServers(reason: string): Promise<void> {
  if (pollRunning) { pollAgain = true; return; }
  pollRunning = true;
  try {
    if (ptys.size === 0) {
      cachedProcs = [];
      cachedMsys = [];
      cachedProcsAt = 0;
      lastListenerKey = null;
      // No shells means no trees to match, and any listener still up belongs to
      // something else. Keeping stale times would date the next shell's server wrong.
      listenerFirstSeen.clear();
      return;
    }

    let listeners: ReturnType<typeof parseNetstatListeners>;
    try {
      listeners = parseNetstatListeners(
        await runCommand('netstat', ['-ano'], 8 * 1024 * 1024, 10_000),
      );
    } catch (err) {
      if (!warnedNetstat) {
        warnedNetstat = true;
        console.warn(`[servers] netstat failed (${reason}), ports left as they were:`, err);
      }
      return;
    }

    trackFirstSeen(listenerFirstSeen, listeners, Date.now());

    const key = listenerKey(listeners);
    const stale = Date.now() - cachedProcsAt > SERVER_PROC_MAX_AGE_MS;
    if (key !== lastListenerKey || treeDirty || stale || cachedProcs.length === 0) {
      // The flag is taken when the read starts, not when it ends, so a tree marked
      // dirty while the read runs (a PTY created, a Claude session record naming a
      // process this read may have missed) gets the queued re-run's read too. For the
      // same reason cachedProcsAt is when the read started: the list holds every
      // process that existed by then.
      const readStartedAt = Date.now();
      treeDirty = false;
      try {
        const json = await runCommand(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', PROC_LIST_COMMAND],
          16 * 1024 * 1024,
          15_000,
        );
        cachedProcs = parseProcessList(json);
        // Only when a Git Bash tab is live, and only on the polls that actually
        // re-read the process list, so the two lists never date apart.
        const psPath = liveMsysPsPath();
        cachedMsys = psPath ? await readMsysProcs(psPath, reason) : [];
        cachedProcsAt = readStartedAt;
      } catch (err) {
        // Nothing was read, so whatever made the tree dirty still stands.
        treeDirty = true;
        if (!warnedProcList) {
          warnedProcList = true;
          console.warn(`[servers] process list failed (${reason}), ports left as they were:`, err);
        }
        return;
      }
    }
    lastListenerKey = key;

    // The Git Bash bridge: with no MSYS rows this is cachedProcs unchanged.
    const procs = cachedMsys.length > 0 ? applyMsysParents(cachedProcs, cachedMsys) : cachedProcs;

    if (process.env.AFTERTERM_HARNESS === '1' && cachedMsys.length > 0) {
      for (const [tabId, info] of shellPids) {
        if (info.shellId !== 'gitbash') continue;
        const tree = descendantPids(procs, info.pid);
        if (tree.size > 1) {
          console.log(`[harness] msys tree ${tabId} pids=${[...tree].join(',')}`);
        }
      }
    }

    for (const [tabId, port] of tabPorts(shellPidMap(), procs, listeners, listenerFirstSeen)) {
      if (lastPortSent.get(tabId) === port) continue;
      lastPortSent.set(tabId, port);
      sendPort(tabId, port);
    }
  } finally {
    pollRunning = false;
    if (pollAgain) {
      pollAgain = false;
      // The waiters wait on this re-run: it is the one that answers their request.
      void pollServers('a poll was requested while one was running');
    } else {
      const waiters = pollWaiters;
      pollWaiters = [];
      for (const done of waiters) done();
    }
  }
}

/**
 * Resolves when the next poll to finish has finished, including a re-run queued while
 * one was running, or after `timeoutMs` at the latest. A caller that has just asked
 * for a fresh process list (treeDirty plus pollServers) awaits this, because
 * pollServers itself returns at once when a poll is already running.
 */
function nextPollDone(timeoutMs: number): Promise<void> {
  return new Promise<void>(resolve => {
    const timer = setTimeout(resolve, timeoutMs);
    pollWaiters.push(() => { clearTimeout(timer); resolve(); });
  });
}

function startServerPolling(): void {
  // Claude Code's session records are read on the same lifetime: while any PTY is alive.
  startClaudeRecordPolling();
  if (serverPollTimer) return;
  serverPollTimer = setInterval(() => {
    if (ptys.size === 0) { stopServerPolling(); return; }
    void pollServers('the slow interval');
  }, SERVER_POLL_MS);
}

function stopServerPolling(): void {
  if (serverPollTimer) { clearInterval(serverPollTimer); serverPollTimer = null; }
  if (burstTimer) { clearTimeout(burstTimer); burstTimer = null; }
  stopClaudeRecordPolling();
}

/**
 * Called from the 16 ms output flush. Schedules one poll for shortly after the last
 * chunk of a burst, never more often than SERVER_BURST_MIN_GAP_MS. The cost per chunk
 * is one Date.now() and one timer reschedule.
 */
function noteOutputForServers(): void {
  const now = Date.now();
  const sinceLast = now - lastBurstPollAt;
  const delay = sinceLast >= SERVER_BURST_MIN_GAP_MS
    ? SERVER_BURST_DELAY_MS
    : Math.max(SERVER_BURST_DELAY_MS, SERVER_BURST_MIN_GAP_MS - sinceLast);
  if (burstTimer) clearTimeout(burstTimer);
  burstTimer = setTimeout(() => {
    burstTimer = null;
    lastBurstPollAt = Date.now();
    void pollServers('an output burst settled');
  }, delay);
}

/** A tab's PTY has gone: forget it, and clear its port and its Claude status in the UI straight away. */
function forgetServerTab(tabId: string): void {
  shellPids.delete(tabId);
  treeDirty = true;
  const last = lastPortSent.get(tabId);
  lastPortSent.delete(tabId);
  if (typeof last === 'number') sendPort(tabId, null);
  forgetRecordTab(tabId);
}

/** taskkill a pid and its Windows subtree. Never rejects: a dead pid is normal. */
function taskkillTree(pid: number): Promise<void> {
  return new Promise<void>(resolve => {
    execFile(
      'taskkill',
      ['/PID', String(pid), '/T', '/F'],
      { windowsHide: true, timeout: 5_000 },
      () => resolve(),
    );
  });
}

/**
 * Kill a tab's shell and everything it started.
 *
 * `taskkill /T` walks the same Windows parent links the server watcher does, so for a
 * Git Bash tab it stops at the interactive bash and leaves anything below the MSYS
 * fork gap running (a dev server outliving the thread that started it, seen in the
 * harness). So for a gitbash tab MSYS's table is read first, while the shell is still
 * alive and its rows still exist, merged with the last process list, and every pid in
 * the resulting tree is killed after the shell itself. The process list may be stale,
 * which is fine: the MSYS rows are fresh and the Windows links below them rarely move.
 *
 * Nothing here throws and the whole thing is bounded, so a close is never held up by
 * a hung kill. Non-gitbash tabs get exactly the single taskkill they always got.
 */
async function killTree(tabId: string, pid: number, info: ShellInfo | undefined): Promise<void> {
  const isGitBash = info?.shellId === 'gitbash';
  const psPath = isGitBash ? msysPsPath(info!.command) : null;
  const rows = psPath ? await readMsysProcs(psPath, `closing ${tabId}`) : [];

  await taskkillTree(pid);

  if (rows.length === 0 || cachedProcs.length === 0) return;
  const tree = descendantPids(applyMsysParents(cachedProcs, rows), pid);
  const rest = [...tree].filter(p => p !== pid);
  if (rest.length === 0) return;
  if (process.env.AFTERTERM_HARNESS === '1') {
    console.log(`[harness] msys tree ${tabId} pids=${[...tree].join(',')}`);
  }
  await Promise.all(rest.map(p => taskkillTree(p)));
}

// ─── Claude Code's session record: each thread's session id and live status ───

// Claude Code keeps `<Claude folder>\sessions\<pid>.json` for every running claude.exe
// (claude-session-record.ts says what is in it and how each value is checked). Read
// every two seconds while a PTY is alive, it gives a thread whose shell runs a Claude
// two things the hooks give only when they run: the session id, so a chat with no
// hooks is still a chat and resumes, and a live status (busy, idle, waiting, shell),
// which the renderer keeps on the tab and never saves. The hooks stay the fallback.
//
// Cost: listing the folder and reading a handful of small files. The process tree
// comes from the server watcher's cached list, never a PowerShell of its own, and the
// running check (process.kill with signal 0) is made only for Claudes in afterterm's
// own threads and for the few records the list is out of step with: a claude.exe
// started since the list was taken, or a new one on a pid the list knows as another
// process. Such a record asks the watcher for a fresh list, at most every 10 seconds,
// and only once per pid (listRefreshPlan).

const CLAUDE_RECORD_POLL_MS = 2_000;
const CLAUDE_RECORD_REFRESH_MIN_GAP_MS = 10_000;
// How long a fresh pass (the restart window opening) waits for the process list it
// asked for. One poll can take up to 30 seconds (netstat 10, PowerShell 15, ps 5), and
// the wait can span a poll already running plus the re-run queued behind it, so this
// limit can be what ends the wait. Then the pass matches against the list it already
// had, which is what a timer pass does anyway.
const CLAUDE_RECORD_FRESH_WAIT_MS = 20_000;
// A folder holding more files than this is read only this far, so a tick stays cheap
// whatever is in it.
const CLAUDE_RECORD_MAX_FILES = 200;
// A session whose transcript is not at the expected place may have moved worktree, so
// every project folder is searched for it (findTranscript), but at most this often.
const TRANSCRIPT_RESCAN_MS = 30_000;

let claudeRecordTimer: NodeJS.Timeout | null = null;
let claudeRecordTick: Promise<void> | null = null;
let lastRecordListRefreshAt = 0;
let warnedClaudeRecords = false;
let warnedShellChildren = false;
// Each record file's last good read, standing in while the file is caught mid-write.
let heldRecords = new Map<string, HeldRecord>();
// The pids a fresh process list was asked for, and which of those asking has stopped for.
let listAsks = new Map<number, ListAsk>();
// Per thread, what this reader last sent: the id (each is sent once) and the status
// (sent only when it changes). Dropped when the thread's PTY goes (forgetRecordTab).
const recordSessionSent = new Map<string, string>();
const recordStatusSent = new Map<string, RecordStatus | null>();
// Per thread, whether its shell has a process below it, as last sent on `pty:children`
// (plan-02, Fix 8). Each record tick walks the same cached list for it, as its own
// step after the pass (runClaudeRecordTick), so it costs one tree walk per shell. It
// is the restart window's fallback for a shell with no prompt
// marks, and only a true counts there.
const shellChildrenSent = new Map<string, boolean | null>();
// The list is re-read on the first server poll after it is SERVER_PROC_MAX_AGE_MS old,
// so a healthy list can be up to a poll interval and the read itself older than that.
// Past this the reads are failing, and the tree is not trusted to say anything.
const SHELL_CHILDREN_MAX_AGE_MS = SERVER_PROC_MAX_AGE_MS + 2 * SERVER_POLL_MS;
// Sessions whose transcript has been seen (one never goes away), and when each one
// not yet seen was last searched for across the project folders.
const transcriptsSeen = new Set<string>();
const transcriptMissAt = new Map<string, number>();

function startClaudeRecordPolling(): void {
  if (claudeRecordTimer) return;
  claudeRecordTimer = setInterval(() => {
    if (ptys.size === 0) { stopClaudeRecordPolling(); return; }
    void runClaudeRecordTick(false);
  }, CLAUDE_RECORD_POLL_MS);
}

function stopClaudeRecordPolling(): void {
  if (claudeRecordTimer) { clearInterval(claudeRecordTimer); claudeRecordTimer = null; }
}

/**
 * True while the pid is a running process: the cached list can be a minute old, and a
 * hard-killed Claude leaves its record behind for a while. Signal 0 sends nothing, it
 * only asks; Claude Code checks its own records the same way. Windows answers for the
 * multiple of 4 at or below the number asked about, which is why record names that are
 * not a multiple of 4 are refused (isRecordFileName).
 */
function pidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means it exists and is just not ours to signal.
    return (err as NodeJS.ErrnoException)?.code !== 'ESRCH';
  }
}

/**
 * Every record file in the folder, read and validated: one entry per file, with a null
 * record when the read or the parse failed (holdLastGood decides what that means).
 * Only record names are opened (isRecordFileName): the `<pid>.<hash>.key` files beside
 * them hold a token and are never read. Plain files only, so a link placed in the
 * folder is not followed.
 */
function readSessionRecords(dir: string): RecordRead[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const out: RecordRead[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !isRecordFileName(entry.name)) continue;
    if (out.length >= CLAUDE_RECORD_MAX_FILES) break;
    const file = path.join(dir, entry.name);
    let record: SessionRecord | null = null;
    try {
      if (fs.statSync(file).size <= RECORD_MAX_BYTES) {
        record = parseSessionRecord(fs.readFileSync(file, 'utf-8'), entry.name);
      }
    } catch { /* gone since the listing, or mid-write: the next tick reads it */ }
    out.push({ name: entry.name, record });
  }
  return out;
}

/**
 * Whether a session has a transcript, which is what makes its id safe to resume. The
 * expected place is checked every tick (one stat); the search of every project folder
 * runs at most every TRANSCRIPT_RESCAN_MS per session.
 */
function recordTranscriptExists(sessionId: string, cwd: string): boolean {
  if (transcriptsSeen.has(sessionId)) return true;
  const projectsDir = getClaudeProjectsDir();
  let found = false;
  try { found = fs.existsSync(transcriptPath(projectsDir, cwd, sessionId)); } catch { found = false; }
  if (!found) {
    const now = Date.now();
    if (now - (transcriptMissAt.get(sessionId) ?? 0) < TRANSCRIPT_RESCAN_MS) return false;
    if (transcriptMissAt.size > 500) transcriptMissAt.clear();
    transcriptMissAt.set(sessionId, now);
    found = findTranscript(projectsDir, cwd, sessionId, fs) !== null;
  }
  if (found) {
    if (transcriptsSeen.size > 1000) transcriptsSeen.clear();
    transcriptsSeen.add(sessionId);
    transcriptMissAt.delete(sessionId);
  }
  return found;
}

/** The cached process list with Git Bash's MSYS parents applied, as pollServers uses it. */
function bridgedProcs(): ServerProc[] {
  return cachedMsys.length > 0 ? applyMsysParents(cachedProcs, cachedMsys) : cachedProcs;
}

function sendRecordStatus(tabId: string, status: RecordStatus | null): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('claude-record:status', { tabId, status });
  }
}

function sendShellChildren(tabId: string, hasChildren: boolean | null): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('pty:children', { tabId, hasChildren });
  }
}

/**
 * Each live shell's hasChildren from the cached list, sent when it changes. null when
 * the list is too old or empty, or cannot place the shell (shellHasChildren).
 */
function sendShellChildrenChanges(): void {
  const fresh = cachedProcs.length > 0 && Date.now() - cachedProcsAt <= SHELL_CHILDREN_MAX_AGE_MS;
  const procs = fresh ? bridgedProcs() : [];
  for (const [tabId, info] of shellPids) {
    const value = fresh ? shellHasChildren(procs, info.pid, info.shellId) : null;
    if ((shellChildrenSent.get(tabId) ?? null) === value) continue;
    shellChildrenSent.set(tabId, value);
    sendShellChildren(tabId, value);
    if (process.env.AFTERTERM_HARNESS === '1') {
      console.log(`[harness] shell children ${tabId} hasChildren=${value === null ? 'unknown' : value}`);
    }
  }
}

async function claudeRecordPass(fresh: boolean): Promise<void> {
  if (shellPids.size === 0) return;
  // A file caught mid-write keeps its last good record for a tick or two, so the
  // status does not blip to null (which would read as "not mid-turn").
  const merged = holdLastGood(readSessionRecords(getClaudeSessionsDir()), heldRecords);
  heldRecords = merged.held;
  let records = merged.records;
  // Each pid is asked about once per pass.
  const running = new Map<number, boolean>();
  const isRunning = (pid: number) => {
    let alive = running.get(pid);
    if (alive === undefined) { alive = pidRunning(pid); running.set(pid, alive); }
    return alive;
  };

  // A claude.exe the list is out of step with cannot be placed in its tree until the
  // list is read again. The server watcher reads it; a fresh pass (the restart window
  // opening) waits for that read, a timer pass picks the result up next time.
  const now = Date.now();
  const plan = listRefreshPlan(
    records.length > 0 ? staleListPids(records, bridgedProcs(), isRunning) : [],
    listAsks,
    cachedProcsAt,
    now,
    fresh || now - lastRecordListRefreshAt >= CLAUDE_RECORD_REFRESH_MIN_GAP_MS,
  );
  listAsks = plan.asked;
  // A fresh pass also waits on a list asked for on an earlier pass and not read yet;
  // asking again makes sure a read is running or queued for it to wait on.
  const mustWait = fresh && (plan.ask.length > 0 || plan.waiting);
  if (plan.ask.length > 0) lastRecordListRefreshAt = now;
  if (plan.ask.length > 0 || mustWait) {
    treeDirty = true;
    // Taken before the poll is asked for, so a poll that finishes at once still counts.
    const done = mustWait ? nextPollDone(CLAUDE_RECORD_FRESH_WAIT_MS) : null;
    void pollServers('a Claude session record names a process the list does not know yet');
    if (done) {
      await done;
      // The wait can be many seconds: match what the records say now, not before it,
      // and ask the system again whether each pid is running.
      const again = holdLastGood(readSessionRecords(getClaudeSessionsDir()), heldRecords);
      heldRecords = again.held;
      records = again.records;
      running.clear();
    }
  }

  // Read after any await above, so a tab whose PTY went meanwhile is not in it.
  const feeds = threadFeeds({
    records,
    shellPids: shellPidMap(),
    procs: bridgedProcs(),
    transcriptExists: recordTranscriptExists,
    isRunning,
  });
  for (const [tabId, feed] of feeds) {
    let sent = false;
    if ((recordStatusSent.get(tabId) ?? null) !== feed.status) {
      recordStatusSent.set(tabId, feed.status);
      sendRecordStatus(tabId, feed.status);
      sent = true;
    }
    // Decision 3 (plan-02): the last id stays when the record goes, so only a new id
    // is ever sent, never a clear.
    if (feed.sessionId && feed.cwd && recordSessionSent.get(tabId) !== feed.sessionId) {
      recordSessionSent.set(tabId, feed.sessionId);
      // One thread's push failing must not hold up the others.
      try { pushClaudeSession(tabId, feed.sessionId, feed.cwd); } catch { recordSessionSent.delete(tabId); }
      sent = true;
    }
    // A tester can confirm the reader only ever matches a claude.exe in its own threads' trees.
    if (sent && process.env.AFTERTERM_HARNESS === '1') {
      console.log(`[harness] claude-record ${tabId} pid=${feed.pid ?? 'none'} status=${feed.status ?? 'none'} session=${feed.sessionId ? feed.sessionId.slice(0, 8) : 'none'}`);
    }
  }
}

/**
 * One pass, never two at once, never throwing. A timer pass is skipped while one is
 * running; a fresh pass (claude-record:refresh) waits for the running one and then
 * runs its own, so the records it resolves after were read after it was asked for.
 * When the process list is out of step with a record, the fresh pass also waits for
 * the next process list read to complete (nextPollDone, which covers a read already
 * running or queued behind one) before it matches, up to CLAUDE_RECORD_FRESH_WAIT_MS.
 */
function runClaudeRecordTick(fresh: boolean): Promise<void> {
  if (claudeRecordTick) {
    return fresh ? claudeRecordTick.then(() => runClaudeRecordTick(true)) : claudeRecordTick;
  }
  const pass: Promise<void> = claudeRecordPass(fresh)
    .catch(err => {
      if (!warnedClaudeRecords) {
        warnedClaudeRecords = true;
        console.warn('[claude-record] a pass failed, statuses left as they were:', err);
      }
    })
    // Its own step, run whether or not the pass threw: a failing pass must never
    // leave the renderer holding an old hasChildren past SHELL_CHILDREN_MAX_AGE_MS.
    .then(() => sendShellChildrenChanges())
    .catch(err => {
      if (!warnedShellChildren) {
        warnedShellChildren = true;
        console.warn('[shell-children] sending what each shell runs failed:', err);
      }
    })
    .finally(() => { if (claudeRecordTick === pass) claudeRecordTick = null; });
  claudeRecordTick = pass;
  return pass;
}

/** A tab's PTY has gone, and its Claude with it: say so once, and forget what was sent. */
function forgetRecordTab(tabId: string): void {
  const last = recordStatusSent.get(tabId) ?? null;
  recordStatusSent.delete(tabId);
  recordSessionSent.delete(tabId);
  if (last !== null) sendRecordStatus(tabId, null);
  const lastChildren = shellChildrenSent.get(tabId) ?? null;
  shellChildrenSent.delete(tabId);
  if (lastChildren !== null) sendShellChildren(tabId, null);
}

// A fresh read on demand: the renderer asks when the restart window opens, so its rows
// start from what Claude Code says now. Resolves when the pass is done.
// It also asks for a fresh process list, not waited for: a shell with no prompt marks
// is judged by its process tree, and the cached list can be a minute old. The next
// timer pass after that read sends what has changed, and the rows follow.
ipcMain.handle('claude-record:refresh', async () => {
  await runClaudeRecordTick(true);
  treeDirty = true;
  void pollServers('the restart window opened');
});

// ─── Window creation ──────────────────────────────────────────────────────────

function getIconPath() {
  const isDev = !!MAIN_WINDOW_VITE_DEV_SERVER_URL;
  const iconName = isDev ? 'icon-dev.ico' : 'icon.ico';
  if (isDev) {
    return path.join(app.getAppPath(), 'assets', iconName);
  }
  return path.join(process.resourcesPath, 'assets', iconName);
}

// Bundled afterterm-notify.ps1: alongside icons under assets/ in dev,
// under resourcesPath/assets in a packaged build (forge extraResource: ['assets']).
function getHookScriptSource() {
  const isDev = !!MAIN_WINDOW_VITE_DEV_SERVER_URL;
  const base = isDev ? app.getAppPath() : process.resourcesPath;
  return path.join(base, 'assets', 'hooks', HOOK_SCRIPT_NAME);
}

// Register (or reconcile) afterterm's Claude Code notifier hook on startup, then
// fire a one-time toast the first time it's installed so the user knows their
// Claude config was touched. Idempotent + opt-out aware — see claude-hook-install.ts.
// Claude Code's own folder: CLAUDE_CONFIG_DIR when set (Claude Code honours it, and
// the sandbox build sets it), else ~/.claude.
function getClaudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(app.getPath('home'), '.claude');
}

function reconcileNotifierHook(): ReconcileResult | null {
  // A test launch (AFTERTERM_USER_DATA_DIR set) that does not name its own Claude
  // folder (CLAUDE_CONFIG_DIR) must not touch the real one: its throwaway prefs.json
  // can hold an opt-out that would strip the real hooks (2026-11-06). The check sits
  // here, not in the callers, so startup and the setup check both get it, and it
  // covers the hook script copy as well as the entries. The sandbox build
  // sets CLAUDE_CONFIG_DIR itself before this runs, so it still installs into its own folder.
  if (!hookReconcileAllowed(process.env)) {
    console.log('[claude-hook] skipped: this is a test launch (AFTERTERM_USER_DATA_DIR is set) with no CLAUDE_CONFIG_DIR, so the real Claude folder is left alone');
    return null;
  }
  try {
    const result = reconcileClaudeHook({
      scriptSource: getHookScriptSource(),
      claudeDir: getClaudeDir(),
      prefsPath: path.join(app.getPath('userData'), 'prefs.json'),
    });
    console.log(`[claude-hook] ${result.status} — ${result.detail}`);
    if (result.showToast) pushSetupToast();
    return result;
  } catch (err) {
    console.error('[claude-hook] reconcile failed:', err);
    return null;
  }
}

// ─── Claude hook repair: put afterterm's entries back while the app runs ─────

// The launch reconcile above is not enough on its own: on 2026-11-06 a test launch
// removed afterterm's entries and every chat ran with no hooks for 21 hours. This
// poll of the Claude folder's settings.json puts them back within a few seconds, and
// a running chat picks them up with no restart. The decision is needsHookRepair
// (claude-hook-install.ts); the repair is reconcileNotifierHook, so the test launch
// guard and the opt-out apply to it exactly as at launch.
//
// A poll, not fs.watch: a watch on the folder was tried first, and it fails both
// ways the folder can go while the app runs (measured on Electron 35.7.5's runtime).
// A real delete (rmSync, Remove-Item) raises no error and sends 'rename' events
// without end, 266,399 in 2 seconds, holding main at a full core until quit. A move
// or rename (Explorer's delete to the Recycle Bin is a move) sends nothing at all,
// so the watch silently stops. One stat every 3 seconds has neither problem, costs
// nothing, and sees a replaced file, a deleted file and a missing folder alike.
const HOOK_POLL_MS = 3000;
const HOOK_REPAIR_DEBOUNCE_MS = 1000; // one check after a run of changes settles
let hookPollStarted = false;
let hookPollStopped = false;
let hookPollTimer: NodeJS.Timeout | null = null;
type HookSample = { exists: boolean; mtimeMs: number; ctimeMs: number; size: number };
let hookLastSample: HookSample | null = null;
let hookCheckTimer: NodeJS.Timeout | null = null;
let hookRepairTimes: number[] = []; // performance.now() of each repair, for the loop guard
let hookRepairCapWarned = false;

function scheduleHookCheck(delay = HOOK_REPAIR_DEBOUNCE_MS) {
  if (hookPollStopped) return;
  if (hookCheckTimer) clearTimeout(hookCheckTimer);
  hookCheckTimer = setTimeout(() => { hookCheckTimer = null; checkHookEntries(); }, delay);
}

// One stat of settings.json; a check is scheduled on the first sample and whenever
// the file appears, goes, or changes time or size. A missing folder is exists=false.
// ctimeMs is compared too: a same-size copy that keeps the modified time, or a file
// renamed over it, changes only that.
function sampleHookSettings() {
  let sample: HookSample = { exists: false, mtimeMs: 0, ctimeMs: 0, size: 0 };
  try {
    const st = fs.statSync(path.join(getClaudeDir(), 'settings.json'));
    sample = { exists: true, mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs, size: st.size };
  } catch { /* missing, or the folder is: exists=false */ }
  const last = hookLastSample;
  hookLastSample = sample;
  if (last && last.exists === sample.exists && last.mtimeMs === sample.mtimeMs &&
    last.ctimeMs === sample.ctimeMs && last.size === sample.size) return;
  scheduleHookCheck();
}

function checkHookEntries() {
  if (hookPollStopped) return;
  const claudeDir = getClaudeDir();
  // No Claude folder: Claude Code is not set up (or the folder went), nothing to repair into.
  if (!fs.existsSync(claudeDir)) return;
  let text: string | null;
  try {
    text = fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf-8');
  } catch (err) {
    // Missing counts as needing repair. Any other read error (busy mid-replace) is not
    // guessed at: forgetting the last sample makes the next poll schedule another
    // check, since an unchanged file would otherwise never be looked at again.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      hookLastSample = null;
      return;
    }
    text = null;
  }
  // Read on every check, never cached, so an opt-out written while the app runs
  // stops the repair at once. A prefs.json that could not be read comes back empty,
  // which counts as enabled, the same rule reconcile follows at launch.
  const check = needsHookRepair(text, readPrefs(getPrefsPath()).prefs);
  if (!check.repair) return;
  const now = performance.now();
  hookRepairTimes = hookRepairTimes.filter(t => now - t < HOOK_REPAIR_WINDOW_MS);
  const wait = hookRepairWait(hookRepairTimes, now);
  if (wait > 0) {
    if (!hookRepairCapWarned) {
      hookRepairCapWarned = true;
      console.warn(`[claude-hook] afterterm's entries were removed from settings.json ${HOOK_REPAIR_LIMIT} times within a minute; something keeps removing them, so repairs are held to ${HOOK_REPAIR_LIMIT} a minute (next in ${Math.ceil(wait / 1000)}s)`);
    }
    scheduleHookCheck(wait);
    return;
  }
  hookRepairTimes.push(now);
  const result = reconcileNotifierHook();
  if (result?.changed) console.log(`[claude-hook] repaired: ${check.reason}; ${result.detail}`);
}

function startHookRepairPoll() {
  if (hookPollStarted) return;
  // A test launch that may not touch the real Claude folder gets no poll at all.
  if (!hookReconcileAllowed(process.env)) return;
  hookPollStarted = true;
  sampleHookSettings();
  hookPollTimer = setInterval(sampleHookSettings, HOOK_POLL_MS);
}

function stopHookRepairPoll() {
  hookPollStopped = true;
  if (hookPollTimer) { clearInterval(hookPollTimer); hookPollTimer = null; }
  if (hookCheckTimer) { clearTimeout(hookCheckTimer); hookCheckTimer = null; }
}

// One-time "notifications enabled" toast through the existing overlay path. Uses a
// sentinel tabId the renderer ignores on click (handleActivate no-ops unknown tabs).
function pushSetupToast() {
  const win = notifierWindow;
  if (!win || win.isDestroyed()) return;
  const send = () => {
    if (win.isDestroyed()) return;
    showNotifierWindow();
    win.webContents.send('notify:push', {
      id: 'afterterm-setup',
      tabId: '__afterterm_setup__',
      type: 'done',
      primaryLabel: 'Claude Code notifications enabled',
      message: 'afterterm added a notifier hook to your Claude config',
    });
  };
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', () => setTimeout(send, 1000));
  } else {
    setTimeout(send, 600);
  }
}

const NOTIFIER_WIDTH = 340;   // fixed column width; height is content-driven
const NOTIFIER_MARGIN = 12;   // gap from the screen's bottom-right corner

// The last toast-stack height the renderer reported, so the overlay can be
// re-placed (a toast pushed after the main window moved to another monitor, a
// display plugged in or out) without waiting for the renderer to measure again.
let notifierHeight = 80;

// The display the overlay belongs on: the one holding the main window, so a
// toast lands beside the app rather than on the primary monitor while afterterm
// sits on another one (the multi-monitor bug logged on 2026-06-30). Read fresh
// on every placement, never cached, since the window can be dragged between
// monitors at any time. Before the main window exists (the overlay is created
// right after it, but a guard costs nothing) the harness's AFTERTERM_DISPLAY
// pick applies, which is the primary display when the override is unset. Under
// the harness the main window sits on the override's display anyway
// (harnessWindowPlacement), so following it keeps every window off the monitor
// a person is using while still exercising this exact path.
function notifierDisplay(): Electron.Display {
  if (mainWindow && !mainWindow.isDestroyed()) return screen.getDisplayMatching(mainWindow.getBounds());
  return getTargetDisplay();
}

// A full repaint of the overlay, the white-bar cure (see createNotifierWindow).
// Deferred a tick so it lands after the frame paint it is there to overwrite.
function repaintNotifier() {
  setTimeout(() => {
    if (notifierWindow && !notifierWindow.isDestroyed() && notifierWindow.isVisible()) {
      notifierWindow.webContents.invalidate();
    }
  }, 0);
}

// Resize/reposition the overlay so it's anchored to the bottom-right of the work
// area and exactly as tall as the rendered toast stack (the renderer measures and
// reports `contentHeight`). Because the window is never larger than its visible
// content, there is no invisible dead zone swallowing clicks, and nothing for DWM
// to paint a white bar over above the toasts. A bounds change is one more moment
// DWM can touch the frame (a second toast joining the stack grows the window,
// which is where Aryan saw the bar come back on 2026-09-25), so it repaints too.
function positionNotifier(contentHeight: number = notifierHeight) {
  if (!notifierWindow || notifierWindow.isDestroyed()) return;
  notifierHeight = contentHeight;
  const wa = notifierDisplay().workArea;
  const h = Math.max(1, Math.ceil(contentHeight));
  const x = wa.x + wa.width - NOTIFIER_WIDTH - NOTIFIER_MARGIN;
  const y = wa.y + wa.height - h - NOTIFIER_MARGIN;
  notifierWindow.setBounds({ x, y, width: NOTIFIER_WIDTH, height: h });
  repaintNotifier();
}

function createNotifierWindow() {
  const wa = notifierDisplay().workArea;
  notifierWindow = new BrowserWindow({
    x: wa.x + wa.width - NOTIFIER_WIDTH - NOTIFIER_MARGIN,
    y: wa.y + wa.height - 80 - NOTIFIER_MARGIN,
    width: NOTIFIER_WIDTH,
    height: 80,
    title: '',
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    thickFrame: false,
    hasShadow: false,
    roundedCorners: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Click-through everywhere by default. The renderer flips this off only while
  // the cursor is actually over a toast card (per-region hit-testing via forwarded
  // mouse-move), so clicks reach the app behind the overlay everywhere except a card.
  // Forwarding is on only while the overlay shows (showNotifierWindow): Electron
  // forwards with a system-wide mouse hook answered on this main thread, so while
  // it is installed any stall here freezes the mouse on the whole PC. With no
  // toast up there is nothing to hover, so there is no hook (launch lag, 2026-10-29).
  notifierWindow.setIgnoreMouseEvents(true);

  // Chromium copies the loaded document's title onto the native window — that's
  // what drew "index.html" into the DWM caption strip (the "white bar"). Refuse
  // every title update so the window stays titleless and no caption text is drawn.
  notifierWindow.on('page-title-updated', (e) => e.preventDefault());

  const notifierUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL
    ? `${MAIN_WINDOW_VITE_DEV_SERVER_URL}?notifier=1`
    : `file://${path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)}?notifier=1`;

  notifierWindow.loadURL(notifierUrl);
  notifierWindow.on('closed', () => { notifierWindow = null; });
  guardRenderer(notifierWindow, 'notifier');

  // The white bar. The overlay is a transparent layered window, and DWM briefly
  // turns its non-client (caption) rendering on around a show and around a
  // foreground change (WM_DWMNCRENDERINGCHANGED 1 then 0, three milliseconds
  // apart in the harness log). In that gap DWM paints the caption strip, white,
  // into the top of the window, and Chromium afterwards repaints only its own
  // content, so the strip stays until a full repaint. It is a race, so it shows
  // some of the time and not others (2026-09-19: Aryan's trigger was coming back
  // to afterterm on another thread with a toast up). The cure is a full repaint
  // right after each moment DWM can touch the frame: the show itself
  // (notify:push below), the DWM rendering toggle, and the main window gaining
  // focus. webContents.invalidate() is that repaint.
  const WM_DWMNCRENDERINGCHANGED = 0x031f;
  notifierWindow.hookWindowMessage(WM_DWMNCRENDERINGCHANGED, () => repaintNotifier());

  // A monitor plugged in, unplugged or rescaled can leave the overlay on a display
  // that no longer exists or no longer holds the main window; re-place it at once
  // rather than on the next toast. Registered here, once, since the overlay is
  // created once per app run.
  const replace = () => positionNotifier();
  screen.on('display-added', replace);
  screen.on('display-removed', replace);
  screen.on('display-metrics-changed', replace);
  // Waking the machine and unlocking it redraw every window, and the displays
  // may come back in a different order; re-place the overlay (which repaints it)
  // rather than leave a toast that was up across the sleep with a frame painted
  // into it.
  powerMonitor.on('resume', replace);
  powerMonitor.on('unlock-screen', replace);
}

// Only when AFTERTERM_DISPLAY is set: size the main window to fit the target
// display's work area and centre it there. Without the env var Electron's own
// default placement is kept, so ordinary launches are untouched.
function harnessWindowPlacement(): { x: number; y: number; width: number; height: number } | null {
  if (!process.env.AFTERTERM_DISPLAY) return null;
  const wa = getTargetDisplay().workArea;
  const width = Math.min(1280, wa.width);
  const height = Math.min(780, wa.height);
  return {
    x: wa.x + Math.floor((wa.width - width) / 2),
    y: wa.y + Math.floor((wa.height - height) / 2),
    width,
    height,
  };
}

// ─── Window recovery (AFT-33) ───────────────────────────────────────────────

// The window comes back by itself when its page crashes, hangs or loses its
// graphics, without closing the app: every shell lives here in main, so the page
// can be loaded again and re-attach to them (restoreWithLive in sleepWake.ts,
// pty:create's attach below). The rules are pure in window-recovery.ts.

// Every recovery event, one line each, in <userData>\recovery.log as well as the
// console, so what happened to a window nobody was watching can be read afterwards
// (a packaged build has no other log). Capped: past RECOVERY_LOG_MAX_BYTES the file
// keeps its newer half.
const RECOVERY_LOG_MAX_BYTES = 256 * 1024;

function recoveryLog(line: string): void {
  console.log(`[recovery] ${line}`);
  try {
    const file = path.join(app.getPath('userData'), 'recovery.log');
    try {
      if (fs.statSync(file).size > RECOVERY_LOG_MAX_BYTES) {
        fs.writeFileSync(file, fs.readFileSync(file, 'utf-8').slice(-RECOVERY_LOG_MAX_BYTES / 2), 'utf-8');
      }
    } catch { /* no file yet */ }
    fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`, 'utf-8');
  } catch { /* the log is a help, never a reason to fail */ }
}

// When each window's page was last reloaded by recovery, so a page that crashes as
// soon as it loads is not reloaded forever (allowReload).
const recoveryReloads = new Map<string, number[]>();

function reloadForRecovery(win: BrowserWindow, label: string, why: string): void {
  setTimeout(() => {
    if (win.isDestroyed() || isQuitting) return;
    const decision = allowReload(recoveryReloads.get(label) ?? [], Date.now());
    recoveryReloads.set(label, decision.times);
    if (!decision.allowed) {
      recoveryLog(`${label}: not reloading after ${why}: already reloaded ${RELOAD_LIMIT} times in ${RELOAD_WINDOW_MS / 1000}s`);
      return;
    }
    recoveryLog(`${label}: reloading the page after ${why}`);
    win.webContents.reload();
  }, RELOAD_DELAY_MS);
}

// A window's page: reloaded when its renderer process goes away, and when it has
// been unresponsive for HANG_GRACE_MS (its renderer is ended first, which reports
// as gone and reloads through the same path; Electron's own advice for a hung page).
function guardRenderer(win: BrowserWindow, label: string): void {
  const contents = win.webContents;
  let hangTimer: NodeJS.Timeout | null = null;
  const clearHang = () => {
    if (hangTimer) { clearTimeout(hangTimer); hangTimer = null; }
  };
  contents.on('render-process-gone', (_e, details) => {
    clearHang();
    recoveryLog(`${label}: renderer gone, reason=${details.reason} exitCode=${details.exitCode}`);
    if (afterRendererGone(details.reason, isQuitting) === 'reload') reloadForRecovery(win, label, `the renderer ${details.reason}`);
  });
  contents.on('unresponsive', () => {
    recoveryLog(`${label}: unresponsive; ending it if it still is in ${HANG_GRACE_MS / 1000}s`);
    if (hangTimer) return;
    hangTimer = setTimeout(() => {
      hangTimer = null;
      if (win.isDestroyed() || isQuitting) return;
      recoveryLog(`${label}: still unresponsive after ${HANG_GRACE_MS / 1000}s, ending its renderer`);
      contents.forcefullyCrashRenderer();
    }, HANG_GRACE_MS);
  });
  contents.on('responsive', () => {
    if (!hangTimer) return;
    clearHang();
    recoveryLog(`${label}: responsive again`);
  });
  win.on('closed', clearHang);
}

// The GPU process going away is what took the terminals' text in AFT-33. Chromium
// starts a new one by itself; the main window's terminals are told to redraw (a
// fresh WebGL renderer each), which keeps their scrollback, unlike a reload. Any
// other process going away is only logged.
app.on('child-process-gone', (_e, details) => {
  recoveryLog(`process gone: type=${details.type} reason=${details.reason} exitCode=${details.exitCode}${details.name ? ` name=${details.name}` : ''}`);
  if (afterChildGone(details.type, details.reason) === 'repaint' && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('recovery:repaint');
  }
});

// What the page last showed (screen, project page, active thread), kept in memory
// only: it exists for a page that reloads inside one run of the app, never on a
// launch (screenAfterReload in sleepWake.ts).
type RememberedUi = { screen: 'home' | 'workspace' | 'project'; projectId?: string; activeTabId?: string };
let rememberedUi: RememberedUi | null = null;

ipcMain.on('recovery:ui', (_event, ui: unknown) => {
  if (!ui || typeof ui !== 'object') return;
  const u = ui as Record<string, unknown>;
  if (u.screen !== 'home' && u.screen !== 'workspace' && u.screen !== 'project') return;
  rememberedUi = {
    screen: u.screen,
    ...(typeof u.projectId === 'string' ? { projectId: u.projectId } : {}),
    ...(typeof u.activeTabId === 'string' ? { activeTabId: u.activeTabId } : {}),
  };
});

// Asked by the page as it restores the session: the shells main still holds (with
// the port each was last seen on), and what the page last showed. Empty on a
// launch. The record status and children flags are sent on change only, so they are
// forgotten here and the next pass sends every live thread's again to the new page.
ipcMain.handle('recovery:state', () => {
  const threads = [...ptys.keys()].map(tabId => ({
    tabId,
    ...(lastPortSent.has(tabId) ? { port: lastPortSent.get(tabId) ?? null } : {}),
  }));
  if (threads.length > 0) {
    recordStatusSent.clear();
    shellChildrenSent.clear();
    recoveryLog(`main: page loaded with ${threads.length} live shell(s): ${threads.map(t => t.tabId).join(', ')}`);
  }
  return { threads, ui: rememberedUi };
});

// Harness only: make the window's renderer crash, or end the GPU process the way
// Aryan did by hand, to test the recovery (drive eval "window.afterterm.recovery.test('crash')").
ipcMain.on('recovery:test', (_event, what: unknown) => {
  if (process.env.AFTERTERM_HARNESS !== '1') return;
  if (what === 'crash') {
    console.log('[harness] recovery:test crash');
    setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.forcefullyCrashRenderer(); }, 100);
  } else if (what === 'gpu') {
    const gpu = app.getAppMetrics().find(m => m.type === 'GPU');
    console.log(`[harness] recovery:test gpu pid=${gpu?.pid ?? 'none'}`);
    if (gpu) { try { process.kill(gpu.pid); } catch (err) { console.log(`[harness] recovery:test gpu failed: ${String(err)}`); } }
  }
});

function createWindow() {
  const placement = harnessWindowPlacement();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 780,
    ...(placement ?? {}),
    minWidth: 800,
    minHeight: 500,
    icon: getIconPath(),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#171717',
      symbolColor: '#8e8e8e',
      height: 32,
    },
    backgroundColor: '#212121',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Re-apply the bounds once the window exists. Electron sizes a window created
  // with explicit bounds on a display whose DPI differs from the primary's using
  // the primary's scale (1280x780 came out as 1024x625 on a 100% monitor next to
  // a 125% primary); setBounds on the existing window uses the right display.
  if (placement) mainWindow.setBounds(placement);

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
  guardRenderer(mainWindow, 'main');

  // Coming back to afterterm with a toast up is when DWM revisits the overlay's
  // frame and can leave the white bar (see createNotifierWindow); repaint it.
  mainWindow.on('focus', () => repaintNotifier());

  // The overlay's toasts go on their own only while this window is focused
  // (toastExpiry.ts), so it hears every focus change. A foreground change is also
  // a moment DWM can paint the caption strip into the overlay, hence the repaint.
  mainWindow.on('focus', () => sendMainFocus(true));
  mainWindow.on('blur', () => {
    sendMainFocus(false);
    repaintNotifier();
  });

  mainWindow.on('close', (e) => {
    if (isQuitting || ptys.size === 0) return;
    // A harness run (scripts/agent-harness, AFTERTERM_HARNESS=1) quits through
    // `drive window quit`, which posts WM_CLOSE to this window to exercise the
    // renderer's quit flush (tails and the asleep stamps). Nobody is there to
    // answer a confirm dialog, so the harness gets the "Close" answer straight away.
    if (process.env.AFTERTERM_HARNESS === '1') {
      isQuitting = true;
      app.quit();
      return;
    }
    e.preventDefault();
    dialog.showMessageBox(mainWindow!, {
      type: 'question',
      buttons: ['Close', 'Cancel'],
      defaultId: 1,
      title: 'afterterm',
      message: `${ptys.size} terminal${ptys.size > 1 ? 's' : ''} still running. Close anyway?`,
    }).then(({ response }) => {
      if (response === 0) {
        isQuitting = true;
        // Quit the whole app — NOT just mainWindow.close(). The always-on-top
        // notifier window otherwise keeps the process alive (window-all-closed
        // never fires), leaving a headless zombie holding every shell.
        app.quit();
      }
    });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    // Main window gone → quit the app so the notifier window doesn't keep the
    // process (and its shells) alive. before-quit drains PTYs; guarded to run once.
    app.quit();
  });

  // ── Keyboard shortcuts via before-input-event ─────────────────────────────
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (!mainWindow) return;
    const ctrl = input.control;
    const shift = input.shift;
    const key = input.key.toLowerCase();

    if (ctrl && shift && key === 't') {
      mainWindow.webContents.send('shortcut', 'new-tab');
      event.preventDefault();
    } else if (ctrl && shift && key === 'w') {
      mainWindow.webContents.send('shortcut', 'close-tab');
      event.preventDefault();
    } else if (ctrl && !shift && key === 'tab') {
      mainWindow.webContents.send('shortcut', 'next-tab');
      event.preventDefault();
    } else if (ctrl && shift && key === 'tab') {
      mainWindow.webContents.send('shortcut', 'prev-tab');
      event.preventDefault();
    } else if (ctrl && shift && key === 'b') {
      mainWindow.webContents.send('shortcut', 'toggle-panel');
      event.preventDefault();
    } else if (ctrl && shift && key === 'p') {
      // Search palette over projects and threads. Ctrl+K stays with the terminal,
      // where shells and Claude Code both use it.
      mainWindow.webContents.send('shortcut', 'search');
      event.preventDefault();
    } else if (ctrl && shift && key === 'arrowdown') {
      // Phase 8: the next thread row the panel is showing, in panel order and
      // across projects (design-03 decisions 6 and 7). Ctrl+Tab keeps its
      // session-order cycle. Ctrl+Shift+Arrow is not a shell or Claude Code
      // binding, so taking it here costs the terminal nothing.
      mainWindow.webContents.send('shortcut', 'next-thread');
      event.preventDefault();
    } else if (ctrl && shift && key === 'arrowup') {
      mainWindow.webContents.send('shortcut', 'prev-thread');
      event.preventDefault();
    }
  });
}

// ─── IPC: notification overlay ──────────────────────────────────────────────

// Main window → notifier: push a new toast — show the window first so it's visible above other apps
ipcMain.on('notify:push', (_event, toast) => {
  if (notifierWindow && !notifierWindow.isDestroyed()) {
    // Re-place before showing: the main window may have moved to another monitor
    // since the last toast, and a hidden overlay is never re-measured meanwhile.
    positionNotifier();
    showNotifierWindow();
    repaintNotifier();
    notifierWindow.webContents.send('notify:push', toast);
  }
});

// Main window → notifier: dismiss toasts for a tab (user activated it)
ipcMain.on('notify:dismiss-tab', (_event, tabId: string) => {
  notifierWindow?.webContents.send('notify:dismiss-tab', tabId);
});

// Main window → notifier: a project was edited (name, colour or icon), so the
// toasts on screen for it redraw with the new look. Never shows the overlay: a
// hidden overlay has no toasts to update.
ipcMain.on('notify:project-updated', (_event, look) => {
  if (notifierWindow && !notifierWindow.isDestroyed()) {
    notifierWindow.webContents.send('notify:project-updated', look);
  }
});

// Notifier → main window: user clicked a toast → focus app + switch tab
ipcMain.on('notify:tab-click', (_event, tabId: string) => {
  if (mainWindow) {
    // Under the agent harness, taking OS focus would pull it away from the person
    // working on the other monitor, so the click only logs that part.
    if (harnessOnlyLogsExternal()) {
      console.log(`[harness] notify:tab-click ${tabId} (window not shown or focused)`);
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
    mainWindow.webContents.send('notify:activate-tab', tabId);
  }
});

// Main window → notifier: whether the main window is focused, which decides
// whether toasts count down to going on their own (toastExpiry.ts). The overlay
// asks once when it loads, then hears every change.
function sendMainFocus(focused: boolean) {
  if (process.env.AFTERTERM_HARNESS === '1') console.log(`[harness] notifier:main-focus ${focused}`);
  if (notifierWindow && !notifierWindow.isDestroyed()) {
    notifierWindow.webContents.send('notifier:main-focus', focused);
  }
}

ipcMain.handle('notifier:main-focused', () => !!mainWindow?.isFocused());

// Notifier → self: toggle mouse passthrough. Forwarding (and with it the
// system-wide mouse hook) only while the overlay is up; see createNotifierWindow.
ipcMain.on('notifier:set-ignore-mouse', (_event, ignore: boolean) => {
  if (!notifierWindow || notifierWindow.isDestroyed()) return;
  notifierWindow.setIgnoreMouseEvents(ignore, notifierWindow.isVisible() ? { forward: true } : undefined);
});

// Notifier → self: hide window when all toasts are dismissed
ipcMain.on('notifier:hide', () => {
  if (!notifierWindow || notifierWindow.isDestroyed()) return;
  notifierWindow.hide();
  notifierWindow.setIgnoreMouseEvents(true);
});

function showNotifierWindow() {
  if (!notifierWindow || notifierWindow.isDestroyed()) return;
  notifierWindow.setIgnoreMouseEvents(true, { forward: true });
  notifierWindow.showInactive();
}

// Notifier → self: renderer reports the measured height of its toast stack;
// resize the window to match so it's exactly as tall as the visible toasts.
ipcMain.on('notifier:resize', (_event, height: number) => {
  positionNotifier(height);
});

// Under the agent harness (AFTERTERM_HARNESS=1) a browser window or an Explorer
// window must never land on the person's screen, so "Open localhost:port" and
// "Open in File Explorer" only log what they would have opened. The one
// exception is a replica dev build left running for Aryan to use himself
// (launch.mjs --open-external, AFTERTERM_OPEN_EXTERNAL=1), where the real launch
// is the point; an automated self-test never sets it.
function harnessOnlyLogsExternal(): boolean {
  return process.env.AFTERTERM_HARNESS === '1' && process.env.AFTERTERM_OPEN_EXTERNAL !== '1';
}

// ─── IPC: open a link in the user's default browser ──────────────────────────

// Clicked URLs / OSC 8 hyperlinks from the terminal. Safelist protocols so a
// malicious escape sequence can't launch arbitrary handlers (file:, custom URI
// schemes, etc.) — only the things you'd actually want a browser/mail client for.
const OPEN_EXTERNAL_PROTOCOLS = ['http:', 'https:', 'mailto:'];

ipcMain.handle('shell:openExternal', (_event, url: string) => {
  try {
    if (OPEN_EXTERNAL_PROTOCOLS.includes(new URL(url).protocol)) {
      // Under the agent harness, record the call instead of making it. An automated
      // run must never throw a browser window onto the person's screen, and the log
      // line is how a test asserts that "Open localhost:5173" really would have
      // opened. The safelist check stays above this, so the line only appears for a
      // URL that would genuinely have opened.
      if (harnessOnlyLogsExternal()) {
        console.log(`[harness] shell:openExternal ${url}`);
        return;
      }
      shell.openExternal(url);
    }
  } catch { /* not a valid URL — ignore */ }
});

// ─── IPC: pick folder ────────────────────────────────────────────────────────

ipcMain.handle('dialog:pickFolder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// ─── IPC: list available shells ──────────────────────────────────────────────

ipcMain.handle('shells:list', () => {
  return detectShells().map(({ id, name }) => ({ id, name }));
});

// ─── IPC: app version (titlebar badge) ───────────────────────────────────────
// Sync so the renderer has it immediately at preload time (no loading flash).
// app.getVersion() reads package.json "version".
ipcMain.on('app:version', (event) => { event.returnValue = app.getVersion(); });
// The home folder, for showing paths under it as ~ (the Files list). The sandboxed
// preload does not see USERPROFILE, so main answers.
ipcMain.on('app:home', (event) => { event.returnValue = os.homedir(); });

// ─── prefs.json ──────────────────────────────────────────────────────────────

function getPrefsPath() {
  return path.join(app.getPath('userData'), 'prefs.json');
}

// ─── Last opened time ────────────────────────────────────────────────────────

// Home shows how long you were away, so the app records when it was opened and
// reads that back one launch later. Held in a module variable because prefs.json
// is rewritten with the current time during startup: by the time the renderer
// asks, the file no longer holds the previous value.
let previousLastOpenedAt: number | null = null;

function initLastOpenedAt(): void {
  const prefsPath = getPrefsPath();
  const { prefs, usable } = readPrefs(prefsPath);
  const stored = prefs.lastOpenedAt;
  previousLastOpenedAt = typeof stored === 'number' && Number.isFinite(stored) ? stored : null;
  // An unparseable prefs.json is left exactly as it is, same rule as the Claude
  // hook opt-out flag: updatePrefs refuses the write and returns false.
  if (usable) updatePrefs(prefsPath, { lastOpenedAt: Date.now() });
}

// Sync, like app:version, so the renderer has it at preload time and Home can
// render its first frame without a second pass. null on the very first launch.
ipcMain.on('app:last-opened-at', (event) => { event.returnValue = previousLastOpenedAt; });

// ─── Project folders: File Explorer and existence checks ─────────────────────

// A WSL path is served by a network provider, not the local filesystem. A stat
// on one can hang or fail while the path is perfectly good, so afterterm never
// checks those: File Explorer and VS Code both handle them themselves.
function isWslPath(folder: string): boolean {
  return /^\\\\wsl(\$|\.localhost)\\/i.test(folder);
}

function isUsableFolder(folder: string): boolean {
  if (isWslPath(folder)) return true;
  try {
    return fs.existsSync(folder) && fs.statSync(folder).isDirectory();
  } catch {
    return false;
  }
}

// Launch a program with one argument, as an argument, never through a shell
// string, so spaces and non-ASCII in a folder path pass through untouched.
// Resolves as soon as the process exists: explorer.exe exits with code 1 even
// when it opened the window, so an exit code says nothing about success.
function spawnDetached(command: string, args: string[]): Promise<{ ok: boolean; error?: string }> {
  return new Promise(resolve => {
    let child;
    try {
      child = execFile(command, args, { windowsHide: false }, () => { /* exit code is not a result */ });
    } catch (err) {
      resolve({ ok: false, error: String(err) });
      return;
    }
    child.once('spawn', () => {
      try { child.unref(); } catch {}
      resolve({ ok: true });
    });
    child.once('error', (err) => resolve({ ok: false, error: String(err) }));
  });
}

ipcMain.handle('projects:openInExplorer', async (_event, folder: unknown) => {
  if (typeof folder !== 'string' || folder.trim() === '') {
    return { ok: false, error: 'Folder not found' };
  }
  if (!isUsableFolder(folder)) return { ok: false, error: 'Folder not found' };
  // Under the agent harness (scripts/agent-harness, AFTERTERM_HARNESS=1) an
  // Explorer window must never land on the person's screen, so the launch is
  // logged instead, the same way shell:openExternal is; the checks above still
  // ran, so the line only appears for a folder that would genuinely have opened.
  if (harnessOnlyLogsExternal()) {
    console.log(`[harness] projects:openInExplorer ${folder}`);
    return { ok: true };
  }
  const result = await spawnDetached('explorer.exe', [folder]);
  if (result.ok) return { ok: true };
  console.error('[explorer] could not open', folder, result.error);
  return { ok: false, error: 'Could not open File Explorer' };
});

// One round trip for a whole list of project folders, so Home can grey out the
// ones that are gone without a call per project.
const MAX_FOLDER_CHECKS = 500;

ipcMain.handle('projects:checkFolders', (_event, folders: unknown) => {
  const result: Record<string, boolean> = {};
  if (!Array.isArray(folders)) return result;
  for (const folder of folders.slice(0, MAX_FOLDER_CHECKS)) {
    if (typeof folder !== 'string' || folder === '') continue;
    if (folder in result) continue;
    result[folder] = isUsableFolder(folder);
  }
  return result;
});

// ─── Editor detection and launch ─────────────────────────────────────────────

// The real, Windows-only side of editor-detect.ts. Every call is wrapped so a
// permission error or a missing tool degrades to "not found" rather than
// throwing during startup. The two slow lookups (`where code` and the uninstall
// registry) are run beforehand, asynchronously, and handed in: run synchronously
// they froze the main thread for up to 3.4 s at launch, and with it the mouse on
// the whole PC (launch lag, Yogansh 2026-10-29).
function detectDeps(codePaths: string[], registry: RegistryEditor[]): DetectDeps {
  return {
    env: process.env as Record<string, string | undefined>,
    exists: (p) => { try { return fs.existsSync(p); } catch { return false; } },
    isFile: (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } },
    listDir: (p) => { try { return fs.readdirSync(p); } catch { return []; } },
    readText: (p) => { try { return fs.readFileSync(p, 'utf-8'); } catch { return null; } },
    whereCode: () => codePaths,
    registryEditors: () => registry,
  };
}

type RegistryEditor = { displayName: string; installLocation?: string; displayIcon?: string };

function execFileText(file: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve) => {
    execFile(file, args, { encoding: 'utf-8', timeout, windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? '' : String(stdout));
    });
  });
}

async function whereCodeAsync(): Promise<string[]> {
  const out = await execFileText('where', ['code'], 4000);
  return out.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

const UNINSTALL_KEYS = [
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKCU\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
];

// Walk the uninstall registry and pull out the three values detection needs.
// `reg query ... /s` prints one blank-line-separated block per subkey, with
// values as "    Name    REG_SZ    value". The four keys are read in parallel.
async function readUninstallEditors(): Promise<RegistryEditor[]> {
  const outputs = await Promise.all(UNINSTALL_KEYS.map(key => execFileText('reg', ['query', key, '/s'], 8000)));
  const entries: RegistryEditor[] = [];
  for (const out of outputs) {
    if (!out) continue; // key absent on this machine, or reg refused it
    let current: { displayName?: string; installLocation?: string; displayIcon?: string } = {};
    const flush = () => {
      if (current.displayName) {
        entries.push({
          displayName: current.displayName,
          installLocation: current.installLocation,
          displayIcon: current.displayIcon,
        });
      }
      current = {};
    };
    for (const rawLine of out.split(/\r?\n/)) {
      const line = rawLine.trimEnd();
      if (/^HKEY_/i.test(line.trim())) { flush(); continue; }
      const match = /^\s+(DisplayName|InstallLocation|DisplayIcon)\s+REG_[A-Z_]+\s+(.*)$/i.exec(line);
      if (!match) continue;
      const name = match[1].toLowerCase();
      const value = match[2].trim();
      if (name === 'displayname') current.displayName = value;
      else if (name === 'installlocation') current.installLocation = value;
      else current.displayIcon = value;
    }
    flush();
  }
  return entries;
}

// Detection runs after the window is up, off the main thread's critical path, and
// its answer is saved to <userData>\editors-cache.json, so the next launch has
// its editors at once and only refreshes them in the background. It re-runs when
// a launch fails or the user picks an editor by hand. One run at a time.
let cachedEditors: EditorInfo[] = [];
let editorPrefsPathInvalid = false;
let editorsKnown = false;
let editorDetection: Promise<void> | null = null;

function editorCachePath() {
  return path.join(app.getPath('userData'), 'editors-cache.json');
}

function loadEditorCache(): void {
  try {
    const saved = JSON.parse(fs.readFileSync(editorCachePath(), 'utf-8')) as { editors?: unknown; invalid?: unknown };
    if (!Array.isArray(saved.editors)) return;
    cachedEditors = (saved.editors as EditorInfo[]).filter(e => e && typeof e.path === 'string' && fs.existsSync(e.path));
    editorPrefsPathInvalid = saved.invalid === true;
    editorsKnown = true;
  } catch { /* no cache yet: the first detection fills it */ }
}

function runEditorDetection(reason: string): Promise<void> {
  if (editorDetection) return editorDetection;
  editorDetection = (async () => {
    try {
      const started = Date.now();
      const [codePaths, registry] = await Promise.all([whereCodeAsync(), readUninstallEditors()]);
      const editorPath = readPrefs(getPrefsPath()).prefs.editorPath;
      const result = detectEditors(typeof editorPath === 'string' ? editorPath : undefined, detectDeps(codePaths, registry));
      // AFTERTERM_NO_EDITORS: a harness run on a machine with VS Code can still test having none.
      cachedEditors = process.env.AFTERTERM_HARNESS === '1' && process.env.AFTERTERM_NO_EDITORS === '1' ? [] : result.editors;
      editorPrefsPathInvalid = result.invalidPrefsPath;
      editorsKnown = true;
      try { fs.writeFileSync(editorCachePath(), JSON.stringify({ editors: cachedEditors, invalid: editorPrefsPathInvalid })); } catch { /* next launch detects again */ }
      const found = result.editors.length
        ? result.editors.map(e => `${e.name} (${e.source})`).join(', ')
        : 'none found';
      console.log(`[editors] ${reason}: ${found}${result.invalidPrefsPath ? ', editorPath in prefs.json is not an editor' : ''} in ${Date.now() - started}ms`);
    } catch (err) {
      console.error('[editors] detection failed:', err);
    } finally {
      editorDetection = null;
    }
  })();
  return editorDetection;
}

// If the renderer asks before anything is known, wait for a detection rather than
// answering with an empty list and hiding a button the user does have.
ipcMain.handle('editors:list', async () => {
  if (!editorsKnown) await runEditorDetection('first request from the renderer');
  return cachedEditors;
});

// True only when prefs.json holds an editorPath that exists and is not an
// editor. The renderer shows the "Editor path not valid" toast for this alone.
ipcMain.handle('editors:prefsPathInvalid', async () => {
  if (!editorsKnown) await runEditorDetection('first request from the renderer');
  return editorPrefsPathInvalid;
});

ipcMain.handle('editors:open', async (_event, folder: unknown, editorId?: unknown) => {
  if (typeof folder !== 'string' || folder.trim() === '' || !isUsableFolder(folder)) {
    return { ok: false, error: 'Folder not found', editors: cachedEditors };
  }
  // No id means the primary editor. An id that matches nothing is an error, not a
  // silent fallback: the renderer's list can be stale, and opening a different
  // editor than the one clicked would be a surprise.
  let editor: EditorInfo | undefined;
  if (typeof editorId === 'string' && editorId !== '') {
    editor = cachedEditors.find(e => e.id === editorId);
    if (!editor) {
      await runEditorDetection('unknown editor id from the renderer');
      editor = cachedEditors.find(e => e.id === editorId);
    }
    if (!editor) return { ok: false, error: 'Editor not found', editors: cachedEditors };
  } else {
    editor = cachedEditors[0];
  }
  if (!editor) return { ok: false, error: 'No editor found', editors: cachedEditors };

  // Under the agent harness an editor window must never land on the person's
  // screen either (the header's editor button made this reachable from a
  // self-test), so the launch is logged after the checks above, like Explorer.
  if (harnessOnlyLogsExternal()) {
    console.log(`[harness] editors:open ${editor.name} ${folder}`);
    return { ok: true, editors: cachedEditors };
  }

  const result = await new Promise<{ ok: boolean; error?: string }>(resolve => {
    let child;
    try {
      // spawn, not execFile: the editor outlives afterterm, so it is detached
      // with no pipes held open. The folder is still one argument in an argv
      // array, never a shell string.
      child = spawn(editor.path, [folder], { detached: true, stdio: 'ignore', windowsHide: false });
    } catch (err) {
      resolve({ ok: false, error: String(err) });
      return;
    }
    child.once('spawn', () => {
      try { child.unref(); } catch {}
      resolve({ ok: true });
    });
    child.once('error', (err) => resolve({ ok: false, error: String(err) }));
  });

  if (result.ok) return { ok: true, editors: cachedEditors };
  // The editor was there at startup and is not now (uninstalled, moved, blocked).
  // Re-detect so the UI can drop a button that no longer opens anything.
  console.error(`[editors] launch failed for ${editor.path}:`, result.error);
  await runEditorDetection('re-detect after a failed launch');
  return { ok: false, error: `Couldn't open ${editor.name}`, editors: cachedEditors };
});

// File picker for the editor executable. Windows cannot offer files and folders
// in one dialog, so this picks a file; a folder can still be set by hand in
// prefs.json and detection accepts it when it holds a known editor exe.
ipcMain.handle('editors:choose', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose editor',
    properties: ['openFile'],
    filters: [
      { name: 'Executables', extensions: ['exe'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const picked = result.filePaths[0];
  // A hand-picked path wins, whatever the exe is called: an unknown one becomes
  // product 'other' and is named after its file.
  updatePrefs(getPrefsPath(), { editorPath: picked });
  await runEditorDetection('re-detect after the user chose an editor');
  return { editors: cachedEditors, invalid: editorPrefsPathInvalid };
});

// ─── IPC: create PTY ─────────────────────────────────────────────────────────

ipcMain.handle('pty:create', (_event, tabId: string, shellId?: string, cwd?: string) => {
  // AFT-33: the page reloaded (or came back after a crash) while this thread's shell
  // kept running. The page's new terminal attaches to it: nothing is spawned, and the
  // shell's output already goes to this window's page, whichever page it holds now.
  // `attached` tells the page not to type a resume or a server command into it.
  const existing = ptys.get(tabId);
  if (existing) {
    if (process.env.AFTERTERM_HARNESS === '1') console.log(`[harness] pty:attach ${tabId} pid=${existing.pid}`);
    return { pid: existing.pid, attached: true };
  }

  const shell = getShellById(shellId);

  // Clean PATH: strip stray quotes that corrupt cmd.exe's command resolution.
  // AFTERTERM_TAB_ID + AFTERTERM_SESSION_DIR let the bundled notify hook write this
  // tab's live Claude session id to disk for resume-on-restart (see claude-hook
  // file channel — the title channel is unreliable when a second hook is present).
  const cleanEnv = {
    ...process.env,
    AFTERTERM: '1',
    AFTERTERM_TAB_ID: tabId,
    AFTERTERM_SESSION_DIR: getClaudeSessionDir(),
  } as Record<string, string>;
  if (cleanEnv.Path) cleanEnv.Path = cleanEnv.Path.replace(/"/g, '');
  if (cleanEnv.PATH) cleanEnv.PATH = cleanEnv.PATH.replace(/"/g, '');

  // CWD reporting and prompt marks, for every shell. The renderer only ever sees
  // OSC 9;9 (a Windows path) and OSC 133;A/B (prompt start and prompt end), so it
  // needs no per-shell knowledge: the 133 marks are what makes last-command capture
  // possible (on Enter, the renderer reads the buffer between the B mark and the
  // cursor), and the 9;9 report is what lets a tab restore to its last directory.
  //
  // planSpawn (src/shell-integration.ts, which holds the exact injected texts)
  // decides all of it and returns the command, args, cwd and env to spawn with:
  //   cmd                    PROMPT becomes `$E]133;A$E\` + `$E]9;9;$P$E\` + the
  //                          visible prompt (any custom PROMPT is kept) + `$E]133;B$E\`
  //   pwsh, Windows PowerShell  args become `-NoExit -EncodedCommand <bootstrap>`,
  //                          which wraps the existing `prompt` function after the
  //                          user's profile has run
  //   Git Bash               PROMPT_COMMAND and AFTERTERM_BASH_HOOK in the env, args
  //                          untouched
  //   WSL                    the same two, plus WSLENV so they cross into the distro,
  //                          where the hook emits OSC 7 `file://<distro>/<path>`
  //
  // Opt-out is per shell in prefs.json (`shellIntegration: { pwsh: "off" }`), read
  // at every spawn so a change needs no restart. Failure mode: the shell always
  // opens, a hook that does not take just means no cwd capture and no prompt marks.
  //
  // planSpawn also owns the cwd decision (a missing or stale directory falls back to
  // home) and deliberately never stats a `\\wsl$\` path: for the wsl shell such a cwd
  // becomes `wsl.exe -d <distro> --cd <linux path>`, for any other shell it falls
  // back to home.
  const plan = planSpawn({
    shell,
    cwd,
    home: process.env.USERPROFILE || 'C:\\',
    env: cleanEnv,
    prefs: readPrefs(getPrefsPath()).prefs,
    dirExists: (candidate) => {
      try {
        return fs.existsSync(candidate) && fs.statSync(candidate).isDirectory();
      } catch {
        return false;
      }
    },
  });

  if (process.env.AFTERTERM_HARNESS === '1') {
    // Values only, never env contents (the bash hook is one very long line). This is
    // how a harness run proves the opt-out and the WSL --cd mapping without a debugger.
    const safeArgs = plan.args.map((a, i) =>
      plan.args[i - 1] === '-EncodedCommand' ? '<encoded>' : a
    );
    console.log(
      `[harness] pty:create ${tabId} shell=${shell.id} integration=${plan.integration ? 'on' : 'off'} ` +
      `cwd=${plan.cwd} cwdFallback=${plan.cwdFallback} args=${JSON.stringify(safeArgs)}`
    );
  }

  const p = pty.spawn(plan.command, plan.args, {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: plan.cwd,
    env: plan.env,
  });

  ptys.set(tabId, p);
  ptyCreatedAt.set(tabId, Date.now());

  // Server watching: remember this tab's shell pid, mark the cached process list as
  // out of date, keep the slow poll running, and look once a second from now (a shell
  // that was told to re-run a server has it listening by about then).
  // shell.command, not plan.command: the profile's own executable is what locates the
  // Git install (plan.command can be rewritten, as it is for WSL).
  shellPids.set(tabId, { pid: p.pid, shellId: shell.id, command: shell.command });
  treeDirty = true;
  startServerPolling();
  setTimeout(() => { void pollServers('a PTY was created'); }, 1000);

  let buffer = '';
  let flushTimer: NodeJS.Timeout | null = null;

  p.onData((data) => {
    buffer += data;
    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(`pty:data:${tabId}`, buffer);
        }
        buffer = '';
        flushTimer = null;
        noteActivity(tabId);
        noteOutputForServers();
      }, 16);
    }
  });

  p.onExit(({ exitCode }) => {
    if (buffer && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(`pty:data:${tabId}`, buffer);
      buffer = '';
    }
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(`pty:exit:${tabId}`, exitCode);
    }
    ptys.delete(tabId);
    lastActivitySent.delete(tabId);
  ptyCreatedAt.delete(tabId);
    forgetServerTab(tabId);
    if (ptys.size === 0) stopServerPolling();
  });

  return { pid: p.pid, attached: false };
});

// ─── IPC: write to PTY ───────────────────────────────────────────────────────

ipcMain.on('pty:input', (_event, tabId: string, data: string) => {
  const p = ptys.get(tabId);
  if (!p) return;
  p.write(data);
  noteActivity(tabId);
});

// ─── IPC: resize PTY ─────────────────────────────────────────────────────────

ipcMain.on('pty:resize', (_event, tabId: string, cols: number, rows: number) => {
  const p = ptys.get(tabId);
  if (p) {
    try { p.resize(cols, rows); } catch { /* already dead */ }
  }
});

// ─── IPC: destroy PTY with process tree cleanup ──────────────────────────────

ipcMain.handle('pty:destroy', async (_event, tabId: string) => {
  const p = ptys.get(tabId);
  if (!p) return;
  const pid = p.pid;
  // Read before forgetServerTab drops it: killTree needs the shell id and command.
  const info = shellPids.get(tabId);
  ptys.delete(tabId);
  lastActivitySent.delete(tabId);
  ptyCreatedAt.delete(tabId);
  forgetServerTab(tabId);
  if (ptys.size === 0) stopServerPolling();
  // A sleeping or closed chat runs no commands: its folder watch ends with it.
  unwatchChatFolder(tabId);

  await killTree(tabId, pid, info);

  await Promise.race([
    new Promise<void>(resolve => {
      try { p.kill(); } catch { /* already dead */ }
      resolve();
    }),
    new Promise<void>(resolve => setTimeout(resolve, 2000)),
  ]);
});

// ─── IPC: session persistence ────────────────────────────────────────────────

function getSessionPath() {
  return path.join(app.getPath('userData'), 'session.json');
}

// ─── Claude session capture (resume-on-restart) ──────────────────────────────

// The bundled notify hook writes <userData>/claude-sessions/<tabId>.json = { sessionId,
// cwd } for each tab running Claude Code (it gets the dir + tabId from the PTY env).
// We watch that dir and forward validated mappings to the renderer, which stores them
// on the tab and persists them in session.json so the next launch can `claude --resume`.
function getClaudeSessionDir() {
  const dir = path.join(app.getPath('userData'), 'claude-sessions');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  return dir;
}

// SECURITY: these files are world-writable on disk — validate before trusting. The
// sessionId is later typed into a shell as `claude --resume <id>`, so accept only a
// canonical UUID (no shell metacharacters / newlines) and an absolute, clean path.
// CLAUDE_CWD_RE lives in claude-session-record.ts, which holds Claude Code's own
// record to the same rule.
const CLAUDE_UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// Where Claude Code keeps its session transcripts, one folder per cwd. Read-only:
// afterterm never writes anything under it. AFTERTERM_CLAUDE_PROJECTS_DIR is the test
// override, so a harness run can point at a fixture folder instead of the real one.
function getClaudeProjectsDir() {
  return process.env.AFTERTERM_CLAUDE_PROJECTS_DIR || path.join(getClaudeDir(), 'projects');
}

// Where Claude Code keeps one record per running claude.exe (claude-session-record.ts).
// Read-only, and never created. AFTERTERM_CLAUDE_SESSIONS_DIR is the test override: a
// harness run whose Claude folder is a scratch one can still read the records of the
// real Claude its test chats run under.
function getClaudeSessionsDir() {
  return process.env.AFTERTERM_CLAUDE_SESSIONS_DIR || path.join(getClaudeDir(), 'sessions');
}

// The first user prompt and the current model for one session, or the not-found
// result. Never throws; the sessionId is validated inside readTranscriptMeta too.
function readClaudeMeta(sessionId: string, cwd: string) {
  return readTranscriptMeta(getClaudeProjectsDir(), cwd, sessionId, fs);
}

function readAndPushClaudeSession(tabId: string) {
  try {
    // The hook writes this file with `Set-Content -Encoding UTF8`, which under Windows
    // PowerShell 5.1 prepends a UTF-8 BOM (pwsh 7 does not). Node's JSON.parse throws on
    // a leading BOM, and the catch below would silently swallow it — dropping the mapping
    // so nothing is ever persisted and no session can auto-resume. Strip it before parsing.
    const raw = fs.readFileSync(path.join(getClaudeSessionDir(), `${tabId}.json`), 'utf-8').replace(/^\uFEFF/, '');
    const obj = JSON.parse(raw) as { sessionId?: unknown; cwd?: unknown };
    if (typeof obj?.sessionId !== 'string' || typeof obj?.cwd !== 'string') return;
    if (!CLAUDE_UUID_RE.test(obj.sessionId) || !CLAUDE_CWD_RE.test(obj.cwd)) return;
    pushClaudeSession(tabId, obj.sessionId, obj.cwd);
  } catch { /* missing / mid-write / unparseable — ignore, next write retries */ }
}

// A captured session, whichever source found it (the hook's file, or Claude Code's
// own record, read beside the server watcher), reaches the renderer the same way: the
// id and folder for setClaudeSession, then the transcript read and the folder watch
// that follow a capture. Both callers have validated the id and the folder.
function pushClaudeSession(tabId: string, sessionId: string, cwd: string): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('claude-session:update', { tabId, sessionId, cwd });
  // The hook rewrites its file on UserPromptSubmit and Stop, so once a turn. Read
  // the transcript on the same beat: that is what keeps the model current after a
  // /model switch, and gives a nameless chat its first-prompt fallback.
  const meta = readClaudeMeta(sessionId, cwd);
  // Edited files, Phase 2: from the chat's first turn on, watch the folder it
  // works in, so files its commands change can be attributed to it.
  watchChatFolder(tabId, meta.cwd || cwd);
  mainWindow.webContents.send('claude-session:meta', {
    tabId, sessionId, firstPrompt: meta.firstPrompt, model: meta.model, cwd: meta.cwd,
  });
}

let claudeWatchStarted = false;
function startClaudeSessionWatch() {
  if (claudeWatchStarted) return;
  claudeWatchStarted = true;
  const dir = getClaudeSessionDir();
  const debounce = new Map<string, NodeJS.Timeout>();
  try {
    // The hook rewrites a tab's file every turn; debounce per-tab so a burst of
    // writes collapses into one read+push.
    fs.watch(dir, (_event, filename) => {
      const name = filename?.toString();
      if (!name || !name.endsWith('.json')) return;
      const tabId = name.slice(0, -'.json'.length);
      clearTimeout(debounce.get(tabId));
      debounce.set(tabId, setTimeout(() => { debounce.delete(tabId); readAndPushClaudeSession(tabId); }, 150));
    });
  } catch { /* dir watch unsupported — capture silently degrades, resume still works off last save */ }
}

// On demand, for a thread the renderer already knows the session of (a restored tab,
// or one whose hook file has not been rewritten this launch). Invalid input returns
// the not-found result rather than throwing.
ipcMain.handle('claude-session:meta', (_event, sessionId: unknown, cwd: unknown) => {
  if (!isSessionId(sessionId) || typeof cwd !== 'string' || !cwd) {
    return { firstPrompt: null, model: null, cwd: null, exists: false };
  }
  return readClaudeMeta(sessionId, cwd);
});

// ─── Edited files: the files a chat changed (docs/edited-files) ──────────────

// Reads a session's transcript (and its subagents' files) incrementally: the byte
// offset per file is remembered, so after the first read only what was appended is
// parsed. The first read of a long session is chunked with a setImmediate between
// chunks so PTY output keeps flowing (a 60 MB transcript measured 350ms in total,
// no single block over 31ms). Read-only: nothing under ~/.claude is ever written.
const sessionFilesStore = createSessionFilesStore({
  fs: {
    size: (p) => fs.promises.stat(p).then(s => (s.isFile() ? s.size : null), () => null),
    read: async (p, position, length) => {
      const handle = await fs.promises.open(p, 'r');
      try {
        const buf = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buf, 0, length, position);
        return new Uint8Array(buf.buffer, buf.byteOffset, bytesRead);
      } finally {
        await handle.close();
      }
    },
    list: (p) => fs.promises.readdir(p).catch(() => [] as string[]),
  },
  locate: (sessionId, cwd) => findTranscript(getClaudeProjectsDir(), cwd, sessionId, fs),
  yieldNow: () => new Promise(resolve => setImmediate(resolve)),
});

function isUsableFile(p: string): boolean {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

// A path from the renderer that is about to reach a launcher: absolute, no quote
// or control characters (explorer's /select, argument is passed verbatim), and a
// file that exists.
function checkedPath(p: unknown): string | null {
  if (typeof p !== 'string' || !p || p.length > 1024) return null;
  if (/["\r\n\t\0]/.test(p) || !isAbsolutePath(p)) return null;
  return normalizePath(p);
}

function checkedFile(p: unknown): string | null {
  const file = checkedPath(p);
  return file && isUsableFile(file) ? file : null;
}

function checkedFolder(p: unknown): string | null {
  const folder = checkedPath(p);
  return folder && isUsableFolder(folder) ? folder : null;
}

// ─── Edited files, Phase 2: files changed by the chat's commands ─────────────

// Every change the folder watches saw, bounded (pruneChanges). Attribution to a
// chat happens when its list is read: a change counts only if one of that chat's
// Bash/PowerShell calls was running in that folder at the time (command-files.ts).
let fsChanges: FsChange[] = [];
const folderWatches = new Map<string, { folder: string; watcher: fs.FSWatcher; tabs: Set<string> }>();
const tabWatchFolder = new Map<string, string>();
const pendingChangeStats = new Map<string, NodeJS.Timeout>();

// Folders never watched whole: a chat started in the home folder, a drive root,
// the temp folder or Windows itself would have the watch flooded by everything
// else on the machine.
function watchableFolder(folder: string): boolean {
  const key = normalizePath(folder).toLowerCase();
  if (/^[a-z]:\\?$/.test(key)) return false;
  const never = [os.homedir(), os.tmpdir(), process.env.SystemRoot || 'C:\\Windows', process.env.APPDATA || '', process.env.LOCALAPPDATA || '']
    .filter(Boolean).map(p => normalizePath(p).toLowerCase());
  return !never.includes(key) && isUsableFolder(folder);
}

function noteFsChange(root: string, rel: string): void {
  const full = normalizePath(path.join(root, rel));
  if (isIgnoredChange(full, root)) return;
  const seen = Date.now();
  // A write is often several events in a row; one stat after the burst settles.
  const key = full.toLowerCase();
  clearTimeout(pendingChangeStats.get(key));
  pendingChangeStats.set(key, setTimeout(() => {
    pendingChangeStats.delete(key);
    fs.promises.stat(full).then(st => {
      if (!st.isFile()) return;
      fsChanges.push({ path: full, at: seen, birth: st.birthtimeMs });
      if (fsChanges.length > 25000) fsChanges = pruneChanges(fsChanges, Date.now());
    }, () => { /* deleted or renamed away: nothing to open */ });
  }, 150));
}

function watchChatFolder(tabId: string, folder: string): void {
  if (!folder || !ptys.has(tabId)) return;
  const key = normalizePath(folder).toLowerCase();
  if (tabWatchFolder.get(tabId) === key) return;
  unwatchChatFolder(tabId);
  if (!watchableFolder(folder)) return;
  let entry = folderWatches.get(key);
  if (!entry) {
    const root = normalizePath(folder);
    let watcher: fs.FSWatcher;
    try {
      watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
        if (filename) noteFsChange(root, filename.toString());
      });
    } catch (err) {
      console.error('[files] could not watch', root, err);
      return;
    }
    watcher.on('error', () => {
      try { watcher.close(); } catch {}
      folderWatches.delete(key);
    });
    entry = { folder: root, watcher, tabs: new Set() };
    folderWatches.set(key, entry);
  }
  entry.tabs.add(tabId);
  tabWatchFolder.set(tabId, key);
  if (process.env.AFTERTERM_HARNESS === '1') console.log(`[harness] files:watch ${entry.folder} tabs=${[...entry.tabs].join(',')}`);
}

function unwatchChatFolder(tabId: string): void {
  const key = tabWatchFolder.get(tabId);
  if (!key) return;
  tabWatchFolder.delete(tabId);
  const entry = folderWatches.get(key);
  if (!entry) return;
  entry.tabs.delete(tabId);
  if (entry.tabs.size > 0) return;
  try { entry.watcher.close(); } catch {}
  folderWatches.delete(key);
  if (process.env.AFTERTERM_HARNESS === '1') console.log(`[harness] files:unwatch ${entry.folder}`);
}

// Attributed files are kept per session in <userData>\edited-files\<sessionId>.json,
// because the watch only sees what happens while the app runs.
function commandFilesPath(sessionId: string): string {
  return path.join(app.getPath('userData'), 'edited-files', `${sessionId}.json`);
}

function commandFilesFor(sessionId: string, windows: ShellWindow[]): ChangedFile[] {
  const file = commandFilesPath(sessionId);
  let saved: unknown = [];
  let savedText = '';
  try {
    savedText = fs.readFileSync(file, 'utf-8');
    saved = (JSON.parse(savedText) as { commandFiles?: unknown }).commandFiles ?? [];
  } catch { /* none yet */ }
  const fresh = attributeCommandChanges(fsChanges, windows, Date.now());
  const merged = mergeSaved(saved, fresh);
  if (fresh.length > 0) {
    const text = JSON.stringify({ version: 1, commandFiles: merged });
    if (text !== savedText) {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text, 'utf-8');
      } catch { /* the list still shows them this launch */ }
    }
  }
  return merged;
}

ipcMain.handle('session-files:list', async (_event, sessionId: unknown, cwd: unknown) => {
  if (!isSessionId(sessionId) || typeof cwd !== 'string' || !cwd) return EMPTY_SESSION_FILES;
  const started = Date.now();
  // Claude Code's own temp folder holds its scratchpad scripts: working files, not
  // the chat's work, so they stay out of the list.
  const files = await sessionFilesStore.list(
    sessionId, cwd,
    state => commandFilesFor(sessionId, state.windows),
    [path.join(os.tmpdir(), 'claude')],
  );
  if (process.env.AFTERTERM_HARNESS === '1') {
    console.log(`[harness] session-files:list ${sessionId} changed=${files?.changed.length ?? 0} command=${files?.changed.filter(f => f.source === 'command').length ?? 0} pasted=${files?.pasted.length ?? 0} in ${Date.now() - started}ms`);
  }
  return files ?? EMPTY_SESSION_FILES;
});

// AFT-61: the chat's links that start with each prefix (the part of a link on its
// first row in the terminal), most recently written first. Claude Code cuts a long
// link over several rows itself, so the terminal cannot tell where it ends; the
// transcript can. The same incremental read as the Files list, so asking costs only
// what was appended since.
const MAX_URL_PREFIXES = 50;
ipcMain.handle('session-files:urls', async (_event, sessionId: unknown, cwd: unknown, prefixes: unknown) => {
  if (!isSessionId(sessionId) || typeof cwd !== 'string' || !cwd || !Array.isArray(prefixes)) return {};
  const asked = prefixes
    .filter((p): p is string => typeof p === 'string' && p.length <= 4096 && /^https?:\/\/./i.test(p))
    .slice(0, MAX_URL_PREFIXES);
  if (asked.length === 0) return {};
  const got = await sessionFilesStore.read(sessionId, cwd);
  const out: Record<string, string[]> = {};
  for (const p of asked) out[p] = got ? transcriptUrls(got.state, p) : [];
  return out;
});

// Claude Code keeps its own copy of a pasted image in %TEMP% (undocumented, and
// Windows may clear it). Looked for under the project dir of the folder the image
// was pasted in, then under every project dir, since a session can move worktree.
function pastedTempFile(sessionId: string, cwd: string, n: number): string | null {
  const tmp = os.tmpdir();
  const first = pastedTempPath(tmp, projectDirName(cwd), sessionId, n);
  if (isUsableFile(first)) return first;
  try {
    for (const dir of fs.readdirSync(path.join(tmp, 'claude'))) {
      const candidate = pastedTempPath(tmp, dir, sessionId, n);
      if (isUsableFile(candidate)) return candidate;
    }
  } catch { /* no %TEMP%\claude at all */ }
  return null;
}

// The file to show for one pasted image: Claude Code's temp copy when it is still
// there and is this paste's own (a later paste with the same number overwrites
// it), otherwise the image decoded once out of the transcript into
// <userData>\pasted\<sessionId>\<N>-<paste>.png. Null when the paste cannot be found.
async function pastedImageFile(sessionId: string, cwd: string, key: string): Promise<string | null> {
  const got = await sessionFilesStore.read(sessionId, cwd);
  if (!got) return null;
  const image = got.state.pasted.find(p => p.key === key);
  if (!image) return null;
  if (ownsTempFile(got.state.pasted, key)) {
    const temp = pastedTempFile(sessionId, image.cwd ?? cwd, image.n);
    if (temp) return temp;
  }
  const dir = path.join(app.getPath('userData'), 'pasted', sessionId);
  const ext = image.mediaType === 'image/jpeg' ? 'jpg' : image.mediaType.replace(/^image\//, '').replace(/[^a-z0-9]/g, '') || 'png';
  // Named after this paste, not only its number: a later paste can reuse the number,
  // and must not be handed the file an earlier one left here.
  const file = path.join(dir, `${image.n}-${key.replace(/[^A-Za-z0-9]/g, '').slice(0, 8)}.${ext}`);
  if (isUsableFile(file)) return file;
  const bytes = await sessionFilesStore.pastedBytes(sessionId, cwd, key);
  if (!bytes) return null;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, bytes.data);
    return file;
  } catch {
    return null;
  }
}

// A small data URL for the list's thumbnail, so the renderer never needs file://.
ipcMain.handle('session-files:thumb', async (_event, sessionId: unknown, cwd: unknown, key: unknown) => {
  if (!isSessionId(sessionId) || typeof cwd !== 'string' || typeof key !== 'string') return null;
  const file = await pastedImageFile(sessionId, cwd, key);
  if (!file) return null;
  try {
    const image = nativeImage.createFromPath(file);
    if (image.isEmpty()) return null;
    const { width } = image.getSize();
    return (width > 320 ? image.resize({ width: 320, quality: 'good' }) : image).toDataURL();
  } catch {
    return null;
  }
});

// Under the agent harness nothing may open on the person's screen, so each opener
// logs what it would have opened (after its checks), like shell:openExternal.
//
// This is the one place a file reaches Windows' default app, and for a script that
// default is to run it. A file that afterterm opens must never run (Aryan, 2026-11-06:
// "They should not run. They should always open."), so the check is here and not only
// in the renderer's choice, and nothing that calls this can get round it.
async function openWithDefaultApp(file: string): Promise<{ ok: boolean; error?: string }> {
  if (!isSafeForDefaultApp(file)) return { ok: false, error: 'Could not open the file' };
  if (harnessOnlyLogsExternal()) {
    console.log(`[harness] files:openDefault ${file}`);
    return { ok: true };
  }
  const error = await shell.openPath(file);
  return error ? { ok: false, error: 'Could not open the file' } : { ok: true };
}

ipcMain.handle('session-files:openPasted', async (_event, sessionId: unknown, cwd: unknown, key: unknown) => {
  if (!isSessionId(sessionId) || typeof cwd !== 'string' || typeof key !== 'string') return { ok: false, error: 'Image not found' };
  const file = await pastedImageFile(sessionId, cwd, key);
  if (!file) return { ok: false, error: 'Image not found' };
  return { ...(await openWithDefaultApp(file)), path: file };
});

// The pasted image's file path without opening it, for Show in File Explorer and
// Copy path on its row.
ipcMain.handle('session-files:pastedPath', async (_event, sessionId: unknown, cwd: unknown, key: unknown) => {
  if (!isSessionId(sessionId) || typeof cwd !== 'string' || typeof key !== 'string') return null;
  return pastedImageFile(sessionId, cwd, key);
});

// With no editor detected, a file safe to hand over goes to its own app and anything
// else to Notepad, which is on every Windows and only ever shows a file.
async function openWithoutEditor(file: string): Promise<{ ok: boolean; error?: string }> {
  if (isSafeForDefaultApp(file)) return openWithDefaultApp(file);
  if (harnessOnlyLogsExternal()) {
    console.log(`[harness] files:open Notepad ${file}`);
    return { ok: true };
  }
  const result = await spawnDetached('notepad.exe', [file]);
  return result.ok ? { ok: true } : { ok: false, error: 'Could not open the file' };
}

// Open a file in the primary detected editor (VS Code), at a line when one is given.
ipcMain.handle('files:open', async (_event, target: unknown, line?: unknown) => {
  const file = checkedFile(target);
  if (!file) return { ok: false, error: 'File not found' };
  if (!editorsKnown) await runEditorDetection('first file open');
  const editor = cachedEditors[0];
  if (!editor) return openWithoutEditor(file);
  const at = typeof line === 'number' && Number.isInteger(line) && line > 0 ? line : null;
  // Every detected product but 'other' is VS Code or a fork of it, which all take
  // -g file:line. An unknown editor gets the plain path.
  const args = at && editor.product !== 'other' ? ['-g', `${file}:${at}`] : [file];
  if (harnessOnlyLogsExternal()) {
    console.log(`[harness] files:open ${editor.name} ${args.join(' ')}`);
    return { ok: true };
  }
  const result = await new Promise<{ ok: boolean; error?: string }>(resolve => {
    let child;
    try {
      child = spawn(editor.path, args, { detached: true, stdio: 'ignore', windowsHide: false });
    } catch (err) {
      resolve({ ok: false, error: String(err) });
      return;
    }
    child.once('spawn', () => { try { child.unref(); } catch {} resolve({ ok: true }); });
    child.once('error', (err) => resolve({ ok: false, error: String(err) }));
  });
  if (result.ok) return { ok: true };
  console.error(`[editors] could not open ${file} in ${editor.path}:`, result.error);
  void runEditorDetection('re-detect after a failed file open');
  return { ok: false, error: `Couldn't open ${editor.name}` };
});

// Phase 3: which of the paths a terminal line might mean really exist, so only
// those are underlined. One batched call per rendered line, cached renderer-side.
// A WSL path is never touched (a stat on one can hang), like isUsableFolder.
const MAX_STAT_PATHS = 200;
ipcMain.handle('files:stat', async (_event, paths: unknown) => {
  const result: Record<string, 'file' | 'dir' | null> = {};
  if (!Array.isArray(paths)) return result;
  await Promise.all(paths.slice(0, MAX_STAT_PATHS).map(async (p) => {
    if (typeof p !== 'string' || !p || p.length > 1024 || p in result) return;
    if (!isAbsolutePath(p) || isWslPath(p) || /^\\\\/.test(p)) { result[p] = null; return; }
    try {
      const st = await fs.promises.stat(p);
      result[p] = st.isFile() ? 'file' : st.isDirectory() ? 'dir' : null;
    } catch {
      result[p] = null;
    }
  }));
  return result;
});

// File links' last resort (2026-09-26): a bare file name found under the chat's or
// the project's folder. One index per folder (file-index.ts), rebuilt when older
// than 30s, shared by every hover; folders the watch never covers whole (the home
// folder, a drive root, %TEMP%) are never indexed either.
const nameIndexes = new Map<string, { index?: NameIndex; building?: Promise<NameIndex> }>();
const NAME_INDEX_TTL_MS = 30_000;
const indexFs: IndexFs = {
  list: (dir) => fs.promises.readdir(dir, { withFileTypes: true })
    .then(ents => ents.map(e => ({ name: e.name, dir: e.isDirectory() })), () => []),
};

async function nameIndexFor(folder: string): Promise<NameIndex | null> {
  if (!watchableFolder(folder)) return null;
  const key = normalizePath(folder).toLowerCase();
  let entry = nameIndexes.get(key);
  if (!entry) { entry = {}; nameIndexes.set(key, entry); }
  if (entry.index && Date.now() - entry.index.builtAt < NAME_INDEX_TTL_MS) return entry.index;
  if (!entry.building) {
    const e = entry;
    e.building = buildNameIndex(normalizePath(folder), indexFs).then(idx => {
      e.index = idx;
      e.building = undefined;
      if (process.env.AFTERTERM_HARNESS === '1') console.log(`[harness] files:index ${idx.root} names=${idx.byName.size}${idx.truncated ? ' (partial)' : ''}`);
      return idx;
    }, err => { e.building = undefined; throw err; });
  }
  try { return (await entry.building) ?? null; } catch { return entry.index ?? null; }
}

ipcMain.handle('files:find', async (_event, names: unknown, roots: unknown) => {
  const result: Record<string, string[]> = {};
  if (!Array.isArray(names) || !Array.isArray(roots)) return result;
  const folders = roots.filter((r): r is string => typeof r === 'string' && isAbsolutePath(r)).slice(0, 3);
  const indexes = (await Promise.all(folders.map(nameIndexFor))).filter((i): i is NameIndex => !!i);
  for (const name of names.slice(0, 50)) {
    if (typeof name !== 'string' || !name || name.length > 260) continue;
    const found: string[] = [];
    for (const idx of indexes) for (const p of findByName(idx, name)) if (!found.includes(p)) found.push(p);
    result[name] = found.slice(0, 20);
  }
  return result;
});

// A folder a file link points at: the same Explorer launch as a project folder's.
ipcMain.handle('files:openFolder', async (_event, folder: unknown) => {
  if (typeof folder !== 'string' || !isAbsolutePath(folder) || !isUsableFolder(folder)) return { ok: false, error: 'Folder not found' };
  if (harnessOnlyLogsExternal()) {
    console.log(`[harness] files:openFolder ${folder}`);
    return { ok: true };
  }
  const result = await spawnDetached('explorer.exe', [normalizePath(folder)]);
  return result.ok ? { ok: true } : { ok: false, error: 'Could not open File Explorer' };
});

ipcMain.handle('files:openDefault', async (_event, target: unknown) => {
  const file = checkedFile(target);
  if (!file) return { ok: false, error: 'File not found' };
  return openWithDefaultApp(file);
});

// File Explorer with the file or folder selected, in the folder holding it. The
// argument is verbatim (explorer does its own parsing of /select,"path");
// checkedPath has refused any quote in it.
ipcMain.handle('files:reveal', async (_event, target: unknown) => {
  const file = checkedFile(target) ?? checkedFolder(target);
  if (!file) return { ok: false, error: 'File not found' };
  if (harnessOnlyLogsExternal()) {
    console.log(`[harness] files:reveal ${file}`);
    return { ok: true };
  }
  return new Promise(resolve => {
    try {
      const child = execFile('explorer.exe', [`/select,"${file}"`], { windowsVerbatimArguments: true, windowsHide: false }, () => {});
      child.once('spawn', () => { try { child.unref(); } catch {} resolve({ ok: true }); });
      child.once('error', () => resolve({ ok: false, error: 'Could not open File Explorer' }));
    } catch {
      resolve({ ok: false, error: 'Could not open File Explorer' });
    }
  });
});

// ─── Thread tails (scrollback that survives sleep and quit) ──────────────────

// ConPTY dies with its process, so a thread that goes to sleep, or an app that quits,
// loses its screen. The renderer hands us the last lines of each thread's buffer and
// we keep them as <userData>/threads/<tabId>.txt, so waking can replay them dimmed
// above a "Woke just now" divider instead of showing a blank terminal. Format and
// trimming live in src/thread-tail.ts (pure, unit-tested).
function getThreadsDir() {
  const dir = path.join(app.getPath('userData'), 'threads');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  return dir;
}

// The tab id comes from the renderer and becomes a file name, so isThreadId is the
// path-traversal guard on every one of these handlers.
ipcMain.handle('threads:saveTail', (_event, tabId: unknown, lines: unknown) => {
  if (!isThreadId(tabId) || !Array.isArray(lines)) return;
  try {
    const file = tailFilePath(getThreadsDir(), tabId);
    const tmp = `${file}.tmp`;
    // Write then rename: a tail saved while the app is being torn down must never
    // leave a half-written file that the next launch replays as garbage.
    fs.writeFileSync(tmp, serializeTail(trimTail(lines as string[])), 'utf-8');
    fs.renameSync(tmp, file);
  } catch { /* a lost tail is cosmetic, never let it break sleep or close */ }
});

// The renderer's beforeunload flush at quit: every awake thread's tail in one blocking
// call, so nothing is lost to the race between the window closing and async writes
// landing. At most a few dozen files of 64 KB, so plain writeFileSync is fast enough
// and the rename dance is not worth the extra syscalls here.
ipcMain.on('threads:saveTailsSync', (event, tails: unknown) => {
  try {
    const dir = getThreadsDir();
    for (const [tabId, lines] of Object.entries((tails ?? {}) as Record<string, unknown>)) {
      if (!isThreadId(tabId) || !Array.isArray(lines)) continue;
      try {
        fs.writeFileSync(tailFilePath(dir, tabId), serializeTail(trimTail(lines as string[])), 'utf-8');
      } catch { /* skip this one, keep flushing the rest */ }
    }
  } catch {}
  event.returnValue = true;
});

ipcMain.handle('threads:readTail', (_event, tabId: unknown): string[] | null => {
  if (!isThreadId(tabId)) return null;
  try {
    return parseTail(fs.readFileSync(tailFilePath(getThreadsDir(), tabId), 'utf-8'));
  } catch {
    return null; // no tail saved, or unreadable: the thread just wakes blank
  }
});

ipcMain.handle('threads:deleteTail', (_event, tabId: unknown) => {
  if (!isThreadId(tabId)) return;
  try { fs.unlinkSync(tailFilePath(getThreadsDir(), tabId)); } catch {}
});

// Called once after session restore with every live tab id plus every history entry
// id. Without it a tail whose thread and history entry are both gone would sit on
// disk forever. Returns how many files were removed.
const THREAD_PRUNE_KEEP_MAX = 5000;
ipcMain.handle('threads:prune', (_event, keepIds: unknown): number => {
  const keep = new Set(
    (Array.isArray(keepIds) ? keepIds : []).slice(0, THREAD_PRUNE_KEEP_MAX).filter(isThreadId)
  );
  let deleted = 0;
  try {
    const dir = getThreadsDir();
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.txt')) continue; // leaves any .tmp from an interrupted write alone
      const id = name.slice(0, -'.txt'.length);
      if (!isThreadId(id) || keep.has(id)) continue;
      try { fs.unlinkSync(path.join(dir, name)); deleted++; } catch {}
    }
  } catch {}
  return deleted;
});

// ─── Branch and worktree ─────────────────────────────────────────────────────

// Reads .git/HEAD (and a worktree's .git file), never runs git. See src/git-info.ts.
ipcMain.handle('git:info', (_event, cwd: unknown) => {
  if (typeof cwd !== 'string' || !cwd) return { branch: null, worktree: null, repoRoot: null, top: null };
  return gitInfo(cwd, fs);
});

// One round trip for the renderer's slow poll over every live thread. Capped so a
// bad caller cannot ask for an unbounded number of file walks on the main thread.
const GIT_INFO_MANY_MAX = 500;
ipcMain.handle('git:infoMany', (_event, cwds: unknown) => {
  if (!Array.isArray(cwds)) return [];
  return cwds.slice(0, GIT_INFO_MANY_MAX).map(cwd =>
    typeof cwd === 'string' && cwd ? gitInfo(cwd, fs) : { branch: null, worktree: null, repoRoot: null, top: null }
  );
});

// The page's latest state, in memory (AFT-33). The file is written two seconds after
// a change; a page that crashes or hangs never writes its last changes, and a page
// reloaded after that must still find the threads it had (a thread created a second
// before, whose shell main still holds). So the page also sends its state here a
// moment after every change (session:remember), and every save lands here too. A
// page loading inside one run of the app reads this copy; a launch has none and
// reads the file.
let rememberedSession: string | null = null;

ipcMain.on('session:remember', (_event, data: unknown) => {
  if (typeof data === 'string') rememberedSession = data;
});

ipcMain.handle('session:save', (_event, data: string) => {
  if (typeof data === 'string') rememberedSession = data;
  try {
    fs.writeFileSync(getSessionPath(), data, 'utf-8');
  } catch {}
});

// Synchronous save — used on window 'beforeunload' so the last state (e.g. a fresh
// cwd) is flushed before the renderer tears down. sendSync blocks until written.
ipcMain.on('session:save-sync', (event, data: string) => {
  if (typeof data === 'string') rememberedSession = data;
  try {
    fs.writeFileSync(getSessionPath(), data, 'utf-8');
  } catch {}
  event.returnValue = true;
});

ipcMain.handle('session:load', () => {
  if (rememberedSession !== null) {
    try {
      return JSON.parse(rememberedSession);
    } catch { /* fall back to the file */ }
  }
  try {
    return JSON.parse(fs.readFileSync(getSessionPath(), 'utf-8'));
  } catch {
    return null;
  }
});

// ─── Graceful shutdown — drain all PTYs before quit ──────────────────────────

let isQuitting = false;   // user has confirmed/initiated quit (suppresses close dialog)
let ptysDrained = false;  // PTY teardown has run (separate so it always runs once)

async function destroyAllPtys() {
  const kills = [...ptys.entries()].map(async ([tabId, p]) => {
    await killTree(tabId, p.pid, shellPids.get(tabId));
    try { p.kill(); } catch {}
  });
  await Promise.all(kills);
  ptys.clear();
  lastActivitySent.clear();
  ptyCreatedAt.clear();
}

app.on('before-quit', async (e) => {
  isQuitting = true; // any quit path suppresses the close-confirm dialog
  if (ptysDrained || ptys.size === 0) return;
  e.preventDefault();
  ptysDrained = true;
  await destroyAllPtys();
  app.quit();
});

// will-quit, not before-quit: before-quit can be cancelled (the PTY drain above), and
// the hook repair poll should keep working until the app really goes.
app.on('will-quit', stopHookRepairPoll);

// ─── Installer mode: the setup check ─────────────────────────────────────────

// A process runner for setup-check.ts: stdin in, stdout and stderr out, a hard
// timeout, never a console window, never a throw.
const runProcess: Runner = (command, args, { env, input, timeoutMs }) => new Promise((resolve) => {
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(command, args, { env: (env ?? process.env) as NodeJS.ProcessEnv, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    resolve({ code: null, stdout: '', stderr: '', error: String(err) });
    return;
  }
  let stdout = '';
  let stderr = '';
  let settled = false;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; try { child.kill(); } catch { /* gone */ } }, timeoutMs);
  child.stdout?.on('data', (d) => { stdout += d; });
  child.stderr?.on('data', (d) => { stderr += d; });
  child.once('error', (err) => {
    if (settled) return;
    settled = true; clearTimeout(timer);
    resolve({ code: null, stdout, stderr, error: String(err) });
  });
  child.once('close', (code) => {
    if (settled) return;
    settled = true; clearTimeout(timer);
    resolve({ code, stdout, stderr, timedOut });
  });
  child.stdin?.on('error', () => { /* the child exited before reading */ });
  child.stdin?.end(input ?? '');
});

// Register the hook, test it, and switch it to the second way when only that
// works here. Writes three files beside `out` for the installer's Check page:
//   <out>            [check] claude, notifications, resume, reason (key=value lines)
//   <out>.report.txt the report, opened by "See what's sent"
//   <out>.issue.txt  the filled-in GitHub URL, opened by `--open-issue`
async function runSetupCheckCli(out: string): Promise<void> {
  const prefsPath = getPrefsPath();
  reconcileNotifierHook();
  const opts = {
    claudeDir: getClaudeDir(),
    scriptSource: getHookScriptSource(),
    userDataDir: app.getPath('userData'),
    aftertermVersion: app.getVersion(),
    installKind: (app.isPackaged ? 'installer' : 'dev') as 'installer' | 'dev',
  };
  const deps = { run: runProcess, fs, env: process.env, homeDir: app.getPath('home'), tmpDir: os.tmpdir() };
  let result = await runSetupCheck(opts, deps);
  if (result.workingMode === 'command' && readPrefs(prefsPath).prefs.claudeHookMode !== 'command') {
    updatePrefs(prefsPath, { claudeHookMode: 'command' });
    reconcileNotifierHook();
    result = await runSetupCheck(opts, deps); // confirm the rewritten entries pass as registered
  }
  console.log(`[setup-check] claude=${result.claude.found} notifications=${result.notifications} resume=${result.resume} mode=${result.workingMode}`);
  const ini = [
    '[check]',
    `claude=${result.claude.found ? 'found' : 'missing'}`,
    `notifications=${result.notifications}`,
    `resume=${result.resume}`,
    `reason=${result.claude.found && !result.workingMode ? failureNote(result) : ''}`,
    '',
  ].join('\r\n');
  fs.writeFileSync(out, ini, 'utf-8');
  fs.writeFileSync(`${out}.report.txt`, result.report.replace(/\n/g, '\r\n'), 'utf-8');
  fs.writeFileSync(`${out}.issue.txt`, result.report ? issueUrl(result) : '', 'utf-8');
}

// `--open-issue=<file>`: open the URL the setup check wrote, and only ever a new
// issue on afterterm's own repository (the file sits in a temp folder anyone on
// the machine could write to).
async function openIssueFromFile(file: string): Promise<void> {
  try {
    const url = fs.readFileSync(file, 'utf-8').trim();
    if (url.startsWith(`${ISSUES_URL}?`)) await shell.openExternal(url);
  } catch { /* nothing to open */ }
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

// A second launch was refused the lock (see isPrimaryCopy): bring this window forward.
app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.whenReady().then(async () => {
  if (!isPrimaryCopy) return;
  if (setupCheckOut || openIssueFile) {
    try {
      if (setupCheckOut) await runSetupCheckCli(setupCheckOut);
      if (openIssueFile) await openIssueFromFile(openIssueFile);
    } catch (err) {
      console.error('[setup-check] failed:', err);
    }
    app.exit(0);
    return;
  }
  // Before any window loads: the preload reads app:last-opened-at synchronously.
  initLastOpenedAt();
  // Automatic updates (src/updater.ts): its IPC is there before the renderer
  // asks; the registry read and the first check run later, off the launch path.
  initUpdater({
    getWindow: () => mainWindow,
    prefsPath: getPrefsPath,
    productName: sandbox ? 'afterterm (test)' : 'afterterm',
    assetBase: sandbox ? 'afterterm-test' : 'afterterm',
    quit: () => app.quit(),
  });
  createNotifierWindow();
  createWindow();
  reconcileNotifierHook();
  // After the launch reconcile, so the poll starts from a complete settings.json.
  startHookRepairPoll();
  startClaudeSessionWatch();
  // Editors: last launch's list at once, then a fresh detection in the background
  // (asynchronous, so it never holds the main thread; see detectDeps).
  loadEditorCache();
  setTimeout(() => { void runEditorDetection('startup'); }, 1200);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

import { app, BrowserWindow, ipcMain, dialog, screen, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execFile, execFileSync, execSync, spawn } from 'child_process';
import * as pty from 'node-pty';
import { runNotifierSelfTest, runNotifierDemo } from './notifier-selftest';
import { reconcileClaudeHook, HOOK_SCRIPT_NAME } from './claude-hook-install';
import { detectEditors } from './editor-detect.ts';
import type { DetectDeps } from './editor-detect.ts';
import type { EditorInfo } from './editors.ts';
import { readPrefs, updatePrefs } from './prefs.ts';
import { planSpawn } from './shell-integration.ts';
import { readTranscriptMeta, isSessionId } from './claude-transcript.ts';
import { gitInfo } from './git-info.ts';
import { isThreadId, parseTail, serializeTail, tailFilePath, trimTail } from './thread-tail.ts';
import { listenerKey, parseNetstatListeners, parseProcessList, tabPorts, trackFirstSeen } from './server-detect.ts';
import type { Proc as ServerProc } from './server-detect.ts';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

// Dev/test isolation: point userData (session.json, prefs.json) at a throwaway dir
// so a dev run can't clobber the user's real, possibly-running build. Must be set
// before any app.getPath('userData') call. No-op in normal use.
if (process.env.AFTERTERM_USER_DATA_DIR) {
  app.setPath('userData', process.env.AFTERTERM_USER_DATA_DIR);
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
// users get, which is unchanged. This does not fix the "toasts on the wrong monitor"
// bug in docs/bugs.md (that one is about following the main window at runtime).
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

  try {
    execSync('where pwsh.exe', { stdio: 'ignore' });
    shells.push({ id: 'pwsh', name: 'PowerShell 7', command: 'pwsh.exe', args: [] });
  } catch {}

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

  try {
    execSync('where wsl.exe', { stdio: 'ignore' });
    shells.push({ id: 'wsl', name: 'WSL', command: 'wsl.exe', args: [] });
  } catch {}

  cachedShells = shells;
  return shells;
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

const shellPids = new Map<string, number>();
const lastPortSent = new Map<string, number | null>();
// When each listening socket ("pid:port") was first seen, so a tree listening on
// several ports can show the one that started latest, which is the one the user just
// started. trackFirstSeen adds and prunes entries; portForTree reads them.
const listenerFirstSeen = new Map<string, number>();

let cachedProcs: ServerProc[] = [];
let cachedProcsAt = 0;
let lastListenerKey: string | null = null;
// Set whenever a PTY appears or disappears: the cached process list cannot describe
// a tree that did not exist when it was taken.
let treeDirty = true;

let pollRunning = false;
let pollAgain = false;
let serverPollTimer: NodeJS.Timeout | null = null;
let burstTimer: NodeJS.Timeout | null = null;
let lastBurstPollAt = 0;
// Warn once per failure kind: a machine without netstat would otherwise fill the log.
let warnedNetstat = false;
let warnedProcList = false;

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
      try {
        const json = await runCommand(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', PROC_LIST_COMMAND],
          16 * 1024 * 1024,
          15_000,
        );
        cachedProcs = parseProcessList(json);
        cachedProcsAt = Date.now();
        treeDirty = false;
      } catch (err) {
        if (!warnedProcList) {
          warnedProcList = true;
          console.warn(`[servers] process list failed (${reason}), ports left as they were:`, err);
        }
        return;
      }
    }
    lastListenerKey = key;

    for (const [tabId, port] of tabPorts(shellPids, cachedProcs, listeners, listenerFirstSeen)) {
      if (lastPortSent.get(tabId) === port) continue;
      lastPortSent.set(tabId, port);
      sendPort(tabId, port);
    }
  } finally {
    pollRunning = false;
    if (pollAgain) {
      pollAgain = false;
      void pollServers('a poll was requested while one was running');
    }
  }
}

function startServerPolling(): void {
  if (serverPollTimer) return;
  serverPollTimer = setInterval(() => {
    if (ptys.size === 0) { stopServerPolling(); return; }
    void pollServers('the slow interval');
  }, SERVER_POLL_MS);
}

function stopServerPolling(): void {
  if (serverPollTimer) { clearInterval(serverPollTimer); serverPollTimer = null; }
  if (burstTimer) { clearTimeout(burstTimer); burstTimer = null; }
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

/** A tab's PTY has gone: forget it, and clear its port in the UI straight away. */
function forgetServerTab(tabId: string): void {
  shellPids.delete(tabId);
  treeDirty = true;
  const last = lastPortSent.get(tabId);
  lastPortSent.delete(tabId);
  if (typeof last === 'number') sendPort(tabId, null);
}

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
function reconcileNotifierHook() {
  try {
    const result = reconcileClaudeHook({
      scriptSource: getHookScriptSource(),
      claudeDir: path.join(app.getPath('home'), '.claude'),
      prefsPath: path.join(app.getPath('userData'), 'prefs.json'),
    });
    console.log(`[claude-hook] ${result.status} — ${result.detail}`);
    if (result.showToast) pushSetupToast();
  } catch (err) {
    console.error('[claude-hook] reconcile failed:', err);
  }
}

// One-time "notifications enabled" toast through the existing overlay path. Uses a
// sentinel tabId the renderer ignores on click (handleActivate no-ops unknown tabs).
function pushSetupToast() {
  const win = notifierWindow;
  if (!win || win.isDestroyed()) return;
  const send = () => {
    if (win.isDestroyed()) return;
    win.showInactive();
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

// Resize/reposition the overlay so it's anchored to the bottom-right of the work
// area and exactly as tall as the rendered toast stack (the renderer measures and
// reports `contentHeight`). Because the window is never larger than its visible
// content, there is no invisible dead zone swallowing clicks, and nothing for DWM
// to paint a white bar over above the toasts.
function positionNotifier(contentHeight: number) {
  if (!notifierWindow || notifierWindow.isDestroyed()) return;
  const wa = getTargetDisplay().workArea;
  const h = Math.max(1, Math.ceil(contentHeight));
  const x = wa.x + wa.width - NOTIFIER_WIDTH - NOTIFIER_MARGIN;
  const y = wa.y + wa.height - h - NOTIFIER_MARGIN;
  notifierWindow.setBounds({ x, y, width: NOTIFIER_WIDTH, height: h });
}

function createNotifierWindow() {
  const wa = getTargetDisplay().workArea;
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
  notifierWindow.setIgnoreMouseEvents(true, { forward: true });

  // Chromium copies the loaded document's title onto the native window — that's
  // what drew "index.html" into the DWM caption strip (the "white bar"). Refuse
  // every title update so the window stays titleless and no caption text is drawn.
  notifierWindow.on('page-title-updated', (e) => e.preventDefault());

  const notifierUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL
    ? `${MAIN_WINDOW_VITE_DEV_SERVER_URL}?notifier=1`
    : `file://${path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)}?notifier=1`;

  notifierWindow.loadURL(notifierUrl);
  notifierWindow.on('closed', () => { notifierWindow = null; });
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
    }
  });
}

// ─── IPC: notification overlay ──────────────────────────────────────────────

// Main window → notifier: push a new toast — show the window first so it's visible above other apps
ipcMain.on('notify:push', (_event, toast) => {
  if (notifierWindow && !notifierWindow.isDestroyed()) {
    notifierWindow.showInactive();
    notifierWindow.webContents.send('notify:push', toast);
  }
});

// Main window → notifier: dismiss toasts for a tab (user activated it)
ipcMain.on('notify:dismiss-tab', (_event, tabId: string) => {
  notifierWindow?.webContents.send('notify:dismiss-tab', tabId);
});

// Notifier → main window: user clicked a toast → focus app + switch tab
ipcMain.on('notify:tab-click', (_event, tabId: string) => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('notify:activate-tab', tabId);
  }
});

// Notifier → self: toggle mouse passthrough
ipcMain.on('notifier:set-ignore-mouse', (_event, ignore: boolean) => {
  notifierWindow?.setIgnoreMouseEvents(ignore, { forward: true });
});

// Notifier → self: hide window when all toasts are dismissed
ipcMain.on('notifier:hide', () => {
  notifierWindow?.hide();
});

// Notifier → self: renderer reports the measured height of its toast stack;
// resize the window to match so it's exactly as tall as the visible toasts.
ipcMain.on('notifier:resize', (_event, height: number) => {
  positionNotifier(height);
});

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
      if (process.env.AFTERTERM_HARNESS === '1') {
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
// throwing during startup.
const realDetectDeps: DetectDeps = {
  env: process.env as Record<string, string | undefined>,
  exists: (p) => { try { return fs.existsSync(p); } catch { return false; } },
  isFile: (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } },
  listDir: (p) => { try { return fs.readdirSync(p); } catch { return []; } },
  readText: (p) => { try { return fs.readFileSync(p, 'utf-8'); } catch { return null; } },
  whereCode: () => {
    try {
      const out = execFileSync('where', ['code'], {
        encoding: 'utf-8', timeout: 4000, windowsHide: true,
      });
      return out.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    } catch {
      return [];
    }
  },
  registryEditors: () => readUninstallEditors(),
};

const UNINSTALL_KEYS = [
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKCU\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
];

// Walk the uninstall registry and pull out the three values detection needs.
// `reg query ... /s` prints one blank-line-separated block per subkey, with
// values as "    Name    REG_SZ    value".
function readUninstallEditors(): { displayName: string; installLocation?: string; displayIcon?: string }[] {
  const entries: { displayName: string; installLocation?: string; displayIcon?: string }[] = [];
  for (const key of UNINSTALL_KEYS) {
    let out = '';
    try {
      out = execFileSync('reg', ['query', key, '/s'], {
        encoding: 'utf-8', timeout: 8000, windowsHide: true, maxBuffer: 32 * 1024 * 1024,
      });
    } catch {
      continue; // key absent on this machine, or reg refused it
    }
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

// Detection runs once, after the window is up, and is cached for the session. It
// re-runs when a launch fails or the user picks an editor by hand.
let cachedEditors: EditorInfo[] = [];
let editorPrefsPathInvalid = false;
let editorDetectionRan = false;

function runEditorDetection(reason: string): void {
  editorDetectionRan = true;
  try {
    const started = Date.now();
    const editorPath = readPrefs(getPrefsPath()).prefs.editorPath;
    const result = detectEditors(typeof editorPath === 'string' ? editorPath : undefined, realDetectDeps);
    cachedEditors = result.editors;
    editorPrefsPathInvalid = result.invalidPrefsPath;
    const found = result.editors.length
      ? result.editors.map(e => `${e.name} (${e.source})`).join(', ')
      : 'none found';
    console.log(`[editors] ${reason}: ${found}${result.invalidPrefsPath ? ', editorPath in prefs.json is not an editor' : ''} in ${Date.now() - started}ms`);
  } catch (err) {
    cachedEditors = [];
    editorPrefsPathInvalid = false;
    console.error('[editors] detection failed:', err);
  }
}

// If the renderer asks before the deferred startup run, detect now rather than
// answering with an empty list and hiding a button the user does have.
ipcMain.handle('editors:list', () => {
  if (!editorDetectionRan) runEditorDetection('first request from the renderer');
  return cachedEditors;
});

// True only when prefs.json holds an editorPath that exists and is not an
// editor. The renderer shows the "Editor path not valid" toast for this alone.
ipcMain.handle('editors:prefsPathInvalid', () => {
  if (!editorDetectionRan) runEditorDetection('first request from the renderer');
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
      runEditorDetection('unknown editor id from the renderer');
      editor = cachedEditors.find(e => e.id === editorId);
    }
    if (!editor) return { ok: false, error: 'Editor not found', editors: cachedEditors };
  } else {
    editor = cachedEditors[0];
  }
  if (!editor) return { ok: false, error: 'No editor found', editors: cachedEditors };

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
  runEditorDetection('re-detect after a failed launch');
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
  runEditorDetection('re-detect after the user chose an editor');
  return { editors: cachedEditors, invalid: editorPrefsPathInvalid };
});

// ─── IPC: create PTY ─────────────────────────────────────────────────────────

ipcMain.handle('pty:create', (_event, tabId: string, shellId?: string, cwd?: string) => {
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
  shellPids.set(tabId, p.pid);
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

  return { pid: p.pid };
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
  ptys.delete(tabId);
  lastActivitySent.delete(tabId);
  ptyCreatedAt.delete(tabId);
  forgetServerTab(tabId);
  if (ptys.size === 0) stopServerPolling();

  await new Promise<void>(resolve => {
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => resolve());
  });

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
const CLAUDE_UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const CLAUDE_CWD_RE = /^[A-Za-z]:\\[^\r\n;&|`$<>"'*?\t]*$/;

// Where Claude Code keeps its session transcripts, one folder per cwd. Read-only:
// afterterm never writes anything under it. AFTERTERM_CLAUDE_PROJECTS_DIR is the test
// override, so a harness run can point at a fixture folder instead of the real one.
function getClaudeProjectsDir() {
  return process.env.AFTERTERM_CLAUDE_PROJECTS_DIR || path.join(os.homedir(), '.claude', 'projects');
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
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('claude-session:update', { tabId, sessionId: obj.sessionId, cwd: obj.cwd });
      // The hook rewrites this file on UserPromptSubmit and Stop, so once a turn. Read
      // the transcript on the same beat: that is what keeps the model current after a
      // /model switch, and gives a nameless chat its first-prompt fallback.
      const meta = readClaudeMeta(obj.sessionId, obj.cwd);
      mainWindow.webContents.send('claude-session:meta', {
        tabId, sessionId: obj.sessionId, firstPrompt: meta.firstPrompt, model: meta.model,
      });
    }
  } catch { /* missing / mid-write / unparseable — ignore, next write retries */ }
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
    return { firstPrompt: null, model: null, exists: false };
  }
  return readClaudeMeta(sessionId, cwd);
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
  if (typeof cwd !== 'string' || !cwd) return { branch: null, worktree: null, repoRoot: null };
  return gitInfo(cwd, fs);
});

// One round trip for the renderer's slow poll over every live thread. Capped so a
// bad caller cannot ask for an unbounded number of file walks on the main thread.
const GIT_INFO_MANY_MAX = 500;
ipcMain.handle('git:infoMany', (_event, cwds: unknown) => {
  if (!Array.isArray(cwds)) return [];
  return cwds.slice(0, GIT_INFO_MANY_MAX).map(cwd =>
    typeof cwd === 'string' && cwd ? gitInfo(cwd, fs) : { branch: null, worktree: null, repoRoot: null }
  );
});

ipcMain.handle('session:save', (_event, data: string) => {
  try {
    fs.writeFileSync(getSessionPath(), data, 'utf-8');
  } catch {}
});

// Synchronous save — used on window 'beforeunload' so the last state (e.g. a fresh
// cwd) is flushed before the renderer tears down. sendSync blocks until written.
ipcMain.on('session:save-sync', (event, data: string) => {
  try {
    fs.writeFileSync(getSessionPath(), data, 'utf-8');
  } catch {}
  event.returnValue = true;
});

ipcMain.handle('session:load', () => {
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
  const kills = [...ptys.entries()].map(async ([, p]) => {
    const pid = p.pid;
    await new Promise<void>(r =>
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => r())
    );
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

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  // Before any window loads: the preload reads app:last-opened-at synchronously.
  initLastOpenedAt();
  createNotifierWindow();
  // Headless geometry self-test: drive the overlay through a toast sequence and
  // assert the window resizes to fit (no dead zone) and stays bottom-anchored.
  if (process.env.AFTERTERM_NOTIFY_TEST === '1') {
    runNotifierSelfTest(notifierWindow!);
    return; // skip the main window — this run only exercises the overlay
  }
  if (process.env.AFTERTERM_NOTIFY_DEMO === '1') {
    runNotifierDemo(notifierWindow!);
    return; // leave toasts on screen for visual inspection
  }
  createWindow();
  reconcileNotifierHook();
  startClaudeSessionWatch();
  // Editor detection reads the registry through `reg query`, which is synchronous
  // and can take a second. Deferred so the window paints and the first terminal
  // spawns before the main process is busy. The renderer asks for the list after
  // this; if it asks sooner, editors:list runs detection itself.
  setTimeout(() => { if (!editorDetectionRan) runEditorDetection('startup'); }, 1200);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

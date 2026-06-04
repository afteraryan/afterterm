import { app, BrowserWindow, ipcMain, dialog, screen, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { execFile, execSync } from 'child_process';
import * as pty from 'node-pty';
import { runNotifierSelfTest, runNotifierDemo } from './notifier-selftest';
import { reconcileClaudeHook, HOOK_SCRIPT_NAME } from './claude-hook-install';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

// Dev/test isolation: point userData (session.json, prefs.json) at a throwaway dir
// so a dev run can't clobber the user's real, possibly-running build. Must be set
// before any app.getPath('userData') call. No-op in normal use.
if (process.env.AFTERTERM_USER_DATA_DIR) {
  app.setPath('userData', process.env.AFTERTERM_USER_DATA_DIR);
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
  const wa = screen.getPrimaryDisplay().workArea;
  const h = Math.max(1, Math.ceil(contentHeight));
  const x = wa.x + wa.width - NOTIFIER_WIDTH - NOTIFIER_MARGIN;
  const y = wa.y + wa.height - h - NOTIFIER_MARGIN;
  notifierWindow.setBounds({ x, y, width: NOTIFIER_WIDTH, height: h });
}

function createNotifierWindow() {
  const wa = screen.getPrimaryDisplay().workArea;
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 780,
    minWidth: 800,
    minHeight: 500,
    icon: getIconPath(),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#1a1a1a',
      symbolColor: '#888',
      height: 36,
    },
    backgroundColor: '#141414',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  mainWindow.on('close', (e) => {
    if (isQuitting || ptys.size === 0) return;
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

// ─── IPC: create PTY ─────────────────────────────────────────────────────────

ipcMain.handle('pty:create', (_event, tabId: string, shellId?: string, cwd?: string) => {
  const shell = getShellById(shellId);
  let dir = process.env.USERPROFILE || 'C:\\';
  if (cwd) {
    try {
      if (fs.existsSync(cwd) && fs.statSync(cwd).isDirectory()) dir = cwd;
    } catch {}
  }

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

  // CWD reporting for session restore (cmd.exe only — see CLAUDE.md "Session Restore").
  // cmd.exe doesn't announce its directory, so its tabs always restored to the home
  // folder. Inject an OSC 9;9 (ConEmu-style) cwd report into the prompt: `$E` = ESC,
  // `$P` = current path, `$E\` = ST. The renderer parses OSC 9;9 → updates tab cwd.
  // Any existing custom PROMPT is preserved as the visible part.
  if (shell.id === 'cmd') {
    const visiblePrompt = cleanEnv.PROMPT || '$P$G';
    cleanEnv.PROMPT = `$E]9;9;$P$E\\${visiblePrompt}`;
  }

  const p = pty.spawn(shell.command, shell.args, {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: dir,
    env: cleanEnv,
  });

  ptys.set(tabId, p);

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
  });

  return { pid: p.pid };
});

// ─── IPC: write to PTY ───────────────────────────────────────────────────────

ipcMain.on('pty:input', (_event, tabId: string, data: string) => {
  ptys.get(tabId)?.write(data);
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

function readAndPushClaudeSession(tabId: string) {
  try {
    const raw = fs.readFileSync(path.join(getClaudeSessionDir(), `${tabId}.json`), 'utf-8');
    const obj = JSON.parse(raw) as { sessionId?: unknown; cwd?: unknown };
    if (typeof obj?.sessionId !== 'string' || typeof obj?.cwd !== 'string') return;
    if (!CLAUDE_UUID_RE.test(obj.sessionId) || !CLAUDE_CWD_RE.test(obj.cwd)) return;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('claude-session:update', { tabId, sessionId: obj.sessionId, cwd: obj.cwd });
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
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

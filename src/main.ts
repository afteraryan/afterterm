import { app, BrowserWindow, ipcMain, dialog, screen } from 'electron';
import path from 'path';
import fs from 'fs';
import { execFile, execSync } from 'child_process';
import * as pty from 'node-pty';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

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

function createNotifierWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const toastAreaHeight = 640; // enough to stack ~8 toasts
  notifierWindow = new BrowserWindow({
    x: width - 376,
    y: height - toastAreaHeight,
    width: 376,
    height: toastAreaHeight,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  notifierWindow.setIgnoreMouseEvents(true, { forward: true });

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
        mainWindow?.close();
      }
    });
  });

  mainWindow.on('closed', () => { mainWindow = null; });

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

// Main window → notifier: push a new toast
ipcMain.on('notify:push', (_event, toast) => {
  notifierWindow?.webContents.send('notify:push', toast);
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

// ─── IPC: create PTY ─────────────────────────────────────────────────────────

ipcMain.handle('pty:create', (_event, tabId: string, shellId?: string, cwd?: string) => {
  const shell = getShellById(shellId);
  let dir = process.env.USERPROFILE || 'C:\\';
  if (cwd) {
    try {
      if (fs.existsSync(cwd) && fs.statSync(cwd).isDirectory()) dir = cwd;
    } catch {}
  }

  // Clean PATH: strip stray quotes that corrupt cmd.exe's command resolution
  const cleanEnv = { ...process.env, AFTERTERM: '1' } as Record<string, string>;
  if (cleanEnv.Path) cleanEnv.Path = cleanEnv.Path.replace(/"/g, '');
  if (cleanEnv.PATH) cleanEnv.PATH = cleanEnv.PATH.replace(/"/g, '');

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

ipcMain.handle('session:save', (_event, data: string) => {
  try {
    fs.writeFileSync(getSessionPath(), data, 'utf-8');
  } catch {}
});

ipcMain.handle('session:load', () => {
  try {
    return JSON.parse(fs.readFileSync(getSessionPath(), 'utf-8'));
  } catch {
    return null;
  }
});

// ─── Graceful shutdown — drain all PTYs before quit ──────────────────────────

let isQuitting = false;

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
  if (isQuitting || ptys.size === 0) return;
  isQuitting = true;
  e.preventDefault();
  await destroyAllPtys();
  app.quit();
});

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();
  createNotifierWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

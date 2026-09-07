import { contextBridge, ipcRenderer, IpcRendererEvent, webUtils } from 'electron';
import type { EditorInfo } from './editors.ts';

const dataListeners = new Map<string, (event: IpcRendererEvent, data: string) => void>();
// Exit handlers are kept the same way so offExit can take one off again. Putting a
// thread to sleep destroys its PTY but keeps the tab, and the exit event that follows
// must not reach the app's "PTY exited, close the tab" handler.
const exitListeners = new Map<string, (event: IpcRendererEvent, code: number) => void>();

contextBridge.exposeInMainWorld('afterterm', {
  version: process.versions.electron,
  // afterterm's own version (package.json), for the titlebar badge. Resolved once,
  // synchronously, at preload time so it's a plain string on the API.
  appVersion: ipcRenderer.sendSync('app:version') as string,

  env: {
    userProfile: process.env.USERPROFILE || '',
  },

  app: {
    // When the app was opened the time before this one, in ms since epoch, or
    // null on the first launch. Resolved synchronously at preload time so Home
    // can use it on its first render.
    lastOpenedAt: ipcRenderer.sendSync('app:last-opened-at') as number | null,
  },

  projects: {
    openInExplorer: (folder: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('projects:openInExplorer', folder),
    // One round trip for a whole list: true when the folder exists and is a
    // directory. WSL paths are reported true without being checked.
    checkFolders: (folders: string[]): Promise<Record<string, boolean>> =>
      ipcRenderer.invoke('projects:checkFolders', folders),
  },

  editors: {
    list: (): Promise<EditorInfo[]> =>
      ipcRenderer.invoke('editors:list'),
    prefsPathInvalid: (): Promise<boolean> =>
      ipcRenderer.invoke('editors:prefsPathInvalid'),
    open: (folder: string, editorId?: string): Promise<{ ok: boolean; error?: string; editors: EditorInfo[] }> =>
      ipcRenderer.invoke('editors:open', folder, editorId),
    choose: (): Promise<{ editors: EditorInfo[]; invalid?: boolean } | null> =>
      ipcRenderer.invoke('editors:choose'),
  },

  dialog: {
    pickFolder: (): Promise<string | null> =>
      ipcRenderer.invoke('dialog:pickFolder'),
  },

  shells: {
    list: (): Promise<{ id: string; name: string }[]> =>
      ipcRenderer.invoke('shells:list'),
  },

  shell: {
    openExternal: (url: string): void => {
      ipcRenderer.invoke('shell:openExternal', url);
    },
  },

  files: {
    // Electron 32+ removed File.path; webUtils.getPathForFile is the supported way
    // to get a dropped file's absolute path. Must run in preload (has Node access).
    pathForFile: (file: File): string => webUtils.getPathForFile(file),
  },

  session: {
    save: (data: string): Promise<void> =>
      ipcRenderer.invoke('session:save', data),
    saveSync: (data: string): void =>
      ipcRenderer.sendSync('session:save-sync', data),
    load: (): Promise<any> =>
      ipcRenderer.invoke('session:load'),
  },

  // Main pushes a tab's captured Claude session id + cwd (from the notify hook's
  // file channel) so the renderer can persist it for resume-on-restart.
  claudeSession: {
    onUpdate: (callback: (data: { tabId: string; sessionId: string; cwd: string }) => void): void => {
      ipcRenderer.on('claude-session:update', (_event, data) => callback(data));
    },
    // The first user prompt and the current model, read from the session's transcript.
    meta: (sessionId: string, cwd: string) => ipcRenderer.invoke('claude-session:meta', sessionId, cwd),
    // Pushed once a turn, on every hook write, so a /model switch shows up by itself.
    onMeta: (callback: (data: { tabId: string; sessionId: string; firstPrompt: string | null; model: string | null }) => void): void => {
      ipcRenderer.on('claude-session:meta', (_event, data) => callback(data));
    },
  },

  // The last lines of a thread's scrollback, kept on disk so sleep and quit do not
  // lose the screen. Main trims and formats them (src/thread-tail.ts).
  threads: {
    saveTail: (tabId: string, lines: string[]): Promise<void> =>
      ipcRenderer.invoke('threads:saveTail', tabId, lines),
    // Blocking, for the beforeunload flush at quit: every awake thread in one call.
    saveTailsSync: (tails: Record<string, string[]>): void =>
      ipcRenderer.sendSync('threads:saveTailsSync', tails),
    readTail: (tabId: string): Promise<string[] | null> =>
      ipcRenderer.invoke('threads:readTail', tabId),
    deleteTail: (tabId: string): Promise<void> =>
      ipcRenderer.invoke('threads:deleteTail', tabId),
    prune: (keepIds: string[]): Promise<number> =>
      ipcRenderer.invoke('threads:prune', keepIds),
  },

  // Branch and worktree for a folder, read straight from .git (no git process).
  git: {
    info: (cwd: string) => ipcRenderer.invoke('git:info', cwd),
    infoMany: (cwds: string[]) => ipcRenderer.invoke('git:infoMany', cwds),
  },

  shortcuts: {
    onShortcut: (callback: (action: string) => void): void => {
      ipcRenderer.on('shortcut', (_event, action) => callback(action));
    },
  },

  // Used by the main app window to send notifications to the overlay
  notify: {
    push: (toast: any): void =>
      ipcRenderer.send('notify:push', toast),
    dismissTab: (tabId: string): void =>
      ipcRenderer.send('notify:dismiss-tab', tabId),
    onActivateTab: (callback: (tabId: string) => void): void => {
      ipcRenderer.on('notify:activate-tab', (_event, tabId) => callback(tabId));
    },
  },

  // Used by the notifier overlay window itself
  notifier: {
    onPush: (callback: (toast: any) => void): void => {
      ipcRenderer.on('notify:push', (_event, toast) => callback(toast));
    },
    onDismissTab: (callback: (tabId: string) => void): void => {
      ipcRenderer.on('notify:dismiss-tab', (_event, tabId) => callback(tabId));
    },
    clickTab: (tabId: string): void =>
      ipcRenderer.send('notify:tab-click', tabId),
    setIgnoreMouse: (ignore: boolean): void =>
      ipcRenderer.send('notifier:set-ignore-mouse', ignore),
    hide: (): void =>
      ipcRenderer.send('notifier:hide'),
    resize: (height: number): void =>
      ipcRenderer.send('notifier:resize', height),
  },

  pty: {
    create: (tabId: string, shellId?: string, cwd?: string): Promise<{ pid: number }> =>
      ipcRenderer.invoke('pty:create', tabId, shellId, cwd),

    write: (tabId: string, data: string): void =>
      ipcRenderer.send('pty:input', tabId, data),

    resize: (tabId: string, cols: number, rows: number): void =>
      ipcRenderer.send('pty:resize', tabId, cols, rows),

    destroy: (tabId: string): Promise<void> =>
      ipcRenderer.invoke('pty:destroy', tabId),

    onData: (tabId: string, callback: (data: string) => void): void => {
      const channel = `pty:data:${tabId}`;
      const handler = (_event: IpcRendererEvent, data: string) => callback(data);
      dataListeners.set(tabId, handler);
      ipcRenderer.on(channel, handler);
    },

    offData: (tabId: string): void => {
      const channel = `pty:data:${tabId}`;
      const handler = dataListeners.get(tabId);
      if (handler) {
        ipcRenderer.removeListener(channel, handler);
        dataListeners.delete(tabId);
      }
    },

    onExit: (tabId: string, callback: (exitCode: number) => void): void => {
      const channel = `pty:exit:${tabId}`;
      const handler = (_event: IpcRendererEvent, code: number) => {
        // `once` has already removed the listener by the time this runs, so drop the
        // map entry too. Otherwise a later offExit would try to remove a dead handler
        // and, worse, a re-registered listener for the same tab would be shadowed.
        exitListeners.delete(tabId);
        callback(code);
      };
      exitListeners.set(tabId, handler);
      ipcRenderer.once(channel, handler);
    },

    // Unregister before destroying a PTY the tab is meant to outlive (sleep).
    offExit: (tabId: string): void => {
      const channel = `pty:exit:${tabId}`;
      const handler = exitListeners.get(tabId);
      if (handler) {
        ipcRenderer.removeListener(channel, handler);
        exitListeners.delete(tabId);
      }
    },

    // Throttled activity stamps from main: at most one per tab per 15 seconds
    // while the terminal has input or output. `at` is ms since epoch. One
    // listener for every tab, registered once.
    onActivity: (callback: (data: { tabId: string; at: number }) => void): void => {
      ipcRenderer.on('pty:activity', (_event, data) => callback(data));
    },
  },
});

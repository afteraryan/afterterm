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
    // The home folder, from main (this sandboxed preload has no USERPROFILE).
    homeDir: ipcRenderer.sendSync('app:home') as string,
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
    // Edited files (docs/edited-files): open in the detected editor, at a line
    // when given; open in the default app (images); show selected in Explorer.
    open: (path: string, line?: number): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('files:open', path, line),
    openDefault: (path: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('files:openDefault', path),
    reveal: (path: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('files:reveal', path),
    // Phase 3: which paths exist (file, folder or neither), and a folder link.
    stat: (paths: string[]): Promise<Record<string, 'file' | 'dir' | null>> =>
      ipcRenderer.invoke('files:stat', paths),
    openFolder: (folder: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('files:openFolder', folder),
    // Every file with each name under these folders, shallowest first.
    find: (names: string[], roots: string[]): Promise<Record<string, string[]>> =>
      ipcRenderer.invoke('files:find', names, roots),
  },

  // The files a chat changed and the images pasted into it, from its transcript.
  sessionFiles: {
    list: (sessionId: string, cwd: string) => ipcRenderer.invoke('session-files:list', sessionId, cwd),
    thumb: (sessionId: string, cwd: string, key: string): Promise<string | null> =>
      ipcRenderer.invoke('session-files:thumb', sessionId, cwd, key),
    openPasted: (sessionId: string, cwd: string, key: string): Promise<{ ok: boolean; error?: string; path?: string }> =>
      ipcRenderer.invoke('session-files:openPasted', sessionId, cwd, key),
    pastedPath: (sessionId: string, cwd: string, key: string): Promise<string | null> =>
      ipcRenderer.invoke('session-files:pastedPath', sessionId, cwd, key),
    // AFT-61: the chat's links starting with each prefix, most recent first.
    urls: (sessionId: string, cwd: string, prefixes: string[]): Promise<Record<string, string[]>> =>
      ipcRenderer.invoke('session-files:urls', sessionId, cwd, prefixes),
  },

  session: {
    save: (data: string): Promise<void> =>
      ipcRenderer.invoke('session:save', data),
    saveSync: (data: string): void =>
      ipcRenderer.sendSync('session:save-sync', data),
    load: (): Promise<any> =>
      ipcRenderer.invoke('session:load'),
    // AFT-33: the latest state, kept by main in memory only, so a page that crashes
    // before its next save still comes back with it.
    remember: (data: string): void =>
      ipcRenderer.send('session:remember', data),
  },

  // AFT-33: getting the window back without losing threads. state() is asked once as
  // the page restores: the shells main still holds and what the page last showed
  // (both empty on a launch). noteUi keeps main's copy of the screen current.
  // onRepaint: main asks the terminals to redraw after the GPU process went away.
  // test (harness only, main ignores it otherwise): crash the page, end the GPU process, or
  // report the page unresponsive while a test keeps it busy.
  recovery: {
    state: (): Promise<{ threads: { tabId: string; port?: number | null }[]; ui: { screen: 'home' | 'workspace' | 'project'; projectId?: string; activeTabId?: string } | null }> =>
      ipcRenderer.invoke('recovery:state'),
    noteUi: (ui: { screen: string; projectId?: string; activeTabId?: string }): void =>
      ipcRenderer.send('recovery:ui', ui),
    onRepaint: (callback: () => void): void => {
      ipcRenderer.on('recovery:repaint', () => callback());
    },
    test: (what: 'crash' | 'gpu' | 'unresponsive'): void =>
      ipcRenderer.send('recovery:test', what),
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

  // Claude Code's own record of each thread's running Claude (src/claude-session-record.ts):
  // its live status, pushed when it changes, null when the thread has no live Claude.
  // refresh() reads the records now and resolves when that is done.
  claudeRecord: {
    onStatus: (callback: (data: { tabId: string; status: 'busy' | 'idle' | 'waiting' | 'shell' | null }) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, data: { tabId: string; status: 'busy' | 'idle' | 'waiting' | 'shell' | null }) => callback(data);
      ipcRenderer.on('claude-record:status', listener);
      return () => { ipcRenderer.removeListener('claude-record:status', listener); };
    },
    refresh: (): Promise<void> => ipcRenderer.invoke('claude-record:refresh'),
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

  // Automatic updates (src/updater.ts): the state main pushes, and the actions
  // the title bar button, the notice, the restart window and the About window take.
  update: {
    get: (): Promise<any> => ipcRenderer.invoke('update:get'),
    onState: (callback: (state: any) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, s: any) => callback(s);
      ipcRenderer.on('update:state', listener);
      return () => { ipcRenderer.removeListener('update:state', listener); };
    },
    takeLaunch: (): Promise<any> => ipcRenderer.invoke('update:take-launch'),
    check: (): Promise<void> => ipcRenderer.invoke('update:check'),
    download: (): Promise<void> => ipcRenderer.invoke('update:download'),
    cancel: (): Promise<void> => ipcRenderer.invoke('update:cancel'),
    later: (): Promise<void> => ipcRenderer.invoke('update:later'),
    skip: (): Promise<void> => ipcRenderer.invoke('update:skip'),
    restart: (info: { activeThreadId?: string; screen?: string; projectId?: string }): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('update:restart', info),
    setAuto: (on: boolean): Promise<void> => ipcRenderer.invoke('update:set-auto', on),
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
    projectUpdated: (look: any): void =>
      ipcRenderer.send('notify:project-updated', look),
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
    onProjectUpdated: (callback: (look: any) => void): void => {
      ipcRenderer.on('notify:project-updated', (_event, look) => callback(look));
    },
    clickTab: (tabId: string): void =>
      ipcRenderer.send('notify:tab-click', tabId),
    setIgnoreMouse: (ignore: boolean): void =>
      ipcRenderer.send('notifier:set-ignore-mouse', ignore),
    hide: (): void =>
      ipcRenderer.send('notifier:hide'),
    resize: (height: number): void =>
      ipcRenderer.send('notifier:resize', height),
    // Whether the main window is focused: toasts go on their own only then.
    mainFocused: (): Promise<boolean> =>
      ipcRenderer.invoke('notifier:main-focused'),
    onMainFocus: (callback: (focused: boolean) => void): void => {
      ipcRenderer.on('notifier:main-focus', (_event, focused) => callback(focused));
    },
  },

  pty: {
    // attached: main already held a running shell for this tab (the page was
    // reloaded), and the terminal joined it instead of spawning one (AFT-33).
    create: (tabId: string, shellId?: string, cwd?: string): Promise<{ pid: number; attached: boolean }> =>
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

    // The listening port of the server running in a tab, pushed by main's server
    // watcher whenever it changes. null means nothing in that shell's process tree
    // is listening any more (the server stopped, or the thread's PTY went away).
    // One listener for every tab, registered once.
    onPort: (callback: (data: { tabId: string; port: number | null }) => void): void => {
      ipcRenderer.on('pty:port', (_event, data) => callback(data));
    },

    // Whether a tab's shell has a process running below it, from main's cached process
    // list, pushed when it changes. null when the list is too old to say or the tree
    // could not be read (WSL). The restart window's fallback for a shell with no prompt
    // marks. One listener for every tab, registered once.
    onChildren: (callback: (data: { tabId: string; hasChildren: boolean | null }) => void): void => {
      ipcRenderer.on('pty:children', (_event, data) => callback(data));
    },
  },
});

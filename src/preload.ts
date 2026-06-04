import { contextBridge, ipcRenderer, IpcRendererEvent, webUtils } from 'electron';

const dataListeners = new Map<string, (event: IpcRendererEvent, data: string) => void>();

contextBridge.exposeInMainWorld('afterterm', {
  version: process.versions.electron,

  env: {
    userProfile: process.env.USERPROFILE || '',
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
      ipcRenderer.once(`pty:exit:${tabId}`, (_event, code) => callback(code));
    },
  },
});

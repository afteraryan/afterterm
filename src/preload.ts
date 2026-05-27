import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

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

  session: {
    save: (data: string): Promise<void> =>
      ipcRenderer.invoke('session:save', data),
    load: (): Promise<any> =>
      ipcRenderer.invoke('session:load'),
  },

  shortcuts: {
    onShortcut: (callback: (action: string) => void): void => {
      ipcRenderer.on('shortcut', (_event, action) => callback(action));
    },
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

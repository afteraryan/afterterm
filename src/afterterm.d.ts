interface ShellProfile {
  id: string;
  name: string;
}

interface AftertermShellsAPI {
  list(): Promise<ShellProfile[]>;
}

interface AftertermSessionAPI {
  save(data: string): Promise<void>;
  load(): Promise<any>;
}

interface AftertermShortcutsAPI {
  onShortcut(callback: (action: string) => void): void;
}

interface AftertermPtyAPI {
  create(tabId: string, shellId?: string, cwd?: string): Promise<{ pid: number }>;
  write(tabId: string, data: string): void;
  resize(tabId: string, cols: number, rows: number): void;
  destroy(tabId: string): Promise<void>;
  onData(tabId: string, callback: (data: string) => void): void;
  offData(tabId: string): void;
  onExit(tabId: string, callback: (exitCode: number) => void): void;
}

interface AftertermDialogAPI {
  pickFolder(): Promise<string | null>;
}

interface AftertermAPI {
  version: string;
  env: { userProfile: string };
  dialog: AftertermDialogAPI;
  shells: AftertermShellsAPI;
  session: AftertermSessionAPI;
  shortcuts: AftertermShortcutsAPI;
  pty: AftertermPtyAPI;
}

interface Window {
  afterterm: AftertermAPI;
}

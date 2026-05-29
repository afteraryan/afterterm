interface ShellProfile {
  id: string;
  name: string;
}

type NotifType = 'done' | 'attention' | 'background' | 'compacting';

interface NotifierToast {
  id: string;
  tabId: string;
  type: NotifType;
  primaryLabel: string;
  secondaryLabel?: string;
  message: string;
}

interface AftertermShellsAPI {
  list(): Promise<ShellProfile[]>;
}

interface AftertermSessionAPI {
  save(data: string): Promise<void>;
  saveSync(data: string): void;
  load(): Promise<any>;
}

interface AftertermShortcutsAPI {
  onShortcut(callback: (action: string) => void): void;
}

interface AftertermNotifyAPI {
  push(toast: NotifierToast): void;
  dismissTab(tabId: string): void;
  onActivateTab(callback: (tabId: string) => void): void;
}

interface AftertermNotifierAPI {
  onPush(callback: (toast: NotifierToast) => void): void;
  onDismissTab(callback: (tabId: string) => void): void;
  clickTab(tabId: string): void;
  setIgnoreMouse(ignore: boolean): void;
  hide(): void;
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
  notify: AftertermNotifyAPI;
  notifier: AftertermNotifierAPI;
  pty: AftertermPtyAPI;
}

interface Window {
  afterterm: AftertermAPI;
}

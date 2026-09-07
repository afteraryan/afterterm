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
  projectColor?: string;
  message: string;
}

interface AftertermShellsAPI {
  list(): Promise<ShellProfile[]>;
}

interface AftertermShellAPI {
  openExternal(url: string): void;
}

interface AftertermFilesAPI {
  pathForFile(file: File): string;
}

interface AftertermSessionAPI {
  save(data: string): Promise<void>;
  saveSync(data: string): void;
  load(): Promise<any>;
}

interface ClaudeSessionUpdate {
  tabId: string;
  sessionId: string;
  cwd: string;
}

interface AftertermClaudeSessionAPI {
  onUpdate(callback: (data: ClaudeSessionUpdate) => void): void;
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
  resize(height: number): void;
}

// Inline import so this file stays a global declaration file (a top-level import
// would turn it into a module and Window.afterterm would stop being global).
type EditorInfo = import('./editors.ts').EditorInfo;

interface AftertermAppAPI {
  // When the app was opened the time before this one, in ms since epoch, or null
  // on the first launch. Resolved synchronously at preload time, so it is a plain
  // value on the API and needs no await.
  lastOpenedAt: number | null;
}

interface AftertermProjectsAPI {
  openInExplorer(folder: string): Promise<{ ok: boolean; error?: string }>;
  // One round trip for a whole list: true when the folder exists and is a
  // directory. A \\wsl$\ path is reported true without being checked.
  checkFolders(folders: string[]): Promise<Record<string, boolean>>;
}

interface AftertermEditorsAPI {
  // Detection result, primary editor first, empty when nothing was found.
  list(): Promise<EditorInfo[]>;
  // True only when prefs.json holds an editorPath that exists and is not an
  // editor. The UI shows the "Editor path not valid" toast for this alone.
  prefsPathInvalid(): Promise<boolean>;
  // Opens the folder in the editor (the primary one by default). On failure
  // detection re-runs and the fresh list comes back, so the UI can hide an
  // editor that has gone. error is a short human sentence.
  open(folder: string, editorId?: string): Promise<{ ok: boolean; error?: string; editors: EditorInfo[] }>;
  // File picker for an .exe; writes editorPath to prefs.json, re-detects and
  // returns the new list. null when the user cancelled.
  choose(): Promise<{ editors: EditorInfo[]; invalid?: boolean } | null>;
}

interface PtyActivity {
  tabId: string;
  at: number;
}

interface AftertermPtyAPI {
  create(tabId: string, shellId?: string, cwd?: string): Promise<{ pid: number }>;
  write(tabId: string, data: string): void;
  resize(tabId: string, cols: number, rows: number): void;
  destroy(tabId: string): Promise<void>;
  onData(tabId: string, callback: (data: string) => void): void;
  offData(tabId: string): void;
  onExit(tabId: string, callback: (exitCode: number) => void): void;
  // Throttled activity stamps from main: at most one per tab per 15 seconds while
  // the terminal has input or output. Registered once, for every tab.
  onActivity(callback: (data: PtyActivity) => void): void;
}

interface AftertermDialogAPI {
  pickFolder(): Promise<string | null>;
}

interface AftertermAPI {
  version: string;
  appVersion: string;
  env: { userProfile: string };
  app: AftertermAppAPI;
  projects: AftertermProjectsAPI;
  editors: AftertermEditorsAPI;
  dialog: AftertermDialogAPI;
  shells: AftertermShellsAPI;
  shell: AftertermShellAPI;
  files: AftertermFilesAPI;
  session: AftertermSessionAPI;
  claudeSession: AftertermClaudeSessionAPI;
  shortcuts: AftertermShortcutsAPI;
  notify: AftertermNotifyAPI;
  notifier: AftertermNotifierAPI;
  pty: AftertermPtyAPI;
}

interface Window {
  afterterm: AftertermAPI;
}

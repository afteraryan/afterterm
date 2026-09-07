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

// What the session's transcript under ~/.claude/projects says about a thread: the
// first user prompt (the thread name until Claude sets a title) and the model of the
// latest assistant turn, id form ("claude-opus-5[1m]"). Both null when the transcript
// has nothing to say; exists is false when there is no transcript at all.
interface ClaudeSessionMeta {
  firstPrompt: string | null;
  model: string | null;
  exists: boolean;
}

interface ClaudeSessionMetaPush {
  tabId: string;
  sessionId: string;
  firstPrompt: string | null;
  model: string | null;
}

// Branch and worktree for a folder. worktree is the linked worktree's folder relative
// to the main repo (".claude\worktrees\phase-3-thread-identity"), null for an ordinary
// checkout. branch is a short commit hash when HEAD is detached.
interface GitInfo {
  branch: string | null;
  worktree: string | null;
  repoRoot: string | null;
}

interface AftertermClaudeSessionAPI {
  onUpdate(callback: (data: ClaudeSessionUpdate) => void): void;
  // Read the transcript now, for a thread whose session id is already known.
  meta(sessionId: string, cwd: string): Promise<ClaudeSessionMeta>;
  // Pushed once a turn, on every hook write, so a /model switch shows up by itself.
  onMeta(callback: (data: ClaudeSessionMetaPush) => void): void;
}

interface AftertermGitAPI {
  info(cwd: string): Promise<GitInfo>;
  // One round trip for a whole list, in the same order. Capped at 500 entries.
  infoMany(cwds: string[]): Promise<GitInfo[]>;
}

// The last lines of a thread's scrollback, kept on disk so sleep and quit do not lose
// the screen. Main trims to 200 lines / 64 KB and never throws (see src/thread-tail.ts).
interface AftertermThreadsAPI {
  // Save one thread's tail, on sleep or on close.
  saveTail(tabId: string, lines: string[]): Promise<void>;
  // Blocking flush for beforeunload at quit: every awake thread in one call, keyed
  // by tab id, so a relaunch still shows the output that was on screen.
  saveTailsSync(tails: Record<string, string[]>): void;
  // The saved lines, or null when there is no tail (or it cannot be read).
  readTail(tabId: string): Promise<string[] | null>;
  deleteTail(tabId: string): Promise<void>;
  // Delete every saved tail whose id is not in keepIds (live tabs plus history
  // entries). Called once after session restore. Returns how many were removed.
  prune(keepIds: string[]): Promise<number>;
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
  // Take the exit handler off again. Sleep destroys the PTY but keeps the tab, so
  // the exit that follows must not reach the "PTY exited, close the tab" path.
  offExit(tabId: string): void;
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
  threads: AftertermThreadsAPI;
  git: AftertermGitAPI;
  shortcuts: AftertermShortcutsAPI;
  notify: AftertermNotifyAPI;
  notifier: AftertermNotifierAPI;
  pty: AftertermPtyAPI;
}

interface Window {
  afterterm: AftertermAPI;
}

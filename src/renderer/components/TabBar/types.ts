export type TabNotification = 'done' | 'attention' | 'background' | 'compacting' | 'working';

export interface Tab {
  id: string;
  title: string;
  groupId?: string;
  shellId?: string;
  cwd?: string;
  notification?: TabNotification;
  fontSize?: number; // per-tab Ctrl+scroll zoom; persisted in session.json
  // Claude Code session resume: the active session's UUID + the cwd it runs in,
  // captured by the notify hook's file channel (main.ts watches it). On restore,
  // afterterm relaunches the shell in claudeCwd and runs `claude --resume
  // <claudeSessionId>`. Persisted in session.json.
  claudeSessionId?: string;
  claudeCwd?: string;
  // Last time the user activated this tab (ms since epoch). Required, not optional,
  // so every creation site has to set it: a missing timestamp would sort a thread
  // as "never used" and hide it behind "Show more". Persisted in session.json.
  // Phase 2 will also stamp it on PTY input and output.
  lastActiveAt: number;
  // True while the thread's PTY is not running: its record (project, cwd, session
  // id, shell) is kept, just nothing is spawned for it. Persisted in session.json.
  // Phase 4 replaces the old "restorable" ✳ marker with this: every restored tab
  // starts asleep rather than half-alive.
  asleep: boolean;
  // Ms since epoch when the thread went to sleep. Present only while asleep;
  // drives the "Asleep · 2d" chip (sleepWake.ts, asleepLabel). Persisted in
  // session.json so the chip reads correctly the moment a restored session loads,
  // before anything in this launch has touched the thread.
  sleptAt?: number;
  // Transient (NOT persisted): set the moment a thread wakes, or is recreated from
  // history by Resume. Read once by the terminal layer to know it must replay the
  // saved scrollback tail above a "Woke just now" divider, then it has done its
  // job; a brand new thread never has it, so it never shows a divider it doesn't
  // need.
  wokeAt?: number;
  // Claude Code model id of the latest assistant turn, read from the session
  // transcript in main ("claude-opus-5[1m]"); the renderer maps it to a display
  // name (threadView.ts, modelLabel). Chats only. Persisted in session.json.
  model?: string;
  // Git branch (or short detached hash) of the thread's cwd, read by main.
  // Persisted in session.json.
  branch?: string;
  // Worktree folder relative to the main repo (".claude\worktrees\phase-3-thread-identity")
  // when the cwd is inside a git worktree; absent in a main checkout. Persisted
  // in session.json.
  worktree?: string;
  // The last conversation title Claude Code set on the terminal, with its leading
  // glyph already stripped (see chatTitle.ts). This is the thread's name once
  // Claude has replied; the raw title keeps flipping between Claude's summary and
  // the notify hook's state text, so the name has to be captured separately rather
  // than read live off the title each render. Persisted in session.json: every
  // restored shell overwrites the raw title with "cmd.exe" seconds after launch,
  // so without its own field a chat would lose its name on the second relaunch.
  claudeTitle?: string;
  // Transient (NOT persisted): the session's first user prompt, read from its
  // transcript in main. The name fallback for a chat before Claude's first reply
  // has produced a title.
  firstPrompt?: string;
}

export interface Group {
  id: string;
  label: string;
  color: GroupColor;
  collapsed: boolean;
  cwd?: string;
  // Default shell for terminals opened in this group (falls back to the app default
  // when unset). Set in the group modal; persisted in session.json.
  shellId?: string;
  // Intent flags for the Home screen (Phase 2). Both are user actions only: nothing
  // pins or archives a project automatically, so process state never overrides what
  // the user chose. Required so creation sites cannot forget them; persisted.
  pinned: boolean;
  archived: boolean;
  // Last time one of this group's tabs was activated (ms since epoch). Orders the
  // Projects list on Home and in the sidebar. Persisted in session.json.
  lastActiveAt: number;
  // Closed threads of this project, newest first, capped (history.ts,
  // HISTORY_MAX). Required so a creation site cannot forget it (it starts empty,
  // the migration fills an old file's groups with []). General has no history:
  // it names no group, so there is nowhere to append to, and a closed General
  // thread is simply gone (an open design decision, see design-02, revisit if it
  // hurts).
  history: HistoryEntry[];
}

// A closed thread kept for Resume. `id` is deliberately the closed tab's own id:
// its scrollback tail file is `threads/<id>.txt`, and Resume recreates the tab
// with that same id (history.ts, tabFromHistory) so the tail is still found by
// the id it was written under, instead of needing a second lookup table.
export interface HistoryEntry {
  id: string;
  title: string;
  kind: 'chat' | 'shell';
  sessionId?: string;
  cwd?: string;
  closedAt: number;
}

export type GroupColor =
  | 'teal'
  | 'blue'
  | 'purple'
  | 'orange'
  | 'red'
  | 'green'
  | 'pink'
  | 'yellow';

export const GROUP_COLORS: Record<GroupColor, { bg: string; border: string; text: string }> = {
  teal:   { bg: 'rgba(45,212,191,0.15)', border: '#2dd4bf', text: '#2dd4bf' },
  blue:   { bg: 'rgba(96,165,250,0.15)', border: '#60a5fa', text: '#60a5fa' },
  purple: { bg: 'rgba(167,139,250,0.15)', border: '#a78bfa', text: '#a78bfa' },
  orange: { bg: 'rgba(251,146,60,0.15)', border: '#fb923c', text: '#fb923c' },
  red:    { bg: 'rgba(248,113,113,0.15)', border: '#f87171', text: '#f87171' },
  green:  { bg: 'rgba(74,222,128,0.15)', border: '#4ade80', text: '#4ade80' },
  pink:   { bg: 'rgba(244,114,182,0.15)', border: '#f472b6', text: '#f472b6' },
  yellow: { bg: 'rgba(250,204,21,0.15)', border: '#facc15', text: '#facc15' },
};

export const COLOR_CYCLE: GroupColor[] = [
  'teal', 'blue', 'purple', 'orange', 'red', 'green', 'pink', 'yellow',
];

// First unused colour in the cycle, so two groups don't look alike until every
// colour is taken. Shared by the drag gesture and the new-group modal.
export function nextGroupColor(existing: { color: GroupColor }[]): GroupColor {
  const used = existing.map(g => g.color);
  return COLOR_CYCLE.find(c => !used.includes(c)) ?? COLOR_CYCLE[existing.length % COLOR_CYCLE.length];
}

// Last segment of a Windows or POSIX path, the natural default name for a project
// group ("D:\Pitara\aftertales" → "aftertales").
export function pathBasename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

// Tail of a path for narrow UI ("D:\Pitara\Work\Tinkering\afterterm" →
// "…\Tinkering\afterterm"). Trimmed in JS rather than with a CSS ellipsis so the
// project folder stays visible: it's the end of the path that identifies it.
export function shortenPath(p: string, keep = 2): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  if (parts.length <= keep) return p;
  return `…\\${parts.slice(-keep).join('\\')}`;
}

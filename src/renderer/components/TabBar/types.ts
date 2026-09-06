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
  // Transient (NOT persisted): true for a restored tab whose saved Claude session
  // hasn't been resumed yet this launch. Drives the muted ✳ "click to restore"
  // marker in the sidebar; cleared once the tab is activated/resumed.
  claudeRestorable?: boolean;
  // Last time the user activated this tab (ms since epoch). Required, not optional,
  // so every creation site has to set it: a missing timestamp would sort a thread
  // as "never used" and hide it behind "Show more". Persisted in session.json.
  // Phase 2 will also stamp it on PTY input and output.
  lastActiveAt: number;
  // Persisted, but nothing sets it true yet: sleep and wake arrive in Phase 4. It
  // is in the model now so a session.json written today already carries the flag
  // and Phase 4 needs no second migration.
  asleep: boolean;
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

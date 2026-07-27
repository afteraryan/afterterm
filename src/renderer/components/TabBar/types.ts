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
  teal:   { bg: 'rgba(32,178,170,0.15)', border: '#20b2aa', text: '#4dd0ca' },
  blue:   { bg: 'rgba(70,130,220,0.15)', border: '#4682dc', text: '#6ba3f0' },
  purple: { bg: 'rgba(148,103,189,0.15)', border: '#9467bd', text: '#b48dd4' },
  orange: { bg: 'rgba(210,140,50,0.15)', border: '#d28c32', text: '#e8a84a' },
  red:    { bg: 'rgba(200,70,70,0.15)', border: '#c84646', text: '#e07070' },
  green:  { bg: 'rgba(70,180,100,0.15)', border: '#46b464', text: '#6dd48a' },
  pink:   { bg: 'rgba(210,80,150,0.15)', border: '#d25096', text: '#e87ab8' },
  yellow: { bg: 'rgba(200,185,50,0.15)', border: '#c8b932', text: '#e0d050' },
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

// Last segment of a Windows or POSIX path — the natural default name for a project
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

export type TabNotification = 'done' | 'attention' | 'background' | 'compacting' | 'working';

export interface Tab {
  id: string;
  title: string;
  groupId?: string;
  shellId?: string;
  cwd?: string;
  notification?: TabNotification;
}

export interface Group {
  id: string;
  label: string;
  color: GroupColor;
  collapsed: boolean;
  cwd?: string;
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

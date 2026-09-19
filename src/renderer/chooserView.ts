// Pure ordering logic for the New thread chooser (Ctrl Shift T). Turns the app's
// groups (projects) plus a filter query into the ordered list of options the
// popover shows, and picks the default shell for a project. No React, no DOM:
// importable from plain Node so the unit tests can run with
// `node src/renderer/chooserView.test.ts`.

import type { Group } from './components/TabBar/types.ts';

export interface ChooserItem {
  group: Group | null; // null is the "No project" option
  tag: 'current' | '';
}

// Order: the current project first, tagged 'current', but only when its name
// matches the query. Then "No project" (represented as group: null), shown when
// the query is empty or matches "no project" / "general" / "no". Then every
// other non-archived project that matches, pinned first, then by last activity,
// most recent first. The current project never appears twice.
export function chooserItems(
  groups: Group[],
  currentGroupId: string | undefined,
  query: string,
): ChooserItem[] {
  const q = query.trim().toLowerCase();
  const current = currentGroupId ? groups.find(g => g.id === currentGroupId) ?? null : null;

  const items: ChooserItem[] = [];

  if (current && current.label.toLowerCase().includes(q)) {
    items.push({ group: current, tag: 'current' });
  }

  if ('no project general'.includes(q)) {
    items.push({ group: null, tag: '' });
  }

  const others = groups
    .filter(g => !g.archived && g.id !== currentGroupId)
    .filter(g => g.label.toLowerCase().includes(q))
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.lastActiveAt - a.lastActiveAt;
    });

  for (const group of others) items.push({ group, tag: '' });

  return items;
}

// The shell a new thread in the current project should default to: the
// project's own default shell, or undefined (the caller falls back to its own
// default, e.g. the first entry in the detected shell list).
export function defaultShell(groups: Group[], currentGroupId: string | undefined): string | undefined {
  const current = currentGroupId ? groups.find(g => g.id === currentGroupId) : undefined;
  return current?.shellId;
}

// The sidebar panel (Phase 8, design-03 decision 2): General, Pinned, Recent
// and Other, the search filter over them (decision 13), and the flat, panel-
// ordered thread list Ctrl+Shift+Down/Up cycles through (decisions 6 and 7).
//
// Pure module, no React, no DOM: importable from plain Node so the unit tests
// can run with `node src/renderer/panelView.test.ts`.
//
// attention.ts's panelLists supplies the Recent/Other split (the 3-day rule)
// so this module and the rail can never disagree about which projects are
// "recent".

import type { Tab, Group } from './components/TabBar/types.ts';
import { panelLists, isRecentProject } from './attention.ts';
import { foldThreads } from './threadView.ts';
import { foldLimit } from './splitView.ts';
import type { Split } from './splitView.ts';

export interface PanelEntry {
  group: Group;
  tabs: Tab[];
}

export interface PanelSections {
  general: Tab[];
  pinned: PanelEntry[];
  recent: PanelEntry[];
  other: PanelEntry[];
}

// Builds the panel's four lists. The projects come in the saved project order
// (the `groups` array, which drags and the order rules in attention.ts set;
// 2026-11-01, before which the order came from the tab walk in sidebarWalk.ts
// and Recent was sorted by activity). Each project carries its threads in tab
// order. General is the loose tabs (no project, or a project that no longer
// exists), in tab order. Pinned is the pinned groups; Recent and Other come from
// attention.ts's panelLists, which puts archived projects in Other.
export function panelSections(tabs: Tab[], groups: Group[], now: number, hold?: ReadonlySet<string>): PanelSections {
  const known = new Set(groups.map(g => g.id));
  const general: Tab[] = [];
  const tabsByGroup = new Map<string, Tab[]>();
  for (const tab of tabs) {
    if (!tab.groupId || !known.has(tab.groupId)) { general.push(tab); continue; }
    const list = tabsByGroup.get(tab.groupId);
    if (list) list.push(tab);
    else tabsByGroup.set(tab.groupId, [tab]);
  }

  const toEntries = (gs: Group[]): PanelEntry[] =>
    gs.map(g => ({ group: g, tabs: tabsByGroup.get(g.id) ?? [] }));
  const { recent, other } = panelLists(groups, tabs, now, hold);
  const pinned = groups.filter(g => g.pinned && !g.archived);

  return { general, pinned: toEntries(pinned), recent: toEntries(recent), other: toEntries(other) };
}

export type ProjectSection = 'pinned' | 'recent';

// A project dropped in the panel (the drag in docs/mockups/sidebar-drag-and-drop.html):
// into `section`, just above the project `beforeId`, or at the end of that
// section when `beforeId` is null. Dropping into Pinned pins it, into Recent
// unpins it. A project dropped into Recent that would not otherwise qualify
// for it (asleep and quiet for more than three days) has its activity stamped,
// since the person just put it there; otherwise it would land in Other
// projects instead. Returns the same array when nothing changes.
export function placeProject(
  groups: Group[],
  tabs: Tab[],
  now: number,
  groupId: string,
  section: ProjectSection,
  beforeId: string | null,
): Group[] {
  const g = groups.find(x => x.id === groupId);
  if (!g || beforeId === groupId) return groups;
  let moved: Group = { ...g, pinned: section === 'pinned', archived: false };
  if (section === 'recent' && !isRecentProject(moved, tabs, now)) moved = { ...moved, lastActiveAt: now };
  const rest = groups.filter(x => x.id !== groupId);

  let at: number;
  if (beforeId !== null && rest.some(x => x.id === beforeId)) {
    at = rest.findIndex(x => x.id === beforeId);
  } else {
    const inSection = (x: Group) => section === 'pinned' ? x.pinned && !x.archived : isRecentProject(x, tabs, now);
    let last = -1;
    rest.forEach((x, i) => { if (inSection(x)) last = i; });
    at = last + 1;
  }
  const next = [...rest];
  next.splice(at, 0, moved);
  const same = next.length === groups.length && next.every((x, i) => x.id === groups[i].id)
    && moved.pinned === g.pinned && moved.lastActiveAt === g.lastActiveAt && moved.archived === g.archived;
  return same ? groups : next;
}

// design-03 decision 13: typing in Search narrows the panel in place,
// case-insensitive substring over project and thread names. A project whose
// own name matches keeps every one of its threads; otherwise only its
// matching threads show, and a project left with none is dropped entirely.
// `other` is always emptied while filtered: the docked Other row itself
// hides while typing, so there is nothing left in it to filter. An empty
// (or all-whitespace) query means unfiltered: everything is returned as is.
// `nameOf` is injected so this module does not depend on threadView's
// threadName; the app passes threadName, tests pass a plain `t => t.title`.
export function filterPanel(
  sections: PanelSections,
  query: string,
  nameOf: (t: Tab) => string,
): PanelSections & { filtered: boolean; noMatches: boolean } {
  const q = query.trim().toLowerCase();
  if (!q) return { ...sections, filtered: false, noMatches: false };

  const matchesTab = (t: Tab) => nameOf(t).toLowerCase().includes(q);
  const matchEntry = (entry: PanelEntry): PanelEntry | null => {
    if (entry.group.label.toLowerCase().includes(q)) return entry;
    const tabs = entry.tabs.filter(matchesTab);
    return tabs.length > 0 ? { group: entry.group, tabs } : null;
  };
  const filterEntries = (entries: PanelEntry[]): PanelEntry[] =>
    entries.map(matchEntry).filter((e): e is PanelEntry => e !== null);

  const general = sections.general.filter(matchesTab);
  const pinned = filterEntries(sections.pinned);
  const recent = filterEntries(sections.recent);
  const other: PanelEntry[] = [];

  const noMatches = general.length === 0 && pinned.length === 0 && recent.length === 0;
  return { general, pinned, recent, other, filtered: true, noMatches };
}

// Every thread row the panel is actually showing, in panel order: General
// (folded under the key 'general'), then each Pinned project in order, then
// each Recent project in order. A collapsed project contributes nothing, and
// neither does Other (it holds no thread lists, only project rows). Each
// list is folded through threadView.ts's foldThreads with the caller's own
// `isWaiting` predicate, so a hidden row waiting for you keeps that list's
// fold open here exactly as it does in the sidebar itself; only `shown` rows
// count as visible. This is the flat order Ctrl+Shift+Down/Up cycles
// through, crossing from one project's last row straight into the next
// project's first.
export function visibleThreadIds(
  sections: PanelSections,
  opts: {
    activeTabId: string;
    expandedLists: Record<string, boolean>;
    limit: number;
    isWaiting: (t: Tab) => boolean;
    // Two threads side by side (splitView.ts): the fold never cuts a split's
    // two rows apart, here exactly as in the panel itself.
    splits?: readonly Split[];
  },
): string[] {
  const ids: string[] = [];

  const foldKey = (key: string, tabs: Tab[]) => {
    const limit = foldLimit(tabs, opts.limit, opts.splits ?? []);
    const { shown } = foldThreads(tabs, opts.activeTabId, !!opts.expandedLists[key], limit, opts.isWaiting);
    ids.push(...shown.map(t => t.id));
  };

  foldKey('general', sections.general);
  for (const entry of sections.pinned) {
    if (entry.group.collapsed) continue;
    foldKey(entry.group.id, entry.tabs);
  }
  for (const entry of sections.recent) {
    if (entry.group.collapsed) continue;
    foldKey(entry.group.id, entry.tabs);
  }
  // sections.other contributes nothing: it carries no thread lists to cycle through.

  return ids;
}

// The next (dir 1) or previous (dir -1) id in a flat, ordered list, wrapping
// at either end. When the active id is not in the list at all (nothing
// selected yet, or the active thread is hidden by a fold or a collapsed
// project), dir 1 starts at the first id and dir -1 at the last, so the
// shortcut always lands somewhere sensible rather than doing nothing. An
// empty list has nowhere to go.
export function cycleThreadId(ids: string[], activeTabId: string, dir: 1 | -1): string | null {
  if (ids.length === 0) return null;
  const idx = ids.indexOf(activeTabId);
  if (idx === -1) return dir === 1 ? ids[0] : ids[ids.length - 1];
  const nextIdx = (idx + dir + ids.length) % ids.length;
  return ids[nextIdx];
}

// Where the panel's scroller should move to bring a project into view after it
// was opened from Home, the rail, the palette or the Other projects drawer
// (Aryan, 2026-09-21: the sidebar was left where it was and he had to hunt for
// the project). `top` and `bottom` bound the region to show, the project row
// down to its active thread row, in the scroller's content coordinates. Returns
// null when the region is already fully in view (no jump at all); otherwise the
// smallest move that shows it, with `margin` pixels of air, and a region taller
// than the view is aligned to its top so the project row itself is never lost.
// A move that would stop within `snap` pixels of the list's start goes all the
// way to 0, so the first section's heading is not left cut off above the row.
export function revealScrollTop(
  scrollTop: number,
  viewHeight: number,
  top: number,
  bottom: number,
  margin = 8,
  snap = 48,
): number | null {
  const want = { top: top - margin, bottom: bottom + margin };
  if (want.top >= scrollTop && want.bottom <= scrollTop + viewHeight) return null;
  const next = want.bottom - want.top > viewHeight || want.top < scrollTop
    ? Math.max(0, want.top)
    : want.bottom - viewHeight;
  return next < snap && bottom <= viewHeight ? 0 : next;
}

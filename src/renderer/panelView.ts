// The sidebar panel (Phase 8, design-03 decision 2): General, Pinned, Recent
// and Other, the search filter over them (decision 13), and the flat, panel-
// ordered thread list Ctrl+Shift+Down/Up cycles through (decisions 6 and 7).
//
// Pure module, no React, no DOM: importable from plain Node so the unit tests
// can run with `node src/renderer/panelView.test.ts`.
//
// This sits on top of two other pure modules rather than reimplementing
// either: sidebarWalk.ts's Segment list (groups first, tabs in walk order) is
// the input, and attention.ts's panelLists supplies the Recent/Other split
// (the 3-day rule, activity order) so this module and the rail can never
// disagree about which projects are "recent".

import type { Tab, Group } from './components/TabBar/types.ts';
import type { Segment } from './sidebarWalk.ts';
import { panelLists } from './attention.ts';
import { foldThreads } from './threadView.ts';

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

// Builds the panel's four lists from the sidebar's own walk. General is the
// loose tabs, in walk order. Pinned is the pinned, non-archived groups in walk (dragged)
// order, each carrying the tabs its own segment holds. Recent and Other come
// from attention.ts's panelLists applied to every non-archived group (which
// itself excludes pinned groups), each again carrying its segment's tabs.
// Archived groups are dropped before any of this and so appear nowhere.
export function panelSections(segments: Segment[], now: number): PanelSections {
  const general: Tab[] = [];
  const pinned: PanelEntry[] = [];
  const groups: Group[] = [];
  const tabs: Tab[] = [];
  const tabsByGroup = new Map<string, Tab[]>();

  for (const segment of segments) {
    if (segment.type === 'tab') {
      general.push(segment.tab);
      tabs.push(segment.tab);
      continue;
    }
    if (segment.group.archived) continue;
    groups.push(segment.group);
    tabs.push(...segment.tabs);
    tabsByGroup.set(segment.group.id, segment.tabs);
    if (segment.group.pinned) pinned.push({ group: segment.group, tabs: segment.tabs });
  }

  const { recent, other } = panelLists(groups, tabs, now);
  const toEntries = (gs: Group[]): PanelEntry[] =>
    gs.map(g => ({ group: g, tabs: tabsByGroup.get(g.id) ?? [] }));

  return { general, pinned, recent: toEntries(recent), other: toEntries(other) };
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
  },
): string[] {
  const ids: string[] = [];

  const foldKey = (key: string, tabs: Tab[]) => {
    const { shown } = foldThreads(tabs, opts.activeTabId, !!opts.expandedLists[key], opts.limit, opts.isWaiting);
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

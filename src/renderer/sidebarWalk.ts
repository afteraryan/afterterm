// The sidebar's row order, computed from groups first and tabs second.
//
// Why this exists: the sidebar used to build its list by walking `tabs` alone, so a
// group whose last terminal closed rendered nothing at all. The group still existed
// (its folder, colour and shell were saved) but the only way back into it was the
// Projects shelf pinned to the bottom of the panel. Walking groups first guarantees
// every group renders as a row, whatever its tab count, and later phases build the
// Pinned and Projects sections on top of this same walk.
//
// Order rules, chosen so every existing session keeps the exact visible order it has
// today (Phase 0 makes no visual changes):
//   1. Walk `tabs` in order. An ungrouped tab (no groupId, or a groupId that matches
//      no group) is a tab segment at its own position.
//   2. The first time a tab of group G is met, G's segment is emitted there, holding
//      ALL of G's tabs in `tabs` order. Later tabs of G are skipped, so a group that
//      somehow became non-contiguous still collapses into one segment at its first
//      appearance (useTabState keeps groups contiguous, this is just a guarantee).
//   3. Groups that never appear in `tabs` (zero tabs) are appended after the walk,
//      in `groups` array order, each with an empty `tabs` list.
//
// Pure module, no React: importable from plain Node so the unit tests can run with
// `node src/renderer/sidebarWalk.test.ts`.

import type { Tab, Group } from './components/TabBar/types.ts';

export type Segment =
  | { type: 'tab'; tab: Tab }
  | { type: 'group'; group: Group; tabs: Tab[] };

export function computeSegments(tabs: Tab[], groups: Group[]): Segment[] {
  const groupById = new Map(groups.map(g => [g.id, g]));

  // Every group's tabs, gathered up front so a group segment can be emitted the
  // moment its first tab is met, without a second pass.
  const tabsByGroup = new Map<string, Tab[]>();
  for (const tab of tabs) {
    if (!tab.groupId || !groupById.has(tab.groupId)) continue;
    const list = tabsByGroup.get(tab.groupId);
    if (list) list.push(tab);
    else tabsByGroup.set(tab.groupId, [tab]);
  }

  const segments: Segment[] = [];
  const emitted = new Set<string>();

  for (const tab of tabs) {
    const groupId = tab.groupId;
    if (!groupId || !groupById.has(groupId)) {
      segments.push({ type: 'tab', tab });
      continue;
    }
    if (emitted.has(groupId)) continue;
    emitted.add(groupId);
    segments.push({ type: 'group', group: groupById.get(groupId)!, tabs: tabsByGroup.get(groupId)! });
  }

  // Groups with nothing running still get a row, after everything that has tabs.
  for (const group of groups) {
    if (emitted.has(group.id)) continue;
    emitted.add(group.id);
    segments.push({ type: 'group', group, tabs: [] });
  }

  return segments;
}

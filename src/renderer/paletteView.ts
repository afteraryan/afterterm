// Pure search logic for the search palette (Ctrl Shift P). Turns the app's
// groups (projects) and tabs (threads) plus a filter query into the two result
// lists the palette shows, ranked so a name that starts with the query beats
// one that merely contains it. No React, no DOM: importable from plain Node so
// the unit tests can run with `node src/renderer/paletteView.test.ts`.

import type { Group, Tab } from './components/TabBar/types.ts';
import { displayTitle } from './threadView.ts';

export interface PaletteThreadResult {
  tab: Tab;
  group?: Group;
}

export interface PaletteResults {
  projects: Group[];
  threads: PaletteThreadResult[];
}

// 0 when the label starts with the query, 1 otherwise. Query and label are
// compared case-insensitively; an empty query ranks everything equally (0), so
// the caller's stable sort falls through to whatever tiebreaker it uses next
// (last-activity order, for the palette).
export function rankMatch(label: string, query: string): number {
  const q = query.trim().toLowerCase();
  if (q === '') return 0;
  return label.toLowerCase().startsWith(q) ? 0 : 1;
}

export function paletteResults(groups: Group[], tabs: Tab[], query: string): PaletteResults {
  const q = query.trim().toLowerCase();
  const groupById = new Map(groups.map(g => [g.id, g]));

  const projects = groups
    .filter(g => !g.archived)
    .filter(g => g.label.toLowerCase().includes(q))
    .sort((a, b) => {
      const byRank = rankMatch(a.label, q) - rankMatch(b.label, q);
      if (byRank !== 0) return byRank;
      return b.lastActiveAt - a.lastActiveAt;
    });

  const threads = tabs
    .filter(t => {
      if (t.groupId) {
        const owner = groupById.get(t.groupId);
        if (!owner || owner.archived) return false;
      }
      return displayTitle(t.title).toLowerCase().includes(q);
    })
    .map(t => ({ tab: t, group: t.groupId ? groupById.get(t.groupId) : undefined }))
    .sort((a, b) => {
      const byRank = rankMatch(displayTitle(a.tab.title), q) - rankMatch(displayTitle(b.tab.title), q);
      if (byRank !== 0) return byRank;
      return b.tab.lastActiveAt - a.tab.lastActiveAt;
    });

  return { projects, threads };
}

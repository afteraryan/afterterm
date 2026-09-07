// Pure search logic for the search palette (Ctrl Shift P). Turns the app's
// groups (projects) and tabs (threads) plus a filter query into the two result
// lists the palette shows, ranked so a name that starts with the query beats
// one that merely contains it. No React, no DOM: importable from plain Node so
// the unit tests can run with `node src/renderer/paletteView.test.ts`.

import type { Group, Tab, HistoryEntry } from './components/TabBar/types.ts';
import { threadName } from './threadView.ts';
import { historyTitleMatches } from './history.ts';

export interface PaletteThreadResult {
  tab: Tab;
  group?: Group;
}

// A closed thread found through search: the palette opens the project page's
// History tab on click (Search, design-02), which needs the owning group as
// much as the entry itself.
export interface PaletteHistoryResult {
  entry: HistoryEntry;
  group: Group;
}

export interface PaletteResults {
  projects: Group[];
  threads: PaletteThreadResult[];
  history: PaletteHistoryResult[];
}

// The mock shows at most 8 history rows in the palette: unlike projects and
// threads, which the workspace already keeps to a handful, history can grow to
// HISTORY_MAX per project across many projects, so it needs its own cap to
// keep the palette a quick list rather than a second project page.
const HISTORY_RESULT_LIMIT = 8;

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
      return threadName(t).toLowerCase().includes(q);
    })
    .map(t => ({ tab: t, group: t.groupId ? groupById.get(t.groupId) : undefined }))
    .sort((a, b) => {
      const byRank = rankMatch(threadName(a.tab), q) - rankMatch(threadName(b.tab), q);
      if (byRank !== 0) return byRank;
      return b.tab.lastActiveAt - a.tab.lastActiveAt;
    });

  // Every non-archived group's history, filtered by title, ranked the same way
  // as threads and projects (prefix match first) but tiebroken by closedAt
  // rather than lastActiveAt: a history row has no activity of its own once
  // closed, only when it was closed.
  const history = groups
    .filter(g => !g.archived)
    .flatMap(g => g.history.filter(e => historyTitleMatches(e, q)).map(entry => ({ entry, group: g })))
    .sort((a, b) => {
      const byRank = rankMatch(a.entry.title, q) - rankMatch(b.entry.title, q);
      if (byRank !== 0) return byRank;
      return b.entry.closedAt - a.entry.closedAt;
    })
    .slice(0, HISTORY_RESULT_LIMIT);

  return { projects, threads, history };
}

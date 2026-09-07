// Pure logic for the Home screen and the project page's search box: the date
// heading, "how long ago" wording, which projects go where (pinned, the
// unpinned list with its four-row fold, archived), the totals under the date,
// and the search filter shared by the project page's Live/Asleep/History tabs.
//
// Why this exists: none of these decisions touch React or the DOM, they only
// read Group and Tab fields that already exist (pinned, archived, lastActiveAt,
// asleep, notification, title). Keeping the decision here means it can be unit
// tested directly, the way threadView.ts already is, instead of only through a
// rendered component.
//
// Pure module, no React, no DOM: importable from plain Node so the unit tests
// can run with `node src/renderer/homeView.test.ts`.

import type { Tab, Group } from './components/TabBar/types.ts';
import { threadState, projectCounts, displayTitle } from './threadView.ts';

// "Sunday, 6 September": en-GB weekday and day-month order, no year. The
// caller passes ms since epoch (Date.now() in the app, a fixed value in tests).
export function dateHeading(now: number): string {
  // Built from parts rather than one toLocaleDateString call: en-GB drops the
  // comma after the weekday once the year is left out, and the mock (and the
  // design) show "Sunday, 6 September".
  const d = new Date(now);
  const weekday = d.toLocaleDateString('en-GB', { weekday: 'long' });
  const day = d.getDate();
  const month = d.toLocaleDateString('en-GB', { month: 'long' });
  return `${weekday}, ${day} ${month}`;
}

// "now" under a minute, then the largest whole unit: minutes, hours, days,
// weeks (from 7 days), months (from 30 days), years (from 365 days). Each
// threshold is exclusive on the lower bound, so exactly 60s reads as "1m" and
// exactly 7d reads as "1w", matching the boundaries used across the app.
export function relativeTime(then: number, now: number): string {
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSec < 60) return 'now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}d`;
  if (diffDay < 30) return `${Math.floor(diffDay / 7)}w`;
  if (diffDay < 365) return `${Math.floor(diffDay / 30)}mo`;
  return `${Math.floor(diffDay / 365)}y`;
}

export interface HomeSectionsOptions {
  showAll: boolean;
  limit?: number;
}

export interface HomeSectionsResult {
  pinned: Group[];
  projects: Group[];
  shownProjects: Group[];
  hiddenCount: number;
  archived: Group[];
}

// The three groupings the Home screen draws from, plus the four-row fold over
// the unpinned Projects list. `tabs` is accepted for interface symmetry with
// the rest of the module (and because a future Home revision may need it to
// break ties) but this function's own output depends only on `groups`; sort
// order relies on Array#sort being stable, so tied lastActiveAt values keep
// the caller's array order (the sidebar's order) instead of shuffling.
export function homeSections(
  groups: Group[],
  _tabs: Tab[],
  { showAll, limit = 4 }: HomeSectionsOptions,
): HomeSectionsResult {
  const pinned = groups.filter(g => g.pinned && !g.archived);
  const projects = groups
    .filter(g => !g.pinned && !g.archived)
    .slice()
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  const archived = groups
    .filter(g => g.archived)
    .slice()
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt);

  const shownProjects = showAll ? projects : projects.slice(0, limit);
  const hiddenCount = showAll ? 0 : Math.max(0, projects.length - limit);

  return { pinned, projects, shownProjects, hiddenCount, archived };
}

// Totals for the pills under the Home date heading: how many tabs need you,
// and how many are working or running, across every non-archived project plus
// General (a tab with no groupId, or a groupId that names no group). A
// project's own threads stop counting the moment it is archived, since
// archiving is meant to take a project off the board entirely.
export function homeTotals(groups: Group[], tabs: Tab[]): { needsYou: number; running: number } {
  const archivedIds = new Set(groups.filter(g => g.archived).map(g => g.id));
  const counted = tabs.filter(t => !t.groupId || !archivedIds.has(t.groupId));
  return projectCounts(counted.map(threadState));
}

// Case-insensitive substring match on the thread's display title (the hook's
// leading glyph already stripped), used by the project page's search box. An
// empty query returns every thread, unfiltered.
export function filterThreads(tabs: Tab[], query: string): Tab[] {
  const q = query.trim().toLowerCase();
  if (!q) return tabs;
  return tabs.filter(t => displayTitle(t.title).toLowerCase().includes(q));
}

// The project page's Live and Asleep tabs: a straight split on Tab.asleep,
// each list keeping the caller's order.
export function splitLiveAsleep(tabs: Tab[]): { live: Tab[]; asleep: Tab[] } {
  return {
    live: tabs.filter(t => !t.asleep),
    asleep: tabs.filter(t => t.asleep),
  };
}

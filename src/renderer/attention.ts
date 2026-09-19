// The one aggregate every count in the app reads from: the rail's badges, the
// project row's pills, Home's totals and the panel's Recent/Other lists all
// call into this module rather than each doing their own tallying, so they
// can never disagree with each other about how many threads are waiting,
// working or finished.
//
// Why this exists: before Phase 7, `projectCounts` in threadView.ts and
// `homeTotals` in homeView.ts each summed a list of ThreadState by hand, and a
// later change to what counts as "needs you" (this phase adds unread to it)
// would have had to be made in both places, with no guarantee they stayed in
// step. This module holds the one definition of "waiting", "working",
// "running" and "finished", and threadView.ts and homeView.ts are now thin
// wrappers over it. Phase 8 adds the rail's tile list and the panel's
// Recent/Other split on the same foundation.
//
// Pure module, no React, no DOM: importable from plain Node so the unit tests
// can run with `node src/renderer/attention.test.ts`.
//
// Note the import cycle: this module calls threadView's threadState, and
// threadView's projectCounts calls countStates here. That is fine as long as
// both sides only use the other inside functions (call time), never at the top
// level (load time); keep it that way when adding to either file.

import type { Tab, Group } from './components/TabBar/types.ts';
import { threadState } from './threadView.ts';
import type { ThreadState } from './threadView.ts';

export interface AttentionCounts {
  waiting: number;
  working: number;
  running: number;
  finished: number;
  compacting: number;
}

// "Waiting for you" everywhere in the UI means needs-you plus unread
// (design-03's phrase, stated once here): the one definition foldThreads
// (threadView.ts) also uses to decide whether a hidden row must force its
// project's fold open.
export function isWaitingState(state: ThreadState): boolean {
  return state === 'needs-you' || state === 'unread';
}

// Working counts only the plain 'working' state, not compacting or
// background, matching the play pill's existing behaviour; running counts a
// captured port with nothing else pending; finished counts done; compacting
// (Phase 8) is its own bucket, counted nowhere else (the play pill still
// counts working and running only, per design-03's Phase 7 handoff).
export function countStates(states: ThreadState[]): AttentionCounts {
  const counts: AttentionCounts = { waiting: 0, working: 0, running: 0, finished: 0, compacting: 0 };
  for (const state of states) {
    if (isWaitingState(state)) counts.waiting++;
    else if (state === 'working') counts.working++;
    else if (state === 'running') counts.running++;
    else if (state === 'done') counts.finished++;
    else if (state === 'compacting') counts.compacting++;
  }
  return counts;
}

export function countTabs(tabs: Tab[]): AttentionCounts {
  return countStates(tabs.map(threadState));
}

// One entry per non-archived group, keyed by group id. An archived group is
// left out entirely (it has no row anywhere counts are shown); a group with
// no tabs gets a present entry of all zeros rather than being omitted, so a
// caller does not have to special-case "not in the map" versus "zero".
export function projectAttention(groups: Group[], tabs: Tab[]): Map<string, AttentionCounts> {
  const map = new Map<string, AttentionCounts>();
  for (const group of groups) {
    if (group.archived) continue;
    map.set(group.id, countTabs(tabs.filter(t => t.groupId === group.id)));
  }
  return map;
}

// Every tab in a non-archived project, plus General (no groupId, or a groupId
// naming no group): the exact rule homeTotals in homeView.ts used before this
// module existed, kept here so Home, the rail and the project pills can never
// drift apart on what "the total" means.
export function totalAttention(groups: Group[], tabs: Tab[]): AttentionCounts {
  const archivedIds = new Set(groups.filter(g => g.archived).map(g => g.id));
  const counted = tabs.filter(t => !t.groupId || !archivedIds.has(t.groupId));
  return countTabs(counted);
}

// The rail (Phase 8) shows only projects with something pending: a thread
// waiting for you, one that finished and has not been viewed, or one that is
// compacting (Aryan, 2026-09-19: a compacting chat gets its own rail badge, so
// its project must be on the rail to show it, even with nothing else
// pending). Caller order (the panel's own group order) is kept rather than
// re-sorted, since the rail is a subset of that same list, not a ranking of
// its own.
export function railProjects(groups: Group[], tabs: Tab[]): Group[] {
  const counts = projectAttention(groups, tabs);
  return groups.filter(g => {
    if (g.archived) return false;
    const c = counts.get(g.id);
    return !!c && (c.waiting > 0 || c.finished > 0 || c.compacting > 0);
  });
}

// A project counts as "recent" for three days after its last activity, or for
// as long as it still has an awake thread, whichever is longer: a running
// server or an open chat should never fall out of the panel just because the
// clock passed the window.
export const RECENT_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

// The panel's Recent and Other lists (Phase 8): unpinned, non-archived
// projects split by recency. Recent is sorted by lastActiveAt descending
// (Array#sort is stable, so a tie keeps the caller's own order rather than
// shuffling); Other keeps the caller's order as-is, since it is an overflow
// list, not a ranking. Pinned and archived groups appear in neither: pinned
// projects have their own section above Recent, and archived projects are
// nowhere in the panel.
export function panelLists(groups: Group[], tabs: Tab[], now: number): { recent: Group[]; other: Group[] } {
  const candidates = groups.filter(g => !g.pinned && !g.archived);
  const hasAwakeTab = (groupId: string) => tabs.some(t => t.groupId === groupId && !t.asleep);
  const isRecent = (g: Group) => hasAwakeTab(g.id) || (now - g.lastActiveAt) <= RECENT_WINDOW_MS;

  const recent = candidates.filter(isRecent).slice().sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  const other = candidates.filter(g => !isRecent(g));
  return { recent, other };
}

// Decision 1's tile-click rule (also usable wherever "open the thread that
// most needs looking at" is needed): the first thread waiting for you, else
// the first finished thread, else the most recently active awake thread, else
// null when the list is empty or every thread is asleep with nothing pending.
// `tabs` is taken in caller order for the first two passes (the order the
// panel already shows them in); the fallback pass instead picks the highest
// lastActiveAt regardless of position.
// Opening a project from Home (a card or a row) or bringing it in from the
// docked Other projects row lands on the thread you last worked in, asleep or
// awake: the highest lastActiveAt, the earlier one in tab order on a tie, null
// when the project has no threads (the caller then opens a new one). Aryan,
// 2026-09-19: "the last working thread in that project", replacing the first
// thread in tab order. Distinct from firstThreadToOpen, the rail tile's rule,
// which prefers whatever is waiting for you.
export function lastWorkedThread(tabs: Tab[]): Tab | null {
  if (tabs.length === 0) return null;
  return tabs.reduce((latest, t) => (t.lastActiveAt > latest.lastActiveAt ? t : latest));
}

export function firstThreadToOpen(tabs: Tab[]): Tab | null {
  const waiting = tabs.find(t => {
    const s = threadState(t);
    return s === 'needs-you' || s === 'unread';
  });
  if (waiting) return waiting;

  const finished = tabs.find(t => threadState(t) === 'done');
  if (finished) return finished;

  const awake = tabs.filter(t => !t.asleep);
  if (awake.length === 0) return null;
  return awake.reduce((latest, t) => (t.lastActiveAt > latest.lastActiveAt ? t : latest));
}

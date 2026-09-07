// Pure rules for a project's closed-thread history: turning a closing Tab into
// a HistoryEntry, appending it with dedupe and a cap, resuming one back into a
// Tab, and the search filter the project page's History tab and the palette
// both reuse. No React, no DOM, no Electron: importable from plain Node so the
// unit tests can run with `node src/renderer/history.test.ts`.
//
// Why this exists as its own module rather than living in threadView.ts or
// sessionMigration.ts: it is the one place that knows the shape of a
// HistoryEntry and the rules around it (newest first, dedupe by id, the cap,
// what counts as resumable), so the project page, the palette and the close
// handler all call the same functions instead of each re-deriving the rule.

import type { Tab, Group, HistoryEntry } from './components/TabBar/types.ts';
import { threadKind } from './threadView.ts';

// Per-project cap. Old entries fall off the end (oldest first) rather than
// growing session.json without bound across months of use.
export const HISTORY_MAX = 100;

// Same pattern as Terminal/index.tsx and sleepWake.ts: only a canonical UUID is
// ever treated as a real session id, since session.json (and history) can be
// hand-edited.
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// The entry recorded when a thread closes. `title` is passed in rather than
// derived here (the caller already has threadName(tab); recomputing it would
// duplicate threadView's rules for no reason). `id` is the closing tab's own
// id, on purpose (see HistoryEntry in types.ts: it is what lets Resume find the
// same tail file). Optional fields are omitted rather than written as
// undefined, so a saved entry never carries a "sessionId": null-shaped key.
export function historyEntryFor(tab: Tab, title: string, now: number): HistoryEntry {
  const entry: HistoryEntry = { id: tab.id, title, kind: threadKind(tab), closedAt: now };
  if (tab.claudeSessionId) entry.sessionId = tab.claudeSessionId;
  const cwd = tab.claudeCwd ?? tab.cwd;
  if (cwd) entry.cwd = cwd;
  return entry;
}

// Newest first, deduped by id (closing the same tab id twice, e.g. a resumed
// history entry that gets closed again, replaces the old row rather than
// doubling it), capped at HISTORY_MAX with the oldest entries dropped first.
// Does not mutate the input array.
export function appendHistory(history: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  const deduped = history.filter(e => e.id !== entry.id);
  return [entry, ...deduped].slice(0, HISTORY_MAX);
}

export function removeHistoryEntry(history: HistoryEntry[], id: string): HistoryEntry[] {
  return history.filter(e => e.id !== id);
}

// Only a chat with a real session id can be resumed (`claude --resume`); a
// shell in history is a record of what ran, nothing left to reattach to.
export function isResumable(entry: HistoryEntry): boolean {
  return entry.kind === 'chat' && !!entry.sessionId && UUID_RE.test(entry.sessionId);
}

// What Resume recreates: the same tab id (so the tail file at
// threads/<id>.txt is found), asleep already false and wokeAt already set,
// since a resumed thread's terminal should behave exactly like a freshly woken
// one, replaying its tail above a divider the moment it mounts. Only a chat
// gets claudeTitle/claudeSessionId/claudeCwd; a shell has nothing to resume, it
// just starts a fresh prompt in its cwd (or the project's, if the entry itself
// never captured one).
export function tabFromHistory(
  entry: HistoryEntry,
  group: Pick<Group, 'id' | 'shellId' | 'cwd'>,
  now: number,
): Tab {
  const tab: Tab = {
    id: entry.id,
    title: entry.title,
    groupId: group.id,
    shellId: group.shellId,
    cwd: entry.cwd ?? group.cwd,
    lastActiveAt: now,
    asleep: false,
    wokeAt: now,
  };
  if (entry.kind === 'chat') {
    tab.claudeTitle = entry.title;
    if (entry.sessionId) tab.claudeSessionId = entry.sessionId;
    if (entry.cwd) tab.claudeCwd = entry.cwd;
  }
  return tab;
}

// The largest N over ids shaped like `${prefix}${N}` (e.g. "tab-12" under
// prefix "tab-"), 0 when none match. useTabState.restoreSession runs this over
// both the live tab ids AND every project's history ids together, so a
// brand-new tab id never collides with a closed thread whose tail file
// (threads/<id>.txt) and history entry still exist: reusing that id would
// replay a stranger's saved output into what looks like a fresh terminal.
export function maxNumericId(prefix: string, ids: Iterable<string>): number {
  let max = 0;
  for (const id of ids) {
    if (!id.startsWith(prefix)) continue;
    const n = Number(id.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return max;
}

// Case-insensitive substring match on the entry's title, the same shape as
// threadView/homeView's other search filters. An empty query matches
// everything, so the project page's History tab shows the full list until the
// user types.
export function historyTitleMatches(entry: HistoryEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return entry.title.toLowerCase().includes(q);
}

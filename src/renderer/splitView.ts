// Two threads side by side (docs/design-06-split-groups.md). In the design and
// the UI this is a "group"; in code it is a split, because `Group` is already a
// project (TabBar/types.ts).
//
// A split is two threads of the same project (or two General threads) shown in
// the main pane together, `a` on the left and `b` on the right. It exists only
// while it holds two threads, and a thread is in at most one split. Which half
// has the keyboard is not stored here: it is the app's one `activeTabId`, so a
// split is on screen exactly when the active thread is in it, and everything
// keyed off the active thread (toast suppression, done-clears-on-view) keeps
// meaning "the focused half" (design-06, rule 1).
//
// The invariant every function here keeps: a split's two threads sit next to
// each other in the tab list, `a` then `b`. That one rule makes session order
// (Ctrl+Tab) and panel order (Ctrl+Shift+Down/Up, panelView.ts) pass through a
// split's halves one after the other (rule 2), and lets the panel draw the line
// joining the two rows.
//
// Pure module: no React, no DOM, runnable under plain Node for its tests
// (node src/renderer/splitView.test.ts).

import type { Tab, Group } from './components/TabBar/types.ts';
import { placeThread } from './threadView.ts';

export interface Split {
  id: string;
  a: string; // left half's thread id
  b: string; // right half's thread id
  // The left half's share of the width, 0.25 to 0.75 (the divider's limits).
  ratio: number;
}

export type SplitSide = 'a' | 'b';

export const SPLIT_MIN = 0.25;
export const SPLIT_MAX = 0.75;
export const SPLIT_DEFAULT = 0.5;

// The refused drops' labels, exactly as the mockup shows them.
export const REFUSE_SAME_PROJECT = 'Same project only';
export const REFUSE_TWO_AT_MOST = 'Two at most';

export function clampRatio(r: unknown): number {
  if (typeof r !== 'number' || !Number.isFinite(r)) return SPLIT_DEFAULT;
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, r));
}

export function splitOf(splits: readonly Split[], tabId: string): Split | undefined {
  return splits.find(s => s.a === tabId || s.b === tabId);
}

export function partnerOf(splits: readonly Split[], tabId: string): string | undefined {
  const s = splitOf(splits, tabId);
  if (!s) return undefined;
  return s.a === tabId ? s.b : s.a;
}

// The thread ids on screen, left to right: the active thread's split, or the
// active thread alone, or nothing when no thread is active.
export function panesFor(splits: readonly Split[], activeTabId: string): string[] {
  if (!activeTabId) return [];
  const s = splitOf(splits, activeTabId);
  return s ? [s.a, s.b] : [activeTabId];
}

// Which project a thread counts as being in: its project's id, or '' for
// General. A thread whose project no longer exists shows under General in the
// panel (panelSections), so it counts as General here too.
export function projectKey(tab: Pick<Tab, 'groupId'>, groups?: readonly Pick<Group, 'id'>[]): string {
  if (!tab.groupId) return '';
  if (groups && !groups.some(g => g.id === tab.groupId)) return '';
  return tab.groupId;
}

// What dropping a dragged thread on the main pane would do. `side` is the half
// under the pointer. Null means the pane is no target at all (the dragged
// thread is the one already on screen, or is one of the split on screen, or
// nothing is on screen); a target with `bad` is shown in red with its label
// and releasing does nothing.
export type PaneTarget =
  | { kind: 'half'; side: SplitSide; bad?: string }
  | { kind: 'whole'; bad: string };

export function paneDropTarget(
  tabs: readonly Pick<Tab, 'id' | 'groupId'>[],
  groups: readonly Pick<Group, 'id'>[],
  splits: readonly Split[],
  activeTabId: string,
  dragId: string,
  side: SplitSide,
): PaneTarget | null {
  const open = tabs.find(t => t.id === activeTabId);
  const dragged = tabs.find(t => t.id === dragId);
  if (!open || !dragged) return null;
  const onScreen = splitOf(splits, activeTabId);
  if (onScreen) {
    if (onScreen.a === dragId || onScreen.b === dragId) return null;
    return { kind: 'whole', bad: REFUSE_TWO_AT_MOST };
  }
  if (dragId === activeTabId) return null;
  if (projectKey(open, groups) !== projectKey(dragged, groups)) {
    return { kind: 'half', side, bad: REFUSE_SAME_PROJECT };
  }
  return { kind: 'half', side };
}

// A split made by dropping `dragId` on the `side` half of `stayId` (the thread
// on screen). Any split the dragged thread was in ends first. The dragged
// thread moves next to the other in the tab list, in their left-right order;
// nothing else moves.
export function createSplit<T extends Pick<Tab, 'id' | 'groupId'>>(
  tabs: T[],
  splits: Split[],
  stayId: string,
  dragId: string,
  side: SplitSide,
  id: string,
): { tabs: T[]; splits: Split[] } {
  if (stayId === dragId) return { tabs, splits };
  const drag = tabs.find(t => t.id === dragId);
  if (!drag || !tabs.some(t => t.id === stayId)) return { tabs, splits };
  const rest = tabs.filter(t => t.id !== dragId);
  const at = rest.findIndex(t => t.id === stayId);
  rest.splice(side === 'a' ? at : at + 1, 0, drag);
  const kept = splits.filter(s => ![s.a, s.b].includes(dragId) && ![s.a, s.b].includes(stayId));
  const split: Split = {
    id,
    a: side === 'a' ? dragId : stayId,
    b: side === 'a' ? stayId : dragId,
    ratio: SPLIT_DEFAULT,
  };
  return { tabs: rest, splits: [...kept, split] };
}

// Ends whatever split the thread is in (Ungroup, close, a move to another
// project). Returns the same array when it was in none.
export function dissolveSplitOf(splits: Split[], tabId: string): Split[] {
  const next = splits.filter(s => s.a !== tabId && s.b !== tabId);
  return next.length === splits.length ? splits : next;
}

export function setSplitRatio(splits: Split[], splitId: string, ratio: number): Split[] {
  const r = clampRatio(ratio);
  let changed = false;
  const next = splits.map(s => {
    if (s.id !== splitId || s.ratio === r) return s;
    changed = true;
    return { ...s, ratio: r };
  });
  return changed ? next : splits;
}

// Which thread is active after `closedId` closes. Closing the focused half of a
// split leaves the other half on screen alone (rule 3); closing the other half
// leaves the focused one where it is; anything else follows the old rule (the
// thread that took the closed one's place in the list, else the one before).
export function activeAfterClose(
  tabs: readonly Pick<Tab, 'id'>[],
  splits: readonly Split[],
  activeTabId: string,
  closedId: string,
): string {
  const rest = tabs.filter(t => t.id !== closedId);
  if (rest.length === 0) return '';
  if (activeTabId !== closedId) return activeTabId;
  const partner = partnerOf(splits, closedId);
  if (partner && rest.some(t => t.id === partner)) return partner;
  const idx = tabs.findIndex(t => t.id === closedId);
  return rest[Math.min(Math.max(idx, 0), rest.length - 1)].id;
}

// A thread dropped in the panel (placeThread in threadView.ts) without breaking
// a split apart:
// - a split thread dropped in another project leaves its split (rule 6);
// - a split thread dropped in its own project takes its partner along, the two
//   staying in their left-right order;
// - whatever moved (a thread, or a pair) that lands between another split's two
//   rows goes just below them.
export function placeThreadKeepingSplits<T extends Pick<Tab, 'id' | 'groupId'>>(
  tabs: T[],
  splits: Split[],
  tabId: string,
  groupId: string | undefined,
  beforeId: string | null,
): { tabs: T[]; splits: Split[] } {
  const r = placeUnit(tabs, splits, tabId, groupId, beforeId);
  const unit = splitOf(r.splits, tabId);
  const lifted = liftOutOfPairs(r.tabs, r.splits, unit ? [unit.a, unit.b] : [tabId]);
  const same = lifted.length === tabs.length && lifted.every((t, i) => t === tabs[i]);
  return { tabs: same ? tabs : lifted, splits: r.splits };
}

// The moved rows (one thread, or a pair a then b, next to each other) sitting
// between the two rows of some other split: moved to just below that split.
function liftOutOfPairs<T extends Pick<Tab, 'id'>>(tabs: T[], splits: readonly Split[], unit: string[]): T[] {
  const start = tabs.findIndex(t => t.id === unit[0]);
  if (start === -1) return tabs;
  const end = start + unit.length - 1;
  const above = tabs[start - 1];
  const below = tabs[end + 1];
  if (!above || !below) return tabs;
  const s = splitOf(splits, above.id);
  if (!s || s.a !== above.id || s.b !== below.id) return tabs;
  const moved = tabs.slice(start, end + 1);
  return [...tabs.slice(0, start), below, ...moved, ...tabs.slice(end + 2)];
}

function placeUnit<T extends Pick<Tab, 'id' | 'groupId'>>(
  tabs: T[],
  splits: Split[],
  tabId: string,
  groupId: string | undefined,
  beforeId: string | null,
): { tabs: T[]; splits: Split[] } {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return { tabs, splits };
  const split = splitOf(splits, tabId);
  if (split && (tab.groupId ?? undefined) !== groupId) {
    return { tabs: placeThread(tabs, tabId, groupId, beforeId), splits: dissolveSplitOf(splits, tabId) };
  }
  if (split) {
    const partnerId = split.a === tabId ? split.b : split.a;
    const partner = tabs.find(t => t.id === partnerId)!;
    const without = tabs.filter(t => t.id !== partnerId);
    // Dropped just above its own partner: that is just above the pair.
    let before = beforeId;
    if (before === partnerId) {
      const i = tabs.findIndex(t => t.id === partnerId);
      before = tabs[i + 1]?.id ?? null;
      if (before === tabId) before = tabs[i + 2]?.id ?? null;
    }
    const placed = placeThread(without, tabId, groupId, before);
    const at = placed.findIndex(t => t.id === tabId);
    const next = [...placed];
    next.splice(split.a === partnerId ? at : at + 1, 0, partner);
    const same = next.every((t, i) => t.id === tabs[i].id);
    return { tabs: same ? tabs : next, splits };
  }
  return { tabs: placeThread(tabs, tabId, groupId, beforeId), splits };
}

// Splits read from a saved session, made safe to restore: each must name two
// different threads that exist, are in the same project and are in no earlier
// split; anything else is dropped, leaving two plain threads. The ratio is
// clamped to the divider's limits. Then each kept split's right thread is moved
// to sit just after its left one, so a hand-edited file still gets the order
// the rest of the app relies on.
export function restoreSplits<T extends Pick<Tab, 'id' | 'groupId'>>(
  raw: unknown,
  tabs: T[],
  groups: readonly Pick<Group, 'id'>[],
): { tabs: T[]; splits: Split[] } {
  if (!Array.isArray(raw)) return { tabs, splits: [] };
  const byId = new Map(tabs.map(t => [t.id, t]));
  const used = new Set<string>();
  const ids = new Set<string>();
  const splits: Split[] = [];
  for (const v of raw) {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) continue;
    const r = v as Record<string, unknown>;
    if (typeof r.id !== 'string' || !r.id || ids.has(r.id)) continue;
    if (typeof r.a !== 'string' || typeof r.b !== 'string' || r.a === r.b) continue;
    const a = byId.get(r.a);
    const b = byId.get(r.b);
    if (!a || !b || used.has(a.id) || used.has(b.id)) continue;
    if (projectKey(a, groups) !== projectKey(b, groups)) continue;
    used.add(a.id); used.add(b.id); ids.add(r.id);
    splits.push({ id: r.id, a: a.id, b: b.id, ratio: clampRatio(r.ratio) });
  }
  let next = tabs;
  for (const s of splits) {
    const ai = next.findIndex(t => t.id === s.a);
    if (next[ai + 1]?.id === s.b) continue;
    const b = next.find(t => t.id === s.b)!;
    next = next.filter(t => t.id !== s.b);
    next.splice(next.findIndex(t => t.id === s.a) + 1, 0, b);
  }
  return { tabs: next, splits };
}

// The panel's five-row fold never cuts a split's two rows apart: when the last
// row the fold would show is a split's left half, its right half shows too.
export function foldLimit(threads: readonly Pick<Tab, 'id'>[], limit: number, splits: readonly Split[]): number {
  const last = threads[limit - 1];
  const next = threads[limit];
  if (!last || !next) return limit;
  const s = splitOf(splits, last.id);
  return s && s.a === last.id && s.b === next.id ? limit + 1 : limit;
}

// Highest numeric suffix among ids like "split-7", so a restored session's
// splits never collide with new ones.
export function maxSplitNumber(splits: readonly Split[]): number {
  let max = 0;
  for (const s of splits) {
    const m = /^split-(\d+)$/.exec(s.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

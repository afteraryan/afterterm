// Turns the data the app already holds on a Tab (a thread) and a Group (a project)
// into what the sidebar and the main pane header show: a kind, a state, a label, a
// row title, the five-row fold, counter pills and toast wording.
//
// Why this exists: the sidebar and header need to decide, on every render, "is this
// a chat or a shell", "what state icon goes here", "does this row breathe", "what
// text goes on the row and in the toast". None of that decision depends on React or
// the DOM, it only reads fields already on Tab and Group. Keeping it here, as a pure
// module, means the decision can be unit tested directly instead of only through a
// rendered component, and it stays in one place instead of being reimplemented at
// each call site.
//
// Pure module, no React, no DOM: importable from plain Node so the unit tests can
// run with `node src/renderer/threadView.test.ts`.

import type { Tab, Group, TabNotification } from './components/TabBar/types.ts';
import type { Segment } from './sidebarWalk.ts';

export type ThreadKind = 'chat' | 'shell';

export type ThreadState =
  | 'needs-you'
  | 'working'
  | 'running'
  | 'done'
  | 'quiet'
  | 'asleep'
  | 'compacting'
  | 'background';

// A thread is a chat when a Claude Code session id was captured for it. Everything
// else, including a shell that happens to own a listening port (a server), is a
// shell. Servers get their own icon in Phase 5; nothing here changes for them yet.
export function threadKind(tab: Pick<Tab, 'claudeSessionId'>): ThreadKind {
  return tab.claudeSessionId ? 'chat' : 'shell';
}

// Asleep wins over everything: a thread with no process has no notification worth
// showing. Otherwise today's notification maps one for one onto a state. 'running'
// is part of the type because Phase 5 needs a value to produce, but nothing here
// ever returns it: a server's running state is not derived from a notification.
export function threadState(tab: Pick<Tab, 'asleep' | 'notification'>): ThreadState {
  if (tab.asleep) return 'asleep';
  switch (tab.notification) {
    case 'attention': return 'needs-you';
    case 'working': return 'working';
    case 'done': return 'done';
    case 'compacting': return 'compacting';
    case 'background': return 'background';
    default: return 'quiet';
  }
}

// Words for the header chip and the row's hover title. Quiet has no chip, so it is
// the empty string, not a placeholder word.
export function stateLabel(state: ThreadState): string {
  switch (state) {
    case 'needs-you': return 'Needs you';
    case 'working': return 'Working';
    case 'running': return 'Running';
    case 'done': return 'Done';
    case 'asleep': return 'Asleep';
    case 'compacting': return 'Compacting';
    case 'background': return 'Background tasks';
    case 'quiet': return '';
  }
}

// Only needs-you and done breathe (a slow row-background cycle) until the thread is
// viewed. Every other state, including working and running, holds steady.
export function stateBreathes(state: ThreadState): boolean {
  return state === 'needs-you' || state === 'done';
}

// One leading hook glyph, plus the whitespace right after it. The hook writes
// titles like "▶ project - working"; once the state moves into the row's icon, the
// glyph in the text is redundant and would double up with it. The braille spinner
// range covers glyphs a terminal spinner library might also prepend. Anything else
// about the title, including plain paths like "C:\", is left untouched. A title
// that becomes empty after stripping (or was already empty) falls back to
// "Terminal", the same default a tab with no title shows today.
const LEADING_GLYPH = /^[\u2705\u26A0\u23F3\u2699\u25B6\u2800-\u28FF\u2733]\s*/u;

export function displayTitle(title: string): string {
  const stripped = title.replace(LEADING_GLYPH, '');
  return stripped.length > 0 ? stripped : 'Terminal';
}

// The five-row fold for a project's thread list. `threads` is already in display
// order. Normally the first `limit` rows show and the rest collapse behind "Show N
// more". But a thread the user is actually looking at must never be hidden by its
// own project's fold, so if the active thread's position is at or past `limit`, the
// list opens regardless of the `expanded` flag the user last chose (forcedOpen is
// reported so the caller can tell "open because forced" from "open because the user
// expanded it").
export function foldThreads<T extends { id: string }>(
  threads: T[],
  activeId: string,
  expanded: boolean,
  limit = 5,
): { shown: T[]; hiddenCount: number; showMore: boolean; forcedOpen: boolean } {
  const activeIndex = threads.findIndex(t => t.id === activeId);
  const forcedOpen = activeIndex >= limit;
  const open = expanded || forcedOpen;
  const shown = open ? threads : threads.slice(0, limit);
  const hiddenCount = open ? 0 : Math.max(0, threads.length - limit);
  const showMore = threads.length > limit;
  return { shown, hiddenCount, showMore, forcedOpen };
}

// Counter pills for a project row: how many of its threads need you, and how many
// are actively doing something (working or running). Both zero means the caller
// renders no pills at all; this function just reports the counts, the "no pills"
// choice is the caller's.
export function projectCounts(states: ThreadState[]): { needsYou: number; running: number } {
  let needsYou = 0;
  let running = 0;
  for (const state of states) {
    if (state === 'needs-you') needsYou++;
    if (state === 'running' || state === 'working') running++;
  }
  return { needsYou, running };
}

// The sidebar's three sections, built from the groups-first walk. `general` is the
// ungrouped tabs, in their walk order, and is an empty list when there are none (the
// caller decides whether to render the section at all). `pinned` and `projects`
// split the group segments by the `pinned` flag, each in walk order; a group with
// `archived` true is left out of both, Home is where an archived project reappears.
export function sidebarSections(segments: Segment[]): {
  general: Tab[];
  pinned: Array<{ group: Group; tabs: Tab[] }>;
  projects: Array<{ group: Group; tabs: Tab[] }>;
} {
  const general: Tab[] = [];
  const pinned: Array<{ group: Group; tabs: Tab[] }> = [];
  const projects: Array<{ group: Group; tabs: Tab[] }> = [];

  for (const segment of segments) {
    if (segment.type === 'tab') {
      general.push(segment.tab);
      continue;
    }
    if (segment.group.archived) continue;
    const entry = { group: segment.group, tabs: segment.tabs };
    if (segment.group.pinned) pinned.push(entry);
    else projects.push(entry);
  }

  return { general, pinned, projects };
}

// Toast wording per hook notification. Working never toasts (it is a silent,
// in-progress state, surfaced only as the sidebar spinner), so it maps to the empty
// string; the caller treats that as "no toast".
export function toastMessage(type: TabNotification): string {
  switch (type) {
    case 'attention': return 'Needs permission';
    case 'done': return 'Done';
    case 'background': return 'Background tasks running';
    case 'compacting': return 'Compacting context';
    case 'working': return '';
  }
}

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
import { CLAUDE_TITLE_GLYPH, HOOK_TITLE_GLYPH, claudeSummaryTitle } from './chatTitle.ts';
import { modelDisplayName } from '../claude-transcript.ts';

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

// A generic braille spinner glyph some other terminal spinner library might
// still prepend, distinct from the hook and Claude Code's own glyphs below.
const BRAILLE_SPINNER_GLYPH = /^[\u2800-\u28FF]\s*/u;

// Strips one leading glyph, whichever family wrote it: the hook's state glyph
// ("▶ project - working"), Claude Code's own summary/spinner glyph ("✳ Fix the
// spinner"), or a braille spinner glyph. Both real glyph families are defined
// once in chatTitle.ts (the one place that knows Claude's own glyphs), this
// just composes them. Once state moves into the row's icon, any of these in the
// text would double up with it. Anything else about the title, including plain
// paths like "C:\", is left untouched. A title that becomes empty after
// stripping (or was already empty) falls back to "Terminal", the same default a
// tab with no title shows today.
export function displayTitle(title: string): string {
  const stripped = title
    .replace(HOOK_TITLE_GLYPH, '')
    .replace(CLAUDE_TITLE_GLYPH, '')
    .replace(BRAILLE_SPINNER_GLYPH, '');
  return stripped.length > 0 ? stripped : 'Terminal';
}

// The name shown for a thread: the row title, header line 1, cards and toast
// headlines. A chat's name is its Claude Code conversation, not whatever the OS
// title channel happens to hold right now: the notify hook overwrites the same
// title with its own state text while Claude works ("▶ afterterm - working"),
// and a restored chat's shell can briefly show a plain title like "cmd.exe"
// before Claude sets one again. Neither of those is the thread's name, so a
// chat only falls back to the live title (via displayTitle) once nothing
// better has ever been captured for it. A shell has no conversation to name
// itself after, so it always reads the live title.
export function threadName(tab: Pick<Tab, 'title' | 'claudeSessionId' | 'claudeTitle' | 'firstPrompt'>): string {
  if (tab.claudeSessionId) {
    if (tab.claudeTitle) return tab.claudeTitle;
    const summary = claudeSummaryTitle(tab.title);
    if (summary) return summary;
    if (tab.firstPrompt) return tab.firstPrompt;
    return displayTitle(tab.title);
  }
  return displayTitle(tab.title);
}

// The model shown on header line 2 for a chat thread ("Opus 5", "Opus 5 · 1M"),
// or null when there is nothing to show (no model captured yet, or a shell).
// modelDisplayName lives in claude-transcript.ts, the module that reads the
// session transcript in main; this is just the null-safe wrapper the renderer
// calls with whatever main last put on the tab.
export function modelLabel(model: string | undefined): string | null {
  if (!model) return null;
  return modelDisplayName(model);
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

// Which screen the app opens on once the session has loaded. Always Home, decided
// by Aryan on 2026-09-07: Home is the launcher and the first thing to see, even on
// a fresh install with no project yet (the board then shows the empty Pinned hint
// and the + to create one). The parameter stays so a later rule can look at the
// session without changing the call site.
export function initialScreen(_groups: Pick<Group, 'id'>[]): 'home' | 'workspace' {
  return 'home';
}

// Which thread stays active after a project is archived. An archived project keeps
// its threads running but takes them out of the sidebar, so leaving the active
// thread inside one would leave a terminal on screen that the user can no longer
// navigate back to. The first thread outside every archived project takes over; if
// there is none, the active thread is left as it is (nothing better to switch to).
export function nextActiveTabAfterArchive(
  tabs: Pick<Tab, 'id' | 'groupId'>[],
  activeTabId: string,
  archivedGroupIds: string[],
): string {
  const archived = new Set(archivedGroupIds);
  const hidden = (tab: Pick<Tab, 'groupId'>) => !!tab.groupId && archived.has(tab.groupId);
  const active = tabs.find(t => t.id === activeTabId);
  if (!active || !hidden(active)) return activeTabId;
  const fallback = tabs.find(t => !hidden(t));
  return fallback ? fallback.id : activeTabId;
}

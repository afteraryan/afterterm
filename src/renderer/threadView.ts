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
import { CLAUDE_TITLE_GLYPH, HOOK_TITLE_GLYPH, claudeSummaryTitle } from './chatTitle.ts';
import { modelDisplayName } from '../claude-transcript.ts';
import { countStates } from './attention.ts';

export type ThreadKind = 'chat' | 'shell';

export type ThreadState =
  | 'unread'
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
// shell for the purpose of the row icon: a server does not get its own icon, only
// its own word (kindWord, below) and its own state (running, via threadState).
export function threadKind(tab: Pick<Tab, 'claudeSessionId'>): ThreadKind {
  return tab.claudeSessionId ? 'chat' : 'shell';
}

// The folder a thread is actually working in: the hook-reported claudeCwd for a
// chat (Claude usually runs where the work is, which for this project is often a
// git worktree, while the shell that launched it still sits in the main
// checkout), the shell's own cwd otherwise, undefined when neither was ever
// captured. It is what the branch and worktree are read from (threadGitCwd in
// useTabState.ts) and, since Phase 9, what "Open in File Explorer" on a thread
// opens: the worktree for a worktree chat, not the project root.
export function threadFolder(tab: Pick<Tab, 'cwd' | 'claudeCwd'>): string | undefined {
  return tab.claudeCwd ?? tab.cwd;
}

// Where a new thread goes in the tab list (addTab, and a thread resumed from
// history). In a project it goes first, before the project's first thread, so
// the newest threads are the ones the sidebar's five-row fold shows and the old
// ones are pushed behind "Show more" (Aryan, 2026-09-21: new threads were landing
// at the bottom, behind the fold). A project's threads stay contiguous. A
// project with no threads yet, or a thread with no project (General), goes at
// the end as before.
export function insertNewThread<T extends Pick<Tab, 'groupId'>>(tabs: T[], tab: T): T[] {
  if (!tab.groupId) return [...tabs, tab];
  const firstIdx = tabs.findIndex(t => t.groupId === tab.groupId);
  if (firstIdx === -1) return [...tabs, tab];
  const next = [...tabs];
  next.splice(firstIdx, 0, tab);
  return next;
}

// What a thread's own Open in File Explorer and Open in <editor> act on (the
// thread menu, the header's editor button): threadFolder, and whether main has
// checked it and found it gone. Only an explicit false in `folderExists` counts
// as missing, so a folder not checked yet never starts out disabled. Undefined
// when the thread has no folder at all, and then neither control is offered.
export function threadFolderTarget(
  tab: Pick<Tab, 'cwd' | 'claudeCwd'>,
  folderExists: Record<string, boolean>,
): { folder: string; missing: boolean } | undefined {
  const folder = threadFolder(tab);
  if (!folder) return undefined;
  return { folder, missing: folderExists[folder] === false };
}

// The word for a thread's kind, shown in the asleep pane ("Server asleep since
// 2d ago") and anywhere else that needs "Chat"/"Server"/"Shell" rather than the
// icon. Distinct from threadKind/ThreadKind, which stay chat/shell for the row
// icon: a server's icon does not change, only its words and its state do.
export function kindWord(tab: Pick<Tab, 'claudeSessionId' | 'port'>): 'Chat' | 'Server' | 'Shell' {
  if (tab.claudeSessionId) return 'Chat';
  if (tab.port !== undefined) return 'Server';
  return 'Shell';
}

// Precedence (design-03 "The attention model, stated once"): unread, asleep,
// needs-you, working, done, compacting, background, running, quiet. Unread
// wins over everything, asleep included: a chat the user marked stays marked
// even with no process running, so it still shows the bell on its dimmed row
// rather than reading as a plain "Asleep · 2d". Asleep wins over what remains,
// since a thread with no process has no notification worth showing beyond
// that. Otherwise today's notification maps one for one onto a state, and a
// notification wins over running: it asks something of the user (a permission, a
// look at what finished) and running does not. Only once neither applies does a
// captured port make the thread 'running' (Phase 5); with no port at all it is
// 'quiet'.
export function threadState(tab: Pick<Tab, 'asleep' | 'notification' | 'port' | 'unread'>): ThreadState {
  if (tab.unread) return 'unread';
  if (tab.asleep) return 'asleep';
  switch (tab.notification) {
    case 'attention': return 'needs-you';
    case 'working': return 'working';
    case 'done': return 'done';
    case 'compacting': return 'compacting';
    case 'background': return 'background';
    default: return tab.port !== undefined ? 'running' : 'quiet';
  }
}

// Words for the header chip and the row's hover title. Quiet has no chip, so it is
// the empty string, not a placeholder word.
export function stateLabel(state: ThreadState): string {
  switch (state) {
    case 'unread': return 'Unread';
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

// Needs-you, unread and done breathe (a slow row-background cycle) until the
// thread is viewed or the mark is cleared. Every other state, including
// working and running, holds steady.
export function stateBreathes(state: ThreadState): boolean {
  return state === 'needs-you' || state === 'unread' || state === 'done';
}

// The header chip and hover-card wording for a running server ("Running on
// :5173"). stateLabel('running') still returns the bare "Running" for places
// with no port to hand it (a state list with no thread context); this is the
// richer wording used wherever the port is known.
export function runningLabel(port: number): string {
  return `Running on :${port}`;
}

// The hover card's Status row (Aryan, 2026-09-25): the state word the sidebar
// row's icon stands for, "Running on :5173" for a server, and no sleep age,
// since the card's Last used row already says how long ago. Undefined when the
// thread is quiet, so the row is left out just as the header chip is.
export function statusText(tab: Pick<Tab, 'asleep' | 'notification' | 'port' | 'unread'>): string | undefined {
  const state = threadState(tab);
  if (state === 'quiet') return undefined;
  if (state === 'running' && tab.port !== undefined) return runningLabel(tab.port);
  return stateLabel(state);
}

// The bare "localhost:5173" URL and menu label for "Open localhost:port".
export function localhostUrl(port: number): string {
  return `http://localhost:${port}`;
}

export function openLocalhostLabel(port: number): string {
  return `Open localhost:${port}`;
}

// A running server's process is worth confirming before it is torn down: an
// asleep server has no process to lose, so only an awake one with a captured
// port needs the confirm. Sleep tears down the same process tree a close does,
// so it needs the exact same confirm rule; the two are kept as one function so
// a future change to the rule cannot drift between them.
export function needsCloseConfirm(tab: Pick<Tab, 'asleep' | 'port'>): boolean {
  return !tab.asleep && tab.port !== undefined;
}

// Sleep is not different from Close here: both kill the process tree, so both
// need the confirm exactly when the thread is awake with a captured port.
export function needsSleepConfirm(tab: Pick<Tab, 'asleep' | 'port'>): boolean {
  return needsCloseConfirm(tab);
}

// The close-confirm dialog's text for a running server. Headings are plain and
// literal, per house style: the title states exactly what closing does, not a
// teaser.
export function closeConfirmText(port: number): { title: string; body: string; confirm: string; cancel: string } {
  return {
    title: `Close the server on :${port}?`,
    body: `This thread is listening on :${port}. Closing it stops the server.`,
    confirm: 'Close thread',
    cancel: 'Cancel',
  };
}

// The sleep-confirm dialog's text for a running server. Sleeping still stops
// the process, so the body says so plainly; it differs from the close body
// only in naming what Wake does next, since that is the one thing sleeping
// promises that closing does not. A captured lastCommand means Wake re-runs
// that exact command; with none, Wake just opens a fresh prompt in the same
// folder.
export function sleepConfirmText(
  port: number,
  lastCommand?: string,
): { title: string; body: string; confirm: string; cancel: string } {
  const wake = lastCommand && lastCommand.trim().length > 0
    ? `Wake runs ${lastCommand} again.`
    : 'Wake opens a fresh prompt.';
  return {
    title: `Sleep the server on :${port}?`,
    body: `This thread is listening on :${port}. Sleeping it stops the server; ${wake}`,
    confirm: 'Sleep thread',
    cancel: 'Cancel',
  };
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
// better has ever been captured for it. A shell keeps that chain unchanged,
// except for a server: a shell running a server has no conversation to name
// itself after, and its live title is the shell's own, not the server's ("npm
// start" or "cmd.exe - node server.js") - the command is what identifies the
// server, so a shell with a captured port and a non-empty lastCommand is named
// by that command instead. Whether the thread is asleep or awake makes no
// difference, since the port persists through sleep and is itself what marks
// the shell as a server. Decided by Aryan on 2026-09-07.
export function threadName(
  tab: Pick<Tab, 'title' | 'claudeSessionId' | 'claudeTitle' | 'firstPrompt' | 'port' | 'lastCommand'>,
): string {
  if (tab.claudeSessionId) {
    if (tab.claudeTitle) return tab.claudeTitle;
    const summary = claudeSummaryTitle(tab.title);
    if (summary) return summary;
    if (tab.firstPrompt) return tab.firstPrompt;
    return displayTitle(tab.title);
  }
  if (tab.port !== undefined && tab.lastCommand && tab.lastCommand.trim().length > 0) {
    return tab.lastCommand;
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
// expanded it"). Since the Phase 7 handoff, the same is true of a thread waiting for
// you: `isWaiting`, when given, is checked against every hidden row (index >= limit),
// and any match forces the list open too, so a permission prompt or an unread chat
// can never sit invisible behind "Show N more". Callers pass
// `t => isWaitingState(threadState(t))` (attention.ts's own definition of
// "waiting for you", kept in one place). Omitting `isWaiting` keeps the old
// active-only behaviour, unchanged.
export function foldThreads<T extends { id: string }>(
  threads: T[],
  activeId: string,
  expanded: boolean,
  limit = 5,
  isWaiting?: (t: T) => boolean,
): { shown: T[]; hiddenCount: number; showMore: boolean; forcedOpen: boolean } {
  const activeIndex = threads.findIndex(t => t.id === activeId);
  const activeForcesOpen = activeIndex >= limit;
  const waitingForcesOpen = !!isWaiting && threads.slice(limit).some(isWaiting);
  const forcedOpen = activeForcesOpen || waitingForcesOpen;
  const open = expanded || forcedOpen;
  const shown = open ? threads : threads.slice(0, limit);
  const hiddenCount = open ? 0 : Math.max(0, threads.length - limit);
  const showMore = threads.length > limit;
  return { shown, hiddenCount, showMore, forcedOpen };
}

// Counter pills for a project row: how many of its threads need you (needs-you
// plus unread, "waiting for you" everywhere in the UI), and how many are
// actively doing something (working or running). Both zero means the caller
// renders no pills at all; this function just reports the counts, the "no
// pills" choice is the caller's. Built on attention.ts's countStates, the one
// aggregate every count in the app reads from, so this can never disagree with
// the rail or Home's totals. The play pill deliberately does not count
// compacting (design-03's Phase 7 handoff): a compacting chat gets its own
// state and its own rail badge, but is not "actively doing something" for the
// purpose of this pill, only the rail separates it out.
// A project's pills show what its thread rows show (Aryan, 2026-09-25): the
// spinner for threads Claude is working in, the hourglass for threads whose
// turn ended with background tasks still running, the green play for threads
// running a server. Working and servers used to be added together under the
// play, and background under the spinner, so a finished turn read as a busy one.
export function projectCounts(states: ThreadState[]): ProjectPillCounts {
  return pillCounts(countStates(states));
}

export interface ProjectPillCounts {
  needsYou: number;
  working: number;
  background: number;
  running: number;
  compacting: number;
}

export function pillCounts(counts: ReturnType<typeof countStates>): ProjectPillCounts {
  return {
    needsYou: counts.waiting,
    working: counts.working,
    background: counts.background,
    running: counts.running,
    compacting: counts.compacting,
  };
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

// A toast is drawn in the overlay window from values sent when it was pushed,
// so a project edited while its toast is on screen would keep the old name,
// colour and icon (Aryan, 2026-09-21). The main window compares its projects on
// every change and sends the overlay the look of each one that changed;
// projectLookChanges finds them. A project new in `next` (a create, the session
// restore) is not a change: no toast can show it yet.
export interface ProjectLook {
  projectId: string;
  label: string;
  color: Group['color'];
  icon?: Group['icon'];
}

export function projectLookChanges(prev: Group[], next: Group[]): ProjectLook[] {
  const before = new Map(prev.map(g => [g.id, g]));
  const changes: ProjectLook[] = [];
  for (const g of next) {
    const old = before.get(g.id);
    if (!old) continue;
    if (old.label !== g.label || old.color !== g.color || old.icon !== g.icon) {
      changes.push({ projectId: g.id, label: g.label, color: g.color, icon: g.icon });
    }
  }
  return changes;
}

// The overlay's side: every toast from that project takes the new name,
// colour (already resolved to the drawn colour) and icon; the rest are left as
// they are, and the same array comes back when nothing matched.
export function applyProjectLook<T extends { projectId?: string; secondaryLabel?: string; projectColor?: string; projectIcon?: string }>(
  toasts: T[],
  look: { projectId: string; label: string; color: string; icon?: string },
): T[] {
  if (!toasts.some(t => t.projectId === look.projectId)) return toasts;
  return toasts.map(t => t.projectId === look.projectId
    ? { ...t, secondaryLabel: look.label, projectColor: look.color, projectIcon: look.icon }
    : t);
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

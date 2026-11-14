// Loops in the renderer (design-07): pure helpers shared by Home's Progress column
// and the workspace card. No DOM, no React.

import type { Group, HistoryEntry, Tab } from './components/TabBar/types';
import type { LoopsContext } from '../loops-cli';
import { loopStatus, orderedTopLoops, type Loop, type LoopLabel, type LoopStatus } from '../loops';
import { groupColors } from './projectColour';

// What main needs to know for `afterterm loops`: each project's name and folder,
// each thread's project, Claude session and folder. Sent whenever it changes.
export function loopsContextFrom(tabs: readonly Tab[], groups: readonly Group[]): LoopsContext {
  return {
    projects: groups.map((g) => ({ id: g.id, name: g.label, folder: g.cwd || undefined })),
    threads: tabs.map((t) => ({
      id: t.id,
      project: t.groupId ?? null,
      sessionId: t.claudeSessionId || undefined,
      cwd: t.claudeCwd || t.cwd || undefined,
    })),
  };
}

// A loop row's project name and colour. General (no project, or a project that
// was deleted) is grey.
export const GENERAL_COLOUR = '#8e8e8e';
export function projectLook(projectId: string | null, groups: readonly Group[]): { name: string; color: string } {
  const g = projectId ? groups.find((x) => x.id === projectId) : undefined;
  if (!g) return { name: 'General', color: GENERAL_COLOUR };
  return { name: g.label, color: groupColors(g.color).text };
}

export const LABEL_WORDS: Record<LoopLabel, string> = { feature: 'Feature', bug: 'Bug', idea: 'Idea' };

// ---------- the filter on Home ----------

export type StatusFilter = 'all' | LoopStatus | 'archived';
export interface LoopFilter {
  status: StatusFilter;
  label: LoopLabel | null;
  project: string | null | undefined; // undefined: every project; null: General
}
export const NO_FILTER: LoopFilter = { status: 'all', label: null, project: undefined };

export function filterIsSet(f: LoopFilter): boolean {
  return f.status !== 'all' || f.label !== null || f.project !== undefined;
}

// The top-level loops the list shows for a filter, most recent first. Archived
// loops show only under the Archived filter; every other filter leaves them out.
export function visibleLoops(all: readonly Loop[], f: LoopFilter, now: number): Loop[] {
  const base = f.status === 'archived'
    ? all.filter((l) => !l.parent && l.archivedAt && !l.deletedAt).sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0))
    : orderedTopLoops(all);
  return base.filter((l) => {
    if (f.status !== 'all' && f.status !== 'archived' && loopStatus(l, all, now) !== f.status) return false;
    if (f.label && l.label !== f.label) return false;
    if (f.project !== undefined && l.project !== f.project) return false;
    return true;
  });
}

// Projects that have loops, for the Project dropdown: General last.
export function loopProjects(all: readonly Loop[], groups: readonly Group[]): { id: string | null; name: string; color: string }[] {
  const ids = new Set(all.filter((l) => !l.parent && !l.deletedAt).map((l) => l.project));
  const out = groups.filter((g) => ids.has(g.id)).map((g) => ({ id: g.id as string | null, ...projectLook(g.id, groups) }));
  if (ids.has(null) || [...ids].some((id) => id && !groups.some((g) => g.id === id))) out.push({ id: null, ...projectLook(null, groups) });
  return out;
}

// ---------- Open chat ----------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// What "Open chat" does for a loop's remembered chat (design-07), in order:
//  - its thread is open (by thread id, or any thread on the same Claude session):
//    show it, waking it when asleep;
//  - it was closed into a project's history: resume it from there;
//  - neither, but the session id is known: open a new chat thread in the loop's
//    project that resumes that session, in the folder the chat was in;
//  - no session at all (a loop Aryan started by hand, or a chat that never sent a
//    message): nothing to open.
export type OpenChatPlan =
  | { kind: 'tab'; tabId: string; wake: boolean }
  | { kind: 'history'; groupId: string; entryId: string }
  | { kind: 'resume'; groupId: string | null; entry: HistoryEntry }
  | { kind: 'none' };

export function openChatPlan(loop: Loop, tabs: readonly Tab[], groups: readonly Group[], loopTitle?: string): OpenChatPlan {
  const chat = loop.chat;
  if (!chat) return { kind: 'none' };
  const session = chat.sessionId && UUID_RE.test(chat.sessionId) ? chat.sessionId : undefined;
  const byThread = chat.threadId ? tabs.find((t) => t.id === chat.threadId) : undefined;
  // A thread id is reused only by Resume (same chat). A thread now on another
  // session is a different chat, so the session wins when both are known.
  const tab = (byThread && (!session || !byThread.claudeSessionId || byThread.claudeSessionId === session) ? byThread : undefined)
    ?? (session ? tabs.find((t) => t.claudeSessionId === session) : undefined);
  if (tab) return { kind: 'tab', tabId: tab.id, wake: tab.asleep };
  for (const g of groups) {
    const e = g.history.find((h) => (session && h.sessionId === session) || (!session && chat.threadId && h.id === chat.threadId));
    if (e) return { kind: 'history', groupId: g.id, entryId: e.id };
  }
  if (!session) return { kind: 'none' };
  const groupId = loop.project && groups.some((g) => g.id === loop.project) ? loop.project : null;
  const entry: HistoryEntry = {
    id: '',
    title: loopTitle ?? loop.title,
    kind: 'chat',
    closedAt: 0,
    sessionId: session,
  };
  if (chat.cwd) entry.cwd = chat.cwd;
  return { kind: 'resume', groupId, entry };
}

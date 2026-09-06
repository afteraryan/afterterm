// session.json shape, migration and serialization. Pure module: no React, no
// Electron, importable from plain Node so the migration can be unit-tested
// without the app (node src/renderer/sessionMigration.test.ts).
//
// Why a migration exists at all: release 0.8.1 wrote session.json without any
// version field, and without the fields the projects-and-threads redesign needs
// (pinned, archived, lastActiveAt, asleep). A user upgrading must get every one
// of those filled with a sane default, and the file we write back must still open
// in 0.8.1 (it ignores keys it does not know), so the top-level shape and every
// 0.8.1 key keep their name and meaning.

import type { Tab, Group } from './components/TabBar/types';

// Bump when a saved file needs a shape change a plain "fill defaults" pass cannot
// express. A file with no version field is treated as version 1 (release 0.8.1).
export const SESSION_FORMAT_VERSION = 2;

// A tab as written to disk: the in-memory Tab minus the fields that describe a
// live process, which are meaningless after a relaunch (each tab is a fresh shell).
export type SavedTab = Omit<Tab, 'notification' | 'claudeRestorable'>;

export interface SavedSession {
  version?: number;
  tabs: SavedTab[];
  groups: Group[];
  activeTabId: string;
}

// The only tab keys that ever reach disk. Anything else on a Tab is transient.
const PERSISTED_TAB_KEYS = [
  'id', 'title', 'groupId', 'shellId', 'cwd', 'fontSize',
  'claudeSessionId', 'claudeCwd', 'lastActiveAt', 'asleep',
] as const;

// Fields that describe a running process, never a saved one. Stripped on load in
// case a build ever wrote them by mistake.
const TRANSIENT_TAB_KEYS = ['notification', 'claudeRestorable'] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Wrongly typed flags fall back to the default rather than being truthiness
// coerced, so a stray string like "false" can never flip a project to pinned.
function asFlag(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function asTimestamp(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

// Entries without a usable id cannot be addressed by anything (activation,
// grouping, restore), so they are dropped rather than repaired.
function hasStringId(v: unknown): v is Record<string, unknown> & { id: string } {
  return isRecord(v) && typeof v.id === 'string' && v.id.length > 0;
}

/**
 * Turn whatever session.load() returned into a SavedSession the app can restore,
 * or null when the input is not a session at all (the caller then starts fresh).
 * Unknown extra keys are kept: a newer build may have written them and an older
 * build must not destroy them just by loading the file. Idempotent: migrating an
 * already migrated session changes nothing.
 */
export function migrateSession(raw: unknown, now: number): SavedSession | null {
  if (!isRecord(raw) || !Array.isArray(raw.tabs)) return null;

  const tabs: SavedTab[] = raw.tabs.filter(hasStringId).map(t => {
    const tab: Record<string, unknown> = { ...t };
    for (const key of TRANSIENT_TAB_KEYS) delete tab[key];
    tab.lastActiveAt = asTimestamp(t.lastActiveAt, now);
    tab.asleep = asFlag(t.asleep, false);
    return tab as unknown as SavedTab;
  });

  const rawGroups = Array.isArray(raw.groups) ? raw.groups : [];
  const groups: Group[] = rawGroups.filter(hasStringId).map(g => {
    const group: Record<string, unknown> = { ...g };
    group.collapsed = asFlag(g.collapsed, false);
    group.pinned = asFlag(g.pinned, false);
    group.archived = asFlag(g.archived, false);
    group.lastActiveAt = asTimestamp(g.lastActiveAt, now);
    return group as unknown as Group;
  });

  // An active id that points at nothing (dropped entry, hand edit) is as good as
  // none: restoreSession then falls back to the first tab instead of a blank view.
  const activeTabId = typeof raw.activeTabId === 'string' && tabs.some(t => t.id === raw.activeTabId)
    ? raw.activeTabId
    : '';

  return { version: SESSION_FORMAT_VERSION, tabs, groups, activeTabId };
}

/**
 * Exactly what gets written to session.json. Tabs are reduced to their persisted
 * keys; groups carry no transient state and are written whole.
 */
export function serializeSession(tabs: Tab[], groups: Group[], activeTabId: string): SavedSession {
  return {
    version: SESSION_FORMAT_VERSION,
    tabs: tabs.map(t => {
      const saved: Record<string, unknown> = {};
      for (const key of PERSISTED_TAB_KEYS) saved[key] = t[key];
      return saved as unknown as SavedTab;
    }),
    groups: groups.map(g => ({ ...g })),
    activeTabId,
  };
}

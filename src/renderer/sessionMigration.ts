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

import type { Tab, Group, HistoryEntry } from './components/TabBar/types';

// Bump when a saved file needs a shape change a plain "fill defaults" pass cannot
// express. A file with no version field is treated as version 1 (release 0.8.1).
// Phase 4 (sleptAt, history) and Phase 5 (port, lastCommand) are still
// fill-defaults passes, same as Phase 2 and 3 before them, so the version
// stays 2.
export const SESSION_FORMAT_VERSION = 2;

// A tab as written to disk: the in-memory Tab minus the fields that describe a
// live process, which are meaningless after a relaunch (each tab is a fresh shell).
export type SavedTab = Omit<Tab, 'notification' | 'firstPrompt' | 'wokeAt'>;

export interface SavedSession {
  version?: number;
  tabs: SavedTab[];
  groups: Group[];
  activeTabId: string;
}

// The only tab keys that ever reach disk. Anything else on a Tab is transient.
const PERSISTED_TAB_KEYS = [
  'id', 'title', 'groupId', 'shellId', 'cwd', 'fontSize',
  'claudeSessionId', 'claudeCwd', 'lastActiveAt', 'asleep', 'sleptAt',
  'model', 'branch', 'worktree', 'claudeTitle', 'port', 'lastCommand',
] as const;

// Fields that describe a running process or a value re-derived on every launch,
// never a saved one. Stripped on load in case a build ever wrote them by
// mistake. firstPrompt is re-read from the transcript, so a stale saved copy
// would only go out of date. claudeTitle is deliberately NOT here: every restored
// shell overwrites the raw title with its own ("cmd.exe") within seconds of a
// launch, so the raw title cannot carry a chat's name across a relaunch; the
// captured Claude title is saved on its own (see PERSISTED_TAB_KEYS).
// claudeRestorable is no longer a field on Tab (Phase 4 replaced it with
// asleep/sleptAt), but it stays in this list: an old file that somehow still
// carries it (a stray write from a pre-Phase-4 build) must still be stripped on
// load rather than kept around as dead data. wokeAt is Phase 4's own transient
// field, alongside it for the same reason as notification and firstPrompt.
const TRANSIENT_TAB_KEYS = ['notification', 'claudeRestorable', 'firstPrompt', 'wokeAt'] as const;

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

// model, branch and worktree are all optional strings with no default: a file
// that never had them should load with them absent, not with a made-up value.
// A wrongly typed value (a number, an object) is dropped the same way, rather
// than coerced, so a stray field from a future build cannot leak through as a
// display string.
function setOptionalString(tab: Record<string, unknown>, key: string, v: unknown): void {
  if (typeof v === 'string') tab[key] = v;
  else delete tab[key];
}

// sleptAt is optional the same way: present only while a thread is asleep, and a
// wrongly typed value (a string like "yesterday", Infinity, NaN) is dropped
// rather than coerced, so a corrupt or hand-edited file can never produce a
// bogus "Asleep · NaNd" chip.
function setOptionalNumber(tab: Record<string, unknown>, key: string, v: unknown): void {
  if (typeof v === 'number' && Number.isFinite(v)) tab[key] = v;
  else delete tab[key];
}

// port is optional and constrained to what a real TCP port can be: an integer
// from 1 to 65535. Anything else, a string, a float, 0, a negative number, a
// number above 65535, is dropped rather than clamped or coerced, so a corrupt
// or hand-edited file can never mark a thread as a server it isn't (a
// stray/bogus port would make the sidebar and header claim it is running and
// offer to open a dead localhost URL).
function setOptionalPort(tab: Record<string, unknown>, key: string, v: unknown): void {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 65535) tab[key] = v;
  else delete tab[key];
}

// Entries without a usable id cannot be addressed by anything (activation,
// grouping, restore), so they are dropped rather than repaired.
function hasStringId(v: unknown): v is Record<string, unknown> & { id: string } {
  return isRecord(v) && typeof v.id === 'string' && v.id.length > 0;
}

// A single history entry, validated field by field. An entry that fails any
// check is dropped outright rather than partially repaired: a history row with
// a missing id can never be resumed (tabFromHistory has nothing to name the new
// tab), so a half-valid entry is as useless as no entry. Order is left exactly
// as stored; history.ts, not this migration, owns "newest first".
function asHistoryEntry(v: unknown): HistoryEntry | null {
  if (!isRecord(v)) return null;
  if (typeof v.id !== 'string' || v.id.length === 0) return null;
  if (typeof v.title !== 'string') return null;
  if (v.kind !== 'chat' && v.kind !== 'shell') return null;
  if (typeof v.closedAt !== 'number' || !Number.isFinite(v.closedAt)) return null;
  const entry: HistoryEntry = { id: v.id, title: v.title, kind: v.kind, closedAt: v.closedAt };
  if (typeof v.sessionId === 'string') entry.sessionId = v.sessionId;
  if (typeof v.cwd === 'string') entry.cwd = v.cwd;
  return entry;
}

// A missing or wrongly typed history is an empty list, the same "drop rather
// than coerce" rule as every other field here: a string or an object where an
// array was expected carries no entries worth trying to recover one at a time.
function asHistory(v: unknown): HistoryEntry[] {
  if (!Array.isArray(v)) return [];
  return v.map(asHistoryEntry).filter((e): e is HistoryEntry => e !== null);
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
    setOptionalNumber(tab, 'sleptAt', t.sleptAt);
    setOptionalString(tab, 'model', t.model);
    setOptionalString(tab, 'branch', t.branch);
    setOptionalString(tab, 'worktree', t.worktree);
    setOptionalString(tab, 'claudeTitle', t.claudeTitle);
    setOptionalPort(tab, 'port', t.port);
    setOptionalString(tab, 'lastCommand', t.lastCommand);
    return tab as unknown as SavedTab;
  });

  const rawGroups = Array.isArray(raw.groups) ? raw.groups : [];
  const groups: Group[] = rawGroups.filter(hasStringId).map(g => {
    const group: Record<string, unknown> = { ...g };
    group.collapsed = asFlag(g.collapsed, false);
    group.pinned = asFlag(g.pinned, false);
    group.archived = asFlag(g.archived, false);
    group.lastActiveAt = asTimestamp(g.lastActiveAt, now);
    group.history = asHistory(g.history);
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
    // history defensively defaults to [] here too: migration guarantees every
    // Group in state has one, but a caller could in principle hand this function
    // a Group built by hand (a test, a future code path) that skipped it, and an
    // absent array would write "history" missing rather than empty, which
    // history.ts and the project page's History tab are not built to expect.
    groups: groups.map(g => ({ ...g, history: g.history ?? [] })),
    activeTabId,
  };
}

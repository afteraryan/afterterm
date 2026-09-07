// Pure rules for putting a thread to sleep and waking it back up: what changes
// on the Tab record, the chip wording, and what a wake respawn needs to know
// (cwd, shell, whether to resume a Claude session). None of this touches the
// PTY itself, React or the DOM: the terminal and main-process layers call these
// functions and act on what they return. Importable from plain Node so the
// unit tests can run with `node src/renderer/sleepWake.test.ts`.
//
// Why sleep is a data transform and not a process action here: killing the PTY
// tree lives in main, but deciding what the Tab record should look like
// afterwards (asleep, sleptAt, notification cleared) is the same decision on
// every call site (menu action, close-to-sleep, shutdown flush), so it is made
// once, here, and unit tested without spawning anything.

import type { Tab } from './components/TabBar/types.ts';
import type { SavedTab } from './sessionMigration.ts';
import { relativeTime } from './homeView.ts';

// Same pattern Terminal/index.tsx uses before typing a session id into a shell:
// session.json is hand-editable, so a resume is only attempted when the id is
// a canonical UUID, never run as-is.
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// What sleeping does to a Tab: its process is gone, so asleep flips on and
// sleptAt records when, notification is cleared (a sleeping thread has nothing
// to notify about), and wokeAt is cleared (a thread that was woken and then put
// back to sleep should not still carry a stale "replay the tail" flag).
// Everything else, session id, cwd, claudeTitle, model, branch, worktree,
// fontSize, is left exactly as it was: sleep records a process going away, not
// a thread losing its identity.
export function sleepTab(tab: Tab, now: number): Tab {
  const next: Tab = { ...tab, asleep: true, sleptAt: now };
  delete next.notification;
  delete next.wokeAt;
  return next;
}

// The reverse: the process is back, so asleep clears, sleptAt is gone (it only
// means something while asleep), wokeAt is stamped so the terminal layer knows
// to replay the saved tail above a "Woke just now" divider, and lastActiveAt
// moves to now since waking is itself an activation.
export function wakeTab(tab: Tab, now: number): Tab {
  const next: Tab = { ...tab, asleep: false, lastActiveAt: now, wokeAt: now };
  delete next.sleptAt;
  return next;
}

// What a tab from session.json becomes at launch. Every restored thread starts
// asleep, full stop: Phase 4 replaces the old "restorable" ✳ marker (a
// half-alive state that pretended a session could still be typed into) with
// asleep, which is honest about there being no process at all until the user
// wakes it. sleptAt prefers the saved value (a clean quit runs
// sleepAllForShutdown first, so it already carries the real sleep time); a file
// saved without one (a crash, an older build) falls back to lastActiveAt, the
// best guess of when the thread was last doing something. No notification
// survives a relaunch (nothing to notify about, the process is gone) and no
// wokeAt (a thread that has never run this launch has no tail to replay yet).
export function restoredTab(saved: SavedTab, now: number): Tab {
  const next: Tab = { ...(saved as Tab), asleep: true, sleptAt: saved.sleptAt ?? saved.lastActiveAt };
  delete next.notification;
  delete next.wokeAt;
  return next;
}

// Run on the quit flush so the saved file records when the app actually
// closed, not "now" the next time it happens to load. Every awake tab is put
// to sleep as of `now`; a tab that was already asleep keeps its original
// sleptAt untouched, since it did not just stop, it stopped whenever it
// stopped.
export function sleepAllForShutdown(tabs: Tab[], now: number): Tab[] {
  return tabs.map(t => (t.asleep ? t : sleepTab(t, now)));
}

// The chip text ("Asleep · 2d") shown on a sidebar row and the header. Under a
// minute, or with no sleptAt at all (a thread slept this instant, before the
// next render), it reads "just now" rather than "0m", the one point where this
// wording diverges from relativeTime's own "now". The separator is the middle
// dot (U+00B7) with a space on each side, matching the design mock.
export function asleepLabel(sleptAt: number | undefined, now: number): string {
  if (sleptAt === undefined || now - sleptAt < 60_000) return 'Asleep · just now';
  return `Asleep · ${relativeTime(sleptAt, now)}`;
}

// The line under the Wake button in the asleep pane: "Chat asleep since 2d
// ago" / "Shell asleep since just now" / "Server asleep since 2d ago · runs npm
// start". Distinct wording from asleepLabel (full sentence, "ago" instead of a
// bare unit) because the pane has room for a sentence and the chip does not.
// `kind` is the word threadView.kindWord already returns ('Chat' | 'Server' |
// 'Shell'), not the old chat/shell union: the caller has already decided
// whether this is a server, and repeating that decision here (from a port)
// would be a second copy of kindWord's rule. `lastCommand` only ever adds the
// " · runs <command>" suffix for a Server with a non-empty (trimmed) command;
// a Chat or Shell never shows it, and a Server with no captured command yet
// reads the same plain sentence as before Phase 5.
export function asleepSinceText(
  kind: 'Chat' | 'Server' | 'Shell',
  sleptAt: number | undefined,
  now: number,
  lastCommand?: string,
): string {
  const ago = sleptAt === undefined || now - sleptAt < 60_000 ? 'now' : relativeTime(sleptAt, now);
  const sentence = `${kind} asleep since ${ago === 'now' ? 'just now' : ago + ' ago'}`;
  const command = lastCommand?.trim();
  return kind === 'Server' && command ? `${sentence} · runs ${command}` : sentence;
}

// What waking respawns with. cwd prefers claudeCwd over cwd: a chat has to
// respawn in the exact folder Claude last ran in, because `claude --resume`
// resolves the session by cwd, not by id alone. resumeSessionId is only
// returned when it is a canonical UUID; an invalid or missing id means "start a
// fresh prompt", never "run resume with garbage".
//
// runCommand is the analogous check for a server: it gets typed into the fresh
// shell exactly the way a session id gets run through `claude --resume`, so it
// is validated the same defensive way before that ever happens. A thread only
// gets a runCommand when it has a captured port (it is a server) and its
// lastCommand, once trimmed, is non-empty, holds no control characters (no
// CR/LF that could inject a second line, no ESC that could smuggle an escape
// sequence into what looks like a plain command), and is at most 500
// characters. Anything else, no port, no command, a command that fails a
// check, yields null: the thread wakes as a plain shell in its folder instead
// (the Phase 4 behaviour, kept as the fallback). A server never resumes a
// chat, so resumeSessionId is always null here regardless of whatever a
// (malformed) tab might otherwise carry.
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/;
const RUN_COMMAND_MAX_LENGTH = 500;

export function wakePlan(
  tab: Pick<Tab, 'cwd' | 'claudeCwd' | 'claudeSessionId' | 'shellId' | 'port' | 'lastCommand'>,
): { cwd: string | undefined; shellId: string | undefined; resumeSessionId: string | null; runCommand: string | null } {
  const trimmed = tab.lastCommand?.trim();
  const runCommand =
    tab.port !== undefined
    && trimmed
    && trimmed.length > 0
    && trimmed.length <= RUN_COMMAND_MAX_LENGTH
    && !CONTROL_CHAR_RE.test(trimmed)
      ? trimmed
      : null;
  return {
    cwd: tab.claudeCwd ?? tab.cwd,
    shellId: tab.shellId,
    resumeSessionId: runCommand ? null : (tab.claudeSessionId && UUID_RE.test(tab.claudeSessionId) ? tab.claudeSessionId : null),
    runCommand,
  };
}

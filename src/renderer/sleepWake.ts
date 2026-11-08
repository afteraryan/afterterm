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
// back to sleep should not still carry a stale "woken this launch" stamp).
// recordStatus goes too: it is what a running Claude was doing, and a sleeping
// thread has no running Claude. So do atPrompt and hasChildren, what the shell
// was doing (plan-02, Fix 8): a woken thread starts from no prompt marks seen.
// And backgroundTasks (Fix 7): sleep kills the Claude and whatever it left running.
// Everything else, session id, cwd, claudeTitle, model, branch, worktree,
// fontSize, is left exactly as it was: sleep records a process going away, not
// a thread losing its identity.
export function sleepTab(tab: Tab, now: number): Tab {
  const next: Tab = { ...tab, asleep: true, sleptAt: now };
  delete next.notification;
  delete next.wokeAt;
  delete next.recordStatus;
  delete next.atPrompt;
  delete next.hasChildren;
  delete next.backgroundTasks;
  return next;
}

// The reverse: the process is back, so asleep clears, sleptAt is gone (it only
// means something while asleep), wokeAt is stamped (the thread was woken this
// launch; until Phase 9 the terminal layer also replayed the saved tail on this
// cue, which Aryan dropped on 2026-09-19), and lastActiveAt moves to now since
// waking is itself an activation.
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
// wokeAt (a thread that has never run this launch was not woken this launch).
export function restoredTab(saved: SavedTab, now: number): Tab {
  const next: Tab = { ...(saved as Tab), asleep: true, sleptAt: saved.sleptAt ?? saved.lastActiveAt };
  delete next.notification;
  delete next.wokeAt;
  return next;
}

// A thread whose shell main still holds when the window's page loads (AFT-33). That
// happens only when the page was reloaded or came back after a crash or a hang while
// the app itself kept running: on a launch main holds no shell at all. `port` is
// what main's server watcher last sent for it: a number while something in the
// shell's tree listens, null when nothing does, absent when it has not looked yet.
export interface LiveThread {
  tabId: string;
  port?: number | null;
}

// What a tab from session.json becomes when main still holds a live shell for it:
// awake, and the terminal layer re-attaches a fresh xterm to that shell instead of
// spawning one (main's pty:create answers `attached`). Nothing is typed into it, so a
// chat's Claude Code and a server keep running untouched. Its scrollback from before
// the reload is gone with the old page. sleptAt goes (the saved file stamps every
// thread asleep at the unload flush, sleepAllForShutdown, and this one never slept),
// and so do notification and wokeAt, as in restoredTab. The port is main's when it
// has one, since the server may have stopped or started while the page was away.
export function reattachedTab(saved: SavedTab, live: LiveThread): Tab {
  const next: Tab = { ...(saved as Tab), asleep: false };
  delete next.sleptAt;
  delete next.notification;
  delete next.wokeAt;
  if (typeof live.port === 'number') next.port = live.port;
  else if (live.port === null) delete next.port;
  return next;
}

// Every saved tab as it comes back: re-attached when main holds a live shell for it,
// asleep otherwise (restoredTab). A launch has no live shells, so everything is
// asleep, as it always was. A live shell no saved tab names is an orphan (a thread
// created in the moment before a crash, before the state reached main); the caller
// ends it, since nothing could ever show or reach it.
export function restoreWithLive(
  saved: SavedTab[],
  live: readonly LiveThread[],
  now: number,
): { tabs: Tab[]; reattached: string[]; orphans: string[] } {
  const byId = new Map(live.map(l => [l.tabId, l]));
  const reattached: string[] = [];
  const tabs = saved.map(t => {
    const l = byId.get(t.id);
    if (!l) return restoredTab(t, now);
    reattached.push(t.id);
    return reattachedTab(t, l);
  });
  const savedIds = new Set(saved.map(t => t.id));
  const orphans = live.filter(l => !savedIds.has(l.tabId)).map(l => l.tabId);
  return { tabs, reattached, orphans };
}

// The screen, project page and active thread the page last showed, kept by main in
// memory only (AFT-33), so it exists only when the page reloads inside one run of the
// app, never on a launch.
export interface RememberedUi {
  screen: 'home' | 'workspace' | 'project';
  projectId?: string;
  activeTabId?: string;
}

// Where a reloaded page opens: back on the screen it showed, with the same thread
// active. A project page whose project is gone opens Home, and an active thread that
// is gone is left out (the saved activeTabId stands). null when main remembers
// nothing, which is every launch: the caller opens Home as always (initialScreen).
export function screenAfterReload(
  ui: RememberedUi | null | undefined,
  groupIds: readonly string[],
  tabIds: readonly string[],
): { screen: 'home' | 'workspace' | 'project'; projectId?: string; activeTabId?: string } | null {
  if (!ui) return null;
  const activeTabId = ui.activeTabId && tabIds.includes(ui.activeTabId) ? ui.activeTabId : undefined;
  const withActive = activeTabId ? { activeTabId } : {};
  if (ui.screen === 'project') {
    if (ui.projectId && groupIds.includes(ui.projectId)) return { screen: 'project', projectId: ui.projectId, ...withActive };
    return { screen: 'home', ...withActive };
  }
  if (ui.screen === 'workspace' || ui.screen === 'home') return { screen: ui.screen, ...withActive };
  return null;
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
// reads the same plain sentence as before Phase 5. The asleep pane passes
// wakePlan's runCommand here, not the raw lastCommand, so the line names only a
// command Wake will really run (a last command that started Claude is not one).
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
// (the Phase 4 behaviour, kept as the fallback).
//
// A valid session id wins over the server rule (plan-02, Fix 9, Aryan's Decision 3
// of 2026-11-07: a thread that holds a session id stays a chat for good). Such a
// thread resumes its chat and never re-runs a command, so runCommand is null. The
// rule used to be the other way round, and a Claude that started a dev server
// itself, whose last command is `claude` and which has a port, woke by running a
// fresh `claude` instead of resuming. Only a thread with no valid id gets the port
// and command rule.
//
// A last command that starts Claude Code (startsClaudeCode) is never a server
// command, id or not. A port in such a thread's tree belongs to something Claude
// started, and typing `claude` again would start a fresh session, not bring a server
// back. With no valid id the thread wakes in its folder, which is what the restart
// window's row for it says.
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/;
const RUN_COMMAND_MAX_LENGTH = 500;
// The program a command line starts names Claude Code when its last path segment is
// `claude`, `claude.exe` or `claude.cmd`, or it is the npm package itself, with or
// without a version.
const CLAUDE_PROGRAM_RE = /^claude(\.exe|\.cmd)?$/i;
const CLAUDE_PACKAGE_RE = /^@anthropic-ai\/claude-code(@\S*)?$/i;

// The first word of a command line, with surrounding quotes taken off, and the rest.
function firstWord(line: string): { word: string; rest: string } {
  const quote = line[0];
  if (quote === '"' || quote === "'") {
    const end = line.indexOf(quote, 1);
    if (end > 0) return { word: line.slice(1, end), rest: line.slice(end + 1).trimStart() };
  }
  const m = /^(\S*)\s*([\s\S]*)$/.exec(line)!;
  return { word: m[1], rest: m[2] };
}

// Whether a command line starts Claude Code: `claude`, `claude.exe` or `claude.cmd`
// (any case), the same at the end of a quoted or unquoted path
// (`"C:\Users\me\.local\bin\claude.exe" --resume`), the package `@anthropic-ai/claude-code`,
// and any of those after `npx` and its flags (`npx claude`, `npx -y
// @anthropic-ai/claude-code`). A name that only begins with claude is not it
// (`claudette serve`, `npx claude-server`).
export function startsClaudeCode(command: string): boolean {
  let { word, rest } = firstWord(command.trim());
  if (/^npx(\.cmd)?$/i.test(word)) {
    do { ({ word, rest } = firstWord(rest)); } while (word.startsWith('-') && rest);
  }
  if (CLAUDE_PACKAGE_RE.test(word)) return true;
  const program = word.split(/[\\/]/).pop() ?? '';
  return CLAUDE_PROGRAM_RE.test(program);
}

export function wakePlan(
  tab: Pick<Tab, 'cwd' | 'claudeCwd' | 'claudeSessionId' | 'shellId' | 'port' | 'lastCommand'>,
): { cwd: string | undefined; shellId: string | undefined; resumeSessionId: string | null; runCommand: string | null } {
  const resumeSessionId = tab.claudeSessionId && UUID_RE.test(tab.claudeSessionId) ? tab.claudeSessionId : null;
  const trimmed = tab.lastCommand?.trim();
  const runCommand =
    !resumeSessionId
    && tab.port !== undefined
    && trimmed
    && trimmed.length > 0
    && trimmed.length <= RUN_COMMAND_MAX_LENGTH
    && !CONTROL_CHAR_RE.test(trimmed)
    && !startsClaudeCode(trimmed)
      ? trimmed
      : null;
  return {
    cwd: tab.claudeCwd ?? tab.cwd,
    shellId: tab.shellId,
    resumeSessionId,
    runCommand,
  };
}

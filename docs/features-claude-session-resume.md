# Claude Code session resume

A thread that was running a Claude Code session resumes it when you **wake** it:
afterterm relaunches the shell in the session's directory and runs
`claude --resume <sessionId>`, so the conversation comes back where you left it.

## Resume is user-initiated: nothing happens on launch any more

Every thread restored from `session.json` starts **asleep** (Phase 4, `restoredTab` in
`src/renderer/sleepWake.ts`): no PTY at all, just the record, until the user acts on it.
This replaces the earlier "lazy resume" scheme, where the active tab resumed
automatically on launch and only background tabs waited for a click. Phase 4 removes
that one automatic case too: a chat resumes only when its thread is woken (the asleep
pane's Wake button or the thread menu's Wake), or when a closed chat is brought back
through **Resume** on a project page's History tab or the search palette, both of which
recreate the tab and run `claude --resume` the same way a wake does. Nothing ever
resumes by itself, not even the tab you were looking at when the app closed.

This is deliberate and important, and the reason has not changed. Resuming every saved
session at once cold-starts N `claude` processes *plus their MCP servers*
simultaneously, and on a loaded or lower-RAM machine that memory spike can OOM-crash the
whole app (it did, with ~10 sessions on a 16 GB box). Resume-on-wake means only the
sessions you actually open are ever live, which is both safe and closer to how you
work. Implementation: `wakeTab`/`wakePlan` in `src/renderer/sleepWake.ts`, and the
reconcile effect's `createTerminal` in `src/renderer/components/Terminal/index.tsx`,
which reads the plan and types the resume command after the shell's first prompt.

## The resume key is the UUID, never the title

afterterm resumes by the Claude **session UUID**, stored per-tab as `claudeSessionId`
(+ `claudeCwd`, the session's real directory — resume is cwd-scoped, so the relaunch must
happen there). Two reasons this matters:

- **Rename-proof.** `claude --name` only sets a *display label*; it does not change the
  UUID, the `<uuid>.jsonl` filename, or the `sessionId` inside it. So a renamed session still
  resumes by its UUID.

## The folder can move: a session that entered a worktree

`claudeCwd` is what the hook last reported, and the hook only fires on `UserPromptSubmit` and
`Stop`. A session that enters another worktree (Claude Code's `EnterWorktree`) keeps running
there across a resume, and Claude Code moves its whole transcript to the new worktree's
project dir under `~/.claude/projects`, so after a relaunch the hook-recorded folder is stale
until the next prompt, and the transcript is no longer under it at all (found by Aryan on
2026-09-19). Since 2026-09-20 the transcript reader (`src/claude-transcript.ts`) covers both:
`findTranscript` looks for `<uuid>.jsonl` across every project dir when it is not under the
recorded folder (the UUID is unique, so one listing settles it), and `latestCwd` returns the
newest entry's `cwd` (Claude Code stamps every entry with it). `applyClaudeMeta` in
`app.tsx` moves the tab's `claudeCwd` to that folder whenever a read reports a different one:
on the launch pass over restored chats (so the header's branch and worktree are right before
the thread is woken), on the once-a-turn meta push, and inside `wakeThread`, which reads the
transcript before `wakeTab` so `claude --resume` is typed in the folder the session is really
in. The hook's own report still wins on every turn, through the same `setClaudeSession`.
- **Title drift is irrelevant.** The tab title (OSC-0) is rewritten constantly — by Claude
  Code (by context) and by the notify hook (`▶ working`, `✅ done`, …). It is never used for
  resume.

Both fields are persisted in `session.json` and restored with the rest of the tab state.

## Capture is a file channel, not the terminal channel

The thing afterterm must do *while you work* is learn each tab's live session id. It does
**not** read this off the terminal stream. The bundled `afterterm-notify.ps1` writes:

```
%APPDATA%\afterterm\claude-sessions\<tabId>.json   =   { "sessionId": "...", "cwd": "..." }
```

on the `UserPromptSubmit` and `Stop` hook events, using `AFTERTERM_TAB_ID` +
`AFTERTERM_SESSION_DIR` that `main.ts` sets on each PTY's env. `main.ts` watches that
directory, validates the values, and pushes them to the renderer (`claude-session:update`),
which stores them on the tab and persists them.

### Only a real user turn may claim a tab

Capture is deliberately restricted to those two events (`$CaptureEvents` in the hook), and
**not** `SessionStart`. Claude Code runs a **shared background daemon** that pre-spawns
throwaway `(spare)` sessions to keep startup fast. That daemon is a descendant of whichever
PTY first started it, so it **inherits `AFTERTERM_TAB_ID` / `AFTERTERM_SESSION_DIR`** — and
its spares fire `SessionStart` like any other session. Capturing on `SessionStart` therefore
let a spare overwrite the tab's real mapping with its own id (last write wins). A spare that
is never used gets retired without ever writing a transcript, so the next launch ran
`claude --resume <id>` against a session that does not exist:

```
[bg] bg spawned 94f9e56a (spare)
[bg] bg retire 94f9e56a: stale-spare, idle 23m [low memory]
```

A spare is never handed a user prompt and never finishes a turn, so gating on
`UserPromptSubmit` / `Stop` keeps it out entirely while the real session still refreshes the
mapping every turn. Cost: a session you start but never prompt is not captured, which is
correct — there is nothing worth resuming yet.

By design there is **no fallback** when a resume fails. The `claude --resume` error is left
visible in the tab rather than swallowed, so a bad mapping shows up instead of hiding.

### Why not the title / OSC channel

The first design piggybacked the session id on the hook's `terminalSequence` output (the same
channel that carries the notification titles), via a private OSC code. It **does not work when
a second notify hook is registered**: if the user also has a personal
`~/.claude/hooks/notify.ps1`, **Claude Code writes only the first hook's terminal output and
silently drops the rest** — afterterm's was dropped, so the id never arrived. Proven on the
dev machine: the hook *fired* (it logged), but its OSC never reached the PTY stream, while
`notify.ps1`'s titles did. The file channel sidesteps CC's hook-output behavior and ordering
entirely, and capture refreshes on the resumed session's first turn.

**Correction (2026-11-07):** the claim above that Claude Code writes only the first hook's terminal output was tested false on Claude Code 2.1.319 (2026-11-07), with another notify hook registered before and after afterterm's: afterterm's `working` title arrived both times. Why the id did not arrive in the earlier observation is unexplained, not disproved. The file channel stays for the reasons that hold: it is afterterm's own private channel (a path handed over in env), and it carries the session id and cwd as data rather than through a title string.

## Claude Code's own session record: a second source of the id (2026-11-07)

The hook gives afterterm a session id only when it runs. A chat whose hooks are missing came back from a restart as a plain terminal: it happened to Aryan's own chat on 2026-11-06, when a test launch had removed the hooks for 21 hours (`docs/note-03-restart-window-said-safe-while-a-chat-was-running.md`). So main also reads Claude Code's own record of each running session, and the hook stays as the fallback. The build brief is `docs/plan-02-restart-window-and-hook-fixes.md`, Fix 5; the code is `src/claude-session-record.ts` (pure, unit-tested) and the "Claude Code's session record" block of `src/main.ts`.

**What the record is.** Claude Code (2.1.319 when this was built) keeps one small file for every running `claude.exe`, at `<Claude folder>\sessions\<pid>.json`: the process's pid, the `sessionId` (it follows `/clear`), the `cwd` (Claude's current folder, including after it enters a worktree), a `status` (`busy` while working, `idle`, `waiting` on a question or a permission prompt, `shell` when idle with a background task; briefly empty at startup), a `kind` (`interactive` for a normal session; background and daemon sessions have others) and the process's start time. The file goes when Claude exits with `/exit`; after a hard kill it stayed for under a minute.

**What is read, and what never is.**

- Main lists the folder every 2 seconds while any PTY is alive, and once more when the restart window opens (`claude-record:refresh`). It opens only names that are exactly digits plus `.json` and a multiple of 4 (`isRecordFileName`: Windows process ids are, and asking about any other number answers for the one below it), only plain files (a link is not followed), at most 200 of them and 256 KiB each. A file caught mid-write keeps its last good record for two failed reads, so the status does not blip.
- **The `<pid>.<hash>.key` files beside the records hold a token and are never opened.** Nothing but a record's own name is ever read.
- Every value is checked before use, because the id is later typed into a shell as `claude --resume <id>` and the folder becomes its cwd: a canonical UUID, and an absolute path with no shell metacharacters (the same rule the hook's file is held to). A field that fails its check is null, never a guess.

**Which thread it belongs to.** A record is matched to a thread through the process tree under that thread's shell (`descendantPids`, with Git Bash's MSYS parents applied, so a Git Bash tree is whole). Of the records in a tree, an `interactive` one wins, then the one nearest the shell (a Claude can start other Claudes, and the outer one is the chat), then the lowest pid. A record counts only when its pid is in the process list, its start time agrees with the list's creation time to within a second (the record writes it in one of two formats, so both readings are tried, with the time zone's offset for that date), and the system says the pid is running now (`process.kill(pid, 0)`, asked only about Claudes in afterterm's own threads). The process list is the server watcher's cache, up to a minute old, never a PowerShell of its own; a record naming a pid the list does not know (a Claude started since), or one it knows as a different process (a reused pid), asks the watcher for a fresh list, once per pid and, on the timer, at most every 10 seconds; the restart window's fresh read may ask at once and waits for the list (up to 20 seconds).

**When an id is adopted.** Only from an `interactive` record whose id and folder are valid and **whose transcript exists** (`findTranscript` in `claude-transcript.ts`: the expected place every tick, a search of every project folder at most every 30 seconds per session). A record is written before the first prompt, and a spare session that never writes a transcript has a record too, and `claude --resume` on such an id fails; a background or daemon session found in a thread's tree must never make the thread a chat for good. The adopted id is sent through `pushClaudeSession`, the same path as a hook capture (`claude-session:update`, then the transcript read and the folder watch that follow a capture), once per id, so `setClaudeSession` stores it on the tab and `threadKind` says chat everywhere with no other change. A chat that never ran a hook is a chat within a couple of seconds of its first message and resumes on Wake and after an update restart.

**The last id is kept when the record goes (Decision 3, Aryan, 2026-11-07).** A thread that holds a session id stays a chat for good: nothing clears `claudeSessionId` when Claude exits, so a chat you exited still resumes. Only a new id is ever sent, never a clear.

**The live status** goes to the renderer separately, on `claude-record:status` and only when it changes, and is kept on the tab as the transient `Tab.recordStatus` (never saved; absent when the thread has no live Claude). The restart window (`docs/features-updates.md`) and the spinner (`docs/features-notifications.md`) read it.

**Test overrides.** `AFTERTERM_CLAUDE_SESSIONS_DIR` and `AFTERTERM_CLAUDE_PROJECTS_DIR` point the record reader and the transcript reader at other folders, read only. A test whose Claude folder is a scratch one (so the app under test never touches the real hooks) still needs a Claude Code with its real login, which has to run with `CLAUDE_CONFIG_DIR` unset; the two overrides let the dev build read where that Claude writes. The dev build can then see the live records of every Claude on the machine, so it is held to its own threads' process trees, and under the harness it logs a `[harness] claude-record <tab> pid=...` line each time it sends something, which a tester can check.

**Limits.**

- **WSL:** a Claude inside WSL is not in the Windows process tree, so it has no record to match and a WSL chat stays on the hooks alone. A known limit, not a bug to solve here.
- **An undocumented file.** The record is not part of Claude Code's documented interface and may change. Aryan decided on 2026-11-07 to rely on it anyway ("when it changes, we'll worry about it later") with the hooks as the fallback. Everything in the reader degrades to "no record" rather than guessing, so a changed format loses the second source, not the first.
- Toasts and the done, needs-you and background states are still the hook's. The record gives the id and a live status, and the spinner reads `busy`.

## Wake: a session id wins over the server rule (2026-11-07)

`wakePlan` in `sleepWake.ts` used to let a port plus a last command win, so a Claude that started a dev server itself, whose last command is `claude`, woke by typing a fresh `claude`. A valid session id now wins: the thread resumes its chat and re-runs nothing. Only a thread with no valid id gets the server rule. And a last command that starts Claude Code (first word `claude`, `claude.exe` or `claude.cmd`, any case) is never re-run as a server command, id or not: a port in such a thread's tree belongs to something Claude started. The sleep question for a thread with a port says what Wake will really do ("Wake resumes the chat.", "Wake runs <command> again." or "Wake opens a fresh prompt."), and the asleep pane's "runs <command>" suffix names only a command Wake will really run. Tested on 2026-11-07 (`docs/screenshots/restart-window-and-hook-fixes/`, the Fix 9 section of its README).

## Security

The captured `sessionId` is later typed into a shell as `claude --resume <id>`, and the
`claude-sessions\*.json` files are world-writable on disk. So values are validated before use:

- **`main.ts`** rejects anything that isn't a canonical UUID + a clean absolute Windows path
  (no shell metacharacters / newlines) when reading a hook file.
- **`Terminal/index.tsx`** re-validates `claudeSessionId` as a UUID at the injection site too
  (`session.json` is hand-editable) before typing the resume command.
- **The session record** (`src/claude-session-record.ts`) is held to the same rule: the folder it names is user-writable too, so its id must be a canonical UUID and its folder a clean absolute path before either is used, and its `.key` files are never opened (see the section above).

## Files

| File | Role |
|---|---|
| `assets/hooks/afterterm-notify.ps1` | Writes `<tabId>.json` to `AFTERTERM_SESSION_DIR` each event |
| `assets/hooks/test-afterterm-notify.ps1` | Hook tests incl. the file-channel cases |
| `src/main.ts` | Sets `AFTERTERM_TAB_ID`/`AFTERTERM_SESSION_DIR`; watches + validates the dir; pushes `claude-session:update`. Reads Claude Code's session record every 2 seconds and pushes an adopted id through the same `pushClaudeSession`, and the status on `claude-record:status` |
| `src/claude-session-record.ts` | Pure: record file names (never the `.key` files), parsing and validation, start-time and liveness checks, matching a record to a thread's process tree, what to send for a thread. Test file: `claude-session-record.test.ts` |
| `src/preload.ts`, `src/afterterm.d.ts` | `claudeSession.onUpdate` bridge |
| `src/claude-transcript.ts` | `findTranscript` (by UUID across project dirs) and `latestCwd` (the transcript's newest folder) |
| `src/renderer/app.tsx` | Subscribes → `setClaudeSession`; `applyClaudeMeta` moves `claudeCwd` to the transcript's folder; `wakeThread` reads the transcript before the wake |
| `src/renderer/hooks/useTabState.ts` | `setClaudeSession`; persists `claudeSessionId`/`claudeCwd`; `restoreSession` marks every restored tab asleep (`restoredTab`) |
| `src/renderer/components/Terminal/index.tsx` | Injects `claude --resume <uuid>` on wake (UUID-validated), not on restore |

## Dev / test isolation

Set `AFTERTERM_USER_DATA_DIR` to point `session.json` / `prefs.json` / `claude-sessions/` at a
throwaway directory, so a dev run can't clobber a running build's state (`main.ts` honors it
before any `userData` path is read).

## Known edges / future

- **BOM on the capture file (fixed v0.7.2).** The hook writes `<tabId>.json` with PowerShell's
  `Set-Content -Encoding UTF8`, which under **Windows PowerShell 5.1 prepends a UTF-8 BOM** (pwsh
  7 does not). Node's `JSON.parse` throws on a leading BOM, and `readAndPushClaudeSession`'s catch
  silently swallowed it — so on a 5.1 host *no* mapping was ever pushed or persisted, and nothing
  auto-resumed (the failure was invisible until an app restart). `main.ts` now strips a leading
  `U+FEFF` BOM before parsing. Fix belongs on the read side (host-agnostic + recovers already-written
  files), not the hook.
- **Daemon spare sessions clobbering the mapping (fixed).** See "Only a real user turn may
  claim a tab" above: capture used to run on every hook event, so a background `(spare)`
  session spawned by Claude Code's shared daemon could claim the tab with an id that never
  gets a transcript. Capture is now gated to `UserPromptSubmit` / `Stop`.
- Capture writes the file on each user turn; `setClaudeSession` is a no-op when unchanged, so
  there's no extra `session.json` churn after the first capture.
- `claude-sessions/<tabId>.json` files for closed tabs are not garbage-collected yet (harmless
  small files; the data is also in `session.json`).
- A tab that ran Claude once and was later used as a plain shell still carries its
  `claudeSessionId`, so it will resume Claude on next launch. Acceptable for v1.

## The CLAUDE.md record (moved here 2026-09-20)

## Session Restore

Windows ConPTY cannot be reconnected after app restart — the kernel object dies with the process. (A future design to make shells *survive* an app restart lives in `docs/design-01-persistent-pty-host.md`.)

What afterterm does:
- Auto-saves every 2 seconds (debounced): tab order, group names/colors/collapsed state, shell type, CWD
- On relaunch: restores the full layout and spawns fresh shells starting in the saved CWD
- Limitation: scrollback, running processes, and command history are lost — each tab is a fresh shell

Save location: `%APPDATA%\afterterm\session.json`

Format: `{ version, tabs, groups, activeTabId }`. `version: 2` since the projects-and-threads work; 0.8.1 wrote no version field. Loading goes through `migrateSession` in `src/renderer/sessionMigration.ts`, which fills the fields a 0.8.1 file lacks (`Group.pinned`, `Group.archived`, `Group.lastActiveAt`, `Group.history`, `Tab.lastActiveAt`, `Tab.asleep`, `Tab.sleptAt`), drops entries without an id, strips transient fields and rejects anything that is not a session. Saving goes through `serializeSession` in the same module. Every 0.8.1 key keeps its name and meaning, so 0.8.1 still opens a file written by a newer build (it ignores the fields it does not know); a 0.8.1 build opening a Phase 4 file ignores `asleep`, `sleptAt` and `history` the same way and spawns every tab as before, since it has no notion of a thread starting asleep, and it ignores Phase 5's `port` and `lastCommand` the same way. Add new persisted fields in that module, not in `app.tsx`. Phase 3 adds `Tab.model`, `Tab.branch`, `Tab.worktree` and `Tab.claudeTitle` to the persisted keys, all optional strings; `Tab.firstPrompt` stays transient, re-read from the transcript on every launch. Phase 4 adds `Tab.sleptAt` (persisted, present only while asleep) and `Group.history` (persisted, `HistoryEntry[]`, defaults to `[]`); `Tab.wokeAt` is transient, set only for the one render after a wake or a history resume so the terminal layer knows to replay the saved tail, and is stripped on both load and save. Phase 5 adds `Tab.port` (persisted, optional, validated on load as an integer 1 to 65535, anything else dropped) and `Tab.lastCommand` (persisted, optional string). Phase 7 adds `Tab.unread` (persisted, optional, kept only when it is the literal `true`; false or a wrong type is dropped so a never-marked thread and one marked read look the same on disk). Phase 8 adds `Group.icon` (persisted, optional, validated against the ten `PROJECT_ICON_IDS`, anything else dropped so an old id or a hand-edited string falls back to the plain folder) and a top-level `ui: { panelHidden?: boolean }` object (persisted, defaults to `{}`); 0.8.1 ignores both the same way it ignores every field it does not know.

Tabs that were running a **Claude Code session no longer auto-resume on relaunch**. Every thread restored from `session.json` starts asleep (`restoredTab` in `sleepWake.ts`), full stop: nothing is spawned at all until the user acts on it. A chat resumes when the user wakes it, from the asleep pane's Wake button or the thread menu's Wake, or when Resume is used on a history entry from the project page or the palette, both of which run `claude --resume <sessionId>` in the session's cwd the same way a plain wake does. The reason nothing used to resume in bulk is unchanged and is now also the reason nothing wakes in bulk: resuming every saved session at once cold-starts N `claude` processes plus their MCP servers simultaneously, which can OOM-crash the app on a loaded or lower-RAM machine (it did, with ~10 sessions on a 16 GB box); making every restore start asleep removes even the one exception the old lazy scheme carved out for the active tab. The
session UUID is still captured per-tab via a file the notify
hook writes — **not** the terminal/title channel — and persisted as `claudeSessionId` /
`claudeCwd`. Capture only fires on `UserPromptSubmit` / `Stop`: Claude Code's shared background
daemon inherits the tab env and pre-spawns throwaway `(spare)` sessions whose `SessionStart`
used to hijack the mapping with an id that never gets a transcript. See [`docs/features-claude-session-resume.md`](docs/features-claude-session-resume.md)
for the why and the wiring. (Dev isolation: `AFTERTERM_USER_DATA_DIR` redirects `session.json`
to a throwaway dir.)

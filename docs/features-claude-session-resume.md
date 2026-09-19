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

## Security

The captured `sessionId` is later typed into a shell as `claude --resume <id>`, and the
`claude-sessions\*.json` files are world-writable on disk. So values are validated before use:

- **`main.ts`** rejects anything that isn't a canonical UUID + a clean absolute Windows path
  (no shell metacharacters / newlines) when reading a hook file.
- **`Terminal/index.tsx`** re-validates `claudeSessionId` as a UUID at the injection site too
  (`session.json` is hand-editable) before typing the resume command.

## Files

| File | Role |
|---|---|
| `assets/hooks/afterterm-notify.ps1` | Writes `<tabId>.json` to `AFTERTERM_SESSION_DIR` each event |
| `assets/hooks/test-afterterm-notify.ps1` | Hook tests incl. the file-channel cases |
| `src/main.ts` | Sets `AFTERTERM_TAB_ID`/`AFTERTERM_SESSION_DIR`; watches + validates the dir; pushes `claude-session:update` |
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

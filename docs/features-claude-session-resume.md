# Claude Code session resume

Tabs that were running a Claude Code session **auto-resume it when afterterm reopens** —
afterterm relaunches the shell in the session's directory and runs
`claude --resume <sessionId>`, so the conversation comes back where you left it.

## Lazy resume — one at a time, not all at once

Resume is **lazy**: on launch only the **active tab** resumes immediately; every other
Claude tab is deferred and resumes the **first time you switch to it**. Each tab keeps
its session name in the sidebar in the meantime, so you see what's there before it loads.

This is deliberate and important. Resuming every saved session at once cold-starts N
`claude` processes *plus their MCP servers* simultaneously — on a loaded or
lower-RAM machine that memory spike can OOM-crash the whole app (it did, with ~10
sessions on a 16 GB box). Lazy resume means only the sessions you actually open are
live, which is both safe and closer to how you work. Implementation: `resumeTab` +
`pendingResumeRef` in `Terminal/index.tsx` (the active-tab effect drains the pending
map on activation).

## The resume key is the UUID, never the title

afterterm resumes by the Claude **session UUID**, stored per-tab as `claudeSessionId`
(+ `claudeCwd`, the session's real directory — resume is cwd-scoped, so the relaunch must
happen there). Two reasons this matters:

- **Rename-proof.** `claude --name` only sets a *display label*; it does not change the
  UUID, the `<uuid>.jsonl` filename, or the `sessionId` inside it. So a renamed session still
  resumes by its UUID.
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
| `src/renderer/app.tsx` | Subscribes → `setClaudeSession` |
| `src/renderer/hooks/useTabState.ts` | `setClaudeSession`; persists `claudeSessionId`/`claudeCwd` |
| `src/renderer/components/Terminal/index.tsx` | Injects `claude --resume <uuid>` on restore (UUID-validated) |

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

# Why the restart window said "Safe to restart" while a chat was running

Written 2026-11-06 at Aryan's request, for the entry of the same name in `docs/bugs.md`. It comes from reading the source at `v0.13.0` (the build Aryan was running) and the live files on his machine. Nothing was run to reproduce it, and nothing here has been built.

Two separate faults met here. The first took away the signals; the second made missing signals read as safe.

## What happened, by the clock (2026-11-06)

| Time | What happened |
|---|---|
| 14:34:16 | Last Stop hook record in the chat cutting the 0.15.0 release (`tab-319`, session `0a7299d0`). |
| 14:35:50 | That chat starts the packaged 0.15.0 build for a smoke test: `AFTERTERM_USER_DATA_DIR` set to a throwaway folder, a `prefs.json` there with `"claudeNotifications":"disabled"`, no `CLAUDE_CONFIG_DIR`. |
| 14:35:52 | The throwaway `prefs.json` is written. The real `~/.claude/settings.json` is rewritten with `"hooks": {}`. |
| 14:37:02 | The release chat's turn ends with no Stop hook record, so a chat already running lost its hooks too. |
| 14:37:55 | The chat in the screenshot starts (`tab-321`, session `4d8b259d`). Its transcript has no hook records at all, and `claude-sessions\tab-321.json` was never written. |
| 14:39 | Aryan clicks Restart to update and takes the screenshot. |
| 14:42 | The saved record of `tab-321` has `claudeTitle` and the title "◐ Hidden version 15 update jump", and no `claudeSessionId`. |

## First fault: a throwaway profile changes the real Claude Code settings

`reconcileClaudeHook` (`src/claude-hook-install.ts`) runs on every launch. `main.ts` gives it `prefsPath` from `app.getPath('userData')`, which follows `AFTERTERM_USER_DATA_DIR`, and `claudeDir` from `getClaudeDir()`, which is the real `~/.claude` unless `CLAUDE_CONFIG_DIR` is set. So the opt-out is read from the throwaway profile and carried out on the real settings: `removeAftertermEntries` deletes each event whose only group is ours and leaves `"hooks": {}`.

The running app reconciles only at launch, so nothing puts the hooks back until the next normal launch, whose prefs say enabled. That launch re-registers all five events (from the source, not run).

Without the hooks, a chat gets no decorated titles (no working, needs-you or done states, no toasts) and no per-tab session file (so no `claudeSessionId`, and no resume).

## Second fault: the window treats what it does not know as safe

All at `v0.13.0`, and unchanged in `update-check.ts` on `main`:

- `threadKind` (`threadView.ts`) says chat only when `claudeSessionId` is set. `tab-321` had a `claudeTitle`, so afterterm had seen Claude Code's title, and still called it a shell.
- `isMidTurn` reads `notification`, which only the hook's titles set. Without the hook a chat is never mid-turn, so a chat with a saved session id reads "Resumes" even in the middle of a reply.
- `restartRows` can only say "Stops mid-turn" for a chat that resumes. Everything else that is not a server is "Opens in its folder".
- `restartStatus` says "Safe to restart" when no row is "Stops mid-turn". It never asks whether a thread is running something.

The same reading means a shell running a long command with no port, such as a build, also reads "Opens in its folder" and "Safe to restart" (from the source, not run).

## Proposed fix, for Aryan to decide

1. **Stop a throwaway profile touching the real settings.** Skip `reconcileClaudeHook` when `AFTERTERM_USER_DATA_DIR` is set and `CLAUDE_CONFIG_DIR` is not.
2. **Recognise a chat without the hook.** A thread with a Claude title counts as a chat. In the saved records the working chat's title starts with `◐` and idle ones with `✳`, which may also tell working from idle; that needs checking against `chatTitle.ts`.
3. **Say "Safe to restart" only when afterterm knows.** A thread that may be busy gets its own row text, and the status line drops "Safe". OSC 133 prompt marks (`commandMarks.ts`) could tell a shell running a command from one sitting at its prompt.

# Why the restart window said "Safe to restart" while a chat was running

Written 2026-11-06 at Aryan's request, for the entry of the same name in `docs/bugs.md`. It comes from reading the source at `v0.13.0` (the build Aryan was running) and `main`, and from the live files and Claude Code transcripts on Aryan's machine. Nothing was run to reproduce it, and nothing here has been built.

Two separate faults met here. A test launch removed the hooks, which only testing can do. The restart window then read the missing signals as safe, which can happen without any test.

## What a hook is

Claude Code's settings file, `~/.claude/settings.json`, can hold entries saying "when this event happens, run this script". afterterm adds five, all running `~/.claude/hooks/afterterm-notify.ps1`:

| Event | What the script does for afterterm |
|---|---|
| SessionStart | Sets the baseline title; saves the session id if the chat was resumed |
| UserPromptSubmit | Sets the working title; saves the session id and folder |
| Notification (permission prompt) | Sets the needs-permission title and rings the bell |
| Stop | Sets the done or background title; saves the session id and folder |
| PreCompact | Sets the compacting title |

The titles become a thread's working, needs-you, done, background and compacting states and its toasts. The saved session id is what makes a thread a chat and lets it resume. So without the entries, afterterm sees a terminal with a title and nothing more.

"Removed" means those entries were deleted from `settings.json`. The script file stayed where it was, and the rest of the file was kept.

## How they can be removed

afterterm removes them itself. `reconcileClaudeHook` (`src/claude-hook-install.ts`) runs on every launch and reads `claudeNotifications` from `prefs.json`. When it is not `"disabled"`, it makes sure the five entries are there. When it is `"disabled"`, `removeAftertermEntries` deletes them, which is the opt-out. Deleting the last entry of every event leaves `"hooks": {}`, which is what was found.

The two paths it uses come from different places (`reconcileNotifierHook` in `main.ts`):

- `prefsPath` comes from `app.getPath('userData')`, which follows `AFTERTERM_USER_DATA_DIR`, so a test launch reads its throwaway `prefs.json`.
- `claudeDir` comes from `getClaudeDir()`, which is the real `~/.claude` unless `CLAUDE_CONFIG_DIR` is set.

So the opt-out is read from the throwaway profile and carried out on the real settings. The running app reconciles only at launch, so it does not notice. The next launch whose prefs do not opt out adds all five back (from the source, not run).

## What happened, by the clock (2026-11-06)

| Time | What happened |
|---|---|
| 12:31:17 | Aryan's installed afterterm (0.13.0) started. It stays running throughout. |
| 14:34:16 | Last Stop hook record in the chat cutting the 0.15.0 release (`tab-319`, session `0a7299d0`). |
| 14:35:41 | That chat tries a smoke test of the packaged 0.15.0 build. A safety check blocks the command before it runs. |
| 14:35:50 | It runs the same smoke test again: `AFTERTERM_USER_DATA_DIR` set to a throwaway folder, a `prefs.json` there with `"claudeNotifications":"disabled"`, no `CLAUDE_CONFIG_DIR`. |
| 14:35:52 | The throwaway `prefs.json` is written. The real `~/.claude/settings.json` is rewritten with `"hooks": {}`. |
| 14:37:02 | The release chat's turn ends with no Stop hook record, so a chat already running lost its hooks too. |
| 14:37:55 | The chat in the screenshot starts (`tab-321`, session `4d8b259d`). Its transcript has no hook records at all, and `claude-sessions\tab-321.json` was never written. |
| 14:39 | Aryan clicks Restart to update and takes the screenshot. |
| 14:42 | The saved record of `tab-321` has `claudeTitle` and the title "◐ Hidden version 15 update jump", and no `claudeSessionId`. `settings.json` still holds `"hooks": {}`. |

The bell on "Latest resume version" in the screenshot is Mark as unread (`unread: true` in its saved record), not a permission prompt, so its "Resumes" row does not contradict the bell.

## Was this only caused by testing?

**The removal of the hooks: yes.** It needs `AFTERTERM_USER_DATA_DIR`, which only test launches set, together with a seeded opt-out. Nothing in `src` on `main` sets `claudeNotifications` to `"disabled"`, so a person would have to edit `prefs.json` by hand, and then removal is what they asked for. The agent harness does not do it either: it seeds only `claudeHookToastShown: true`. The release session wrote the opt-out into its own smoke test.

What the transcripts show (main session transcripts changed since 2026-10-01, every finished turn checked for a Stop hook record within two minutes of it):

| Period | Finished turns with a Stop hook | Notes |
|---|---|---|
| 2026-10-15 to 2026-11-05 | 1,012 of 1,018 | The six without are scattered: 10-18, 10-21, two on 10-22, two on 11-05. |
| 2026-11-06 | 19 of 22 | The three without are 14:37:02, 14:39:23 and 14:47:27, all after the removal. |

Test launches seeding the opt-out in those transcripts:

| When | Session | Result |
|---|---|---|
| 2026-10-29 15:18 | `639edc74` (installer work) | Its command mentions a scratch home or Claude folder. All 38 turns that day and all 132 the next day have a Stop hook. |
| 2026-11-06 14:35:41 | `0a7299d0` (0.15.0 release) | Blocked before it ran. |
| 2026-11-06 14:35:50 | `0a7299d0` (0.15.0 release) | The launch that removed the hooks. |

Not explained: earlier runs of turns without a Stop hook, each in one session: 2026-10-02 16:37 to 16:50 (8 turns, `5b58f2af`), 2026-10-07 15:33 to 15:40 (5 turns, `5b58f2af`), 2026-10-11 12:42 to 12:51 (4 turns, `d68c5f19`), 2026-10-12 19:46 to 20:15 (3 turns, `6d104778`). No test launch seeding the opt-out appears on those days. Whether other chats lost their hooks at those moments was not checked.

**The wrong "Safe to restart": no.** The test only exposed it. In `update-check.ts` and `threadView.ts`, the same on `main`:

- `threadKind` says chat only when `claudeSessionId` is set. `tab-321` had a `claudeTitle`, so afterterm had seen Claude Code's title, and still called it a shell.
- `isMidTurn` reads `notification`, which comes from the hook's titles.
- `restartRows` can only say "Stops mid-turn" for a chat that resumes. Everything else that is not a server is "Opens in its folder".
- `restartStatus` says "Safe to restart" when no row is "Stops mid-turn". It never asks whether a thread is running something.

So these situations should give the same wrong answer on a normal install, with no test involved (from the source, not run):

| Situation | Row | Status line |
|---|---|---|
| A shell running a long command with no port, such as a build | Opens in its folder | Safe to restart |
| A chat on a machine where the hook cannot run, for example Group Policy overriding `-ExecutionPolicy Bypass` | Opens in its folder | Safe to restart |
| A chat mid-reply when another notify hook is registered first (the comment in `afterterm-notify.ps1` says Claude Code then writes only the first hook's terminal output, so the working title is lost) | Resumes | Safe to restart |
| A chat mid-reply whose output stalled for over 2.5 seconds (`SILENCE_CLEAR_MS` clears `working`, and only the next hook title brings it back) | Resumes | Safe to restart |

On the last one, the comment in `spinnerState.ts` records in-turn gaps of about 450ms, so it should be rare. How often it happens in real use is not known.

## Proposed fix, for Aryan to decide

1. **Stop a throwaway profile touching the real settings.** With `AFTERTERM_USER_DATA_DIR` set, leave Claude Code's settings alone unless the Claude folder is a scratch one too (`CLAUDE_CONFIG_DIR`, or a scratch home).
2. **Recognise a chat without the hook.** A thread with a Claude title counts as a chat. In the saved records the working chat's title starts with `◐` and idle ones with `✳`, which may also tell working from idle; that needs checking against `chatTitle.ts`.
3. **Say "Safe to restart" only when afterterm knows.** A thread that may be busy gets its own row text, and the status line drops "Safe". OSC 133 prompt marks (`commandMarks.ts`) could tell a shell running a command from one sitting at its prompt.

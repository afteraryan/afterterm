# Plan: make the restart window tell the truth and stop hooks being removed

Written 2026-11-07 for the agent building this. Aryan has decided to hand the build off, so nothing here has been built. The evidence for every claim is in [`note-03-restart-window-said-safe-while-a-chat-was-running.md`](note-03-restart-window-said-safe-while-a-chat-was-running.md); read it first. Captures of the tests are in `docs/screenshots/restart-window-hypothesis-test/`.

## Decisions Aryan made on 2026-11-07

1. **One PR, all the fixes, in one go.** Not split. No mock first.
2. **Rely on Claude Code's session record** (`~/.claude/sessions/<pid>.json`) even though it is undocumented. "When it changes, we'll worry about it later." Hooks stay as the fallback.
3. **A chat resumes even if you exited it.** A thread that holds a session id stays a chat for good, and Wake and the update restart resume it.

## What is wrong, in short

- A test launch with a throwaway profile whose prefs opt out of notifications removes afterterm's hooks from the real `~/.claude/settings.json`. Without them, chats have no states, no toasts and save no session id. On 2026-11-06 they stayed gone for 21 hours 33 minutes.
- The restart window says "Safe to restart" whenever no chat it recognises is mid-turn, so anything it cannot see reads as safe. That happens with hooks working too.
- A chat with no hook-saved session id comes back from a restart as a plain terminal. It happened to Aryan's own chat.

## The fixes

### Stop tests touching the real Claude folder

**Fix 1: a test launch leaves the Claude folder alone.** In `reconcileNotifierHook` (`src/main.ts`), skip `reconcileClaudeHook` when `AFTERTERM_USER_DATA_DIR` is set and `CLAUDE_CONFIG_DIR` is not. This covers the entries and the hook script, which a launch also overwrites. The sandbox build sets `CLAUDE_CONFIG_DIR` itself, so it keeps working. Keep the decision in a small pure function in `claude-hook-install.ts` so it can be unit-tested.

**Fix 2: the opt-out removes only afterterm's own hook.** `removeAftertermEntries` drops any group holding an afterterm hook, which also deletes another tool's hook in that group, for good. Remove afterterm's hook from `group.hooks`, and drop the group only when nothing is left.

**Fix 3: correct what agents read.**
- `scripts/agent-harness/README.md` says a scratch home means a run "never touches the real `~/.claude/hooks` or `~/.claude/settings.json`". False: `app.getPath('home')` ignores `USERPROFILE` and `HOME` on Windows (tested on Electron 35.7.5). Replace it with what is true: only `CLAUDE_CONFIG_DIR` redirects the Claude folder.
- Add to `docs/guide-02-releases.md`: a smoke test of a packaged build passes a scratch `CLAUDE_CONFIG_DIR` and never seeds `claudeNotifications`.

### Repair hooks automatically

**Fix 4: put the hooks back while the app runs.** Today `reconcileClaudeHook` runs only at launch. Add a watch in main on the Claude folder's `settings.json` that calls it when afterterm's entries are missing. Tested: a running chat picks hooks up live, so open chats recover with no restart. Requirements:
- Respects Fix 1 (nothing in a test launch) and the opt-out (never re-adds when `claudeNotifications` is `"disabled"`).
- Keeps the existing rule: a `settings.json` that is not valid JSON is left alone.
- Watch the folder or poll, since editors and Claude Code may replace the file rather than write into it. Debounce, and write only when something is missing, so it cannot loop against Claude Code's own writes.

### Read Claude Code's session record

**Fix 5: a session feed from the record.** New pure module, unit-tested, plus a reader in main. For each thread with a live shell (`shellPids` in `main.ts`), find the Claude process in that shell's tree and read `<Claude folder>\sessions\<pid>.json`.

Facts from testing (Claude Code 2.1.319):

| Field or behaviour | What was seen |
|---|---|
| File name and `pid` | The `claude.exe` process, a direct child of the thread's shell under cmd |
| `sessionId` | Matched the real transcript. Follows `/clear`. |
| `cwd` | Claude's current folder, including after it enters a worktree |
| `status` | `busy` working, `idle`, `waiting` on a question or permission prompt, `shell` idle with a background task. Briefly empty at startup. |
| `kind` | `interactive` for a normal session |
| `procStart` | Present, usable to check the pid was not reused |
| On `/exit` | The file goes |
| After a hard kill | The file stayed for under a minute, so check the pid is alive |
| Beside it | `<pid>.<hash>.key` files holding a token. **Never read them.** Match `^\d+\.json$` only. |

Rules for reading it:
- Use `descendantPids` and `applyMsysParents` from `server-detect.ts`, so Git Bash trees work. Take the interactive record nearest the shell, because a Claude can start other Claude processes.
- **Adopt a `sessionId` only when its transcript exists** (`findTranscript` in `claude-transcript.ts`). A record exists before the first prompt, and the hook script's comments describe spare sessions that never write a transcript. `claude --resume` on such an id fails.
- Send an adopted id through the existing `claude-session:update` channel (main.ts) with the record's `cwd`, so it reaches `setClaudeSession` the same way a hook capture does. `threadKind` then says chat everywhere with no other change.
- Keep the last id when the record goes (Decision 3).
- Send live status to the renderer separately from `notification`. It is not persisted.
- Cost: the process list is slow and cached (`SERVER_PROC_MAX_AGE_MS`, 60 seconds). Reading the sessions folder is cheap. Suggested: read the folder about every 2 seconds while any PTY is alive, reuse the cached process list, and refresh the list when a record's pid is not in it. Take a fresh read when the restart window opens.
- WSL processes are not in the Windows tree, so a WSL chat stays on hooks alone. That is a known limit, not a bug to solve here.

**Fix 6: mid-turn comes from the record first.** In `awakeThreads` (`app.tsx`) and `isMidTurn` (`update-check.ts`), a thread is mid-turn when the record says `busy` or `waiting`, or `notification` says `working`, `compacting` or `attention`. The record is what closes the no-hooks case, the stall, and the 7 to 8 second gap at prompts.

**Fix 7: background tasks.** Record status `shell`, or `notification` of `background`, gets its own row and is not safe.

**Fix 8: busy shells.** A thread with no live Claude that is not at its prompt gets its own row and is not safe. Use the OSC 133 state (`atPrompt` in `commandMarks.ts`, held in `Terminal/index.tsx`; expose it per thread to `app.tsx`). Prompt marks are the main signal: child processes miss built-ins like PowerShell's `Start-Sleep`. When a thread has no marks (integration opted out), fall back to whether the shell has a child process, and treat "none" as unknown.

**Fix 9: an exited chat stays a chat (Decision 3).**
- `threadKind` does not change, and nothing clears `claudeSessionId` when Claude exits.
- At a prompt it reads "Resumes". If its shell is running a command, the row warns (Fix 8), and it still resumes afterwards.
- **`wakePlan` changes** (`sleepWake.ts`): today a port plus a last command wins and `resumeSessionId` is null. Make a valid session id win over the server rule. A thread with both resumes the chat and does not re-run the server. This also covers a Claude that started a dev server itself, where the last command is `claude` and today's rule would run a fresh `claude` instead of resuming (read from the source, not run; confirm it). Update the "A server never resumes a chat" comment and `sleepWake.test.ts`.

**Fix 10: "Safe to restart" only when afterterm knows.** Table below. `restartRows` and `restartStatus` in `update-check.ts`, drawn by `RestartToUpdate/index.tsx`.

**Fix 11: the spinner.** In `app.tsx`'s tick (`onTick`, `spinnerState.ts`), do not clear `working` on silence while the record says `busy`, and set `working` from a `busy` record so a chat with no hooks still shows it. Toasts for a chat with no hooks are out of scope; Fix 4 is what restores those.

**Fix 12: the stale comment.** `afterterm-notify.ps1` says Claude Code writes only the first hook's terminal output. Tested false on 2.1.319 in both orders. Remove the claim, and keep the reason for the file channel only if another reason holds.

## What the restart window must say

Short rows and one small status line, the existing style (Aryan's rule for dialogs: no paragraphs). The wording below is the default; Aryan sees it in `docs/to-verify.md`.

| Thread | Row | Warns? |
|---|---|---|
| Claude alive, `busy` or `waiting` (or a mid-turn `notification`), with or without a session id | Stops mid-turn | Yes |
| Claude alive, `shell` (or `notification` is `background`) | Background task stops | Yes |
| Claude alive and idle, session id usable | Resumes | No |
| Claude alive and idle, no usable id yet (no prompt sent) | Opens in its folder | No |
| No Claude, session id, at its prompt | Resumes | No |
| No Claude, session id, running a command | Command stops | Yes |
| No Claude, no id, port and a re-runnable command | Runs again on :5173 | No |
| No Claude, no id, running any other command | Command stops | Yes |
| No Claude, no id, at its prompt | Opens in its folder | No |
| No Claude, no marks, no child process | Opens in its folder, and the thread counts as unknown | No |

| Rows | Status line |
|---|---|
| Nothing warns, nothing unknown | Safe to restart |
| Only chats that stop mid-turn | 1 chat stops mid-turn / 2 chats stop mid-turn (today's text) |
| Any other warning | 1 thread is busy / 2 threads are busy |
| Nothing warns, something unknown | No status line |

## Test plan

Unit tests for every pure rule: the Fix 1 decision, group removal (Fix 2), record parsing and matching (Fix 5, including a record with no transcript, a dead pid and a nested Claude), every row and status line above, `wakePlan` (Fix 9), the spinner tick (Fix 11). A new test file goes in `package.json`'s `test` script.

Then run this against the real app and real Claude Code, recording it. It reruns what was tested on 2026-11-07, so the "Today" column is what was seen before the fixes.

| # | Set up | Today | Must become |
|---|---|---|---|
| 1 | Chat with no hooks (`--setting-sources local`), mid-reply | Shell icon, Opens in its folder, Safe | Chat icon, Stops mid-turn, warning |
| 2 | Chat with hooks, mid-reply | Stops mid-turn | The same |
| 3 | Chat with hooks, paused 4 seconds mid-reply (`stall.ps1`) | Resumes, Safe; spinner gone | Stops mid-turn; spinner stays |
| 4 | cmd running `ping -n 120 127.0.0.1` | Opens in its folder, Safe | Command stops, warning |
| 5 | PowerShell 7 running `Start-Sleep -Seconds 90` | Opens in its folder, Safe | Command stops, warning |
| 6 | Chat that ended its turn with a background task | Resumes, Safe | Background task stops, warning |
| 7 | Chat `/exit`ed, shell running `ping` | Resumes, no warning | Command stops, warning; after the restart it resumes |
| 8 | Chat `/exit`ed, shell at its prompt | Resumes | The same, and Wake resumes it |
| 9 | Chat waiting on a question or a file write prompt | Stops mid-turn after 7 to 8 seconds | Stops mid-turn at once |
| 10 | Idle shell, idle chat | Opens in its folder, Resumes, Safe | The same |
| 11 | No hooks, wake after a real sleep | Plain terminal | The chat resumes |
| 12 | Git Bash and WSL shells (not tested before) | Unknown | Marks work on Git Bash; WSL as far as it can be tested |

Hook tests, with `launch-exe-once.ps1` and a scratch Claude folder:

| # | Set up | Must become |
|---|---|---|
| 13 | Throwaway profile with the opt-out, no `CLAUDE_CONFIG_DIR` | **Only after Fix 1 is proven by its unit test.** Real file unchanged. Back the real file up first, and hash it before and after. |
| 14 | Opt-out with a scratch Claude folder holding another tool's hook in afterterm's group | Afterterm's hook gone, the other hook stays |
| 15 | App running with a scratch Claude folder, delete the hooks from its `settings.json` | Back within seconds |
| 16 | A running chat through 15 (`live-hooks-test.ps1` shows the pattern) | Hook lines fire again |
| 17 | Opt-out on, delete the hooks | Stay gone |
| 18 | `settings.json` made invalid JSON | Left untouched |

One end-to-end pass with the installed sandbox build (`npm run installer -- --sandbox`, see `docs/features-updates.md`, Testing, Phase 3): a real update restart where a chat with no hook-saved id comes back resumed. A dev build refuses Restart now, so only this proves it.

### How to drive this safely

Read `scripts/agent-harness/README.md` and these memories first: `test-launch-can-remove-real-hooks`, `driving-real-claude-in-the-harness`, `harness-always-pass-data-dir`, `harness-no-real-session-id`, `harness-drive-from-powershell-in-worktrees`, `screenshots-with-other-people-stay-off-github`.

- Launch: `--env AFTERTERM_UPDATE_FEED=<feed> --env AFTERTERM_UPDATE_CHECK_DELAY_MS=2000 --env CLAUDE_CONFIG_DIR=<scratch>`. Write the feed with `update-feed.mjs`. Then `window.afterterm.update.download()` reaches **Restart to update**.
- Selectors: `[data-update-button]`, `[data-restart-rows] .tr`, `.up-dstat`, and `.up-dfoot .b.q.s` for Not now.
- A real Claude in such a thread needs `set CLAUDE_CONFIG_DIR=` first to log in. So the app's Claude folder (scratch) and the test Claude's (real) differ, and the record reader will look in the wrong place. **Add a test override**, `AFTERTERM_CLAUDE_SESSIONS_DIR`, like the existing `AFTERTERM_CLAUDE_PROJECTS_DIR`, and point both at the real folders, read only. The dev build can then see Aryan's live records, so confirm it only ever matches pids in its own threads' trees.
- Start test chats in an empty scratch folder with `--model haiku --strict-mcp-config --permission-mode default`. Auto mode in a new folder can raise an invitation that opens Claude's "Teach auto mode" panel, which offers to scan shell history. Never press Continue on it.
- Confirm the active thread (`.th.sel`) and read the screen before every keystroke. The panel folds after five rows, so a row click can fail while typing still goes to the wrong thread. `drive key Escape` does not reach a Claude dialog.
- `whoami` does not raise a permission prompt. A file write does.
- Look at every capture before committing it; the repo is public.

### Test scripts

`scripts/agent-harness/restart-window-tests/`. Copy the folder to a scratch folder and run `make-settings.mjs <that folder>` first, since the tests write beside themselves. Run PowerShell ones from the repo root, because they call `scripts/agent-harness/drive.mjs`. These are the scripts the 2026-11-07 tests ran. Their paths were generalised afterwards and they were checked to parse, not run again, so expect small fixes.

| Script | What it does |
|---|---|
| `launch-exe-once.ps1` | Starts one packaged exe, reports what it did to a settings file and whether the real files changed, kills only its own pid. Refuses an opt-out without a scratch Claude folder. |
| `seed-scratch-claude.mjs` | Builds a scratch Claude folder from the real hooks block, plus another tool's hooks in its own group and in afterterm's |
| `make-settings.mjs` | Writes the settings the live tests use |
| `sampler.js` | Paste into `drive eval`: logs each thread's title glyph, state and id on every change, in `window.__rw.log` |
| `sess-watch.ps1` | Logs every change in the session records for one folder. Skips the key files. |
| `stall.ps1` | Pauses one test `claude.exe` for a few seconds. Refuses any pid not under the given harness electron. |
| `live-hooks-test.ps1` | Hooks on, off, on, on in a running chat, counting lines fired |
| `two-hooks-test.ps1` | Another notify hook before or after afterterm's |
| `guarded-driving-example.ps1` | The active thread and dialog guards, as a pattern to copy |
| `other-hook.ps1`, `hook-fire.cmd` | Hooks those tests register |

## What to update in the same PR

- `docs/bugs.md`: delete the entries "Restart window says "Safe to restart" while a chat is in the middle of a reply", "Starting afterterm with a throwaway profile can remove its hooks from the real Claude Code settings", "Turning Claude notifications off also deletes another tool's hook that shares a group with afterterm's" and "The harness README says a scratch home keeps a run away from the real Claude settings, and it does not".
- `docs/bugs-fixed.md`: an entry for each, newest first.
- `CHANGELOG.md`: Unreleased, Fixed. Plain, no assumed context.
- `docs/to-verify.md`: what changed and how Aryan checks it, after the full self-test.
- `docs/features-updates.md`: the restart window table. `docs/features-notifications.md`: the watch. `docs/features-claude-session-resume.md`: the record as a second source of the id.
- `CLAUDE.md`: the file structure, the test count, the Docs list (this plan and note-03).
- `docs/screenshots/<round>/`: captures and recordings, numbered and named for what they show.

The bug entries and the note are on `manual-testing-fixes`, not `main`. Branch from `main` and merge `origin/manual-testing-fixes` into the work so they can be closed in the same PR, as commit 2ece50e did.

## Out of scope

Other update experience work Aryan wants to discuss first: "Update can install a newer version than the notice offered without saying so", "What's new shows only the newest release when an update skips versions", and "afterterm has no button or setting to download updates automatically". Also the unexplained earlier runs of turns without a Stop hook (2, 7, 11 and 12 October), noted in note-03.

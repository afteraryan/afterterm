# Why the restart window said "Safe to restart" while a chat was running

Written 2026-11-06 at Aryan's request, for the entry of the same name in `docs/bugs.md`, from reading the source and the live files. Tested on 2026-11-07, also at Aryan's request: every claim below says whether it was run, and three claims from the first version turned out wrong (see "Claims that testing corrected"). Nothing here has been built.

Tested on afterterm 0.15.0 (`main` at 19b6129) and Claude Code 2.1.319. The hook removal used the exact packaged exe from the incident. The rest used the dev build through the agent harness with a test update feed, real Claude Code sessions on Haiku, and a scratch `CLAUDE_CONFIG_DIR` for the app. Captures and recordings: `docs/screenshots/restart-window-hypothesis-test/`.

Two separate faults met here. A test launch removed the hooks, which only testing can do. The restart window then read the missing signals as safe, which also happens with no test involved and with hooks working.

## What a hook is

Claude Code's settings file, `~/.claude/settings.json`, can hold entries saying "when this event happens, run this script". afterterm adds five, all running `~/.claude/hooks/afterterm-notify.ps1`:

| Event | What the script does for afterterm |
|---|---|
| SessionStart | Sets the baseline title; saves the session id if the chat was resumed |
| UserPromptSubmit | Sets the working title; saves the session id and folder |
| Notification (permission prompt) | Sets the needs-permission title and rings the bell |
| Stop | Sets the done or background title; saves the session id and folder |
| PreCompact | Sets the compacting title |

The titles become a thread's working, needs-you, done, background and compacting states and its toasts. The saved session id is what makes a thread a chat and lets it resume.

"Removed" means those entries were deleted from `settings.json`. The script file stayed where it was, and the rest of the file was kept.

## How the hooks were removed

afterterm removes them itself. `reconcileClaudeHook` (`src/claude-hook-install.ts`) runs on every launch and reads `claudeNotifications` from `prefs.json`. When it is not `"disabled"`, it makes sure the five entries are there. When it is `"disabled"`, `removeAftertermEntries` deletes them, which is the opt-out.

The two paths it uses come from different places (`reconcileNotifierHook` in `main.ts`):

- `prefsPath` comes from `app.getPath('userData')`, which follows `AFTERTERM_USER_DATA_DIR`, so a test launch reads its throwaway `prefs.json`.
- `claudeDir` comes from `getClaudeDir()`, which is `CLAUDE_CONFIG_DIR`, or else `app.getPath('home')` plus `.claude`.

So the opt-out is read from the throwaway profile and carried out on the real settings. **Only `CLAUDE_CONFIG_DIR` protects a test launch.** `app.getPath('home')` ignores `USERPROFILE` and `HOME` on Windows: with both set to a scratch folder, Electron 35.7.5 still returned `C:\Users\Aryan`.

### The incident, by the clock

| Time | What happened |
|---|---|
| 2026-11-06 14:34:16 | Last Stop hook record in the chat cutting the 0.15.0 release (`tab-319`, session `0a7299d0`). |
| 14:35:50 | That chat smoke-tests the packaged 0.15.0 build: `AFTERTERM_USER_DATA_DIR` set to a throwaway folder, a `prefs.json` there with `"claudeNotifications":"disabled"`, no `CLAUDE_CONFIG_DIR`. |
| 14:35:52 | The throwaway `prefs.json` is written. The real `~/.claude/settings.json` is rewritten with `"hooks": {}`. |
| 14:37:02 | The release chat's turn ends with no Stop hook record: a chat already running lost its hooks too. |
| 14:37:55 | The chat in the screenshot starts (`tab-321`, session `4d8b259d`). No hook records, no `claude-sessions\tab-321.json`. |
| 14:39 | Aryan clicks Restart to update and takes the screenshot. |
| 2026-11-07 12:08:56 | Aryan restarts afterterm into 0.15.0. |
| 12:08:57 | `settings.json` is rewritten with all five hooks. The hooks had been gone for 21 hours 33 minutes. |
| 12:09 | `tab-321` comes back as a plain terminal, as its row said. Aryan starts Claude and resumes the chat by hand. The other two chats resume by themselves. |

Every hook moment before the wipe ran exactly one hook, so afterterm's were the only hooks in the file and Aryan lost nothing else.

### What the tests showed

| Test | Result |
|---|---|
| Exact 0.15.0 exe, scratch `USERPROFILE` and `HOME`, no opt-out | The scratch settings were not touched and prefs show the install ran, so it went to the real `~/.claude` (which needed no change). |
| Exact exe, scratch Claude folder, hooks present, no opt-out | Hooks unchanged (control). |
| Exact exe, scratch Claude folder, throwaway prefs with the opt-out | **Reproduced.** All afterterm entries gone about a second after launch; other settings kept. |
| Normal launch after that | All five back within a second. Matches the real restart at 12:08:57. |
| A hook of another tool in its own group | Survives the opt-out. |
| A hook of another tool sharing a group with afterterm's | **Deleted by the opt-out and never restored.** A second defect. |
| A different hook script in the Claude folder, normal launch | Overwritten with the build's own copy. So any test launch without `CLAUDE_CONFIG_DIR` also overwrites the real script. |
| Real chat with hooks in a settings file, removed and put back while it runs | Hook lines per prompt: 2, then 0, then 2, then 2. **A running chat loses and regains hooks live, with no restart.** |

The real file matched its backup after every test.

### Was the removal only caused by testing?

Yes. It needs `AFTERTERM_USER_DATA_DIR`, which only test launches set, with a seeded opt-out. Nothing in `src` on `main` sets `claudeNotifications` to `"disabled"`. The harness seeds only `claudeHookToastShown: true`; the release session wrote the opt-out into its own smoke test. `docs/features-updates.md` already shows the safe way (`--env CLAUDE_CONFIG_DIR=<scratch>`).

From the transcripts: from 2026-10-15 to 2026-11-05, 1,012 of 1,018 finished turns ran their Stop hook. On 2026-11-06, the three turns finished after 14:35:52 ran none.

Not explained: earlier runs of turns without a Stop hook, each within one session: 2026-10-02 (8 turns), 2026-10-07 (5), 2026-10-11 (4), 2026-10-12 (3). No test launch seeding the opt-out appears on those days. Whether other chats lost their hooks then was not checked.

## The restart window: what it says against what is true

Real sessions, tested with the window open at the moment described.

| # | Situation | What was really happening | Row | Status line | Right? |
|---|---|---|---|---|---|
| 1 | Chat with no hooks, mid-reply (Aryan's bug) | Working | Opens in its folder | Safe to restart | **Wrong** |
| 2 | Chat with hooks, mid-reply (control) | Working | Stops mid-turn | 1 chat stops mid-turn | Right |
| 3 | Chat with hooks, output stalled 4 seconds mid-reply | Working for 18.6 more seconds | Resumes | Safe to restart | **Wrong** |
| 4 | cmd running `ping -n 120` | Running | Opens in its folder | Safe to restart | **Wrong** |
| 5 | PowerShell 7 running `Start-Sleep -Seconds 90` | Running | Opens in its folder | Safe to restart | **Wrong** |
| 6 | Chat whose turn ended with a background task | `PING.EXE` running under Claude | Resumes | Safe to restart | **Wrong** |
| 7 | Chat that was exited, its shell running `ping` | Claude gone, command running | Resumes | Not safe only because of another chat | **Wrong** |
| 8 | Chat waiting on a question, manual and auto mode | Waiting | Stops mid-turn | Warning | Right |
| 9 | Chat at a permission prompt | Waiting | Stops mid-turn | Warning | Right, but late (below) |
| 10 | Another notify hook registered before or after afterterm's | Working | Stops mid-turn | Warning | Right |

Row 3: the stall was forced by pausing one test Claude. `working` dropped and did not come back for the rest of the turn, so the sidebar spinner went too. In unforced turns `working` held for the whole turn, 46 seconds in view and 26 seconds in a hidden thread. How often a stall happens in real use is not known.

Row 9: `attention` arrived 6.8, 6.8 and 8.2 seconds after Claude's own record said `waiting`. During that gap the state is empty, so the chat reads "Resumes" and can read "Safe to restart" (from the state, not captured in the window).

Why these come out wrong, in `update-check.ts` and `threadView.ts`, the same on `main`:

- `threadKind` says chat only when `claudeSessionId` is set, and nothing ever clears it when Claude exits (rows 1 and 7).
- `isMidTurn` reads only `notification`, and `background` does not count (rows 3 and 6).
- `restartRows` cannot say anything is at risk unless it is a chat with a session id (rows 1, 4, 5).
- `restartStatus` says "Safe to restart" when no row is "Stops mid-turn". It never asks whether a thread is running something.

## Signals afterterm could read instead

| Signal | What it gave in the tests | Limits |
|---|---|---|
| Claude Code's own record, `~/.claude/sessions/<pid>.json` | `sessionId` and `status` (`busy`, `idle`, `waiting`, `shell`). Right in rows 1, 2, 3, 6, 8, 9, including no hooks and the stall. `waiting` arrives at once. The pid is a direct child of the thread's shell. The id matched the real transcript where afterterm had none. It follows `/clear`. The file goes on `/exit`. | An undocumented internal file that may change. Records stayed briefly after a hard kill, so the pid must be checked. |
| Prompt marks (`commandState`) | Right for shells in rows 4, 5, 7, on cmd and PowerShell 7, including built-in commands. Back to "at prompt" after a command ends and after Claude exits. | Says "not at prompt" the whole time Claude is open, so it cannot tell a working chat from an idle one. Git Bash and WSL not tested here. Absent when integration is opted out. |
| Title glyph | `◐◓◑◒` while busy and `✳` when idle, with no hooks, and correct through the stall. | Reads `✳` while waiting on a question. |
| Child processes | Found `PING.EXE` and `claude.exe` under their shells. | **Missed `Start-Sleep`**, which runs inside the shell, so it cannot be the main signal. |
| Hook states | Right when they arrive. | Absent without hooks, lost after a stall, 7 to 8 seconds late at prompts. |

## Fixes needed

Nothing below has been built. Whether each works as a whole is still to be tested; the "Evidence" column is what the tests already support.

| # | Fix | Where | Evidence |
|---|---|---|---|
| 1 | A launch with `AFTERTERM_USER_DATA_DIR` set leaves Claude Code's folder alone, entries and script, unless `CLAUDE_CONFIG_DIR` is set too. | `reconcileNotifierHook` in `main.ts` | Reproduced removal; script overwrite |
| 2 | The opt-out removes only afterterm's own hook from a group, not the whole group. | `removeAftertermEntries` | Other tool's hook lost |
| 3 | Correct the harness README's scratch home claim, and make the harness pass a scratch `CLAUDE_CONFIG_DIR` by default. Add the rule to the release guide's smoke test. | `scripts/agent-harness`, `docs/guide-02-releases.md` | `app.getPath('home')` test |
| 4 | Put the hooks back while the app runs: when the entries disappear and notifications are on, add them again. | New watch in main, calling `reconcileClaudeHook` | Running chats regain hooks live; 21 hour 33 minute outage |
| 5 | Read Claude Code's record for each thread and take the session id from it when the hook gave none, so a chat is a chat and resumes. Hooks stay as the fallback. Check the pid is alive. | Main (the server watcher's process read), `threadKind` | Row 1; Aryan's chat coming back as a terminal |
| 6 | A chat is mid-turn when its record says `busy` or `waiting`. | `awakeThreads`, `isMidTurn` | Rows 1, 3, 9 |
| 7 | A chat with a background task gets its own row, and the restart is not called safe. | `restartRows`, `restartStatus` | Row 6 |
| 8 | A shell not at its prompt gets its own row naming the command, and the restart is not called safe. | `restartRows`, `restartStatus` | Rows 4, 5 |
| 9 | A thread whose Claude has exited follows the shell rules, not the chat rules. Whether Wake still resumes that chat is for Aryan to decide. | `threadKind` or `wakePlan` | Row 7 |
| 10 | "Safe to restart" shows only when every thread is known to be idle. When a thread's state is unknown, it does not show. | `restartStatus` | Rows 1, 3 to 7 |
| 11 | `working` does not clear on silence while the record says `busy`, and the record feeds the spinner too, so a chat without hooks still shows as working. | `spinnerState.ts`, `app.tsx` | Row 3 |
| 12 | Remove the comment in `afterterm-notify.ps1` saying Claude Code keeps only the first hook's output. | The hook script | Row 10 |

## Claims that testing corrected

- **"Another notify hook registered first loses the working state."** False on Claude Code 2.1.319. `working` arrived in both orders (row 10). The claim came from a comment in the hook script.
- **"A scratch home keeps a test away from the real settings."** False (above). The first version of this note and of the bug entry repeated the README's claim, and following it would have wiped the real hooks again.
- **"Child processes can tell a busy shell from an idle one."** Not on their own: `Start-Sleep` has none.

A suspicion that also did not hold: that a question goes unnoticed in auto mode because the hook suppresses permission titles. The title arrived and the row was right (row 8).

## Not tested

- Prompt marks on Git Bash and WSL.
- Regaining hooks live through the user-level `settings.json`. The test used a project's local settings file, to avoid touching the real one. Losing them live through the user-level file was seen in the incident.
- A machine where hooks cannot run at all, such as Group Policy. It should behave like row 1.
- A permission prompt in auto mode.
- The fixes themselves.

## Things that went wrong during the tests

- Keystrokes meant for a chat landed on Claude Code's "Teach auto mode about your environment?" panel twice, once from an invitation in a new folder and once because a failed sidebar click (the five-row fold hid the row) left a different thread active. Both test sessions were killed on that first panel. **Continue was never pressed and nothing was scanned**: the sessions ran no tool except the test ping, and the real settings file still matched its backup.
- One prompt answered a pending question, and `/exit` went to Claude rather than the shell. Those captures are named for what they show, and the tests were rerun.
- Left behind by the tests: Claude Code's own records of those sessions (transcripts for the scratch folders and the test prompts in `history.jsonl`).

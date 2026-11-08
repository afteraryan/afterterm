# Test report: an inherited cmd prompt is wrapped once, and the opt-out holds (AFT-69, PR #88)

Tester: Stream 6 tester, 2026-11-08. Branch `fix-inherited-cmd-prompt` at commit `759c694` (the implementer's two commits on top of `fac29ed`). No source file was changed. Everything the tester added is in this folder, numbered from 20.

## Result in one paragraph

All five rows pass, and one extra row (pwsh and Git Bash threads) passes. With a marked `PROMPT` inherited, a cmd thread sends OSC 133;A, OSC 133;B and OSC 9;9 exactly once per prompt (5 prompts, 5 of each, counted in the raw data the pty sent). A doubly marked inherited prompt also comes out single. With `shellIntegration.cmd` set to `off`, there are no marks at all and `%PROMPT%` is the user's original prompt. A custom green prompt survives in both modes. A cmd thread with no inherited `PROMPT` behaves as before. `npm test`: 3015 checks passed, 0 failed (35 test files).

## Setup

- Worktree `D:\Pitara\Work\Tinkering\afterterm\.claude\worktrees\cmd-prompt`, branch `fix-inherited-cmd-prompt`, tree clean at the start.
- Data dir `...\scratchpad\tester-cmd-prompt\data`, `CLAUDE_CONFIG_DIR` a scratch folder `...\scratchpad\tester-cmd-prompt\claude-config`, debug port 9391, always `--data-dir` on every call. `claudeNotifications` was never seeded.
- Display: `drive bounds` before every launch showed the window at x=2240, y=126 on `\\.\DISPLAY2`, `primary: false` (the secondary display).
- The shell this tester ran in already carried a marked prompt: `$env:PROMPT` printed `$E]133;A$E\$E]9;9;$P$E\$P$G$E]133;B$E\` (one wrap of `$P$G`, the value a parent afterterm exports) and `AFTERTERM=1`. So this Claude session itself runs inside an afterterm cmd thread, which is exactly the situation the bug describes. For every row the value was set explicitly in the PowerShell that launched the harness, because `--env` splits on `;` and the marks contain `;`.
- The marked values were built from the exported functions in `src/shell-integration.ts` (`wrapCmdPrompt`, applied once or twice), not typed by hand. Their exact text is at the top of each `*-counts.txt`.
- Each row used a session fixture with one asleep cmd thread (`tab-cmd-1`) in a project whose folder is `%TEMP%\tcp`. Per row: open the workspace, confirm with `drive screen` and `drive header` that the active thread is `tab-cmd-1` and asleep, register a listener on the thread's raw pty data (`window.afterterm.pty.onData`) before Wake, Wake, read `drive marks`, click the terminal, type a label line, Enter, Enter, Enter, `echo %PROMPT%`, Enter. That is 5 prompts in the terminal. The counts are regular expressions over the whole raw pty stream, ESC and BEL shown as text in each `.txt`.

## Rows

| Row | Set up | Result | Capture | What was seen |
|---|---|---|---|---|
| 1 | integration on, inherited `PROMPT` marked once | pass | `20-row1-on-inherited-marked-echo-prompt-shows-one-wrap.png`, `21-row1-on-inherited-marked-counts.txt` | 5 prompts, A=5, B=5, cwd=5 (first prompt alone: 1, 1, 1). `%PROMPT%` prints one wrap: `$E]133;A$E\$E]9;9;$P$E\$P$G$E]133;B$E\`. `drive marks` says at prompt: yes. |
| 2 | integration on, inherited `PROMPT` marked twice (two generations) | pass | `22-row2-on-doubly-marked-echo-prompt-shows-one-wrap.png`, `23-row2-on-doubly-marked-counts.txt` | Same counts, A=5, B=5, cwd=5 for 5 prompts, and `%PROMPT%` is the single wrap, not the double. |
| 3 | `--prefs {"shellIntegration":{"cmd":"off"}}`, inherited `PROMPT` marked once | pass | `24-row3-off-inherited-marked-echo-prompt-shows-plain-prompt.png`, `25-row3-off-inherited-marked-counts.txt` | A=0, B=0, cwd=0, and not even an `ESC]133;` or `ESC]9;9;` prefix in the raw data. `%PROMPT%` prints `$P$G`. `drive marks`: at prompt: no. The harness log line says `integration=off`. |
| 4a | integration on, inherited custom prompt `$E[32m$P$G` marked once | pass | `26-row4a-on-custom-green-prompt-kept-and-marked-once.png`, `27-row4a-on-custom-green-prompt-counts.txt` | The prompt is green. 5 prompts, A=5, B=5, cwd=5. `%PROMPT%` prints one wrap round `$E[32m$P$G`. |
| 4b | cmd opt-out, inherited custom prompt `$E[32m$P$G` marked once | pass | `28-row4b-off-custom-green-prompt-kept-no-marks.png`, `29-row4b-off-custom-green-prompt-counts.txt` | The prompt is green, A=0, B=0, cwd=0. `%PROMPT%` prints `$E[32m$P$G`, the user's own text with no marks. |
| 5 | integration on, no `PROMPT` in the launching shell at all | pass | `30-row5-on-no-inherited-prompt-marks-once.png`, `31-row5-on-no-inherited-prompt-counts.txt` | A=5, B=5, cwd=5 for 5 prompts. `%PROMPT%` is one wrap of the default `$P$G`, as before the fix. |
| 6 (extra) | pwsh and Git Bash threads, integration on, inherited marked `PROMPT` plus a stale `PROMPT_COMMAND` and `AFTERTERM_BASH_HOOK` | pass | `32-row6-extra-pwsh-thread-inherited-prompt-stripped.png` (Git Bash was run in the harness and passed; only its capture `33` and the env text `34` were dropped from the branch, because they show this machine's name in the Git Bash prompt and the repo is public) | pwsh: `PROMPT=[$P$G] PC=[] HOOK=[] AFTERTERM=[1]` (marks stripped, the leaked bash variables gone, `AFTERTERM` kept). Git Bash: `PROMPT=[$P$G]`, `PROMPT_COMMAND=[__afterterm_precmd]` once, hook variable 1685 characters (the one planSpawn sets). Both shells show `at prompt: yes`. |

The recording across the rows is `37-rows-1-to-5-and-pwsh-one-recording.mp4` (134 seconds, the launches joined in order; each segment starts with its label typed into the terminal, `ROW 1` to `ROW 6`). It was first saved as `37-rows-1-to-6-one-recording.mp4` at 148 seconds; the last 14 seconds, the Git Bash part of row 6, were cut because the Git Bash prompt shows the machine's host name. Git Bash was run in the harness in row 6 and passed; the Git Bash result has no capture on the branch now.

Note on the green count in rows 4a and 4b: the raw data holds more `ESC[32m` than there are prompts (9 and 7). That is ConPTY re-sending the colour in front of typed text, not marks. The mark counts are the A, B and cwd columns.

## More evidence

- `35-baseline-vs-fixed-planspawn-output.txt` (made by `35-baseline-vs-fixed-planspawn.mjs`): the same inherited values fed to `planSpawn` from `fac29ed` (before the fix) and from this branch. Before: single-wrapped input comes out with the marks twice with integration on, and the opt-out still returns the marked value; double-wrapped input comes out with three. After: always one wrap with integration on, the plain original with it off, and with no inherited prompt both are as before. This reproduces the bug at the function level only. The app was not run on `main`. After the review the script was changed to pass `inheritedFromAfterterm: true` (the fixed planner strips only when afterterm was started from an afterterm thread) and was rerun at the new head; the output is the same.
- `36-npm-test-output.txt`: the whole `npm test` output (one em dash in a test name was replaced by a hyphen when saving). 3015 `PASS` lines, no `FAIL`, 35 per-file summaries; `src/shell-integration.test.ts` alone is 170 passed, 0 failed.

## The implementer's captures, opened and described

- `01-run-on-launched-on-home-screen.png`: the Home screen of the dev build, date heading, one pinned project card "cmd prompt test", empty Projects list. Shows the launch worked and the fixture loaded.
- `02-run-on-workspace-thread-asleep.png`: the workspace with the sidebar showing project "cmd prompt test" and one asleep thread "cmd", the header says Asleep, the pane has a Wake button. Shows the starting state before Wake.
- `03-run-on-marks-arrive-once-per-prompt.mp4` (31.6 s): the recording of the integration-on run. Its last frame is the cmd thread at its first prompt after Wake (path of the worktree, cursor after `>`), so the typed commands are not in the video (the same sparse-frame problem noted below); the counts are in `06`.
- `04-run-on-first-prompt-one-mark-pair.png`: the cmd.exe thread after Wake, banner and one prompt line, the sidebar row now live. Shows the first prompt of the integration-on run.
- `05-run-on-four-prompts-four-mark-pairs-and-echo-prompt.png`: four prompt lines and the output of `echo %PROMPT%`, which is one wrap of `$P$G`. Matches the text file `06`.
- `06-run-on-marks-and-prompt-output.txt`: A=4, B=4, cwd=4 for 4 prompts, `at prompt: yes`, `integration=on` in the harness log.
- `07-run-off-workspace-thread-asleep.png`: the starting state of the opt-out run, the cmd thread asleep with a Wake button.
- `08-run-off-no-marks-original-prompt.mp4` (26.9 s): last frame is the cmd thread at its first prompt, no sign of marks (a recording cannot show escape sequences, the counts are in `11`).
- `09-run-off-first-prompt-no-marks.png`: the first prompt of the opt-out run, identical in look to `04`, as it should be.
- `10-run-off-four-prompts-zero-marks-and-echo-prompt.png`: four prompts and `echo %PROMPT%` printing `$P$G`.
- `11-run-off-marks-and-prompt-output.txt`: A=0, B=0, cwd=0, `at prompt: no`, `integration=off`.

Their runs and mine agree. Mine add: a doubly marked input, a custom prompt in both modes, the no-inherited-prompt control, other shells, and counts that include the very first prompt from a listener registered before Wake (the implementer's `06` says the first prompt was counted separately).

## What was not tested, and why

- A real nested launch (an afterterm started by hand from inside an afterterm cmd thread) was not done. The launching shell's `PROMPT` was set in the PowerShell that started the harness, which is the same thing the app inherits, and the green prompt surviving in rows 4a and 4b shows the inherited value did reach the dev build's shells.
- The harness ran the dev build only. The packaged build was not run.
- WSL: not installed on this machine, so only the unit tests cover it.
- The restart-and-wake path (sleep, then Wake again in the same run) was not repeated per row: every row spawns the cmd once.
- No real Claude Code was started and no Claude session id was used.

## Process notes

- The first recordings of rows 1 and 6 were sparse: Chromium's screencast sent only 16 and 15 frames and the later typing never appeared in the video. Both rows were run again in one scripted call (71 and 146 frames). The first runs gave identical values (row 1: 5, 5, 5; row 6: the same two lines); the screenshots and `.txt` files for those rows are from the second run.
- The harness log in a reused data dir keeps earlier launches' `pty:create` lines, so each `.txt` keeps only the line of its own launch.
- Image `33`, the Git Bash text in `34` and the Git Bash part of the recording showed this machine's host name in the Git Bash prompt (the prompt Git Bash draws by default). The repo is public, so `33` and `34` were removed from the branch and the recording was cut before the Git Bash part (2026-11-08). History was not rewritten: the removed files (`33`, `34` and the uncut recording `37-rows-1-to-6-one-recording.mp4`) stay in the branch's history, in commit `d39e2fd`, and will be in main's history after the merge, because this repo merges pull requests with merge commits. What they show is this machine's name in a Git Bash prompt, nothing personal. Aryan can ask for a history rewrite before merging if he wants one. No people, video calls or other windows were in any capture.

## Linear

No comment was made on AFT-69: the tester brief names no issue id to comment on. The orchestrator moves the issue.

## Real Claude folder hashes

| File | Before the first launch | After the last launch (and after `npm test`) |
|---|---|---|
| `C:\Users\Aryan\.claude\settings.json` | `2CBF2BE4E19D4BC064091C306D676F5BD3A73A344D761D677C61BB4E75126919` | `2CBF2BE4E19D4BC064091C306D676F5BD3A73A344D761D677C61BB4E75126919` |
| `C:\Users\Aryan\.claude\hooks\afterterm-notify.ps1` | `21A8E8A0A170955FB4E1760E49020DC22FE2261CA1C45DAAAB3173E3E668633B` | `21A8E8A0A170955FB4E1760E49020DC22FE2261CA1C45DAAAB3173E3E668633B` |

Both were also re-hashed after each of the nine launches (rows 1 and 6 were each run twice) and matched each time. Both match the values in the common rules.



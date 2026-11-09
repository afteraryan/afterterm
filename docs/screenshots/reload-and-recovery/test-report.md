# Test report: window recovery (AFT-33, PR #94) on head 74454e8

Tested 2026-11-09 by the tester of stream 4, in the agent harness from the worktree `reload-and-recovery`, branch `window-recovery`, head `74454e8`. Own data folder `tester-window-recovery`, own scratch `CLAUDE_CONFIG_DIR`, port 9461, window on the secondary display (`drive bounds`: DISPLAY2, not primary). Source was not changed. Captures 70 to 109 are mine; 01 to 60 are the implementer's (listed at the end).

Fixture: one project "Recovery test" with three cmd threads (`tab-201` cmd one, `tab-202` cmd two, `tab-203` cmd three), no Claude ids. cmd one and cmd two were woken; in each, `set MARK_1=pelican` (cmd one) and `set MARK_2=walrus` (cmd two) and `echo %RANDOM%` (23621 and 23686). The two cmd shells ran as pids 46932 (cmd one) and 16736 (cmd two) under the dev electron (pid 38284) for the whole run. cmd three stayed asleep.

`npm test` on this head: 39 files, 3394 passed, 0 failed.

## Result per row

| Row | What was tested | Result | Evidence | What was seen |
|---|---|---|---|---|
| 1 | Forced renderer crash (`recovery.test('crash')`) | pass | 70 (mp4), 71, 72, 73, 74, 75, 109 | Window came back by itself about 1.4 s later on the workspace with cmd two active, both threads awake, cmd three asleep. `echo MARK2 is %MARK_2%` printed `walrus`, `echo MARK1 is %MARK_1%` printed `pelican`, pids 46932 and 16736 unchanged. |
| 2 | `drive reload` through CDP | pass | 81, 82, 83 | Same screen and thread, both awake, cmd three asleep. `walrus` and `pelican` echoed again, same two pids, log shows `pty:attach tab-201 pid=46932` and `pty:attach tab-202 pid=16736`, no `pty:create`. |
| 3 | Needs-you title, then a crash, then no new toast | pass | 70 (mp4), 76 (png and txt), 77 (png and txt), 78 | cmd two wrote `title <warning sign> question for you`: row `needs-you`, `counts waiting=1`, rail tile and project pill showing 1. After the crash all of it was the same and `drive toasts` read `(no toasts)`. Baseline in 78: a needs-you title from a thread that is not on screen does raise a toast in this build (`"cmd one" Recovery test· Needs permission`), so the empty list after the crash is a real absence. |
| 4 | Panel width dragged, crash within 1 s, width kept | pass | 84, 85, 86 (txt), 87 | Dragged the edge from 264 to 506, then to 421, crashed 0.9 s later: 421 after the reload, and `session.json` read 421 five seconds after the crash (it read 506 right before). Second run, crash 144 ms after the drag with the file still at 421 right after the crash was sent: 180 (the minimum) after the reload, file at 180 eight seconds later. So the width came from main's remembered copy, not from the 2 s save. |
| 5 | Hidden thread keeps its columns | pass | 88, 89, 90, 91, 92 (txt) | Window 1900 px wide, shells at 200 columns (`mode con`, 88). cmd one ran a loop writing `mode con \| findstr Columns` about 37 times a second to a file, then cmd two was put on screen (cmd one hidden, 89) and the page crashed. 1156 samples in all, 616 of them after the crash: every one said 200 (92). Main logged `pty:attach tab-201 pid=46932 size=200x56`. After stopping the loop and showing cmd one, `mode con` still said 200 (91). The loop makes the check sample the hidden shell without showing it, since showing it would fit it and hide a wrong size. |
| 6 | Thread made about 1 s before a crash | pass | 93, 94, 95 (txt) | New thread `tab-204` made by the chooser, crash 956 ms later. After the reload it was in the list, awake and on screen, one shell for it (cmd pid 20328, one `pty:create tab-204`, then `pty:attach tab-204 pid=20328`), never a second one. Three cmd shells before the next step. The next new thread was `tab-205`, a fresh id, one more shell (pid 23548). |
| 7 | Four crashes within a minute | pass | 96 (mp4), 97, 98, 109 | Crashes at 02:28:39, :42, :45, :48 (local). Three reloads happened; the fourth logged `not reloading ... reloaded 3 times in 60s, trying again in 51s`, the window was blank meanwhile (97, whole-window capture), and the reload ran 51 s later with all four shells attached, same pids (98). |
| 8 | Hang path | pass, with one limit | 70 (mp4), 79, 80, 109 | Page kept busy by a 60 s loop, unresponsive report sent by the harness hook. 15.0 s later main ended the renderer, 1.3 s after that the page was loaded again with both shells; same screen, thread, both needs-you, cmd three asleep, same pids. The limit: the unresponsive report is the harness's own (`recovery.test('unresponsive')`), as the README says; Chromium's own hang verdict cannot occur while the harness is attached. Everything after the report is the real path. |
| 9 | Graceful quit and relaunch, same data folder | pass | 106, 107, 108 | `drive window quit`, then launch again without `--session`. Home screen, all five threads asleep, `session.json` had every thread `asleep: true` and the panel width kept, no `pty:attach` or `pty:create` after the relaunch, no cmd process under the new electron, nothing new in `recovery.log`. |
| 10 | WebGL context lost through the canvas | pass | 99 (mp4), 100, 101, 102, 103, 104, 105 | Test A, lost and never restored: text gone 0.5 s after (101), drawn again by 5 s (102) by a fresh WebGL renderer (`renderer('tab-201')` went from `webgl, losses 0` to `webgl, losses 1`, new context not lost). Test B, lost again then `restoreContext()` called after about 1.2 s: blank (103), text back 1.5 s after the restore (104), still drawn 5 s later (105). |

One recording covers rows 1, 3 and 8 (70, 3 minutes, the crash frames themselves are brief and fall between most sampled frames; the PNGs hold each state).

## recovery.log lines quoted

Times are UTC (the machine is 5 h 30 min ahead).

Row 1, the first crash:

```
2026-11-08T20:50:56.216Z main: renderer gone, reason=crashed exitCode=2
2026-11-08T20:50:57.220Z main: reloading the page after the renderer crashed
2026-11-08T20:50:57.592Z main: page loaded with 2 live shell(s): tab-201, tab-202
```

Row 8, the hang (the report is the harness's; 15.0 s from it to the end of the renderer):

```
2026-11-08T20:53:14.196Z main: unresponsive; ending it if it still is in 15s
2026-11-08T20:53:29.204Z main: still unresponsive after 15s, ending its renderer
2026-11-08T20:53:29.212Z main: renderer gone, reason=crashed exitCode=2
2026-11-08T20:53:30.217Z main: reloading the page after the renderer crashed
2026-11-08T20:53:30.540Z main: page loaded with 2 live shell(s): tab-201, tab-202
```

Row 7, the four crashes (the first three reload, the fourth waits):

```
2026-11-08T20:58:39.719Z main: renderer gone, reason=crashed exitCode=2
2026-11-08T20:58:40.726Z main: reloading the page after the renderer crashed
2026-11-08T20:58:41.048Z main: page loaded with 4 live shell(s): tab-201, tab-202, tab-204, tab-205
2026-11-08T20:58:42.857Z main: renderer gone, reason=crashed exitCode=2
2026-11-08T20:58:43.872Z main: reloading the page after the renderer crashed
2026-11-08T20:58:44.177Z main: page loaded with 4 live shell(s): tab-201, tab-202, tab-204, tab-205
2026-11-08T20:58:45.984Z main: renderer gone, reason=crashed exitCode=2
2026-11-08T20:58:46.995Z main: reloading the page after the renderer crashed
2026-11-08T20:58:47.296Z main: page loaded with 4 live shell(s): tab-201, tab-202, tab-204, tab-205
2026-11-08T20:58:49.122Z main: renderer gone, reason=crashed exitCode=2
2026-11-08T20:58:50.125Z main: not reloading after the renderer crashed yet: reloaded 3 times in 60s, trying again in 51s
2026-11-08T20:59:41.759Z main: reloading the page after the renderer crashed
2026-11-08T20:59:42.073Z main: page loaded with 4 live shell(s): tab-201, tab-202, tab-204, tab-205
```

The whole file is capture 109. Two `page loaded with ...` lines have no crash before them: 20:50:34 is my first `window.afterterm.recovery.state()` call from the page (it logs too) and 20:54:08 is the `drive reload` of row 2.

## Things noticed that are not rows

- The recordings (mine and the implementer's) are page screencasts, which send no frames while the page is gone. My recording 96 therefore shows the last page frozen through the 51 s wait; the blank window is only in the OS-level capture 97. The implementer's recording 35 ends on the page's empty "No threads open" state from 3.2 s to the end (8.3 s) and never shows the new thread back; its PNG 36 and my row 6 (93, 94) show the thread is back, so this looks like a stale screencast, not a product problem, but the video alone does not prove the row.
- After a crash the active thread's `lastActiveAt` moved (cmd two: 1794171110550 before, 1794171138085 after, no click between). Viewing a thread sets it anyway; low confidence that it matters.
- The fixture's two woken threads started in `C:\Users\Aryan` (`cwdFallback=true`) because the fixture tabs carry no folder of their own; the threads made through the chooser started in the project folder. A fixture detail, nothing to do with recovery.

## Not tested

- Real low memory, which is what froze the window on 2026-10-02: not reproducible on purpose.
- Chromium's own hang verdict (row 8 uses the harness's report).
- A real Claude Code chat or a server being re-attached: only cmd threads were run, as the rules say.
- The background-work flag and the done, working and compacting states over a reload: only needs-you was driven (the brief's row 3).
- The GPU-process path (`recovery.test('gpu')`) and the three-losses-to-DOM-renderer path: not in the rows; the implementer's captures 22 to 30 cover them and I only looked at those.
- An orphan shell, and a shell that exits between the state call and its attach: unit tests only.

## The implementer's captures (01 to 60), what each shows

Every PNG was opened as a cropped contact sheet (top left 600 x 290 of each capture, labelled), every mp4 as nine frames spread over its length. I did not replay the videos.

| Capture | What it shows |
|---|---|
| 01 mp4 | Before the AFT-26 fix: Ctrl+Shift+R sent through CDP, 8 s, nothing changes (cmd one stays on screen with its typed line). |
| 02, 03 | Before the fix: two awake threads, then the same screen after Ctrl+Shift+R through CDP. |
| 04, 05 txt | The harness's menu key list before the fix (View > Reload on Ctrl+R and Force Reload on Shift+Ctrl+R) and after it (no reload entries; Toggle Developer Tools stays). Text files, read as text. |
| 06 mp4 | After the fix: Ctrl+Shift+R, Ctrl+R, F5; Ctrl+R shows as `^R` in the shell, the screen and threads stay. |
| 07, 08, 09 | After the fix: before the keys, after the keys (same screen, both awake), and the window without a menu bar. |
| 10 mp4 | Renderer crash, 45 s: cmd two on screen throughout with its `PROOF=two-...` lines, ends on cmd one with `PROOF=one-...`. The crash frames are brief and fall between the nine sampled frames. |
| 11, 12, 13, 14 | Before the crash (cmd two active); after (same screen and thread, redrawn); cmd one shown redrawn; `echo back %PROOF%` in cmd one printing its own value. |
| 15 mp4, 16 | `drive reload`: cmd one then cmd two, both with their `PROOF` values; echo in cmd two same shell. |
| 17 | A reload on the project page opens the project page again (Home-style page with Open, New thread, Unpin). |
| 18 mp4, 19, 20, 21 | WebGL context lost and given back: text, then a blank terminal (0.7 to 2.0 s), text again by 2.5 s. |
| 22 mp4, 23, 24, 25, 26 | WebGL lost for good, three times: a white box with a broken-image icon while the addon waits (3.7 s), text from a fresh renderer, DOM renderer after the third loss, new output still drawn. |
| 27 mp4, 28, 29, 30 | GPU process ended: same page, text drawn before, after and for new output. |
| 31 mp4, 32, 33, 34 | Hung page: cmd two on screen with `PROOF=two-17091`, cursor gone around 30 s, back on cmd two, then cmd one with `PROOF=one-17091`. |
| 35 mp4, 36 | New thread a second before a crash: the mp4 shows the new thread, then ends on "No threads open" for the last 5 s (see notes above); 36 shows it back awake as `cmd.exe` in the reload-proj folder. |
| 37 | A normal relaunch: Home, "Sunday, 8 November", one pinned project. |
| 38 mp4, 39, 40 | Four crashes in a minute: cmd one on screen with `PROOF=loop-...` the whole time (sampled frames), 39 a whole-window capture that is blank while the fourth waits, 40 after the retry with the same shell (`echo after four crashes loop-18106`). |
| 41 mp4, 42, 43 | Before the fix (fac29ed): a reload lands on Home, then Wake gives a new shell, so `echo %PROOF%` prints `%PROOF%` literally. |
| 44 mp4, 45, 46, 47 | Before the fix, GPU process ended: the text was still drawn afterwards (blank 1.4 s only), new output drawn. |
| 48 mp4, 49, 50 | Before the fix, WebGL lost for good: blank for about 3 s, then text and new output drawn. |
| 51 txt | The same menu key list after merging main: still no reload entries. Text file, read as text. |
| 52 | After merging main, the reload keys leave both threads awake. |
| 53 mp4, 54 | After merging main: crash and reload on cmd two, then cmd one, `echo back %PROOF% one-15287` printed. |
| 55 mp4, 56, 57 | Review fix: a wide panel and cmd one amber (needs-you) with the rail tile badge 1, same before and after the crash. |
| 58 txt | An attach-only `pty.create('tab-999', ...)` for a shell that does not exist answered `attached: false, gone: true`, spawned nothing and logged `nothing spawned`. Text file, read as text. |
| 59 mp4, 60 | Merged with #87: cmd two needs-you (bell, pill 1, rail badge 1) before and after a crash; `echo back %PROOF% one-22063` in cmd one. |

## Claude files

| File | Before the first launch | After the last launch |
|---|---|---|
| `C:\Users\Aryan\.claude\settings.json` | `3D54EDE01E21CE246866F93E8B3EAF2E84EF537528D7C80D11F1B2F9EBDF2F1B` | `3D54EDE01E21CE246866F93E8B3EAF2E84EF537528D7C80D11F1B2F9EBDF2F1B` |
| `C:\Users\Aryan\.claude\hooks\afterterm-notify.ps1` | `21A8E8A0A170955FB4E1760E49020DC22FE2261CA1C45DAAAB3173E3E668633B` | `21A8E8A0A170955FB4E1760E49020DC22FE2261CA1C45DAAAB3173E3E668633B` |

All five hook events (`SessionStart`, `UserPromptSubmit`, `Notification`, `Stop`, `PreCompact`) name `afterterm-notify.ps1` before the first launch, after the quit and relaunch, and after the stop. The settings hash is the one Aryan's model change produced at 02:01 on 2026-11-09 (`3D54EDE0...`) and did not move during this run.

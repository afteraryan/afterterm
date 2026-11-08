# Test report: selecting text after the find bar was used (AFT-44, PR #91)

Tester run, 2026-11-08 and 2026-11-09. Branch `fix-selection-after-find` at `a69503f` (the fix round: a right press now ends the search too, and `origin/main` merged in). The source was not changed by the tester. Result: every row passed, no failures found.

## What was tested and how

- A cmd thread in a throwaway project, run in the agent harness from this worktree on the secondary display (`drive bounds` showed DISPLAY2, not primary), with its own data folder and its own empty Claude folder. Port 9341.
- The busy rows use a PowerShell script started from the cmd thread that rewrites one row twice a second (`live writer tick N`), so the screen does not scroll. Its row never contains the search word, so the re-run of a live search is tested on output that does not match. For the paste row a second script also prints whatever is typed or pasted into the terminal.
- Text evidence is `window.__afterterm.selection(tabId)` (the hook this branch adds), read straight after the mouse release, 1 second later and 3 seconds later. The mouse drag is a real press, 12 moves and release sent over CDP (`tester-scripts/tdrag.mjs`). `drive drag` could not be used: the terminal draws on a canvas, so it has no row elements, and `drive drag` only goes between element centres.
- The clipboard was replaced inside the page (the harness README rule), so Aryan's real clipboard was never touched. `window.__copied` and `window.__copyCount` show what the app wrote to the clipboard. The paste is proved by the second script showing `typed=[PASTE-MARK]`.
- Recordings: `51` (rows 2 to 5, the one asked for), `67` (rows 6 and 7), `75` (row 8), `80` (row 9). I extracted frames from each and checked they show what the table says. Scripts that ran each group are in `tester-scripts/`.
- Writer ticks are quoted to show output kept arriving while the selection was read.

## Rows

| Row | What was done | Result | Captures | What was seen |
|---|---|---|---|---|
| 1 | Drag-select before any search | Pass | `50-row1-drag-select-before-any-search.png`, `.txt` | Selection from row 10 col 5 to row 14 col 20 (191 characters), the same after 1 second. |
| 2 | Search `blue` (bar open, 2/31), then drag-select rows 10 to 14, read at 0, 1 and 3 seconds | Pass | `52`, `53`, `54`, `55`, `62`, `51` | The selection was identical at +2 ms, +1010 ms and +3004 ms (191 characters) while the writer went from tick 21 to tick 29. The bar stayed open with `blue` in its box and a blank match count. |
| 3 | Click in the bar, press Enter, press Enter again | Pass | `56`, `62`, `51` | Enter selected a `blue` and the counter came back (11/31), the next Enter went to 12/31, still 12/31 and selected 2 seconds later. See observation 1. |
| 4 | Close the bar with Esc from its box, drag-select rows 20 to 24 | Pass | `57`, `58`, `62`, `51` | The bar closed and focus returned to the terminal. The drag selection (191 characters) held at 0, 1 and 3 seconds while the writer went from tick 38 to tick 46. |
| 5 | Reopen the bar (its text was kept), search again (21/31), close with the x, drag-select rows 6 to 9 | Pass | `59`, `60`, `61`, `62`, `51` | The bar closed, the drag selection (144 characters) held at 0, 1 and 3 seconds while the writer went from tick 53 to tick 61. |
| 6a | Bar closed, drag-select, right-click | Pass | `63`, `68`, `67` | The clipboard got the 191 characters selected and the selection was cleared. |
| 6b | Bar open with a live search, drag-select, right-click | Pass | `64`, `68`, `67` | The clipboard got the dragged text (191 characters), not the search match. The selection was cleared and the bar stayed open. |
| 6c | Select, Ctrl+C (extra, from the plan) | Pass | `68`, `67` | The clipboard got the selection (144 characters). The writer was not interrupted (tick 134 to tick 137). |
| 7 | Search live (1/31, `blue` selected), focus the terminal without a click, Ctrl+Shift+A | Pass | `65`, `66`, `68`, `67` | The whole buffer was selected (position 0,0 to 112,41, 1950 characters) and stayed identical at 0, 1 and 3 seconds while the writer ticked on. The match count went blank. The terminal was focused with a script, because a click would end the search by itself. |
| 8 | Wake a second thread, search live in the first, switch to the second and back, search and drag in both | Pass | `69` to `76`, `75` | Switching to the second thread closed the bar. In the second thread a search and a drag held for 3 seconds (191 characters). Back in the first thread the bar was closed and its earlier selection was still there. A drag with no search held for 3 seconds (191 characters), and after a second search a drag also held for 3 seconds (144 characters). |
| 9 (added) | Search live over output, first right-click, wait 1.5 seconds, second right-click | Pass | `77`, `78`, `79`, `81`, `80` | The first right-click copied the match (`blue`, one clipboard write) and cleared the selection, and the match count went blank. 1.5 seconds and 3 writes later nothing was selected again. The second right-click made no second clipboard write, and `typed=[PASTE-MARK]` appeared in the writer's row: it pasted. |

Unit tests on this head: `npm test`, every file passed, 2975 passed in total, 0 failed (`82-npm-test-summary.txt`).

An earlier pass of rows 2 to 5 on the previous head `5fe0d91` gave the same results (`83-earlier-pass-on-5fe0d91-rows-2-to-5-log.txt`). The new head was then tested from scratch, and the table above is that run.

## Observations (none of them a failure)

1. After a drag, Enter in the bar selected the first match at or after where the dragged selection started (row 10 when the drag started on row 10), not the first match after where it ended. The plan says "the next match is selected"; a match is selected and the counter and highlights return, and the following Enters advance by one.
2. After a closed bar is reopened, its old text is kept. In one early take, typing straight after Ctrl+Shift+F appended to the old text (`blueblue`, no matches) instead of replacing it, so the box's preselect did not take effect in time. This code was not changed by the PR (`openFind`). It may only be a harness timing effect, so the later takes press Ctrl+A in the box first. Worth a manual look.
3. After Esc, the x, or a drag with the bar open, the last search match stays selected if nothing else was selected (as `docs/features-terminal-interactions.md` says). It shows as a grey `blue` in `60`.
4. In one early take the first mouse drag after `record start` took 7 seconds to send. It did not happen again and is unrelated to the fix.

## What the implementer's captures show (all opened)

| File | What it shows |
|---|---|
| `00-home.png` | Home with one pinned project, `findtest`. |
| `01-awake.png` | The project's cmd thread awake at an empty prompt. |
| `02-output.png` | The thread with 30 numbered lines of output. |
| `03-before-search-selection-works.png` | Before any search, a drag selection over rows 4 and 5 shows grey. |
| `04-find-bar-open-after-search.png` | Bar open, `gamma` typed, 5/31, all matches dimly highlighted, the active one boxed. |
| `05-find-bar-open-drag-select.png` | Bar open with no output arriving: a drag over rows 15 and 16 is selected and the 5/31 counter stays. |
| `06-find-bar-closed-drag-select.png` | Bar closed: a drag over rows 7 and 8 is selected. |
| `07-search-with-live-output.png` | `alpha` searched (1/31) with more output arriving, an early attempt to reproduce. |
| `08-bar-open-live-output-after-drag.png` | Bar open at 31/31 with the last `needle` selected: the first sign that live output replaces a selection. |
| `20-before-fix-bug-whole-sequence.mp4` | Before the fix, in order: the thread with the writer, the bar opens, `needle` searched (13/32), a drag, then the grey selection is gone in favour of the match, then the bar closes and a later drag (rows 20 and 21) is selected. |
| `21-before-fix-selection-works-before-search.png` | Before the fix, writer thread, drag over rows 4 and 5 selected before any search. |
| `22-before-fix-find-bar-open-after-search.png` | Before the fix, bar open, `needle` 1/32. |
| `23-before-fix-bar-open-drag-just-released.png` | Before the fix, right after the drag: no grey selection, the match on row 12 is boxed (13/32). |
| `24-before-fix-bar-open-two-seconds-later-selection-replaced.png` | Before the fix, 2 seconds later: still only the match, the dragged text is gone. This is the bug. |
| `25-before-fix-bar-closed-drag-select-works.png` | Before the fix, after the bar's x, a drag over rows 20 and 21 is selected. |
| `30-after-fix-whole-sequence.mp4` | After the fix: the thread, the bar, `needle` then `epsilon` searches, drags that hold, drags after the x and after Esc, and Ctrl+Shift+A selecting everything. |
| `31-after-fix-selection-works-before-search.png` | After the fix, drag over rows 4 and 5 before a search. |
| `32-after-fix-find-bar-open-after-search.png` | After the fix, bar open, `needle` 1/32. |
| `33-after-fix-bar-open-drag-just-released.png` | After the fix, right after the drag: rows 12 and 13 grey, the highlights and the count gone, the bar still open. |
| `34-after-fix-bar-open-three-seconds-later-selection-kept.png` | After the fix, 3 seconds and several writes later: the same rows 12 and 13 still selected. |
| `35-after-fix-second-search-highlights-and-counter.png` | After the fix, a second search (`epsilon`, 1/31) brings the highlights and the count back. |
| `36-after-fix-second-search-drag-kept-three-seconds-later.png` | After the fix, a drag after the second search is kept 3 seconds later (rows 20 and 21), count blank. |
| `37-after-fix-bar-closed-drag-kept-three-seconds-later.png` | After the fix, bar closed with the x, a drag over rows 8 and 9 kept 3 seconds later. |
| `38-after-fix-closed-with-escape-drag-kept-three-seconds-later.png` | After the fix, bar closed with Esc, a drag over rows 16 and 17 kept 3 seconds later. |
| `39-after-fix-bar-open-select-all-kept-three-seconds-later.png` | After the fix, Ctrl+Shift+A with a search live: the whole buffer is grey, the bar open, the selection kept. |
| `90-aborted-take-after-fix-before-search.png` | An abandoned take, before the search: a drag over rows 4 and 5. |
| `91-aborted-take-after-fix-bar-open.png` | The abandoned take, bar open at 1/37 while a scrolling writer prints. |
| `92-aborted-take-after-fix-scrolling-output-moved-selection-away.png` | The abandoned take after the writer scrolled the screen: the selection scrolled out of view with the old rows. That is how any terminal behaves when output scrolls, so the implementer rightly switched to a writer that rewrites one row. |
| `93-aborted-take-after-fix-scrolling-output.mp4` | The same abandoned take as a recording: the home screen, the thread, the search, then scrolling output. |

## Could not test, or not tested

- The bug before the fix was not reproduced by the tester (no source changes were allowed). The implementer's `20` to `25` show it, and I looked at them.
- Only a cmd thread was used. PowerShell, Git Bash and WSL threads, and a real Claude Code thread, were not tested.
- Output that scrolls was not retested (see `92`): a selection moves with the text then, as in any terminal.
- Moving focus from the bar to the terminal with the Tab key, and a press on the terminal's scrollbar with the bar open (the doc says it does not end the search), were not tested.
- Ctrl+Shift+A with the bar's own box focused was not tested. The key only reaches the terminal when the terminal has focus.
- The real Windows clipboard was not used, for safety (it was replaced inside the page). What the app writes to it is shown, and the paste is shown by the writer echoing it.
- `drive drag` was not used (see "What was tested and how"). A custom CDP helper does the same real mouse events.

## Hashes of the real Claude files

| File | Before the first launch (2026-11-08) | After my relaunch on `a69503f` (2026-11-09) | At the end |
|---|---|---|---|
| `C:\Users\Aryan\.claude\settings.json` | `2CBF2BE4E19D4BC064091C306D676F5BD3A73A344D761D677C61BB4E75126919` | `62E5463075E36910FC970D8721FBE6DD554955E55A4FDB528DB723E73F54E5BE` | `62E5463075E36910FC970D8721FBE6DD554955E55A4FDB528DB723E73F54E5BE` |
| `C:\Users\Aryan\.claude\hooks\afterterm-notify.ps1` | `21A8E8A0A170955FB4E1760E49020DC22FE2261CA1C45DAAAB3173E3E668633B` | `21A8E8A0A170955FB4E1760E49020DC22FE2261CA1C45DAAAB3173E3E668633B` | `21A8E8A0A170955FB4E1760E49020DC22FE2261CA1C45DAAAB3173E3E668633B` |

The `settings.json` hash changed between my two sessions because the orchestrator edited it at Aryan's request at 00:30 on 2026-11-09, as the coordinator told me. The first session's checks (before and after the first launch) read the old value. The second session read the new value after the relaunch and at the end, and the hook file never changed. I did not hash in the middle of the second session. The harness build ran with its own empty Claude folder, so it could not touch the real one.

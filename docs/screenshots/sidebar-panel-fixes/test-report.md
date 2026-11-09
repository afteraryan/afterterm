# Test report: the Other projects drawer and the panel's width (stream 2, PRs #85 and #93)

Tester run on 2026-11-09. One section per PR. The PR #85 captures (numbered 70 to 95) are committed on the branch `fix-drawer-outside-click` (commit `bba5987`), which carries a copy of that section; the PR #93 captures (numbered 100 to 137) are committed on `panel-resize-by-drag`. Both branches were tested from the same worktree, one after the other, each with its own harness launch and the same data dir (`tester-sidebar-panel`).

Summary: 8 of 8 rows pass for PR #85 and 9 of 9 rows pass for PR #93. No source code was changed.
## PR #85 (AFT-37): the Other projects drawer closes on a click outside it

Branch `fix-drawer-outside-click`, commit `48273a7` ("The Other projects drawer closes on the release, and when the window loses focus"). Tested on 2026-11-09 in the agent harness (dev build run from the worktree, secondary display; the window was moved to the bottom-right corner of that display and raised, and `drive bounds` showed `onDisplay.primary: false`). Data dir `tester-sidebar-panel`, a scratch `CLAUDE_CONFIG_DIR`, a fixture of 14 projects: 6 recent (4 cmd threads each) and 8 other (3 threads each, 4 of them archived), all asleep, no Claude session ids. One cmd thread (recent 1) was woken so the terminal is a live xterm. The panel list scrolls (scroll height 1066 in a 595 px list) and the drawer lists the 8 other projects. Recording: `71-drawer-outside-click-rows.mp4` (215 s, every row below except the control in 95).

| Row | Result | Capture | What was seen |
|---|---|---|---|
| 1. Open the drawer, click in the terminal | pass | 72, 73 | The drawer opened with 8 rows. One click on the terminal closed it (`drive dock` reports closed) and the terminal cursor went solid (focused). |
| 2. Click the header | pass | 74, 75 | Closed by a click at the header's centre. |
| 3. Click the rail | pass | 76, 77 | Closed by a click on the rail's Workspace button (the screen stayed on workspace). |
| 4. Esc | pass | 78, 79 | `drive key Escape` closed it; the toggle shows its keyboard focus ring. |
| 5. The lost-click case (press, wait 250 ms, release) | pass | 80 to 84, 83 (probe text) | See "Row 5 in detail". |
| 6. Right-click held 200 ms on a drawer row | pass | 85 to 88, 86 (probe text) | The drawer stayed open through the press, the hold and the release. The project menu (11 items) opened over it. Clicking "Open project page" ran it (the project page for "other project 3", Asleep 3) and the drawer closed as the action ran, as the feature doc says it will. |
| 7. A row drag started outside the drawer, drawer open | pass | 89 to 92, 95 (control) | The drawer stayed open during the held drag (probe at the hold: `dockOpen: true`). On the drop, thread t-4 moved from recent 1 to recent 2 (`g-r1` to `g-r2`) and the drawer closed on the release. |
| 8. A synthetic window blur | pass | 93, 94 | `window.dispatchEvent(new Event('blur'))` closed the open drawer (a page-side logger recorded the one `blur` event). |

### Row 5 in detail

To make the list's scroll position shift when the drawer closes, the list was scrolled to its end with the drawer open (scrollTop 755; with the drawer closed the list is 281 px taller and its end is at 471). Pressing the last row ("recent 6 shell 4", at (204, 418)) with a CDP `mousePressed`, a 250 ms pause and a `mouseReleased` gave this:

- While pressed and held: drawer still open, scrollTop unchanged (752).
- After the release: drawer closed, scrollTop clamped to 471, and the pressed thread (t-24) was the selected one (the header reads "recent 6 shell 4").
- In 84 the pointer still sits at y=418 and the row under it after the layout shift is "recent 5 shell 1" (it shows the hover highlight). So closing on the press instead of the release would have let the release land on a different row, which is the failure the fix addresses.

I could not run the pre-fix behaviour without changing source. The implementer's 50 and 51 are their before-fix pair.

### Observation, not a failure

My first two row-7 attempts did not show what I wanted, so row 7 took three tries.

- Attempt 1: the drawer was already closed when the drag began. That was most likely a real window blur (another agent's window on the same display took focus), so it is the new blur rule working. I then added a page-side focus and blur logger (`window.__ev`); in attempts 2 and 3 no blur happened.
- Attempt 2: the drop was at y=448, inside the list's bottom edge-scroll zone. The list auto-scrolled to its end and nothing moved. Control `95-row7-control-drop-in-bottom-edge-zone-drawer-closed.txt`: with the drawer closed, a drop in the same edge zone (y=722) also moves nothing, so this is how the panel's drag behaves at the very edge of its list, not an effect of the drawer.
- Attempt 3: the drop was mid-list and moved the thread. Only attempt 3 is the row result (89 to 92).

### Implementer's captures reviewed

Every implementer image was opened. The two mp4 files were opened through ffmpeg frame sheets (12 frames each).

- `00-startup.png`: Home screen (no panel) with projects alpha, beta, gamma, delta and "Show more", from the implementer's smaller fixture (2 recent, 3 other).
- `01-before-fix-drawer-open.png`: before the fix, the workspace with the Other projects drawer open (gamma, delta, epsilon) and a live cmd.exe thread in alpha.
- `02-before-fix-after-click-in-terminal-drawer-still-open.png`: before the fix, after a click in the terminal: the drawer is still open (the bug).
- `03-after-fix-drawer-open.png`: with the fix, the same drawer open.
- `04-after-fix-closed-by-click-in-terminal.png`: with the fix, closed after a click in the terminal.
- `05-after-fix-closed-by-click-on-header.png`: closed after a click on the header.
- `06-after-fix-closed-by-click-on-rail.png`: closed after a click on the rail. "gamma" sits in Recent and the count reads 2 (a project had been brought in earlier in that run; the still does not show which click closed the drawer).
- `07-after-fix-closed-by-escape.png`: closed by Escape; the toggle shows its focus ring.
- `08-after-fix-right-click-on-drawer-row-keeps-it-open.png`: right-click on a drawer row: the drawer (delta, epsilon) stays open and the project menu shows.
- `09-after-fix-menu-action-on-drawer-row-still-runs.png`: after "Open project page" from that menu, the project page for delta.
- `10-drawer-closes-on-outside-click-and-esc.mp4` (138 s, 1280x780): the frames show the drawer open, closed by a click in the terminal, reopened and closed again, Esc with the focus ring, gamma brought into Recent, and the project menu open over the drawer. This is the recording from before review, when the drawer closed on the press.
- `50-before-fix-drawer-open-list-scrolled-to-end.png`: the review case before the fix: the long fixture (6 recent, 8 old), list scrolled to its end with the drawer open.
- `51-before-fix-click-on-last-row-lands-elsewhere.png`: before the fix, after the press: the drawer is closed, the list has shifted and "r4 shell 4" shows the hover highlight; the header reads "r6 shell 4". It supports the shift, but a still cannot show which row received the click.
- `52-after-fix-drawer-open-list-scrolled-to-end.png`: with the fix, the same start (r6 shell 4 selected).
- `53-after-fix-click-on-last-row-opens-it-and-closes-the-drawer.png`: with the fix, after the slow click: the drawer is closed, the header reads "r6 shell 2" and that row is selected (the pressed row; the hovered "r4 shell 4" is where the pointer now rests).
- `54-drawer-closes-on-release-escape-and-blur.mp4` (32 s): the frames show the drawer closing on a terminal click, Escape with a focus ring, the project menu over the drawer, and a thread being dragged from recent 1 into recent 2.
- `55-after-fix-terminal-click-closes-the-drawer.png`: a terminal click closes the drawer (cmd.exe in recent 6).
- `56-after-fix-right-click-on-drawer-row-keeps-it-open.png`: right-click on a drawer row: the drawer (8 old projects) stays open with the menu.
- `57-row-drag-held-with-the-drawer-open.png`: a thread being dragged ("r1 shell 2", recent 1 to recent 2) with the drawer still open.
- `58-row-drag-dropped-drawer-closed.png`: after the drop "r1 shell 2" sits in recent 2, the drawer is closed and a hover card shows project recent 2.

### What could not be tested

- A real press on the title bar's drag area or on the window buttons never reaches the page (Windows handles it), so it cannot be driven through CDP. The synthetic `blur` stood in for "focus leaves", as the plan said.
- There is no pre-fix control for row 5 on this branch (it would need a source change). The implementer's 50 and 51 are their pair.
- Esc while a terminal has keyboard focus (it also reaches the shell) was not exercised. The feature doc accepts it.

## PR #93 (AFT-30): the panel can be resized by dragging its right edge

Branch `panel-resize-by-drag`, commit `8e22c0e` ("Panel resize: a window blur ends the drag, savedUi is tested, docs corrected"). Tested on 2026-11-09 in the agent harness, same setup as the PR #85 section (secondary display, window in the bottom-right corner and raised, `drive bounds` checked, data dir `tester-sidebar-panel`, scratch `CLAUDE_CONFIG_DIR`, the same 14-project fixture). A cmd thread (recent 1, "cmd.exe") was awake. The window is 1280 px wide, so the maximum panel width is 640. The handle is `.panel-resizer`. For the terminal's columns I used `mode con` in the shell (the PTY's own count) and the width of `.xterm-screen` (the drawn terminal, which only changes when the terminal is fitted). Recording: `100-panel-resize-rows.mp4` (139 s; rows 1 to 4 and 6 to 9; row 5 quits the app, so its captures are stills). Captures for this PR are numbered 100 and up on this branch; the PR #85 captures (70 to 95) are on the branch `fix-drawer-outside-click`.

| Row | Result | Capture | What was seen |
|---|---|---|---|
| 1. Drag the edge wider: columns unchanged while held, changed after release | pass | 101, 103, 105, 136, and text 104, 106, 137 (102 is not evidence, see the row) | Default 264: `mode con` 112 columns, terminal 896 px. Edge held at 384 px: panel 384, terminal still 896 px, and a `mode con` typed while the button was down still said 112. After the release: terminal 776 px and `mode con` said 97. Hovering the edge gives the `col-resize` cursor and a thin line (136 and its text 137, taken in one CDP session after a relaunch: the line colour goes from transparent to `rgba(255, 255, 255, 0.22)`). My first hover capture (102) shows no line because the pointer is lost between separate `drive` calls, so it is named that way and is not evidence. |
| 2. Drag it narrower | pass | 107 to 110, 108 and 109 (text) | Held at 284 px: terminal still 776 px, `mode con` typed during the hold said 97. After the release: terminal 880 px and `mode con` said 110. |
| 3. Drag past the limits | pass | 111 to 113, 112 (text) | Pointer dragged to x = -240: the panel stopped at 180. Pointer dragged to x = 1156: it stopped at 640, half of the 1280 window. The committed width was 180 and 640. |
| 4. Double-click the edge | pass | 114 to 116, 114 (text) | A real double-click (two press and release pairs) took 640 back to 264 and refit the terminal (896 px, 112 columns). `session.json` `ui` was `{"panelHidden":false,"panelWidth":640}` before and `{"panelHidden":false}` after (read after the 2 s save): the key is gone. |
| 5. Width kept after a graceful quit and relaunch | pass | 133 to 135, 134 (text) | Set 340, took a screenshot, then quit through `drive window quit` (a graceful quit, about 2 to 3 s after the release, so I cannot say whether the 2 s save or the quit flush wrote the file; both go through the same function): `session.json` `ui` read `panelWidth: 340` right after the exit. Relaunched with the same data dir and no `--session`: `window.__afterterm.panelWidth()` 340 and the panel drawn at 340 px. The thread came back asleep, as it should. |
| 6. Hide and show at a custom width | pass | 117 to 120, 117 (text) | Custom 344. The rail toggle hid the panel (drawn width 0, panel and handle carry `hidden`, the saved width still 344, terminal widened to 1160 px). A second click showed it at 344 again (terminal 816 px). |
| 7. Window shrunk to 800 px, then grown back | pass | 121 to 124, 121 (text) | With a chosen width of 600 in the 1280 window: at 800 px the panel was drawn at 400 (half) while the chosen width stayed 600; grown back to 1280 it was drawn at 600 again (terminal 560 px, as before). |
| 8. A row drag in the panel still moves a thread | pass | 125 to 128, 127 (text) | Thread t-2 dragged from recent 1 onto recent 2 moved there (`g-r1` to `g-r2`); the panel width stayed 600 and `body.panel-resizing` was never set. |
| 9. A synthetic window blur in the middle of an edge drag | pass | 129 to 132, 132 (text) | Edge held at 450 (from 600): `body.panel-resizing` true, committed width still 600, terminal 560 px. `window.dispatchEvent(new Event('blur'))` with the button still down: the body class went, the width committed (450), the terminal refit (712 px) and a page-side logger recorded the blur. The button's later release changed nothing. `session.json` read `panelWidth: 450` after the save. |

### Observations, not failures

- While the edge is held the keyboard stays with the terminal: the `mode con` typed during rows 1 and 2 reached the shell (both runs are in the buffer), which is what made the "columns unchanged while held" check possible.
- At the 180 px minimum the panel gets cramped: "New thread" wraps onto two lines and thread and project names are cut off (111, and the implementer's 27 shows the same). It is the lower limit the plan asked for ("about 180"); I report it in case a wider minimum is wanted.
- A real window blur happened once during the run (another agent's window took focus; the logger shows `blur@194063` then `focus@206174`). No drag was held at the time.

### Implementer's captures reviewed

Every implementer image was opened. The two mp4 files were opened through ffmpeg frame sheets.

- `20-resize-before-default-width.png`: the default 264 px panel and a terminal of 112 columns; the buffer holds three earlier `mode con` runs (115, 65 and 112 columns).
- `21-resize-handle-hovered.png`: the pointer on the panel's right edge; a thin vertical line shows on the edge.
- `22-resize-during-drag.png`: mid-drag, panel wider (about 400 px); the terminal text has not rewrapped (lines run off the right edge), so the terminal is held still.
- `23-resize-after-release-wider.png`: after the release, same width; the terminal text has rewrapped to the new column count.
- `24-resize-narrower-during-drag.png`: mid-drag, narrower; the text still wraps at the old width (a path is cut after "scrat").
- `25-resize-after-release-narrower.png`: after the release the text has rewrapped to the wider terminal.
- `26-after-reload-panel-width-kept-364.png`: after a page reload the panel is about 364 px wide and the terminal narrower.
- `27-resize-stops-at-minimum-180.png`: panel at its 180 px minimum: "New thread" wraps onto two lines and thread names are cut off.
- `28-resize-stops-at-half-the-window-640.png`: panel at 640 px, half the 1280 window; the terminal is narrow.
- `29-row-drag-held-over-another-project.png`: a thread drag card ("alpha shell two", alpha to beta) held over beta with the panel at a custom width.
- `29b-row-drag-dropped-in-another-project.png`: after the drop "alpha shell two" is in beta (hover card: project beta).
- `30-panel-resize-by-drag.mp4` (66 s): frames show drags wider and narrower with the terminal rewrapping after each release, then the thread drag into beta, ending on the Home screen.
- `31-panel-hidden-slide-still-works.png`: panel hidden through the rail toggle (the toggle is highlighted); the terminal has the full width.
- `32-panel-shown-again-at-its-own-width.png`: panel shown again at its custom width (about 340 px).
- `40-after-relaunch-width-kept-340.png`: after a graceful quit and relaunch the panel is still 340 px; the cmd thread is asleep with its Wake button.
- `41-after-double-click-back-to-default-264.png`: after a double-click on the edge the panel is back at 264 px.
- `42-small-window-panel-held-to-half.png`: the window shrunk to 800x600: the panel is held to 400 px and the header is squeezed ("C..." for the name).
- `60-blur-ends-the-drag.mp4` (44 s): frames show an edge drag held with the terminal not yet refit, then the same screen after the blur with the terminal rewrapped, then a narrower panel.
- `61-blur-test-drag-held.png`: the blur test: edge held, panel about 400 px, the terminal text not refit.
- `62-blur-test-drag-ended-by-blur.png`: after the blur: same panel width, the terminal text rewrapped.
- `63-window-shrunk-panel-held-to-half.png`: an 800x600 window, the panel held to half, the terminal narrow.

### What could not be tested

- A real Alt+Tab or click on another app with the button held: only the synthetic `blur` event was used, as the plan said.
- The quit flush on its own (a quit within 2 s of a width change): row 5 does not separate it from the 2 s save.
- A window resize while the edge is held, and the number of times a hosted TUI is repainted during a drag: the evidence is `mode con` and the drawn terminal width, not a count of resize calls.
- The row drag with the drawer open belongs to the PR #85 section above, not to this one.


## Real Claude files, before and after

`C:\Users\Aryan\.claude\settings.json` sha256 `62E5463075E36910FC970D8721FBE6DD554955E55A4FDB528DB723E73F54E5BE` before the first launch, after every one of the four harness launches, after both recordings and after every stop (unchanged each time).
`C:\Users\Aryan\.claude\hooks\afterterm-notify.ps1` sha256 `21A8E8A0A170955FB4E1760E49020DC22FE2261CA1C45DAAAB3173E3E668633B` at the same moments (unchanged each time).

All harness builds were stopped with `npm run harness:stop -- --data-dir <tester-sidebar-panel>`; the last stop is the end of the run.

## Note on attribution

The commits in this tester run end with `Co-Authored-By: Claude Sonnet 5.5` and the session link, as the session's own instructions give; the common rules name `Claude Fable 5.1`, which is not the model that ran these tests.
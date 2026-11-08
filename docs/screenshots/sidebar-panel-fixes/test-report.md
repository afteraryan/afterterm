# Test report: the Other projects drawer (PR #85, AFT-37)

Tester run for stream 2, 2026-11-09. This copy holds the PR #85 section only; the report on the `panel-resize-by-drag` branch holds both PRs.
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

## Real Claude files, before and after

`C:\Users\Aryan\.claude\settings.json` sha256 `62E5463075E36910FC970D8721FBE6DD554955E55A4FDB528DB723E73F54E5BE` before the launch, after the launch, after the recording and after stopping the build (unchanged).
`C:\Users\Aryan\.claude\hooks\afterterm-notify.ps1` sha256 `21A8E8A0A170955FB4E1760E49020DC22FE2261CA1C45DAAAB3173E3E668633B` at the same four moments (unchanged).
# afterterm — Known Bugs

Running list of observed bugs that are **not yet fixed**. When a bug is fixed, its entry is deleted from here and a short entry is added to [`bugs-fixed.md`](bugs-fixed.md) in the same change (what was wrong, what the fix does, the PR), and the fix goes in `CHANGELOG.md`'s Fixed list. For inherent *platform limitations* (input lag, Wispr, etc.) see the **Known Limitations** section in [`../CLAUDE.md`](../CLAUDE.md) — those are constraints, not bugs on a fix-list.

Format per bug: a short title, the date observed, what happens, the steps to make it happen again when known, and the evidence Aryan gave (screenshots, quoted text, names). No causes: from 2026-09-26 new entries say nothing about causes, even where older entries below have one (`.claude/commands/bug-record.md`).

This one file is where every bug goes, and `docs/screenshots/manual-testing/` is where every screenshot that comes with a bug goes (numbered, named for what it shows, committed, never deleted). A bug found during Aryan's manual testing after the projects-and-threads phases also carries the phase it belongs to and a link to its screenshot. Agreed with Aryan on 2026-09-08.

---

Every entry from the manual-testing round after the projects-and-threads phases (seven bugs plus the thread-folder Explorer ask) was closed in Phase 9 on 2026-09-19; see PHASES.md's Phase 9 section and Log for what each fix was and how it was verified. Entries below are from Aryan's use of the Phase 9 build.

---

## The top part of a submitted prompt in a live chat is greyed out while the rest is not

**Observed:** 2026-09-20 by Aryan during manual testing · **Phase:** pre-existing (terminal rendering of Claude Code's output) · **Status:** open · **Severity:** low (cosmetic, the text is still readable) · **Screenshot:** `docs/screenshots/manual-testing/04-live-chat-top-part-of-own-input-greyed-out.png`

**What happens:**
In a live chat thread, the prompt Aryan submitted is echoed under the `>` marker. Its first ten or so lines (down to "AR Study Buddy matters for three reasons.") are drawn in a dimmer grey than the lines that follow, which are in the normal text colour. He does not know why part of his own input is greyed out.

**Repro:**
As observed; repro not yet known. Seen after submitting a long multi-line prompt in a chat that was awake with the Claude Code banner at the top of the scrollback.

**Cause:** not investigated beyond a quick look. afterterm dims nothing in a live terminal: the only dimming in the renderer is the asleep pane's saved tail (`.past` at 30% opacity in `AsleepPane.css`), and the dimmed wake replay was removed in Phase 9, so the grey comes from the text attributes Claude Code's own TUI emitted for those rows (the dim attribute on the part of the message that had scrolled out of its live viewport, is one possibility). Fix direction: reproduce the same prompt in Windows Terminal first; if it looks the same there it is Claude Code's rendering and not afterterm's to fix.

---

## The Other projects drawer in the sidebar cannot be searched by typing a project name

**Observed:** 2026-09-21 by Aryan during manual testing · **Phase:** 8 (the panel's docked Other projects row and the in-place search) · **Status:** open · **Severity:** medium (a feature is missing where it is expected) · **Screenshot:** none attached

**What happens:**
When the docked "Other projects" row at the bottom of the sidebar is opened, Aryan expects to be able to just type a project's name and see the matching projects come up, the way his Spotify mini player search works: open the search mode, type, and whatever matches appears. Today opening the drawer only lists the projects; typing does nothing there, and the sidebar's own search box hides the drawer instead of searching it.

**Repro:**
1. In the workspace, with more projects than fit Pinned and Recent, open the "Other projects" row at the bottom of the sidebar.
2. Start typing a project's name.
3. Nothing filters. Typing in the sidebar's Search box instead hides the Other projects row entirely, and its projects never appear in the results.

**Cause:** `filterPanel` in `src/renderer/panelView.ts` returns `other: []` for any non-empty query on purpose ("the docked Other row itself hides while typing, so there is nothing left in it to filter"), so Other projects are excluded from the in-place search, and the drawer (`.dock` in `SidePanel/index.tsx`) has no input of its own. Fix direction: either include Other projects in `filterPanel`'s results (a matching Other project surfacing as a row while filtered) or give the open drawer its own type-to-filter, in the spirit of the Spotify mini player search Aryan named; the look is his to settle before it is built.

---

## A project icon can only be one of ten built-in glyphs; the user cannot upload an image of their own

**Observed:** 2026-09-21 by Aryan during manual testing · **Phase:** 8 (project icons, the icon picker in the New/Edit project dialog) · **Status:** open · **Severity:** medium (a feature Aryan expects is missing) · **Screenshot:** none attached

**What happens:**
The project dialog offers ten fixed icons. Aryan wants to upload his own image or icon as a project's icon, whatever the format (SVG, PNG or another), and to be able to adjust it: a square image can be used as is, and for anything else the user should be able to fit or crop it so it sits properly in the icon's slot wherever the icon is drawn (sidebar rows, the rail tile, the header, Home cards, the hover card, the chooser, the palette, the project page, toasts).

**Repro:**
1. Open New project or Edit project.
2. The icon row offers only the ten glyphs; there is no way to pick a file.

**Cause:** `Group.icon` is a `ProjectIconId`, one of the ten ids in `PROJECT_ICON_IDS` (`src/renderer/components/TabBar/types.ts`), validated on load by `isProjectIconId` in `sessionMigration.ts` and drawn by `ProjectIcon` in `Icons.tsx` from inline SVG paths; the picker in `GroupModal/index.tsx` is a swatch grid over those ids, and there is no file picker, no image storage and no `<img>` rendering path anywhere. Fix direction: a second kind of icon, an image file copied into `%APPDATA%\afterterm\icons\<groupId>.<ext>` through a main-process picker (the same shape as the folder picker), stored on the group as a path or as `{ kind: 'image', file }`, rendered by `FolderIcon`/`ProjectIcon` as an `<img>` with `object-fit` and an adjustable crop or fit chosen in the dialog, with the ten glyphs staying as they are; the overlay toast would need the image too, since it draws the icon itself. A design decision with Aryan first on how the adjustment works (fit, crop, offset).

---

## There is no quick way to toggle between the awake threads when they are spread across Pinned and Recent

**Observed:** 2026-09-22 by Aryan during manual testing · **Phase:** 8 (the panel's Pinned and Recent split, the keyboard cycle) · **Status:** open · **Severity:** medium (a daily action costs a search through the sidebar) · **Screenshot:** none attached

**What happens:**
Aryan often wants to flip between the threads he has awake right now. When some of them sit in pinned projects and others in Recent, there is no one place that shows them together: he has to scroll down to Recent and work out which one his fifth awake thread was. He wants that solved: a way to see and switch between the active (awake) threads directly, wherever their projects sit in the sidebar.

**Repro:**
1. Have five or so awake threads in projects that are split between Pinned and Recent.
2. Try to switch to a particular one of them: the sidebar shows them by project, in two sections, with the rest of each project's threads around them and folds in between.
3. Ctrl+Tab cycles in session order without showing the set, and Ctrl+Shift+Up/Down walks every visible row, asleep ones included.

**Cause:** the panel is built by project (`panelSections` in `src/renderer/panelView.ts`, Pinned then Recent then Other) and there is no view or list keyed on "awake": `attention.ts` counts working, waiting, finished and running threads for the rail and the pills but has no list of awake threads, and the two keyboard cycles (`cycleThreadId` in panel order, the session-order Ctrl+Tab in `main.ts`) do not filter by state. Fix direction: an "Awake" list, for example a section at the top of the panel, a rail entry, or a Ctrl+Tab switcher that shows the awake threads and cycles only through them (design-03's Section 3 question 8 raised a working-threads strip and it was left out then); this is a design decision for Aryan before it is built.

---

## The Search and New thread rows at the top of the sidebar take too much space for how little they are used

**Observed:** 2026-09-22 by Aryan during manual testing · **Phase:** 8 (the panel's top: the Search box and the New thread row; the rows themselves are Phase 1) · **Status:** open · **Severity:** low (layout) · **Screenshot:** none attached

**What happens:**
The New thread row, and the Search row above it, sit as two full-width rows at the top of the sidebar. Aryan uses neither often and finds they occupy space that the project list could have. He suggests moving them up into the icon row where the Collapse sidebar button is (New thread as a button there, and possibly the Search box too), so the list starts higher.

**Repro:**
1. Open the workspace with the sidebar showing.
2. The top of the sidebar is the icon row (collapse toggle), then the Search row, then the New thread row, before the first section.

**Cause:** the panel's top in `src/renderer/components/SidePanel/index.tsx` is the `.brand` icon row (the collapse toggle), then the `.srow` Search box and the `.srow[data-new-thread]` row, each a 44px row; the rail (`components/Rail`) already carries a Search and a New thread block that only shows while the panel is hidden. Fix direction: fold both into the icon row (a search icon that expands into the in-place box, a plus for New thread, next to the collapse toggle), or keep a single compact row; a layout to agree with Aryan (a mock page, one question) before it is built, since it changes the sidebar's top for every screen.

---

## Drag and drop in the sidebar: projects cannot be reordered, dragging to Pinned does not pin, no indicator for a drop at the top, hovered projects highlight during a project drag, and a thread cannot be dragged out of every project

**Observed:** 2026-09-22 by Aryan during manual testing · **Phase:** 8 (the Pinned and Recent split and Recent's activity order); the drag-and-drop itself is Phase 1 and pre-existing · **Status:** open · **Severity:** medium (a whole interaction that does not behave) · **Screenshot:** none attached

**What happens:**
Five things, all in the sidebar's drag and drop, which Aryan wants worked on as one piece:

1. Dragging a project row to another position inside Pinned does not reorder it, and neither does it inside Recent. He is not sure repositioning is meant to exist at all.
2. Dragging a project from Recent into the Pinned section should pin it. It does not.
3. Dragging a project to the top of a section gives no visual indication that it will land first; there is an indication for landing between two projects, nothing for landing on top.
4. While a project is being dragged, the project row under the pointer highlights as if it were a drop target, and the dragged row is highlighted too. Two highlighted projects reads as "this one goes inside that one", which is not what happens. A project being dragged over should not highlight; that highlight makes sense only when a thread is dragged over a project.
5. There is no way to drag a thread out of every project, into General.

He also asks whether any of this was designed and built before the redesign, so the record is checked before it is fixed.

**Repro:**
1. Drag a pinned project's row above another pinned project and release: the order is unchanged. The same in Recent.
2. Drag a Recent project onto the Pinned section and release: it is not pinned.
3. Drag a project towards the top of its section: no line or gap appears above the first row.
4. During the drag, the project under the pointer takes the hover highlight.
5. Drag a thread out of its project towards General: no target to drop it on.

**Cause:** what the code says today, from `src/renderer/components/SidePanel/index.tsx`: project drags do exist (`handleDragEnd` calls `onMoveGroupAfterGroup(dragged, target)` when a project is dropped on a project row, so the intended gesture is "move after the target"), and design-03 says "Pinned keeps its dragged order" while "Recent is sorted by lastActiveAt descending", so a reorder inside Recent is overridden by the activity sort by design, and a reorder inside Pinned should work but Aryan reports it does not (not investigated further; the Pinned list in `panelView.ts` is built from group order, so the move may not be reaching `groups` or may be landing across the Pinned and Recent boundary). There is no pin-on-drop (`togglePin` is only called from the pin buttons and menus), only an "after the target" drop and so no "before the first row" indicator, the project row's `drop-over` class is applied from `isOver` for any drag kind (line 184), and a thread's only drop targets are other thread rows and project rows (`moveTab` inherits the target's group), so an empty General offers nowhere to drop. Fix direction: a proper drag model for the panel: reorder within Pinned with a before-or-after line indicator (including above the first row), a drop into the Pinned section that pins, no reordering in Recent (it is sorted by activity, say so on hover or allow nothing), project rows not highlighting while a project is dragged, and a General drop zone (the section heading, or an always-present target when the section is empty) that takes a thread out of its project. This is a design decision with Aryan first (one mock page, one question per gesture), then one piece of work.

---

## A block of Claude's output is printed twice in the terminal

**Observed:** 2026-09-25 by Aryan during manual testing (an old problem, still happening) · **Phase:** pre-existing (the terminal's output path) · **Status:** open · **Severity:** medium (the scrollback cannot be trusted to show what was said once) · **Screenshot:** `docs/screenshots/manual-testing/06-claude-output-block-repeated-in-the-terminal.png`

**What happens:**
Now and then a chunk of Claude Code's output appears twice in a row: in the screenshot the same summary block (the five bullet lines and the numbered "Issues found" list) is printed once, then printed again a few lines later, the second copy reflowed to the full width. It is annoying and has been happening for a long time. Aryan does not know whether it is something terminals do in general, something people complain about elsewhere, or something afterterm is causing, and wants that settled before a fix is attempted.

**Repro:**
As observed; repro not yet known. Seen in a chat thread running Claude Code while it printed a long block, and the second copy wraps at a different width from the first, which suggests the terminal was resized (or refit) between the two.

**Cause:** not investigated in the code beyond checking the obvious duplicate-listener paths, which look sound: `pty.onData` in `src/preload.ts` keeps one handler per tab in `dataListeners` and `offData` removes it, and `Terminal/index.tsx` registers it once per created terminal with `creatingRef` guarding a double create. The reflowed second copy points instead at a redraw by the program: Claude Code's TUI repaints its transcript when the terminal size changes, and afterterm refits on every container resize (the `ResizeObserver` in `Terminal/index.tsx`, and the refit when the workspace becomes visible again), each refit sending a new size to the PTY. So the first question to answer is whether this is a repaint on resize (which would also happen in Windows Terminal if it is resized at the same moment, making it Claude Code's behaviour, not afterterm's) or a genuine double write by afterterm. Investigation plan: reproduce with `drive record` while resizing the window and switching screens, compare against the same session in Windows Terminal at the same sizes, and check whether the duplicate ever appears with no resize at all.

---

## Home's project list has no search box, so a project low in the list can only be reached by scrolling or Show more

**Observed:** 2026-09-25 by Aryan during manual testing · **Phase:** 2 (Home and its project list) · **Status:** open · **Severity:** medium (a project is hard to reach from the screen the app opens on) · **Screenshot:** none attached

**What happens:**
On Home, under the pinned cards, the Projects list shows the projects by recent activity with a Show more after the first few. Aryan wants a search box there so he can type a project's name and get it, as part of the list rather than a separate screen. It should feel smooth: the matching projects arrive with an animation and the ones that no longer match leave with one.

**Repro:**
1. Open Home with more projects than the list shows before Show more.
2. To reach one that is further down, expand Show more and scan the list, or leave Home for the search palette; there is nothing to type into on Home itself.

**Cause:** Home has no query at all. `components/Home/index.tsx` renders the pinned cards and then a plain `.list` of rows from `homeSections` in `homeView.ts` (which sorts and splits pinned, unpinned and archived), with a `.more` toggle for the rest; `homeView.ts` has a `filterThreads` helper but nothing that filters projects, and no row animation beyond the page's entrance stagger. The sidebar already has the pattern to copy: an in-place `.srch` box whose value runs through `filterPanel` (`panelView.ts`) and narrows the list as you type. Fix direction: a `filterProjects` in `homeView.ts` (pure, unit-tested, matching the sidebar's case-insensitive substring rule), a search box in Home's Projects section header, and enter and exit animations on the rows; the animation is a look decision, so a mock page with one question for Aryan before it is built.

---

## The white bar is back above the toast stack, and it also shows when no toast is on screen

**Observed:** 2026-09-25 by Aryan during manual testing · **Phase:** 9 (the notifier white bar fix) · **Status:** open · **Severity:** low (cosmetic, but on top of every other window) · **Screenshot:** `docs/screenshots/manual-testing/10-white-bar-above-the-toast-stack.png`

**What happens:**
A white bar spans the full width of the overlay, above the top toast card. In the screenshot two toasts are stacked and the bar sits in the padding above the first one. Aryan also sees it appear when there is no notification at all: no toast on screen, just the bar.

This is the same artefact Phase 9 fixed on 2026-09-20; that fix held for the cases tested then (a toast up, the main window activated from another app, and hide-and-show cycles), so this is a case it does not cover.

**Repro:**
As observed; the exact trigger is not known. Two circumstances are recorded: with more than one toast stacked (the screenshot), and with no toast showing.

**Cause:** the Phase 9 fix repaints the overlay at three moments (`repaintNotifier()` in `src/main.ts`, called after the `showInactive` on a push, on the `WM_DWMNCRENDERINGCHANGED` message, and on the main window's `focus` event), because DWM paints the caption strip into the transparent window whenever it touches the frame. It does not repaint after a bounds change: `positionNotifier` calls `setBounds` on every `notifier:resize` from the renderer, which is exactly what happens when a second toast joins the stack and the window grows, and a bounds change is another moment DWM can paint the frame. That fits the screenshot, where the bar sits at the top of a window that had just been made taller. The no-toast case is a second thread to pull: the overlay is meant to be hidden when the last toast clears (`notifier:hide` from `NotifierApp.tsx`), so a bar with no toast means either the hide did not happen or the window was left visible at a small height with the caption strip painted into it. Fix direction: call `repaintNotifier()` after every `setBounds` in `positionNotifier`, then reproduce the empty case in the harness (push two toasts, dismiss both, watch `isVisible()` and the window height) before deciding whether the hide path needs its own fix.

---

## A rail tile cannot say which of a project's waiting threads to open

**Observed:** 2026-09-25 by Aryan during manual testing · **Phase:** 8 (the rail and its tiles) · **Status:** open · **Severity:** low (Aryan says it is not high priority) · **Screenshot:** `docs/screenshots/manual-testing/11-rail-tile-with-two-waiting-and-two-finished-threads.png`

**What happens:**
A rail tile shows its counts, in the screenshot one waiting and two finished. When more than one thread in that project wants Aryan, he would like to choose which one to go to from the rail itself, without opening the panel first. Today the tile takes the decision for him.

**Repro:**
1. Get a project into a state where two or more of its threads are waiting or finished, so its rail tile shows a count above one.
2. Click the tile: it opens one of them, with no way from the rail to pick a different one.

**Cause:** the tile is a single button: `components/Rail/index.tsx` renders it with `onClick={() => onOpenProject(group.id)}`, and `app.tsx`'s `openProjectFromRail` picks the thread through `firstThreadToOpen` in `attention.ts` (the first waiting thread, else the first finished one, else the most recently active awake one). The badges next to the tile are plain counts (`.bd` spans with a tooltip), not controls. Fix direction: give the tile a way to expand the choice, for example a hover or right-click list of that project's waiting and finished threads, each row opening its own thread, with the plain click keeping today's behaviour; the rail's tooltip already anchors to the right (`data-tip-side="right"`), so there is a place for such a list to sit. A look decision for Aryan (one mock page) before it is built.

---

## After the laptop sleeps and wakes, the window and its toasts move to the primary screen and stay there

**Observed:** 2026-09-25 by Aryan during manual testing · **Phase:** 9 (the notifier follows the main window's display); the window's own placement is pre-existing · **Status:** open · **Severity:** medium (the app leaves the monitor it was on and does not come back) · **Screenshot:** none attached

**What happens:**
With the secondary monitor on, toasts were appearing on the secondary monitor, which is right. Aryan shut the laptop lid and opened it again. After that the toasts came out on the right side of the screen once, and from then on every toast appeared on the primary screen, and the afterterm window itself had moved to the primary screen too. He wants to know whether this is a known problem, whether it can be fixed, and what can be done.

**Repro:**
1. Run afterterm with the main window on the secondary monitor and confirm toasts appear there.
2. Close the laptop lid, wait for it to sleep, open it again.
3. The window is on the primary screen, and toasts follow it there.

**Cause:** partly Windows, partly afterterm, and the two need separating.

The window moving is Windows: when a display sleeps or is disconnected, Windows moves the windows that were on it to the remaining display, and it does not move them back when the display returns. afterterm never repositions its main window after startup (`harnessWindowPlacement` in `src/main.ts` only applies when `AFTERTERM_DISPLAY` is set, at creation), so once Windows has moved it, it stays where Windows put it.

The toasts then follow the window, which is the Phase 9 rule working as designed: `notifierDisplay()` returns `screen.getDisplayMatching(mainWindow.getBounds())`, so a main window on the primary screen means toasts on the primary screen. Placement is re-run on `display-added`, `display-removed` and `display-metrics-changed` (`createNotifierWindow`), which is why the toast placement corrects itself, but it corrects to wherever the main window now is.

The one toast that came out "on the right side" before the pattern settled is unexplained and worth catching in the act: it may be a placement that ran while Windows was still rearranging the displays, with stale work area numbers.

Fix direction, in order: remember the main window's bounds and the display it was on (in `prefs.json`, the way `lastOpenedAt` and `editorPath` already live there), restore them at startup, and on `display-added` offer to move the window back to the display it came from if that display has returned and the window has not been moved by hand since. Electron's `powerMonitor` has `resume` and `unlock-screen` events, which give a moment to re-check the display layout after a wake, and `screen.getAllDisplays()` can say whether the old display is back. Before building any of that, reproduce it once in the harness on the secondary display with a sleep and wake, logging `screen.getAllDisplays()` and the window bounds at each step, so the fix is aimed at what Windows actually does rather than at a guess.

---

## The rail leaves out a project whose only thread is working, then shows a working count once another thread finishes

**Observed:** 2026-09-25 by Aryan during manual testing · **Phase:** 8 (the rail and the attention aggregate) · **Status:** open · **Severity:** medium (the rail's two rules disagree, so its counts mislead) · **Screenshot:** none attached

**What happens:**
When a project has one thread working and nothing else, the rail shows nothing for it. The moment a second thread in the same project finishes, the project's tile appears on the rail with two badges: the finished count and the working count. Aryan says that is inconsistent: if the tile shows a working count, the tile should have been on the rail while the thread was only working, before anything finished. Either the working count goes from the tile, or a project with a working thread gets a tile. That is a decision to take with him before it is fixed.

**Repro:**
1. In a project with no pending threads, start a chat so it is working. The rail shows no tile for the project.
2. In the same project, run a second thread until it finishes, and do not view it.
3. The project's tile appears on the rail with a finished badge and a working badge.

**Cause:** the rail decides membership and badges from different rules. `railProjects` in `src/renderer/attention.ts` keeps a project only when `waiting`, `finished` or `compacting` is above zero (working is left out, as design-03 decision 1 says: "one tile per project that has a thread waiting for you ... or a thread that finished and has not been viewed"), while `components/Rail/index.tsx` draws a badge for every non-zero count, including `working`, as design-03's badge column also says. Fix direction, once Aryan picks: either drop the working badge from the rail tile (keeping the rail for "needs you"), or add `working > 0` to `railProjects` so a working project gets a tile of its own; update `attention.test.ts` and design-03's decision 1 to match either way.

---

## A thread's toast stayed on screen after the thread was opened from the sidebar

**Observed:** 2026-09-25 by Aryan during manual testing · **Phase:** 1 (the toast cards) · **Status:** open · **Severity:** medium (a toast for something already seen keeps asking for attention) · **Screenshot:** none attached

**What happens:**
A toast for a thread was up. Aryan opened that thread from the sidebar, and the toast did not go away. He expects opening the thread to dismiss its toast. He does not know what was special about that moment, so the case has to be recreated before it can be fixed.

**Repro:**
As observed; repro not yet known.

**Cause:** not confirmed. Opening a thread row dismisses its toast: `handleActivate` in `src/renderer/app.tsx` calls `clearThreadBadges`, which sends `notify:dismiss-tab` for that tab id, and `NotifierApp.tsx` drops every toast with that id. One path found in a quick look does not match: opening a project (`openProject` in `app.tsx`, around line 282) clears badges and the toast of the project's *first* thread (`tabs.find(t => t.groupId === groupId)`), while `openProject` actually lands on the last-worked thread, so opening a project from its sidebar row can leave the toast of the thread it really shows on screen. Fix direction: recreate the case (thread row click versus project row click, and with the window focused or not), and make the project-open path dismiss the toast of the thread that `openProject` selects.

---

## The thread menus have no item to open a chat's Claude Code session in a regular terminal outside afterterm

**Observed:** 2026-09-26 by Aryan during manual testing · **Phase:** 4 (resuming a chat's Claude Code session) · **Status:** open · **Severity:** low (a missing menu item, nothing is broken or lost) · **Screenshot:** none attached

**What happens:**
There is no way to take a chat's Claude Code session out of afterterm. Aryan wants a menu item that opens the thread's Claude Code session in a regular terminal outside afterterm. It should be in both thread menus: the one shown on right-clicking a thread in the sidebar, and the header's three-dot menu when the thread is open.

**Repro:**
1. Right-click a chat thread in the sidebar: no item opens its session outside afterterm.
2. Open the chat and click the header's three-dot menu: no such item there either.

**Cause:** not built yet. The two menus are `buildThreadMenu` and `buildHeaderMenu` in `src/renderer/threadMenu.tsx`, which share their items. The data is already there: a chat carries `claudeSessionId` and `claudeCwd` (`Tab` in `components/TabBar/types.ts`), and waking types `claude --resume <id>` in that folder (`Terminal/index.tsx`, around line 350). Fix direction: a shared item for chats with a session id, calling a new main-process IPC that starts an external terminal (Windows Terminal, else a new console window) in `threadFolder(tab)` running `claude --resume <id>`, with the session id validated the same way as on wake; decide with Aryan whether the afterterm thread should sleep first, so the same session is not live in two places.

---

## A thread whose turn ended while it was not open keeps showing the background status until it is opened

**Observed:** 2026-09-26 by Aryan during manual testing · **Phase:** 7 (attention: thread states and the badges that clear when seen) · **Status:** open · **Severity:** medium (the sidebar says background work is running when the thread is done) · **Screenshot:** none attached

**What happens:**
A thread's turn has ended and Aryan has not opened it yet, but its row still shows that a background process is running. When he opens it, it says the thread is done and there is nothing running in it. The moment he opens it, the status corrects itself. He expects the row to show the right status without having to open the thread.

**Steps to make it happen again:**
1. Let a chat's turn end while you are looking at another thread.
2. Its row shows the background status (the hourglass) although nothing is running any more.
3. Open the chat: it reads as done, with nothing in it, and the status changes at once.

**Evidence:** Only the description above.

---

## The Other projects drawer in the sidebar has no New project button

**Observed:** 2026-09-26 by Aryan during manual testing · **Phase:** 8 (the panel and its docked Other projects row) · **Status:** open · **Severity:** low (a missing button, nothing is broken or lost) · **Screenshot:** none attached

**What happens:**
The Other projects drawer at the bottom of the sidebar has no button to create a new project. Aryan wants a New project button in it, either at the top or at the bottom of the drawer. Which of the two is still his decision to make.

**Steps to make it happen again:**
1. Open the Other projects drawer at the bottom of the sidebar.
2. There is no New project button at its top or its bottom.

**Evidence:** Only the description above. The placement (top or bottom of the drawer) is pending Aryan's decision.

---

## The project icon picker has too few icons, and some do not look like what they stand for

**Observed:** 2026-09-26 by Aryan during manual testing · **Phase:** 8 (project icons chosen in the New/Edit project dialog) · **Status:** open · **Severity:** low (a limited choice of icons, nothing is broken or lost) · **Screenshot:** none attached

**What happens:**
The icon library for project icons is too small, and its icons are not good or accurate enough. Aryan wants the library expanded, with better and more accurate icons to choose from.

**Steps to make it happen again:**
1. Open the New project or Edit project dialog.
2. Look at the icon picker: the choice is small and the icons are not accurate enough.

**Evidence:** Only the description above.

---

## There is no way to reopen the previous session's terminals after afterterm is restarted

**Observed:** 2026-09-26 by Aryan during manual testing · **Phase:** 4 (sleep, wake and session restore: every restored thread starts asleep) · **Status:** open · **Severity:** medium (the previous session has to be woken thread by thread after every restart) · **Screenshot:** none attached

**What happens:**
When Aryan restarts afterterm, or shuts it down and opens it again, there is no way to resume the previous session as a whole. An earlier version reopened everything at launch, and afterterm crashed because so many processes started at once. He wants a different approach: restore the session a few terminals at a time (one, two or three), queue the rest, and show progress as each one opens ("opening this one", then the next, then the next). The UI for this is still to be designed.

**Steps to make it happen again:**
1. Work in afterterm with several threads open.
2. Quit afterterm and open it again.
3. There is no action that reopens the previous session's threads; each one has to be woken on its own.

**Evidence:** Only the description above. Aryan's wording on the earlier attempt: "AfterTerm would literally crash because so many processes ran at once."

---

## Clicking a file link in the terminal should open the file in its default app, and right-clicking it should offer Open file location

**Observed:** 2026-09-26 by Aryan during manual testing · **Phase:** Edited files Phase 3 (file paths in the terminal output are links, `docs/edited-files/`) · **Status:** open · **Severity:** low (a feature request: nothing is broken or lost) · **Screenshot:** none attached

**What happens:**
This is a feature request, not a defect. A file path in the terminal output is a file link: underlined on hover, and a click opens it (markdown and code in VS Code today). Aryan wants a click on a file link to open the file in the native tool for it, meaning the app Windows uses for that file type. He also wants a right-click menu on a file link with an "Open file location" item that shows the file in File Explorer.

**Steps to make it happen again:**
1. In a chat, hover a file path Claude wrote in the terminal until it is underlined.
2. Click it: it opens in VS Code, not in the file type's default app.
3. Right-click it: there is no "Open file location" item.

**Evidence:** Only the description above. The menu item name Aryan asked for: "Open file location".

---

## Rail badges and sidebar thread states are lost when afterterm is restarted, only Mark as unread survives

**Observed:** 2026-09-29 by Aryan during manual testing · **Phase:** 7 (attention state: needs-you, finished and unread, shown on the Phase 8 rail tiles and on the sidebar thread rows) · **Status:** open · **Severity:** medium (a waiting or finished thread no longer shows it after a restart, so it can be missed) · **Screenshot:** none attached

**What happens:**
The notification badges beside the project tiles on the rail do not survive closing and restarting afterterm. Of all the thread states, only a thread marked with "Mark as unread" still carries its mark after the restart. Aryan expects the other states to survive the restart too, both on the rail and as the state highlight on each thread's row in the sidebar.

**Steps to make it happen again:**
1. Have threads with states showing: at least one waiting for you or finished, so their project has badges on the rail and the threads show their state on their sidebar rows.
2. Mark one chat with "Mark as unread".
3. Close afterterm and open it again.
4. The rail badges and the sidebar row states are gone; only the chat marked unread still shows its mark.

**Evidence:** Only the description above. The item Aryan named as the one that survives: "Mark as unread".

---

## Pop-up notifications stay on screen while the afterterm window is open, instead of vanishing after a few seconds

**Observed:** 2026-09-29 by Aryan during manual testing · **Phase:** pre-existing (the overlay pop-up notifications; the rail they make redundant is Phase 8) · **Status:** open · **Severity:** medium (the pop-ups crowd the screen and make the rail's notifications pointless while the window is open) · **Screenshot:** none attached

**What happens:**
A pop-up notification that arrives while the afterterm window is open stays on screen until it is closed by hand. Aryan expects it to vanish after a few seconds, like a regular pop-up notification, since the rail already shows the same notification. When the afterterm window is not open, the pop-up should keep persisting until the user closes it, which is how it behaves today. Because pop-ups persist while the window is open, they make the rail notifications useless.

**Steps to make it happen again:**
1. Have the afterterm window open.
2. Let a thread raise a notification (for example a chat finishing a turn or waiting for you) so a pop-up appears.
3. Wait: the pop-up stays on screen until it is closed by hand, rather than vanishing after a few seconds.

**Evidence:** Only the description above.

---

## A chat running a background agent shows only its server as running, with nothing for the background agent

**Observed:** 2026-09-29 by Aryan during manual testing · **Phase:** 5 (servers: the port pill and the "Running on" chip; the background state on the row and the header came in PR #40) · **Status:** open · **Severity:** medium (a background agent at work is invisible in the sidebar and the header) · **Screenshot:** `docs/screenshots/manual-testing/13-server-running-shown-while-background-agent-runs-unmarked.png`

**What happens:**
A chat has a background agent running, but the UI does not show it: the sidebar row and the header show only that a server is running. A server is indeed running in this thread. Aryan is not sure a server that Claude Code started should be highlighted in the UI at all. How to solve this in the UI is still open: show both the server and the background task, or find another solution. That choice is Aryan's to make.

**Steps to make it happen again:**
1. In a chat, have Claude Code start something that listens on a port, so the thread shows a port pill and "Running on :<port>".
2. Have Claude Code start a background agent in the same chat, so its footer shows the agent running and "Waiting for 1 background agent to finish".
3. The sidebar row and the header still show only the running server; nothing shows the background agent.

**Evidence:**
- `13-server-running-shown-while-background-agent-runs-unmarked.png`: the thread "Revy Phase 4 rebuild" in the project "Revy App" (Opus 5.5, branch and worktree `phase-4-all-plant-types`), at 14:10 on 29-09-2026. Its sidebar row, underlined in red, shows `:5554` and the green play icon; the header shows "Running on :5554". The terminal ends with "Waiting for 1 background agent to finish", and Claude Code's footer, also underlined in red, shows a `general-purpose` agent at work ("Scrolling to STP dosing details"). The commands in the output address an Android emulator named `emulator-5554`.
- Aryan's words: "there is a background agent running but UI doesn't show it, UI shows a server is running".

---

## MP4 and HTML file links in a chat's terminal output open in VS Code instead of their own apps

**Observed:** 2026-09-29 by Aryan during manual testing · **Phase:** Edited files Phase 3 (file paths in the terminal output are links, `docs/edited-files/`; any file name with an extension became a link in PR #44) · **Status:** open · **Severity:** medium (a link opens the file in the wrong app) · **Screenshot:** none attached

**What happens:**
A file path highlighted as a link in a chat's terminal output opens in VS Code when clicked, even when the file is an MP4 video or an HTML page. Aryan expects such files not to open in VS Code.

**Steps to make it happen again:**
1. In a chat, have Claude mention the path of an MP4 file and of an HTML file in its output, so each is highlighted as a link.
2. Click the MP4 link: it opens in VS Code.
3. Click the HTML link: it opens in VS Code.

**Evidence:** Only the description above. Aryan's words: "even MP4 and HTML files are openeing in vs code from the chat highlights". Related open entry: "Clicking a file link in the terminal should open the file in its default app, and right-clicking it should offer Open file location" (2026-09-26).

---

## Opening a chat from another project moves that project to the top of Recent in the sidebar, without typing anything and without an animation

**Observed:** 2026-09-30 by Aryan during manual testing · **Phase:** 8 (the panel's Pinned and Recent split and Recent's order by activity) · **Status:** open · **Severity:** medium (the Recent list reorders on a plain click) · **Screenshot:** none attached

**What happens:**
In the Recent section of the sidebar, just opening a chat from some other project brings that project to the top of the list. Aryan finds this weird: a project should only come to the top when he types something into one of its threads, not when he only opens a chat. He also wants the move to the top to be animated when it happens.

**Steps to make it happen again:**
1. Have two or more projects in the sidebar's Recent section.
2. Click a chat in a project that is not at the top of Recent, without typing anything into it.
3. That project jumps to the top of Recent at once, with no animation.

**Evidence:** Only the description above. Aryan's words: "just opening a chat from some other project bring it to the top. This is weird, if I input something, then they should come on top. Also, there should be animation for it".

---

## Some file paths in a chat's reply are highlighted as links and others are not

**Observed:** 2026-09-30 by Aryan during manual testing · **Phase:** Edited files Phase 3 (file paths in the terminal output are links, `docs/edited-files/`) · **Status:** open · **Severity:** medium (paths Claude gives in a reply cannot be opened from the terminal) · **Screenshot:** `docs/screenshots/manual-testing/14-chat-reply-screenshot-paths-some-link-some-do-not.png`

**What happens:**
Aryan asked a chat for the paths of test screenshots. In Claude's reply, some of the file and folder paths work with the link highlight (underlined on hover, open on click) and some do not. He expects every path in the reply to work as a link.

**Steps to make it happen again:**
1. In a chat, ask Claude for the paths of some files, so its reply lists them (full paths, paths relative to a folder the reply names, and bare file names).
2. Hover each path in the reply: some are highlighted as links and some are not.

**Evidence:**
- `14-chat-reply-screenshot-paths-some-link-some-do-not.png`: the thread "Revy Phase 4 rebuild" in the project "Revy App" (Opus 5.5, branch and worktree `phase-4-all-plant-types`, header showing "35 files" and "Working"). The reply, written on 2026-09-30 at about 13:02, starts "1. Animation screenshots folder" with the full path `D:\Pitara\Work\For Friends\Revy App\.claude\worktrees\phase-4-all-plant-types\docs\testing\phase-4\phase-3-changes\screenshots\animations\`, then names `17-open-deleted-card-t0.05.png` to `t0.80.png`, then says "All screenshot paths below start from `D:\Pitara\Work\For Friends\Revy App\.claude\worktrees\phase-4-all-plant-types\docs\testing\phase-4\`" and lists paths such as `screenshots\revy-admin\24-stp-parameter-list-still-lists-biogas-parameters.png` and `screenshots\edge-cases\23-trend-chart-after-rapid-period-and-toggle-taps.png` under each issue.
- Further down, the same reply says "All paths here start with `phase-3-changes\screenshots\`" and lists paths such as `plant-supervisor\39-etp-delete-dialog-landscape-top.png`.
- The reply before it in the same chat (2026-09-29) gave paths from the worktree's root, such as `docs/testing/phase-4/bugs.md`.
- Aryan's words: "in the messagee where I asked for screenshot links in the chat, some links work with the highlight feature, some don't."

---

## A chat whose background subagent is running shows no running state on its thread

**Observed:** 2026-09-30 by Aryan during manual testing · **Phase:** 7 (attention: thread states on the row, the header, the project and the rail; the background state came in PR #40) · **Status:** open · **Severity:** medium (a subagent at work is invisible outside the terminal) · **Screenshot:** `docs/screenshots/manual-testing/15-subagent-running-but-thread-shows-no-status.png`

**What happens:**
A subagent is running in a chat, but the thread's status does not show it. Earlier, while that subagent was running, Aryan put the laptop to sleep. When he opened it again, Claude started the subagent again by itself to continue. He thinks this might be connected, but he is not sure.

**Steps to make it happen again:**
1. In a chat, have Claude start a subagent in the background.
2. While it runs, put the laptop to sleep.
3. Open the laptop again: Claude starts the subagent again by itself to continue.
4. While the subagent runs, the thread's sidebar row, its header and its project show no running or background state.

Aryan is not sure step 2 is needed.

**Evidence:**
- `15-subagent-running-but-thread-shows-no-status.png`: the thread "Phase 4 fixes testing on Android emulator" in the project "Revy App" (Opus 5.5, branch and worktree `phase-4-all-plant-types`), open in the workspace. The terminal shows `Agent(Test Phase 4 chart fixes on fixture 1)` with "Backgrounded agent", then `Monitor(emulator stops answering during run 2)` with "Monitor started", and Claude's reply "The second tester run (fixture 1: plant list and every Trend Charts fix) is going" ending "I'll report everything once run 2 finishes." Claude Code's footer shows "auto mode on · 1 monitor" and "1 agent", and a `general-purpose` agent at work ("Checking Silica 30-day chart dates", 14m 51s, 154.9k tokens). The prompt is empty and waiting. Meanwhile the header has no state chip, only "17 files"; the thread's sidebar row has no state icon; the Revy App project row has no counter pill; and the rail has no Revy App tile.
- Aryan's words: "sub-agent is running but the thread doesn't show that in the status. Also I put the laptop on sleep earlier when the subagent was running and then I opened it againa and claude automatically started the subagent to conitnue. This might have caused the bug, but I am not sure."
- Where to read it: in Aryan's afterterm the thread is `tab-190`, Claude session `479d09d7-0cb9-4ba1-aae1-5c9302fa98b1`, folder `D:\Pitara\Work\For Friends\Revy App\.claude\worktrees\phase-4-all-plant-types`. Transcript: `%USERPROFILE%\.claude\projects\D--Pitara-Work-For-Friends-Revy-App--claude-worktrees-phase-4-all-plant-types\479d09d7-0cb9-4ba1-aae1-5c9302fa98b1.jsonl`; its subagents' transcripts are in the folder of the same name, under `subagents\`: `agent-a6baa9852bf60d325.jsonl` (the fixture 2 run) and `agent-a93f862640bb0ef85.jsonl` (the fixture 1 run in the screenshot). Read them only; the session was live when this was logged.
- Timeline from that transcript (UTC, with India time in brackets): the session starts at 09:52 (15:22). At 09:57 and 09:58 (15:27, 15:28) Claude starts an agent "Test Phase 4 fixes on fixture 2" (transcript lines 240 and 253). Then nothing is written for 4 hours 14 minutes, which matches the laptop's sleep. At 14:12:57 (19:42) three `<task-notification>` entries arrive, the first for agent `a6baa9852bf60d325` (lines 296 to 298), and at 14:20:39 (19:50) a message from that agent arrives (line 435). At 14:25:22 (19:55) Claude starts "Test Phase 4 chart fixes on fixture 1" (line 572), agent `a93f862640bb0ef85`, the one the screenshot shows at 14m 51s, so the screenshot is from about 14:40 (20:10).

---

## Pressing Ctrl+Shift+R sends afterterm to Home and puts every thread to sleep

**Observed:** 2026-09-30 by Aryan during manual testing · **Phase:** 4 (sleep and wake: threads restored asleep; Home on opening is Phase 2) · **Status:** open · **Severity:** high (every running shell, server and chat is stopped by one key press) · **Screenshot:** none attached

**What happens:**
Pressing Ctrl+Shift+R suddenly takes Aryan to the Home screen and puts all his threads to sleep. He did not expect the key press to do anything like this.

**Steps to make it happen again:**
1. Have some threads awake in the workspace.
2. Press Ctrl+Shift+R.
3. afterterm switches to Home, and every thread is asleep.

**Evidence:** Only the description above. Aryan's words: "doing ctrl+shit+R suddenly takes me to home and puts all sessions to sleep. WTF!"

---

## The order of project tiles on the rail follows a rule Aryan cannot see and never chose

**Observed:** 2026-10-01 by Aryan during manual testing · **Phase:** 8 (the always-on rail and its project tiles) · **Status:** open · **Severity:** medium (the rail decides which project comes on top, and Aryan cannot predict or set it) · **Screenshot:** none attached

**What happens:**
When notifications arrive and projects appear on the rail, Aryan cannot tell how the tiles are arranged or why one project sits above another. He does not know whether the order is by recency, by pinning or by something else; to him it is a black box. He expects to know the rule and to decide consciously which project comes on top, so the order can be designed rather than left as it is.

**Steps to make it happen again:**
1. Have threads in two or more projects reach a state that puts their project on the rail (waiting, finished or compacting).
2. Look at the rail's tiles.
3. Nothing on screen says why the tiles are in that order, and there is no way to choose which one comes on top.

**Evidence:** Only the description above. Aryan's words: "When notifications come on the rail, how are they arranged? I need to consciously work on that. I need to consciously decide which comes on top. Are we doing it on the basis of recency, or are we pinning them? How are we doing it? Need to know that and work on it. Right now, it is a black box to me."

---

## The rail's project icons and coloured number badges do not say what they mean

**Observed:** 2026-10-02 by Aryan during manual testing · **Phase:** 8 (the always-on rail, its project tiles and their badges) · **Status:** open · **Severity:** medium (the rail is there to show what needs attention first, and Aryan cannot read it) · **Screenshot:** `docs/screenshots/manual-testing/16-rail-tiles-and-badges-with-no-names-or-meanings.png`

**What happens:**
Aryan looks at the rail and cannot tell what its icons and badges are: which project each icon stands for, and what each coloured number means. Because of that he cannot use the rail to decide what to deal with first, so to him the rail is useless at this point. He expects the rail to make clear what each icon and each badge means, so he can prioritise from it.

**Steps to make it happen again:**
1. Have threads in several projects waiting, working or finished, so their projects appear as tiles on the rail.
2. Look at the rail.
3. Each tile is a project icon with one or two coloured number badges beside it, and nothing on the rail says which project it is or what each badge colour and number stands for.

**Evidence:**
- `16-rail-tiles-and-badges-with-no-names-or-meanings.png`: afterterm v0.8.1 with the rail and the panel open. Below the Home and Workspace pill the rail has seven project tiles and no names: a blue robot with a green 1; a red bell with a grey 1 and a green 1; a yellow pencil with an amber 1 and a grey 1; a red film strip with a green 1; a blue film strip with an amber 1; an orange robot with a green 1; a pink robot with a green 1. The panel beside it shows the projects "Revy App" (7), "Outscal full-l..." (with a bell 1 pill and a spinner 1 pill; its threads "Course creation dec..." with a bell and "Video generator ..." with a spinner), and under Recent "afterterm" (thread "Monday work in Aft..." with a tick), "Tinkering", "OpenMousBot" (1), "contentchecker" (1), "afterbot" (1) and "manus video" (1, with a bell 1 pill), then "Other projects" (8).
- Aryan's words (spoken, so "reel" is the rail and "privatize" is most likely "prioritize"): "At this point, the reel is useless because I don't fucking know what all these logos and icons and all that are. I don't know what this icon means, and I don't know how to privatize shit."

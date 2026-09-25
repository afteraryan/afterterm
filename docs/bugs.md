# afterterm — Known Bugs

Running list of observed bugs that are **not yet fixed**. Fixed bugs get removed from here (their fix lives in git history / `CLAUDE.md`). For inherent *platform limitations* (input lag, Wispr, etc.) see the **Known Limitations** section in [`../CLAUDE.md`](../CLAUDE.md) — those are constraints, not bugs on a fix-list.

Format per bug: a short title, the date observed, what happens, repro if known, and any hypothesis about the cause.

This one file is where every bug goes, and `docs/screenshots/manual-testing/` is where every screenshot that comes with a bug goes (numbered, named for what it shows, committed, never deleted). A bug found during Aryan's manual testing after the projects-and-threads phases also carries the phase it belongs to and a link to its screenshot. Agreed with Aryan on 2026-09-08.

---

Every entry from the manual-testing round after the projects-and-threads phases (seven bugs plus the thread-folder Explorer ask) was closed in Phase 9 on 2026-09-19; see PHASES.md's Phase 9 section and Log for what each fix was and how it was verified. Entries below are from Aryan's use of the Phase 9 build.

---

## The jump button stays on screen after scrolling stops instead of going away on its own

**Observed:** 2026-09-20 by Aryan during manual testing · **Phase:** 9 (long output, the jump button) · **Status:** open · **Severity:** low (a lingering control) · **Screenshot:** none attached

**What happens:**
Once the jump button has appeared during a scroll, it stays until the scroller reaches an end or the button is clicked. Aryan expects it to disappear on its own a moment after the scrolling stops, about a second, the exact time to be settled.

**Repro:**
1. Open a thread with long output (a live terminal or an asleep pane with a long tail).
2. Scroll up a few lines and stop.
3. The button appears and stays as long as the position is away from that end; nothing hides it while the mouse is idle.

**Cause:** the show-or-hide rule in `src/renderer/jumpScroll.ts` (`onScrollSample`) is a function of position and direction only; there is no idle timer anywhere. Fix direction: in both hosts (`AsleepPane/index.tsx`'s `onScroll`, `Terminal/index.tsx`'s `term.onScroll` sampling) start a timer on every user scroll sample that shows the button and clear the target when it fires (about a second, the exact value Aryan's to settle), resetting the timer on each further scroll, with the hide going through the existing scale-out; a hover over the button should probably hold it open.

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

## Opening a project from Home or from the Other projects drawer does not bring its row into view in the sidebar

**Observed:** 2026-09-21 by Aryan during manual testing · **Phase:** 8 (the panel, the docked Other projects row; the Home card route is Phase 2) · **Status:** open · **Severity:** medium (the sidebar loses the user after every project switch) · **Screenshot:** none attached

**What happens:**
When Aryan opens a project from Home, or brings one in from the Other projects drawer, the workspace opens on it but the sidebar does not show him where that project is: he has to look for it, or search for it, in the sidebar list. He expects the sidebar to have that project in focus, scrolled into view with its rows expanded (its toggle open), so the project he just chose is the one he sees.

**Repro:**
1. On Home, click a project card or row that sits low in the sidebar's list (below the visible part, or behind a fold).
2. The workspace opens on that project's thread, but the sidebar is left where it was; the project's row may be off screen.
3. The same after opening a project from the Other projects drawer.

**Cause:** `openProject` and `bringProjectIn` in `src/renderer/hooks/useTabState.ts` expand the project (`collapsed: false`) and activate a thread, but nothing scrolls the sidebar: there is no `scrollIntoView` anywhere in `SidePanel/index.tsx` or `app.tsx`, and the panel's five-row fold only auto-opens for the active thread or a waiting one. Fix direction: after an activation that came from Home, the rail or the drawer, scroll the project's row (or the activated thread's row) into view in the panel's `.scroll` container and make sure the fold shows it; a brief highlight on the row would make the landing obvious.

---

## "Open" should not be in the thread menus at all, and the header dots menu should be its own menu, not the sidebar one

**Observed:** 2026-09-21 by Aryan during manual testing · **Phase:** 1 (the one thread menu, shared by the sidebar right-click and the header dots button) · **Status:** open · **Severity:** low (a dead menu item) · **Screenshot:** `docs/screenshots/manual-testing/05-header-dots-menu-open-item-on-the-already-open-thread.png`

**What happens:**
The dots menu on the main pane header offers Open, Sleep, Mark as unread, Move to project, Open project page, Open in File Explorer and Close. Aryan asked what "Open" does there. Nothing visible: the header belongs to the thread that is already open, so the item re-activates the thread that is active. The item exists because the same menu is built for the sidebar's right-click and the project page's rows, where Open switches to that thread.

Aryan's decision (2026-09-21): there should be no Open item in either menu, neither the sidebar right-click nor the header dots menu (a click on the row already opens the thread). And the two should be two separate menus, built for their own place, not one menu reused: the header's menu is for the thread on screen and gets the items that make sense there (see the next entry for "Open in VS Code").

**Repro:**
1. In the workspace, click the dots button at the right of the header.
2. Click "Open". Nothing changes.

**Cause:** `buildThreadMenu` in `src/renderer/threadMenu.tsx` is the one menu for the sidebar right-click, the header dots button and the project page rows, and always puts Open first; the header's caller in `app.tsx` passes `open: () => state.activateTab(activeTab.id)`, which activates the thread that is already active. Fix direction: drop Open from `buildThreadMenu` entirely, and split the header's menu into its own builder (a `buildHeaderMenu`, or a `place` argument) so the header and the sidebar can differ in items and order.

---

## The header dots menu has no "Open in VS Code" for the thread's own folder, and which folder each action opens is not written down

**Observed:** 2026-09-21 by Aryan during manual testing · **Phase:** 9 (Open in File Explorer for a thread's own folder; the editor launch is Phase 2) · **Status:** open · **Severity:** medium (a missing action, and a rule that has to be settled before more of them are added) · **Screenshot:** none attached

**What happens:**
The header dots menu has "Open in File Explorer", which opens the thread's own folder (the worktree when the chat runs in one). Aryan wants "Open in VS Code" beside it, working the same way: if the thread is in a worktree, VS Code opens on the worktree, not the project root. Today the only editor launch is on the project menu and the project page, and it always opens the project root.

He also wants it settled, and written down, which actions open the project root and which open the thread's own folder (the worktree), so every button follows one rule. What the code does today:

| Where | Action | Opens |
|---|---|---|
| Project menu (sidebar row, Home card or row, rail tile, project page) | Open in File Explorer, Open in <editor> | the project root (`Group.cwd`) |
| Header line 2, the project item | click | the project root |
| Header line 2, the worktree item | click | the thread's own folder (`threadFolder`: the chat's Claude folder, a shell's cwd) |
| Thread menu (sidebar right-click, header dots, project page row) | Open in File Explorer | the thread's own folder |
| Thread menu | Open in <editor> | missing |

Proposed rule for the fix: anything reached from a project (project menu, project page, the header's project item) opens the project root; anything reached from a thread (thread menu, the header's worktree item, and the new Open in <editor> on the thread menu) opens the thread's own folder. Aryan to confirm before it is built.

**Repro:**
1. Open a chat thread that runs in a worktree (the header shows a worktree item).
2. Click the header's dots button: there is Open in File Explorer, no Open in VS Code.
3. The only Open in VS Code is on the project menu, and it opens the project root, not the worktree.

**Cause:** `buildThreadMenu` in `src/renderer/threadMenu.tsx` takes `openInExplorer` but nothing for an editor, while `buildProjectMenu` in `projectMenu.tsx` builds the "Open in <editor>" entries from the detected editors (`ctx.editors`) and `actions.openInEditor(group.id, editorId)`, which resolves the project's `cwd`. The editor launch itself (`editors.open(folder, editorId)` in `preload.ts`, `main.ts`) already takes any folder, so the thread side only needs the same entries built from `threadFolder(tab)` with the same "Folder not found" disabled state. Fix direction: add the editor entries to the thread menu next to Open in File Explorer, through a `threadEditor(tab)` in `app.tsx` mirroring `threadExplorer(tab)`, and record the root-versus-worktree rule above in CLAUDE.md once Aryan confirms it.

---

## New threads are added at the bottom of a project, so the latest ones sit behind "Show more"

**Observed:** 2026-09-21 by Aryan during manual testing · **Phase:** 1 (the sidebar's thread rows and the five-row fold; the fold's waiting rule is Phase 8) · **Status:** open · **Severity:** medium (the threads being worked on are the ones hidden) · **Screenshot:** none attached

**What happens:**
Inside a project, a new thread is appended after the existing ones, so the latest threads are at the bottom of the list. With more than five threads the fold hides everything after the fifth, which means that as soon as Aryan starts working, the threads he just opened are the ones behind "Show more" and the old ones are the ones on show. He wants the arrangement of threads inside a project changed; the first thing to try is putting a new thread at the top so the older ones get pushed down.

**Repro:**
1. In a project that already has five or more threads, open a new thread.
2. It appears as the last row, behind "Show 1 more"; the five oldest threads stay visible.

**Cause:** `addTab` in `src/renderer/hooks/useTabState.ts` appends the new tab after the last tab of its group (`[...prev, newTab]`, or spliced after the group's last index), and the sidebar shows a project's threads in tab order with `foldThreads` (`threadView.ts`) keeping the first five. Fix direction: insert a new thread before the group's first tab instead of after its last (so tab order itself is newest first), or keep the order and sort a project's rows by `lastActiveAt` before folding; the first is what Aryan asked to try first, and it also keeps Ctrl+Tab's session order meaningful.

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

## A notification toast keeps the project's old colour and icon after the project is edited

**Observed:** 2026-09-21 by Aryan during manual testing · **Phase:** 1 (the overlay toast cards; the project icon on them is Phase 9) · **Status:** open · **Severity:** low (cosmetic, and only until the toast is dismissed) · **Screenshot:** none attached

**What happens:**
A toast from the Spotify taskbar project was showing. Aryan then edited that project in the sidebar, changing its colour and its icon. The toast kept the old colour and icon. He expects a change made in one place to show everywhere the project is drawn, the toast included.

**Repro:**
1. Have a toast on screen for a thread in some project.
2. Edit that project (right-click its row, Edit project) and change its colour or icon.
3. The sidebar, rail and header update; the toast does not.

**Cause:** a toast is a snapshot: `handleNotification` in `src/renderer/app.tsx` pushes `projectColor` and `projectIcon` as plain values in the `notify:push` payload, and `NotifierApp.tsx` in the overlay window renders whatever it received; the overlay has no access to the main window's project state and no message ever tells it a project changed. Fix direction: on a project edit, push a `notify:project-updated` with the new colour and icon (and label) for the overlay to apply to its open toasts for that project, or resend the affected toasts; the rail and the sidebar need nothing, they render from state.

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

## A chat has no "Open in VS Code" button, and the editor action should sit outside the dots menu

**Observed:** 2026-09-25 by Aryan during manual testing · **Phase:** 9 (the thread's own folder in Explorer; the editor launch is Phase 2) · **Status:** open · **Severity:** medium (a daily action is missing from where he needs it) · **Screenshot:** none attached

**What happens:**
There is no "Open in VS Code" on a chat at all, and Aryan wants one. He also wants it out of the three-dot dropdown: a button of its own, visible without opening a menu, the way the project page carries its Explorer and editor buttons. It must open the folder the thread is actually in: the worktree when the chat runs in one, the project root when it runs there.

This extends the earlier entry "The header dots menu has no 'Open in VS Code' for the thread's own folder, and which folder each action opens is not written down", which asked for the menu item; this one adds where the control belongs (a button, not a menu item).

**Repro:**
1. Open a chat thread, in a worktree or not.
2. There is no Open in VS Code anywhere on it: not as a button in the header, not in the dots menu.
3. The only editor launch is on the project menu and the project page, and it opens the project root.

**Cause:** `buildThreadMenu` in `src/renderer/threadMenu.tsx` takes `openInExplorer` and nothing for an editor, and the header (`components/Header/index.tsx`) has only the state chip and the dots button in its actions area; `buildProjectMenu` and the project page build editor entries from the detected editors and open `Group.cwd`. The launch itself (`editors.open(folder, editorId)` through `preload.ts` and `main.ts`) takes any folder, so the thread side needs the folder from `threadFolder(tab)` and a place to put the control. Fix direction: an editor button in the header's actions area beside the dots (the primary editor's logo, the same disabled "Folder not found" state the project page uses), opening `threadFolder(tab)`; the menu item from the earlier entry can stay for the sidebar rows. Settle it together with the root-versus-worktree rule in that entry.

---

## The project row shows a green play pill both when Claude is working in a thread and when a thread is running a server

**Observed:** 2026-09-25 by Aryan during manual testing, clarified the same day · **Phase:** 5 (the count mixes working and running since running state was added; the project pills are Phase 1) · **Status:** open · **Severity:** low (a misleading mark) · **Screenshots:** `docs/screenshots/manual-testing/08-project-pill-shows-play-while-a-chat-is-working.png`, `docs/screenshots/manual-testing/09-project-pill-play-for-a-thread-running-a-server.png`

**What happens:**
A project row carries one pill with a green play icon and a count, and it shows for two different things:

- A chat Claude is working in. The thread row shows the grey rotating circle (the spinner), but its project, afterterm in screenshot 08, shows "▶ 1".
- A thread running a server. The thread row shows its port (`:6402`) and the green play icon, and its project, Revy App in screenshot 09, shows the same "▶ 1".

Aryan's point: the project should show what its threads show. A working thread spins, so its project should show the rotating circle, not a play; a play on the project is only right when a thread is running a server. When he first logged this he called the spinner a "green circle"; he meant the rotating circle.

**Repro:**
1. Send a prompt in a chat so Claude starts working: the thread row shows the spinner, the project row shows "▶ 1".
2. Start a dev server in another project's thread: that thread row shows `:port` and a play icon, and its project row also shows "▶ 1". The two project pills look identical.

**Cause:** `projectCounts` in `src/renderer/threadView.ts` returns `running: counts.working + counts.running`, adding the threads in the working state (the spinner) to the threads running a server (the play icon), and the project row's pill (`components/SidePanel/index.tsx`, `IconPlay` in `.si.run`) and Home's project cards and rows (`components/Home/index.tsx`, `StateIcon state="running"`) draw that one number with the play icon. The thread rows are right: `StateIcon` draws the spinner for `working` and the play for `running`. Fix direction: count working and running separately and give the project row and Home one pill each, the spinner with the number of working threads and the green play with the number of servers, each shown only when above zero, so a project with both shows both.
---

## A block of Claude's output is printed twice in the terminal

**Observed:** 2026-09-25 by Aryan during manual testing (an old problem, still happening) · **Phase:** pre-existing (the terminal's output path) · **Status:** open · **Severity:** medium (the scrollback cannot be trusted to show what was said once) · **Screenshot:** `docs/screenshots/manual-testing/06-claude-output-block-repeated-in-the-terminal.png`

**What happens:**
Now and then a chunk of Claude Code's output appears twice in a row: in the screenshot the same summary block (the five bullet lines and the numbered "Issues found" list) is printed once, then printed again a few lines later, the second copy reflowed to the full width. It is annoying and has been happening for a long time. Aryan does not know whether it is something terminals do in general, something people complain about elsewhere, or something afterterm is causing, and wants that settled before a fix is attempted.

**Repro:**
As observed; repro not yet known. Seen in a chat thread running Claude Code while it printed a long block, and the second copy wraps at a different width from the first, which suggests the terminal was resized (or refit) between the two.

**Cause:** not investigated in the code beyond checking the obvious duplicate-listener paths, which look sound: `pty.onData` in `src/preload.ts` keeps one handler per tab in `dataListeners` and `offData` removes it, and `Terminal/index.tsx` registers it once per created terminal with `creatingRef` guarding a double create. The reflowed second copy points instead at a redraw by the program: Claude Code's TUI repaints its transcript when the terminal size changes, and afterterm refits on every container resize (the `ResizeObserver` in `Terminal/index.tsx`, and the refit when the workspace becomes visible again), each refit sending a new size to the PTY. So the first question to answer is whether this is a repaint on resize (which would also happen in Windows Terminal if it is resized at the same moment, making it Claude Code's behaviour, not afterterm's) or a genuine double write by afterterm. Investigation plan: reproduce with `drive record` while resizing the window and switching screens, compare against the same session in Windows Terminal at the same sizes, and check whether the duplicate ever appears with no resize at all.

---

## There is no list of the files a chat has edited, and no way to open one without a clickable path in the output

**Observed:** 2026-09-25 by Aryan during manual testing · **Phase:** 3 (thread identity, what afterterm reads from a Claude session) · **Status:** open · **Severity:** medium (a daily action has no support at all) · **Screenshot:** none attached

**What happens:**
Opening a file that Claude just edited depends on Claude having written the path in a form the terminal turns into a link, and it does not always do that. Aryan does not want to have to ask for paths in a particular format. He wants afterterm to know which files a chat has edited, show them as a list he can open from, newest edit first.

**Repro:**
1. Work in a chat thread until Claude edits several files.
2. To open one, look through the output for a path the link addon made clickable; if Claude wrote it plainly, or wrote it relative, there is nothing to click and nothing else in the app knows the file exists.

**Cause:** nothing in afterterm tracks edited files: the transcript reader (`src/claude-transcript.ts`) reads only the first prompt, the latest model and the newest cwd, and the terminal's only file affordance is the web-links addon over whatever text the shell printed (`Terminal/index.tsx`). The data is there to build it: every `Edit`, `Write` and `NotebookEdit` tool call in the session transcript carries `input.file_path` in an assistant message's `content`, in order, so a tail read of the same JSONL gives the edited files newest first (checked against a real transcript on 2026-09-25). Fix direction: extend the transcript reader to collect the last N distinct `file_path` values from those tool calls, and show them for the active chat (a panel, a header popover or a project page tab, Aryan's choice), each row opening the file in the detected editor through the existing `editors:open` IPC (which takes any path) or revealing it in Explorer; the read already happens once a turn, so a list would stay current without polling.

---

## The sidebar toggle moves off the rail once the sidebar opens, so clicking the same spot again opens Home

**Observed:** 2026-09-25 by Aryan during manual testing · **Phase:** 8 (the rail and the panel) · **Status:** open · **Severity:** medium (a click lands on the wrong control) · **Screenshot:** none attached

**What happens:**
With the sidebar closed, Aryan opens it from the rail. To close it again he clicks the same place without looking, and Home opens instead: the toggle is no longer there, and the Home button has moved up into that spot. He wants the open and close toggle to live permanently on the rail, in one fixed place, and then the sidebar can use the space that frees up by moving Search up.

**Repro:**
1. Hide the sidebar (Ctrl+Shift+B or the toggle).
2. Click the toggle at the top of the rail: the sidebar opens.
3. Click the same spot again: Home opens, because the toggle now sits in the sidebar's own icon row and the rail's Home button has taken that position.

**Cause:** the rail's toggle lives in a closable block that only shows while the panel is hidden: `components/Rail/index.tsx` renders it inside `.railblk` with `tabIndex={open ? 0 : -1}`, and `Rail.css` collapses `.railblk:not(.open)` to nothing, so the buttons below (the Home and Workspace pill) shift up into its place; the panel carries its own toggle in `SidePanel/index.tsx`'s `.brand` row. Fix direction: one toggle that always sits at the top of the rail, in the same position whether the panel is open or closed, and remove the panel's own copy; the Search row can then move up into the panel's icon row (see the earlier entry about the Search and New thread rows taking too much space), which is the same layout change and should be settled together.

---

## A thread keeps showing "Background tasks" and its spinner after the turn has ended

**Observed:** 2026-09-25 by Aryan during manual testing · **Phase:** 1 (the notification states and the spinner; the clearing paths are in app.tsx) · **Status:** open · **Severity:** medium (the sidebar says a thread is busy when it is idle) · **Screenshot:** `docs/screenshots/manual-testing/07-thread-shows-background-tasks-and-spinner-after-the-turn-ended.png`

**What happens:**
Claude had finished its turn (the transcript shows "Churned for 2m 39s, done 1:49 PM" and the prompt is back, with typed text waiting), but the thread still showed a spinner on its sidebar row and a "Background tasks" chip in the header. Aryan asks why it still reads as working when the message has been sent and the turn is over.

**Repro:**
1. In a thread you are looking at, run a turn that leaves a Claude Code background task (or a session cron) still running when the turn ends.
2. The turn ends: the prompt is back and nothing runs in the foreground, but the row keeps its spinner and the header its "Background tasks" chip.
3. Switch to another thread and back: it clears.

**Cause:** two clearing paths disagree, and the `background` badge falls through the gap. `clearThreadBadges` in `src/renderer/app.tsx` (which runs when a thread is activated) clears `done` and `background` together, but `handleNotification`'s viewing test in the same file clears only `done`: `applyNotif(tabId, cur, next === 'done' && viewing ? undefined : next)`. The `background` title always lands in the thread the user is looking at, because the turn that produced it just ended there, so the viewing test is exactly the path that should clear it and is the one that does not; activation has already happened, so the other path never runs again and the badge stays until the user switches away and back. The state itself is `background`, not `working`: the hook emits `⏳ <project> - bg (N running)` on `Stop` when `background_tasks` still has running entries or session crons remain (`assets/hooks/afterterm-notify.ps1`), and `StateIcon` in `components/Icons.tsx` draws `working` and `background` with the same grey spinner (`case 'working': case 'background':`), which is why a finished turn reads as a busy one.

Fix direction, two changes: include `background` in `handleNotification`'s viewing clear so the two paths treat the same pair of states the same way; and give `background` its own icon instead of the working spinner (`IconHourglass` exists, and Phase 8 did exactly this for compacting), so a badge that is legitimately showing says "background tasks" rather than "Claude is busy". Deliberately not a silence timer: silence says nothing about whether a background task is still running, so a timer would trade a badge that lingers for one that lies the other way. The limit that stays: Claude Code fires no hook when a background task finishes, so afterterm can never report the end on its own; with those two changes that stops mattering.

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

## The thread hover card shows two different ages, "Asleep · 1d" and "Active 2d ago", that read like a contradiction

**Observed:** 2026-09-25 by Aryan during manual testing · **Phase:** 3 (the hover card; the asleep age on it is Phase 4) · **Status:** open · **Severity:** low (confusing wording, nothing misbehaves) · **Screenshot:** `docs/screenshots/manual-testing/12-hover-card-asleep-age-and-active-age-disagree.png`

**What happens:**
Hovering an asleep thread in the sidebar ("Changelog video narrative" in the screenshot) shows the Type row as "Chat · Asleep · 1d" and the Active row as "2d ago". Aryan asked what the difference between the two days is. The first is how long ago the thread was put to sleep (by Sleep, or by quitting afterterm, which sleeps every awake thread), the second is when he last used it; they differ whenever a thread sat awake and idle before it slept, which after a relaunch is almost every thread.

Aryan's decision (2026-09-25): the kind and the status go in two separate rows; the status row shows the same state symbol the app uses for that state elsewhere (the sidebar row's icon) beside its word; the sleep age is dropped from the card; "Active" is renamed "Last used".

**Repro:**
1. Use a thread, leave it idle for a while, then quit afterterm (or sleep the thread) some time later.
2. Hover its row in the sidebar: the Type row carries the sleep age and the Active row an older age.

**Cause:** `ThreadHoverCard.tsx` builds one `typeText` that joins the kind with the state, and for an asleep thread appends `asleepLabel(tab.sleptAt, now)` from `sleepWake.ts`; the Active row is `relativeTime(tab.lastActiveAt, now)`. `sleptAt` is stamped by `sleepTab` and `sleepAllForShutdown`, `lastActiveAt` by `activateTab` and `touchActivity` in `useTabState.ts`. Fix direction: a Type row with `kindWord(tab)` alone, a new Status row with `StateIcon` for `threadState(tab)` and the state word (`stateLabel`, or `runningLabel(port)` for a server), no `asleepLabel` on the card, and the Active row relabelled "Last used".

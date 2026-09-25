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

## The project row's running count uses a play icon while the thread itself shows a green circle

**Observed:** 2026-09-25 by Aryan during manual testing · **Phase:** 5 (running state and its icon; the project pills are Phase 1) · **Status:** open · **Severity:** low (an inconsistent icon) · **Screenshot:** none attached

**What happens:**
A project row shows a pill with a play icon and the number of running threads. Aryan does not think a play button says "running": the thread row itself shows the running circle, and the project should show that same mark, not a play. He asks that every place the play icon stands for "running" be found first, so the change is made everywhere at once.

Where the play icon is used today, from a grep of `src/renderer`:
- `StateIcon`'s `running` case in `components/Icons.tsx`, which draws `IconPlay` inside `.si.run`. That is the thread's own state icon, on the sidebar row, the header chip, the hover card's Type row and the project page rows.
- The project row's counter pill in `components/SidePanel/index.tsx` (`<span className="si run"><IconPlay size={13} /></span>`), the pill Aryan is describing, which is also what Home's totals use.
- The rail tile has no play: its badges are counts (`data-badge="working"` and the rest), so the rail is unaffected.

So the play icon means "running" in two places, and both are the same idea: one for a thread, one for a count of threads.

**Repro:**
1. Start a dev server in a thread so its row turns green with its port.
2. The thread's row shows the running mark; its project's row shows a pill with a play icon and the count.

**Cause:** not a defect in the code, a choice of glyph: `IconPlay` is `StateIcon`'s `running` case and the pill's icon, chosen in Phase 5 when running state was added. Fix direction: pick one mark for running (Aryan's preference is the circle the thread shows) and use it in `StateIcon`'s running case and the counter pill together, checking the hover card, the header chip, Home's totals and the project page at the same time so nothing keeps the old glyph.

---

## A block of Claude's output is printed twice in the terminal

**Observed:** 2026-09-25 by Aryan during manual testing (an old problem, still happening) · **Phase:** pre-existing (the terminal's output path) · **Status:** open · **Severity:** medium (the scrollback cannot be trusted to show what was said once) · **Screenshot:** `docs/screenshots/manual-testing/06-claude-output-block-repeated-in-the-terminal.png`

**What happens:**
Now and then a chunk of Claude Code's output appears twice in a row: in the screenshot the same summary block (the five bullet lines and the numbered "Issues found" list) is printed once, then printed again a few lines later, the second copy reflowed to the full width. It is annoying and has been happening for a long time. Aryan does not know whether it is something terminals do in general, something people complain about elsewhere, or something afterterm is causing, and wants that settled before a fix is attempted.

**Repro:**
As observed; repro not yet known. Seen in a chat thread running Claude Code while it printed a long block, and the second copy wraps at a different width from the first, which suggests the terminal was resized (or refit) between the two.

**Cause:** not investigated in the code beyond checking the obvious duplicate-listener paths, which look sound: `pty.onData` in `src/preload.ts` keeps one handler per tab in `dataListeners` and `offData` removes it, and `Terminal/index.tsx` registers it once per created terminal with `creatingRef` guarding a double create. The reflowed second copy points instead at a redraw by the program: Claude Code's TUI repaints its transcript when the terminal size changes, and afterterm refits on every container resize (the `ResizeObserver` in `Terminal/index.tsx`, and the refit when the workspace becomes visible again), each refit sending a new size to the PTY. So the first question to answer is whether this is a repaint on resize (which would also happen in Windows Terminal if it is resized at the same moment, making it Claude Code's behaviour, not afterterm's) or a genuine double write by afterterm. Investigation plan: reproduce with `drive record` while resizing the window and switching screens, compare against the same session in Windows Terminal at the same sizes, and check whether the duplicate ever appears with no resize at all.

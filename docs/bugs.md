# afterterm — Known Bugs

Running list of observed bugs that are **not yet fixed**. When a bug is fixed, its entry is deleted from here and a short entry is added to [`bugs-fixed.md`](bugs-fixed.md) in the same change (what was wrong, what the fix does, the PR), and the fix goes in `CHANGELOG.md`'s Fixed list. For inherent *platform limitations* (input lag, Wispr, etc.) see the **Known Limitations** section in [`../CLAUDE.md`](../CLAUDE.md) — those are constraints, not bugs on a fix-list.

Format per bug: a short title, the date observed, what happens, repro if known, and any hypothesis about the cause.

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

## There is no list of the files a chat has edited, and no way to open one without a clickable path in the output

**Observed:** 2026-09-25 by Aryan during manual testing · **Phase:** 3 (thread identity, what afterterm reads from a Claude session) · **Status:** open, design agreed 2026-09-25 in [`design-04-edited-files.md`](design-04-edited-files.md) · **Severity:** medium (a daily action has no support at all) · **Screenshot:** none attached

**What happens:**
Opening a file that Claude just edited depends on Claude having written the path in a form the terminal turns into a link, and it does not always do that. Aryan does not want to have to ask for paths in a particular format. He wants afterterm to know which files a chat has edited, show them as a list he can open from, newest edit first.

**Repro:**
1. Work in a chat thread until Claude edits several files.
2. To open one, look through the output for a path the link addon made clickable; if Claude wrote it plainly, or wrote it relative, there is nothing to click and nothing else in the app knows the file exists.

**Cause:** nothing in afterterm tracks edited files: the transcript reader (`src/claude-transcript.ts`) reads only the first prompt, the latest model and the newest cwd, and the terminal's only file affordance is the web-links addon over whatever text the shell printed (`Terminal/index.tsx`). The data is there to build it: every `Edit`, `Write` and `NotebookEdit` tool call in the session transcript carries `input.file_path` in an assistant message's `content`, in order, so a tail read of the same JSONL gives the edited files newest first (checked against a real transcript on 2026-09-25). Fix direction: extend the transcript reader to collect the last N distinct `file_path` values from those tool calls, and show them for the active chat (a panel, a header popover or a project page tab, Aryan's choice), each row opening the file in the detected editor through the existing `editors:open` IPC (which takes any path) or revealing it in Explorer; the read already happens once a turn, so a list would stay current without polling.

---

## Home's project list has no search box, so a project low in the list can only be reached by scrolling or Show more

**Observed:** 2026-09-25 by Aryan during manual testing · **Phase:** 2 (Home and its project list) · **Status:** open · **Severity:** medium (a project is hard to reach from the screen the app opens on) · **Screenshot:** none attached

**What happens:**
On Home, under the pinned cards, the Projects list shows the projects by recent activity with a Show more after the first few. Aryan wants a search box there so he can type a project's name and get it, as part of the list rather than a separate screen. It should feel smooth: the matching projects arrive with an animation and the ones that no longer match leave with one.

**Repro:**
1. Open Home with more projects than the list shows before Show more.
2. To reach one that is further down, expand Show more and scan the list, or leave Home for the search palette; there is nothing to type into on Home itself.

**Cause:** Home has no query at all. `components/Home/index.tsx` renders the pinned cards and then a plain `.list` of rows from `homeSections` in `homeView.ts` (which sorts and splits pinned, unpinned and archived), with a `.more` toggle for the rest; `homeView.ts` has a `filterThreads` helper but nothing that filters projects, and no row animation beyond the page's entrance stagger. The sidebar already has the pattern to copy: an in-place `.srch` box whose value runs through `filterPanel` (`panelView.ts`) and narrows the list as you type. Fix direction: a `filterProjects` in `homeView.ts` (pure, unit-tested, matching the sidebar's case-insensitive substring rule), a search box in Home's Projects section header, and enter and exit animations on the rows; the animation is a look decision, so a mock page with one question for Aryan before it is built.

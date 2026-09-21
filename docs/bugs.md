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

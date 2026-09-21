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

## "Open" in the header's dots menu does nothing, since the thread is already the open one

**Observed:** 2026-09-21 by Aryan during manual testing · **Phase:** 1 (the one thread menu, shared by the sidebar right-click and the header dots button) · **Status:** open · **Severity:** low (a dead menu item) · **Screenshot:** `docs/screenshots/manual-testing/05-header-dots-menu-open-item-on-the-already-open-thread.png`

**What happens:**
The dots menu on the main pane header offers Open, Sleep, Mark as unread, Move to project, Open project page, Open in File Explorer and Close. Aryan asked what "Open" does there. Nothing visible: the header belongs to the thread that is already open, so the item re-activates the thread that is active. The item exists because the same menu is built for the sidebar's right-click and the project page's rows, where Open switches to that thread.

**Repro:**
1. In the workspace, click the dots button at the right of the header.
2. Click "Open". Nothing changes.

**Cause:** `buildThreadMenu` in `src/renderer/threadMenu.tsx` always puts Open first, and the header's caller in `app.tsx` passes `open: () => state.activateTab(activeTab.id)`, which activates the thread that is already active. Fix direction: leave Open out of the menu when it is built for the active thread (a flag on `ThreadMenuActions`, or the header passing no `open`), keeping it for the sidebar and the project page where it means something.

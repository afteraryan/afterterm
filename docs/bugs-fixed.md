# afterterm: fixed bugs

Every bug that has been fixed, newest first, one entry each. Open bugs live in [`bugs.md`](bugs.md); when one is fixed, its entry is deleted there and a short entry is added here in the same change, saying what was wrong, what the fix does and where it landed. The full detail (cause, what was tried, how it was checked) stays where it always was: the dated Log in [`../PHASES.md`](../PHASES.md), the `docs/features-*.md` file for that area, and git history. What changed for the person using the app is also in [`../CHANGELOG.md`](../CHANGELOG.md).

Entries before 2026-09-25 were written from the git history of `bugs.md` and `PHASES.md`. Fixes Aryan asked for while using a build, without a `bugs.md` entry first, are listed too and marked "reported in conversation".

Format: the bug as it was titled, the date it was fixed, the PR or commit, then one or two sentences on the fix.

---

## Fixed on 2026-09-25

### The thread hover card showed two different ages, "Asleep · 1d" and "Active 2d ago", that read like a contradiction

PR pending. The first age was when the thread went to sleep (quitting afterterm sleeps every thread), the second when it was last used. The card now has a Type row with the kind alone, a Status row with the same icon the sidebar row shows beside its word (moon and "Asleep", bell and "Needs you", "Running on :5173" for a server; no row for a quiet thread), no sleep age, and "Last used" in place of "Active" (`statusText` in `threadView.ts`, `ThreadHoverCard.tsx`).

### A thread keeps showing "Background tasks" and its spinner after the turn has ended

PR #39. Opening a thread cleared a background badge, but a `⏳` title landing on the thread already being viewed was only cleared if it was a `✅`, so a turn that ended with background tasks still running left the viewed thread spinning until you switched away and back. Both paths now use one rule (`clearsWhenSeen` and `onViewedTitle` in `spinnerState.ts`): done and background clear on the viewed thread at once; a thread not in view keeps its badge until opened. PR #40 then gave background its own icon, a flipping hourglass, and its own pill, so a badge that is still showing no longer reads as Claude working.

### The sidebar toggle moved off the rail once the sidebar opened, so clicking the same spot again opened Home

PR #38. The toggle is now always the first button on the rail, in the same place on every screen and whether the sidebar is open or closed, so the Home button never moves into its spot. It is the only sidebar toggle: the sidebar's own toggle row is gone, so Search starts at the top of the sidebar. On Home and the project page it opens the workspace with the sidebar showing.

### The thread menu on the project page offered "Open project page" while you were already on that page

PR #38. The project page's thread rows no longer offer it; the sidebar's thread menu still does.

### The project row showed a green play pill both when Claude was working in a thread and when a thread was running a server

PR #38. The project's count added working threads to server threads and drew them all with the play icon, so a chat Claude was working in (a spinner on its row) gave its project a "▶ 1", the same as a server. The project row and Home's cards, rows and totals now have a spinner pill for threads Claude is working in and a play pill for servers, each only when above zero; a project with both shows both.

### "Open" was in the thread menus, and the header's dots menu was the sidebar's menu reused

PR #37. The Open item is gone from every thread menu (a click on a row already opens the thread, and the header's thread is the open one). The header's dots menu is now built on its own (`buildHeaderMenu`), so it can differ from the sidebar's; today it differs only in leaving out Open in VS Code, which is a button beside it.

### New threads were added at the bottom of a project, so the latest ones sat behind "Show more"

PR #37. A new thread, and a thread resumed from a project's History, now goes first in its project, so the five threads on show are the newest.

### A notification toast kept the project's old colour and icon after the project was edited

PR #37. Editing a project's name, colour or icon now tells the toast window, and any toast on screen for that project redraws with the new look.

### Opening a project from Home or from the Other projects drawer did not bring its row into view in the sidebar

PR #37. Opening a project from Home, the rail, the search palette or the Other projects drawer scrolls the sidebar just far enough to show the project and its open thread, and the project row lights up for about a second.

### The jump button stayed on screen after scrolling stopped

PR #37. It now goes away about a second after the scrolling stops, in the terminal and on the asleep pane. Resting the pointer on it keeps it; a pointer that is only turning the wheel does not.

### Enter in the search palette also woke the thread it opened

PR #37. Found while testing the fixes above, not reported. Opening a project whose last thread was asleep put focus on the asleep pane's Wake button while the Enter was still being handled, so the same key press woke the thread (for a chat, a `claude --resume`). The palette now stops the key press once it has used it.

### A chat had no Open in VS Code button, and the editor action belonged outside the dots menu

PR #36. The header has the editor's logo as a button beside the dots. It opens the folder the thread is actually in: the worktree for a chat that runs in one, the project folder for a chat that runs there, a shell's current folder. It is greyed out with "Folder not found" when that folder is gone. The sidebar right-click and the project page rows gained "Open in VS Code" too; the dots menu did not.

### The header dots menu had no Open in VS Code, and which folder each action opens was not written down

PR #36, together with the entry above. The rule is now in `CLAUDE.md`: a control reached from a project opens the project folder, one reached from a thread opens the thread's own folder.

### The header's second line wrapped into the terminal card on a narrower window

PR #36. Found while testing the button above, not reported. The project, model, branch and worktree line could wrap onto a second and third row, which ran into the terminal. It now stays on one row and a long worktree name is shortened with an ellipsis.

---

## Fixed on 2026-09-20

### The Wake box on the asleep pane was hard to read over the saved output

PRs #29, #30 and #31, reported in conversation. Two treatments were tried and rejected (a soft backdrop, then a frosted card). The Wake box is now a white button with a thin border, and the "asleep since" line sits in a solid pill.

### A white square showed at the bottom right of the asleep pane

PR #25, reported in conversation. It was Chromium's white scrollbar corner, plus a horizontal scrollbar the Wake box backdrop caused. The corner is transparent now and the backdrop no longer overflows.

### The header kept showing the old worktree after a chat moved to another one

PR #25, reported in conversation. afterterm now reads the newest folder from the chat's Claude transcript, at launch and before a wake, so the header shows the right branch and worktree and a wake resumes in that folder.

---

## Fixed on 2026-09-19

### Opening a project from Home landed on its first thread, not the one last worked in

PR #24, reported in conversation. A Home card and the Other projects drawer now open the thread you last worked in.

### The jump button appeared when an asleep thread was opened

PR #24, reported in conversation. The button now appears only for scrolling you started (a wheel, a key or a scrollbar drag), never when a pane opens or output arrives.

### A white bar appeared above a toast when coming back to afterterm

PR #23, reported in conversation. Windows briefly drew the overlay window's title bar into it around a show and a focus change. The overlay is now fully repainted at those moments.

### Scrolling over the jump button stopped at the button

PR #23, reported in conversation. A wheel over the button now scrolls the terminal or the pane underneath it.

### The notification overlay appeared on the wrong monitor

PR #23. Toasts now appear on the display that holds the afterterm window.

### The hover card heading overflowed the card for a long unbroken title

PR #23. The heading wraps anywhere and stops at two lines with an ellipsis.

### The toast shadow spread past the card and was cut off at the overlay's edge

PR #23. The shadow was made tighter so it fits inside the overlay's padding.

### The saved output on the asleep pane opened scrolled to the top

PR #23. The pane opens at its newest lines and keeps following its end.

### The dimmed old output replayed on wake stayed on screen after the terminal came back

PR #23. Old output is no longer replayed into the terminal on wake; it is shown on the asleep pane only.

### There was no jump to top or jump to bottom button while scrolling long output

PR #23. One round button at the centre of the terminal or the pane, pointing the way you scroll; a click scrolls there with an animation.

### The header's project, model and branch line was too faint to read

PR #23. The words are brighter at the same size; the icons stay dim.

### A thread's own folder or worktree could not be opened in File Explorer

PR #23. "Open in File Explorer" on the thread menu opens the thread's own folder, and the header's worktree and project items open their folders.

### Pinned and unpinned projects read as one block in the sidebar, and the unpinned list could not be collapsed

PR #23 (Phase 8). The panel has separate Pinned and Recent sections, each with its own collapse button.

### The sidebar had no button to collapse or expand every project at once

PR #23 (Phase 8). Each section heading has a collapse-all and expand-all button.

### Threads in the middle of a turn were hard to find and switch between

PR #23 (Phase 8). The rail shows a tile for every project with a thread working, waiting, finished or compacting, with counts beside it.

### A project that had just become active did not move to the top of the sidebar

PR #23 (Phase 8). Recent is sorted by last activity, so an active project moves up.

### The five-row fold could hide a thread that needed you

PR #23 (Phase 8). The fold stays open while a hidden row is waiting for you.

---

## Fixed on 2026-07-08

### The working spinner stopped while Claude was still running

PR #14 (commit ec7e7f0). A permission prompt or a compaction in the middle of a turn replaced the spinner and nothing brought it back. Output resuming after that pause now turns the spinner back on.

### The working spinner kept spinning after the turn ended

PR #14 (commit ec7e7f0). When Claude reset its title without the "done" mark, nothing cleared the spinner. It now stops after about 2.5 seconds of no output.

---

## Fixed on 2026-05-29

### A tab could not be dragged into the first position of a group

Commit 949f475. A dropped tab lands before or after the row under the pointer, so the first position works, and dropping on a group header puts it at the top of that group.

### The working spinner stopped while Claude was still running (first fix)

Commit 949f475. Opening a thread no longer stops its spinner, and typing an interrupt (Esc or Ctrl+C) now clears it. The spinner stopping mid-turn came back and was fixed on 2026-07-08 (above).

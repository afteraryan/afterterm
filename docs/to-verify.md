# afterterm: changes waiting for Aryan to check

Every change that reaches Aryan's build is listed here until he has checked it while using the app. He marks each one **Works** or **Doesn't work** (with a note). A **Works** item is deleted from this file; a **Doesn't work** item becomes a bug in [`bugs.md`](bugs.md) and is deleted from here. So the file only ever holds what is still to be checked.

Every agent that ships a change Aryan would notice adds it here in the same change, under the build it arrives in: one short line saying what changed, then how to check it in a few steps. Newest build first.

---

## Build after PR #38 (2026-09-25)

### A project's pills: a spinner for working threads, a play only for servers
**Status:** waiting for Aryan
1. Send a prompt in a chat so Claude is working. Its row shows the spinner.
2. Its project row in the sidebar should show a small spinner pill with 1, not a green play.
3. Start a dev server in another project's thread. That project should show the green play pill.
4. On Home, the projects and the totals under the date should show the same two kinds of pill.

### The sidebar toggle stays in one place at the top of the rail
**Status:** waiting for Aryan
1. On Home, the first button on the rail (above Home) is the sidebar toggle. Click it: the workspace opens with the sidebar.
2. Click the same spot again: the sidebar closes. Again: it opens. Home never opens from that spot.
3. The sidebar itself no longer has a toggle row at its top; Search is the first thing in it.

### No "Open project page" on the project page's own thread menu
**Status:** waiting for Aryan
1. Open a project page and right-click a thread in the Live or Asleep tab.
2. The menu has no "Open project page". The sidebar's right-click menu still has it.

---

## Build after PR #37 (2026-09-25)

### No "Open" in the thread menus
**Status:** waiting for Aryan
1. Right-click a thread in the sidebar: no "Open" item.
2. Click the header's dots button: no "Open" item, and no "Open in VS Code" (that is the button beside it).

### New threads appear at the top of their project
**Status:** waiting for Aryan
1. In a project with five or more threads, start a new thread (Ctrl+Shift+T, or the project's plus).
2. It appears as the project's first row, and the oldest thread moves behind "Show more".

### A toast follows an edit to its project
**Status:** waiting for Aryan
1. With a toast on screen for a thread in some project, right-click the project and choose Edit project.
2. Change its colour, icon or name and save. The toast on screen changes to match, without being dismissed.

### Opening a project scrolls the sidebar to it
**Status:** waiting for Aryan
1. Scroll the sidebar down, go to Home and open a project near the top of the sidebar (or open one from the search palette, the rail or the Other projects row).
2. The sidebar scrolls to that project and its row lights up for about a second.

### The jump button goes away on its own
**Status:** waiting for Aryan
1. In a thread with long output, scroll up a little and stop. The round jump button appears.
2. About a second after you stop scrolling it disappears. Scrolling again brings it back.
3. Scroll, stop, then move the pointer onto the button: it stays while the pointer rests on it.

### Enter in the search palette no longer wakes a thread
**Status:** waiting for Aryan
1. Put a chat to sleep. Press Ctrl+Shift+P, type its project's name, press Enter.
2. The project opens on that chat, still asleep. It does not resume the Claude session.

---

## Build after PR #36 (2026-09-25)

### Open in VS Code button on a thread
**Status:** waiting for Aryan
1. Open a chat that runs in a worktree. The header has a VS Code logo button left of the dots.
2. Click it: VS Code opens on the worktree folder, not the project folder.
3. On a chat in the project folder it opens the project folder; on a shell, the folder the shell is in.
4. Right-click a thread in the sidebar: "Open in VS Code" is there too.

### The header's second line stays on one row
**Status:** waiting for Aryan
1. Open a chat in a worktree with a long worktree name, in a window that is not very wide.
2. The project, model, branch and worktree line stays on one row; a long worktree name ends in "…" instead of wrapping into the terminal.

# afterterm: changes waiting for Aryan to check

Every change that reaches Aryan's build is listed here until he has checked it while using the app. He marks each one **Works** or **Doesn't work** (with a note). A **Works** item is deleted from this file; a **Doesn't work** item becomes a bug in [`bugs.md`](bugs.md) and is deleted from here. So the file only ever holds what is still to be checked.

Every agent that ships a change Aryan would notice adds it here in the same change, under the build it arrives in: one short line saying what changed, then how to check it in a few steps. Newest build first.

---

## Build after PR #43 (2026-09-26)

The thread names below were checked in a replica of your data; in your own build use the same threads if you still have them, or any chat that changed documents and code.

### A chat's header has a Files button listing the documents, code and pasted images it changed
**Status:** waiting for Aryan
1. Open "Recently edited files UI design" (afterterm). The header shows "10 files" left of the Asleep chip; do not wake it.
2. Click it: the list grows out of the button with the documents first, newest first, New on the ones it created. Code and Images you pasted are single rows showing only their counts.
3. Click Code, then Images you pasted: each unfolds in place (thumbnails load). Click a document: it opens in VS Code and the list closes. Click an image: it opens full size.
4. Right-click a document: Open in VS Code, Show in File Explorer, Copy path. Esc and a click outside close the list.
5. Open "what things are uncommited?" (dl-bwmi): only code changed, so Code starts unfolded under "No documents in this chat yet".
6. Open "In an old session a claude isntance connected to chrome…" (dl-bwmi): its 6 pasted images show and open although Claude Code's own copies are gone. #8 was pasted twice: it is listed once, with "×2" in the corner of its picture.
7. Open "Source code extraction from APK" (Revy App): 07-old-code-behaviour.md, written by a subagent, is in the list.

### Files a chat changed with shell commands are in the list too
**Status:** waiting for Aryan
1. Open "Create docs/notes.md with heredoc" (Edited files test). Its list shows notes.md (New) and README.md, both changed with `cat` commands, plus the files it wrote later.
2. Wake it and ask it to write a markdown file with a shell command (for example `cat > docs/another.md`). After its reply the file is in the list.
3. Change a file in that folder yourself while the chat is idle: it does not appear.

### File paths in the terminal are clickable, like web links
**Status:** waiting for Aryan
1. Wake "Create docs/notes.md with heredoc" (Edited files test). Its conversation comes back on screen.
2. Hover the paths in the Write(...) and Update(...) lines: each is underlined, and a click opens that file in VS Code.
3. In the last reply, hover `index.tsx`: it is underlined with a note saying it opens `src\b\index.tsx`, the newest of two. `docs/notes.md:1` opens at line 1. The long path broken over two lines is underlined as one.
4. `edited-files-design`, `.md` and `and/or` in that reply stay plain.

---

## Build after PR #42 (2026-09-25)

### The thread hover card: Type and Status on separate rows, one age only
**Status:** waiting for Aryan
1. Hover an asleep thread in the sidebar (for example "Changelog video narrative"). Type says just "Chat" (or "Shell", "Server").
2. A Status row under it shows the moon and "Asleep", with no "1d" after it. The last row says "Last used 2d ago" instead of "Active".
3. Hover a thread that is working, needs you, finished, has background tasks or runs a server: Status shows the same icon as that row in the sidebar (spinner, bell, check, hourglass, green play with "Running on :port").
4. Hover a shell that is awake with nothing going on: there is no Status row, the same as its header having no chip.

---

## Build after PR #40 (2026-09-25)

### Background tasks show a flipping hourglass instead of the working spinner
**Status:** waiting for Aryan
1. In a chat, start a turn that leaves a background task running when it ends, and switch to another thread before the turn ends.
2. When it ends, that chat's row should show a grey hourglass (not the spinner) that turns half a turn, rests for under a second, and turns again.
3. The project row in the sidebar should show an hourglass pill with 1, apart from any spinner pill for threads Claude is still working in. Home's card for the project and the totals under the date should show the same.
4. Open the chat: the hourglass clears. With afterterm behind another window when a turn like that ends, the header chip reads "Background tasks" with the hourglass.

---

## Build after PR #39 (2026-09-25)

### A thread you are looking at no longer keeps "Background tasks" and its spinner after Claude's turn ends
**Status:** waiting for Aryan
1. In a chat you are looking at, start a turn that leaves a background task running when it ends (for example, ask Claude to run a long command in the background, or a session cron).
2. When the turn ends and the prompt is back, the row's spinner and the header's "Background tasks" chip should be gone at once, without switching away and back.
3. Do the same in a chat, then switch to another thread before the turn ends. That chat's row should keep its spinner (and a toast appears) until you open it; opening it clears it.

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

# Changelog

What changed for the person using afterterm, release by release. Each release lists what was added and changed by area, then what was fixed. Every fixed bug, with the PR it landed in, is also in `docs/bugs-fixed.md`. Code-level detail lives in the commit history, `PHASES.md` and `CLAUDE.md`.

## Unreleased, everything since 0.8.1

The sidebar is no longer tab groups. It is projects and threads, with a Home screen, sleep and wake, a rail that shows what needs you, servers that know their port, and shell integration for every shell.

### Home screen

- The app opens on Home: the date, pinned project cards, a list of the other projects by recent activity, and an "Archived" section.
- A project can be pinned (it gets a card at the top) and archived (it leaves the sidebar, its threads keep running, it can be restored). Both are explicit actions with a short toast.
- Opening a project from Home lands on the thread you last worked in, or opens a new one if the project has none.
- A quiet "Last here 2d ago" line under the date, shown only when the gap since the previous launch is over an hour.
- Counters at the top total the threads waiting for you and the threads working across every project.

### Projects

- A project is a folder, a name, a colour, an icon and a default shell, edited in one dialog. Picking the folder fills in the name.
- A project with no threads is still a row; the plus on it opens a terminal in its folder.
- Each project has its own page: folder and shell, Open, New thread, Pin, Edit, Archive, plus Open in File Explorer and Open in your editor (VS Code, Cursor and others are detected; the menu offers each one found, or "Choose editor…").
- The project's icon shows wherever the project is drawn: Home, the sidebar, the rail, the header, the hover card, the chooser, the palette, the project page and toasts.
- The sidebar shows Pinned, Recent (worked in within three days) and, docked at the bottom, Other projects. Collapse buttons sit on the group headings.
- Search in place: a box at the top of the sidebar filters projects and threads as you type. Ctrl+Shift+P still opens the search palette over projects, threads and closed threads.
- Ctrl+Shift+Down and Ctrl+Shift+Up move to the next and previous thread in sidebar order, crossing from one project into the next (Ctrl+Tab still cycles in the order threads were opened).

### Threads

- A thread is a chat (a terminal running Claude Code) or a shell. A chat is named after its conversation (the title Claude gives it, else the first prompt); the header shows its project, model, branch and worktree.
- Every thread restored from a previous launch starts asleep: nothing is spawned until you wake it. An asleep thread shows its last output, dimmed, opened at its newest lines, with a Wake button. Waking a chat resumes its Claude session; waking a shell opens a fresh prompt in the same folder.
- Sleep any thread from its menu. Its last output is kept and shown while it sleeps.
- Closing a thread in a project files it in the project's History tab; a chat can be resumed from there.
- Hovering a thread row shows a card with its type, its status (with the same icon as the sidebar row), project, model, branch, worktree, last command and when it was last used.
- Right-click a thread for Sleep or Wake, Mark as unread, Move to project, Open localhost (for a server), Open project page, Open in File Explorer and Open in VS Code (or your editor; both open the thread's own folder, which for a chat is the worktree it works in) and Close.
- In the header, the project and the worktree items are clickable and open their folders in File Explorer.
- The header has an Open in VS Code button beside the dots menu (your editor's logo if you use Cursor, Windsurf or VS Code Insiders). It opens the folder the thread is actually in: the worktree for a chat that runs in one, the project folder for a chat that runs there, the current folder for a shell. It is greyed out with "Folder not found" when that folder is gone.
- The header's second line stays on one row; a long worktree name is shortened with an ellipsis instead of wrapping into the terminal.
- A chat that switched worktree outside afterterm shows its new branch and worktree at the next launch, before it is even woken, and resumes in that folder.

### Attention

- A thread that needs you (a permission prompt, a question) stays marked until you answer it, not merely until you look at it. A finished turn shows as done until you open the thread.
- Mark a chat as unread to come back to it later; the mark survives a relaunch and clears when you type in the thread.
- The rail on the left is always visible and lists only the projects with something pending: a tile per project with counts for waiting, working and finished, and a mark for compacting. Clicking a tile opens the thread that most needs you.
- Project rows in the sidebar show the same counts as small pills. Nothing is shown at zero.
- A thread whose turn ended with background tasks still running shows a grey hourglass that flips a half turn at a time, not the working spinner, on its row and in the header. Projects and Home's totals count these threads in their own hourglass pill, apart from the spinner pill.

### Servers

- A thread running a dev server shows its port on its row and "Running on :5173" in the header. The port appears within about a second of the server starting.
- "Open localhost:5173" in the thread menu opens it in your browser.
- The thread is named after the command that started the server.
- Closing or sleeping a server thread asks first, since it stops the server. Waking it runs the last command again.

### Files a chat changed

- A chat's header has a Files button with the number of files the chat changed. It opens a list: the documents first (newest first, with a New tag on the ones the chat created), then the code and the images you pasted into the chat, each folded to one row with its count. A click opens a file in VS Code and a pasted image full size; right-click offers Open in VS Code, Show in File Explorer and Copy path. A screenshot pasted more than once shows once, with "×2" on it. An asleep chat keeps its button.
- The list includes files Claude changed with its own tools, files its subagents changed, and files it changed with shell commands (`cat >`, `sed -i`, scripts), found by watching the chat's folder while its commands run. Files you change yourself are left out.
- File paths in the terminal are links, like web addresses: hover underlines a path that exists, a click opens it (at the line, for `file.ts:42`; an image in its viewer). Claude's Write and Update lines, paths inside its commands and paths in its replies all work, and a path broken over two lines links whole. Any file name with an extension links, even written bare: `03-operator-home.png` opens the file the chat wrote, read or sent, else the one in its folder, else the nearest one found under its folder, and the hover says which.

### Long output

- The asleep pane opens at its newest lines.
- One round jump button, at the centre of the terminal or the pane, appears while you scroll away from an end and points the way you are scrolling. A click scrolls there with an animation. It only appears for your own scrolling, never when output arrives, and scrolling over the button still scrolls the content.

### Shells

- Every shell reports its folder and its prompt to afterterm: cmd, PowerShell 7, Windows PowerShell, Git Bash and WSL. A thread reopens in the folder you were in, the header's branch follows a `cd`, and a server's last command is captured in any of them. Custom prompts (oh-my-posh, starship, your own) are preserved.
- A server started in Git Bash is found and stopped correctly when its thread closes or sleeps.
- Opt out per shell in `%APPDATA%\afterterm\prefs.json` under `shellIntegration`.

### Notifications

- Toasts appear on the display that holds the afterterm window, not always the primary one.
- The white strip that sometimes appeared above a toast is gone.
- A toast is a card with the thread's name, the project with its icon and colour, and the message.

### Look

- A 32px title bar with the app name and version; the sidebar and the main pane read as one surface with the pane inset on it.
- The header's project, model and branch line is brighter and easier to read.
- The hover card fits a long unbroken title on two lines.
- Scrollbars stop short of the rounded corners of the terminal card and the asleep pane.
- Screens slide and rise on entry; all animation is off when Windows is set to reduce motion.

### Keyboard

| Shortcut | Action |
|---|---|
| Ctrl+Shift+T | New thread chooser (project and shell) |
| Ctrl+Shift+P | Search palette over projects and threads |
| Ctrl+Shift+W | Close the current thread |
| Ctrl+Tab, Ctrl+Shift+Tab | Next and previous thread |
| Ctrl+Shift+Down, Ctrl+Shift+Up | Next and previous thread in sidebar order, across projects |
| Ctrl+Shift+B | Show or hide the sidebar |
| Ctrl+Shift+F | Find in the current thread's scrollback |
| Ctrl+Shift+A | Select all scrollback |
| Ctrl+scroll | Zoom the font, per thread |

### Fixed

- There was no list of the files a chat had changed, and a file could only be opened when its path happened to be a link; the header's Files button and clickable file paths now cover both.
- The thread hover card showed two ages that looked like they disagreed ("Asleep · 1d" and "Active 2d ago"); it now shows the kind on its own row, a Status row with the same icon the sidebar uses, no sleep age, and "Last used".
- A thread you were looking at kept its spinner and a "Background tasks" chip after Claude's turn ended with background tasks still running, until you switched away and back; it now goes quiet at once, the same as a finished turn. A thread you are not looking at still shows it until you open it.
- The sidebar toggle appeared on the rail only while the sidebar was closed, so after opening the sidebar the same spot held the Home button; the toggle now stays first on the rail in one place, and the sidebar starts with Search.
- The project page's thread menu offered "Open project page" while already on that page; it no longer does.
- A project showed a green play pill both when Claude was working in one of its threads and when a thread was running a server; it now shows a spinner pill for working threads and the play pill only for servers, on the sidebar and on Home.
- The thread menus had an "Open" item that did nothing for the thread already open; it is gone, and the header's dots menu is now its own menu.
- New threads landed at the bottom of a project, behind "Show more"; they now go first, so the newest threads are the ones on show.
- A toast on screen kept a project's old name, colour and icon after the project was edited; it now updates straight away.
- Opening a project from Home, the rail, the search palette or the Other projects drawer left the sidebar where it was; it now scrolls to the project and highlights it for a moment.
- The jump button stayed on screen after scrolling stopped; it now goes away about a second later, unless the pointer is resting on it.
- Pressing Enter in the search palette on a project whose last thread was asleep also woke that thread (for a chat, it resumed the Claude session); it now only opens it.
- The header had no way to open a chat's folder in VS Code; it now has an Open in VS Code button beside the dots, opening the worktree when the chat runs in one.
- The header's second line could wrap into the terminal on a narrower window; it stays on one row now.
- The header kept showing the old worktree after a chat moved to another one.
- A white square showed at the bottom right of the asleep pane.
- The Wake box was hard to read over the saved output; it is a bordered white button now.
- Opening a project from Home landed on its first thread instead of the one you last worked in.
- The jump button appeared when an asleep thread was opened, and scrolling over it stopped at the button.
- A white bar sometimes appeared above a toast when coming back to afterterm.
- Toasts appeared on the primary monitor even when afterterm was on another one.
- The toast shadow was cut off at the edge of its window.
- The hover card heading overflowed the card for a long title with no spaces.
- The asleep pane opened scrolled to the top of the saved output.
- Old output replayed on wake stayed on screen after the terminal came back.
- The header's project, model and branch line was too faint to read.
- A thread's own folder or worktree could not be opened in File Explorer.
- A thread that needed you could be hidden inside a project's five-row fold.

### Removed or changed on purpose

- Tab groups and the Projects shelf are gone; projects and threads replace them (dragging one thread onto another still creates a project, now with its name field open). An existing `session.json` is migrated automatically.
- Nothing resumes at launch any more. Every thread starts asleep and is woken by you, which is what keeps a relaunch with many Claude sessions from starting them all at once.
- A thread's old output is no longer replayed into the fresh terminal on wake; it stays on the asleep pane until you wake.

## 0.8.1

A tab no longer auto-resumes a Claude session that never existed (the hook's session capture is limited to real turns).

## 0.8.0

Project groups: a tab group has a name, a folder, a colour and a default shell, and survives having nothing running in it. The Projects shelf holds groups with no terminals.

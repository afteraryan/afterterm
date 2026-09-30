## 0.9.0 (2026-09-29), everything since 0.8.1

This release changes what afterterm is built around. It used to show you a list of terminals; now it shows you your work: the projects you care about, and the Claude Code chats and shells inside each one. It tells you which of them need you, and anything you are not using sleeps until you ask for it, so a restart no longer starts every old terminal at once.

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
- File paths in the terminal are links, like web addresses: hover underlines a path that exists, a click opens it (at the line, for `file.ts:42`; an image in its viewer). Claude's Write and Update lines, paths inside its commands and paths in its replies all work; a path broken over two lines, or with spaces in it, links whole, and a path written from the top of the worktree links wherever Claude is. Any file name with an extension links, even written bare: `03-operator-home.png` opens the file the chat wrote, read or sent, else the one in its folder, else the nearest one found under its folder, and the hover says which.

### Long output

- The asleep pane opens at its newest lines.
- One round jump button, at the centre of the terminal or the pane, appears while you scroll away from an end and points the way you are scrolling. A click scrolls there with an animation. It only appears for your own scrolling, never when output arrives, and scrolling over the button still scrolls the content.

### Shells

- Every shell reports its folder and its prompt to afterterm: cmd, PowerShell 7, Windows PowerShell, Git Bash and WSL. A thread reopens in the folder you were in, the header's branch follows a `cd`, and a server's last command is captured in any of them. Custom prompts (oh-my-posh, starship, your own) are preserved.
- A server started in Git Bash is found and stopped correctly when its thread closes or sleeps.
- Opt out per shell in `%APPDATA%\afterterm\prefs.json` under `shellIntegration`.

### Notifications

- Toasts appear on the display that holds the afterterm window, not always the primary one.
- A toast is a card with the thread's name, the project with its icon and colour, and the message.

### Look

- A 32px title bar with the app name and version; the sidebar and the main pane read as one surface with the pane inset on it.
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

- Pop-up notifications stayed on screen while you were using afterterm, repeating what the rail already shows; each one now goes on its own 5 seconds after it arrives (resting the pointer on it holds it), and one that arrived while you were in another app waits until you come back. The thread keeps its state on the rail and in the sidebar.
- A chat whose turn had ended kept showing background tasks running after Claude published, read or watched an artifact, until you opened it. Claude Code lists an artifact's live-updates watch as a running background task for the rest of the session; it is no longer counted, so the thread shows done. Real background work (a shell command, a subagent, a monitor) still shows until it ends.
- A thread you were looking at kept its spinner and "Background tasks" after Claude's turn ended with background tasks still running, until you switched away and back; it now goes quiet at once, the same as a finished turn. A thread you are not looking at still shows it until you open it.
- A toast on screen kept a project's old name after the project was edited; it now updates straight away, colour and icon included.
- Toasts appeared on the primary monitor even when afterterm was on another one.

### Removed or changed on purpose

- Tab groups and the Projects shelf are gone; projects and threads replace them (dragging one thread onto another still creates a project, now with its name field open). An existing `session.json` is migrated automatically.
- Nothing resumes at launch any more. Every thread starts asleep and is woken by you, which is what keeps a relaunch with many Claude sessions from starting them all at once.


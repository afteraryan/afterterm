# Changelog

What changed for the person using afterterm, release by release. Each release lists what was added and changed by area, then what was fixed. Every fixed bug, with the PR it landed in, is also in `docs/bugs-fixed.md`. Code-level detail lives in the commit history, `docs/phases-01-projects-and-threads.md` and `CLAUDE.md`.

## Unreleased

### Updating afterterm

- **afterterm updates itself.** An installed afterterm checks GitHub for a new version shortly after it starts and every 6 hours. When one is out, an **Update available** button appears beside the version number at the top left. Nothing opens by itself.
- **The notice.** Clicking the button shows the new version, **What's new** (it folds open inside the notice), **Update**, **Later** (hides it for a day) and **Skip this version**.
- **Downloads while you work.** The button shows the download's progress, then becomes **Restart to update**. The download is checked against the checksum GitHub publishes for the release; one that does not match is deleted and never runs.
- **It asks before it restarts.** "Restart afterterm to update?" lists every awake thread and what happens to it: a chat resumes, a server runs its command again, a shell opens in its folder, and a chat in the middle of a reply, or waiting for your permission, is marked "Stops mid-turn" (afterterm resumes the chat, but you send that last message again).
- **Back where you were.** A small window shows the install's progress, then afterterm opens on the thread that was open, wakes the threads that were awake, and shows "Updated to" with What's new. Only an update restart wakes threads: a normal quit still brings everything back asleep.
- **About afterterm.** Click the version number for the About window: check for updates by hand, read What's new, or turn **Check for updates automatically** off.
- Anyone on 0.10.0 or older installs this version by hand, once; updates are automatic from then on.

## 0.10.0 (2026-10-30)

### Installing afterterm

- **A real installer.** afterterm now comes as one `afterterm-<version>-setup.exe`: pick the folder, choose a desktop and a Start menu shortcut, and it installs for you alone, with no admin prompt. It appears in Settings > Apps with an uninstaller. Your projects and threads stay where they were, so installing over an earlier copy keeps them.
- **It checks Claude Code before it finishes.** If Claude Code is installed, the last step tests that afterterm's helper runs on this PC and that a chat can be saved, and says so. If something blocks it, it names the cause and offers **Report issue**, which opens a GitHub issue filled in with what went wrong (never your files or chats).
- **No Claude Code, no question.** Without Claude Code installed, setup says nothing about it.

### Starting afterterm

- **Nothing starts on its own.** A fresh install opens on Home with no terminal running; closing your last thread returns to Home instead of opening a new one.
- **Create your first project.** With no project yet, Home shows one large button to create it.
- **No more empty Recent heading** in the sidebar. The New project button moves to Pinned when there is no recent project, or becomes its own row when there are no projects at all.
- **The logo** has clean rounded corners at every size.

### Fixed

- A chat did not come back after Sleep and Wake on a PC where Windows blocks scripts by default, which is most home PCs. afterterm's helper for Claude Code now runs there, and installing or starting this version repairs the helper set up by earlier versions.
- A chat opened with `/resume` and left without a message was lost on Sleep.
- afterterm froze for a few seconds after starting, the mouse included, while it looked for your code editor.

## 0.9.0 (2026-09-30)

This release changes what afterterm is built around. It used to show you a list of terminals; now it shows you your work: the projects you care about, and the Claude Code chats and shells inside each one. It tells you which of them need you, and anything you are not using sleeps until you ask for it.

Three words used below: a **thread** is a Claude Code chat or a shell inside a project (0.8.1 called it a tab). A thread is **asleep** when nothing runs in it: afterterm keeps its last output and starts it again when you wake it. The **rail** is the narrow strip at the left edge, with a tile for each project that has something going on.

### The biggest changes

- **Projects and threads.** Pin the projects you are working on; each holds its chats and shells. A chat is named after its conversation and shows its model, branch and worktree.
- **Everything starts asleep.** After a restart every thread shows its last output and runs nothing until you wake it; waking a chat resumes its Claude Code session.
- **See what needs you.** A chat asking for permission stays marked until you answer it, and the rail shows every project with a thread waiting, working or finished.
- **Files a chat changed.** A Files button lists the documents, code and pasted images a chat changed, and file paths in Claude's replies are clickable.
- **Servers by their port.** A thread running a dev server shows its port, opens it in your browser, and starts it again when you wake it.

![Home: pinned projects as cards, the others by recent activity, and the rail at the left with a tile for each project that has a chat waiting](https://raw.githubusercontent.com/afteraryan/afterterm/main/docs/screenshots/release-0.9.0-notes/01-home-with-pinned-projects-and-the-rail.png)

![A project open on an asleep chat: the sidebar with pinned and recent projects, the chat's last output with a Wake button, and its model and branch in the header](https://raw.githubusercontent.com/afteraryan/afterterm/main/docs/screenshots/release-0.9.0-notes/02-a-project-open-on-an-asleep-chat-with-its-last-output.png)

### Upgrading from 0.8.1

- Your tab groups become projects and your tabs become threads. afterterm converts your saved session the first time it starts. Tab groups and the Projects shelf are gone.
- Every thread opens asleep. Threads carried over from 0.8.1 show no saved output the first time, since 0.8.1 kept none; press Wake to resume a chat's Claude Code session or to open a fresh shell in its folder.
- Nothing resumes on its own any more. 0.8.1 resumed the chat that was open when you quit, and each other one the first time you clicked it; now opening a thread only shows it, and it resumes when you wake it.
- Ctrl+Shift+T now opens a chooser for the new thread's project and shell, instead of opening a tab straight away.

### Installing

Download `afterterm-0.9.0-setup.exe` below and run it. It asks for a folder and unpacks `afterterm-win32-x64` there; start `afterterm.exe` from inside it. To replace an older copy, close afterterm first and unpack to the same place. Your projects and settings are kept in `%APPDATA%\afterterm`, so they carry over.

### All changes, by area

#### Projects and Home

- The app opens on Home: your pinned projects as cards, the others by recent activity, and an Archived section.
- Pin a project to keep it at the top; archive one to take it out of the sidebar without deleting it.
- A project has a folder, a name, a colour, an icon and a default shell, all set in one dialog.
- Each project has a page listing its threads (live, asleep and closed), with buttons to open its folder in File Explorer or in your editor (VS Code, Cursor and others are detected).
- The sidebar shows your pinned projects, then the ones used in the last three days, with the rest folded into Other projects at the bottom. A search box at its top filters it as you type.
- Ctrl+Shift+P searches every project, thread and closed thread.

#### Threads

- A chat's header shows its project, model, branch and worktree.
- Sleep any thread from its menu; its last output stays on screen until you wake it.
- Closing a thread files it in its project's history, where a chat can be resumed.
- Hovering a thread shows its status, model, branch, last command and when it was last used.
- A thread's menu and its header open the thread's own folder in File Explorer or your editor; for a chat working in a worktree, that is the worktree.
- A chat that moved to another worktree outside afterterm shows the new branch and resumes there.

#### What needs you

- A chat asking for permission or asking a question stays marked until you answer it, not just until you look at it. A finished turn shows as done until you open the chat.
- Mark a chat as unread to come back to it later.
- The rail shows a tile for every project with a thread waiting, working, finished or compacting, with counts beside it. Clicking a tile opens the thread that most needs you.
- A chat whose turn ended with background tasks still running shows an hourglass instead of the working spinner.

#### Files a chat changed

- A chat's Files button lists the documents it changed first, then its code and the images you pasted into it, including files changed by its subagents and by its shell commands.
- File paths in the terminal are links: a click opens the file, at the line for `file.ts:42`. Bare file names, paths with spaces and paths broken over two lines work too.

#### Servers

- A thread running a dev server shows its port, and Open localhost opens it in your browser.
- Closing or sleeping a server thread asks first; waking it runs the server's command again.

#### Shells

- Command Prompt, PowerShell 7, Windows PowerShell, Git Bash and WSL all tell afterterm which folder they are in, so a thread reopens where you left it and its branch follows `cd`. Custom prompts are kept. To turn this off for a shell, use `shellIntegration` in `%APPDATA%\afterterm\prefs.json`.

#### Pop-up notifications

- A pop-up shows the thread's name and its project, in the project's colour and icon.

#### Long output

- A round button appears while you scroll through long output, to jump to the top or the bottom.

#### Look

- A new look throughout. Its animations turn off when Windows is set to reduce motion.

### New and changed keyboard shortcuts

| Shortcut | What it does |
|---|---|
| Ctrl+Shift+T | Changed: opens the chooser for a new thread's project and shell |
| Ctrl+Shift+P | New: searches projects, threads and closed threads |
| Ctrl+Shift+Down, Ctrl+Shift+Up | New: the next and previous thread in sidebar order, across projects |

### Bugs from 0.8.1 that are fixed

- Pop-up notifications stayed until you closed them. While you are using afterterm they now go after 5 seconds (resting the pointer on one keeps it), and one that arrives while you are in another app waits until you come back.
- A chat that published or watched an artifact kept showing background tasks after its turn ended. It now shows done.
- The chat you were looking at kept showing background tasks after Claude's turn ended. It now clears at once.
- A pop-up kept a project's old name after you renamed the project. It now updates.
- Pop-ups appeared on the main monitor when afterterm was on another one. They now appear on afterterm's monitor.

### Known problems in this release

- A white bar sometimes appears above the pop-ups, most often when several are stacked.
- After a restart, threads lose their waiting and finished marks; only Mark as unread survives.
- Clicking a file link opens it in VS Code, even when it is a video or a web page.
- Opening a chat moves its project to the top of the recent projects, even if you typed nothing.
- After the laptop sleeps, the afterterm window can move to the main monitor and stay there.

Full list of changes: https://github.com/afteraryan/afterterm/compare/v0.8.1...v0.9.0

## 0.8.1

A tab no longer auto-resumes a Claude session that never existed (the hook's session capture is limited to real turns).

## 0.8.0

Project groups: a tab group has a name, a folder, a colour and a default shell, and survives having nothing running in it. The Projects shelf holds groups with no terminals.

# Design 02: Projects and threads

The sidebar today shows terminals. This design makes it show **projects** and the **threads** of work inside them, adds a **Home** screen that answers "what am I working on right now", and gives every thread a name, a state and a place to go when you are done with it.

Status: design agreed on 2026-09-06 against an interactive mock. Not built. Execution is planned in [`../PHASES.md`](../PHASES.md).

Mock: [`mockups/afterterm-next.html`](mockups/afterterm-next.html) (open in a browser, everything is clickable). Icon sheets: [`mockups/project-page-icons.html`](mockups/project-page-icons.html), [`mockups/state-icons.html`](mockups/state-icons.html).

## The problem this solves

Three complaints, one cause.

1. A tab running a server looks like every other tab.
2. Dead tabs pile up across restarts. Every relaunch restores every tab from every previous session, and nothing ever ages out.
3. A restored tab is a mystery box. Nothing says what was happening in it until you open it.

The cause: the sidebar models only one thing, **which shells are running**. It does not model **what exists** (every project) or **what you intend to work on** (three to five of them). Intent has no representation, so the sidebar shows process state and you read it as a to-do list. Because "running" is the only signal of "mine", you never close anything, and the list becomes a graveyard.

The fix splits that one axis into two independent ones: a project is **pinned** or not (your intent, set by you), and a thread is **awake** or **asleep** (process state). Today's UI can only express "pinned and awake" and "unpinned and asleep". The two cells you actually need, a pinned project with nothing running and a running project you have mentally dropped, become expressible.

## Concepts

**Project.** What today's group is: a name, a folder, a colour, a default shell. Plus two new flags: `pinned` and `archived`. A project exists whether or not anything is running in it. Created and edited through the existing project dialog (folder, name auto-filled from the folder's last segment, colour, default shell).

**Thread.** What today's tab is, seen as a unit of work rather than a process. A thread lives in a project (or in **General** if it has none), has a name, a kind, a state, and is backed by one terminal.

- **Kind.** `chat` if the thread ran Claude (a session id was captured), otherwise `shell`. A server is a shell that happens to own a listening port. Kind decides the row icon: speech bubble for chat, terminal prompt for everything else.
- **Name.** Unchanged from today. For a chat: the conversation summary Claude Code sets as the terminal title, and updates on `/rename`. The state glyph the hook prepends moves out of the text and into the row's icon. A chat has no title only until Claude's first reply (the title is a summary of the conversation), and in that gap afterterm falls back to the first prompt from the session's JSONL. For a shell: the folder name (today's title intelligence).
- **Rename.** Only through Claude Code's `/rename`. afterterm has no rename of its own: it cannot set Claude's title cleanly (no hook or API), and two competing names would drift.
- **Model.** For a chat: the model of the latest assistant message in the session's JSONL, shown as a display name with its context size when the id carries one: `claude-opus-5` is "Opus 5", `claude-opus-5[1m]` is "Opus 5 · 1M". Re-read each turn so a `/model` switch shows up.
- **State.** See "States" below.
- **Asleep.** The thread's process is not running. Its record (project, cwd, session id, shell, and a tail of its output) is kept. Waking respawns it: `claude --resume` for a chat, the last command re-run for a server, a fresh prompt in the folder for a shell.
- **History.** Closing a thread moves its record to the project's history instead of deleting it. Chats in history can be resumed. A thread in General that is closed is simply closed.

**Pinned.** Explicit and only explicit. Nothing pins a project on its own: not opening it, not waking a thread in it, not activity. Unpinning is the one thing that keeps the sidebar honest.

**General.** The section for threads with no project. Shown only when at least one exists.

## States

| State | What is happening | Applies to | Icon |
|---|---|---|---|
| Needs you | Claude stopped on a permission prompt or a question | chat | bell, amber |
| Working | Claude is mid-turn | chat | spinner |
| Running | A process is up and listening on a port | shell (server) | play, green |
| Done | Claude finished a turn and nobody has looked yet | chat | check, green, transient |
| Quiet | At the prompt, nothing happening (chat or shell) | any | none |
| Asleep | No process at all | any | moon |

Working ends on its own; Running does not. Done clears the moment the thread is viewed, exactly like today's ✅ notification. Quiet threads show no icon and no header chip.

Icon style: solid glyphs at the same visual weight as the folders (sheet A in `mockups/state-icons.html`). One icon set drives the header chip, the right end of every thread row, the project page lists and the project counters.

## Screens

### Home

A full screen, no sidebar. Top-left: "afterterm" with two icons beside it, Home and Workspace. Nothing else in the title strip.

- **Date** as the heading. What sits under it is still open (see Open decisions).
- **Pinned**: cards. A card is the project's folder icon, its name, and a footer with counter pills and the time since last activity. No subheading, no typed notes, no derived text.
- **Projects**: compact rows for unpinned projects, sorted by last activity, "Show more" after four. A + at the right of the section label creates a project (tooltip "New project").
- **Archived**: one link that expands to rows with Restore.

Counter pills: one pill per state worth counting, each with its icon and a number: bell 1, play 2. Nothing at zero.

Clicking a card or row opens the workspace on that project. The project page opens only deliberately: the folder-with-chevron icon on hover at the right edge, or right-click. Pin is an icon on every card and row (filled when pinned). Right-click on a card or row: Open, Pin or Unpin, Open project page, Open in File Explorer, Open in VS Code, Edit project, Archive.

### Workspace

Two columns of equal top-row height (56px).

**Sidebar**, in order: brand row (afterterm, Home, Workspace, collapse toggle), Search (Ctrl K), New thread (Ctrl Shift T), then General (if any), Pinned, Projects.

- A project row is its folder icon (open when expanded, closed when collapsed), name, thread count when collapsed, and on hover: + (new thread here) and the project page icon. Unpinned rows also carry the pin icon and the counter pills.
- Clicking anywhere on a project row, including blank space, only expands or collapses it. Nothing on that row opens the project page except the dedicated icon.
- Thread rows: kind icon, name, port for a running server, state icon at the right end. Asleep rows at 45% opacity. Five per project, then "Show N more". The list auto-expands if the open thread is beyond the fold.
- Right-click on a thread (same menu as the header ⋯): Open, Sleep or Wake, Move to project (submenu: General plus every project, with a back chevron on the header row), Open localhost:port (servers), Open project page, Close.
- Collapsed sidebar: a 56px strip with the toggle, Home, Workspace, Search and New thread.
- Expand and collapse animate.

**Main pane**: header then terminal.

- Header line 1: kind icon, thread name.
- Header line 2, metadata only, each with its icon: project (coloured folder), model for chat threads (sparkle), branch (git branch glyph), worktree folder when the thread is in one (folder-with-fork). Example: `afterterm · Opus 5 · 1M · feat/threads · .worktrees\feat-threads`.
- Right side: the state chip (icon plus word: "Needs you", "Working", "Running on :5173", "Asleep · 2d"), hidden when quiet, then ⋯.
- Asleep thread: the old output dimmed, a large Wake button at the top of the pane. Waking appends a "Woke just now" divider and continues below it.

### Project page

Reached only through the project page icon or the right-click menu. Brand row on top. Then: folder icon and name, a line with folder path, branch and default shell, buttons Open, New thread, Pin or Unpin, Edit, Archive, and at the right of that row two logo buttons: **Open in File Explorer** and **Open in VS Code** (real product logos, tooltip on hover). Then three tabs, Live, Asleep, History, with a search box. History rows have Resume. No text box.

The same two actions sit in every project right-click menu (Home cards and rows, sidebar rows), with their logos.

**Open in File Explorer** runs `explorer.exe <folder>`. **Open in VS Code** runs `code <folder>` (or the `Code.exe` path found at startup). afterterm detects VS Code the way it detects shells: `code` on PATH, then the standard install folders (`%LOCALAPPDATA%\Programs\Microsoft VS Code`, `%ProgramFiles%\Microsoft VS Code`), plus Insiders. When nothing is found the VS Code button and menu item are **hidden**, not greyed out; File Explorer is always there. A manual path in `prefs.json` (`editorPath`) overrides detection, which also covers forks like Cursor or Windsurf for people who use those.

### New thread chooser

New thread and Ctrl Shift T open a popover: "New thread in", a filter box, the current project preselected, then No project, then every other project (pinned first). Enter takes the highlighted one. A shell dropdown at the bottom, defaulting to the chosen project's shell, listing Command Prompt, PowerShell 7, Windows PowerShell, Git Bash, WSL. The + on a project row skips the chooser.

### Search (Ctrl K)

One palette across projects, threads and history. Projects open the workspace, threads select, history opens the project page on its History tab.

## Visual system

Neutral greys only: page `#212121`, sidebar `#171717`, hover `#2f2f2f`, raised or selected `#383838`, text `#ececec` / `#b4b4b4` / `#8e8e8e`. No borders on surfaces; layers separate by tone. One white primary button. Inter, 14px, weights 400 and 500. Mono only inside the terminal pane. 16px radius on surfaces, 8 to 12 on rows, full round on chips and pills.

Project colours are solid, saturated folder fills: teal `#2dd4bf`, blue `#60a5fa`, purple `#a78bfa`, orange `#fb923c`, red `#f87171`, green `#4ade80`, pink `#f472b6`, yellow `#facc15`. State colours are separate: amber `#fbbf24` for needs you, green `#4ade80` for running and done. Nothing glows or pulses; the only motion is short eased entrances (140 to 200ms) on menus, popovers, dialogs and view switches, the sidebar width, and expand/collapse. All off under reduced motion.

Every dropdown and submenu marker is a real 16px chevron icon. Tooltips are the app's own dark pill, not the browser's.

## Data model

`Group` gains `pinned: boolean`, `archived: boolean`, `lastActiveAt: number`. `Tab` gains `lastActiveAt: number`, `asleep: boolean`, `branch?`, `worktree?`, `port?`, `model?`, and a per-thread scrollback tail file. A new `history` list per project holds closed threads: title, kind, session id, cwd, closed time. `session.json` stays backward compatible: missing flags default to unpinned, not archived, awake.

The sidebar is built by walking **projects**, not tabs. This inversion is the real structural change; today an empty group renders nothing because the list is built from `tabs`.

## What is cosmetic and what needs the main process

**Cosmetic, or frontend on data that already exists**

- The whole visual system, folder icons, state icons, pills, chips, tooltips, animations.
- Sidebar structure, collapse rail, 5-thread fold, kind icons (chat = captured session id).
- Header with title and state chip; ⋯ and right-click menus; Move to project (today's group move); Close.
- Pin and archive flags; Home screen; project page Live and Asleep tabs; new thread chooser; Edit project dialog (exists); search palette over projects and threads.
- Open in File Explorer and Open in VS Code: a small main-process launcher plus VS Code detection at startup, alongside shell detection.

**Needs the main process**

- Model, and the no-title fallback: read the latest assistant message's model, and the first user prompt when there is no title yet, from `~/.claude/projects/<hash>/<sessionId>.jsonl`. The session id is already captured per tab. The name itself stays the terminal title Claude Code sets.
- Branch and worktree: read `.git/HEAD` in the thread's cwd; a worktree's `.git` is a file pointing at the main repo.
- Last-active timestamps: stamp on PTY input and output.
- Sleep and wake: kill the PTY but keep the tab record; wake respawns in cwd and resumes the chat. Waking a server needs the last command, which needs shell integration.
- Scrollback tail: write the last N lines per thread on sleep and close, replay on wake with a divider.
- History: record on close.
- Running state and port: walk the PTY's process tree and match listening sockets, polled.
- Last command: OSC 133 prompt marks. Reachable for cmd through the existing `PROMPT` injection; PowerShell, Git Bash and WSL each need their own hook. This is also the path to cwd capture for those shells, which today fall back to the home folder.

## Open decisions

- **Under the date on Home.** Candidates: the counter pills totalled across projects (preferred), "last here 2h ago", the projects touched in the previous session, uncommitted-change count, nothing.
- **Threads in General that are closed** are gone, not in history, because there is no page to list them on. Revisit if it hurts.
- **Worktree grouping on the project page** (threads listed under the worktree they run in). Fits the model, not required.
- **Naming.** The code still says Group and Tab. Whether to rename to Project and Thread in code, or only in the UI, is a Phase 0 call.

## Rejected along the way

- Tracking chats instead of terminals as the unit. A chat names a thread well but not every thread is a chat, and afterterm should never become a viewer of every chat in `~/.claude`.
- Auto-pinning on activity, and pin decay. Both put process state back in charge of intent.
- A typed status note per project. It looked like a chat box and produced text nobody trusted.
- Renaming threads in afterterm. `/rename` in Claude Code is the only rename; a second name would fight it.
- A derived subheading on cards (last chat, last command). Noise.
- "Sleep all" and a Sleep button in the header. Sleep lives in the menu; the header's right side is for state.
- Arrow, document and info-circle icons for the project page. The arrow means "leave", the document means "file". Folder-with-chevron means "go into this project".

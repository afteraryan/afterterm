# afterterm

A simple terminal emulator for Windows with **Chrome-style tab groups**. No existing terminal has this feature.

## Stack

- **Electron** (desktop runtime)
- **@xterm/xterm v6** + **@xterm/addon-webgl** (terminal renderer)
- **@xterm/addon-web-links** + **@xterm/addon-search** (clickable links, find-in-scrollback) — pinned to stable 0.12.x / 0.16.x; **don't** bump to the v6 betas (peer `^6.1.0-beta` → ERESOLVE). See `docs/features-terminal-interactions.md`.
- **node-pty** (PTY / shell spawning via ConPTY)
- **React 19** (UI)
- **@dnd-kit/core** (drag-and-drop for tab grouping)

## The Feature

Named, color-coded, collapsible tab groups — exactly like Chrome's tab groups, but for terminal tabs. Drag a tab onto another to create a group. Click the group label to collapse. Drag the group label to reorder.

## Architecture

- node-pty lives in the **Electron main process** (holds ConPTY handles, spawns shells)
- xterm.js lives in the **renderer process** (display + keyboard input)
- Communication via Electron IPC with **16ms chunk batching** (prevents lag under burst output)
- Hidden tabs use `display: none` to avoid rendering overhead
- Shell profiles detected at startup (cmd.exe, pwsh.exe, powershell.exe, Git Bash, WSL)
- Session state auto-saved to `%APPDATA%\afterterm\session.json` (2s debounce after changes)
- A second always-on-top **notifier overlay window** renders toasts above all apps (see Notification System)
- `AFTERTERM=1` is set on every spawned PTY's env so the Claude Code hook knows to route notifications to the in-app overlay instead of a Windows popup

## File Structure

```
src/
  main.ts                              ← Electron main: PTY IPC, shell detection, session persistence, keyboard shortcuts, notifier window + notify IPC, shell:openExternal (link safelist, logs `[harness] shell:openExternal <url>` instead of opening a browser under the harness), Claude-hook self-install on startup, PTY activity stamping, last-opened time, editor detection and launch, thread tail files (save, saveSync, read, delete, prune), the server watcher (pollServers, pty:port push, the later-started port wins when a tree listens on more than one, PROC_LIST_COMMAND, the MSYS `ps -l` bridge for Git Bash via msysPsPath/applyMsysParents), `pty:create` calling `planSpawn` for every shell's OSC 9;9/7 cwd report and OSC 133 prompt marks (Phase 6), `killTree` (bridges the same MSYS gap before the tree kill so a Git Bash server does not outlive its shell)
  claude-hook-install.ts               ← reconcileClaudeHook(): self-installs the bundled notifier hook into ~/.claude (idempotent, additive, prefs.json opt-out). Pure Node, unit-tested.
  editors.ts                           ← Editor product detection and info (product name from exe, list of installs)
  editor-detect.ts                     ← Pure search logic: finds the user's primary and alternate editors by prefs, code command, install folders and registry. Unit-tested. Test file: editor-detect.test.ts
  claude-transcript.ts                 ← Reads a Claude session transcript (~/.claude/projects/<hash>/<sessionId>.jsonl): first prompt, latest model, modelDisplayName. Pure, unit-tested. Test file: claude-transcript.test.ts
  git-info.ts                          ← Branch and worktree from .git/HEAD and a worktree's .git file, no git process spawned. Pure, unit-tested. Test file: git-info.test.ts
  thread-tail.ts                       ← The scrollback tail a sleeping or closed thread leaves behind: TAIL_MAX_LINES, TAIL_MAX_BYTES, isThreadId (path-traversal guard), tailFilePath, trimTail, serializeTail, parseTail, renderTailForTerminal (the dimmed replay + "Woke just now" divider). Pure, shared by main (file I/O) and the renderer (formatting the replay); no Buffer use outside main, since the sandboxed renderer has no Node globals. Unit-tested. Test file: thread-tail.test.ts
  server-detect.ts                     ← Pure: which thread is listening on a port. parseNetstatListeners, parseProcessList, descendantPids (the pid-reuse creation-time guard), portForTree (the port that started latest wins when a tree listens on more than one, ties fall back to the lowest port), listenerKey (change fingerprint), tabPorts, parseMsysPs (MSYS's own `ps -l`, PID/PPID/WINPID) and applyMsysParents (re-points an MSYS process at its MSYS parent's WINPID, bridging the gap an MSYS fork-and-exec leaves in the Windows parent chain). No Electron, no child_process. Unit-tested. Test file: server-detect.test.ts
  shell-integration.ts                 ← Phase 6: planSpawn, the pure spawn planner for every shell (command, args, cwd, env), and integrationEnabled (the per-shell prefs.json opt-out); holds the exact injected texts (PWSH_BOOTSTRAP, pwshEncodedCommand, BASH_HOOK, BASH_BOOTSTRAP, appendWslEnv). No Electron, no child_process (only the caller-supplied dirExists does I/O). Unit-tested, including real pwsh/Windows PowerShell/Git Bash subprocess checks. Test file: shell-integration.test.ts
  shell-paths.ts                       ← Path translation between Windows, WSL and Git Bash (MSYS) forms: parseOsc7, linuxPathToWindows, osc7ToWindowsPath (what the renderer's OSC 7 handler calls), isWslUncPath, wslUncToLinux (what planSpawn calls to turn a saved `\\wsl$\...` cwd into `wsl.exe --cd`'s linux path), windowsPathToWsl, isWindowsDrivePath. Pure, no Node built-ins: shared by main and the sandboxed renderer. Unit-tested. Test file: shell-paths.test.ts
  preload.ts                           ← contextBridge: PTY API (incl. pty.onPort), session API, shell list, shortcuts, notify/notifier APIs, shell.openExternal, files.pathForFile (drag-drop), projects (folder picker and explorer launch), editors (list, open, choose), app.lastOpenedAt, pty.onActivity, claudeSession (meta, onUpdate, onMeta), git (info, infoMany), threads (saveTail, saveTailsSync, readTail, deleteTail, prune), pty.offExit
  prefs.ts                             ← readPrefs and updatePrefs: manages %APPDATA%/afterterm/prefs.json (claudeNotifications, claudeHookToastShown, lastOpenedAt, editorPath, shellIntegration)
  afterterm.d.ts                       ← Window.afterterm type declarations (incl. projects, editors, app.lastOpenedAt, pty.onActivity, pty.onPort, notify/notifier, shell, files, claudeSession, git, threads APIs, pty.offExit)
  renderer/
    index.tsx                          ← React root; routes to NotifierApp when ?notifier=1, else App
    app.tsx                            ← Screen state (Home, workspace, project page), session restore, shortcut dispatch, notification fan-out, one ProjectActions object for all project menus, new thread chooser, search palette, in-app toast, transcript meta and branch/worktree refresh (on capture, cwd change, restore, and a 30s poll), wakeThread/resumeThread, handleTail (keeps and writes a sleeping or history-bound thread's tail, deletes a closed General thread's), the beforeunload flush (saveTailsSync then sleepAllForShutdown), the AsleepPane mount, the clock effect (now for the asleep chip and pane), the `pty.onPort` listener (drops a null port for a thread that is already asleep, so sleeping never clears the port that marks it a server), closeThread/closeThreadNow (closeThread asks first when needsCloseConfirm, closeThreadNow does the real close; the ConfirmDialog mount reads closeConfirmText), sleepThread/sleepThreadNow (the same asks-first pattern for Sleep, guarded by needsSleepConfirm and reading sleepConfirmText), openLocalhost (routes a captured port through shell.openExternal and records the URL on window.__afterterm.lastOpenExternal for the harness), the window.__afterterm.tab(id) harness hook
    index.css                          ← App layout (title bar strip, then sidebar and main pane), screen-entry animations, terminal card, find bar
    theme.css                          ← Palette tokens, bundled Inter, shared classes, keyframes, reduced motion, Home and project-page entrance animations
    sessionMigration.ts                ← session.json shape: migrateSession (fills the project/thread fields on a 0.8.1 file, incl. model, branch, worktree, claudeTitle, sleptAt, Group.history, port, lastCommand) + serializeSession (the one save shape). port is validated as an integer 1 to 65535, anything else dropped. Pure, unit-tested.
    sidebarWalk.ts                     ← computeSegments: sidebar rows built from groups first, so a group with zero tabs renders. Pure, unit-tested.
    threadView.ts                      ← Pure: thread kind, state, display title, thread name (claudeTitle, Claude summary, first prompt, live title, in that order for a chat; a shell with a captured port and lastCommand is named by the command instead), model label, five-row fold, counter pills, sidebar sections, initialScreen (always Home). Phase 5: kindWord (Chat/Server/Shell), runningLabel, localhostUrl, openLocalhostLabel, needsCloseConfirm, closeConfirmText, needsSleepConfirm, sleepConfirmText; threadState now returns 'running' for a captured port once no notification wins. Unit-tested.
    commandMarks.ts                    ← Pure: OSC 133 prompt marks (A/B/C/D) turned into "the last command entered at a prompt". parseOsc133, initialCommandMarkState, onMark (the state machine), onEnter (reads the buffer between the B mark and the cursor via a caller-supplied readFrom, cleans it with cleanCommand). No xterm, no DOM: importable from plain Node. Unit-tested. Test file: commandMarks.test.ts
    homeView.ts                        ← Pure: Home screen rendering logic (date heading, pills, pinned cards, projects sorted by activity, archived list, lastHereLine for the last-opened experiment). Unit-tested. Test file: homeView.test.ts
    chatTitle.ts                       ← Claude Code's and the notify hook's title glyphs: claudeSummaryTitle, isHookTitle. Pure, unit-tested. Test file: chatTitle.test.ts
    chooserView.ts                     ← Pure: new-thread chooser project and shell options, sorting and filtering. Unit-tested. Test file: chooserView.test.ts
    paletteView.ts                     ← Pure: search palette projects and threads, and now history entries by title with their own rank and cap. Unit-tested. Test file: paletteView.test.ts
    sleepWake.ts                       ← Pure: sleepTab, wakeTab, restoredTab (every restored thread starts asleep), sleepAllForShutdown, asleepLabel (chip), asleepSinceText (pane sentence, now taking a kindWord and an optional lastCommand so a server reads "· runs npm start"), wakePlan (cwd, shellId, resumeSessionId, and Phase 5's runCommand: a validated, non-empty, control-character-free lastCommand for a thread with a captured port; set only when resumeSessionId is null, since a server thread never resumes a chat). No PTY or DOM access: the terminal and main-process layers act on what these return. Unit-tested. Test file: sleepWake.test.ts
    history.ts                         ← Pure: historyEntryFor, appendHistory (newest first, deduped, HISTORY_MAX 100), removeHistoryEntry, isResumable, tabFromHistory (Resume recreates the tab under the closed thread's own id so its tail file is found again), maxNumericId (id counter over live tabs AND history ids), historyTitleMatches. Unit-tested. Test file: history.test.ts
    threadMenu.tsx                     ← The one thread menu for the sidebar right-click and the header dots button: Open, Sleep or Wake, Move to project, Open localhost:port (an awake server only), Open project page, Close
    projectMenu.tsx                    ← buildProjectMenu: Open, New thread here, Pin/Unpin, Open project page, Open in File Explorer, Open in <editor> per detected editor, Edit, Archive/Restore, Delete
    NotifierApp.tsx                    ← The floating overlay window's React root: toast cards, hide-when-empty logic
    NotifierApp.css                    ← Toast card styles (state icon in a tinted circle, thread name headline, project line with coloured folder)
    hooks/
      useTabState.ts                   ← All tab/group state, session restore, group contiguity enforcement, pin, archive, activity, openProject, setClaudeMeta and setGitInfo (transcript and branch/worktree writes), threadGitCwd, sleepTab, wakeTab, closeTab (files a project thread into its group's history, deletes nothing itself), resumeFromHistory (recreates a tab from a history entry), restoreSession (every restored tab goes through sleepWake's restoredTab, so it starts asleep), setPort (main's pty:port push; null deletes the key rather than storing undefined, no-op when unchanged), setLastCommand (an OSC 133-captured command line, no-op when unchanged)
    components/
      ScreenNav.tsx                    ← The screen navigation type and initial-screen logic. Styles in ScreenNav.css
      ScreenNav.css                    ← Screen types and entry-class styles
      Toast.tsx                        ← In-app toast pill (pin, archive, restore, editor errors). Styles in Toast.css
      Toast.css                        ← Toast styles (centre bottom, auto-hide)
      ThreadHoverCard.tsx               ← The sidebar thread hover card: Type (now "Chat · Asleep · 2d" for a sleeping thread via asleepLabel, or "Server · Running on :5173" via runningLabel), project, model, branch, worktree, a Last ran row for a captured lastCommand, active time, shown 350ms after hovering a row
      ThreadHoverCard.css               ← Hover card styles
      SidePanel/
        index.tsx                      ← Icon row (Home, Workspace, collapse toggle), Search and New thread rows, General, Pinned and Projects sections, project and thread rows with the close x, a running server's `:5173` port pill (`.prt`, between the name and the state icon) and Open localhost in the right-click menu, five-row fold, rail when collapsed, DnD, right-click menus, Home and Search wired, pin and project page buttons, shared project menu, thread hover card on a 350ms hover delay
        SidePanel.css                  ← Sidebar styles on the theme tokens, breath keyframes for needs-you and done rows, expand and collapse animation
      Header/
        index.tsx                      ← Main pane header: kind icon, name, project/model/branch/worktree line, state chip (the "Asleep · 2d" chip via asleepLabel, or "Running on :5173" via runningLabel for a server), dots menu (Sleep or Wake, Open localhost:port)
        Header.css                     ← Header styles
      AsleepPane/
        index.tsx                      ← The pane shown in place of the terminal card while the active thread is asleep: a large autofocused Wake button, the "Chat/Server/Shell asleep since 2d ago[ · runs npm start]" line (asleepSinceText, via kindWord and tab.lastCommand), the saved tail (dimmed, pre-formatted) below it. Pure data-in: the tail is a prop, not read here.
        AsleepPane.css                 ← Pane styles: fills the same area as the terminal card (same margin, background, radius) so swapping one for the other never shifts the header or the sidebar
      TitleBar/
        index.tsx                      ← The 32px title bar strip: name and version on the left, the OS caption buttons on the right, the window's drag region
        TitleBar.css                     ← Strip styles (sidebar grey)
      Home/
        index.tsx                      ← Home screen render, date heading, totals, last-here line, pinned cards, projects list, archived section, Show more toggle
        Home.css                       ← Home layout and typography
      ProjectPage/
        index.tsx                      ← Project page header, folder and shell line, action buttons (Open, New thread, Pin, Edit, Archive or Restore), Explorer and editor buttons, tabs (Live, Asleep, History with a Resume button per resumable row), search box, thread list (with kind/branch/worktree/port detail line, a running server's `:5173` appended via a `[data-meta="port"]` span) or empty state
        ProjectPage.css                ← Project page layout
      NewThreadChooser/
        index.tsx                      ← Overlay modal: current project first, then No project, then others by pin and activity; shell dropdown
        NewThreadChooser.css           ← Chooser modal styles (optional if styles are in components)
      SearchPalette/
        index.tsx                      ← Palette modal: projects, threads and now history rows (closed threads) by prefix match, Ctrl+Shift+P to open; a history row opens the project page on its History tab
        SearchPalette.css              ← Palette modal styles (optional if styles are in components)
      ConfirmDialog/
        index.tsx                      ← A generic yes/no confirm dialog (title, body, confirm/cancel labels, danger styling, Enter/Escape while focus is inside). Phase 5's only caller is the close confirm for a thread with a listening port (threadView's needsCloseConfirm/closeConfirmText), but the component itself knows nothing about servers. Markup mirrors GroupModal's modal-overlay/modal-card so the harness's `screen` command finds it too.
        ConfirmDialog.css               ← Confirm card styles on top of the shared modal-overlay/modal-card look; the danger button variant
      GroupModal/
        index.tsx                      ← New/Edit project dialog: name, folder picker, colour, shell, "open a terminal now"
        GroupModal.css                 ← Modal overlay + form styles
      Terminal/
        index.tsx                      ← xterm.js lifecycle, PTY wiring, title intelligence, OSC 9;9 and OSC 7 cwd capture (Phase 6: OSC 9;9 for cmd/pwsh/Windows PowerShell/Git Bash, OSC 7 for WSL via osc7ToWindowsPath), clipboard, links, find bar, font zoom, drag-drop, refit and focus when workspace comes back, teardownTerminal (captures the tail, unhooks data/exit, kills the PTY, disposes the xterm; the same routine for sleep and close), createTerminal's wake replay (renderTailForTerminal above a "Woke just now" divider before the shell spawns) and its re-run of a woken server's last command (SHELL_READY_MS after the resume/re-run wait, only when wakePlan.runCommand is set), the OSC 133 handler (registerOscHandler(133), feeds commandMarks.onMark, now fed by every shell's integration hook, not just cmd), the Enter capture in term.onData (reads the buffer with readCommandText between the B mark and the cursor before writing the keystroke through, via commandMarks.onEnter), window.__afterterm.commandState(id) (the harness hook for the OSC 133 state machine), pendingDestroyRef and creatingRef (guard a wake racing its own sleep's teardown), window.__afterterm.tail/activeTail (harness hook)
      Icons.tsx                        ← SVG icon set from the mock plus FolderIcon, StateIcon, KindIcon, Spinner
      Menu.tsx                         ← Positioned menu with submenu and back chevron
      Menu.css                         ← Menu styles
      Tooltip.tsx                      ← The app tooltip; any element with data-tip
      TabBar/
        types.ts                       ← Tab (incl. fontSize, model, branch, worktree, claudeTitle, firstPrompt, asleep, sleptAt, wokeAt (transient), port, lastCommand), Group (incl. history: HistoryEntry[]), HistoryEntry (id, title, kind, sessionId, cwd, closedAt), GroupColor, TabNotification types (shared)
assets/
  fonts/
    Inter Regular and Medium woff2     ← Bundled in assets/fonts, loaded by theme.css; LICENSE-Inter.txt
  hooks/
    afterterm-notify.ps1               ← bundled, distributable Claude Code hook (no-op unless AFTERTERM=1); copied into ~/.claude/hooks on first run
    test-afterterm-notify.ps1          ← standalone test harness for the hook (22 cases)
forge.config.ts                        ← ASAR unpack, rebuild skip, Vite plugin config (extraResource: ['assets'] bundles the hook)
scripts/
  agent-harness/
    README.md                          ← how an agent launches, drives, screenshots and stops the dev build (safety rules included)
    launch.mjs                         ← seeds a throwaway AFTERTERM_USER_DATA_DIR, starts the dev build on a chosen display with CDP on, records pids; --prefs seeds prefs.json; --env KEY=VALUE (repeatable) sets an extra environment variable for the dev build, e.g. a scratch USERPROFILE/HOME for a custom-prompt test (Phase 6)
    drive.mjs                          ← CDP client: targets, bounds, screenshot, eval, dom, click, rightclick, hover (with --wait), unhover, drag, emulate-media, type, key, sidebar, screen, home, project, chooser, palette, header, hover-card, pane (the asleep pane's Wake button and "asleep since" text, or the terminal's shown/hidden state), tail (window.__afterterm.tail/activeTail), confirm (the close-confirm dialog's title/body/confirm/cancel text), opened (the URL from window.__afterterm.lastOpenExternal), marks (window.__afterterm.commandState(id), the OSC 133 state machine), window
    record.mjs                         ← records the page over CDP screencast into an mp4 through ffmpeg; drive record start/stop
    stop.mjs                           ← kills exactly the recorded process tree, never by name
    screenshot-display.ps1             ← OS-level capture of one whole display (shows title bar and notifier toasts)
    lib.mjs                            ← shared: run records, process tree walk, WMI spawn, display and window queries, CDP client
```

## Project Groups

A group is a project: a name, a folder, a colour and a default shell. Two ways to make one:

- **New project group…** (from the + beside the Projects label in the sidebar, or from the + on Home, or from any project's right-click menu) opens a
  modal that collects all four at once and opens the first terminal in the folder. Picking
  the folder auto-fills the name with its last segment (`D:\…\aftertales` → `aftertales`),
  until you type a name yourself. "Edit project" from any project menu or the project page's Edit button opens the same modal in edit mode.
- **Dragging one tab onto another** stays instant, no dialog: the project is created with
  defaults and its name field opens focused and selected.

### Every project is a row

Since Phase 1 of the projects-and-threads work the sidebar is built from projects first (src/renderer/sidebarWalk.ts), so a project with no threads is an ordinary row in the Projects section and the old bottom shelf is gone. Clicking the + on the row, or "New thread here" in its right-click menu, opens a terminal in its folder.

## Title bar, sidebar, header, Home and project page (Phases 1 to 3)

The palette and Inter are bundled in assets/fonts, loaded by theme.css. The renderer's CSP allows only same-origin assets, so the app works offline.

The title bar is a 32px strip across the whole window above every screen (`TitleBar/`), in the sidebar grey `#171717`: "afterterm" and the version badge on the left, the Windows caption buttons on the right, drawn by the OS through `titleBarOverlay` in main.ts (height 32, colour `#171717`, symbols `#8e8e8e`). The strip is the only drag region; nothing else shares its row, so nothing can sit under the caption buttons. Below it the sidebar and the main pane share a row whose background is the same grey, and the main pane has a rounded top-left corner at the surface radius, so the strip and the sidebar read as one L-shaped surface with the pane inset on it.

The sidebar structure, top to bottom: an icon row (56px) with the Home and Workspace icons and the collapse toggle; Search and New thread rows; General, only when there are threads with no project; Pinned, only when a project is pinned; Projects, every project as a row with its solid coloured folder icon (on hover, the + and project page icon appear, and on unpinned rows the pin icon); counter pills with a bell for threads that need you and a play for threads working (nothing at zero); thread rows show the kind icon (chat when a Claude session id was captured, shell otherwise), the title with the hook's glyph stripped, and the state icon at the right end; on hover a row gains 24px of right padding (140ms) and a close x fades into the freed space, the selected row keeps it, and the x closes the thread without selecting it; a five-row fold with "Show N more" that auto-expands when the open thread is beyond the fold; the rail (56px, Ctrl+Shift+B) with the toggle, Home, Workspace, Search and New thread.

The main pane header shows the kind icon, name, project on line 2, branch and worktree slots empty until Phase 3, state chip and dots menu.

Screen entry, on every switch: into the workspace the sidebar body slides in from the left (18px, 260ms) and the main pane from the right (14px, 260ms, 40ms later); into Home the page rises (`homein`, 280ms) and its sections stagger at 40ms steps; into a project page the same rise. The title bar and the icon row never move. All off under reduced motion. `app.tsx` sets `enter-workspace`, `enter-home` or `enter-project` on the root for 400ms after each switch and `data-screen` for the screen showing.

Menus: the one thread menu (`threadMenu.tsx`, right-click on a thread row, the header dots button and the project page rows) has Open, Move to project with a submenu and a back chevron, Open project page, Close. The one project menu (`projectMenu.tsx`, right-click on a Home card or row, a sidebar project row, the project page header) has Open, New thread here, Pin or Unpin, Open project page, Open in File Explorer, Open in <editor> for each detected editor or Choose editor..., Edit project, Archive, Delete project; an archived project gets Restore and Delete project; the Explorer and editor entries are disabled with the tip "Folder not found" when the folder is missing and hidden when the project has no folder; the sidebar splices its "New thread with shell" submenu after New thread here; the New thread row's right-click lists the shells.

State today maps to notification and icon: attention is needs you, amber bell, row breathes amber (5% to 16% of the colour over 2.4s); working is spinner; done is green check, row breathes green until viewed; compacting and background are spinner; asleep is moon; running is green play, port and all (Phase 5).

### Home, project page, chooser and palette (Phase 2)

Three screens under the title bar: Home, the workspace and the project page. Home and the project page render in place of the workspace, and the workspace stays mounted and hidden (`.workspace.hidden`, display none) so terminals keep running and the active tab's lazy Claude resume still fires; when the workspace comes back the active terminal is refit and focused unless something else holds the keyboard (`Terminal/index.tsx`, the `visible` prop). The app always opens on Home, projects or not (`initialScreen` in threadView.ts; Aryan's decision on 2026-09-07 after testing the first cut, which opened the workspace when there was no project).

Home (`components/Home/`, pure logic in `homeView.ts`): the date heading ("Sunday, 6 September"), under it the counter pills totalled across every live project and General (bell for needs you, play for working), rendered only when a count is non-zero; Pinned cards (folder, name, pills, time since last activity, the project page icon on hover, the filled pin); Projects rows for unpinned projects sorted by lastActiveAt with Show more after four; an "Archived · N" link that expands to rows with Restore; a + on the Projects label that opens the New project modal. Clicking a card or row opens the workspace on that project (its first thread, or a new one when it has none); the project page opens only from the folder-with-chevron icon or the menu.

Pin and archive are explicit user actions only: nothing pins or archives on its own. Archiving clears the pin and takes the project out of the sidebar; its threads stay alive and its project page still lists them. Restoring leaves it unpinned. Opening an archived project from Home restores it first. Both show a short toast.

The project page (`components/ProjectPage/`): back link to Home, folder icon and name, the folder path and default shell, then Open, New thread, Pin or Unpin, Edit, Archive or Restore, and at the right the Open in File Explorer and Open in <editor> logo buttons (disabled with "Folder not found" when the folder is missing, hidden when the project has no folder); Live, Asleep and History tabs (History is empty until Phase 4) with a search box over the list; rows open the thread in the workspace and right-click gives the thread menu.

The new thread chooser (`components/NewThreadChooser/`, logic in `chooserView.ts`) opens from the New thread row, the rail + and Ctrl+Shift+T (from Home or a project page the app switches to the workspace first and anchors the popover under the New thread control). It lists the current project first, then No project, then the others pinned first and by last activity, filtered by the input; a shell dropdown at the bottom defaults to the chosen project's shell; Enter takes the highlighted row. The + on a project row still creates a thread directly.

The search palette (`components/SearchPalette/`, logic in `paletteView.ts`) opens from Ctrl+Shift+P and the Search row: projects and threads, substring matches with prefix matches first, archived projects and their threads excluded; a project opens the workspace on it, a thread selects it.

The in-app toast (`components/Toast.tsx`, `.app-toast`) is a pill at the bottom centre for pin, archive, restore and editor errors, with an optional action ("Choose editor..."). It is separate from the overlay notifier window.

Activity stamping: main sends `pty:activity` for a tab at most once per 15s while it has input or output, ignoring the first 5s of a PTY's life so a shell banner or the app's own `claude --resume` does not read as activity; the renderer raises the thread's and its project's lastActiveAt. Activating a thread still stamps as before. The last-opened time is written to `prefs.json` as `lastOpenedAt` at startup and the previous value is exposed as `window.afterterm.app.lastOpenedAt`.

**Experiment: last opened on Home.** Aryan asked on 2026-09-07 for the app's last-opened time to be shown in the UI as an experiment he runs as a user: one quiet line under the Home date ("Last here 2d ago"), text3, small, only when the gap is over an hour, nothing on the first launch. It is deliberately not a main element. Built: `lastHereLine` in `homeView.ts`, rendered as `.home-lasthere`. Asked at the Phase 4 handoff on 2026-09-07: Aryan has not decided yet and will decide during his manual testing once every phase is done. Do not ask again before then, and do not extend it.

Editor detection (`editor-detect.ts`, pure and unit-tested, wired in main.ts) runs once after the window opens and is cached: `editorPath` in prefs.json first, then what the `code` command resolves to (the shim's exe, product read from the exe name so a `code` that opens Cursor is labelled Cursor), then the standard install folders, then the uninstall registry. The first hit is the primary editor (its name and logo on the button); extra editors are menu entries only. It re-runs after a failed launch and after Choose editor... (a file picker that writes `editorPath`). An unknown editor id at launch time is an error, never a fallback. `prefs.json` keys: `claudeNotifications`, `claudeHookToastShown`, `lastOpenedAt`, `editorPath`, `shellIntegration` (Phase 6, per-shell opt-out).

### Thread identity (Phase 3)

A thread's name (`threadName` in `threadView.ts`) tries four things in order: `claudeTitle` when one was ever captured, then the Claude Code summary already sitting in the raw title (`claudeSummaryTitle` in `chatTitle.ts`), then the transcript's first prompt (`firstPrompt`), then the stripped live title (`displayTitle`). A shell has no conversation to name itself after, so it always reads the live title. The fallback chain exists because the hook's own state titles ("▶ afterterm - working") are state, not a name, and a restored chat's shell briefly says "cmd.exe" before Claude sets its own title again, so neither can be trusted as the thread's name. `chatTitle.ts` is the one place that knows Claude Code's own title glyphs, so a change to Claude Code's title format is one edit there: idle is `✳`, busy on current builds is the four-frame `◐ ◓ ◑ ◒` spin, and busy on older builds is the wider `✢ ✶ ✻ ✽` dingbat cycle.

The transcript reader (`src/claude-transcript.ts`, pure and unit-tested) reads a session's JSONL at `~/.claude/projects/<cwd with every non-alphanumeric character turned into "-">/<sessionId>.jsonl`. The file is never read whole: a head and a tail read of 256 KB each are enough, since the first prompt sits near the top and the current model near the bottom. The first prompt is the first `user` line that is not a sidechain, not a slash command and not wrapped in a tag. The model is the latest main-chain assistant message's model id, with its `[1m]` suffix restored from the latest model attachment when the attachment's base id matches the assistant's model; `<synthetic>` models and sidechains are skipped throughout. `AFTERTERM_CLAUDE_PROJECTS_DIR` overrides the projects folder for tests. Main invokes it on the `claude-session:meta` IPC and also pushes a fresh read after every hook write, once a turn, so a `/model` switch or Claude's first reply shows up without polling; on launch the renderer reads every restored chat's transcript once, sequentially, so a session with many chats does not fire dozens of concurrent reads in its first second.

The model display name (`modelDisplayName`) turns an id into what a person reads: "claude-opus-5" is "Opus 5", "claude-opus-5[1m]" is "Opus 5 · 1M", "claude-fable-5-1" is "Fable 5.1", "claude-haiku-4-5" is "Haiku 4.5". `Tab.model` stores the raw id; the renderer maps it to the display name wherever it shows.

Branch and worktree (`src/git-info.ts`, pure and unit-tested) never run `git`: they walk up from a folder looking for a `.git` entry, then read `HEAD` (an ordinary checkout) or a `.git` file (`gitdir: <path>`, a linked worktree, whose folder is then given relative to the main repo, like `.claude\worktrees\phase-3-thread-identity`). A detached `HEAD` shows its short commit hash. The folder read is `claudeCwd ?? cwd` (`threadGitCwd` in `useTabState.ts`): Claude usually runs where the work actually is, often a worktree, while the shell that launched it can still sit in the main checkout, so reading the shell's own cwd would show the wrong branch for a chat. Branch and worktree are refreshed after session restore, when a shell reports a new cwd, right after a Claude session is first captured, and on a 30 second poll (`GIT_POLL_MS` in `app.tsx`) that is skipped while the window is hidden. `Tab.branch` and `Tab.worktree` are persisted.

Header line 2 (`Header/index.tsx`) shows, each with its own icon and a `data-meta` attribute: the project, the model (chats only), the branch, the worktree. A long worktree path ellipses rather than pushing the row wider.

The hover card (`components/ThreadHoverCard.tsx`, mounted by the sidebar) appears 350ms after the pointer enters a sidebar thread row, to the row's right. It shows Type (the kind word plus the state word, and "Resumes on click" appended for a restored chat that has not resumed this launch), Project, Model, Branch, Worktree, Active (relative time since last activity). It hides on click, right-click, drag start, scroll and sidebar collapse. A "Last ran" row and output lines are left for Phases 4 and 5.

The project page's thread rows carry a detail line under the name: kind word, then branch and worktree with their icons when present.

The last-opened experiment on Home (see "Experiment: last opened on Home" above) is now built: `lastHereLine` in `homeView.ts` renders `.home-lasthere`.

The limit to all of this: branch and worktree only show where the cwd is captured, which since Phase 6 is every shell (see "Shell integration for PowerShell, Git Bash and WSL" below), except chats, whose cwd always came from the notify hook's file channel and so worked from any shell from the start.

### Sleep, wake, history and the scrollback tail (Phase 4)

`Tab.asleep` is the source of truth, and the terminal layer (`Terminal/index.tsx`'s reconcile effect) is what makes reality match it: an asleep thread has no xterm instance and no PTY at all, only its record and a pane standing in for a terminal. Sleeping a thread (`sleepThread` in `app.tsx`, `sleepTab` in `useTabState.ts`, the pure transform in `sleepWake.ts`) is only a record change on the React side; the reconcile effect sees `asleep` turn true and runs `teardownTerminal(tabId, 'sleep')`, which captures the on-screen tail (`captureTail`, the buffer's last lines), unhooks the data and exit listeners (`pty.offData`, `pty.offExit`), kills the process tree through the existing `pty:destroy`, and disposes the xterm instance. The order matters: the data listener comes off before the tail is captured, because main batches output on a 16ms timer and flushes what it holds on exit, so a chunk could otherwise land between the capture and the dispose.

Waking (`wakeThread`, `wakeTab`, the reconcile effect's `createTerminal`) is the reverse: a fresh xterm is built, the saved tail is read and replayed dimmed above a "Woke just now" divider (`renderTailForTerminal` in `thread-tail.ts`) before the shell spawns, so the fresh prompt lands under the divider rather than glued to it, then the PTY is spawned in `wakePlan`'s cwd (`claudeCwd` over `cwd`, because `claude --resume` resolves the session against the current cwd, and `claudeCwd` is the hook-reported one, authoritative across shells), and a chat types `claude --resume <sessionId>` after a short delay for the shell's first prompt.

Every thread restored from `session.json` starts asleep (`restoredTab` in `sleepWake.ts`, called from `restoreSession` in `useTabState.ts`), replacing the old "restorable" ✳ marker outright: a relaunch spawns nothing at all, so nothing can cold-start N `claude` processes and their MCP servers at once, which is what used to OOM-crash the app on a loaded machine (see `docs/features-claude-session-resume.md`). Waking or resuming is now the only thing that ever creates a terminal, so the "resume is user-initiated" story is literally true rather than "lazy but still automatic for the active tab".

`pendingDestroyRef` in `Terminal/index.tsx` guards a wake that lands the instant after its own sleep: main keeps one PTY per tab id in a map, and the old PTY's exit handler deletes that map entry unconditionally when it fires, so a new PTY created before the old one is fully gone would be spawned, then have its own map entry deleted by the outgoing exit handler, leaving it alive but unreachable (input and resize going nowhere, silently). `createTerminal` awaits any pending destroy for the tab before asking main for a new PTY. `creatingRef` is the matching guard against `createTerminal` itself running twice for the same tab: it has awaits in it (the pending-destroy wait, the tail read), so the reconcile effect can run again before the new `TermInfo` lands in the map.

Tail files live at `%APPDATA%\afterterm\threads\<id>.txt`, capped at `TAIL_MAX_LINES` (200) and `TAIL_MAX_BYTES` (64 KB), plain text sliced from the xterm buffer with trailing whitespace and trailing blank lines trimmed (`thread-tail.ts`: `trimTail`, `serializeTail`, `parseTail`). The line slice happens in the renderer (`captureTail` in `Terminal/index.tsx`) because it needs the xterm buffer; the byte cap runs in main (the `threads:saveTail` handler) because it measures UTF-8 with `Buffer`, a Node global the sandboxed renderer does not have. A tail is written on sleep, on close of a thread that belongs to a project (its history entry needs one to replay), and for every awake thread at quit, through the synchronous `threads:saveTailsSync` flush in the `beforeunload` handler (`app.tsx`), which reads every terminal's current buffer via `TerminalAreaHandle.readAllTails()` so the last unsaved seconds are not lost with the window. A closed General thread's tail is deleted outright (`threads:deleteTail`), since General has no history to keep it for. `threads:prune`, called once after session restore with every live tab id plus every project's history ids, removes any tail file that backs neither, so a thread closed and forgotten long ago does not sit on disk forever.

History (`Group.history`, `src/renderer/history.ts`) is a project's closed threads, newest first, deduped by id and capped at `HISTORY_MAX` (100, oldest dropped first). Closing a thread that belongs to a project (`closeTab` in `useTabState.ts`) appends a `HistoryEntry` (`id`, `title`, `kind`, `sessionId?`, `cwd?`, `closedAt`) built by `historyEntryFor`. Closing says nothing (a "Moved to history" toast was tried and dropped at the Phase 4 handoff). `id` is deliberately the closed tab's own id: `tabFromHistory` recreates a tab with that same id when Resume runs, so its scrollback tail at `threads/<id>.txt` is found again without a second lookup table, and the recreated tab comes back awake with `wokeAt` already set, so it replays its tail the moment it mounts, exactly like a plain wake. Only a chat with a canonical UUID session id is resumable (`isResumable`); a shell in history is a record of what ran, nothing left to reattach to. A closed thread in General has no project to file it under and is simply gone (an open design decision from design-02, revisit if it hurts). The search palette's History rows (`paletteView.ts`'s `history` results, capped at 8, ranked the same prefix-then-recency way as projects and threads) open the project page on its History tab rather than selecting anything directly, since a closed thread has nothing live to select.

The UI: the moon icon (`IconMoon`, wired through `StateIcon`'s `'asleep'` case) and the "Asleep · 2d" chip (`asleepLabel` in `sleepWake.ts`, reading "just now" under a minute) appear on the sidebar row, the header chip and the hover card's Type row; asleep rows sit at 45% opacity (`.side-panel .th.sleep`). The main pane shows `AsleepPane` in place of the terminal card while the active thread is asleep: a large Wake button, autofocused (so Enter wakes it, the same "don't steal focus from something that already has it" guard the terminal itself uses for a chooser or palette input), and "Chat/Shell asleep since 2d ago" (`asleepSinceText`) above the dimmed saved tail. Sleep and Wake are in the one thread menu (`threadMenu.tsx`, `buildThreadMenu`), swapping based on `tab.asleep`. The project page's Asleep tab lists sleeping threads (`splitLiveAsleep` in `homeView.ts`) and its History tab lists closed ones with a Resume button per resumable row.

Activation changed meaning for an asleep thread: `handleActivate` in `app.tsx` only shows its pane (selects the tab, clears its badges) and never wakes it; nothing is spawned until the pane's own Wake button or the menu's Wake is used. This is what keeps waking user-initiated even for the thread you just clicked into.

The tab id counter (`useTabState.ts`, `restoreSession`) is taken over both live tab ids and every project's history ids together (`maxNumericId` in `history.ts`), not just the live ones: a closed thread keeps its id in history and its tail file still sits on disk under it, so a brand-new tab handed that same id would replay a stranger's saved output into what looks like a fresh terminal, and Resume would find the wrong thread.

The agent harness gained hooks for all of this: `window.__afterterm.tail(tabId, n)` and `.activeTail(n)` on the page (`Terminal/index.tsx`) read the last `n` lines of any terminal's buffer, or `null` when the thread has no terminal at all (itself the answer to "is it asleep"); `drive.mjs`'s `pane` command reads the asleep pane's Wake button and "asleep since" text (or reports the terminal's shown/hidden state), and its `tail` command prints through the `window.__afterterm` hook.

### Servers: running state, port, open localhost, last command (Phase 5)

A terminal running a dev server looks like every other terminal until Phase 5: the port is somewhere up in the scrollback and the row gives no sign. Detection means joining two lists Windows will hand over, both in `server-detect.ts` (pure, no Electron) and orchestrated by `main.ts`: the listening TCP sockets with their owning pid (`parseNetstatListeners`, reading `netstat -ano`), and every running process with its parent and creation time (`parseProcessList`, reading one `Get-CimInstance Win32_Process` call). A tab's shell pid is expanded into the whole tree of things it started (`descendantPids`), since `npm start` is several processes deep: cmd.exe spawns npm's node, which spawns the server's node, and only the last one listens. The two commands cost very differently on this machine (measured): `netstat -ano` about 45ms, a fresh `powershell.exe -Command "Get-CimInstance ..."` about 1s, `Get-NetTCPConnection` about 1.5s (too slow, not used), `wmic` not present at all. So netstat runs on every poll and the process list is only re-read when the set of listening sockets changed, a PTY appeared or disappeared since the last read (`treeDirty`), or the cache is over a minute old (`SERVER_PROC_MAX_AGE_MS`). Polling itself runs on a 10s slow interval (`SERVER_POLL_MS`) plus a burst poll 700ms after the last output chunk on any PTY (`SERVER_BURST_DELAY_MS`, rate-limited to one per 2s by `SERVER_BURST_MIN_GAP_MS`), which is what makes a port show up within about a second of the server printing its ready line rather than waiting for the slow interval. `portForTree` picks the port that started listening latest in a tree when more than one is open, on the theory that the most recently bound port is the one the running command actually cares about right now; a tie (two ports that started at the same recorded time) falls back to the lowest port. Decided by Aryan on 2026-09-07, replacing the earlier "lowest port wins" rule. Windows re-uses pids, so a naive parent walk could adopt an unrelated process sitting under a recycled pid; `descendantPids` guards against this the same way `scripts/agent-harness/lib.mjs` does, by dropping any edge where a "child" was created before its claimed parent.

The port lives on `Tab.port` (persisted, optional, validated on load as an integer 1 to 65535). While a thread is awake, main keeps it current by pushing `pty:port` (`preload.ts`'s `pty.onPort`) whenever the listener set changes, including a push of `null` when the server stops. While a thread is asleep the port is left exactly as it was: it is the one thing that marks a sleeping shell as a server (rather than a plain shell), which is what lets the asleep pane say "Server asleep since 2d ago · runs npm start" and lets a wake re-run that command. This is why `app.tsx`'s `pty:port` listener drops an incoming `null` for a thread that is already asleep: sleeping kills the process tree, and main's watcher reports the listener going away only after the kill has run, so a `null` arriving in that gap would otherwise erase the port the instant a server thread fell asleep. Only a `null` for a thread that is still awake, meaning its own server was actually stopped without the shell going away, clears the port. This exact bug was found and fixed during the Phase 5 self-test on 2026-09-07.

Running state and its precedence live in `threadView.ts`'s `threadState`: asleep wins over everything (a thread with no process has nothing to notify about or run), then a notification wins over running (a permission prompt or a finished turn asks something of the user, which a live port does not), and only once neither applies does a captured port make the thread `running`, otherwise it is `quiet`. The UI: the sidebar row gets a plain `:5173` port span (`.prt` in `SidePanel/index.tsx` and `SidePanel.css`) between the name and the state icon; the header chip reads "Running on :5173" (`runningLabel` in `threadView.ts`, `Header/index.tsx`); the project row's bell/play counter pills already counted `running` alongside `working` before Phase 5 existed (`projectCounts` in `threadView.ts`), so Home's totals needed no change to start counting a live server; the hover card's Type row reads "Server · Running on :5173" (`ThreadHoverCard.tsx`, via `kindWord`); the project page's thread detail line appends `:5173` after the branch/worktree bits (`ProjectPage/index.tsx`, a `[data-meta="port"]` span).

A server thread is also named by its command, not its live title (`threadView.ts`'s `threadName`): a shell (no `claudeSessionId`) with a captured `port` and a non-empty `lastCommand` is named by `lastCommand` ("npm start", "node server.js 48766") instead of `displayTitle(tab.title)`. The live title of a cmd thread running a server reads "npm start" or "cmd.exe - node server.js", and it is the command, not that title, that actually identifies the server. Asleep or awake makes no difference, since the port persists through sleep and is itself what marks the shell as a server; a chat keeps its existing name chain (`claudeTitle`, then the Claude summary glyph, then `firstPrompt`, then the live title) unchanged even when it happens to carry a port and a command. A shell with a port but no captured command, or a command but no port, keeps the live title. Decided by Aryan on 2026-09-07.

"Open localhost:port" (`openLocalhostLabel`/`localhostUrl` in `threadView.ts`) is offered in the sidebar row's right-click menu and the header dots menu (`threadMenu.tsx`'s `buildThreadMenu`, only for an awake thread with a captured port) and runs through `openLocalhost` in `app.tsx`, which is the same safelisted `shell:openExternal` IPC the terminal's clickable links already use, nothing server-specific added to main's safelist. Under the agent harness (`AFTERTERM_HARNESS=1`) main logs `[harness] shell:openExternal <url>` instead of calling `shell.openExternal`, and the URL is also recorded on `window.__afterterm.lastOpenExternal` (`drive.mjs`'s `opened` command reads it), so a test can prove the click reached the real open-external path without a browser window ever touching the person's screen.

The last command comes from OSC 133 prompt marks folded into cmd's injected `PROMPT` (`main.ts`'s `pty:create`, alongside the existing OSC 9;9 cwd report): `$E]133;A$E\` before the visible prompt and `$E]133;B$E\` after it, the same de facto shell-integration sequence VS Code, iTerm2 and WezTerm already parse. `commandMarks.ts` (pure, no xterm) holds the resulting state machine: A means a fresh, untouched prompt; B stamps `promptEnd` (the buffer row and column where typed input starts) and turns `atPrompt` on; C or D (the shell announcing a command started or finished) turns `atPrompt` off the same as a consumed Enter would, so a shell that emits them without this side ever seeing the Enter can't leave a stale `promptEnd` for the next Enter to misread. `Terminal/index.tsx` registers the OSC 133 handler (feeding `onMark`) and, on every Enter keypress in `term.onData`, reads the buffer from `promptEnd` to the cursor (`readCommandText`) before the keystroke is written through, then calls `onEnter`, which cleans the text (`cleanCommand`: trim, strip control characters, trim again, cap at 500 characters) and hands it to `onCommand` → `setLastCommand` in `useTabState.ts`. The command is read from the terminal's own screen buffer, what the shell actually echoed, deliberately not from the PTY input stream: line editing (backspace, arrow-key edits), history recall (up-arrow) and tab completion all change what ends up submitted, so only the rendered buffer between the prompt end and the cursor is guaranteed to match what really ran. The buffer needs one guard, though: anything else printing on the prompt line while the user types lands inside that range (found in the harness on 2026-09-07, a `start /b` background server printed its ready line right after the B mark and the capture came back as `tiny-server ready on http://localhost:48767node server.js 48766`). So `onInput` also tracks the text actually typed since the prompt end (printable characters and bracketed-paste bodies appended, backspace deletes, escape sequences and other control characters ignored), fed from every non-Enter chunk in `term.onData`, and `onEnter` prefers it only when the buffer ends with exactly the typed text but carries more in front of it, where the extra was provably never typed. Everything else keeps the buffer, so history recall (nothing typed), tab completion (the buffer ends differently) and mid-line arrow-key edits are unaffected. Since Phase 6, every shell emits these marks through its own mechanism (see "Shell integration for PowerShell, Git Bash and WSL" below), not only cmd's `PROMPT`, so a pwsh, Git Bash or WSL thread's server now captures `lastCommand` and re-runs it on wake exactly the way a cmd thread's does.

Waking a server re-runs that last command: `wakePlan` in `sleepWake.ts` returns a `runCommand` only when the thread has a captured port and its `lastCommand`, trimmed, is non-empty, under 500 characters and free of control characters (the exact same defensive checks `resumeSessionId`'s UUID check exists for, since this too becomes a typed shell command); a server never resumes a chat, so `resumeSessionId` is always null whenever `runCommand` is set. `Terminal/index.tsx`'s `createTerminal` types it `SHELL_READY_MS` (700ms) after spawn, the same wait a chat's `claude --resume` uses for the shell's first prompt to appear.

The close confirm (`needsCloseConfirm`/`closeConfirmText` in `threadView.ts`, the new `ConfirmDialog` component, mounted in `app.tsx`) fires only for an awake thread with a captured port: "Close the server on :5173?" / "This thread is listening on :5173. Closing it stops the server." / Close thread / Cancel. `closeThread` in `app.tsx` checks `needsCloseConfirm` and opens the dialog instead of closing outright; Escape and Cancel leave the thread running, Close thread runs the ordinary `closeThreadNow`. This is reached from the row's x, `Ctrl+Shift+W` and both thread menus, since all four funnel through the one `closeThread` function. A thread whose server has already stopped (no port) closes with no confirm, and the PTY-exit path (`handlePtyExit`, a process that ended on its own) never confirms either: there is nothing left to lose by the time the process is already gone.

Sleep asks the same way Close does, since it tears down the same process tree: `needsSleepConfirm` in `threadView.ts` is the same rule as `needsCloseConfirm` (awake with a captured port), implemented in terms of it so the two rules cannot drift apart. `sleepConfirmText(port, lastCommand)` reads "Sleep the server on :5173?" / "This thread is listening on :5173. Sleeping it stops the server; Wake runs npm start again." (or "Wake opens a fresh prompt." when there is no captured `lastCommand`) / Sleep thread / Cancel. `sleepThread` in `app.tsx` checks `needsSleepConfirm` and opens the same `ConfirmDialog` instead of sleeping outright; Escape and Cancel leave the thread running, Sleep thread runs the ordinary `sleepThreadNow`.

Limits: a server started with `start` or otherwise detached from the shell's process tree is invisible the moment the shell returns, since detection only ever walks the PTY's own descendants; only TCP listeners are found, nothing UDP; a chat thread never re-runs anything, `runCommand` is a shell-only concept; `lastCommand` is simply the last Enter at a captured prompt, so typing an unrelated command after stopping the server replaces what a later wake would re-run. Phase 6 below closes the last gap in this list: pwsh, Windows PowerShell, Git Bash and WSL threads now get `lastCommand` too, the same as cmd.

### Shell integration for PowerShell, Git Bash and WSL (Phase 6)

Phase 5 gave cmd two things at spawn: an OSC 9;9 cwd report and OSC 133 A/B prompt marks, both folded into its injected `PROMPT`. Every other shell profile afterterm offers, pwsh, Windows PowerShell, Git Bash and WSL, had neither, which is why the CWD-capture table above and the servers section both carried a "cmd only until Phase 6" caveat: a server thread in any of those shells got a port (process-tree detection has nothing shell-specific about it) but no `lastCommand`, and its cwd was never captured at all, so it always restored to the user's home folder. Phase 6 closes both gaps by giving every shell the same two things cmd already had, using whatever mechanism actually lands on that shell without disturbing a custom prompt.

Every spawn now goes through one pure module, `src/shell-integration.ts`'s `planSpawn`: given the shell profile, the tab's saved cwd, the home fallback, the already-cleaned env, the parsed prefs object and a `dirExists` predicate, it returns the exact command, args, cwd and env to spawn with. `pty:create` in `main.ts` calls it and only applies the result; it owns no shell-specific logic of its own any more, cmd's PROMPT injection included, which moved into the planner unchanged. This is what makes the module unit-testable without Electron: `src/shell-integration.test.ts` covers every shell's plan directly, plus a section that actually spawns real `pwsh.exe`, `powershell.exe` and Git Bash subprocesses to prove the bootstrap script runs and marks appear, not just that the string looks right.

**cmd**: unchanged behaviour. `$E]133;A$E\` before the visible prompt, `$E]9;9;$P$E\` (the cwd), then the user's own `PROMPT` (or the default `$P$G`), then `$E]133;B$E\`.

**pwsh and Windows PowerShell**: spawned with `-NoExit -EncodedCommand <base64 UTF-16LE bootstrap>`. The bootstrap (`PWSH_BOOTSTRAP` in `shell-integration.ts`) runs after the user's own `$PROFILE`, so a profile that defines its own prompt (oh-my-posh, starship, a hand-rolled one) sets it first and the bootstrap wraps whatever it finds: it saves the existing `$function:prompt` as `$global:__AftertermOriginalPrompt` (or a plain fallback if none was defined), then replaces `prompt` with a function that emits `133;A`, then `9;9;$($PWD.ProviderPath)` but only when `$PWD.Provider.Name -eq 'FileSystem'` (a `Cert:` or `HKLM:` drive has no OS path to report), restores `$?` if the last command had failed (`Write-Error -ErrorAction Ignore`, needed because building the marker strings above resets `$?` to true, and the original prompt may print its own success/failure indicator), calls the saved original prompt and appends its output, then emits `133;B`. A `$global:__AftertermPromptWrapped` guard stops it wrapping twice if the profile is dot-sourced again. `-EncodedCommand` was chosen over `-File` or a dot-sourced script for three reasons: it is not subject to PowerShell's execution policy (a `-File` would be, and Windows PowerShell's client default is Restricted, so the bootstrap would silently fail to run on a machine that has never touched execution policy), it needs no quoting through node-pty's argv (the script has its own quotes, backticks and here-string-like escapes that a shell-level quoting scheme would have to survive), and it prints no banner or "running script" noise the way a visibly dot-sourced file might. If the bootstrap itself fails for any reason, `-NoExit` keeps the shell open with the user's ordinary prompt rather than closing on a script error.

**Git Bash**: args are unchanged (`--login -i`), the hook enters entirely through the environment, since bash reads `PROMPT_COMMAND` (a function or string run before every prompt) without needing to be launched any differently. `PROMPT_COMMAND` is set to a one-line bootstrap, `eval "$AFTERTERM_BASH_HOOK" 2>/dev/null || unset PROMPT_COMMAND`, and `AFTERTERM_BASH_HOOK` carries the real hook text (`BASH_HOOK` in `shell-integration.ts`, written out long-form as a comment above the exported one-liner so it can actually be read and changed). This was verified against Git for Windows' own `/etc/profile`, `/etc/bash.bashrc` and `/etc/profile.d/*`: none of them assign `PROMPT_COMMAND` outright, and starship's and oh-my-posh's own bash init both prepend to whatever `PROMPT_COMMAND` already holds rather than replacing it, so afterterm's bootstrap value survives the login sequence and is still there by the time the first prompt is about to print. On its first run the hook installs itself properly: it strips its own bootstrap text back out of `PROMPT_COMMAND` (handling both the plain string form and bash 5.1's array form), keeps anything an rc file had appended alongside it (an rc doing `PROMPT_COMMAND="$PROMPT_COMMAND; history -a"` keeps its `history -a` call), appends the real precmd function, and `export -n`s both `PROMPT_COMMAND` and `AFTERTERM_BASH_HOOK` so a child shell does not inherit and re-run the installer. Every prompt after that: the precmd function wraps whatever `PS1` currently holds in `\[ESC]133;A ESC\ \]` and `\[ESC]133;B ESC\ \]` (re-wrapping every time, since starship reassigns `PS1` on every single prompt, not once at startup), and reports the cwd as OSC 9;9 with a Windows path: a `/d/x/y`-shaped path is turned into `D:\x\y` by parameter expansion alone (no subprocess), and anything else (a non-drive mount like `/usr/bin`) goes through `pwd -W`, a Git Bash builtin, still no fork. Failure mode: an rc file that assigns `PROMPT_COMMAND` outright (`PROMPT_COMMAND=my_prompt`, no append) discards afterterm's bootstrap before it ever runs, and the integration is silently off for that shell, no error, nothing to opt out of because it was never on.

**WSL**: the same hook, carried across the Windows/Linux boundary through `WSLENV` (`PROMPT_COMMAND:AFTERTERM_BASH_HOOK` appended to whatever the user's own `WSLENV` already lists, via `appendWslEnv`, never overwriting it). Inside the distro the hook runs the same as Git Bash's, except it detects `$WSL_DISTRO_NAME` is set and emits OSC 7 instead of OSC 9;9: `file://<distro>/<path>`, deliberately putting the distro name in OSC 7's host slot rather than a real hostname, since afterterm only ever talks to its own hook and that slot would otherwise go unused. The renderer's new OSC 7 handler (`osc7ToWindowsPath` in `src/shell-paths.ts`) turns that into the Windows form `Tab.cwd` actually stores: `/mnt/c/x` becomes `C:\x`, anything else becomes `\\wsl$\<distro>\<path>`. That Windows-shaped string is what `Tab.cwd` holds for a WSL tab, which is what lets Explorer, the editor launcher and the branch reader (all plain `fs`/shell-out calls expecting a Windows path) work on a WSL thread without any of them knowing WSL exists. Spawning back into a `\\wsl$\` cwd never stats that UNC path (a stat can block main's event loop or wake a stopped distro just to answer it): `planSpawn` recognises the prefix (`isWslUncPath`/`wslUncToLinux` in `shell-paths.ts`) and turns it straight into `wsl.exe -d <distro> --cd <linux path>` args, with the pty's own cwd argument left at the home fallback since `--cd` does the real work. An ordinary Windows cwd spawns exactly as before and `wsl.exe` maps it under `/mnt` itself. zsh and fish inside a distro have no `PROMPT_COMMAND` mechanism at all, so the integration is simply off there, the same silent no-op as an rc file that clobbers `PROMPT_COMMAND` in Git Bash. Processes running inside a WSL distro are not Windows processes, so server detection (which walks a Windows process tree by pid) cannot see them: a server started inside WSL never gets a port. **WSL is not installed on the development machine** (`wsl.exe` there is the Microsoft Store stub), so the WSL path is verified only by unit tests, not the harness: opening a WSL thread in the harness shows the stub's "install a distro" message, and a `\\wsl$\Ubuntu\home\aryan` cwd was confirmed planned as `wsl.exe` args `["-d","Ubuntu","--cd","/home/aryan"]` in the harness log. State this limit plainly whenever asked whether WSL shell integration was actually exercised end to end: it was not, on this machine, only its planning and path logic were.

No shell emits OSC 133;C or D (the "a command started" / "a command finished" marks): producing those needs a preexec-style hook, a `DEBUG` trap in bash or a PSReadLine key handler in PowerShell, and the renderer's own state machine (`commandMarks.ts`) only ever needed A and B to know where a prompt starts and ends, so none of the four new shells were made to emit them either.

**Opt-out**: `prefs.json`'s `shellIntegration` key, shaped `{ cmd | pwsh | powershell | gitbash | wsl: "off" }`, read at every spawn (`integrationEnabled` in `shell-integration.ts`) so flipping it takes effect on the next new terminal with no restart needed. Anything other than the literal string `"off"` for a given shell id, including the key being entirely absent or the whole `shellIntegration` object being missing or malformed, counts as "on", the same permissive rule every other prefs.json key in this codebase follows: a prefs.json that fails to parse at all counts as on too, never as a reason to stop opening shells. There is no settings UI for this yet.

**The Git Bash process-tree fix**: found while self-testing this phase in the harness on 2026-09-08, and unrelated to the cwd/prompt work above except that it surfaces on the same shell. Both server detection and the tree kill on sleep/close walk Windows parent links starting from the tab's shell pid, and for an MSYS shell (Git Bash) that chain breaks at every `exec` of an MSYS program: MSYS launches a program through a fork stub that execs the real process and then exits, so by the time `bash npm` is actually running, its Windows parent pid points at a process that is already gone. Native children below that point (node, cmd, the server itself) keep intact Windows parent links, so the break is exactly one hop wide but it is enough to sever the whole subtree below it from the walk. Before the fix this meant a server started in a Git Bash tab was never matched to it (no port ever showed), and closing or sleeping that tab's `taskkill /T` walk stopped at the same gap, leaving the server running as an orphan process with nothing left to have started it. The fix (`parseMsysPs` and `applyMsysParents` in `src/server-detect.ts`) reads MSYS's own process table via `<git root>\usr\bin\ps.exe -l` (about 55ms measured), whose `PID`/`PPID` columns are MSYS's own numbering but whose `WINPID` column is the real Windows pid netstat and `Win32_Process` both speak, and re-points each MSYS process's Windows parent at its MSYS parent's WINPID, which bridges exactly the gap the fork stub left. `main.ts` only runs `ps.exe` while at least one Git Bash tab is actually live, and only on the polls that re-read the process list anyway (never on every netstat poll); `killTree` (the one function sleep, close and quit all funnel through) reads it fresh right before the shell dies, since the process list has to still contain the shell's own rows at that moment, then kills the shell's tree and every pid in the merged descendant set.

**Testing this with the harness**: `scripts/agent-harness/launch.mjs` gained `--env KEY=VALUE` (repeatable) specifically so a custom-prompt test could point `USERPROFILE` and `HOME` at a scratch home directory without ever touching the real one: pwsh derives `$PROFILE` from the Documents folder, which itself expands `%USERPROFILE%`, and Git Bash reads `~/.bash_profile` from `HOME`, so redirecting both env vars is what lets a test prove the bootstrap wraps a *real* custom prompt (starship, oh-my-posh, a hand-written one) rather than only the shell's stock prompt. Two new log lines came with this phase: `[harness] pty:create <tab> shell=<id> integration=on|off cwd=<dir> cwdFallback=<bool> args=[...]` (from `pty:create`, an `-EncodedCommand` value is shown as the literal string `<encoded>` rather than the actual base64, since it is long and unreadable either way) and `[harness] msys tree <tab> pids=<list>` (from the server watcher and from `killTree`, only printed when a Git Bash tree actually has more than the shell itself in it).

Verified per shell in the harness on 2026-09-08 (pwsh, Windows PowerShell and Git Bash directly; cmd re-run as a regression check, since the planner now owns its behaviour too): a thread restored from a saved session woke in its saved folder, with the header showing the correct branch read from that folder's `.git/HEAD`; `drive marks --tab <id>` reported "at prompt: yes" once the shell settled; `cd`-ing into a sibling folder changed `Tab.cwd` and the header's branch line within a couple of seconds; typing `npm start -- <port>` turned the row green with the port, named the thread by the command, showed "Running on :port" in the header chip and "Last ran" on the hover card, exactly like a cmd server thread; Sleep asked "Wake runs npm start -- <port> again" and the asleep pane read "Server asleep since just now · runs npm start -- <port>"; Wake re-typed the command and the server was listening again within a few seconds. WSL's coverage is unit-tests-only, stated above and worth repeating here since it is the one shell this verification pass could not actually run.

## Default Shell

**cmd.exe** is the default. Shell picker dropdown (▾ next to +) offers all detected shells: Command Prompt, PowerShell 7, Windows PowerShell, Git Bash, WSL.

## Tab Title Intelligence

Raw OSC 0 titles from the shell are transformed before display:
- `C:\Users\<user>` → `~`
- `C:\Users\<user>\Tinkering\afterterm` → `afterterm` (last path segment)
- `C:\` → `C:\` (root stays as-is)
- Non-path titles (process names, etc.) → displayed as-is
- Paths ending in file extensions (`.exe`, `.bat`) are not saved as CWD

## Terminal Interactions

Clickable links (+ OSC 8), right-click copy/paste, find-in-scrollback, per-tab font zoom, and
file drag-and-drop — all in `Terminal/index.tsx`. See `docs/features-terminal-interactions.md`
for behavior and implementation detail.

## Notification System

Wired to Claude Code's hook events (the hook lives at `~/.claude/hooks/notify.ps1`, gated on `AFTERTERM=1`). When a background tab needs attention, afterterm surfaces it three ways:

- **Floating overlay toasts**: a separate always-on-top, transparent, frameless, click-through `BrowserWindow` (`notifierWindow` in main.ts) loads the same renderer with `?notifier=1`, which routes to `NotifierApp.tsx`. It stays **hidden** until a toast arrives (`showInactive()` on push), then hides again when the last toast clears (this is what keeps the Windows `WM_NCACTIVATE` white-bar artifact from showing). Clicking a toast focuses the main window and switches to that tab. The card's headline is the thread name, line 2 is the project with its coloured folder and the message, and the state icon sits in a tinted circle (design in docs/mockups/toasts.html).
- **Sidebar thread indicator**: a background thread that needs you shows an amber bell at the right end of its row and the row breathes amber (5% to 16% of the colour over 2.4s); a finished turn shows a green check and a green breath until the thread is viewed. Cleared only on thread activation. An asleep thread shows the moon and never a notification: sleeping a thread clears whatever it was showing (`sleepThread` in `app.tsx`), since a thread with no process has nothing left to notify about.
- **Working spinner**: while Claude is mid-turn, the spinner sits at the right end of the row (after the state icon slot). A `▶ working` title (from the `UserPromptSubmit` hook) starts it. The title channel alone is unreliable at *stopping* it (a mid-turn `⚠` permission prompt or `⚙` compaction replaces `working` with nothing to restore it; and if `Stop`'s `✅` never fires the spinner sticks), so afterterm uses the PTY output stream as a second signal. The decision logic lives in `src/renderer/spinnerState.ts` (pure, unit-tested): **silence-clear** (drop `working` after ~2.5s of no output; Claude's TUI is never silent >~450ms mid-turn but is silent forever at idle) and **re-arm** (flip `attention`/`compacting` back to `working` when output resumes after the pause). Wired in `app.tsx` (`handleOutput` + a 500ms tick) and fed by `Terminal/index.tsx` (`onOutput`). Empirical basis + capture harness: `scripts/spinner-harness/`.
- **Project row pills**: a collapsed or expanded project row shows a bell pill with the count of threads that need you and a play pill with the count that are working or running a server (Phase 5 done); nothing at zero.

Notification types map to title prefixes the shell hook emits: `✅` done, `⚠` attention, `⏳` background tasks, `⚙` compacting, `▶` working. Detection is in `Terminal/index.tsx` (`detectNotification`); fan-out to overlay + sidebar is in `app.tsx` (`handleNotification`). A toast is suppressed only when the user is *actually looking* at that tab (`activeTabId === tabId && document.hasFocus()`), so cross-app notifications still fire when afterterm is behind another window.

IPC flow: renderer `notify:push` → main → `notifierWindow` `notify:push`; overlay click `notify:tab-click` → main → `mainWindow.focus()` + `notify:activate-tab` → renderer; `notifier:hide` / `notifier:set-ignore-mouse` overlay → main.

### Hook self-install (so notifications work on a fresh machine)

Those decorated titles only exist if a hook is registered in the user's Claude
Code config — which a fresh install on someone else's machine doesn't have.
Claude Code has **no** way to inject a hook per-session (no env var, no extra
settings file; only the global/project `settings.json` hierarchy, and hooks
*merge* across it). So afterterm **ships its own hook and self-registers it**:

- **`assets/hooks/afterterm-notify.ps1`** — a self-contained, distributable copy
  of the notify logic. First line is `if ($env:AFTERTERM -ne '1') { exit 0 }`,
  so even though it's registered globally it's a **complete no-op outside
  afterterm** — zero output/latency/popups in the user's other terminals. It has
  **no popup path** (popups are always suppressed inside afterterm), so it drops
  the `popup.vbs`/`wscript` dependency of the dev-machine `~/.claude/hooks/notify.ps1`.
  Forces UTF-8 stdout so the glyphs survive Windows PowerShell 5.1 too.
- **`src/claude-hook-install.ts`** — `reconcileClaudeHook()` runs on every
  startup from `main.ts` (`reconcileNotifierHook`). It's **idempotent and
  additive**: copies the script into `~/.claude/hooks/` and merges its 5 entries
  (`SessionStart`, `UserPromptSubmit`, `Notification`/`permission_prompt`,
  `Stop`, `PreCompact`) into `~/.claude/settings.json` only if missing — never
  touching the user's own hooks/permissions. Skips entirely when there's no
  `~/.claude` (CC not installed) and **never clobbers** an unparseable settings file.
- **Opt-out** is a single flag in `%APPDATA%\afterterm\prefs.json`
  (`claudeNotifications: "enabled" | "disabled"`, default enabled). Reconcile
  reads it first; `disabled` surgically removes only afterterm's entries and
  stops re-adding them (this flag is what makes a manual removal *stick* — without
  it, reconcile can't tell "never installed" from "deliberately removed"). No
  settings UI yet; a future toggle just writes this flag.
- **One-time toast**: the first time it registers (`prefs.claudeHookToastShown`),
  `pushSetupToast()` fires a "Claude Code notifications enabled" toast so the user
  knows their config was touched — it's not a silent dotfile edit. The toast uses
  a sentinel `tabId`; `app.tsx` `handleActivate` ignores clicks for unknown tabs.

Tests (no app needed): `assets/hooks/test-afterterm-notify.ps1` (22 cases, runs
the hook as a subprocess) and `src/claude-hook-install.test.ts` (26 cases, run
with `node src/claude-hook-install.test.ts` — Node 24+ strips the TS types).

## Session Restore

Windows ConPTY cannot be reconnected after app restart — the kernel object dies with the process. (A future design to make shells *survive* an app restart lives in `docs/design-01-persistent-pty-host.md`.)

What afterterm does:
- Auto-saves every 2 seconds (debounced): tab order, group names/colors/collapsed state, shell type, CWD
- On relaunch: restores the full layout and spawns fresh shells starting in the saved CWD
- Limitation: scrollback, running processes, and command history are lost — each tab is a fresh shell

Save location: `%APPDATA%\afterterm\session.json`

Format: `{ version, tabs, groups, activeTabId }`. `version: 2` since the projects-and-threads work; 0.8.1 wrote no version field. Loading goes through `migrateSession` in `src/renderer/sessionMigration.ts`, which fills the fields a 0.8.1 file lacks (`Group.pinned`, `Group.archived`, `Group.lastActiveAt`, `Group.history`, `Tab.lastActiveAt`, `Tab.asleep`, `Tab.sleptAt`), drops entries without an id, strips transient fields and rejects anything that is not a session. Saving goes through `serializeSession` in the same module. Every 0.8.1 key keeps its name and meaning, so 0.8.1 still opens a file written by a newer build (it ignores the fields it does not know); a 0.8.1 build opening a Phase 4 file ignores `asleep`, `sleptAt` and `history` the same way and spawns every tab as before, since it has no notion of a thread starting asleep, and it ignores Phase 5's `port` and `lastCommand` the same way. Add new persisted fields in that module, not in `app.tsx`. Phase 3 adds `Tab.model`, `Tab.branch`, `Tab.worktree` and `Tab.claudeTitle` to the persisted keys, all optional strings; `Tab.firstPrompt` stays transient, re-read from the transcript on every launch. Phase 4 adds `Tab.sleptAt` (persisted, present only while asleep) and `Group.history` (persisted, `HistoryEntry[]`, defaults to `[]`); `Tab.wokeAt` is transient, set only for the one render after a wake or a history resume so the terminal layer knows to replay the saved tail, and is stripped on both load and save. Phase 5 adds `Tab.port` (persisted, optional, validated on load as an integer 1 to 65535, anything else dropped) and `Tab.lastCommand` (persisted, optional string).

Tabs that were running a **Claude Code session no longer auto-resume on relaunch**. Every thread restored from `session.json` starts asleep (`restoredTab` in `sleepWake.ts`), full stop: nothing is spawned at all until the user acts on it. A chat resumes when the user wakes it, from the asleep pane's Wake button or the thread menu's Wake, or when Resume is used on a history entry from the project page or the palette, both of which run `claude --resume <sessionId>` in the session's cwd the same way a plain wake does. The reason nothing used to resume in bulk is unchanged and is now also the reason nothing wakes in bulk: resuming every saved session at once cold-starts N `claude` processes plus their MCP servers simultaneously, which can OOM-crash the app on a loaded or lower-RAM machine (it did, with ~10 sessions on a 16 GB box); making every restore start asleep removes even the one exception the old lazy scheme carved out for the active tab. The
session UUID is still captured per-tab via a file the notify
hook writes — **not** the terminal/title channel — and persisted as `claudeSessionId` /
`claudeCwd`. Capture only fires on `UserPromptSubmit` / `Stop`: Claude Code's shared background
daemon inherits the tab env and pre-spawns throwaway `(spare)` sessions whose `SessionStart`
used to hijack the mapping with an id that never gets a transcript. See [`docs/features-claude-session-resume.md`](docs/features-claude-session-resume.md)
for the why and the wiring. (Dev isolation: `AFTERTERM_USER_DATA_DIR` redirects `session.json`
to a throwaway dir.)

### CWD capture — per-shell support

A tab can only restore to its last directory if afterterm captured that directory while you worked. Capture relies on the shell *announcing* its path via an OSC 9;9 report (OSC 7 for WSL), and since Phase 6 every shell profile afterterm offers does:

| Shell | CWD restore | How |
|---|---|---|
| **Command Prompt (cmd.exe)** | ✅ Supported | afterterm injects an OSC 9;9 cwd report into the `PROMPT` env var at spawn (`shell-integration.ts`'s `planSpawn`); the renderer parses OSC 9;9 (`Terminal/index.tsx`). Any custom `PROMPT` is preserved. |
| **PowerShell 7 (pwsh)** | ✅ Supported (Phase 6) | The shell is launched with `-NoExit -EncodedCommand <bootstrap>`; the bootstrap wraps whatever `prompt` function the user's own profile defines (custom prompts preserved) and has the wrapped prompt emit OSC 9;9 with `$PWD.ProviderPath`, FileSystem provider only. |
| **Windows PowerShell** | ✅ Supported (Phase 6) | Same wrapped-prompt mechanism as pwsh, verified separately on 5.1. |
| **Git Bash** | ✅ Supported (Phase 6) | A `PROMPT_COMMAND` hook installed through the environment (no arg/profile changes) reports the cwd as OSC 9;9, converting to a Windows path with parameter expansion for a drive path or `pwd -W` (a builtin, no fork) for anything else. |
| **WSL** | ✅ Supported (Phase 6), unit-tested only | The same `PROMPT_COMMAND` hook, carried into the distro through `WSLENV`, reports OSC 7 `file://<distro>/<path>` instead; the renderer converts that to a `\\wsl$\<distro>\...` or `C:\...` Windows path. WSL is not installed on the development machine, so this path has not been exercised end to end, only planned and unit-tested. |

A shell whose hook is off (opted out in `prefs.json`, or, for Git Bash and WSL, discarded by an rc file that assigns `PROMPT_COMMAND` outright instead of appending to it) falls back to spawning in the user home folder (`%USERPROFILE%`), the same as an unsupported shell always did.

> **Do not** re-add a title→cwd heuristic. cmd.exe sets its console title to `C:\…\cmd.exe - <command>`, which looks path-like but is garbage; capturing it poisoned the saved cwd (it failed `fs.existsSync` on restore → fell back to home). CWD comes from OSC 9;9 only.

## Keyboard Shortcuts

Registered via Electron `before-input-event` — work even when xterm.js has focus, don't conflict with terminal or Claude Code shortcuts.

| Shortcut | Action |
|---|---|
| Ctrl+Shift+T | New thread chooser (project and shell) |
| Ctrl+Shift+P | Search palette over projects and threads |
| Ctrl+Shift+W | Close current tab |
| Ctrl+Tab | Next tab |
| Ctrl+Shift+Tab | Previous tab |
| Ctrl+Shift+B | Toggle the sidebar between full width and the icon rail |
| Ctrl+V | Paste (bracketed paste) |
| Ctrl+C | Copy selection (SIGINT when no selection) |
| Ctrl+Shift+A | Select all scrollback |
| Ctrl+Shift+F | Find in current tab's scrollback |
| Ctrl+scroll | Zoom font size (per-tab) |
| Right-click | Copy selection if any, else paste (Windows QuickEdit style) |

## Windows-Specific Gotchas

- `conpty.node` must be **unpacked from ASAR** — `asar.unpack: '*.{node,dll,exe}'` in forge.config.ts
- node-pty 1.1.0 ships **N-API prebuilds** that work across Node ABIs — skip `@electron/rebuild` via `rebuildConfig.onlyModules: []` (source rebuild fails due to missing winpty git submodule)
- `kill()` can hang — wrap in async timeout, never call synchronously on the main thread
- Closing a PTY does **NOT** kill child processes — must use `taskkill /PID <pid> /T /F` for tree cleanup
- ConPTY teardown assertion crash — drain and kill asynchronously before `app.quit()` using a `before-quit` handler with `isQuitting` flag
- **PATH quote corruption**: Windows PATH can contain stray `"` characters that break cmd.exe's command resolution. afterterm strips quotes from PATH before spawning PTYs. `where.exe` handles quotes gracefully but cmd.exe's internal resolver does not — this causes "command not recognized" for executables that are clearly in PATH.
- **MSYS parent-link gap (Git Bash)**: an MSYS program launches through a fork stub that execs the real process and exits, so a Git Bash thread's Windows parent-pid chain breaks at every such exec, one hop below the interactive shell. A plain Windows-only walk (server detection, `taskkill /T`) stops right there and never finds what the shell actually started. `src/server-detect.ts`'s `parseMsysPs` reads MSYS's own `ps -l` (which knows the true parent, in a `WINPID` column that is still a real Windows pid) and `applyMsysParents` re-points each MSYS process's Windows parent at its MSYS parent's WINPID, bridging the gap so the rest of the walk (all native Windows links) works unchanged.

## Building

### Development
```powershell
npm start
```

Unit tests (plain Node 24+, no framework): `npm test` runs nineteen files, listed in `package.json`'s `test` script, the source of truth: `src/editor-detect.test.ts`, `src/claude-hook-install.test.ts`, `src/renderer/spinnerState.test.ts`, `src/renderer/sessionMigration.test.ts`, `src/renderer/sidebarWalk.test.ts`, `src/renderer/threadView.test.ts`, `src/renderer/homeView.test.ts`, `src/renderer/chooserView.test.ts`, `src/renderer/paletteView.test.ts`, `src/claude-transcript.test.ts`, `src/git-info.test.ts`, `src/renderer/chatTitle.test.ts`, `src/renderer/sleepWake.test.ts`, `src/renderer/history.test.ts`, `src/thread-tail.test.ts`, `src/server-detect.test.ts`, `src/renderer/commandMarks.test.ts`, `src/shell-paths.test.ts` and `src/shell-integration.test.ts` (Phase 6: the latter's real-shell section spawns actual `pwsh.exe`, `powershell.exe` and Git Bash subprocesses, so it needs those installed to exercise fully, and skips gracefully when one is missing). To drive the dev build itself, use the agent harness (see "Agent test harness"), never a bare `npm start` while someone is working on the primary monitor.

> If your network intercepts TLS (corporate proxy / some antivirus), `npm install`
> or the build may fail with certificate errors. Prefer pointing npm/Node at your
> proxy's CA bundle (`NODE_EXTRA_CA_CERTS`). Only as a last resort, and never in
> CI or shared environments, you can disable verification for one session with
> `$env:NODE_TLS_REJECT_UNAUTHORIZED="0"` — this turns off all TLS checks, so don't
> leave it set.

### Portable Build
```powershell
npm run build
```
Output: `out\afterterm-win32-x64\afterterm.exe` (~346MB, includes Chromium + node_modules)

Run directly from the `out` folder or move the entire `afterterm-win32-x64` folder anywhere.

**Close afterterm before building.** `npm run build` moves the current build to
`out/afterterm-old-<timestamp>/` and writes a fresh one to the standard path (old builds are
cleaned up on the next run). That rename **fails while afterterm is running from that
folder**, and `build.js` now stops with a clear message instead of packaging over a live
build.

A running `.exe` does not by itself block its folder being renamed; a process whose *current
directory* is that folder does. Launching `afterterm.exe` from Explorer or a pinned taskbar
shortcut sets exactly that, so for anyone starting the app the ordinary way an in-place build
always fails until they close it. (`make-shareable.ps1` has always refused outright, which is
what `npm run release` hits.)

**To build without closing the app**, use a separate copy whose `out\` is a different path:
`git worktree add`, copy `node_modules` into it, and build there, then move the artifacts
into the standard `out\` folder afterwards. This is how `v0.8.0` and `v0.8.1` were cut.

Session data (`%APPDATA%\afterterm\`) is shared between dev and portable builds.

### Shareable Build (self-extracting `.exe`)

The portable folder is ~346 MB — too heavy to hand to someone. To produce a single
**~67 MB self-extracting `afterterm-setup.exe`** (recipients double-click, no unzip tool needed),
prune dead weight (debug symbols, wrong-arch prebuilds, non-English locales) and repack with
7-Zip LZMA2 ultra. Full step-by-step in [`docs/guide-01-distributable-build.md`](docs/guide-01-distributable-build.md).

### Versioning & Releases

`package.json` `version` is the source of truth (**semver**: feature → MINOR, fix →
PATCH, breaking → MAJOR; still in `0.x` pre-stable). To cut a release: bump the
version, commit, then **`npm run release`** — it builds the portable folder + a
**version-stamped** `out/afterterm-<version>-setup.exe` and tags `vX.Y.Z` (refusing
to re-release an already-tagged version). Then `git push origin vX.Y.Z` and
`gh release create`. `npm run build` stays the quick, unversioned dev build. Run the
release from the **main repo checkout** so output lands in the standard `out\` folder
(from a worktree, move it after); a Claude session must land the version bump via a
**PR** (direct pushes to `main` are blocked). Tags exist from `v0.1.0` onward (`git tag
-l -n1`). Full process + lineage: [`docs/guide-02-releases.md`](docs/guide-02-releases.md).

### Agent test harness

`scripts/agent-harness/` launches the dev build in a throwaway profile, places it on
a chosen display and drives it over the Chrome DevTools Protocol, so an agent can
exercise and screenshot every screen of a phase without touching the running app or
the monitor a person is using. `npm run harness -- --session <copy of session.json>`
(add `--prefs <file>` to seed prefs.json, for example a `lastOpenedAt` so Home's last-here line shows;
add `--env KEY=VALUE`, repeatable, to set an extra environment variable for the dev build, e.g. a
scratch `USERPROFILE`/`HOME` so Phase 6's shell integration can be tested against a real custom
prompt without touching the user's own profile),
`npm run harness:drive -- <command>` with commands including bounds, sidebar, screenshot, click, hover (add `--wait <ms>` for the hover card's 350ms delay), unhover, drag, emulate-media (with --click, --eval, --screenshot), screen, home, project, chooser, palette, header, hover-card, pane, tail, confirm (the close-confirm dialog shown for a thread with a listening port), opened (the URL the last "Open localhost:port" click reached), marks (the OSC 133 command-mark state for a given `--tab <id>`), window bottom/restore/close-dialogs, and record start/stop (an mp4 screen recording of the drive session). `window.__afterterm.tab(id)` (via `eval`) reads one thread's live record (port, lastCommand, asleep) straight from state, without waiting on the saved file's two second debounce,
`npm run harness:stop`. Main-process support: `AFTERTERM_DISPLAY`
(`primary` | `secondary` | index; moves the main window and the notifier overlay) and
`AFTERTERM_REMOTE_DEBUG_PORT` (opt-in Chromium remote debugging). Safety rules, every
command and the known limitations are in
[`scripts/agent-harness/README.md`](scripts/agent-harness/README.md).

**Screenshots and recordings are kept.** Every capture taken while testing a phase (harness CDP
screenshots, per-window captures, whole-display captures) is saved under
`docs/screenshots/<phase>/` in the repo and is never deleted, by anyone. New captures go
there too, numbered, with a name that says what they show. Recordings (mp4 files from `drive record
start` / `record stop`, through CDP screencast and ffmpeg) go in the same folder, numbered and named
for the flow they show, and are kept the same way. Whole-display captures sit in
`docs/screenshots/<phase>/displays/`, which git ignores because they show personal windows;
everything else is committed with the phase. See `docs/screenshots/README.md`.

### Packaging Notes

- **No ASAR**: `asar: false` in forge.config.ts. The Forge Vite plugin strips `node_modules` from ASAR output, which breaks native modules. Disabling ASAR avoids this entirely.
- **node-pty copy hook**: `packageAfterCopy` hook in forge.config.ts manually copies `node_modules/node-pty` into the build directory since the Vite plugin doesn't include it.
- **Icons**: `assets/icon.ico` (prod) and `assets/icon-dev.ico` (dev). The app detects dev vs prod at runtime and uses the correct icon. Regenerate with `node scripts/generate-icons.js`.
- **App icon in exe**: set via `packagerConfig.icon` — Electron Forge embeds it into the Windows .exe resource table.

## Known Limitations

- **Claude Code inside afterterm has input lag** — Electron's Chromium keyboard pipeline adds latency compared to native terminals. Heavy TUI output (React/Ink rendering) compounds this via the IPC bridge.
- **Wispr shortcuts don't work inside Claude Code in afterterm** — Electron intercepts keyboard events at the Chromium level, preventing Windows accessibility/input injection APIs from reaching the PTY. Works fine in plain shell sessions.
- **Group contiguity** — dragging a tab out of its group's contiguous block auto-removes it from the group (intentional fix, not a bug)

## Docs

Research and design documents live in `docs/`. Naming convention: `research-NN-<topic>.md` for research, `design-NN-<topic>.md` for designs, other prefixes as needed.

- `docs/research-00-terminal-landscape-and-stack-validation.md` — pre-build stack/landscape research
- `docs/design-01-persistent-pty-host.md` — design for a detached PTY-host daemon so terminals survive an app update (not yet built)
- `docs/design-02-projects-and-threads.md` — the projects-and-threads redesign (Home screen, pinned projects, named threads, sleep/wake, history); agreed 2026-09-06 against `docs/mockups/afterterm-next.html`. Execution plan in `PHASES.md` at the repo root.
- `docs/guide-01-distributable-build.md` — shrink the portable build into a ~67 MB self-extracting `.exe` for sharing (7-Zip LZMA2 + pruning)
- `docs/guide-02-releases.md` — versioning (semver) + how to cut a tagged, version-stamped release (`npm run release`)
- `docs/ideas.md` — feature ideas backlog
- `docs/bugs.md` — running list of known, unfixed bugs (distinct from the platform Known Limitations above)
- `docs/note-01-duplicate-notifications-dispatcher.md` — why both the Windows popup and the overlay fired inside afterterm, and the settings.json dispatcher fix (incl. a TODO to make the self-install hook use the same approach)
- `docs/features-terminal-interactions.md` — links, right-click, find, font zoom, drag-drop (behavior + implementation)
- `docs/features-claude-session-resume.md` — auto-resume Claude sessions on relaunch (UUID capture via hook file channel, why not the terminal channel, security)
- `docs/features-servers.md`: server detection (port, running state), open localhost, last-command capture and re-run on wake, the close confirm (Phase 5)
- `docs/features-shell-integration.md`: OSC 9;9/OSC 7 cwd reporting and OSC 133 prompt marks for pwsh, Windows PowerShell, Git Bash and WSL, the custom-prompt guarantee, the opt-out, and the MSYS process-tree fix (Phase 6)

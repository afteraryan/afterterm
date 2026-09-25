# afterterm

A simple terminal emulator for Windows with **Chrome-style tab groups**. No existing terminal has this feature.

## Stack

- **Electron** (desktop runtime)
- **@xterm/xterm v6** + **@xterm/addon-webgl** (terminal renderer)
- **@xterm/addon-web-links** + **@xterm/addon-search** (clickable links, find-in-scrollback) — pinned to stable 0.12.x / 0.16.x; **don't** bump to the v6 betas (peer `^6.1.0-beta` → ERESOLVE). See `docs/features-terminal-interactions.md`.
- **node-pty** (PTY / shell spawning via ConPTY)
- **React 19** (UI)
- **@dnd-kit/core** (drag-and-drop for tab grouping)

## What it is

Projects and threads, not tabs. A project is a folder with a name, a colour, an icon and a default shell. Inside it are threads: chats (a terminal running Claude Code, named after its conversation, showing its model, branch and worktree) and shells. The app opens on a Home screen of pinned and recent projects; a rail on the left shows only the projects with something waiting for you. Every thread restored from a previous launch starts asleep, showing its last output, and wakes only when asked (a chat resumes its Claude Code session). Servers are detected by port, every shell reports its folder, and Claude Code's notifications arrive as toasts in an always-on-top overlay.

`CHANGELOG.md` says what changed for the user, release by release. `PHASES.md` is the execution record of the projects-and-threads work and the round after it, with every decision and its date.

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
  main.ts                              ← Electron main: PTY IPC, session persistence, shortcuts, notifier window/IPC, Claude-hook install, tail files, server watcher, planSpawn, killTree.
  claude-hook-install.ts               ← reconcileClaudeHook(): installs the notifier hook into ~/.claude (idempotent, prefs.json opt-out). Pure Node, unit-tested.
  editors.ts                           ← Editor product detection and info (product name from exe, list of installs)
  editor-detect.ts                     ← Finds primary/alternate editors via prefs, code command, install folders, registry. Unit-tested. Test file: editor-detect.test.ts
  claude-transcript.ts                 ← Reads a Claude transcript: first prompt, latest model, modelDisplayName, latestCwd, findTranscript. Unit-tested. Test file: claude-transcript.test.ts
  git-info.ts                          ← Branch and worktree from .git/HEAD or a worktree's .git file, no git spawned. Unit-tested. Test file: git-info.test.ts
  thread-tail.ts                       ← Scrollback tail a thread leaves behind: TAIL_MAX_LINES, TAIL_MAX_BYTES, isThreadId, tailFilePath, trimTail, serializeTail, parseTail. Unit-tested. Test file: thread-tail.test.ts
  server-detect.ts                     ← Pure port-listener detection: parseNetstatListeners, parseProcessList, descendantPids, portForTree, tabPorts, parseMsysPs, applyMsysParents. Unit-tested. Test file: server-detect.test.ts
  shell-integration.ts                 ← planSpawn: pure spawn planner per shell; integrationEnabled (opt-out); PWSH_BOOTSTRAP, BASH_HOOK, appendWslEnv. Unit-tested. Test file: shell-integration.test.ts
  shell-paths.ts                       ← Path translation Windows/WSL/Git Bash: parseOsc7, osc7ToWindowsPath, isWslUncPath, wslUncToLinux, windowsPathToWsl, isWindowsDrivePath. Unit-tested. Test file: shell-paths.test.ts
  preload.ts                           ← contextBridge: PTY API, session API, shell list, shortcuts, notify APIs, shell.openExternal, projects, editors, claudeSession, git, threads API
  prefs.ts                             ← readPrefs/updatePrefs: manages %APPDATA%/afterterm/prefs.json (claudeNotifications, lastOpenedAt, editorPath, shellIntegration)
  afterterm.d.ts                       ← Window.afterterm type declarations: projects, editors, pty API, notify/notifier, shell, files, claudeSession, git, threads APIs
  renderer/
    index.tsx                          ← React root; routes to NotifierApp when ?notifier=1, else App
    app.tsx                            ← Screen state, session restore, shortcut dispatch, notification fan-out, wakeThread/resumeThread, closeThread/sleepThread (confirm-gated), openLocalhost, Rail mount, togglePanel, cycleThread, harness hooks.
    index.css                          ← App layout (title bar, sidebar, main pane), screen-entry animations, terminal card, find bar.
    theme.css                          ← Palette tokens, bundled Inter, shared classes, keyframes, reduced motion, Home and project-page entrance animations
    jumpScroll.ts                      ← Pure: jump button show/hide rule. JumpTarget, JumpState, JUMP_THRESHOLD_LINES/PX, initialJumpState, onScrollSample. No xterm/DOM. Unit-tested. Test file: jumpScroll.test.ts
    sessionMigration.ts                ← session.json shape: migrateSession, serializeSession, setUnreadFlag, asUi, Group.icon validated, port validated 1-65535. Pure, unit-tested.
    sidebarWalk.ts                     ← computeSegments: sidebar rows built from groups first, so a group with zero tabs renders. Pure, unit-tested.
    threadView.ts                      ← Pure: thread kind/state/title, threadFolderTarget, threadName, model label, foldThreads, counter pills, kindWord, runningLabel, needsCloseConfirm, needsSleepConfirm, threadState, projectCounts, threadFolder. Unit-tested.
    attention.ts                       ← Aggregate every count reads from: countStates/countTabs, isWaitingState, projectAttention, totalAttention, railProjects, panelLists, firstThreadToOpen. Pure, unit-tested. Test file: attention.test.ts
    panelView.ts                       ← Sidebar panel groups (General, Pinned, Recent, Other): panelSections, filterPanel, visibleThreadIds, cycleThreadId. Unit-tested. Test file: panelView.test.ts
    spinnerState.ts                    ← Pure decision logic for the spinner and needs-you: onTitle, onOutput, onTick, onInterrupt, onAnswer, TabTiming. Unit-tested. Test file: spinnerState.test.ts
    commandMarks.ts                    ← Pure: OSC 133 prompt marks (A/B/C/D): parseOsc133, onMark, onEnter, cleanCommand. No xterm/DOM. Unit-tested. Test file: commandMarks.test.ts
    homeView.ts                        ← Pure: Home screen logic (date heading, pills, pinned cards, projects by activity, archived list, lastHereLine). Unit-tested. Test file: homeView.test.ts
    chatTitle.ts                       ← Claude Code's and the notify hook's title glyphs: claudeSummaryTitle, isHookTitle. Pure, unit-tested. Test file: chatTitle.test.ts
    chooserView.ts                     ← Pure: new-thread chooser project and shell options, sorting and filtering. Unit-tested. Test file: chooserView.test.ts
    paletteView.ts                     ← Pure: search palette projects and threads, and now history entries by title with their own rank and cap. Unit-tested. Test file: paletteView.test.ts
    sleepWake.ts                       ← Pure: sleepTab, wakeTab, restoredTab, sleepAllForShutdown, asleepLabel, asleepSinceText, wakePlan. Unit-tested. Test file: sleepWake.test.ts
    history.ts                         ← Pure: historyEntryFor, appendHistory (HISTORY_MAX 100), removeHistoryEntry, isResumable, tabFromHistory, maxNumericId. Unit-tested. Test file: history.test.ts
    threadMenu.tsx                     ← Thread menu (sidebar right-click, header dots): Open, Sleep/Wake, Move to project, Open localhost:port, Close, Mark as unread/read, Open in File Explorer, Open in <editor> (openInEditor; the header's dots menu leaves it out).
    projectMenu.tsx                    ← buildProjectMenu: Open, New thread here, Pin/Unpin, Open project page, Open in File Explorer, Open in <editor> per detected editor, Edit, Archive/Restore, Delete
    NotifierApp.tsx                    ← The floating overlay window's React root: toast cards, hide-when-empty logic; draws the project's chosen icon (projectIcon) in place of the folder.
    NotifierApp.css                    ← Toast card styles (state icon in a tinted circle, thread name headline, project line with coloured folder)
    hooks/
      useTabState.ts                   ← All tab/group state, session restore, pin/archive/activity, openProject, setClaudeMeta/setGitInfo, sleepTab/wakeTab/closeTab, resumeFromHistory, restoreSession, setPort/setLastCommand/setUnread, GroupConfig.icon.
    components/
      ScreenNav.tsx                    ← Just the Screen type ('home' | 'workspace' | 'project'); the old icon row is gone, carried by the always-on Rail. ScreenNav.css removed.
      Toast.tsx                        ← In-app toast pill (pin, archive, restore, editor errors). Styles in Toast.css
      Toast.css                        ← Toast styles (centre bottom, auto-hide)
      ThreadHoverCard.tsx               ← Sidebar thread hover card: Type (kind + state via asleepLabel/runningLabel), project, model, branch, worktree, Last ran, active time, shown 350ms after hover.
      ThreadHoverCard.css               ← Hover card styles
      Rail/
        index.tsx                      ← Always-on rail, 76px at the left edge: sidebar toggle, Search/New thread rows, Home/Workspace pill, one tile per railProjects, click opens firstThreadToOpen, right-click the project menu.
        Rail.css                       ← Rail styles: the two closable blocks, the Home/Workspace pill's sliding thumb, the tile and badge column.
      SidePanel/
        index.tsx                      ← The panel: toggle, Search box, General/Pinned/Recent (panelView.ts), docked Other projects row, thread rows with close x and port pill, five-row fold, DnD, hover card, SidePanelHandle.
        SidePanel.css                  ← Panel styles (.side-panel slides to zero when hidden), breath keyframes, Pinned line, collapse-all buttons, Search box (.srch), the dock (.dock/.dlist/.drow).
      Header/
        index.tsx                      ← Main pane header: kind icon, name, project/model/branch/worktree line, state chip, editor button (primary editor's logo, opens threadFolder), dots menu (Sleep or Wake, Open localhost:port); worktree opens the folder in Explorer; line 2 stays one row.
        Header.css                     ← Header styles (.header-meta values in --text2, .header-meta-link for the worktree button).
      AsleepPane/
        index.tsx                      ← Pane shown while the active thread is asleep: autofocused Wake button, asleepSinceText, the saved dimmed tail, .asleep-scroll, a JumpButton fed by onScrollSample.
        AsleepPane.css                 ← Pane styles: fills the terminal card's area so swapping never shifts header/sidebar; .asleep-scroll; sticky .wakebox is a bordered button over the tail.
      TitleBar/
        index.tsx                      ← The 32px title bar strip: name and version on the left, the OS caption buttons on the right, the window's drag region
        TitleBar.css                     ← Strip styles (sidebar grey)
      Home/
        index.tsx                      ← Home screen render, date heading, totals, last-here line, pinned cards, projects list, archived section, Show more toggle
        Home.css                       ← Home layout and typography
      ProjectPage/
        index.tsx                      ← Project page: header, folder/shell line, action buttons, Explorer/editor buttons, tabs (Live, Asleep, History), search box, thread list or empty state.
        ProjectPage.css                ← Project page layout
      NewThreadChooser/
        index.tsx                      ← Overlay modal: current project first, then No project, then others by pin and activity; shell dropdown
        NewThreadChooser.css           ← Chooser modal styles (optional if styles are in components)
      SearchPalette/
        index.tsx                      ← Palette modal: projects, threads and now history rows (closed threads) by prefix match, Ctrl+Shift+P to open; a history row opens the project page on its History tab
        SearchPalette.css              ← Palette modal styles (optional if styles are in components)
      ConfirmDialog/
        index.tsx                      ← Generic yes/no confirm dialog (title, body, confirm/cancel labels, danger styling). Used for the port-listening close confirm.
        ConfirmDialog.css               ← Confirm card styles on top of the shared modal-overlay/modal-card look; the danger button variant
      GroupModal/
        index.tsx                      ← New/Edit project dialog: name, folder picker, colour, shell, open-terminal-now, icon picker (PROJECT_ICON_IDS swatches, ProjectIcon previews).
        GroupModal.css                 ← Modal overlay + form styles, the icon swatch grid
      JumpButton/
        index.tsx                      ← Flipping jump button: 32px chevron centred in its scroller; mousedown prevented so it never steals focus; wheel passes through via onWheel.
        JumpButton.css                 ← Button styles: centred, scale-only enter and exit on --med, visibility flipped after the exit; off under reduced motion through theme.css's global rule
      Terminal/
        index.tsx                      ← xterm.js lifecycle, PTY wiring, title intelligence, OSC 9;9/OSC 7 cwd capture, clipboard/links/find bar/font zoom/drag-drop, teardownTerminal/createTerminal, the OSC 133 handler, pendingDestroyRef/creatingRef, harness hooks, JumpButton wiring.
      Icons.tsx                        ← SVG icons: FolderIcon, StateIcon, KindIcon, Spinner, ProjectIcon (ten glyphs), IconCollapseAll/IconExpandAll, IconCompact.
      Menu.tsx                         ← Positioned menu with submenu and back chevron
      Menu.css                         ← Menu styles
      Tooltip.tsx                      ← The app tooltip; any element with data-tip. data-tip-side="right" shows the tip beside the element for ones at the window edge.
      TabBar/
        types.ts                       ← Tab (model, branch, worktree, claudeTitle, asleep, port, lastCommand, unread), Group (history, icon), HistoryEntry, GroupColor, PROJECT_ICON_IDS, isProjectIconId.
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
    launch.mjs                         ← Seeds a throwaway AFTERTERM_USER_DATA_DIR, starts the dev build with CDP on; --prefs seeds prefs.json; --env sets env vars; --open-external allows real launches.
    watch-jump.mjs                     ← Clicks the jump button and samples window.__afterterm.viewport() every 50ms, to see a terminal jump animate.
    drive.mjs                          ← CDP client: targets, bounds, screenshot, eval, dom, click, rightclick, hover, unhover, drag, emulate-media, type, key, sidebar, rail, dock, search, screen, home, project, chooser, palette, header, hover-card, pane, tail, confirm, opened, marks, counts, reload, window, scroll, jump, pane-scroll, record.
    record.mjs                         ← records the page over CDP screencast into an mp4 through ffmpeg; drive record start/stop
    stop.mjs                           ← kills exactly the recorded process tree, never by name
    screenshot-display.ps1             ← OS-level capture of one whole display (shows title bar and notifier toasts)
    lib.mjs                            ← shared: run records, process tree walk, WMI spawn, display and window queries, CDP client
```

## How the app works today

One paragraph per area. The detailed record of each (what was built, when, why, what was tried and rejected, and how it was verified) is in the `docs/features-*.md` file named at the end of each paragraph; read that before changing the area.

**Home, projects, the project page.** The app always opens on Home: the date, a quiet "Last here 2d ago" line when the previous launch was over an hour ago (an experiment Aryan has not decided on; do not ask, do not extend), counter pills, pinned project cards, the other projects by recent activity, an Archived section. Pin and archive are explicit actions only. Opening a project lands on the thread last worked in (`lastWorkedThread` in `attention.ts`) or a new thread when it has none. The New/Edit project dialog collects name, folder, colour, icon and shell; a project with no threads is still a row. The project page has Open, New thread, Pin, Edit, Archive or Restore, Open in File Explorer and Open in <editor> (`editor-detect.ts`, `prefs.json`'s `editorPath`), and Live, Asleep and History tabs. The new thread chooser (Ctrl+Shift+T) and the search palette (Ctrl+Shift+P) are overlays with pure logic in `chooserView.ts` and `paletteView.ts`. `docs/features-projects-and-threads.md`.

**Thread identity.** A chat's name is, in order, the `claudeTitle` the hook captured, the Claude summary in the raw title (`chatTitle.ts` knows Claude Code's title glyphs), the transcript's first prompt, then the live title; a shell reads its live title, except a server, which is named by its last command. The transcript reader (`claude-transcript.ts`) reads a head and a tail of `~/.claude/projects/<dir>/<sessionId>.jsonl` for the first prompt, the latest model and the newest `cwd`, and finds the file by session id across project dirs when a session moved worktree. Branch and worktree come from `git-info.ts` (reads `.git/HEAD` and worktree files, never runs git) on `threadFolder(tab)` (`claudeCwd` over `cwd`), refreshed on restore, on a cwd change, on capture and on a 30s poll. The header's project and worktree items open their folders in Explorer, and the header's editor button (beside the dots) opens the thread's own folder in the primary editor. The rule for every folder action: one reached from a project (project menu, project page, the header's project item) opens the project root; one reached from a thread (thread menu, the header's worktree item and editor button) opens the thread's own folder (`threadFolderTarget`), so a worktree chat opens its worktree. `docs/features-projects-and-threads.md`, `docs/features-long-output-and-fix-sweep.md`.

**Sleep, wake, history, the tail.** `Tab.asleep` is the truth and `Terminal/index.tsx`'s reconcile effect makes reality match it: an asleep thread has no xterm and no PTY. Sleeping captures the last `TAIL_MAX_LINES` of the buffer to `%APPDATA%\afterterm\threads\<id>.txt` (`thread-tail.ts`), kills the process tree and disposes the xterm; waking spawns fresh in `wakePlan`'s folder, then types `claude --resume <id>` for a chat or re-runs the last command for a server. Nothing is replayed into the terminal on wake (dropped 2026-09-19); the tail is shown on the asleep pane only. Every restored thread starts asleep (`restoredTab`), so a relaunch spawns nothing. Closing a project thread files it in the project's history (`history.ts`), resumable if it was a chat. Sleep and Close ask first for a thread with a listening port. `docs/features-projects-and-threads.md`, `docs/features-claude-session-resume.md`.

**The asleep pane and long output.** The pane opens at its newest lines and keeps following its end through resizes until the user scrolls away; the Wake box is a white button with a thin border and the "asleep since" line in a solid pill, in the pane's colour token. One jump button per scroller (`components/JumpButton`, the rule in `jumpScroll.ts`), at the scroller's centre, shown only for scrolling the user started, pointing the way they scroll, hidden near that end; a click scrolls with an eased animation; a wheel over it goes to the scroller. `docs/features-long-output-and-fix-sweep.md`.

**Attention.** `threadState` in `threadView.ts` gives every thread one state with a fixed precedence (unread, then asleep, then a notification, then running, then quiet). Needs-you persists until the thread is answered (Enter in it, `onAnswer` in `spinnerState.ts`), not until it is viewed; done clears on view; a chat can be marked unread (`Tab.unread`, persisted, cleared by typing or waking). `attention.ts` is the one aggregate: per-project counts, Home's totals, the rail's project list, the panel's Pinned, Recent (3 days) and Other lists, and `firstThreadToOpen` for a rail tile click. `docs/features-attention-and-sidebar.md`.

**The rail and the panel.** The rail (`components/Rail`) is always on, on every screen: Home and Workspace, then a tile per project that has a thread waiting, working, finished or compacting, with badges beside it. The panel (`components/SidePanel`) lists General, Pinned and Recent with collapse buttons on the headings, an in-place search box, a five-row fold per project that stays open while a hidden row is waiting, and a docked Other projects row; it can be hidden (`ui.panelHidden`, Ctrl+Shift+B). Ctrl+Shift+Down/Up cycle thread rows in panel order across projects; Ctrl+Tab cycles in session order. The one thread menu is `threadMenu.tsx`, the one project menu `projectMenu.tsx`. `docs/features-attention-and-sidebar.md`.

**Servers.** `server-detect.ts` joins `netstat -ano` with one `Win32_Process` read to find which thread's process tree owns a listening port (with the MSYS `ps -l` bridge for Git Bash trees); main pushes `pty:port`. A running server shows `:5173` on its row and "Running on :5173" in the header, is named by its last command (captured from OSC 133 prompt marks, `commandMarks.ts`), offers Open localhost, asks before Sleep or Close, and re-runs the command on wake. `docs/features-servers.md`.

**Shell integration.** `shell-integration.ts`'s `planSpawn` gives every shell an OSC 9;9 (OSC 7 for WSL) cwd report and OSC 133 A/B prompt marks: cmd through `PROMPT`, pwsh and Windows PowerShell through a wrapped `prompt` function delivered by `-EncodedCommand`, Git Bash and WSL through a `PROMPT_COMMAND` hook carried in the environment. Custom prompts are wrapped, never replaced. Opt out per shell in `prefs.json`'s `shellIntegration`. WSL is unit-tested only (not installed on the dev machine). `docs/features-shell-integration.md`.

**Notifications.** Claude Code's hook (self-installed into `~/.claude` by `claude-hook-install.ts`, a no-op unless `AFTERTERM=1`) sets decorated titles and writes the session id and cwd to a per-tab file. Titles become thread states and toasts; toasts render in a separate always-on-top transparent window placed on the display holding the main window, repainted after every moment DWM can paint its caption (the white bar). The spinner's stop is decided from PTY output silence (`spinnerState.ts`). `docs/features-notifications.md`, `docs/features-claude-session-resume.md`.

## Default Shell

**cmd.exe** is the default for a thread with no project; a project has its own default shell. The new thread chooser's shell dropdown and the New thread row's right-click offer every detected shell: Command Prompt, PowerShell 7, Windows PowerShell, Git Bash, WSL (WSL is offered even when only the Store stub is installed; left as is by Aryan's decision).

## Tab Title Intelligence

Raw OSC 0 titles from the shell are transformed before display:
- `C:\Users\<user>` → `~`
- `C:\Users\<user>\Tinkering\afterterm` → `afterterm` (last path segment)
- `C:\` → `C:\` (root stays as-is)
- Non-path titles (process names, etc.) → displayed as-is
- Paths ending in file extensions (`.exe`, `.bat`) are not saved as CWD

## Terminal Interactions

Clickable links (and OSC 8), right-click copy and paste, find in scrollback, per-thread font zoom,
file drag and drop, and the jump button for long output: all in `Terminal/index.tsx` (the jump
button's rule in `jumpScroll.ts`). See `docs/features-terminal-interactions.md` for behaviour and
implementation detail.

## Notification System

Claude Code's hook events reach afterterm two ways: decorated window titles (`✅` done, `⚠` attention, `⏳` background, `⚙` compacting, `▶` working; `detectNotification` in `Terminal/index.tsx`, fan-out in `app.tsx`'s `handleNotification`) and a per-tab file with the session id and cwd. A toast is suppressed only while the user is looking at that thread with the window focused. The overlay is `notifierWindow` in `main.ts` (`?notifier=1` routes to `NotifierApp.tsx`), shown on push and hidden when empty, placed by `notifierDisplay()` on the main window's display, repainted by `repaintNotifier()` after a show, on `WM_DWMNCRENDERINGCHANGED` and on the main window's focus. The hook is bundled at `assets/hooks/afterterm-notify.ps1` and reconciled into `~/.claude` on every startup (`reconcileClaudeHook`, idempotent, additive; opt out with `claudeNotifications: "disabled"` in `prefs.json`). Full detail: `docs/features-notifications.md`.

## Session Restore

Windows ConPTY cannot be reconnected after a restart, so `session.json` (`%APPDATA%\afterterm\`, saved 2s after a change through `serializeSession`, loaded through `migrateSession` in `sessionMigration.ts`, `version: 2`) records the layout, and every restored thread starts asleep: nothing is spawned until the user wakes it. A chat's session id and cwd are captured from the hook's file channel on `UserPromptSubmit` and `Stop` only (`claudeSessionId`, `claudeCwd`), and a transcript read at launch and before a wake moves `claudeCwd` to the folder the session is really in. Add new persisted fields in `sessionMigration.ts`. Every shell reports its cwd (see Shell integration), so a thread reopens where it was; do not re-add a title-to-cwd heuristic (cmd's title looks like a path and is not). Full detail: `docs/features-claude-session-resume.md`, `docs/features-shell-integration.md`.

## Keyboard Shortcuts

Registered via Electron `before-input-event` — work even when xterm.js has focus, don't conflict with terminal or Claude Code shortcuts.

| Shortcut | Action |
|---|---|
| Ctrl+Shift+T | New thread chooser (project and shell) |
| Ctrl+Shift+P | Search palette over projects and threads |
| Ctrl+Shift+W | Close current tab |
| Ctrl+Tab | Next tab |
| Ctrl+Shift+Tab | Previous tab |
| Ctrl+Shift+Down / Ctrl+Shift+Up | Next and previous thread row in sidebar order, crossing projects (Phase 8) |
| Ctrl+Shift+B | Hide or show the panel (the rail stays) |
| Ctrl+Shift+Down | Next thread the panel is showing, across projects |
| Ctrl+Shift+Up | Previous thread the panel is showing, across projects |
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

Unit tests (plain Node 24+, no framework): `npm test` runs twenty-one files, listed in `package.json`'s `test` script, the source of truth: `src/editor-detect.test.ts`, `src/claude-hook-install.test.ts`, `src/renderer/spinnerState.test.ts`, `src/renderer/sessionMigration.test.ts`, `src/renderer/sidebarWalk.test.ts`, `src/renderer/threadView.test.ts`, `src/renderer/attention.test.ts`, `src/renderer/panelView.test.ts`, `src/renderer/homeView.test.ts`, `src/renderer/chooserView.test.ts`, `src/renderer/paletteView.test.ts`, `src/claude-transcript.test.ts`, `src/git-info.test.ts`, `src/renderer/chatTitle.test.ts`, `src/renderer/sleepWake.test.ts`, `src/renderer/history.test.ts`, `src/thread-tail.test.ts`, `src/server-detect.test.ts`, `src/renderer/commandMarks.test.ts`, `src/shell-paths.test.ts` and `src/shell-integration.test.ts` (Phase 6: the latter's real-shell section spawns actual `pwsh.exe`, `powershell.exe` and Git Bash subprocesses, so it needs those installed to exercise fully, and skips gracefully when one is missing). To drive the dev build itself, use the agent harness (see "Agent test harness"), never a bare `npm start` while someone is working on the primary monitor.

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
- **A server inside WSL is invisible**: server detection walks a Windows process tree, and WSL processes are not in it. **WSL shell integration is unit-tested only**: WSL is not installed on the development machine.

## Docs

`CHANGELOG.md` at the repo root records what changed for the person using the app, release by release, at feature level (never code level); the section "Unreleased" collects everything since the last tag and becomes the next release's notes. Add to it whenever a change is something the user would notice.

Research and design documents live in `docs/`. Naming convention: `research-NN-<topic>.md` for research, `design-NN-<topic>.md` for designs, other prefixes as needed.

Procedures an agent follows while working on this repo (not product docs, not research) live in `docs/agent-workflow/`, one file per procedure, plain names. Read the one you need when you need it:

- `docs/agent-workflow/replica-and-build-swap.md`: leaving Aryan a replica dev build after a phase (the data copy, `--claude-resume all`, why `--open-external` is needed) and replacing his production build without a release (build in the worktree, swap after he closes afterterm)

- `docs/research-00-terminal-landscape-and-stack-validation.md` — pre-build stack/landscape research
- `docs/design-01-persistent-pty-host.md` — design for a detached PTY-host daemon so terminals survive an app update (not yet built)
- `docs/design-02-projects-and-threads.md` — the projects-and-threads redesign (Home screen, pinned projects, named threads, sleep/wake, history); agreed 2026-09-06 against `docs/mockups/afterterm-next.html`. Execution plan in `PHASES.md` at the repo root.
- `docs/design-03-sidebar-and-attention.md`: the always-on rail, the Pinned and Recent panel, needs-you until answered, mark as unread, project icons, in-place search, the keyboard cycle; agreed 2026-09-19 against `docs/mockups/design-03-final-sidebar.html`. Phases 7 and 8 in `PHASES.md`.
- `docs/plan-01-sidebar-attention-and-manual-testing-fixes.md`: the round of work after the projects-and-threads phases, ranked; design-03 is its Cluster 1.
- `docs/guide-01-distributable-build.md` — shrink the portable build into a ~67 MB self-extracting `.exe` for sharing (7-Zip LZMA2 + pruning)
- `docs/guide-02-releases.md` — versioning (semver) + how to cut a tagged, version-stamped release (`npm run release`)
- `docs/ideas.md` — feature ideas backlog
- `docs/bugs.md` — running list of known, unfixed bugs (distinct from the platform Known Limitations above)
- `docs/bugs-fixed.md`: every fixed bug, newest first, with the PR it landed in. A fix deletes its entry from `bugs.md`, adds one here and a line to `CHANGELOG.md`'s Fixed list, in the same change.
- `docs/note-01-duplicate-notifications-dispatcher.md` — why both the Windows popup and the overlay fired inside afterterm, and the settings.json dispatcher fix (incl. a TODO to make the self-install hook use the same approach)
- `docs/features-projects-and-threads.md`: the full record of Phases 0 to 4 (Home, projects, the project page, thread identity, sleep and wake, history, the tail), moved out of CLAUDE.md on 2026-09-20
- `docs/features-attention-and-sidebar.md`: the full record of Phases 7 and 8 (needs-you until answered, mark as unread, the aggregate, the rail, the panel, the keyboard cycle)
- `docs/features-long-output-and-fix-sweep.md`: the full record of Phase 9 and the follow-ups from Aryan's first days on the build (the asleep pane, the jump button, the Wake box, the visual fixes, the thread's own folder in Explorer, the project icon everywhere, the notifier white bar)
- `docs/features-notifications.md`: the overlay toasts, the sidebar states, the spinner and the self-installed hook
- `docs/features-terminal-interactions.md` — links, right-click, find, font zoom, drag-drop (behavior + implementation)
- `docs/features-claude-session-resume.md` — auto-resume Claude sessions on relaunch (UUID capture via hook file channel, why not the terminal channel, security)
- `docs/features-servers.md`: server detection (port, running state), open localhost, last-command capture and re-run on wake, the close confirm (Phase 5)
- `docs/features-shell-integration.md`: OSC 9;9/OSC 7 cwd reporting and OSC 133 prompt marks for pwsh, Windows PowerShell, Git Bash and WSL, the custom-prompt guarantee, the opt-out, and the MSYS process-tree fix (Phase 6)

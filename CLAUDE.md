# afterterm

A simple terminal emulator for Windows with **Chrome-style tab groups**. No existing terminal has this feature.

## Stack

- **Electron** (desktop runtime)
- **@xterm/xterm v6** + **@xterm/addon-webgl** (terminal renderer)
- **@xterm/addon-web-links** + **@xterm/addon-search** (clickable links, find-in-scrollback) — pinned to stable 0.12.x / 0.16.x; **don't** bump to the v6 betas (peer `^6.1.0-beta` → ERESOLVE). See `docs/features-terminal-interactions.md`.
- **node-pty** (PTY / shell spawning via ConPTY)
- **React 19** (UI)
- The sidebar's drag and drop is the app's own (`components/SidePanel/usePanelDrag.ts`); @dnd-kit was removed on 2026-11-01

## What it is

Projects and threads, not tabs. A project is a folder with a name, a colour, an icon and a default shell. Inside it are threads: chats (a terminal running Claude Code, named after its conversation, showing its model, branch and worktree) and shells. The app opens on a Home screen of pinned and recent projects; a rail on the left shows only the projects with something waiting for you. Every thread restored from a previous launch starts asleep, showing its last output, and wakes only when asked (a chat resumes its Claude Code session). Servers are detected by port, every shell reports its folder, and Claude Code's notifications arrive as toasts in an always-on-top overlay.

`CHANGELOG.md` says what changed for the user, release by release. Open bugs and requests are issues in Linear (next section). `PHASES.md` holds the rounds of work and the ideas not yet placed. The projects-and-threads round (Phases 0 to 9, released as 0.9.0 on 2026-09-30) is recorded, with every decision and its date, in `docs/phases-01-projects-and-threads.md`.

## All work is tracked in Linear

Every piece of work on afterterm has an issue in Linear, so Aryan can see what is happening without asking an agent. This is a trial that started on 2026-11-07; these rules stand until he decides otherwise.

The issues are in workspace "afteraryan builds", team `Afteraryan builds` (key AFT), [project afterterm](https://linear.app/afteraryan-builds/project/afterterm-d9321a4ce47e). The tools are `mcp__plugin_productivity_linear__*`. If they do not load, tell Aryan before starting: do not work untracked.

**The rules, for every agent, however the work started:**

1. **Before changing anything, find or create the issue.** Search with `list_issues`. If nothing matches, create one with `save_issue`: any bug, feature, refactor, docs change or build. Only a question that changes nothing needs no issue. Separate pieces of work get separate issues, and a round split into phases gets one issue per phase.
2. **When you start, move it to In Progress before any other work.** Then comment with what you are about to do, the worktree, the branch and the session id (`$CLAUDE_CODE_SESSION_ID`, so a closed thread can be resumed).
3. **While you work, keep it true.** Add a comment of a sentence or two at each new stage: cause found, plan agreed, PR opened, self-test passed. Change the status the moment it stops being true; do not leave it all for the end.
4. **If you are blocked on Aryan,** move it to Needs your decision and put the question in a comment.
5. **If you stop before it is finished** (paused, handed off, session ending), comment where it stands and what is next. If nobody will carry on, move it back to Todo.
6. **When it ships, move it to Done.** Shipped means its PR is merged after the self-test, or the change is made when there is no PR. Comment with what changed and the PR. Nobody checks it again. A PR waiting for Aryan to merge it is blocked on him (rule 4), with the PR in the comment. Only when something needs his own judgement (how it looks, his own hardware or accounts), move it to Fixed, check it instead, with numbered steps to check it. He is never asked to try half-built work. Work that is dropped goes to Canceled, with the reason.
7. **A problem found after Done is a new issue,** linked to the old one with `relatedTo`. If Aryan says something in Fixed, check it does not work, move it back to Todo with his words in a comment.
8. **One session per issue.** In Progress with a recent comment means someone is on it: ask before taking it. A subagent gets the issue id in its prompt; the session that started the work keeps the issue current.

| Status | What it means |
|---|---|
| Backlog | Not ready: it waits for a reproduction, or Aryan put it off |
| Needs your decision | Nobody can start until Aryan decides or designs something |
| Todo | Ready to start |
| In Progress | An agent is working on it now |
| Fixed, check it | Finished, but waiting for something only Aryan can judge (rare) |
| Done | Shipped: merged after the self-test |
| Canceled, Duplicate | Not being done |

**A new issue has:** project `afterterm`; a short, plain title; priority 2 (something lost or broken), 3 (a feature misbehaves) or 4 (cosmetic or a request); a `Bug` or `Feature` label; and one label from the Area group: Sidebar, Rail, Terminal, File links, Thread states, Threads, Projects, Install and updates, Notifications, Home, Sleep and restore, App window, Agent workflow. If none fits, add one to the group and tell Aryan.

**Two commands:** `/bug-record` logs a bug Aryan reports. `/fix-tasks AFT-27 AFT-34` works on the issues named, in one thread.

**How a PR is named.** Linear is connected to the GitHub repo, so a PR moves its issues by itself. This was tested on 2026-11-07 with PRs #76 to #78:
- **An issue id in the PR title or branch name** links the PR to the issue. Opening the PR moves the issue to In Progress, and merging it moves the issue to Done. This happens when it merges into any branch, not only `main`.
- **Put the ids of every issue the PR finishes in its title,** for example `AFT-27, AFT-34: Fix the rail order`.
- **A PR that does only part of an issue** keeps the id out of its title and branch name. Its description says `Part of AFT-27` instead, which links it without closing the issue.
- **Commit messages are not read.** Commits need nothing special.

**What changes during the trial:** `docs/bugs.md`, `docs/bugs-fixed.md` and `docs/to-verify.md` get no new entries, and they stay in the repo so going back stays easy. A bug's screenshots go on its issue, not in `docs/screenshots/manual-testing/`. Test captures and recordings still go in `docs/screenshots/<phase>/`, and `CHANGELOG.md` still gets its line.

## Architecture

- node-pty lives in the **Electron main process** (holds ConPTY handles, spawns shells)
- xterm.js lives in the **renderer process** (display + keyboard input)
- Communication via Electron IPC with **16ms chunk batching** (prevents lag under burst output)
- Hidden tabs use `display: none` to avoid rendering overhead
- Shell profiles detected at startup (cmd.exe, pwsh.exe, powershell.exe, Git Bash, WSL)
- Session state auto-saved to `%APPDATA%\afterterm\session.json` (2s debounce after changes)
- A second always-on-top **notifier overlay window** renders toasts above all apps (see Notification System)
- **One running copy per data folder** (`app.requestSingleInstanceLock`, keyed to userData): a second launch focuses the open window and exits; harness runs and the "afterterm (test)" build have their own folders, so they still run beside the real app
- `AFTERTERM=1` is set on every spawned PTY's env so the Claude Code hook knows to route notifications to the in-app overlay instead of a Windows popup

## File Structure

```
src/
  main.ts                              ← Electron main: PTY IPC, session persistence, shortcuts, notifier window/IPC, Claude-hook install and the repair poll (startHookRepairPoll: a stat of the Claude folder's settings.json every 3s, puts missing entries back), tail files, server watcher, planSpawn, killTree, the Claude session record reader (every 2s while a PTY is alive, claude-record:status and claude-record:refresh; the same pass sends each shell's hasChildren on pty:children), pushClaudeSession (one path for a session id from the hook or the record), the application menu (appMenuTemplate, set before the windows) and logMenuKeys (harness only: `[harness] menu key` lines).
  app-menu.ts                          ← AFT-26: appMenuTemplate, Electron's default Windows menu without Reload and Force Reload (no key reloads the window), menuRoles, hasReload, RELOAD_ROLES. Pure, unit-tested. Test file: app-menu.test.ts
  claude-hook-install.ts               ← reconcileClaudeHook() and hookReconcileAllowed() (false for a test launch with no CLAUDE_CONFIG_DIR): installs the notifier hook into ~/.claude (or CLAUDE_CONFIG_DIR) with -ExecutionPolicy Bypass, rewrites 0.9.x entries that lack it, 'command' mode when the setup check finds -File blocked (idempotent, prefs.json opt-out, which removes only afterterm's own hook and keeps another tool's hook in the same group); needsHookRepair() and hookRepairWait() for main's settings.json poll that puts missing entries back while the app runs. Pure Node, unit-tested.
  setup-check.ts                       ← The Claude Code setup check: runs the registered hook as Claude Code would, falls back to the script's text, reads policy/settings facts, builds the anonymised report, failureNote and the GitHub issue URL. Run by `afterterm.exe --setup-check=<file>` (the installer). Unit-tested. Test file: setup-check.test.ts
  update-check.ts                      ← Automatic updates, the pure part: versions, parseRelease (the asset, the sha256 digest), downloadSource, isSuppressed (Later, Skip), UpdateState, the restart window's rules (isMidTurn from Claude Code's record then the notification, hasBackgroundTask from the record's shell, the ⏳ badge or the Tab.backgroundTasks flag, shellBusy from the prompt marks then the process tree, restartRows with Background task stops, Command stops and unknown rows, restartStatus: Safe to restart only when nothing warns and nothing is unknown, "1 chat stops mid-turn" / "2 chats stop mid-turn" when only chats mid-turn warn, "1 thread is busy" / "2 threads are busy" for any other warning, no line when nothing warns but something is unknown), asPendingUpdate/updateLanded, staleDownloads, parseNotes (release notes to headings, bullets, bold, links). Unit-tested. Test file: update-check.test.ts
  updater.ts                           ← Automatic updates in main: initUpdater (which copy is installed, the 10s/6h timer, the GitHub or test-feed fetch, the download with progress and its hash, Setup's update mode started before quitting, pendingUpdate, the update:* IPC)
  editors.ts                           ← Editor product detection and info (product name from exe, list of installs)
  editor-detect.ts                     ← Finds primary/alternate editors via prefs, code command, install folders, registry. Unit-tested. Test file: editor-detect.test.ts
  claude-transcript.ts                 ← Reads a Claude transcript: first prompt, latest model, modelDisplayName, latestCwd, findTranscript. Unit-tested. Test file: claude-transcript.test.ts
  claude-session-record.ts             ← Claude Code's own record per running claude.exe (<Claude folder>\sessions\<pid>.json): isRecordFileName (never the .key files, pids a multiple of 4), parseSessionRecord, holdLastGood, procStartReadings, pidLooksAlive, matchRecordsToThreads, recordFeed, threadFeeds, unlistedRunningPids, staleListPids, listRefreshPlan, CLAUDE_CWD_RE, RECORD_MAX_BYTES. Pure, unit-tested. Test file: claude-session-record.test.ts
  session-files.ts                     ← Edited files: parses transcript lines into changed files, edit events, pasted images and command windows (isBulkCommand), and every web link in them for AFT-61 (state.urls, cleanUrl, transcriptUrls, MAX_URLS; a copy ending in "…" is never kept); fileKind, isSafeForDefaultApp (the list of what may reach Windows' default app), normalizePath, pathKey, isInside, mergeChanged, sessionFilesView, ownsTempFile. Pure, unit-tested. Test file: session-files.test.ts
  session-files-store.ts               ← Incremental transcript reader for main: a byte offset per file (the session and its subagents), chunked with yields, pastedBytes. Unit-tested. Test file: session-files-store.test.ts
  file-index.ts                        ← File links' last resort: buildNameIndex (a folder's files by name, skipping what the folder watch skips, capped) and findByName. Unit-tested. Test file: file-index.test.ts
  command-files.ts                     ← Edited files Phase 2: isIgnoredChange, attributeCommandChanges (a folder change counts only inside one of the chat's command windows), pruneChanges, mergeSaved. Pure, unit-tested. Test file: command-files.test.ts
  git-info.ts                          ← Branch, worktree and the working tree's top (`top`, which file links try paths from) from .git/HEAD or a worktree's .git file, no git spawned. Unit-tested. Test file: git-info.test.ts
  thread-tail.ts                       ← Scrollback tail a thread leaves behind: TAIL_MAX_LINES, TAIL_MAX_BYTES, isThreadId, tailFilePath, trimTail, serializeTail, parseTail. Unit-tested. Test file: thread-tail.test.ts
  server-detect.ts                     ← Pure port-listener detection: parseNetstatListeners, parseProcessList, descendantPids, shellHasChildren (whether a shell has a process below it; Git Bash counts two levels down, WSL is null), portForTree, tabPorts, parseMsysPs, applyMsysParents. Unit-tested. Test file: server-detect.test.ts
  shell-integration.ts                 ← planSpawn: pure spawn planner per shell; integrationEnabled (opt-out); PWSH_BOOTSTRAP, BASH_HOOK, appendWslEnv; CMD_MARK_START/CMD_MARK_END with wrapCmdPrompt and stripCmdPromptMarks, stripBashHook, withoutInheritedIntegration (the inherited env with afterterm's own marks taken out). Unit-tested. Test file: shell-integration.test.ts
  shell-paths.ts                       ← Path translation Windows/WSL/Git Bash: parseOsc7, osc7ToWindowsPath, isWslUncPath, wslUncToLinux, windowsPathToWsl, isWindowsDrivePath. Unit-tested. Test file: shell-paths.test.ts
  preload.ts                           ← contextBridge: PTY API (onPort, onChildren), session API, shell list, shortcuts, notify APIs, shell.openExternal, projects, editors, claudeSession, claudeRecord (the record's status and its fresh read), git, threads, update API
  prefs.ts                             ← readPrefs/updatePrefs: manages %APPDATA%/afterterm/prefs.json (claudeNotifications, lastOpenedAt, editorPath, shellIntegration, updateChecks, updateSkippedVersion, updateLaterUntil, updateLastChecked, pendingUpdate, windowBounds, windowDisplayId, windowDisplayBounds, windowMaximized, toastsWaitForFullScreen: false turns the toast hold off)
  window-placement.ts                  ← The main window's home (AFT-15), the pure part: homeFromPrefs/homeToPrefs, findHomeDisplay (id and bounds, then bounds, then id), reachable, placeOn (moved and sized to fit the work area), startupPlacement, countsAsDisplayChange (display added, removed or changed, sleep, wake; not lock or unlock), isWindowsMove (a move within SETTLE_MS of a display change is Windows'), moveBack (back on its display when it returns), landsOn (the harness guard). Unit-tested. Test file: window-placement.test.ts
  notify-hold.ts                       ← The toast hold (AFT-72), the pure part: NotifyState (SHQueryUserNotificationState by name, plus window-fullscreen and afterterm-in-front), holdsToasts (busy, Direct3D full screen, presentation, a foreground window covering its monitor; everything else shows), parseProbeLine (the helper's `quns=<n> fg=<1|0|own>`; with fg=own, busy and Direct3D do not hold), stateWord (the AFTERTERM_NOTIFY_STATE words), HOLD_POLL_MS (3s), holdStep (main's overlay state on push, answer, poll, emptied). Unit-tested. Test file: notify-hold.test.ts
  notify-state-probe.ts                ← NotifyStateProbe: a Windows PowerShell helper that stays while toasts are up and answers two signals per question, SHQueryUserNotificationState (primary display only) and whether the foreground window covers its whole monitor (any monitor; fg=own for afterterm's own windows; not the desktop, taskbars, Task View or a maximized window with a title bar or resizing frame); about 0.5 to 0.75s to start, a few ms after, gone 15s after the last question; a toast waits at most 4s for a starting helper, which is let finish up to 10s; every failure answers unknown, and three in a row rest it 5 minutes. Unit-tested with a fake helper. Test file: notify-state-probe.test.ts
  afterterm.d.ts                       ← Window.afterterm type declarations: projects, editors, pty API, notify/notifier, shell, files, claudeSession, claudeRecord, git, threads, update APIs
  renderer/
    index.tsx                          ← React root; routes to NotifierApp when ?notifier=1, else App
    app.tsx                            ← Screen state, session restore, shortcut dispatch, notification fan-out, wakeThread/resumeThread, closeThread/sleepThread (confirm-gated), openLocalhost, Rail mount, togglePanel, cycleThread, awakeThreads (the restart window's rows, from each thread's record status, notification, prompt state and process tree), the record status handler (spinner), harness hooks.
    index.css                          ← App layout (title bar, sidebar, main pane), screen-entry animations, terminal card, find bar.
    theme.css                          ← Palette tokens, bundled Inter, shared classes, keyframes, reduced motion, Home and project-page entrance animations
    jumpScroll.ts                      ← Pure: jump button show/hide rule. JumpTarget, JumpState, JUMP_THRESHOLD_LINES/PX, initialJumpState, onScrollSample, JUMP_IDLE_MS, jumpHoldOnMove. No xterm/DOM. Unit-tested. Test file: jumpScroll.test.ts
    panelWidth.ts                      ← The side panel's width (AFT-30): PANEL_DEFAULT_WIDTH 264, the 180 minimum, half the window as the maximum, clampPanelWidth, widthAfterDrag, asPanelWidth (a saved width, dropped when not believable), savedUi (what the panel writes into `ui`). Pure, unit-tested. Test file: panelWidth.test.ts
    sessionMigration.ts                ← session.json shape: migrateSession, serializeSession, setUnreadFlag, asUi (ui.panelHidden and ui.panelWidth), Group.icon validated, port validated 1-65535, version 3 (the order of `groups` is the panel's project order; legacyProjectOrder reorders a version 2 file once). Pure, unit-tested.
    sidebarWalk.ts                     ← computeSegments: sidebar rows built from groups first, so a group with zero tabs renders. Pure, unit-tested.
    threadView.ts                      ← Pure: thread kind/state/title, statusText (hover card Status row), threadFolderTarget, insertNewThread, placeThread (a thread drop), projectCounts/pillCounts (spinner and play pills apart), projectLookChanges, applyProjectLook, threadName, model label, foldThreads, counter pills, kindWord, runningLabel, needsCloseConfirm, needsSleepConfirm, sleepConfirmText (from the thread's wakePlan: Wake resumes the chat, runs the command again, or opens a fresh prompt), threadState, projectCounts, threadFolder. Unit-tested.
    attention.ts                       ← Aggregate every count reads from (waiting, working, running, finished, compacting, background): countStates/countTabs, isWaitingState, projectAttention, totalAttention, railProjects, panelLists (saved order, archived in Other, an optional hold), isRecentProject, enteringRecent and moveGroupsToTop (the panel's order rule), firstThreadToOpen. Pure, unit-tested. Test file: attention.test.ts
    panelView.ts                       ← Sidebar panel groups (General, Pinned, Recent, Other) in the saved project order: panelSections(tabs, groups, now, hold), placeProject (a project drop), filterPanel, visibleThreadIds (its fold never cuts a split apart), cycleThreadId, revealScrollTop. Unit-tested. Test file: panelView.test.ts
    splitView.ts                       ← Two threads side by side (design-06), a "split" in code: Split, panesFor, splitOf/partnerOf, paneDropTarget (Same project only, Two at most), createSplit, dissolveSplitOf, setSplitRatio, activeAfterClose, placeThreadKeepingSplits, restoreSplits, foldLimit. Keeps a split's two threads next to each other, a then b. Pure, unit-tested. Test file: splitView.test.ts
    spinnerState.ts                    ← Pure decision logic for the spinner, needs-you, background and compacting: onTitle, onOutput, onTick (holds working through silence while Claude Code's record says busy; ends compacting after COMPACT_SILENCE_CLEAR_MS of silence), onRecordStatus (a busy record starts working from quiet, never over done, needs-you, compacting or background; idle or shell ends compacting), backgroundAfterTitle (a ⏳ title sets Tab.backgroundTasks, only a ✅ clears it, ▶, ⚠ and ⚙ and viewing never do), backgroundAfterRecord (the thread's Claude going away clears it), backgroundAfterPrompt (so does the shell's own prompt coming back), withBackground (a quiet thread with that flag shows background, viewed or not), clearsWhenSeen (done only), onInterrupt (Esc also ends compacting), onAnswer (a needs-you that came over background with no main turn open, a background agent's prompt, answers back to background), TabTiming. Unit-tested. Test file: spinnerState.test.ts
    commandMarks.ts                    ← Pure: OSC 133 prompt marks (A/B/C/D): parseOsc133, onMark, onEnter, onInput (a chunk with a CR outside a bracketed paste, a paste ending in a newline, leaves the prompt), onCommandSent (a command afterterm types itself on wake), cleanCommand; its atPrompt reaches the tab as Tab.atPrompt through Terminal's onPromptState. No xterm/DOM. Unit-tested. Test file: commandMarks.test.ts
    homeView.ts                        ← Pure: Home screen logic (date heading, pills, pinned cards, projects by activity with archived ones among them, lastHereLine). Unit-tested. Test file: homeView.test.ts
    chatTitle.ts                       ← Claude Code's and the notify hook's title glyphs: claudeSummaryTitle, isHookTitle. Pure, unit-tested. Test file: chatTitle.test.ts
    chooserView.ts                     ← Pure: new-thread chooser project and shell options, sorting and filtering. Unit-tested. Test file: chooserView.test.ts
    paletteView.ts                     ← Pure: search palette projects and threads, and now history entries by title with their own rank and cap. Unit-tested. Test file: paletteView.test.ts
    filesView.ts                       ← Pure: the Files button's label and list (docs, code, pasted), folder labels relative to the chat then the project, short times. Unit-tested. Test file: filesView.test.ts
    filePaths.ts                       ← Pure: file paths in terminal text: findPathCandidates, resolveCandidates, matchChangedName, continuation, spacedVariants and wrappedAtSpace (a path with spaces, joined across them and across lines), elidedTail, openKind, findImageTags, wrappedImageTag, pastedForTag. Unit-tested. Test file: filePaths.test.ts
    webLinks.ts                        ← Pure (AFT-61): web links cut over several rows. resolveLinks reads one from a chat's transcript (linkFromTranscript, followUrl, a "…"-shortened line matches as shortened) or joins it at the column it was cut at (linkFromColumns, cutWidths: full width, 1 and 5 short in a chat, full width in a shell); linkStarts, linkPrefixes, MAX_LINK_ROWS. Unit-tested. Test file: webLinks.test.ts
    sleepWake.ts                       ← Pure: sleepTab (clears recordStatus, atPrompt, hasChildren, backgroundTasks), wakeTab, restoredTab, sleepAllForShutdown, asleepLabel, asleepSinceText, wakePlan (a valid session id wins over the server rule: it resumes and re-runs nothing; a last command that starts Claude Code, startsClaudeCode: `claude`, `claude.exe` or `claude.cmd` alone or at the end of a path, `@anthropic-ai/claude-code`, any of them after `npx`, is never re-run as a server). Unit-tested. Test file: sleepWake.test.ts
    history.ts                         ← Pure: historyEntryFor, appendHistory (HISTORY_MAX 100), removeHistoryEntry, isResumable, tabFromHistory, maxNumericId. Unit-tested. Test file: history.test.ts
    projectColour.ts                   ← A project's colour, a set name or any #rrggbb: groupColors (everything draws through it), the wheel's arithmetic, readHexInput. Pure, unit-tested. Test file: projectColour.test.ts
    threadMenu.tsx                     ← Two thread menus over shared items, no Open item in either: buildThreadMenu (sidebar right-click, project page rows) and buildHeaderMenu (header dots, no editor entries). Sleep/Wake, Mark as unread/read, Move to project, Open localhost:port, Open project page, Open in File Explorer, Open in <editor>, Rename, Close.
    projectMenu.tsx                    ← buildProjectMenu: Open, New thread here, Pin/Unpin, Open project page, Open in File Explorer, Open in <editor> per detected editor, Edit, Archive/Restore, Rename, Delete
    NotifierApp.tsx                    ← The floating overlay window's React root: toast cards, hide-when-empty logic, the auto-hide timer (toastExpiry.ts), notifier:on-screen from main; draws the project's chosen icon (projectIcon) in place of the folder.
    toastExpiry.ts                     ← Pure: when a toast goes on its own. TOAST_LIFETIME_MS (5s), ToastClock (onScreen: the clock runs only while main has the overlay on screen), syncToasts, setMainFocus, setOnScreen, setHoveredToast, expiredToasts, nextDeadline. Unit-tested. Test file: toastExpiry.test.ts
    NotifierApp.css                    ← Toast card styles (state icon in a tinted circle, thread name headline, project line with coloured folder)
    hooks/
      useTabState.ts                   ← All tab/group state, session restore, pin/archive/activity, openProject, setClaudeMeta/setGitInfo, sleepTab/wakeTab/closeTab, resumeFromHistory, restoreSession, setPort/setLastCommand/setUnread, setClaudeRecordStatus, setAtPrompt/setHasChildren/setBackgroundTasks (transient, dropped for a sleeping thread), endBackgroundWork (the shell's prompt came back: the flag and a background state go, decided on the latest state), GroupConfig.icon.
    components/
      ScreenNav.tsx                    ← Just the Screen type ('home' | 'workspace' | 'project'); the old icon row is gone, carried by the always-on Rail. ScreenNav.css removed.
      Toast.tsx                        ← In-app toast pill (pin, archive, restore, editor errors). Styles in Toast.css
      Toast.css                        ← Toast styles (centre bottom, auto-hide)
      ThreadHoverCard.tsx               ← Sidebar thread hover card: Type (kind alone), Status (StateIcon + statusText, no sleep age, absent when quiet), project, model, branch, worktree, Last ran, Last used, shown 350ms after hover.
      ThreadHoverCard.css               ← Hover card styles
      Rail/
        index.tsx                      ← Always-on rail, 76px at the left edge: the one sidebar toggle (always first, fixed place; opens the workspace from Home), Search/New thread rows, Home/Workspace pill, one tile per railProjects, click opens firstThreadToOpen, right-click the project menu.
        Rail.css                       ← Rail styles: the two closable blocks, the Home/Workspace pill's sliding thumb, the tile and badge column.
      SidePanel/
        index.tsx                      ← The panel (no toggle row of its own, the toggle is on the rail): Search box, General/Pinned/Recent (panelView.ts), docked Other projects row (its drawer closes on the release of a click outside it, on Esc and when the window loses focus), thread rows with close x and port pill, five-row fold, the dragged card, the slides (flip on a drop, a project or thread entering, Archive's fold, the moon swap), hover card, SidePanelHandle (revealProject scrolls a just-opened project into view and highlights it; foldOut folds a project out for Archive).
        usePanelDrag.ts                ← The panel's drag and drop (docs/mockups/sidebar-drag-and-drop.html): 7px start, targets from offsetTop, the drop line, edge and wheel scrolling, the card's from-and-to, Esc and float-back.
        usePanelResize.ts              ← Resizing the panel by its right edge (AFT-30): a press on the strip (.panel-resizer) writes --sidebar straight to the panel while held, body.panel-resizing holds the terminals' refit, one commit and one refit on release (a window blur ends the drag the same way), a double-click goes back to the default. Never fights usePanelDrag: the strip is outside the panel's rows.
        SidePanel.css                  ← Panel styles (.side-panel slides to zero when hidden, its width is the CSS variable --sidebar), the resize strip (.panel-resizer), breath keyframes, Pinned line, collapse-all buttons, Search box (.srch), the dock (.dock/.dlist/.drow).
        SidePanelMotion.css            ← The order and drag motion: project blocks entering and folding out, threads entering and going to sleep, the drawer's pop and count bump, the line, the card.
      Header/
        index.tsx                      ← Main pane header: kind icon, name, project/model/branch/worktree line, state chip, editor button (primary editor's logo, opens threadFolderTarget's folder), dots menu (Sleep or Wake, Open localhost:port); worktree opens the folder in Explorer; line 2 stays one row.
        Header.css                     ← Header styles (.header-meta values in --text2, .header-meta-link for the worktree button).
      AsleepPane/
        index.tsx                      ← Pane shown while the active thread is asleep: autofocused Wake button, asleepSinceText (naming only the command wakePlan will run), the saved dimmed tail, .asleep-scroll, a JumpButton fed by onScrollSample.
        AsleepPane.css                 ← Pane styles: fills the terminal card's area so swapping never shifts header/sidebar; .asleep-scroll; sticky .wakebox is a bordered button over the tail.
      TitleBar/
        index.tsx                      ← The 32px title bar strip: name, the version button (opens the About window), the update button (Update available, Downloading 47%, Restart to update) and its notice (portal, What's new folding open, Update, Later, Skip this version); the OS caption buttons on the right; the window's drag region
        TitleBar.css                     ← Strip styles (sidebar grey), .up-btn and the notice (.up-pop, .up-notice)
      AboutWindow/
        index.tsx                      ← The About window: logo, version, one update row that keeps one height in every state, What's new sliding open under it, the automatic-checks switch, afterterm on GitHub, Close. AboutWindow.css.
      RestartToUpdate/
        index.tsx                      ← "Restart afterterm to update?": one row per awake thread (restartRows, data-outcome, data-unknown), the status line (none when afterterm cannot tell; data-status safe, warn or none on the footer), Not now and Restart now. RestartToUpdate.css.
      UpdatedPill/
        index.tsx                      ← "Updated to 0.11.0" after an update restart: What's new, the round x on the pill's corner, gone after 6s (held under the pointer). UpdatedPill.css.
      UpdateDialog/
        index.tsx                      ← The frame the update windows share (modal-overlay, the .up-dlg card, the 170ms fade-and-sink close) and WhatsNewDialog. UpdateDialog.css.
      UpdateNotes/
        index.tsx                      ← Release notes from parseNotes as elements (never HTML), links through shell.openExternal; hasNotes. UpdateNotes.css also holds the shared .up-bar.
      Home/
        index.tsx                      ← Home screen render, date heading, totals, last-here line, pinned cards, projects list (archived ones included), Show more toggle
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
      RenameDialog/
        index.tsx                      ← The one Rename dialog, for a thread (the thread menus) and a project (the project menu): heading, one field, Cancel and Save. RenameDialog.css holds its width.
      ArchiveDialog/
        index.tsx                      ← "Archive <project>?" in the Restart to update window's frame (UpdateDialog): the awake threads with their status (statusText), "These threads will go to sleep", Cancel and Archive. app.tsx's archiveNow runs the sequence after it.
        ArchiveDialog.css              ← Its width, heading and status colours, on top of RestartToUpdate.css's up-tlist and up-dfoot
      GroupModal/
        index.tsx                      ← New/Edit project dialog: the large icon (live preview, opens the colours and icons in one pop-up) beside name, one-line folder and shell dropdown rows, open-terminal-now beside the buttons.
        ColourWheel.tsx                ← The colour wheel in that pop-up: wheel, brightness bar, colour code field typed live.
        GroupModal.css                 ← Modal overlay + form styles, the icon swatch grid
      JumpButton/
        index.tsx                      ← Flipping jump button: 32px chevron centred in its scroller; mousedown prevented so it never steals focus; wheel passes through via onWheel; hides JUMP_IDLE_MS after the host's last poke() unless the pointer moved onto it after the scroll paused.
        JumpButton.css                 ← Button styles: centred, scale-only enter and exit on --med, visibility flipped after the exit; off under reduced motion through theme.css's global rule
      Terminal/
        index.tsx                      ← The main pane: one column per thread on screen (panes; two for a split), each with its header (renderHeader) and card; xterm containers moved between a park and each column's slot; the divider (refit on release only); drop zones. Plus xterm.js lifecycle, PTY wiring, title intelligence, OSC 9;9/OSC 7 cwd capture, clipboard/links/find bar/font zoom/drag-drop, teardownTerminal/createTerminal, the OSC 133 handler (reports atPrompt upward through onPromptState on the first mark and on every change; writeCommand tells the marks about a command afterterm types itself), pendingDestroyRef/creatingRef, the find bar (one search addon per terminal, replaced by endSearch when a search ends so it never overwrites a mouse selection, AFT-44), harness hooks (fileLinks, webLinks, openFileLink, findRow, selection), JumpButton wiring, the file-link provider and, before the web-links addon, the web-link provider (AFT-61).
        fileLinks.ts                   ← Edited files Phase 3: the xterm link provider for file paths (buffer cells to text, batched files:stat with a cache, tool-line time markers, the hover note, [Image #N] tags, linkAt for the right-click menu). fileLinks.css styles the note. Exports readLine and span for webLinks.ts.
        fileLinks.ts                   ← Edited files Phase 3: the xterm link provider for file paths (buffer cells to text, batched files:stat with a cache, tool-line time markers, the hover note, [Image #N] tags, linkAt for the right-click menu). fileLinks.css styles the note. Exports readLine and span for webLinks.ts.
      FilesButton/
        index.tsx                      ← Edited files: the header's Files button and its list (Documents, the Code and pasted folds, thumbnails, right-click menu with the editor logo and Explorer icon, Esc and outside click). FilesButton.css holds the prototype's look and motion.
      Icons.tsx                        ← SVG icons: FolderIcon, StateIcon, KindIcon, Spinner, ProjectIcon (ten glyphs), IconCollapseAll/IconExpandAll, IconCompact, IconFiles/IconDoc/IconCode/IconImage/IconFoldChev, IconDownload/IconRestart/AppLogo (updates).
      Menu.tsx                         ← Positioned menu with submenu and back chevron
      Menu.css                         ← Menu styles
      Tooltip.tsx                      ← The app tooltip; any element with data-tip. data-tip-side="right" shows the tip beside the element for ones at the window edge.
      TabBar/
        types.ts                       ← Tab (model, branch, worktree, claudeTitle, asleep, port, lastCommand, unread; transient, never saved: recordStatus, atPrompt, hasChildren, backgroundTasks), Group (history, icon), HistoryEntry, GroupColor, PROJECT_ICON_IDS, isProjectIconId.
assets/
  fonts/
    Inter Regular and Medium woff2     ← Bundled in assets/fonts, loaded by theme.css; LICENSE-Inter.txt
  hooks/
    afterterm-notify.ps1               ← bundled, distributable Claude Code hook (no-op unless AFTERTERM=1); copied into ~/.claude/hooks on first run
    test-afterterm-notify.ps1          ← standalone test harness for the hook (30 cases)
forge.config.ts                        ← ASAR unpack, rebuild skip, Vite plugin config (extraResource: ['assets'] bundles the hook)
installer/
  electron-builder.cjs                 ← The NSIS engine's settings (one-click, per-user, --prepackaged around Forge's folder); AFTERTERM_INSTALLER_SANDBOX=1 for "afterterm (test)"
  installer.nsh                        ← NSIS hooks: Start menu opt-out, a running-app check that asks instead of killing
  setup/Setup.cs, Setup.xaml           ← afterterm Setup, the WPF screens (welcome, installing, Claude Code check, report issue, ready); runs the engine silently. `--update --wait-pid <pid>` is the quiet update mode (PageUpdate): a small progress window, same folder and shortcuts, reopens afterterm
  setup/app.manifest                   ← asInvoker, per-monitor DPI
scripts/
  build-installer.js                   ← `npm run installer` (and `release`): package, stage and prune, build the engine, compile Setup with Windows' csc.exe, the engine embedded; --sandbox, --skip-package
  generate-icons.js                    ← The logo as anti-aliased signed distance fields: icon.ico, icon-dev.ico, icon-256.png
  update-build.mjs                     ← The one command for switching Aryan's production build: reads the awake threads, closes afterterm, swaps out\afterterm-win32-x64 for the newest worktree build, restarts through WMI, wakes those threads over CDP. Refuses to run from inside afterterm. Procedure in docs/agent-workflow/replica-and-build-swap.md.
  agent-harness/
    README.md                          ← how an agent launches, drives, screenshots and stops the dev build (safety rules included)
    launch.mjs                         ← Seeds a throwaway AFTERTERM_USER_DATA_DIR, starts the dev build with CDP on; --prefs seeds prefs.json; --env sets env vars; --open-external allows real launches.
    watch-jump.mjs                     ← Clicks the jump button and samples window.__afterterm.viewport() every 50ms, to see a terminal jump animate.
    drive.mjs                          ← CDP client: targets, bounds, screenshot, eval, dom, click, rightclick, cell, hover, unhover, drag, emulate-media, type, key, sidebar, rail, dock, search, screen, home, project, chooser, palette, header, hover-card, pane, tail, confirm, opened, toasts, marks, counts, reload, window, scroll, jump, pane-scroll, record.
    record.mjs                         ← records the page over CDP screencast into an mp4 through ffmpeg; drive record start/stop
    restart-window-tests/              ← The scripts the 2026-11-07 restart window and hook tests ran (seed a scratch Claude folder, stall one claude.exe, watch the session records, hooks on and off, launch one packaged exe and report what it touched). Copy the folder to a scratch folder first; sess-watch.ps1, guarded-driving-example.ps1 and make-settings.mjs touch the real Claude folder by design. See docs/plan-02-restart-window-and-hook-fixes.md.
    update-feed.mjs                    ← Writes a test feed (GitHub's release shape, a local installer, --bad-digest) for AFTERTERM_UPDATE_FEED
    stop.mjs                           ← kills exactly the recorded process tree, never by name
    screenshot-display.ps1             ← OS-level capture of one whole display (shows title bar and notifier toasts)
    lib.mjs                            ← shared: run records, process tree walk, WMI spawn, display and window queries, CDP client
```

## How the app works today

One paragraph per area. The detailed record of each (what was built, when, why, what was tried and rejected, and how it was verified) is in the `docs/features-*.md` file named at the end of each paragraph; read that before changing the area.

**Home, projects, the project page.** The app always opens on Home: the date, a quiet "Last here 2d ago" line when the previous launch was over an hour ago (an experiment Aryan has not decided on; do not ask, do not extend), counter pills, pinned project cards, the other projects by recent activity (archived ones among them since 2026-11-01, when the Archived section went away). Pin and archive are explicit actions only. Opening a project lands on the thread last worked in (`lastWorkedThread` in `attention.ts`) or a new thread when it has none. The New/Edit project dialog collects name, folder, colour, icon and shell; a project with no threads is still a row. With no project at all (`hasNoProjects`), Home shows one large "Create your first project" button instead of its Pinned and Projects lists. Nothing is spawned on a fresh profile, and closing the last thread goes to Home (until 0.10.0 an empty session got a General thread); the workspace with no thread shows a New thread button. The project page has Open, New thread, Pin, Edit, Archive or Restore, Open in File Explorer and Open in <editor> (`editor-detect.ts`, `prefs.json`'s `editorPath`), and Live, Asleep and History tabs. The new thread chooser (Ctrl+Shift+T) and the search palette (Ctrl+Shift+P) are overlays with pure logic in `chooserView.ts` and `paletteView.ts`. `docs/features-projects-and-threads.md`.

**Thread identity.** A name given with Rename in a thread menu (`Tab.customName`, persisted and carried through history) comes first on any thread and stays until Rename is saved empty, even over a later `/rename` in Claude Code. Otherwise a chat's name is, in order, the `claudeTitle` the hook captured, the Claude summary in the raw title (`chatTitle.ts` knows Claude Code's title glyphs), the transcript's first prompt, then the live title; a shell reads its live title, except a server, which is named by its last command. The transcript reader (`claude-transcript.ts`) reads a head and a tail of `~/.claude/projects/<dir>/<sessionId>.jsonl` for the first prompt, the latest model and the newest `cwd`, and finds the file by session id across project dirs when a session moved worktree. Branch and worktree come from `git-info.ts` (reads `.git/HEAD` and worktree files, never runs git) on `threadFolder(tab)` (`claudeCwd` over `cwd`), refreshed on restore, on a cwd change, on capture and on a 30s poll. The header's project and worktree items open their folders in Explorer, and the header's editor button (beside the dots) opens the thread's folder in the primary editor. The rule for every folder action: one reached from a project (project menu, project page, the header's project item) opens the project root; one reached from a thread (thread menu, the header's worktree item and editor button) opens the top of the git working tree the thread's folder is in, never a folder above the project (`threadFolderTarget`, given the `top` that `git-info.ts` reads and the project's folder; since 2026-11-08, so a chat whose Claude session moved into a subfolder still opens its worktree), or the thread's own folder when it is in no git tree. `docs/features-projects-and-threads.md`, `docs/features-long-output-and-fix-sweep.md`.

**Sleep, wake, history, the tail.** `Tab.asleep` is the truth and `Terminal/index.tsx`'s reconcile effect makes reality match it: an asleep thread has no xterm and no PTY. Sleeping captures the last `TAIL_MAX_LINES` of the buffer to `%APPDATA%\afterterm\threads\<id>.txt` (`thread-tail.ts`), kills the process tree and disposes the xterm; waking spawns fresh in `wakePlan`'s folder, then types `claude --resume <id>` for a chat or re-runs the last command for a server. Nothing is replayed into the terminal on wake (dropped 2026-09-19); the tail is shown on the asleep pane only. Every restored thread starts asleep (`restoredTab`), so a relaunch spawns nothing. Closing a project thread files it in the project's history (`history.ts`), resumable if it was a chat. Sleep and Close ask first for a thread with a listening port. `docs/features-projects-and-threads.md`, `docs/features-claude-session-resume.md`.

**The asleep pane and long output.** The pane opens at its newest lines and keeps following its end through resizes until the user scrolls away; the Wake box is a white button with a thin border and the "asleep since" line in a solid pill, in the pane's colour token. One jump button per scroller (`components/JumpButton`, the rule in `jumpScroll.ts`), at the scroller's centre, shown only for scrolling the user started, pointing the way they scroll, hidden near that end and about a second after the scrolling stops (held while the pointer rests on it); a click scrolls with an eased animation; a wheel over it goes to the scroller. `docs/features-long-output-and-fix-sweep.md`.

**Attention.** `threadState` in `threadView.ts` gives every thread one state with a fixed precedence (unread, then asleep, then a notification, then running, then quiet). Needs-you persists until the thread is answered (Enter in it, `onAnswer` in `spinnerState.ts`), not until it is viewed; done clears on view; background (the hourglass) lasts while the background work runs, viewed or not, until the hook's done title, the thread's Claude going away (its record going or the shell's prompt coming back) or sleep (`withBackground`, since 2026-11-08); compacting also ends on Esc, on the record going idle, or after 5 seconds of silence, since a cancelled compaction runs no hook; a chat can be marked unread (`Tab.unread`, persisted, cleared by typing or waking). `attention.ts` is the one aggregate: per-project counts, Home's totals, the rail's project list, the panel's Pinned, Recent (3 days) and Other lists, and `firstThreadToOpen` for a rail tile click. `docs/features-attention-and-sidebar.md`.

**The rail and the panel.** The rail (`components/Rail`) is always on, on every screen: Home and Workspace, then a tile per project that has a thread waiting, working, finished or compacting, with badges beside it. The panel (`components/SidePanel`) lists General, Pinned and Recent with collapse buttons on the headings (a heading shows only over projects; the New project plus sits on Recent, else Pinned, else becomes a row under New thread), an in-place search box, a five-row fold per project that stays open while a hidden row is waiting, and a docked Other projects row (open, it closes on the release of a click anywhere outside it, on Esc and when the window loses focus; a press on the title bar does not reach the page and closes nothing while the window stays focused); it can be hidden (`ui.panelHidden`, Ctrl+Shift+B) and resized by dragging its right edge (180px to half the window, a double-click for the default 264, saved as `ui.panelWidth`; the terminals refit once on release). Ctrl+Shift+Down/Up cycle thread rows in panel order across projects; Ctrl+Tab cycles in session order. A new or resumed thread goes first in its project (`insertNewThread`), so the fold shows the newest. Opening a project from Home, the rail, the palette or the Other projects drawer scrolls the panel to it and highlights its row (`revealProject`, `revealScrollTop`). Since 2026-11-01 nothing in the panel moves because it was used: the project order is the saved order of `groups`, a project that comes into Recent goes at its top and stays there (`enteringRecent` and `moveGroupsToTop` in `attention.ts`, applied by a layout effect in `useTabState.ts`), rows that move slide, and projects and threads are dragged with the panel's own drag (`usePanelDrag.ts`; a drop into Pinned pins, a thread on or above the Pinned heading goes to General). Archive moves a project to the top of Other projects, asking first when it has awake threads (`ArchiveDialog`, `archiveNow` in `app.tsx`); opening it, waking one of its threads or Restore brings it back. The thread menus are `threadMenu.tsx` (the row menu and the header's own), the one project menu `projectMenu.tsx`. `docs/features-attention-and-sidebar.md`.

**Edited files.** A chat's header has a Files button (`components/FilesButton`) listing the documents it changed first, then its code and the images pasted into it, each folded to a count. Main reads the session's transcript and its subagents' files incrementally (`session-files-store.ts`, `session-files.ts`) on every turn and on view; files Claude changed with shell commands come from a folder watch attributed to the chat's own command windows (`command-files.ts`) and are saved per session in `<userData>\edited-files\`. File paths in the terminal are links (`Terminal/fileLinks.ts`, `filePaths.ts`), underlined only once main says they exist; since 2026-09-26 any file name with an extension links, found among the files the chat touched, then in its folders, then by name under them (`file-index.ts`, `files:find`); since 2026-09-30 a path with spaces links whole (over up to four rows), and a relative path and the name search also use the top of the chat's worktree, so both work whichever subfolder Claude has moved into; since 2026-11-06 a click opens media, pages and documents in their own app (a list of what is safe to hand to Windows, `isSafeForDefaultApp`; code and markdown stay in the editor, or Notepad with no editor, and a file afterterm opens must never run, Aryan's rule, enforced in `openWithDefaultApp`), a right-click has Open, Open file location and Copy file path, and `[Image #N]` tags are links. Everything is in `docs/edited-files/` (design, phases and status, build notes, testing); that feature's status is there, not in `PHASES.md`.

**Two threads side by side.** Drag a thread from the panel onto either half of the open terminal and the two show side by side (design-06; in code a split, `splitView.ts`, because `Group` is a project). Same project only (General counts as its own), two at most; a refused drop turns red with its reason. `activeTabId` stays the one focused half, and what is on screen is derived from it (`panesFor`), so toast suppression and done-clears-on-view already mean "the focused half". A split's two threads are kept next to each other in the tab list, so Ctrl+Tab and the panel's cycle pass through both halves. The main pane (`Terminal/index.tsx`) draws a column per thread on screen, each a whole thread view (header, Files button, asleep pane), with a divider that refits and resizes the PTYs only on release. Ungroup is in the panel row's menu only; closing a half or moving it to another project also ends the split. Splits are saved in `session.json` (`splits`) and come back asleep. The header chip, everywhere: the spinner alone while working, the play icon and `:port` for a server. `docs/features-split-groups.md`, `docs/design-06-split-groups.md`.

**Servers.** `server-detect.ts` joins `netstat -ano` with one `Win32_Process` read to find which thread's process tree owns a listening port (with the MSYS `ps -l` bridge for Git Bash trees); main pushes `pty:port`. A running server shows `:5173` on its row and the play icon with `:5173` in the header (the hover card says "Running on :5173"), is named by its last command (captured from OSC 133 prompt marks, `commandMarks.ts`), offers Open localhost, asks before Sleep or Close, and re-runs the command on wake, unless the thread holds a session id: then it resumes the chat instead (`wakePlan`, plan-02 Fix 9). `docs/features-servers.md`.

**Shell integration.** `shell-integration.ts`'s `planSpawn` gives every shell an OSC 9;9 (OSC 7 for WSL) cwd report and OSC 133 A/B prompt marks: cmd through `PROMPT`, pwsh and Windows PowerShell through a wrapped `prompt` function delivered by `-EncodedCommand`, Git Bash and WSL through a `PROMPT_COMMAND` hook carried in the environment. Custom prompts are wrapped, never replaced. An afterterm launched from a thread of another afterterm (`process.env.AFTERTERM === '1'`, passed to `planSpawn` as `inheritedFromAfterterm`) starts every spawn from the inherited environment with the first one's integration taken out (`withoutInheritedIntegration`: marks out of `PROMPT`, the bash bootstrap out of `PROMPT_COMMAND`, `AFTERTERM_BASH_HOOK` removed), so it neither marks the prompt twice nor loses its opt-out (2026-11-08). Launched any other way nothing is stripped, because a user's own Windows Terminal prompt spelled with `$E` looks exactly like afterterm's marks. Opt out per shell in `prefs.json`'s `shellIntegration`. WSL is unit-tested only (not installed on the dev machine). `docs/features-shell-integration.md`.

**Notifications.** Claude Code's hook (self-installed into `~/.claude` by `claude-hook-install.ts`, a no-op unless `AFTERTERM=1`) sets decorated titles and writes the session id and cwd to a per-tab file. Titles become thread states and toasts; toasts render in a separate always-on-top transparent window placed on the display holding the main window, put back on top of every window each time a toast shows (`raiseNotifier`, since 2026-11-08), kept hidden with its toasts waiting while a full-screen app or a presentation is in front on any monitor (`SHQueryUserNotificationState`, which sees the primary display only, or the foreground window covering its monitor, asked through a PowerShell helper before a toast shows, every 3 seconds while toasts are up and on the main window's focus and blur; never for afterterm's own full screen; `notify-hold.ts`, `notify-state-probe.ts`, `prefs.json`'s `toastsWaitForFullScreen: false` to turn it off, `AFTERTERM_NOTIFY_STATE` in dev builds; since 2026-11-09), repainted after every moment DWM can paint its caption (the white bar); a project edited while its toast is up sends `notify:project-updated`, and the toast redraws with the new name, colour and icon. The spinner's stop is decided from PTY output silence (`spinnerState.ts`), except while Claude Code's own session record says busy, which also starts the spinner for a chat with no hooks (`onRecordStatus`). `docs/features-notifications.md`, `docs/features-claude-session-resume.md`.

**Automatic updates.** Only an installed copy checks (packaged, not a harness run, and its exe's folder is its install folder: the Settings > Apps entry is found by name, and the folder is the `InstallLocation` electron-builder writes to `HKCU\Software\<that entry's key>`, not to the entry itself; `installFolder`): GitHub's `releases/latest` 10 seconds after launch and every 6 hours (`updater.ts`; the rules are pure in `update-check.ts`). A release is offered only with the asset `afterterm-<version>-setup.exe` and a sha256 `digest`; the download is refused and deleted when the hash differs. The title bar's "Update available" opens the notice (What's new, Update, Later for 24 hours, Skip this version); the button shows the download, then "Restart to update", which opens the restart window (every awake thread: Resumes, Stops mid-turn, Background task stops, Command stops, Runs again on :port, Opens in its folder; read from Claude Code's session record first, then the hook's state, and for a thread with no live Claude its prompt marks or else its process tree). It says "Safe to restart" only when nothing warns and every thread's state is known; with nothing warning but a thread it cannot judge, it shows no status line. Restart now writes `pendingUpdate` to prefs.json and `wakeAfterUpdate` to session.json (only that quit does), starts Setup's update mode from the updates folder and quits; Setup waits for the pid, installs into the same folder with the shortcuts as they are, and reopens afterterm, which opens on the same screen and thread, wakes what was awake and shows "Updated to". A normal relaunch still starts everything asleep. The version badge opens the About window (check by hand, the automatic switch `updateChecks`). `AFTERTERM_UPDATE_FEED` points the check at a local JSON file in any build, but only an installed copy runs Setup. `docs/features-updates.md`, `docs/design-05-automatic-updates.md`.

**The main window's place.** Since 2026-11-08 (AFT-15) the window opens where it was left: main keeps its home (normal bounds, the display's id and bounds, maximized) in `prefs.json` and opens there when that display is connected, else where Electron puts it. Windows moves a window off a display that goes away (the laptop lid, a monitor asleep or unplugged) and never moves it back, so after a display is added, a wake or an unlock main puts the window back on its home display if it sits on another one. A move within 5 seconds of a display change, a sleep or a wake (not a lock or an unlock) is Windows' and leaves the home alone; any other move is the user's and becomes the new home, so a window moved by hand stays. The rules are pure in `window-placement.ts`; the toasts follow the window (`notifierDisplay`). The real lid close and wake was not tested by an agent. `docs/features-long-output-and-fix-sweep.md`.

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
button's rule in `jumpScroll.ts`). A link Claude Code cuts over several rows opens whole from any
of them (AFT-61): read from a chat's transcript, otherwise joined at the column it was cut at
(`Terminal/webLinks.ts`, rules in `renderer/webLinks.ts`). A click in the terminal ends a running find, so text selected with the mouse is never replaced by a match (AFT-44). No key reloads the window (AFT-26): afterterm's menu is Electron's default without Reload (Ctrl+R) and Force Reload (Ctrl+Shift+R), `app-menu.ts`, so those keys go to the terminal. See `docs/features-terminal-interactions.md`
for behaviour and implementation detail.

## Notification System

Claude Code's hook events reach afterterm two ways: decorated window titles (`✅` done, `⚠` attention, `⏳` background, `⚙` compacting, `▶` working; `detectNotification` in `Terminal/index.tsx`, fan-out in `app.tsx`'s `handleNotification`) and a per-tab file with the session id and cwd. A toast is suppressed only while the user is looking at that thread with the window focused. The overlay is `notifierWindow` in `main.ts` (`?notifier=1` routes to `NotifierApp.tsx`), shown on push and hidden when empty, put back on top of every window on every show and on every display or power change while a toast is up (`raiseNotifier`: `setAlwaysOnTop(true, 'screen-saver')` and `moveTop()`; a toast once arrived behind other windows, AFT-41), placed by `notifierDisplay()` on the main window's display, repainted by `repaintNotifier()` after a show, on `WM_DWMNCRENDERINGCHANGED` and on the main window's focus and blur. Its click-through forwarding (a system-wide mouse hook answered on the main thread) is on only while it shows (`showNotifierWindow`), so a main-thread stall cannot freeze the mouse when no toast is up. The hook entries run the script with `-ExecutionPolicy Bypass`; without it a stock Windows PC's Restricted policy blocked the hook entirely (Yogansh, 2026-10-29). While the main window is focused a toast goes on its own 5 seconds after it shows (`toastExpiry.ts`; main sends every focus change as `notifier:main-focus`); the pointer on a card pauses every toast, and a toast that arrived while afterterm was not focused waits for focus, then gets its 5 seconds. Going on its own only takes the toast off the overlay: the thread keeps its state in the rail and the sidebar. While Windows reports a full-screen app, a Direct3D full-screen game or presentation mode in front (`SHQueryUserNotificationState`, primary display only), or the foreground window covers the whole monitor it is on (any monitor), both asked before every toast shows, every 3 seconds while toasts are up and on the main window's focus and blur, through the PowerShell helper in `notify-state-probe.ts`, the overlay stays hidden and its toasts wait, then are placed, shown and raised when that ends; afterterm's own window in front never holds (its own F11); a toast's 5 seconds start when it is on screen (`notifier:on-screen`), and any failure to ask shows the toast (AFT-72, rules in `notify-hold.ts`). `AFTERTERM_NOTIFY_STATE` replaces the question in dev builds. The hook is bundled at `assets/hooks/afterterm-notify.ps1` and reconciled into `~/.claude` on every startup except a test launch (`AFTERTERM_USER_DATA_DIR` set with no `CLAUDE_CONFIG_DIR`), which skips it (`reconcileClaudeHook`, idempotent, additive; opt out with `claudeNotifications: "disabled"` in `prefs.json`). While the app runs, a poll of the Claude folder's `settings.json` (`startHookRepairPoll` in `main.ts`, a stat every 3 seconds, decided by `needsHookRepair`) puts back any entry that goes missing within a few seconds, so open chats recover with no restart; not in that test launch, and never while opted out. It is a poll because `fs.watch` on the folder fails both ways the folder can go: a delete floods main with events, and a move or rename silently turns the watch off (`docs/features-notifications.md`). Full detail: `docs/features-notifications.md`.

## Session Restore

Windows ConPTY cannot be reconnected after a restart, so `session.json` (`%APPDATA%\afterterm\`, saved 2s after a change through `serializeSession`, loaded through `migrateSession` in `sessionMigration.ts`, `version: 3`) records the layout, including the panel's project order (the order of `groups`), and every restored thread starts asleep: nothing is spawned until the user wakes it. The one exception is the launch after an update restart, which wakes the threads listed in `wakeAfterUpdate` (see Automatic updates). A chat's session id and cwd are captured from the hook's file channel on `UserPromptSubmit` and `Stop`, and on `SessionStart` with source `resume` when the session's transcript exists, so a chat opened with `/resume` is kept before its first message (`claudeSessionId`, `claudeCwd`); Claude Code's own record (`<Claude folder>\sessions\<pid>.json`, read by main every 2 seconds while a PTY is alive, `claude-session-record.ts`) is a second source of the id, adopted only from an interactive record whose transcript exists and sent through the same `claude-session:update`, so a chat with no hooks is still a chat, with the hooks as the fallback; its live status reaches the tab as the transient `recordStatus` (`claude-record:status`), and a transcript read at launch and before a wake moves `claudeCwd` to the folder the session is really in. Add new persisted fields in `sessionMigration.ts`. `AFTERTERM_CLAUDE_PROJECTS_DIR` points the transcript reader at another projects folder and `AFTERTERM_CLAUDE_SESSIONS_DIR` points the record reader at another sessions folder, both read only (plan-02 uses the second to point a dev build whose Claude folder is a scratch one at the real sessions folder). Every shell reports its cwd (see Shell integration), so a thread reopens where it was; do not re-add a title-to-cwd heuristic (cmd's title looks like a path and is not). Full detail: `docs/features-claude-session-resume.md`, `docs/features-shell-integration.md`.

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
| Right-click | Copy selection if any; on a file link, its menu; else paste (Windows QuickEdit style) |

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

Unit tests (plain Node 24+, no framework): `npm test` runs forty files, listed in `package.json`'s `test` script, the source of truth: `src/editor-detect.test.ts`, `src/claude-hook-install.test.ts`, the application menu's `src/app-menu.test.ts`, `src/renderer/spinnerState.test.ts`, `src/renderer/sessionMigration.test.ts`, `src/renderer/panelWidth.test.ts`, `src/renderer/projectColour.test.ts`, `src/renderer/sidebarWalk.test.ts`, `src/renderer/threadView.test.ts`, `src/renderer/attention.test.ts`, `src/renderer/panelView.test.ts`, `src/renderer/splitView.test.ts`, `src/renderer/homeView.test.ts`, `src/renderer/chooserView.test.ts`, `src/renderer/paletteView.test.ts`, `src/claude-transcript.test.ts`, `src/git-info.test.ts`, `src/renderer/chatTitle.test.ts`, `src/renderer/sleepWake.test.ts`, `src/renderer/history.test.ts`, `src/thread-tail.test.ts`, `src/server-detect.test.ts`, `src/renderer/commandMarks.test.ts`, `src/shell-paths.test.ts`, `src/shell-integration.test.ts`, `src/renderer/jumpScroll.test.ts`, `src/renderer/toastExpiry.test.ts`, the toast hold's `src/notify-hold.test.ts` and `src/notify-state-probe.test.ts`, and edited files' `src/session-files.test.ts`, `src/session-files-store.test.ts`, `src/renderer/filesView.test.ts`, `src/command-files.test.ts`, `src/renderer/filePaths.test.ts` and `src/file-index.test.ts` (Phase 6: the latter's real-shell section spawns actual `pwsh.exe`, `powershell.exe` and Git Bash subprocesses, so it needs those installed to exercise fully, and skips gracefully when one is missing), web links' `src/renderer/webLinks.test.ts` (AFT-61), the installer's `src/setup-check.test.ts`, automatic updates' `src/update-check.test.ts`, Claude Code's session record's `src/claude-session-record.test.ts`, and the main window's home's `src/window-placement.test.ts`. The hook script has its own harness: `pwsh -File assets\hooks\test-afterterm-notify.ps1` (add `-Shell powershell.exe` to run the hook under Windows PowerShell 5.1). `AFTERTERM_LAG_PROBE=1` logs every main-thread stall over 30 ms in the first 15 seconds (`[lag]` lines in the harness log); the main thread also answers the toast overlay's mouse hook while a toast is up, so a stall there freezes the mouse. To drive the dev build itself, use the agent harness (see "Agent test harness"), never a bare `npm start` while someone is working on the primary monitor.

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
always fails until they close it. (`npm run installer` and `npm run release` build through
`build.js`, so they stop the same way.)

**To build without closing the app**, use a separate copy whose `out\` is a different path:
`git worktree add`, copy `node_modules` into it, and build there, then move the artifacts
into the standard `out\` folder afterwards. This is how `v0.8.0` and `v0.8.1` were cut.

**To switch Aryan's running app to that build**, the practice since 2026-10-22 is one command,
run by him from a PowerShell window outside afterterm (never from a Claude session inside it):
`node scripts\update-build.mjs`. It closes the app, swaps the folders, restarts the new build
and wakes every thread that was awake. Details and flags in
`docs/agent-workflow/replica-and-build-swap.md`.

Session data (`%APPDATA%\afterterm\`) is shared between dev and portable builds.

### The installer

`npm run installer` builds `out\installer\afterterm-<version>-setup.exe` (about 85 MB), the
file to hand to someone: a WPF front end (`installer/setup/`, compiled with the C# compiler
Windows ships) around electron-builder's one-click NSIS installer, run silently. Per-user, no
admin, Start menu and desktop shortcuts, a Settings > Apps entry, and the Claude Code check
(`afterterm.exe --setup-check`, `src/setup-check.ts`). `--sandbox` builds "afterterm (test)",
which installs beside the real app with its own data and Claude settings folder. No 7-Zip
since 0.10.0. Full detail in [`docs/guide-01-distributable-build.md`](docs/guide-01-distributable-build.md).

An installed copy updates itself from the release's installer (see "Automatic updates" above),
so every release must carry exactly one asset named `afterterm-<version>-setup.exe`; GitHub adds
its sha256 `digest`, without which the update is not offered. Environment variables for testing
updates: `AFTERTERM_UPDATE_FEED=<json file>` (a feed in GitHub's release shape, a local installer
allowed; checks run in any build, Setup runs only in an installed copy; write one with
`scripts/agent-harness/update-feed.mjs`), `AFTERTERM_UPDATE_CHECK_DELAY_MS` (the first check's
delay) and `AFTERTERM_UPDATE_SLOW_MS` (spreads a local installer's copy over that long, to watch
the progress). Detail in [`docs/features-updates.md`](docs/features-updates.md).

### Versioning & Releases

`package.json` `version` is the source of truth (**semver**: feature → MINOR, fix →
PATCH, breaking → MAJOR; still in `0.x` pre-stable). To cut a release: bump the
version, commit, then **`npm run release`**: it builds the app folder + the
installer `out/installer/afterterm-<version>-setup.exe` and tags `vX.Y.Z` (refusing
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
prompt without touching the user's own profile; that does not move Claude Code's folder, which only `--env CLAUDE_CONFIG_DIR=<scratch folder>` does: the launcher drops a `CLAUDE_CONFIG_DIR` inherited from its shell, a test launch with no `CLAUDE_CONFIG_DIR` leaves the real folder alone, and `AFTERTERM_CLAUDE_SESSIONS_DIR` and `AFTERTERM_CLAUDE_PROJECTS_DIR` point the record and transcript readers at the real folders, read only, for a test that runs a real Claude Code),
`npm run harness:drive -- <command>` with commands including bounds, sidebar, screenshot, click, hover (add `--wait <ms>` for the hover card's 350ms delay), unhover, drag, emulate-media (with --click, --eval, --screenshot), screen, home, project, chooser, palette, header, hover-card, pane, tail, confirm (the close-confirm dialog shown for a thread with a listening port), opened (the URL the last "Open localhost:port" click reached), marks (the OSC 133 command-mark state for a given `--tab <id>`), window bottom/restore/close-dialogs, and record start/stop (an mp4 screen recording of the drive session). `window.__afterterm.tab(id)` (via `eval`) reads one thread's live record (port, lastCommand, asleep) straight from state, without waiting on the saved file's two second debounce,
`npm run harness:stop`. Main-process support: `AFTERTERM_DISPLAY`
(`primary` | `secondary` | index; moves the main window and the notifier overlay; with `AFTERTERM_RESTORE_PLACEMENT=1` a saved window home on that display wins, and `window.afterterm.harness.windowHome()` plays a display or power event into the home logic, AFT-15) and
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
- **A server inside WSL is invisible**: server detection walks a Windows process tree, and WSL processes are not in it, so a chat inside WSL has no Claude Code session record to read either and relies on the hooks alone. **WSL shell integration is unit-tested only**: WSL is not installed on the development machine.

## Docs

`CHANGELOG.md` at the repo root records what changed for the person using the app, release by release, at feature level (never code level); the section "Unreleased" collects everything since the last tag and becomes the next release's notes. Add to it whenever a change is something the user would notice.

Research and design documents live in `docs/`. Naming convention: `research-NN-<topic>.md` for research, `design-NN-<topic>.md` for designs, other prefixes as needed.

Procedures an agent follows while working on this repo (not product docs, not research) live in `docs/agent-workflow/`, one file per procedure, plain names. Read the one you need when you need it:

- `docs/agent-workflow/replica-and-build-swap.md`: leaving Aryan a replica dev build after a phase (the data copy, `--claude-resume all`, why `--open-external` is needed) and replacing his production build without a release (build in the worktree, swap after he closes afterterm)
- `docs/agent-workflow/fable-orchestration.md`: read it whenever a Fable session orchestrates a round of work through agents; the orchestrator writes no code and runs no tests itself.

- `docs/research-00-terminal-landscape-and-stack-validation.md` — pre-build stack/landscape research
- `docs/design-01-persistent-pty-host.md` — design for a detached PTY-host daemon so terminals survive an app update (not yet built)
- `docs/design-02-projects-and-threads.md` — the projects-and-threads redesign (Home screen, pinned projects, named threads, sleep/wake, history); agreed 2026-09-06 against `docs/mockups/afterterm-next.html`. Its execution record is `docs/phases-01-projects-and-threads.md`.
- `docs/design-03-sidebar-and-attention.md`: the always-on rail, the Pinned and Recent panel, needs-you until answered, mark as unread, project icons, in-place search, the keyboard cycle; agreed 2026-09-19 against `docs/mockups/design-03-final-sidebar.html`. Phases 7 and 8 in `docs/phases-01-projects-and-threads.md`.
- `docs/design-06-split-groups.md`: two threads of one project side by side, joined in the sidebar by a nameless line; drop on either half, a full header per half, the outline on the focused half, Ungroup from the row's right-click menu; agreed 2026-11-03 against `docs/mockups/split-groups-final.html` (options compared in `docs/mockups/split-groups.html`). Not built yet.
- `docs/phases-01-projects-and-threads.md`: the closed record of the projects-and-threads round, Phases 0 to 9 and the 0.9.0 release: every phase's checklist, every decision with its date, and the log. It was `PHASES.md` at the repo root until 2026-09-30.
- `docs/plan-01-sidebar-attention-and-manual-testing-fixes.md`: the round of work after the projects-and-threads phases, ranked; design-03 is its Cluster 1.
- `docs/plan-02-restart-window-and-hook-fixes.md`: the brief for the 2026-11-07 round: stop test launches removing the real hooks, put the hooks back while the app runs, read Claude Code's session record, and make the restart window say "Safe to restart" only when every thread is known to be idle; Aryan's three decisions, the rows it must show, and the test plan.
- `docs/note-03-restart-window-said-safe-while-a-chat-was-running.md`: why the restart window said "Safe to restart" while a chat was running and how a test launch removed the real hooks for 21 hours, with every claim tested and the three that testing corrected.
- `docs/edited-files/`: everything for the edited-files feature (design-04, phases, build notes, testing and handoff). `design-04-edited-files.md` there: the header Files button (documents first, code and pasted images folded to a count) and clickable file paths in the terminal output; agreed 2026-09-25 against `docs/mockups/edited-files-button.html`; built in PR #43.
- `docs/design-05-automatic-updates.md`: automatic updates (the title bar notice, What's new, Later and Skip, the restart window, Setup's update mode, waking after an update, the About window); agreed 2026-10-30 against `docs/mockups/update-index.html`. Its record is `docs/features-updates.md`; phases in `PHASES.md`.
- `docs/design-06-split-groups.md`: two threads side by side (drop on either half, the line joining the two rows, a header per half, the focus outline, Ungroup in the row menu, a Wake per half, seven behaviour rules); agreed 2026-11-03 against `docs/mockups/split-groups-final.html` (`split-groups.html` shows the options turned down). Not phased. Its record is `docs/features-split-groups.md`.
- `docs/features-split-groups.md`: how two threads side by side was built (where each part lives, the focused half as `activeTabId`, adjacency, the main pane's columns and divider, the drag onto the pane through `usePanelDrag.ts`), what was decided while building it, and how it was tested
- `docs/features-updates.md`: the full record of automatic updates: who checks, the release and its digest, the download, the restart window's rows, Setup's update mode and the shortcuts, waking after an update, the About window, the env vars, how it was tested
- `docs/guide-01-distributable-build.md`: the installer (`npm run installer`): its screens, how it is built (WPF front end, silent NSIS engine), the test build, SmartScreen and pinning
- `docs/guide-02-releases.md` — versioning (semver) + how to cut a tagged, version-stamped release (`npm run release`)
- `docs/ideas.md` — feature ideas backlog
- `docs/bugs.md`: the list of open bugs up to 2026-11-07. Frozen for the Linear trial: open bugs are issues in Linear now (see "All work is tracked in Linear"). Platform constraints are under Known Limitations above.
- `docs/to-verify.md`: changes that reached Aryan's build before 2026-11-07 and are still waiting for him to check them, each with how to check it. New changes are tracked on their Linear issue instead.
- `docs/bugs-fixed.md`: bugs fixed up to 2026-11-07, newest first, with the PR each landed in. Frozen for the Linear trial: a fixed issue's comment in Linear and `CHANGELOG.md`'s Fixed list carry this now.
- `docs/note-01-duplicate-notifications-dispatcher.md` — why both the Windows popup and the overlay fired inside afterterm, and the settings.json dispatcher fix (incl. a TODO to make the self-install hook use the same approach)
- `docs/features-projects-and-threads.md`: the full record of Phases 0 to 4 (Home, projects, the project page, thread identity, sleep and wake, history, the tail), moved out of CLAUDE.md on 2026-09-20
- `docs/features-attention-and-sidebar.md`: the full record of Phases 7 and 8 (needs-you until answered, mark as unread, the aggregate, the rail, the panel, the keyboard cycle)
- `docs/features-long-output-and-fix-sweep.md`: the full record of Phase 9 and the follow-ups from Aryan's first days on the build (the asleep pane, the jump button, the Wake box, the visual fixes, the thread's own folder in Explorer, the project icon everywhere, the notifier white bar)
- `docs/features-notifications.md`: the overlay toasts, the sidebar states, the spinner and the self-installed hook
- `docs/features-terminal-interactions.md` — links, right-click, find, font zoom, drag-drop (behavior + implementation)
- `docs/features-claude-session-resume.md`: auto-resume Claude sessions on relaunch (UUID capture via hook file channel, why not the terminal channel, Claude Code's own session record as a second source, a session id winning on wake, security)
- `docs/features-servers.md`: server detection (port, running state), open localhost, last-command capture and re-run on wake, the close confirm (Phase 5)
- `docs/edited-files/`: the Files button and clickable file paths: `design-04-edited-files.md` (what was agreed), `phases.md` (status, decisions, log), `build-notes.md`, `testing-and-handoff.md`
- `docs/features-shell-integration.md`: OSC 9;9/OSC 7 cwd reporting and OSC 133 prompt marks for pwsh, Windows PowerShell, Git Bash and WSL, the custom-prompt guarantee, the opt-out, and the MSYS process-tree fix (Phase 6)

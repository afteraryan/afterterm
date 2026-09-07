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
  main.ts                              ← Electron main: PTY IPC, shell detection, session persistence, keyboard shortcuts, notifier window + notify IPC, shell:openExternal (link safelist), Claude-hook self-install on startup, PTY activity stamping, last-opened time, editor detection and launch
  claude-hook-install.ts               ← reconcileClaudeHook(): self-installs the bundled notifier hook into ~/.claude (idempotent, additive, prefs.json opt-out). Pure Node, unit-tested.
  editors.ts                           ← Editor product detection and info (product name from exe, list of installs)
  editor-detect.ts                     ← Pure search logic: finds the user's primary and alternate editors by prefs, code command, install folders and registry. Unit-tested. Test file: editor-detect.test.ts
  preload.ts                           ← contextBridge: PTY API, session API, shell list, shortcuts, notify/notifier APIs, shell.openExternal, files.pathForFile (drag-drop), projects (folder picker and explorer launch), editors (list, open, choose), app.lastOpenedAt, pty.onActivity
  prefs.ts                             ← readPrefs and updatePrefs: manages %APPDATA%/afterterm/prefs.json (claudeNotifications, claudeHookToastShown, lastOpenedAt, editorPath)
  afterterm.d.ts                       ← Window.afterterm type declarations (incl. projects, editors, app.lastOpenedAt, pty.onActivity, notify/notifier, shell, files APIs)
  renderer/
    index.tsx                          ← React root; routes to NotifierApp when ?notifier=1, else App
    app.tsx                            ← Screen state (Home, workspace, project page), session restore, shortcut dispatch, notification fan-out, one ProjectActions object for all project menus, new thread chooser, search palette, in-app toast
    index.css                          ← App layout (title bar strip, then sidebar and main pane), screen-entry animations, terminal card, find bar
    theme.css                          ← Palette tokens, bundled Inter, shared classes, keyframes, reduced motion, Home and project-page entrance animations
    sessionMigration.ts                ← session.json shape: migrateSession (fills the project/thread fields on a 0.8.1 file) + serializeSession (the one save shape). Pure, unit-tested.
    sidebarWalk.ts                     ← computeSegments: sidebar rows built from groups first, so a group with zero tabs renders. Pure, unit-tested.
    threadView.ts                      ← Pure: thread kind, state, display title, five-row fold, counter pills, sidebar sections, initialScreen (Home or workspace). Unit-tested.
    homeView.ts                        ← Pure: Home screen rendering logic (date heading, pills, pinned cards, projects sorted by activity, archived list). Unit-tested. Test file: homeView.test.ts
    chooserView.ts                     ← Pure: new-thread chooser project and shell options, sorting and filtering. Unit-tested. Test file: chooserView.test.ts
    paletteView.ts                     ← Pure: search palette projects and threads, prefix-match ranking. Unit-tested. Test file: paletteView.test.ts
    threadMenu.tsx                     ← The one thread menu for the sidebar right-click and the header dots button, Open project page enabled
    projectMenu.tsx                    ← buildProjectMenu: Open, New thread here, Pin/Unpin, Open project page, Open in File Explorer, Open in <editor> per detected editor, Edit, Archive/Restore, Delete
    NotifierApp.tsx                    ← The floating overlay window's React root: toast cards, hide-when-empty logic
    NotifierApp.css                    ← Toast card styles (state icon in a tinted circle, thread name headline, project line with coloured folder)
    hooks/
      useTabState.ts                   ← All tab/group state, session restore, group contiguity enforcement, pin, archive, activity, openProject
    components/
      ScreenNav.tsx                    ← The screen navigation type and initial-screen logic. Styles in ScreenNav.css
      ScreenNav.css                    ← Screen types and entry-class styles
      Toast.tsx                        ← In-app toast pill (pin, archive, restore, editor errors). Styles in Toast.css
      Toast.css                        ← Toast styles (centre bottom, auto-hide)
      SidePanel/
        index.tsx                      ← Icon row (Home, Workspace, collapse toggle), Search and New thread rows, General, Pinned and Projects sections, project and thread rows with the close x, five-row fold, rail when collapsed, DnD, right-click menus, Home and Search wired, pin and project page buttons, shared project menu
        SidePanel.css                  ← Sidebar styles on the theme tokens, breath keyframes for needs-you and done rows, expand and collapse animation
      Header/
        index.tsx                      ← Main pane header: kind icon, name, project line, state chip, dots menu
        Header.css                     ← Header styles
      TitleBar/
        index.tsx                      ← The 32px title bar strip: name and version on the left, the OS caption buttons on the right, the window's drag region
        TitleBar.css                     ← Strip styles (sidebar grey)
      Home/
        index.tsx                      ← Home screen render, date heading, totals, pinned cards, projects list, archived section, Show more toggle
        Home.css                       ← Home layout and typography
      ProjectPage/
        index.tsx                      ← Project page header, folder and shell line, action buttons (Open, New thread, Pin, Edit, Archive or Restore), Explorer and editor buttons, tabs (Live, Asleep, History), search box, thread list or empty state
        ProjectPage.css                ← Project page layout
      NewThreadChooser/
        index.tsx                      ← Overlay modal: current project first, then No project, then others by pin and activity; shell dropdown
        NewThreadChooser.css           ← Chooser modal styles (optional if styles are in components)
      SearchPalette/
        index.tsx                      ← Palette modal: projects and threads by prefix match, Ctrl+Shift+P to open
        SearchPalette.css              ← Palette modal styles (optional if styles are in components)
      GroupModal/
        index.tsx                      ← New/Edit project dialog: name, folder picker, colour, shell, "open a terminal now"
        GroupModal.css                 ← Modal overlay + form styles
      Terminal/
        index.tsx                      ← xterm.js lifecycle, PTY wiring, title intelligence, OSC 9;9 cwd capture, clipboard, links, find bar, font zoom, drag-drop, refit and focus when workspace comes back
      Icons.tsx                        ← SVG icon set from the mock plus FolderIcon, StateIcon, KindIcon, Spinner
      Menu.tsx                         ← Positioned menu with submenu and back chevron
      Menu.css                         ← Menu styles
      Tooltip.tsx                      ← The app tooltip; any element with data-tip
      TabBar/
        types.ts                       ← Tab (incl. fontSize), Group, GroupColor, TabNotification types (shared)
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
    launch.mjs                         ← seeds a throwaway AFTERTERM_USER_DATA_DIR, starts the dev build on a chosen display with CDP on, records pids
    drive.mjs                          ← CDP client: targets, bounds, screenshot, eval, dom, click, rightclick, type, key, sidebar
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

## Title bar, sidebar, header, Home and project page (Phases 1 to 2)

The palette and Inter are bundled in assets/fonts, loaded by theme.css. The renderer's CSP allows only same-origin assets, so the app works offline.

The title bar is a 32px strip across the whole window above every screen (`TitleBar/`), in the sidebar grey `#171717`: "afterterm" and the version badge on the left, the Windows caption buttons on the right, drawn by the OS through `titleBarOverlay` in main.ts (height 32, colour `#171717`, symbols `#8e8e8e`). The strip is the only drag region; nothing else shares its row, so nothing can sit under the caption buttons. Below it the sidebar and the main pane share a row whose background is the same grey, and the main pane has a rounded top-left corner at the surface radius, so the strip and the sidebar read as one L-shaped surface with the pane inset on it.

The sidebar structure, top to bottom: an icon row (56px) with the Home and Workspace icons and the collapse toggle; Search and New thread rows; General, only when there are threads with no project; Pinned, only when a project is pinned; Projects, every project as a row with its solid coloured folder icon (on hover, the + and project page icon appear, and on unpinned rows the pin icon); counter pills with a bell for threads that need you and a play for threads working (nothing at zero); thread rows show the kind icon (chat when a Claude session id was captured, shell otherwise), the title with the hook's glyph stripped, and the state icon at the right end; on hover a row gains 24px of right padding (140ms) and a close x fades into the freed space, the selected row keeps it, and the x closes the thread without selecting it; a five-row fold with "Show N more" that auto-expands when the open thread is beyond the fold; the rail (56px, Ctrl+Shift+B) with the toggle, Home, Workspace, Search and New thread.

The main pane header shows the kind icon, name, project on line 2, branch and worktree slots empty until Phase 3, state chip and dots menu.

Screen entry, on every switch: into the workspace the sidebar body slides in from the left (18px, 260ms) and the main pane from the right (14px, 260ms, 40ms later); into Home the page rises (`homein`, 280ms) and its sections stagger at 40ms steps; into a project page the same rise. The title bar and the icon row never move. All off under reduced motion. `app.tsx` sets `enter-workspace`, `enter-home` or `enter-project` on the root for 400ms after each switch and `data-screen` for the screen showing.

Menus: the one thread menu (`threadMenu.tsx`, right-click on a thread row, the header dots button and the project page rows) has Open, Move to project with a submenu and a back chevron, Open project page, Close. The one project menu (`projectMenu.tsx`, right-click on a Home card or row, a sidebar project row, the project page header) has Open, New thread here, Pin or Unpin, Open project page, Open in File Explorer, Open in <editor> for each detected editor or Choose editor..., Edit project, Archive, Delete project; an archived project gets Restore and Delete project; the Explorer and editor entries are disabled with the tip "Folder not found" when the folder is missing and hidden when the project has no folder; the sidebar splices its "New thread with shell" submenu after New thread here; the New thread row's right-click lists the shells.

State today maps to notification and icon: attention is needs you, amber bell, row breathes amber (5% to 16% of the colour over 2.4s); working is spinner; done is green check, row breathes green until viewed; compacting and background are spinner; asleep is moon (nothing sets it until Phase 4); running is green play (Phase 5).

### Home, project page, chooser and palette (Phase 2)

Three screens under the title bar: Home, the workspace and the project page. Home and the project page render in place of the workspace, and the workspace stays mounted and hidden (`.workspace.hidden`, display none) so terminals keep running and the active tab's lazy Claude resume still fires; when the workspace comes back the active terminal is refit and focused unless something else holds the keyboard (`Terminal/index.tsx`, the `visible` prop). The app opens on Home when the restored session has at least one project and on the workspace when it has none (`initialScreen` in threadView.ts).

Home (`components/Home/`, pure logic in `homeView.ts`): the date heading ("Sunday, 6 September"), under it the counter pills totalled across every live project and General (bell for needs you, play for working), rendered only when a count is non-zero; Pinned cards (folder, name, pills, time since last activity, the project page icon on hover, the filled pin); Projects rows for unpinned projects sorted by lastActiveAt with Show more after four; an "Archived · N" link that expands to rows with Restore; a + on the Projects label that opens the New project modal. Clicking a card or row opens the workspace on that project (its first thread, or a new one when it has none); the project page opens only from the folder-with-chevron icon or the menu.

Pin and archive are explicit user actions only: nothing pins or archives on its own. Archiving clears the pin and takes the project out of the sidebar; its threads stay alive and its project page still lists them. Restoring leaves it unpinned. Opening an archived project from Home restores it first. Both show a short toast.

The project page (`components/ProjectPage/`): back link to Home, folder icon and name, the folder path and default shell, then Open, New thread, Pin or Unpin, Edit, Archive or Restore, and at the right the Open in File Explorer and Open in <editor> logo buttons (disabled with "Folder not found" when the folder is missing, hidden when the project has no folder); Live, Asleep and History tabs (History is empty until Phase 4) with a search box over the list; rows open the thread in the workspace and right-click gives the thread menu.

The new thread chooser (`components/NewThreadChooser/`, logic in `chooserView.ts`) opens from the New thread row, the rail + and Ctrl+Shift+T (from Home or a project page the app switches to the workspace first and anchors the popover under the New thread control). It lists the current project first, then No project, then the others pinned first and by last activity, filtered by the input; a shell dropdown at the bottom defaults to the chosen project's shell; Enter takes the highlighted row. The + on a project row still creates a thread directly.

The search palette (`components/SearchPalette/`, logic in `paletteView.ts`) opens from Ctrl+Shift+P and the Search row: projects and threads, substring matches with prefix matches first, archived projects and their threads excluded; a project opens the workspace on it, a thread selects it.

The in-app toast (`components/Toast.tsx`, `.app-toast`) is a pill at the bottom centre for pin, archive, restore and editor errors, with an optional action ("Choose editor..."). It is separate from the overlay notifier window.

Activity stamping: main sends `pty:activity` for a tab at most once per 15s while it has input or output, ignoring the first 5s of a PTY's life so a shell banner or the app's own `claude --resume` does not read as activity; the renderer raises the thread's and its project's lastActiveAt. Activating a thread still stamps as before. The last-opened time is written to `prefs.json` as `lastOpenedAt` at startup and the previous value is exposed as `window.afterterm.app.lastOpenedAt` (not shown anywhere yet).

Editor detection (`editor-detect.ts`, pure and unit-tested, wired in main.ts) runs once after the window opens and is cached: `editorPath` in prefs.json first, then what the `code` command resolves to (the shim's exe, product read from the exe name so a `code` that opens Cursor is labelled Cursor), then the standard install folders, then the uninstall registry. The first hit is the primary editor (its name and logo on the button); extra editors are menu entries only. It re-runs after a failed launch and after Choose editor... (a file picker that writes `editorPath`). An unknown editor id at launch time is an error, never a fallback. `prefs.json` keys: `claudeNotifications`, `claudeHookToastShown`, `lastOpenedAt`, `editorPath`.

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
- **Sidebar thread indicator**: a background thread that needs you shows an amber bell at the right end of its row and the row breathes amber (5% to 16% of the colour over 2.4s); a finished turn shows a green check and a green breath until the thread is viewed. Cleared only on thread activation.
- **Working spinner**: while Claude is mid-turn, the spinner sits at the right end of the row (after the state icon slot). A `▶ working` title (from the `UserPromptSubmit` hook) starts it. The title channel alone is unreliable at *stopping* it (a mid-turn `⚠` permission prompt or `⚙` compaction replaces `working` with nothing to restore it; and if `Stop`'s `✅` never fires the spinner sticks), so afterterm uses the PTY output stream as a second signal. The decision logic lives in `src/renderer/spinnerState.ts` (pure, unit-tested): **silence-clear** (drop `working` after ~2.5s of no output; Claude's TUI is never silent >~450ms mid-turn but is silent forever at idle) and **re-arm** (flip `attention`/`compacting` back to `working` when output resumes after the pause). Wired in `app.tsx` (`handleOutput` + a 500ms tick) and fed by `Terminal/index.tsx` (`onOutput`). Empirical basis + capture harness: `scripts/spinner-harness/`.
- **Project row pills**: a collapsed or expanded project row shows a bell pill with the count of threads that need you and a play pill with the count that are working (running joins in Phase 5); nothing at zero.

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

Format: `{ version, tabs, groups, activeTabId }`. `version: 2` since the projects-and-threads work; 0.8.1 wrote no version field. Loading goes through `migrateSession` in `src/renderer/sessionMigration.ts`, which fills the fields a 0.8.1 file lacks (`Group.pinned`, `Group.archived`, `Group.lastActiveAt`, `Tab.lastActiveAt`, `Tab.asleep`), drops entries without an id, strips transient fields and rejects anything that is not a session. Saving goes through `serializeSession` in the same module. Every 0.8.1 key keeps its name and meaning, so 0.8.1 still opens a file written by a newer build (it ignores the fields it does not know). Add new persisted fields in that module, not in `app.tsx`.

Tabs that were running a **Claude Code session auto-resume it on relaunch** (`claude --resume
<sessionId>` in the session's cwd) — **lazily**: the active tab resumes on launch, background
tabs resume the first time you open them (resuming all at once can OOM-crash the app). The
session UUID is captured per-tab via a file the notify
hook writes — **not** the terminal/title channel — and persisted as `claudeSessionId` /
`claudeCwd`. Capture only fires on `UserPromptSubmit` / `Stop`: Claude Code's shared background
daemon inherits the tab env and pre-spawns throwaway `(spare)` sessions whose `SessionStart`
used to hijack the mapping with an id that never gets a transcript. See [`docs/features-claude-session-resume.md`](docs/features-claude-session-resume.md)
for the why and the wiring. (Dev isolation: `AFTERTERM_USER_DATA_DIR` redirects `session.json`
to a throwaway dir.)

### CWD capture — per-shell support

A tab can only restore to its last directory if afterterm captured that directory while you worked. Capture relies on the shell *announcing* its path via an OSC 9;9 report, and not every shell does:

| Shell | CWD restore | How |
|---|---|---|
| **Command Prompt (cmd.exe)** | ✅ Supported | afterterm injects an OSC 9;9 cwd report into the `PROMPT` env var at spawn (`main.ts`); the renderer parses OSC 9;9 (`Terminal/index.tsx`). Any custom `PROMPT` is preserved. |
| **Git Bash** | ❌ Not yet | Needs an OSC 7 / `PROMPT_COMMAND` injection. (Its MINGW title isn't a Windows path, so the old title-based heuristic never actually captured it.) |
| **PowerShell 7 (pwsh)** | ❌ Not yet | Default prompt emits neither a path title nor OSC 9;9. Needs shell-integration prompt-wrapping (deferred — risk of clobbering custom prompts like oh-my-posh/starship). |
| **Windows PowerShell** | ❌ Not yet | Same as pwsh. |
| **WSL** | ❌ Not yet | Default prompt doesn't report cwd; would need an OSC 7 / `PROMPT_COMMAND` injection. |

Unsupported shells fall back to spawning in the user home folder (`%USERPROFILE%`).

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

## Building

### Development
```powershell
npm start
```

Unit tests (plain Node 24+, no framework): `npm test` runs `src/editor-detect.test.ts`, `src/claude-hook-install.test.ts`, `src/renderer/spinnerState.test.ts`, `src/renderer/sessionMigration.test.ts`, `src/renderer/sidebarWalk.test.ts`, `src/renderer/threadView.test.ts`, `src/renderer/homeView.test.ts`, `src/renderer/chooserView.test.ts` and `src/renderer/paletteView.test.ts`. To drive the dev build itself, use the agent harness (see "Agent test harness"), never a bare `npm start` while someone is working on the primary monitor.

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
the monitor a person is using. `npm run harness -- --session <copy of session.json>`,
`npm run harness:drive -- <command>` with commands including bounds, sidebar, screenshot, click, hover, unhover, drag, emulate-media (with --click, --eval, --screenshot), screen, home, project, chooser, palette, and window bottom/restore/close-dialogs,
`npm run harness:stop`. Main-process support: `AFTERTERM_DISPLAY`
(`primary` | `secondary` | index; moves the main window and the notifier overlay) and
`AFTERTERM_REMOTE_DEBUG_PORT` (opt-in Chromium remote debugging). Safety rules, every
command and the known limitations are in
[`scripts/agent-harness/README.md`](scripts/agent-harness/README.md).

**Screenshots are kept.** Every capture taken while testing a phase (harness CDP
screenshots, per-window captures, whole-display captures) is saved under
`docs/screenshots/<phase>/` in the repo and is never deleted, by anyone. New captures go
there too, numbered, with a name that says what they show. Whole-display captures sit in
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

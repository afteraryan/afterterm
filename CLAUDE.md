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
  main.ts                              ← Electron main: PTY IPC, shell detection, session persistence, keyboard shortcuts, notifier window + notify IPC, shell:openExternal (link safelist)
  preload.ts                           ← contextBridge: PTY API, session API, shell list, shortcuts, notify/notifier APIs, shell.openExternal, files.pathForFile (drag-drop)
  afterterm.d.ts                       ← Window.afterterm type declarations (incl. notify/notifier, shell, files APIs)
  renderer/
    index.tsx                          ← React root; routes to NotifierApp when ?notifier=1, else App
    app.tsx                            ← Layout: SidePanel + TerminalArea, session restore, shortcut dispatch, notification fan-out
    index.css                          ← App layout, titlebar drag region, terminal container styles
    NotifierApp.tsx                    ← The floating overlay window's React root — toast cards, hide-when-empty logic
    NotifierApp.css                    ← Overlay/toast styles
    hooks/
      useTabState.ts                   ← All tab/group state, session restore, group contiguity enforcement
    components/
      SidePanel/
        index.tsx                      ← Tab list, groups, DnD, context menus, shell dropdown, tab glow/dot + working spinner + group badge
        SidePanel.css                  ← incl. notification pulse keyframes + working-spinner animation
      Terminal/
        index.tsx                      ← xterm.js lifecycle, PTY wiring, title intelligence, OSC 9;9 cwd capture, clipboard, links, find bar, font zoom, drag-drop
      TabBar/
        types.ts                       ← Tab (incl. fontSize), Group, GroupColor, TabNotification types (shared)
forge.config.ts                        ← ASAR unpack, rebuild skip, Vite plugin config
```

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

- **Floating overlay toasts** — a separate always-on-top, transparent, frameless, click-through `BrowserWindow` (`notifierWindow` in main.ts) loads the same renderer with `?notifier=1`, which routes to `NotifierApp.tsx`. It stays **hidden** until a toast arrives (`showInactive()` on push), then hides again when the last toast clears — this is what keeps the Windows `WM_NCACTIVATE` white-bar artifact from showing. Clicking a toast focuses the main window and switches to that tab.
- **Sidebar tab indicator** — a background tab with a pending notification gets a pulsing colored row + a colored dot to the right of its `›`. Cleared only on tab activation (not on title change).
- **Working spinner** — while Claude is mid-turn, the tab shows a spinning arc after its `›` (no toast, no row pulse). Driven by a `▶ working` title emitted by the `UserPromptSubmit` hook; replaced by ✅/⏳/⚙ when the turn ends. (See `docs/bugs.md` — the spinner can stop early if Claude replies but keeps running.)
- **Group header badge** — a count of group members with pending (non-working) notifications.

Notification types map to title prefixes the shell hook emits: `✅` done, `⚠` attention, `⏳` background tasks, `⚙` compacting, `▶` working. Detection is in `Terminal/index.tsx` (`detectNotification`); fan-out to overlay + sidebar is in `app.tsx` (`handleNotification`). A toast is suppressed only when the user is *actually looking* at that tab (`activeTabId === tabId && document.hasFocus()`), so cross-app notifications still fire when afterterm is behind another window.

IPC flow: renderer `notify:push` → main → `notifierWindow` `notify:push`; overlay click `notify:tab-click` → main → `mainWindow.focus()` + `notify:activate-tab` → renderer; `notifier:hide` / `notifier:set-ignore-mouse` overlay → main.

## Session Restore

Windows ConPTY cannot be reconnected after app restart — the kernel object dies with the process. (A future design to make shells *survive* an app restart lives in `docs/design-01-persistent-pty-host.md`.)

What afterterm does:
- Auto-saves every 2 seconds (debounced): tab order, group names/colors/collapsed state, shell type, CWD
- On relaunch: restores the full layout and spawns fresh shells starting in the saved CWD
- Limitation: scrollback, running processes, and command history are lost — each tab is a fresh shell

Save location: `%APPDATA%\afterterm\session.json`

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
| Ctrl+Shift+T | New tab (default shell) |
| Ctrl+Shift+W | Close current tab |
| Ctrl+Tab | Next tab |
| Ctrl+Shift+Tab | Previous tab |
| Ctrl+Shift+B | Toggle side panel |
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
cd D:\Tinkering\afterterm
$env:NODE_TLS_REJECT_UNAUTHORIZED="0"   # SSL cert issue on dev machine
npm start
```

### Portable Build
```powershell
npm run build
```
Output: `out\afterterm-win32-x64\afterterm.exe` (~346MB, includes Chromium + node_modules)

Run directly from the `out` folder or move the entire `afterterm-win32-x64` folder anywhere.

**Updating while running:** `npm run build` handles this automatically — it renames the running build to `out/afterterm-old-<timestamp>/` (Windows allows renaming a folder with a running exe), builds fresh to the standard path, and cleans up old builds on the next run. The running app keeps working from the renamed folder. Close and reopen to pick up the new build.

Session data (`%APPDATA%\afterterm\`) is shared between dev and portable builds.

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
- `docs/ideas.md` — feature ideas backlog
- `docs/bugs.md` — running list of known, unfixed bugs (distinct from the platform Known Limitations above)
- `docs/features-terminal-interactions.md` — links, right-click, find, font zoom, drag-drop (behavior + implementation)

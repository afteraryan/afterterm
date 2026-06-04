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
  main.ts                              ← Electron main: PTY IPC, shell detection, session persistence, keyboard shortcuts, notifier window + notify IPC, shell:openExternal (link safelist), Claude-hook self-install on startup
  claude-hook-install.ts               ← reconcileClaudeHook(): self-installs the bundled notifier hook into ~/.claude (idempotent, additive, prefs.json opt-out). Pure Node, unit-tested.
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
assets/
  hooks/
    afterterm-notify.ps1               ← bundled, distributable Claude Code hook (no-op unless AFTERTERM=1); copied into ~/.claude/hooks on first run
    test-afterterm-notify.ps1          ← standalone test harness for the hook (12 cases)
forge.config.ts                        ← ASAR unpack, rebuild skip, Vite plugin config (extraResource: ['assets'] bundles the hook)
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

Tests (no app needed): `assets/hooks/test-afterterm-notify.ps1` (12 cases, runs
the hook as a subprocess) and `src/claude-hook-install.test.ts` (26 cases, run
with `node src/claude-hook-install.test.ts` — Node 24+ strips the TS types).

## Session Restore

Windows ConPTY cannot be reconnected after app restart — the kernel object dies with the process. (A future design to make shells *survive* an app restart lives in `docs/design-01-persistent-pty-host.md`.)

What afterterm does:
- Auto-saves every 2 seconds (debounced): tab order, group names/colors/collapsed state, shell type, CWD
- On relaunch: restores the full layout and spawns fresh shells starting in the saved CWD
- Limitation: scrollback, running processes, and command history are lost — each tab is a fresh shell

Save location: `%APPDATA%\afterterm\session.json`

Tabs that were running a **Claude Code session auto-resume it on relaunch** (`claude --resume
<sessionId>` in the session's cwd) — **lazily**: the active tab resumes on launch, background
tabs resume the first time you open them (resuming all at once can OOM-crash the app). The
session UUID is captured per-tab via a file the notify
hook writes — **not** the terminal/title channel — and persisted as `claudeSessionId` /
`claudeCwd`. See [`docs/features-claude-session-resume.md`](docs/features-claude-session-resume.md)
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
`gh release create`. `npm run build` stays the quick, unversioned dev build.
Milestone tags `v0.1.0`–`v0.5.0` are backfilled. Full process + the version lineage:
[`docs/guide-02-releases.md`](docs/guide-02-releases.md).

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
- `docs/guide-01-distributable-build.md` — shrink the portable build into a ~67 MB self-extracting `.exe` for sharing (7-Zip LZMA2 + pruning)
- `docs/guide-02-releases.md` — versioning (semver) + how to cut a tagged, version-stamped release (`npm run release`)
- `docs/ideas.md` — feature ideas backlog
- `docs/bugs.md` — running list of known, unfixed bugs (distinct from the platform Known Limitations above)
- `docs/features-terminal-interactions.md` — links, right-click, find, font zoom, drag-drop (behavior + implementation)
- `docs/features-claude-session-resume.md` — auto-resume Claude sessions on relaunch (UUID capture via hook file channel, why not the terminal channel, security)

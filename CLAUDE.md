# afterterm

A simple terminal emulator for Windows with **Chrome-style tab groups**. No existing terminal has this feature.

## Stack

- **Electron** (desktop runtime)
- **@xterm/xterm v6** + **@xterm/addon-webgl** (terminal renderer)
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

## File Structure

```
src/
  main.ts                              ← Electron main: PTY IPC, shell detection, session persistence, keyboard shortcuts
  preload.ts                           ← contextBridge: PTY API, session API, shell list, shortcuts
  afterterm.d.ts                       ← Window.afterterm type declarations
  renderer/
    index.tsx                          ← React root
    app.tsx                            ← Layout: SidePanel + TerminalArea, session restore, shortcut dispatch
    index.css                          ← App layout, titlebar drag region, terminal container styles
    hooks/
      useTabState.ts                   ← All tab/group state, session restore, group contiguity enforcement
    components/
      SidePanel/
        index.tsx                      ← Tab list, groups, DnD, context menus, shell dropdown
        SidePanel.css
      Terminal/
        index.tsx                      ← xterm.js lifecycle, PTY wiring, title intelligence, clipboard
      TabBar/
        types.ts                       ← Tab, Group, GroupColor types (shared)
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

## Session Restore

Windows ConPTY cannot be reconnected after app restart — the kernel object dies with the process.

What afterterm does:
- Auto-saves every 2 seconds (debounced): tab order, group names/colors/collapsed state, shell type, CWD
- On relaunch: restores the full layout and spawns fresh shells starting in the saved CWD
- Limitation: scrollback, running processes, and command history are lost — each tab is a fresh shell

Save location: `%APPDATA%\afterterm\session.json`

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
npm run package
```
Output: `out\afterterm-win32-x64\afterterm.exe` (~346MB, includes Chromium + node_modules)

Run directly from the `out` folder or move the entire `afterterm-win32-x64` folder anywhere. To update: run `npm run package` again — it overwrites the same folder.

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

Research and design documents live in `docs/`. Naming convention: `research-NN-<topic>.md` for research, other prefixes as needed.

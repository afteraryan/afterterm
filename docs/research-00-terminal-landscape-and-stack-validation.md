# afterterm: Terminal Landscape & Stack Validation Research

**Status:** Pre-build research  
**Date:** 2026-05-27  
**Scope:** Validate the Electron + xterm.js + node-pty + React stack; understand the competitive landscape; surface gotchas before a single line of product code is written.

---

## Table of Contents

1. [xterm.js + node-pty + Electron Integration](#1-xtermjs--node-pty--electron-integration)
2. [Existing Terminal Apps and Tab Organization](#2-existing-terminal-apps-and-tab-organization)
3. [node-pty on Windows: The Real Story](#3-node-pty-on-windows-the-real-story)
4. [Electron Alternatives](#4-electron-alternatives)
5. [Chrome Tab Group UX: What Actually Works](#5-chrome-tab-group-ux-what-actually-works)
6. [Session Persistence and Crash Recovery](#6-session-persistence-and-crash-recovery)
7. [Stack Recommendation and Risk Summary](#7-stack-recommendation-and-risk-summary)

---

## 1. xterm.js + node-pty + Electron Integration

### What is actually proven

This is the most battle-tested stack for custom terminal emulators in 2025–2026. VS Code, Tabby, Hyper, and several AI coding tools (Warp's first iterations, Superset) all use some combination of these three. The lineage is well-understood.

**The canonical wiring pattern** (simplified):

- `node-pty` lives in the **Electron main process** (or a dedicated pty-host process). It holds the native PTY handle and spawns the shell.
- `xterm.js` lives in the **renderer process** (the browser window). It handles display and keyboard input.
- They communicate via **IPC** (`ipcMain` / `ipcRenderer`). Data is passed as strings or Buffers over Electron's structured-clone bridge.

This is the right separation. Trying to use node-pty directly in the renderer is technically possible in non-sandboxed Electron but creates security and stability risks. Don't do it.

### xterm.js version situation

As of May 2026, xterm.js is on **v6.0.0** (package name changed to `@xterm/xterm` at v5). v5 was a major breaking change release — the old `xterm` package name still exists on npm but is deprecated. Key changes you must know:

- **Package rename**: `xterm` → `@xterm/xterm`. Addons also renamed: `xterm-addon-webgl` → `@xterm/addon-webgl`, etc.
- **Bundle size improved**: 379kb → 265kb (v4→v5), a 30% reduction.
- **WebGL renderer is now the recommended high-performance path.** The canvas renderer (`@xterm/addon-canvas`) is the fallback. The DOM renderer is lowest-fidelity but works anywhere.
- **v6 is current.** Start fresh on v6 / `@xterm/xterm`. Don't inherit v4 patterns from tutorials.

**Risk**: Most tutorials and blog posts you'll find target v4 or earlier (`xterm` package). Hyper still uses an older version. Don't copy-paste their setup code without checking the API has changed.

### WebGL renderer: performance

The WebGL renderer renders frames up to **~900% faster** than the canvas renderer and scales much better on large viewports. For a Windows terminal emulator where users will dump large output and have multiple open tabs, this is not optional — use `@xterm/addon-webgl`. Fall back to canvas if WebGL context creation fails (this happens on some VM / RDP environments).

Concrete numbers: A single 160x24 terminal with 5000 scrollback lines takes ~34MB. With multiple open tabs and lazy rendering paused for hidden terminals (xterm.js doesn't do this automatically — you have to implement visibility-aware pause/resume), memory is manageable. **If you open 10 active terminals and let all of them render at full rate, you will thrash the main thread.** Hyper learned this the hard way.

### node-pty version pinning

node-pty must be **recompiled against the exact version of Node.js embedded in your Electron version**. This is mandatory — the `.node` native binary is not portable across Node ABI versions. Use `@electron/rebuild` (previously `electron-rebuild`) after every `npm install`.

**Minimum supported**: Node 16 / Electron 19.  
**Current reality**: node-pty's supported versions track whatever VS Code is currently using. This is a practical and reliable heuristic — if VS Code ships on it, it works.

**ASAR gotcha**: node-pty's native binary (`conpty.node`, `conpty_console_list.node`, `spawn-helper`) **cannot live inside an ASAR archive**. They must be unpacked to disk. Use Electron Forge's Auto Unpack Native Modules plugin, or manually configure `asar.unpack` in your builder config. If you forget this, the app will silently fail to spawn shells on first run after install. This is a common mistake.

### IPC overhead reality check

Electron IPC is JSON-serialized and async. Under heavy terminal output (e.g., `cat` on a large file, `npm install`), naive IPC causes noticeable lag because:
1. The data burst hits the main process.
2. It's serialized to JSON.
3. It's queued in V8's event loop.
4. The renderer processes it asynchronously.

**Hyper's mitigation**: batch data chunks before sending. Instead of forwarding every small `data` event from node-pty immediately, accumulate for ~16ms and send as one chunk. This trades a tiny bit of latency (imperceptible) for dramatically better throughput under burst conditions.

Consider implementing this batching from day one. VS Code does this too (their `pty-host` architecture makes it explicit).

### Is xterm.js still the right choice?

**Yes, for this stack.** The web-based terminal renderer alternatives are thin:

| Renderer | Notes |
|---|---|
| `@xterm/xterm` (xterm.js) | Mature, feature-complete, actively maintained, used by VS Code and dozens of others. The default correct choice. |
| `hterm` | Google's renderer. Worse CJK/IME support, less active development. Used in ChromeOS Terminal. Not a good fit. |
| `xterm.es` | Community fork of xterm.js with some ES module improvements. Small, not proven at scale. |
| Native renderer (Ghostty, WezTerm) | OpenGL/WebGPU directly — not applicable if you're in a browser-based runtime. |

If you switched from Electron to Tauri, you'd still use xterm.js in the WebView. The renderer choice is independent of the shell framework choice for web-based approaches.

**Honest flag**: xterm.js is 100% main-thread bound. For a tab-grouped terminal with 8+ open sessions, the parser, VT emulation, and rendering all fight for the same JS thread. There's an open design discussion about moving the parser to a Web Worker, but it's not implemented as of v6. This is a real concern at scale. Mitigation: pause rendering on hidden tabs (xterm.js has a `pauseRendering()` call) and don't `write()` to off-screen terminals at full rate.

---

## 2. Existing Terminal Apps and Tab Organization

### The competitive map

No terminal has Chrome-style tab groups. This is confirmed — the feature doesn't exist anywhere.

What exists instead:

| Terminal | Organization Model | Windows Support |
|---|---|---|
| **Windows Terminal** | Color-coded tabs. No groups. Group Tabs is an open GitHub issue (#8267) with no implementation. | Yes (native) |
| **Tabby** | Color-coded tabs, tiling splits. Users have been requesting workspace/grouping for years (open issue #9279). | Yes (Electron) |
| **WezTerm** | "Workspaces" — named sets of windows/tabs, switchable like tmux sessions. Powerful but terminal-power-user UX, not Chrome-like. | Yes (Rust/native) |
| **Warp** | Tabs with titles and ANSI colors. Reusable "Launch Configurations" (named groups of windows/panes). Launched on Windows in Feb 2025. AI-first focus. | Yes |
| **Hyper** | Plain tabs. Largely unmaintained as of 2025. Technically still works but last major update was years ago. | Yes (Electron) |
| **Alacritty** | No tabs, no splits. Explicitly out of scope by design. Requires tmux. | Yes |
| **Kitty** | Tabs, splits via "kittens." Tab bar with names. No grouping. macOS/Linux only. | No |
| **Rio** | Native tabs (TopTab/BottomTab/NativeTab styles), splits. Rust + WebGPU. No grouping. | Partial (Linux/macOS primary) |
| **Ghostty** | Native OS tabs on macOS. Linux support. **No Windows support as of v1.3 (March 2026).** Community forks exist but unofficial. | No (community forks only) |

### What Warp does closest to grouping

Warp's "Launch Configurations" let you save a named set of windows/panes/tabs with commands that run on open. It's not dynamic drag-to-group like Chrome, but it's the closest UX to "this is my frontend project setup." It's session-level grouping, not tab-level real-time grouping.

### The real insight from this landscape

The gap is real and uncontested. Every major terminal that runs on Windows either has no tab organization (Alacritty, Hyper) or has power-user organizational models that require upfront configuration (WezTerm workspaces, Warp launch configs). Nobody has the Chrome model: **open tabs, drag to create a group on the fly, name it, collapse it**.

The closest thing in any software is Microsoft Edge Workspaces (a named container for a set of tabs), but that's a browser and it doesn't transfer to terminal.

**Risk to validate**: Would terminal users actually use dynamic drag-to-group? Browser users use it because they accumulate 40+ tabs passively. Terminal users are more intentional — they open tabs they need. The use case that does map is **project switching**: "all my Rails tabs" vs "all my infra tabs." The question is whether users want to group them by dragging during a session or by pre-configuring (like WezTerm). You should interview 3–5 actual terminal power users before committing to the exact UX.

---

## 3. node-pty on Windows: The Real Story

### ConPTY: what it is and why it matters

Windows has no Unix-style PTY. node-pty on Windows uses **ConPTY** (Windows Pseudoconsole API), introduced in Windows 10 build 1809 (2018). Support for the older **winpty** library was removed from node-pty — ConPTY is now the only Windows backend.

**Requirements**: Windows 10 1809 or later. Windows 11 is well past this threshold. Target Windows 11 only and this is a non-issue.

### Known ConPTY bugs and gotchas (active as of 2025–2026)

1. **Assertion failure on teardown** (node-pty conpty.cc line 106): An active issue in 2026. When the app shuts down while a background task still holds a PTY reference, the ConPTY baton is freed while still in use. This causes a native assertion crash. Seen in production apps including OpenAI's Codex. Mitigation: always await `ptyProcess.kill()` and drain events before Electron's `app.quit()`. Do not let the renderer initiate shutdown.

2. **OSC sequence flushing**: ConPTY historically held OSC sequences and flushed them out-of-order relative to text output. Microsoft has been fixing this; targeted fix was Terminal v1.23 (late 2024). If you test with Windows Terminal 1.23+, this is likely resolved. If you target users on older builds, you may see garbled output when OSC codes (title changes, hyperlinks) and text overlap.

3. **`kill()` hangs**: On Windows, calling `.kill()` on a node-pty process can cause the process to hang and never return. Do not call `.kill()` synchronously on the main thread. Use a timeout-protected async wrapper.

4. **Process tree cleanup**: Closing the PTY does not kill the process tree. SIGTERM/SIGKILL are not real signals on Windows — they're simulated. If you spawn `pwsh.exe` which spawns a child process (npm, git, etc.), closing the PTY leaves those children running as orphans. Accumulates in Task Manager across sessions. **You must walk the process tree and kill children explicitly**, e.g., using `taskkill /PID <pid> /T /F` wrapped in a Node child_process call. Several Electron terminal apps have zombie process bugs because of this.

5. **`conpty.node` module not found**: A user-reported failure pattern where activating ConPTY results in new tabs showing only a cursor. Almost always a packaging issue — `conpty.node` wasn't unpacked from ASAR. See section 1.

### Shell spawning matrix on Windows

| Shell | How to spawn | Known issues |
|---|---|---|
| PowerShell 7 (`pwsh.exe`) | Standard. Best choice for default shell. | None major. Well-supported via ConPTY. |
| Windows PowerShell (`powershell.exe`) | Standard. Ships with Windows, no install needed. | Slower startup. Some legacy quirks. |
| cmd.exe | Standard. | Fine for basic use. No tab completion, but not your problem. |
| Git Bash (`bash.exe` via Git for Windows) | Requires MSYS2 path. Must find the install location dynamically (registry or common paths). Spawning subprocesses is **notably slower** than native shells due to MSYS2 overhead. | Path differences (POSIX vs Windows paths inside the shell). |
| WSL (e.g., `wsl.exe -d Ubuntu`) | Complicated. node-pty on the Windows side spawns `wsl.exe`, which then forks a Linux process inside the VM. Path handling breaks: working directory is a Windows path but WSL treats it differently. | File path assumptions must be dropped. Resize handling differs. The PTY behaves more correctly once inside WSL but the bridge has rough edges. |

**Recommendation for v1**: Default to PowerShell 7 if installed, fall back to Windows PowerShell. Ship Git Bash and WSL support but treat them as secondary profiles. Don't try to auto-detect all shells at launch — let users configure their shell per tab or per group.

### Session restore: what's realistic on Windows

**You cannot reconnect to an existing ConPTY after the app restarts.** ConPTY is a Windows kernel object — when the owning process (your Electron app) dies, the PTY is destroyed. The shell process itself may still be running as an orphan, but there is no way to attach to it from a new process.

This is fundamentally different from Unix PTYs where you can run a daemon that outlives the app (what iTerm2 and tmux-based approaches do). Windows ConPTY has no equivalent of `openpty()` and handing the fd to another process.

**What you can do**:
- Serialize the visible screen buffer and scrollback on shutdown (xterm.js exposes `buffer.active` and `buffer.normal`). On restart, write that serialized output back to a new xterm instance so it looks like the session resumed — but it's cosmetic. The actual shell is dead.
- Restore the last working directory (via an OSC sequence or by having the shell report it — PowerShell can be configured to emit CWD via OSC 7).
- Re-run a "startup command" if configured.

**Honest framing for v1**: Sell "restore layout on restart" (tab groups, names, colors, cwd), not "restore running sessions." The latter requires a daemon architecture (see Section 6) that is weeks of additional work and not proven on Windows.

---

## 4. Electron Alternatives

### Why Electron is being questioned

The numbers are real:

| Runtime | Idle memory | Bundle size |
|---|---|---|
| Electron (Chromium + Node bundled) | 300–400 MB | 80–150 MB installer |
| Tauri (WebView2 on Windows) | 30–50 MB | ~10–20 MB installer |
| Native (Ghostty, WezTerm, Alacritty) | 30–100 MB | 5–30 MB |

For a terminal — a tool that developers keep running all day — the memory difference is meaningful. WezTerm at 320 MB and Hyper at 400 MB are the heaviest in the category. Alacritty at 30 MB is the floor.

### Tauri: genuinely viable for a terminal

**What exists**: Multiple working Tauri terminal projects exist as of 2025–2026:

- `marc2332/tauri-terminal`: Proof of concept, xterm.js + portable-pty.
- `Terminon` (Shabari-K-S): Full-featured, Tauri v2 + React + xterm.js + portable-pty. SSH profiles, WSL, split panes. Active in 2025.
- `Terax AI` (emee-dev): 7MB bundle. Tauri 2 + Rust + React 19 + portable-pty. AI-integrated. Featured on Hacker News.
- `tauri-plugin-pty` (Tnze): A Tauri 2 plugin for PTY embedding with xterm.js integration.

**portable-pty** is the Rust equivalent of node-pty. It's used by WezTerm's multiplexer backend. It wraps ConPTY on Windows and Unix PTYs on Linux/macOS. It's battle-tested at WezTerm scale.

**The real tradeoff**:

Tauri uses **Edge WebView2** on Windows. This means:
- You do not ship Chromium — you rely on the WebView2 runtime already on the user's machine (it ships with Windows 11 and Windows 10 updates).
- CSS/JS behavior is slightly different from Electron's pinned Chromium. `flex`, `grid`, custom properties — all work. But edge cases in WebGL, font rendering, and specific CSS features can differ.
- You cannot use `@electron/rebuild`. Instead, native interop is done through Tauri's Rust plugin system. IPC is done via Tauri `invoke()` commands and events.
- The development loop is different: Rust build times are longer, and Rust experience is required for any backend work.

**The honest verdict for afterterm**:

Tauri is the right long-term answer if you want a fast, small, native-feeling terminal. But:
1. The Rust backend adds friction if neither you nor your collaborators know Rust. Everything in the PTY layer (process spawning, resize, cleanup, session management) has to be written in Rust.
2. The ecosystem around Tauri terminals is immature compared to Electron. You'd be writing more from scratch.
3. xterm.js in WebView2 is proven (Terminon does it), so the renderer side is fine.

**For a first version that you want to ship**: Electron is the pragmatic call. It's the choice of VS Code (xterm.js + node-pty at massive scale), and the tooling (electron-builder, Forge, rebuild) is known. You accept the 300MB memory tax in exchange for months of saved development time.

A Tauri rewrite is a meaningful later option once the product is validated.

### Neutralinojs, Wails, NW.js

- **Neutralinojs**: Smaller than Electron, uses system WebView. No established terminal emulator projects. No node-pty equivalent — you'd have to spawn shells via its native API, which is limited.
- **Wails**: Go backend + WebView frontend. Some terminal toys exist, but portable-pty Rust binding doesn't translate. Would require Go-based PTY handling. Not proven.
- **NW.js**: Electron alternative, similar architecture. Less maintained, smaller community. No meaningful advantage for this use case.

**None of these are serious alternatives to Electron for a production terminal.** Only Tauri (via portable-pty) is a credible path.

---

## 5. Chrome Tab Group UX: What Actually Works

### The core mechanics Chrome got right

Chrome tab groups (introduced in Chrome 83, 2020) work because of five specific design decisions that together create the right mental model:

1. **Zero-friction creation**: Right-click a tab → "Add tab to group" or drag a tab onto another tab. No modal, no form to fill. The group appears immediately with a default color.

2. **Color + label as a system**: The colored bar under the tab group label is visible even when the group is collapsed to just a dot. Color gives instant recognition; label gives meaning. You can have either alone (label with default color, or colored unlabeled groups).

3. **Collapse to a dot**: Clicking the group label collapses all tabs to a single colored dot on the tab bar. The tabs are still loaded — you're not closing them. This is the key power move. It lets you hide 8 tabs with one click and get them back instantly.

4. **Draggable as a unit**: The group label can be dragged to reorder the entire group within the tab bar. Individual tabs can be dragged into or out of groups.

5. **Persistence**: Groups survive page reloads, browser restarts (with session restore enabled), and are visible in the "recently closed" menu.

### What translates to a terminal

| Chrome behavior | Terminal equivalent | Notes |
|---|---|---|
| Tab = web page | Tab = terminal session (PTY + shell) | Direct mapping. |
| Group has a name | Group has a project name ("rails api", "aws infra") | Same. |
| Group has a color | Group has a color | Same. Use a small color palette (6–8 colors). |
| Collapse group | Collapse group to a colored label in tab bar | Same interaction. Terminal tabs are cheaper to re-render than web pages when un-collapsed. |
| Drag tab into group | Drag terminal tab into a group | Same. |
| Drag group to reorder | Drag group label to reorder | Same. |
| New tab in group | "New tab here" from group label right-click | Terminal-specific: option to inherit CWD from sibling tab. |

### What's different in a terminal

1. **Tabs are more homogeneous**. Every browser tab has a favicon, a distinct URL, and page title that help distinguish them at a glance. Terminal tabs have a process name and a CWD. You need to be thoughtful about what info goes in the tab label so groups don't feel repetitive ("pwsh" × 5 is useless). Options: show CWD's last segment, show the running process, show a user-set label, or some combination.

2. **CWD inheritance on "new tab in group"** is a strong ergonomic win. If a group is "my rails project," new tabs in that group should default to opening at that project's path. Chrome has no equivalent because web pages don't have working directories.

3. **Groups-as-sessions**: The killer mental model for terminal groups isn't "I organized these tabs later" — it's **"I'm starting a project session and I want to group the tabs for it from the beginning."** The UX entry point matters. Both should work: drag-to-group (Chrome model) and "new group → open tabs into it" (session creation model).

4. **Terminal users are less likely to accumulate runaway tab counts.** Browser users get into trouble with 50+ tabs, which is why collapse is essential. Terminal users rarely open more than 10–15. Still design collapse as a first-class feature, but the primary value proposition in a terminal is **context switching between projects** (group A vs group B), not reducing visual clutter of 50 items.

5. **Broadcast to group**: A terminal-specific feature with no browser equivalent — "send this keypress/command to all tabs in the group." Optional but powerful. Don't design it in as required for v1, but don't design the architecture in a way that makes it impossible later.

### Implementation shape

At the data model level, a tab group is just:
```
Group {
  id: string
  label: string
  color: string  // hex or enum
  collapsed: boolean
  tabIds: string[]  // ordered
}
```

The tab bar renders groups as inline containers. The collapse state toggles `display: none` on the member tabs. Drag-and-drop is implemented with the HTML Drag and Drop API or a library like `@dnd-kit/core` (recommended — more accessible, more control than native DnD in Electron).

The React state tree: a `groups` array at the app level, a `tabs` array also at app level. Each tab has an optional `groupId`. Rendering: iterate the tab bar in order, grouping contiguous same-group tabs under a group header element.

---

## 6. Session Persistence and Crash Recovery

### The fundamental Windows constraint

On Windows with ConPTY, **you cannot reconnect to a running PTY from a new process**. This is not a node-pty limitation — it is a Windows kernel constraint. The PTY handle is tied to the owning process's lifetime. When Electron dies (crash or close), the ConPTY is gone.

Compare this to Unix PTYs, where persistent daemon approaches work because:
1. A daemon holds the PTY master fd.
2. The app connects to the daemon over a Unix socket.
3. If the app crashes, the daemon (and PTY) survive.
4. On relaunch, the app reconnects to the daemon socket.

This is how iTerm2's "session restoration" works. There is no direct Windows equivalent.

### What persistence looks like in the real world

**WezTerm + resurrect.wezterm**: The most mature cross-platform session restore available in a terminal. It saves the state of all windows, tabs, and panes (layout + CWD + foreground process) to a JSON file on a schedule. On restore, it respawns shells with `cd <saved-cwd>` and optionally re-runs the last command. Scrollback is NOT restored (the shell is dead, the output is gone). The plugin has known stability issues (random layout corruption, tab bar disappearing).

**VS Code terminal**: On restart, VS Code revives terminals by reopening them in the correct working directory. Scrollback from before the restart is lost. This is the honest and correct model for Windows.

**Zed's pty-host (2025)**: A Rust daemon that owns the PTY, with one daemon per session. The UI connects to it via socket. If the UI crashes, the daemon survives. On reconnect, it serializes the full in-memory terminal grid and sends it as a snapshot. This works on macOS/Linux. **On Windows it is unproven** — ConPTY would need to live in the daemon process, which means the daemon must be a Windows-native process, not a Unix daemon.

**Superset's persistent terminal daemon (January 2026)**: Each session runs a headless xterm.js emulator inside the daemon. On reconnect, the current screen state (not raw scrollback) is serialized and sent to the client. This is clever — it uses xterm.js itself as the state store. But it requires the daemon to stay alive as a separate process, which adds operational complexity.

### Realistic v1 persistence plan for afterterm

**What you can reliably ship**:

1. **On clean shutdown**: Serialize group structure (names, colors, tab order) + each tab's last known CWD (captured via OSC 7 from shell, or polled via `pwsh.exe -Command "(Get-Location).Path"`) to a JSON file.

2. **On relaunch**: Restore the group structure and tab names. Re-spawn each shell with `cd <saved-cwd>` as the initial command. Show a "Session restored" indicator.

3. **Scrollback**: Serialize the visible buffer of each terminal (xterm.js's `buffer.active` is accessible). On restore, write this text back to a fresh xterm instance. **This is cosmetic** — the lines are styled as read-only history, not connected to a live process. Label it clearly ("session history — shell restarted"). Users find this helpful for orientation.

4. **On crash**: Write the JSON file as a continuous background save (every ~30s). On next launch, detect the dirty state file and offer to restore.

**What to defer**:
- True live session reconnect (requires daemon architecture, weeks of work, unproven on Windows).
- Scrollback from crashed sessions beyond what was in the buffer (the data is gone when ConPTY dies).

---

## 7. Stack Recommendation and Risk Summary

### Recommended stack for v1

| Layer | Choice | Rationale |
|---|---|---|
| Desktop runtime | Electron (latest stable) | Proven with node-pty at VS Code scale. Best tooling. Accept memory overhead. |
| Terminal renderer | `@xterm/xterm` v6 + `@xterm/addon-webgl` | Only serious choice. Use WebGL renderer, fall back to canvas. |
| PTY | `node-pty` (Microsoft, latest) | Only proven Windows PTY solution in JS. |
| UI | React 18/19 | Standard. No reason to diverge. |
| Styling | CSS modules or Tailwind | Up to preference. Avoid styled-components in Electron for performance. |
| DnD for tab groups | `@dnd-kit/core` | Better than native HTML DnD in Electron context. |
| Build | Electron Forge with Webpack or Vite | Forge is the recommended path with Auto Unpack Native Modules plugin. |

### Risk register

| Risk | Severity | Likelihood | Mitigation |
|---|---|---|---|
| node-pty rebuild breaks after npm install | High (blocks dev) | High | Pin exact Electron version. Use `postinstall` hook to run `@electron/rebuild`. Document in CLAUDE.md. |
| ASAR packaging breaks conpty.node | High (blocks prod) | Medium | Configure `asar.unpack` from day one. Test packaged build before any demo. |
| Process tree orphans on tab close/crash | Medium (UX annoyance) | High (it will happen) | Implement `taskkill /T /F` tree cleanup. Test this explicitly. |
| ConPTY teardown assertion crash | Medium (crash on exit) | Medium | Implement async drain-and-kill sequence on app quit. Don't quit synchronously. |
| IPC throughput under heavy output | Medium (performance) | Medium | Implement chunk batching (16ms window) from day one. |
| WebGL context failure on user machine | Low (visual degradation) | Low | Graceful fallback to canvas renderer. Don't make WebGL a hard dependency. |
| xterm.js main thread saturation with many tabs | Medium (perf at scale) | High if you open 8+ tabs | Implement `pauseRendering()` on hidden tabs from day one. |
| Tab group DnD interaction complexity | Medium (UX debt) | Medium | Prototype the drag-to-group interaction before committing to the full tab bar design. |
| Users don't want dynamic drag-to-group | Medium (feature value risk) | Unknown | Talk to 3–5 terminal users before building. The project-session creation model might be more valuable. |
| Electron memory overhead user complaints | Low-Medium | Medium | Transparent in product positioning. Consider Tauri port after v1 validation. |

### What needs a prototype before full build

1. **Tab bar with groups + drag-and-drop**: The interaction complexity of "drag a tab onto another to create a group, drag the group label to reorder, collapse a group" is non-trivial in a React/Electron tab bar. Build this UI component in isolation (no PTY, fake tabs) and validate that the DnD feels right before coupling it to the terminal layer.

2. **node-pty + Electron IPC roundtrip latency on Windows**: Actually measure keypress-to-display latency with the ConPTY backend and your IPC design. Warp's team wrote in detail about discovering latency surprises when porting to Windows. Know your baseline before you have features.

3. **Multi-terminal rendering performance**: Open 6 xterm instances in one Electron window, all actively receiving output, and measure frame rate and memory. Do this before designing the tab group collapse feature, because if you're already struggling with 6 visible terminals you have a different problem to solve first.

---

## Sources and References

- [microsoft/node-pty — GitHub](https://github.com/microsoft/node-pty)
- [node-pty — npm](https://www.npmjs.com/package/node-pty)
- [xtermjs/xterm.js — GitHub](https://github.com/xtermjs/xterm.js)
- [@xterm/xterm — npm](https://www.npmjs.com/@xterm/xterm)
- [xterm.js Releases](https://github.com/xtermjs/xterm.js/releases)
- [node-pty does not work with latest Electron — Issue #728](https://github.com/microsoft/node-pty/issues/728)
- [Build against newer ConPTY — Issue #714](https://github.com/microsoft/node-pty/issues/714)
- [ConPTY assertion failure — OpenAI Codex Issue #13973](https://github.com/openai/codex/issues/13973)
- [ConPTY assertion failure teardown — OpenAI Codex Issue #14679](https://github.com/openai/codex/issues/14679)
- [Unable to kill pty process on Windows — Issue #437](https://github.com/microsoft/node-pty/issues/437)
- [Windows Terminal Group Tabs request — Issue #8267](https://github.com/microsoft/terminal/issues/8267)
- [Tabby workspace request — Issue #9279](https://github.com/Eugeny/tabby/issues/9279)
- [Tabby — GitHub](https://github.com/Eugeny/tabby)
- [WezTerm Workspaces docs](https://wezterm.org/recipes/workspaces.html)
- [WezTerm Features](https://wezterm.org/features.html)
- [resurrect.wezterm — GitHub](https://github.com/MLFlexer/resurrect.wezterm)
- [Warp launching on Windows (Feb 2025)](https://www.warp.dev/blog/launching-warp-on-windows)
- [Warp Windows & Tabs docs](https://docs.warp.dev/terminal/windows/tabs/)
- [marc2332/tauri-terminal](https://github.com/marc2332/tauri-terminal)
- [Terminon (Tauri terminal)](https://github.com/Shabari-K-S/terminon)
- [Terax AI terminal](https://github.com/emee-dev/terax-ai-tauri-terminal)
- [tauri-plugin-pty](https://github.com/Tnze/tauri-plugin-pty)
- [The Terminal That (Almost) Never Dies — Superset blog (Jan 2026)](https://superset.sh/blog/terminal-daemon-deep-dive)
- [RFC: Persistent terminal sessions — Zed discussion](https://github.com/zed-industries/zed/discussions/50584)
- [retach — persistent PTY daemon](https://github.com/gHexaByte/retach)
- [Electron Forge Auto Unpack Native Modules](https://www.electronforge.io/config/plugins/auto-unpack-natives)
- [Hyper's Architecture — ReadOSS](https://readoss.com/en/vercel/hyper/hypers-architecture-navigating-electron-terminal-emulator-codebase)
- [Ghostty Windows discussion](https://github.com/ghostty-org/ghostty/discussions/2563)
- [chrome.tabGroups API reference](https://developer.chrome.com/docs/extensions/reference/api/tabGroups)
- [Warp blog: Building Warp on Windows](https://www.warp.dev/blog/building-warp-on-windows)
- [Terminal Emulators Comparison Table 2026 — Terminal Trove](https://terminaltrove.com/compare/terminals/)
- [Tauri vs Electron 2026 comparison](https://tech-insider.org/tauri-vs-electron-2026/)
- [Electron performance docs](https://www.electronjs.org/docs/latest/tutorial/performance)
- [Electron Forge + node-pty — Thomas Deegan/Medium](https://thomasdeegan.medium.com/electron-forge-node-pty-9dd18d948956)
- [Scopir: Top 8 Terminal Emulators 2026](https://scopir.com/posts/best-terminal-emulators-developers-2026/)
- [xterm.js performance — pause rendering issue #880](https://github.com/xtermjs/xterm.js/issues/880)
- [VS Code Integrated Terminal — DeepWiki](https://deepwiki.com/microsoft/vscode/6-integrated-terminal)

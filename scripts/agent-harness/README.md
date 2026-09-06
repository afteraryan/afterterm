# agent-harness

Scripts that let an agent (or a person) launch the afterterm **dev build** in a
throwaway profile, put its window on a chosen display, drive it over the Chrome
DevTools Protocol (CDP) and take screenshots, all from the command line. Every
phase of the projects-and-threads work self-tests with this before handing over.

Plain Node (24+) and PowerShell. No new dependencies: Node's global `fetch` and
`WebSocket` are the whole CDP client.

## Safety rules the harness enforces and you must keep

- **Never close, kill or touch the running production afterterm.** Aryan's live
  shells run in it (`afterterm.exe` from `out\afterterm-win32-x64`). The harness
  only ever starts and stops `electron.exe` from `node_modules`, and `stop.mjs`
  kills by the recorded pid tree only, never by name. It refuses to run if the
  recorded tree contains an `afterterm.exe`.
- **Stay off the display a person is working on.** `launch.mjs` defaults to
  `--display secondary` and both the main window and the notifier overlay follow
  it. Verify placement with `drive.mjs bounds` (and the OS-level screenshot) before
  doing anything else with the window. Which monitor a person is using is not
  something the scripts can know: look at the OS screenshots of both displays
  first if in doubt.
- **Never write to `%APPDATA%\afterterm\session.json`.** Copy it somewhere
  disposable (read only from the source) and seed from the copy. `launch.mjs`
  refuses the real profile as `--data-dir`, and `--session` only reads its argument.
- **Do not resume a Claude session the live app has open.** The active tab of a
  copied live profile is exactly that session, and any other tab may be open there
  too. By default the seed strips every `claudeSessionId` (see `--claude-resume`);
  resuming the live session from the dev build made the live Claude Code process
  restart and the dev tree die. With `background` or `all`, a `click` on a
  restorable tab runs a real `claude --resume`.

## What each part does

| File | Role |
|---|---|
| `launch.mjs` | Seeds a throwaway `AFTERTERM_USER_DATA_DIR`, starts `electron-forge start` with the placement and debug-port env vars, waits for the DevTools endpoint, records pids. |
| `drive.mjs` | CDP client with subcommands: `targets`, `bounds`, `screenshot`, `eval`, `dom`, `click`, `rightclick`, `type`, `key`, `sidebar`. |
| `stop.mjs` | Kills exactly the recorded process tree and verifies it is gone. |
| `screenshot-display.ps1` | Captures a whole physical display to PNG (shows native title bars and the notifier toasts, which CDP cannot). |
| `lib.mjs` | Shared: arg parsing, run records, process tree walk, WMI spawn, display and window queries, the CDP client. |

Main-process support lives in `src/main.ts`:

- `AFTERTERM_DISPLAY=primary|secondary|<index>` picks the display for the main
  window (centred, sized to fit the work area) and the notifier overlay. Unset
  means the normal behaviour, unchanged. `secondary` is the first non-primary
  display and falls back to primary on a single-monitor machine.
- `AFTERTERM_REMOTE_DEBUG_PORT=<n>` turns on Chromium's remote debugging port.
  Opt-in only, because an open port lets any local process script the app.
- `AFTERTERM_HARNESS=1` is set on the app and so inherited by its shells; nothing
  reads it yet, it is there so future code can tell a harness run apart.

## Launch

```powershell
# copy the real session somewhere disposable (read only from the source)
Copy-Item "$env:APPDATA\afterterm\session.json" "$env:TEMP\session-copy.json"

npm run harness -- --session "$env:TEMP\session-copy.json"
# or with every option spelled out:
node scripts/agent-harness/launch.mjs --session "$env:TEMP\session-copy.json" `
  --display secondary --port 9333 --data-dir "$env:TEMP\afterterm-run" --timeout 120
```

Options:

- `--session <file>`: session.json to seed from. Omit for an empty start.
- `--data-dir <dir>`: user-data dir (default: a fresh `%TEMP%\afterterm-agent-harness\run-<timestamp>`).
- `--display primary|secondary|<n>`: default `secondary`.
- `--port <n>`: remote debugging port, default `9333`.
- `--log <file>`: dev build stdout and stderr, default `<data-dir>\harness.log`.
- `--timeout <seconds>`: wait for the DevTools endpoint, default 120.
- `--claude-resume none|background|all`: default `none`, which strips every
  `claudeSessionId` so no launch or click can resume a real session. `background`
  removes only the active tab's id, so nothing resumes at launch while other tabs
  keep their restorable marker and resume when clicked. `all` seeds the copy
  unchanged (the active tab resumes at once).

What it does, in order: creates the data dir, writes `session.json` (from the
parsed copy) and `prefs.json` with `claudeHookToastShown: true` (so the one-time
"Claude Code notifications enabled" toast does not fire on a fresh profile; the
hook self-install stays enabled and is idempotent), starts `node
node_modules/@electron-forge/cli/dist/electron-forge.js start` from the repo root
(resolved from the script's location, so a worktree drives its own sources), waits
for `http://127.0.0.1:<port>/json/version`, then for the main window's page
target, finds the `electron.exe` browser process (the owner of the listening
socket), and writes the run record to `<data-dir>\harness.json` and to
`%TEMP%\afterterm-agent-harness\latest.json` so the other scripts need no arguments.

The record holds `pid` (a `cmd.exe` wrapper that only redirects output to the log),
`rootImage`, `electronPid`, `electronPath`, `port`, `display`, `dataDir`, `log`,
`startedAt`, `sessionSource`, `claudeResume`, `tree` and `targets`.

The dev build is created through WMI (`Win32_Process.Create`), not
`child_process`. A child spawned the ordinary way, even `detached`, died together
with the agent's tool shell when that shell was recycled; a WMI-created process
has the WMI host as its parent and no tie to the caller's console or process group.

## Drive

```powershell
npm run harness:drive -- <command> [args] [--port 9333 | --data-dir <dir>]
node scripts/agent-harness/drive.mjs <command> ...
```

| Command | Example | What it does |
|---|---|---|
| `targets` | `drive targets` | Lists DevTools targets (the main window is the page whose URL has no `?notifier=1`). |
| `bounds` | `drive bounds` | JSON: the electron process's visible top-level windows in physical pixels with the display each is on (`os`), the page's own view (`page`, Chromium DIP layout) and the displays. |
| `screenshot` | `drive screenshot out.png` | PNG of the main window's web content via `Page.captureScreenshot`. |
| `eval` | `drive eval "document.title"` | `Runtime.evaluate`, promises awaited, result printed as JSON. |
| `dom` | `drive dom ".tab-row"`, add `--html` for outerHTML | Match count plus tag, classes and trimmed innerText per match. |
| `click` | `drive click ".tab-row" 2` | Scrolls the element into view and dispatches a real `mousePressed` and `mouseReleased` at its centre through `Input.dispatchMouseEvent`, so React handlers and dnd-kit see a user-like click. Index defaults to 0. |
| `rightclick` | `drive rightclick ".group-header" 0` | Same with the right button (opens context menus). |
| `type` | `drive type "hello"` | `Input.insertText` into the focused element. |
| `key` | `drive key Enter`, `drive key b --ctrl --shift` | `Input.dispatchKeyEvent` down and up. Known names: Enter, Escape, Tab, Backspace, Delete, Space, Arrow keys, Home, End, PageUp, PageDown, F5, or any single character. Modifiers: `--ctrl`, `--shift`, `--alt`. |
| `sidebar` | `drive sidebar` | The rendered sidebar as a tree: one block per section (General, Pinned, Projects); project rows with label, thread count, collapsed state and the counter pills (`need=`, `run=`); thread rows with title, `*` for active, `[kind/state]` from the row's kind icon and state icon, `[x]` when the row's close button is present, `[restorable]`; a `(Show N more)` line where a list is folded. Collapsed, the panel reports `(collapsed, rail only)` and lists nothing. |

The sidebar selectors live in the `SEL` object at the top of `drive.mjs`,
read from `src/renderer/components/SidePanel/index.tsx` and `SidePanel.css`.
When a phase renames classes, update that one object.

## Prove the window is on the secondary display

1. `drive bounds`: the `os` entry for the `afterterm` window must show
   `onDisplay.primary: false` (on this machine `x >= 1920`). Trust `os`, not
   `page`: Chromium lays displays out in its own DIP space (here DISPLAY2 sits at
   DIP `1536,-216`), so `page.x` and `displays` are not comparable.
2. `pwsh -File scripts/agent-harness/screenshot-display.ps1 -Display 2 -Out shot2.png`
   shows the app; `-Display 1` shows nothing new. `-Display` is 1-based in
   Windows' screen order (1 is normally the primary). Write screenshots to a
   scratch folder, not into the repo.

The dev build's notifier overlay follows `AFTERTERM_DISPLAY` too, so its toasts
land on the same display; `screenshot-display.ps1` is the only way to see them.

## Stop

```powershell
npm run harness:stop
node scripts/agent-harness/stop.mjs [--data-dir <dir>]
```

Reads the run record, checks the recorded pid still exists and is still the
recorded image (a reused pid is refused), walks the tree, refuses if it holds any
production afterterm process, kills the verified pid list with `taskkill /F`,
polls until every pid is gone, and writes `stoppedAt` and `killed` into the
record. The data dir is kept for inspection.

It does not use `taskkill /T`. Windows keeps a dead parent's pid on orphaned
processes and reuses pids, so a parent-id walk can pull in an unrelated old
process (seen in testing: `OneDrive.Sync.Service.exe` showed up under a fresh
`electron.exe`). The tree walk in `lib.mjs` drops any "child" created before its
parent, and only that list is killed.

## Typical session for a phase self-test

```powershell
Copy-Item "$env:APPDATA\afterterm\session.json" "$env:TEMP\session-copy.json"
npm run harness -- --session "$env:TEMP\session-copy.json"
npm run harness:drive -- bounds                       # os.onDisplay.primary must be false
pwsh -File scripts/agent-harness/screenshot-display.ps1 -Display 2 -Out "$env:TEMP\shots\d2.png"
npm run harness:drive -- sidebar
npm run harness:drive -- screenshot "$env:TEMP\shots\before.png"
npm run harness:drive -- click ".group-header" 0
npm run harness:drive -- screenshot "$env:TEMP\shots\after.png"
npm run harness:stop
```

Renderer edits (`src/renderer/**`) show up live in the running harness app through
Vite HMR; no relaunch needed. A `src/main.ts` or `src/preload.ts` edit makes forge
restart Electron under a new pid: `drive` re-resolves the electron pid from the
port, and `stop` walks the tree, so both keep working, but any in-page state is lost.

## Known limitations

- CDP screenshots show only the web content of the main window: no native title
  bar, no notifier overlay, no context menus that are separate windows (there are
  none today; the app's menus are DOM). Use `screenshot-display.ps1` for those.
- `Browser.getWindowForTarget` is not implemented by Electron's DevTools endpoint,
  which is why `bounds` uses an OS query for the window rectangle.
- `key` goes through Chromium's input pipeline; the app's global shortcuts are
  registered in the main process via `before-input-event`, which does see
  CDP-dispatched keys (verified: `key b --ctrl --shift` toggles the side panel),
  but keys typed into an xterm.js terminal reach the shell only if the terminal
  has focus (click it first).
- The app's context menus close on an outside click, not on Escape: after a
  `rightclick`, dismiss with `click "#root"` (or act on a `.ctx-menu-item`).
- One harness run per port. A second `launch` on a busy port is refused.
- Two dev servers (a manual `npm start` and a harness run) both want Vite's
  default port; Vite moves to the next free one, but keep to one at a time.
- The harness inherits the caller's environment. Run it from a shell with a
  normal `PATH` (it needs `node`, `powershell.exe`, `taskkill.exe`).
- Windows only, like the app.

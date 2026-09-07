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
  restart and the dev tree die. From Phase 4 on, nothing resumes automatically:
  a relaunch shows every previous chat thread asleep, and a click opens the
  Asleep tab or the asleep pane without spawning anything. What still runs a
  real `claude --resume` is a **Wake**, whether clicked on the asleep pane's
  `[data-wake]` button or chosen from a thread's ⋯/right-click menu, so
  `--claude-resume`'s default of `none` (and care with `background`/`all`)
  still matters: only `wake` a thread you mean to actually resume.

## What each part does

| File | Role |
|---|---|
| `launch.mjs` | Seeds a throwaway `AFTERTERM_USER_DATA_DIR`, starts `electron-forge start` with the placement and debug-port env vars, waits for the DevTools endpoint, records pids. |
| `drive.mjs` | CDP client with subcommands: `targets`, `bounds`, `screenshot`, `eval`, `dom`, `click`, `rightclick`, `hover`, `unhover`, `drag`, `emulate-media`, `type`, `key`, `sidebar`, `screen`, `home`, `project`, `chooser`, `palette`, `header`, `hover-card`, `pane`, `tail`, `window`, `record`. |
| `stop.mjs` | Kills exactly the recorded process tree and verifies it is gone. |
| `screenshot-display.ps1` | Captures a whole physical display to PNG (shows native title bars and the notifier toasts, which CDP cannot). |
| `record.mjs` | Long-running recorder: CDP screencast of the page content, stitched to mp4 with ffmpeg. Normally started detached by `drive.mjs record start`, not run by hand. See "Recording a test session" below. |
| `lib.mjs` | Shared: arg parsing, run records, process tree walk, WMI spawn, display and window queries, the CDP client. |

Main-process support lives in `src/main.ts`:

- `AFTERTERM_DISPLAY=primary|secondary|<index>` picks the display for the main
  window (centred, sized to fit the work area) and the notifier overlay. Unset
  means the normal behaviour, unchanged. `secondary` is the first non-primary
  display and falls back to primary on a single-monitor machine.
- `AFTERTERM_REMOTE_DEBUG_PORT=<n>` turns on Chromium's remote debugging port.
  Opt-in only, because an open port lets any local process script the app.
- `AFTERTERM_HARNESS=1` is set on the app and so inherited by its shells. Since Phase 4
  the main window's close handler reads it: a harness run skips the "terminals still
  running" confirm dialog and quits at once, which is what lets `drive window quit`
  exercise the quit flush without anyone there to click a button.

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
- `--prefs <file>`: a JSON object merged into the generated `prefs.json` on top of `claudeHookToastShown: true`. Seeding `lastOpenedAt` (a time over an hour back) makes Home show its "Last here" line; without it a fresh profile is a first launch and shows nothing.
- `--data-dir <dir>`: user-data dir (default: a fresh `%TEMP%\afterterm-agent-harness\run-<timestamp>`).
- `--display primary|secondary|<n>`: default `secondary`.
- `--port <n>`: remote debugging port, default `9333`.
- `--log <file>`: dev build stdout and stderr, default `<data-dir>\harness.log`.
- `--timeout <seconds>`: wait for the DevTools endpoint, default 120.
- `--claude-resume none|background|all`: default `none`, which strips every
  `claudeSessionId` so no thread can `claude --resume` a real session. `background`
  removes only the active tab's id, so nothing resumes at launch while other tabs
  keep their id and can be resumed with `Wake` (Phase 4: waking, not clicking, is
  what runs `claude --resume`; see the safety rule above). `all` seeds the copy
  unchanged (the active tab's session is live at launch, since it was live when
  the source `session.json` was copied).

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
| `screenshot` | `drive screenshot out.png`, `drive screenshot out.png --window` | PNG of the main window's web content via `Page.captureScreenshot`. With `--window`, captures the whole OS window instead (see "Capturing an occluded window" below). |
| `eval` | `drive eval "document.title"` | `Runtime.evaluate`, promises awaited, result printed as JSON. |
| `dom` | `drive dom ".tab-row"`, add `--html` for outerHTML | Match count plus tag, classes and trimmed innerText per match. |
| `click` | `drive click ".tab-row" 2` | Scrolls the element into view and dispatches a real `mousePressed` and `mouseReleased` at its centre through `Input.dispatchMouseEvent`, so React handlers and dnd-kit see a user-like click. Index defaults to 0. |
| `rightclick` | `drive rightclick ".group-header" 0` | Same with the right button (opens context menus). |
| `hover` | `drive hover ".pr" 0`, `drive hover ".th" 0 --wait 400` | Scrolls the element into view, then steps the pointer onto its centre in a couple of `mouseMoved` events (so CSS `:hover` and React's `onMouseEnter` both see a real enter, not a teleport) and leaves it there. Prints the centre. `--wait <ms>` pauses after the move, before the command returns: the thread hover card appears 350ms after the pointer enters a row, so `drive hover ".th" 0 --wait 400` then `drive hover-card` in a second call sees it. |
| `unhover` | `drive unhover` | Moves the pointer to (2, 2) of the viewport, the title bar strip, which has no hover targets. |
| `drag` | `drive drag ".tab-row" 0 ".tab-row" 2 --hold-ms 600` | Presses at the source element's centre, steps to the target element's centre (`--steps`, default 12, 16ms apart), an optional dwell at the target (`--hold-ms`, default 0; dnd-kit's dwell-to-group needs 600), then releases. An index is a bare integer right after its selector, so the two selector/index pairs never need extra flags to disambiguate. |
| `emulate-media` | `drive emulate-media reduce` | `Emulation.setEmulatedMedia` for `prefers-reduced-motion`: `reduce`, `no-preference`, or `off` to clear every emulated feature. |
| `type` | `drive type "hello"` | `Input.insertText` into the focused element. |
| `key` | `drive key Enter`, `drive key b --ctrl --shift` | `Input.dispatchKeyEvent` down and up. Known names: Enter, Escape, Tab, Backspace, Delete, Space, Arrow keys, Home, End, PageUp, PageDown, F5, or any single character. Modifiers: `--ctrl`, `--shift`, `--alt`. |
| `sidebar` | `drive sidebar` | The rendered sidebar as a tree: one block per section (General, Pinned, Projects); project rows with label, thread count, collapsed state and the counter pills (`need=`, `run=`); thread rows with title, `*` for active, `[kind/state]` from the row's kind icon and state icon, `[asleep]` when the row carries the `sleep` class, `[x]` when the row's close button is present; a `(Show N more)` line where a list is folded. Collapsed, the panel reports `(collapsed, rail only)` and lists nothing. Phase 4 removed the `restorable` class and its `[restorable]` marker; asleep is the only sleep-state marker now. |
| `screen` | `drive screen` | One JSON object: `screen` (`home`, `workspace` or `project`, from `.app`'s `data-screen`), `entrance` (the `enter-home` / `enter-project` / `enter-workspace` class while it's still on `.app`, or `null`), and whether the search palette, new-thread chooser, a menu, a dialog, or a toast is present. |
| `home` | `drive home` | The rendered Home screen as a tree: the date heading, the `need`/`run` totals, one line per pinned card (name, pills, relative time, pin state), one line per project row, the "Show more" line when present, and the archived section (its toggle line, then its rows once expanded). `(not on Home)` when `.home` is absent. |
| `project` | `drive project` | The rendered project page: title, folder line, the action buttons under `.ph .acts` with their disabled state, the selected tab plus the other tab labels (printed first, so a reader always knows which list the rows below belong to), the search box value, then one line per row. Live and Asleep rows (`.tl[data-tab-id]`) print name, state and time as before. History rows (`.tl[data-history-id]`, Phase 4) have no state icon, so they print as `- "title" [chat|shell] <time> [resume]`, kind read from the row's `.d` text and `[resume]` shown only when the row carries a `[data-resume]` button. `(not on a project page)` when `.proj` is absent. |
| `chooser` | `drive chooser` | The new-thread chooser's input value, one line per option (project id, name, tag, `*` when highlighted), and the shell label. `(no chooser open)` when absent. |
| `palette` | `drive palette` | The search palette's input value, then each group header (`.gl`, e.g. Projects, Threads and Phase 4's History) followed by its rows (kind, id, name, meta text, `*` when highlighted), or the empty-state text. History rows carry `data-kind="history"` and a meta like "project · 3d", read the same generic way as project and thread rows. `(no palette open)` when absent. |
| `header` | `drive header` | The main pane header as a tree: the name line, the kind (when the name line carries a `data-kind` attribute), one `<data-meta>=<text>` line per header meta item, the state chip text or `(quiet)` (Phase 4: an asleep thread's chip reads "Asleep · 2d"). `(no thread)` when the header shows its empty state. `(no .header in the DOM)` when the header itself is absent. |
| `hover-card` | `drive hover ".th" 0 --wait 400` then `drive hover-card` | The thread hover card: the title, then one `<data-row>: <text>` line per `dl` row. `(no hover card)` when absent. The card appears 350ms after the pointer enters a thread row, so hover first with `--wait` (see the `hover` row above) before reading it. |
| `pane` | `drive pane` | Phase 4: the asleep pane (`.asleep-pane`) that covers the terminal card while the active thread is asleep, as a tree: `asleep pane for <tab id>`, `wake button: yes\|no`, `since: <text>`, `past lines: <N>` and the last 5 saved tail lines indented (or `past: (none)` while the tail is loading or empty). When no thread is asleep, prints `(terminal)` and `terminal: shown\|hidden` (whether `.terminal-instances` carries `asleep-hidden`). |
| `tail` | `drive tail`, `drive tail 10`, `drive tail 10 --tab <id>` | Phase 4: the last n lines (default 30) of an xterm buffer, read through `window.__afterterm.activeTail(n)` for the active tab or `window.__afterterm.tail(id, n)` for `--tab <id>`. One line per entry; `(no terminal)` when the hook is missing or the tab has no live terminal (e.g. it is asleep). |
| `window` | `drive window bottom`, `drive window restore`, `drive window quit`, `drive window close-dialogs` | OS-level window control (see "Capturing an occluded window" below). `quit` posts WM_CLOSE to the main window and waits for the process to exit: a graceful quit, so the renderer's quit flush runs (session.json with every thread stamped asleep, and every live terminal's tail file), which `stop.mjs`'s hard kill skips. The dev build answers its own "terminals still running" confirm when `AFTERTERM_HARNESS=1` (`src/main.ts`), so nothing waits on a dialog. |
| `record` | `drive record start --out out.mp4`, `drive record stop`, `drive record status` | Starts, stops and lists screen recordings of the page content (see "Recording a test session" below). |

The sidebar selectors live in the `SEL` object at the top of `drive.mjs`,
read from `src/renderer/components/SidePanel/index.tsx` and `SidePanel.css`.
When a phase renames classes, update that one object. `SEL.home`, `SEL.project`,
`SEL.chooser` and `SEL.palette` hold the same kind of selector map for the
Phase 2 screens; they read from the DOM hooks each screen's component is
supposed to keep (`docs/design-02-projects-and-threads.md` and the components
themselves), not from `SidePanel`. `SEL.header` (Phase 3, `src/renderer/components/Header/index.tsx`
and `Header.css`) and `SEL.hoverCard` (Phase 3, the thread hover card) follow the
same pattern, as does `SEL.asleepPane` (Phase 4, `src/renderer/components/AsleepPane/index.tsx`).

### Hover, drag and reduced motion

`hover` and `drag` use `Input.dispatchMouseEvent` the same way `click` does,
just with more than one event: `hover` steps the pointer onto the element over
a couple of moves so React's `onMouseEnter` fires on an actual enter rather
than a single teleport, and `drag` presses, steps toward the target (clearing
dnd-kit's 6px activation distance on the very first move), optionally dwells,
then releases. Neither command remembers where the pointer was from an earlier
invocation, since each `drive.mjs` call is a separate process: `hover` starts
its steps a little above and to the left of the element, `drag` starts exactly
at the source element's centre.

`emulate-media reduce|no-preference|off` sets `Emulation.setEmulatedMedia` for this one DevTools
session. The emulation lives only for the session that set it. Every `drive` command opens
its own session, so the bare command has no lasting effect. To observe the emulation, pair
it with `--click "<selector>"`, `--wait <ms>`, `--eval "<js>"` and `--screenshot <png>` in
the same call (example: `drive emulate-media reduce --click ".side-panel .brand .ic[data-go='home']"
--wait 60 --eval "getComputedStyle(document.querySelector('.home')).animationName"`).
`off` clears every emulated feature back to the OS setting.

### Hover-only controls

The sidebar project row's +, project page action buttons, and pin buttons have no width
until the row is hovered. To click these, `hover` the same row first, then `click` the button
(click scrolls but does not move the pointer). Home's card and row buttons fade in but keep
their size, so a plain `click` works there.

### Screens

`screen`, `home`, `project`, `chooser`, `palette`, `header`, `hover-card` and `pane`
read the Phase 2 through 4 UI the way `sidebar` reads the side panel: DOM
lookups through the `SEL` object, printed as a plain tree (or JSON for
`screen`, since it is a small flag set rather than a list). Each one reports
its own "not open", "not on this screen" or "no thread" line instead of
throwing, so a command can be used to check whether a screen or overlay is
showing at all.

## Recording a test session

`drive.mjs record` drives `record.mjs`, a long-running recorder that captures the page
content through CDP screencast frames (`Page.startScreencast`), the same view `screenshot`
sees. That means a recording works even while the dev window is pushed to the bottom of the
z-order for a test: no native title bar, no notifier overlay toasts, no mouse cursor, nothing
the OS is drawing outside the page itself. For those, capture a whole display instead
(`screenshot-display.ps1`).

```powershell
node scripts/agent-harness/drive.mjs record start --out docs/screenshots/phase-3/15-sidebar-drag-to-group.mp4
node scripts/agent-harness/drive.mjs sidebar
node scripts/agent-harness/drive.mjs drag ".th" 0 ".th" 2 --hold-ms 600
node scripts/agent-harness/drive.mjs sidebar
node scripts/agent-harness/drive.mjs record stop
```

`record start` waits for the first frame (up to 10s) before printing `recording <out>`, so a
script that starts a recording and immediately drives the app does not race an empty video.
`record stop` (no `--out` needed if it is the only recording running) writes a stop file the
recorder polls for, waits up to 60s for the recorder process to exit, then prints the last
lines of its log and the final path.

Chromium only sends a frame when the page actually changes, so a recording plays back in real
time by frame timestamp, not at a fixed rate: `record.mjs` stitches with ffmpeg's concat
demuxer and a computed per-frame duration, so a long quiet stretch between two clicks does not
bloat the file, and frames that arrive faster than the target rate (a screen transition, a
terminal printing) are dropped so a burst does not stretch the timeline. Only the mp4 lands at
`--out`; the frames, the stop file, the logs and the pid record live under
`<data-dir>\recordings\<name>\` (the run record's data dir), so nothing but the video sits
beside the screenshots. `record.mjs` needs `ffmpeg` on `PATH`; if it is missing, the captured
frames are kept in that work folder along with the exact ffmpeg command to stitch them by hand,
and recording still reports success rather than failing the test run.

Recordings for a phase go in `docs/screenshots/<phase>/` next to that phase's screenshots,
numbered the same way, and are kept forever like the screenshots (see
`docs/screenshots/README.md`).

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

## Capturing an occluded window

CDP's `Page.captureScreenshot` only ever sees the web content, and it needs the
page actually painted: it hangs if the window is minimised and misses whatever
another window is covering. Two commands work around both:

- `drive screenshot out.png --window` captures the whole OS window (native title
  bar included) through `PrintWindow` with `PW_RENDERFULLCONTENT`, which asks the
  window to paint into a bitmap directly rather than reading back the screen, so
  it still works while another window sits on top. It writes and runs a small
  inline PowerShell script (`Add-Type` for `GetWindowRect` and `PrintWindow`,
  a `System.Drawing.Bitmap`, saved as PNG), the same way `bounds`'s window query
  does.
- `drive window bottom` pushes the main window to the bottom of the z-order
  without activating it (`SetWindowPos` with `HWND_BOTTOM`,
  `SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE`), so a screenshot of "whatever the
  user is actually looking at instead" can be taken without ever giving the
  harness window focus. `drive window restore` shows it again without
  activating it (`ShowWindow` with `SW_SHOWNOACTIVATE`) so later CDP
  screenshots stop hanging. Both print the window handle and the raw Win32
  result.
- `drive window close-dialogs` closes any stray native dialog (a file picker
  opened by mistake, a message box) by posting `WM_CLOSE` to every visible
  window of class `#32770` under the electron process; prints "no native
  dialogs found" when there are none.

The window these three act on is picked by area: among the electron process's
visible top-level windows, the main window is the largest one, which tells it
apart from the small notifier-overlay toast strip without depending on window
title text (the main window's title is the page's own `document.title`, which
changes with the active tab).

The dev window can be pushed behind other windows with `window bottom` and still
captured with `screenshot <png>` (CDP renders an occluded window) or
`screenshot <png> --window` (PrintWindow also works through occlusion).

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

# Phase 2 flow: Home, project page, new-thread chooser, and search palette
Copy-Item "$env:APPDATA\afterterm\session.json" "$env:TEMP\session-copy.json"
npm run harness -- --session "$env:TEMP\session-copy.json"
npm run harness:drive -- home                         # Home screen
npm run harness:drive -- click ".home .pr[data-group='<id>'] [data-pin]"
npm run harness:drive -- project                      # Project page
npm run harness:drive -- key t --ctrl --shift
npm run harness:drive -- chooser                      # New-thread chooser
npm run harness:drive -- key p --ctrl --shift
npm run harness:drive -- palette                      # Search palette
npm run harness:stop

# Phase 4 flow: sleep, wake, the scrollback tail, and the project page's History tab
Copy-Item "$env:APPDATA\afterterm\session.json" "$env:TEMP\session-copy.json"
npm run harness -- --session "$env:TEMP\session-copy.json"
npm run harness:drive -- sidebar                       # relaunched threads show [asleep], never [restorable]
npm run harness:drive -- click ".th" 0
npm run harness:drive -- pane                           # asleep pane: wake button, "asleep since", saved tail
npm run harness:drive -- click "[data-wake]"
npm run harness:drive -- tail 10                        # the dim saved tail, then a "Woke just now" divider, then live output
npm run harness:drive -- rightclick ".th" 0
npm run harness:drive -- dom ".ctx-menu-item"            # find Sleep's index first
npm run harness:drive -- click ".ctx-menu-item" <n>      # Sleep
npm run harness:drive -- pane                            # asleep again, "since just now"
npm run harness:drive -- rightclick ".th" 0
npm run harness:drive -- click ".ctx-menu-item" <n>      # Open project page
npm run harness:drive -- click ".tabs .seg button" 2     # the History tab (check the index with `drive project` first)
npm run harness:drive -- project                         # History rows: "title" [chat|shell] time [resume]
npm run harness:drive -- click "[data-resume]"
npm run harness:stop
```

Renderer edits (`src/renderer/**`) show up live in the running harness app through
Vite HMR; no relaunch needed. A `src/main.ts` or `src/preload.ts` edit does NOT restart
Electron: the bundle is rebuilt but the running process keeps its old code. To pick up
a main-process change, `npm run harness:stop` and launch again. This bites Phase 4
particularly often: sleep, wake and the scrollback tail file are all main-process work.

## Known limitations

- An HMR update of `src/renderer/components/Terminal/index.tsx` remounts every
  terminal at once. On 2026-09-07, this took the whole dev build down (the DevTools
  endpoint vanished). After editing that file, expect to relaunch the harness.
- CDP screenshots show only the web content of the main window: no native title
  bar, no notifier overlay, no context menus that are separate windows (there are
  none today; the app's menus are DOM). Use `screenshot-display.ps1`, or
  `screenshot --window`, for those.
- CDP screenshots hang while the window is minimised (Chromium does not paint a
  minimised window). Restore it first with `drive window restore` rather than
  clicking it (clicking would activate it, which is what `window restore`
  deliberately avoids).
- A native file dialog opened by mistake (a stray `dialog.showOpenDialog` click)
  blocks the app until someone closes it by hand. `drive window close-dialogs`
  closes any such dialog by posting `WM_CLOSE` to it, cheaper than reaching for
  the mouse.
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
- A recorder started with `record start` is a separate WMI-spawned process, not part of the
  electron tree, so `stop.mjs` does not kill it. Call `record stop` before `stop.mjs`; a
  recorder left running against a stopped app just keeps polling for its stop file with a
  dead CDP session, harmless but orphaned (`record status` shows its pid, killable by hand).

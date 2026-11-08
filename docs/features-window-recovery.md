# Window recovery: the window comes back by itself (AFT-33)

Built 2026-11-08 and 2026-11-09. Linear: AFT-33. Captures: `docs/screenshots/reload-and-recovery/` (10 to 50, 53 and 54).

## Why it exists

On 2026-10-02, after two days of running on a PC with 369 MB of 16 GB free, afterterm's window froze and then went blank while every shell and Claude session in it kept running. Minimising, restoring and a graphics driver reset (Win+Ctrl+Shift+B) changed nothing. Ending afterterm's GPU process by hand brought the window back without text (only the red and green of Claude Code's diffs), and a font size change brought each terminal's text back, one terminal at a time. Closing the app was not an option: it would have stopped everything. Aryan asked for recovery of the app's own, broader than graphics alone.

## What it does

**A page that crashes reloads.** `guardRenderer` in `main.ts`, for the main window and the notifier, listens to `render-process-gone`. Any reason but `clean-exit` (and nothing while quitting) reloads the page one second later (`afterRendererGone`, `RELOAD_DELAY_MS` in `window-recovery.ts`).

**A page that hangs is ended, then reloads.** On `unresponsive`, a 15 second timer starts (`HANG_GRACE_MS`); `responsive` cancels it. When it runs out, main calls `forcefullyCrashRenderer()`, which reports as gone and reloads through the same path (Electron's own advice for a hung page). No dialog: the point is that it comes back by itself.

**A page is not reloaded in a tight loop.** At most three reloads within a minute (`allowReload`). A refused reload waits until the oldest leaves the minute and is tried then (`retryInMs`), so the window still comes back once whatever crashed it has passed.

**A reload keeps the threads.** Before this, a reload (`drive reload`, Ctrl+Shift+R before AFT-26, a crash) restored every thread asleep, but main never killed their shells: they ran on out of sight, and a Wake started a second shell beside the first, both writing to the same terminal (captures 41 to 43). Now:

- the page asks main `recovery:state` as it restores: the shells main still holds, with the port each was last seen on, and what the page last showed;
- `restoreWithLive` in `sleepWake.ts` brings a thread whose shell is alive back awake (`reattachedTab`: no `sleptAt`, the port main sees now), every other thread asleep as on a launch (`restoredTab`); a live shell no saved thread names is an orphan and the page ends it;
- the terminal layer creates a fresh xterm and calls `pty:create` as for a wake, but main, already holding a shell for that id, answers `attached: true` and spawns nothing. The page then types nothing into it (no `claude --resume`, no server command), so a chat's Claude Code and a server run on untouched;
- a size change (one row less, then the real size, 60ms apart) makes ConPTY draw the whole screen again into the new terminal, and Claude Code redraw itself, so a terminal shows its current screen, not a blank one. The scrollback above the screen is gone with the old page;
- the page opens where it was: main keeps the screen, project page and active thread in memory (`recovery:ui`), and `screenAfterReload` uses them, falling back to Home when the project is gone. Nothing is remembered on a launch, so a launch opens Home and every thread asleep, unchanged (capture 37);
- main also forgets which record status and children flags it last sent, so the next pass sends every live thread's again to the new page.

**The latest state survives a crash.** The file save waits two seconds after a change, and a crashed or hung page never writes its last changes. So the page also sends its state to main 250 ms after any change (`session:remember`, throttled, memory only), every save lands there too, and `session:load` reads that copy when it has one. A thread created a second before a crash comes back awake (captures 35 and 36: it was not yet in `session.json` on disk).

**A terminal's graphics recover.** xterm's WebGL addon waits 3 seconds for a lost context to come back. When it does not, `onContextLoss` fires: the terminal disposes the addon and loads a fresh one, until three losses (`rendererAfterLoss`, `WEBGL_MAX_LOSSES`), after which xterm's DOM renderer draws it. When the context does come back (`webglcontextrestored`, caught on the container in the capture phase), the terminal redraws from a fresh glyph atlas a frame later (`clearTextureAtlas` and `refresh`): what a font size change did by hand. When the GPU process goes away (`app` `child-process-gone`, type `GPU`), main sends `recovery:repaint` and every terminal redraws the same way, which keeps their scrollback, unlike a reload. Other processes going away are only logged.

**Everything is logged.** One line per event in `<userData>\recovery.log` (capped at 256 KB, keeping its newer half) and the console: renderer gone with its reason, unresponsive, ended, reloading, a refused reload and when it will be tried, a page loaded with live shells, a process gone. A packaged build has no other log, and this is how an incident nobody watched can be read afterwards.

## Where it lives

- `src/window-recovery.ts`: the pure rules. `src/window-recovery.test.ts`.
- `src/renderer/sleepWake.ts`: `LiveThread`, `reattachedTab`, `restoreWithLive`, `RememberedUi`, `screenAfterReload`. Tests in `sleepWake.test.ts`.
- `src/main.ts`: `recoveryLog`, `reloadForRecovery`, `guardRenderer`, the `child-process-gone` handler, `recovery:ui`, `recovery:state`, `recovery:test`, `pty:create`'s attach, `session:remember` and the remembered copy in `session:load`.
- `src/preload.ts`, `src/afterterm.d.ts`: `recovery` and `session.remember`; `pty.create` answers `attached`.
- `src/renderer/hooks/useTabState.ts`: `restoreSession(saved, live)`.
- `src/renderer/app.tsx`: the restore with the live shells, orphans ended, the screen after a reload, `REMEMBER_MS` and `noteUi`.
- `src/renderer/components/Terminal/index.tsx`: the attach (nothing typed, the size change), `loadWebgl` and `repaint`, `recovery.onRepaint`, the harness hook `window.__afterterm.renderer(id)`.

## How it was tested

Two awake cmd threads in one project, each with a marker set in its own shell (`set PROOF=one-%RANDOM%`), so a respawned shell would echo `%PROOF%` literally. Every flow below came back on the same screen and thread, both threads awake, `echo back %PROOF%` printing each shell's own value, the same two cmd pids under electron before and after, and `[harness] pty:attach <tab> pid=<same pid>` in the log.

- Renderer crash (`window.afterterm.recovery.test('crash')`, harness only, `forcefullyCrashRenderer`): captures 10 to 14.
- `drive reload`: 15 and 16. On the project page: back on the project page, 17.
- WebGL context lost and given back (`WEBGL_lose_context`): blank while lost, text after, 18 to 21.
- WebGL lost for good three times on one terminal: a fresh WebGL renderer after the first and second, the DOM renderer after the third, and it keeps drawing new output, 22 to 26.
- GPU process ended (`recovery.test('gpu')`, the way Aryan did it): same page, text drawn, new output drawn, 27 to 30.
- A hung page: the page kept busy for 60 seconds (a drive eval never got its reply within 15 seconds), reported unresponsive, ended after 15 seconds, reloaded with both threads on their shells, 31 to 34.
- A thread created about a second before a crash: back awake and active, 35 and 36.
- A graceful quit and a relaunch: Home, every thread asleep, nothing attached, 37.
- Four crashes within a minute: three reloads, the fourth waited 45 seconds (a blank window meanwhile, 39), then reloaded on the same shell, 38 to 40.
- Before the fix, on fac29ed: a reload put both threads to sleep with their shells still running, and Wake started a third shell (41 to 43).
- After merging origin/main on 2026-11-09: a crash and a reload again kept both threads on the same shells, 53 and 54.

## What could not be tested

- **Real low memory**, which is what froze the window on 2026-10-02. Not reproducible on purpose here.
- **Chromium's own hang report.** In the harness, a page kept busy for two minutes with input waiting was never reported `unresponsive` (the harness window never has focus and other windows can cover it). So the hang test sends the report itself (`recovery.test('unresponsive')`, harness only) while the page really is busy; everything after the report is the real path.
- **The missing text itself.** Ending the GPU process and losing the WebGL context, with or without it coming back, left the text drawn on the build before this change too (captures 44 to 50), so the exact "colours but no text" state Aryan saw did not happen here. The redraw from a fresh glyph atlas is the same cure his font size change was, now done for every terminal on a context restore and on the GPU process going away.
- **A chat or a server re-attached.** Only cmd threads were run; no real Claude Code was started (the round's rules). A chat's needs-you or done badge is not carried over a reload: it comes back with the chat's next title change.
- **An orphan shell** (a live shell no saved thread names) being ended: covered by unit tests only, since the state now reaches main 250 ms after any change.

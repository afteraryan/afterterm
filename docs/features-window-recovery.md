# Window recovery: the window comes back by itself (AFT-33)

Built 2026-11-08 and 2026-11-09. Linear: AFT-33. Captures: `docs/screenshots/reload-and-recovery/` (10 to 50, 53 and 54).

## Why it exists

On 2026-10-02, after two days of running on a PC with 369 MB of 16 GB free, afterterm's window froze and then went blank while every shell and Claude session in it kept running. Minimising, restoring and a graphics driver reset (Win+Ctrl+Shift+B) changed nothing. Ending afterterm's GPU process by hand brought the window back without text (only the red and green of Claude Code's diffs), and a font size change brought each terminal's text back, one terminal at a time. Closing the app was not an option: it would have stopped everything. Aryan asked for recovery of the app's own, broader than graphics alone.

## What it does

**A page that crashes reloads.** `guardRenderer` in `main.ts`, for the main window and the notifier, listens to `render-process-gone`. Any reason but `clean-exit` (and nothing while quitting) reloads the page one second later (`afterRendererGone`, `RELOAD_DELAY_MS` in `window-recovery.ts`).

**A page that hangs is ended, then reloads.** Electron sends `unresponsive` only after Chromium has judged the page hung, which needs an input event left waiting for Chromium's own delay. Then a 15 second timer starts (`HANG_GRACE_MS`); `responsive` cancels it. When it runs out, main calls `forcefullyCrashRenderer()`, which reports as gone and reloads through the same path (Electron's own advice for a hung page). No dialog: the point is that it comes back by itself.

**A page is not reloaded in a tight loop.** At most three reloads within a minute (`allowReload`). A refused reload waits until the oldest leaves the minute and is tried then (`retryInMs`), so the window still comes back once whatever crashed it has passed.

**A reload keeps the threads.** Before this, a reload (`drive reload`, Ctrl+Shift+R before AFT-26, a crash) restored every thread asleep, but main never killed their shells: they ran on out of sight, and a Wake started a second shell beside the first, both writing to the same terminal (captures 41 to 43). Now:

- the page asks main `recovery:state` as it restores: the shells main still holds, with the port each was last seen on, and what the page last showed;
- `restoreWithLive` in `sleepWake.ts` brings a thread whose shell is alive back awake (`reattachedTab`: no `sleptAt`, the port main sees now, the transient mark `reattach`), every other thread asleep as on a launch (`restoredTab`); a live shell no saved thread names is an orphan and the page ends it. Its id stays taken (`takenTabIds`), so the next new thread is never given it and never takes the orphan's late exit as its own;
- what each thread showed comes back with it (review 1, 2026-11-09): its notification (needs-you, done, working, compacting, background) and its background work. Neither is ever saved to disk, so the page sends them to main with its state (`session:remember`), main hands them back with the live shells, and `reattachedTab` keeps them. A chat that was waiting for Aryan still shows needs-you on the rail, the panel and Home, and the restart window still warns about background work. No toast is sent again;
- the terminal layer creates a fresh xterm and calls `pty:create` with `attachOnly` (the `reattach` mark). Main, still holding the shell, answers `attached: true` with the shell's own size and spawns nothing. If the shell ended in the moment since main listed it, main spawns nothing and answers `gone` (`ptyCreateAction`), and the thread goes to sleep like any restored thread, without its saved tail being overwritten. Either way nothing is typed into it (`createOutcome`: no `claude --resume`, no server command), so a chat's Claude Code and a server run on untouched, and a shell that ended is never started again behind Aryan's back;
- a terminal that is on screen is fitted; one that is not takes the shell's own size, so a background chat is not redrawn at xterm's default 80 columns. A size change (one row less, then the real size, 60ms apart) then makes ConPTY draw the whole screen again into the new terminal, and Claude Code redraw itself, so a terminal shows its current screen, not a blank one. The scrollback above the screen is gone with the old page;
- output a shell printed while the window was down is not kept: main sends it to a page that is not listening, and the new page listens only once each terminal is built. The titles, folder reports and prompt marks in that output are missed with it (the notifications above are the exception, since they come back from main's copy);
- the page opens where it was: main keeps the screen, project page and active thread in memory (`recovery:ui`), and `screenAfterReload` uses them, falling back to Home when the project is gone. Nothing is remembered on a launch, so a launch opens Home and every thread asleep, unchanged (capture 37);
- main also forgets which record status, children flags and Claude Code session ids it last sent, so the next pass sends every live thread's again to the new page (a chat that started, or ran `/clear` or `/resume`, just before the crash keeps its right id).

**The latest state survives a crash.** The file save waits two seconds after a change, and a crashed or hung page never writes its last changes. So the page also sends its state to main 250 ms after any change (`session:remember`, throttled, memory only, with the panel's width and whether it is hidden), every save lands there too, and `session:load` reads that copy when it has one. A thread created a second before a crash comes back awake (captures 35 and 36: it was not yet in `session.json` on disk).

**The panel's width after a crash is the width before the last drag or the one it ended at** (the tester's row 4, 2026-11-09). A crash within 250 ms of a drag can come before the push, and then the page comes back at the width before the drag; after the push, at the dragged width. The tester's second run came back at 180, the minimum, and that was the dragged width: a drag past the minimum is clamped there (captures 110 and 111 repeat it: 640 dragged to the rail, crash 145 ms later, back at 180; the same with the push not yet sent, back at 640). Nothing in the push or the restore can make a width up: a missing or unusable saved width reads as the default, 264. The one way the minimum could appear without being dragged to was a drag pressed while the panel was still easing to its width (opening from hidden, a reset, or right after a reload), which measured from the half-drawn width; a drag now starts from the width the panel is set to (`dragStartWidth` in `panelWidth.ts`, unit-tested). The CDP drag in the harness is too slow to press inside that 320 ms ease, so that case is covered by the unit test only.

**A terminal's graphics recover.** xterm's WebGL addon waits 3 seconds for a lost context to come back. When it does not, `onContextLoss` fires: the terminal disposes the addon and loads a fresh one, until three losses (`rendererAfterLoss`, `WEBGL_MAX_LOSSES`), after which xterm's DOM renderer draws it. When the context does come back (`webglcontextrestored`, caught on the container in the capture phase), the terminal redraws from a fresh glyph atlas a frame later (`clearTextureAtlas` and `refresh`): what a font size change did by hand. When the GPU process goes away (`app` `child-process-gone`, type `GPU`), main sends `recovery:repaint` and every terminal redraws the same way, which keeps their scrollback, unlike a reload. Other processes going away are only logged.

**Everything is logged.** One line per event in `<userData>\recovery.log` (capped at 256 KB, keeping its newer half) and the console: renderer gone with its reason, unresponsive, ended, reloading, a refused reload and when it will be tried, a page loaded with live shells, a process gone. A packaged build has no other log, and this is how an incident nobody watched can be read afterwards.

## Where it lives

- `src/window-recovery.ts`: the pure rules, `ptyCreateAction` among them. `src/window-recovery.test.ts`.
- `src/renderer/sleepWake.ts`: `LiveThread`, `reattachedTab`, `restoreWithLive`, `createOutcome`, `takenTabIds`, `RememberedUi`, `screenAfterReload`. Tests in `sleepWake.test.ts`.
- `src/renderer/components/TabBar/types.ts`: `Tab.reattach`, transient (stripped on load and never written, `sessionMigration.ts`).
- `src/main.ts`: `recoveryLog`, `reloadForRecovery`, `guardRenderer`, the `child-process-gone` handler, `recovery:ui`, `recovery:state` (with each thread's remembered notification and background work), `recovery:test`, `pty:create`'s attach and `attachOnly`, `session:remember` and the remembered copy in `session:load`.
- `src/preload.ts`, `src/afterterm.d.ts`: `recovery` and `session.remember`; `pty.create` takes `attachOnly` and answers `attached`, `gone`, `cols` and `rows`.
- `src/renderer/hooks/useTabState.ts`: `restoreSession(saved, live)`, the id counter over `takenTabIds`.
- `src/renderer/app.tsx`: the restore with the live shells, orphans ended, the screen after a reload, `REMEMBER_MS` with each thread's shown state, `noteUi`, `onShellGone`.
- `src/renderer/components/Terminal/index.tsx`: the attach (attach only, nothing typed, the shell's own size for a terminal not on screen, the size change), `loadWebgl` and `repaint`, `recovery.onRepaint`, the harness hook `window.__afterterm.renderer(id)`.

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
- **Chromium's own hang report.** In the harness, a page kept busy for two minutes with input waiting was never reported `unresponsive`. Chromium ignores an unresponsive page while a DevTools client is attached to it (`WebContentsImpl::ShouldIgnoreUnresponsiveRenderer` checks for an attached debugger), and every harness run drives the page over CDP; the 60 second `drive eval` itself held a CDP session for the whole busy loop. No harness run can produce that report. So the hang test sends the report itself (`recovery.test('unresponsive')`, harness only) while the page really is busy; everything after the report is the real path.
- **The missing text itself.** Ending the GPU process and losing the WebGL context, with or without it coming back, left the text drawn on the build before this change too (captures 44 to 50), so the exact "colours but no text" state Aryan saw did not happen here. The redraw from a fresh glyph atlas is the same cure his font size change was, now done for every terminal on a context restore and on the GPU process going away.
- **A chat or a server re-attached.** Only cmd threads were run; no real Claude Code was started (the round's rules).
- **An orphan shell** (a live shell no saved thread names) being ended: covered by unit tests only, since the state now reaches main 250 ms after any change.
- **A shell that ends between `recovery:state` and its terminal's attach**: covered by unit tests (`ptyCreateAction`, `createOutcome`) only; the window between the two is a few milliseconds.

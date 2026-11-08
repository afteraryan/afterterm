# Notifications: the overlay toasts, the sidebar states, the spinner, the self-installed hook

Moved here from CLAUDE.md on 2026-09-20; CLAUDE.md keeps the short version.

## The notification system

Wired to Claude Code's hook events (the hook lives at `~/.claude/hooks/notify.ps1`, gated on `AFTERTERM=1`). When a background tab needs attention, afterterm surfaces it three ways:

- **Floating overlay toasts**: a separate always-on-top, transparent, frameless, click-through `BrowserWindow` (`notifierWindow` in main.ts) loads the same renderer with `?notifier=1`, which routes to `NotifierApp.tsx`. It stays **hidden** until a toast arrives (`showInactive()` on push), then hides again when the last toast clears. **The white bar** (a white strip painted across the top of the overlay, found again by Aryan on 2026-09-19 when coming back to afterterm with a toast up): the overlay is a transparent layered window, and DWM briefly turns its non-client caption rendering on around a show and around a foreground change (`WM_DWMNCRENDERINGCHANGED` 1 then 0, three milliseconds apart in the harness log); in that gap it paints the caption strip, white, into the top of the window, and Chromium afterwards repaints only its own content, so the strip stays until a full repaint. A race, so intermittent. The cure (Phase 9) is a full repaint, `webContents.invalidate()` through `repaintNotifier()` in main.ts, right after each moment DWM can touch the frame: the `showInactive` on push, the `WM_DWMNCRENDERINGCHANGED` message itself (hooked), and the main window's `focus` event. Verified in the harness with a scripted foreground change and a pixel scan of the strip above the card: one in two runs showed it before, none of nine after. Clicking a toast focuses the main window and switches to that tab. The card's headline is the thread name, line 2 is the project with its coloured folder and the message, and the state icon sits in a tinted circle (design in docs/mockups/toasts.html).
- **More repaint moments for the white bar (2026-09-29, release 0.9.0)**: Aryan saw the bar again above a stack of toasts, and once with no toast at all. Neither was reproduced in the harness (six runs each of a second toast growing the stack and of a push dismissed in the same tick found no bar and never left the overlay shown empty), but the gaps were closed: `positionNotifier` repaints after every `setBounds` (a second toast joining the stack grows the window), `powerMonitor`'s `resume` and `unlock-screen` re-place and repaint the overlay, and the main window's `blur` repaints it like its `focus` does. The bug stays open in `bugs.md` until Aryan says it is gone.
- **Sidebar thread indicator**: a background thread that needs you shows an amber bell at the right end of its row and the row breathes amber (5% to 16% of the colour over 2.4s); a finished turn shows a green check and a green breath until the thread is viewed. Since Phase 7, needs-you no longer clears on activation: it clears only on Enter, Esc or Ctrl+C in that thread, or the hook's next title, exactly as described below. `done` still clears on view, and a `✅` that lands on the thread being viewed (window focused) clears at once. (`background` and `⏳` did too until 2026-11-08; since then background lasts while the background work runs, see "Background is a live state" below.) Both clearing paths use one rule, `clearsWhenSeen` in `spinnerState.ts`: `clearThreadBadges` on activation, and `onViewedTitle` in `handleNotification` for a title arriving on the viewed thread. Until 2026-09-25 the second path cleared only `done`, so a `⏳` that arrived as the user watched a turn end with background tasks still running kept the row's spinner and the header's "Background tasks" chip until they switched away and back (the turn had ended; `background` was then drawn with the working spinner). Since PR #40 `background` has its own icon, a grey hourglass that flips a half turn at a time, on the row, the header chip and the hover card, and its own hourglass pill on the project row and Home (see `features-attention-and-sidebar.md`). Mark as unread (Phase 7, see below) shows the same amber bell and breath. Since Phase 8, a compacting thread shows its own purple icon (`IconCompact`) rather than sharing the working spinner, on the row, the header chip and the hover card. An asleep thread shows the moon and never a notification: sleeping a thread clears whatever it was showing (`sleepThread` in `app.tsx`), since a thread with no process has nothing left to notify about; an asleep thread the user marked unread keeps its bell regardless, since unread outranks asleep in `threadState`'s precedence.
- **Working spinner**: while Claude is mid-turn, the spinner sits at the right end of the row (after the state icon slot). A `▶ working` title (from the `UserPromptSubmit` hook) starts it, and since Phase 7 so does answering a permission prompt (Enter in that thread, see below). The title channel alone is unreliable at *stopping* it (a mid-turn `⚠` permission prompt or `⚙` compaction replaces `working` with nothing to restore it; and if `Stop`'s `✅` never fires the spinner sticks), so afterterm uses the PTY output stream as a second signal. The decision logic lives in `src/renderer/spinnerState.ts` (pure, unit-tested): **silence-clear** (drop `working` after ~2.5s of no output; Claude's TUI is never silent >~450ms mid-turn but is silent forever at idle) and **re-arm** (flip `compacting` back to `working` when output resumes after the pause; Phase 7 stopped this re-arming `attention`, since arrowing through a permission prompt's options echoes output too without answering anything). Wired in `app.tsx` (`handleOutput` + a 500ms tick) and fed by `Terminal/index.tsx` (`onOutput`). Empirical basis + capture harness: `scripts/spinner-harness/`.

  **Claude Code's own session record is a third signal (2026-11-07, plan-02 Fix 11).** Main reads the record of each thread's Claude every 2 seconds (`docs/features-claude-session-resume.md`) and the status reaches the tab as `recordStatus`. Two rules in `spinnerState.ts`: **`onTick` does not clear `working` on silence while the record says `busy`** (a turn that paused for a few seconds used to lose its spinner for the rest of the turn; with the record it holds, and once the record goes idle the silence rule applies again, measured from the last output), and **`onRecordStatus` sets `working` from a `busy` record when the thread is quiet**, so a chat with no hooks, which never gets a `▶` title, still shows the spinner. A busy record never replaces done, needs-you, compacting or background: a hook title knows more than the record there, and the record is read every 2 seconds, so the first `busy` of a short turn can land after its `✅` and would otherwise wipe the finished turn's done badge. `idle` does not clear `working` and `waiting` does not set needs-you; both stay with the silence rule and the hook. Toasts for a chat with no hooks are not covered; the hook repair below is what restores those.

  **Background is a live state (2026-11-08, AFT-25, AFT-43).** The hourglass was a badge that cleared when the thread was seen, so a chat opened while its background agent ran lost it for the rest of the run, and a chat on screen when its turn ended never showed it. Now `clearsWhenSeen` covers `done` only, and every change of a thread's notification in `app.tsx` goes through `applyNotif`, which settles it with `withBackground` (`spinnerState.ts`) against the background work flag (`Tab.backgroundTasks`, set by the hook's `⏳`, cleared only by its `✅`, by the thread's Claude going away and by sleep; PR #81). A quiet thread with that flag shows background, viewed or not; working, needs-you, done and compacting outrank it while they last, so an interrupted turn, a silence-cleared turn or a cancelled compaction falls back to it, and the spinner still stops when the turn ends (the hourglass replaces it, the rule of PR #39). The ordinary end is the hook's `✅`: when a background task ends, Claude Code starts a turn to tell the model, and that turn's Stop has nothing left. Signals not used: `SubagentStop` (afterterm's hook is not registered for it, and it also fires for a foreground subagent mid-turn with no count of what is left) and an idle record (a `/loop` cron is counted by the hook and leaves the record idle between runs). The rail still ignores background, as before. Tested in the harness with hook titles written by a PowerShell thread: `docs/screenshots/thread-states-fixes/`.

  **A cancelled compaction ends the compacting state (2026-11-08, AFT-42).** Claude Code 2.1.319 runs no hook when a compaction is cancelled (its `PostCompact` hook runs only after a compaction that finished), so the `⚙` stayed until some later output came after a quiet spell, which a thread switch's redraw happened to provide. Compacting now also ends three ways, all in `spinnerState.ts`: Esc or Ctrl+C in the thread (`onInterrupt`; "Compaction canceled."), the record changing to `idle` or `shell` (`onRecordStatus`; main sends a status only when it changes, so this is the record leaving busy), and `COMPACT_SILENCE_CLEAR_MS` (5 seconds) of output silence while the record does not say busy (`onTick`, run by the same 500ms tick as the spinner). Claude Code draws an animated "Compacting conversation" spinner for as long as a compaction runs, so the output is never silent that long during one. A finished compaction ends the same way. Known edge: a `/compact` typed within about 2 seconds of a turn's end could be cleared by that turn's late `idle`.

  **Known gap, not fixed (2026-11-07):** while a question or a permission prompt is up, the record says `waiting` within a second, the spinner clears after 2.5 seconds without output, and the hook's needs-you state arrives about 7 seconds after the prompt, so for 4 to 5 seconds the sidebar shows the chat as quiet. The restart window is right throughout, because it reads the record directly. It is to be filed in Linear (not filed yet). A possible fix is to set needs-you from the record's `waiting`, not decided.
- **Project row pills**: a collapsed or expanded project row shows a bell pill with the count of threads that need you and a play pill with the count that are working or running a server (Phase 5 done); nothing at zero.

Notification types map to title prefixes the shell hook emits: `✅` done, `⚠` attention, `⏳` background tasks, `⚙` compacting, `▶` working.

**What `⏳` counts.** The hook's Stop branch counts the Stop payload's `background_tasks` whose `status` is `running`, plus `session_crons`. When such a task ends, Claude Code starts a turn to tell the model (UserPromptSubmit, then a Stop with the task gone), so the title goes to `✅` on its own; this was checked on 2026-09-26 for a background shell command, a background subagent and a Monitor. One kind of task never ends and never starts a turn: an artifact's live-updates watch, which publishing, reading or watching an artifact starts, listed as `{ type: "monitor", status: "running", description: "live updates for artifact <url> ..." }` in every Stop for the rest of the session. The hook leaves it out of the count (since 2026-09-26); before that, a chat that had touched an artifact ended every later turn on `⏳ bg (1 running)`, and a thread not in view kept the hourglass until it was opened. Any other running `monitor` task still counts. A background command that hangs keeps the hourglass too, correctly: it is still running (`/tasks` in that chat shows it). Claude Code's transcript records every Stop hook's output (`hook_success` attachments with the title in `stdout`), which is how the artifact case was found across real sessions. Detection is in `Terminal/index.tsx` (`detectNotification`); fan-out to overlay + sidebar is in `app.tsx` (`handleNotification`). A toast is suppressed only when the user is *actually looking* at that tab (`activeTabId === tabId && document.hasFocus()`), so cross-app notifications still fire when afterterm is behind another window.

IPC flow: renderer `notify:push` → main → `notifierWindow` `notify:push`; overlay click `notify:tab-click` → main → `mainWindow.focus()` + `notify:activate-tab` → renderer; `notifier:hide` / `notifier:set-ignore-mouse` overlay → main; main window `focus` / `blur` → main → overlay `notifier:main-focus`, and `notifier:main-focused` (invoke) overlay → main once on load (see "A toast goes on its own" below).

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
  startup from `main.ts` (`reconcileNotifierHook`), except a test launch
  (`AFTERTERM_USER_DATA_DIR` set with no `CLAUDE_CONFIG_DIR`, decided by
  `hookReconcileAllowed`), which skips it. It's **idempotent and
  additive**: copies the script into `~/.claude/hooks/` and merges its 5 entries
  (`SessionStart`, `UserPromptSubmit`, `Notification`/`permission_prompt`,
  `Stop`, `PreCompact`) into `~/.claude/settings.json` only if missing — never
  touching the user's own hooks/permissions. Skips entirely when there's no
  `~/.claude` (CC not installed) and **never clobbers** an unparseable settings file.
- **Repair while running** (Fix 4, 2026-11-07): after the launch reconcile, main
  polls the Claude folder's `settings.json` (`startHookRepairPoll`): one `fs.statSync`
  every 3 seconds, comparing whether it exists, its modified time, its change time
  and its size (the change time catches a same-size copy that keeps the modified
  time, and a file renamed over it). A read error other than a missing file makes the
  next sample check again. On
  the first sample and on any difference, 1 second later, it asks `needsHookRepair`
  (pure, in `claude-hook-install.ts`) whether any of the five events has lost
  afterterm's entry, and if so runs `reconcileNotifierHook` again. A running chat
  picks the hooks up live, so it recovers with no restart (on 2026-11-06 a test
  launch removed them and chats ran 21 hours without). It writes only when something
  is missing, reads prefs.json on every check (an opt-out stops it at once; a
  prefs.json that cannot be read or parsed counts as enabled, as at launch, and is
  never written), leaves a settings.json that does not parse alone, never starts in
  a test launch that `hookReconcileAllowed` refuses, and holds repairs to 3 a minute
  (`hookRepairWait`) with one warning in case another tool keeps removing the
  entries. **Why a poll and not `fs.watch`:** a watch on the folder was built first,
  and it fails both ways the folder can go while the app runs (measured on Electron
  35.7.5's runtime). A real delete (`rmSync`, `Remove-Item`) raised no error and sent
  `rename` events without end: 266,399 events and 2000 ms of CPU in 2 seconds,
  stopping only on `close()`, so main sat at a full core until quit. A move or a
  rename, including Explorer's delete to the Recycle Bin (which is a move), sent no
  events and used no CPU: the watch silently stopped and the repair was off for the
  session. A stat every 3 seconds has neither problem, costs nothing, and treats a
  replaced file, a deleted file and a missing folder the same way. A missing Claude folder is
  not repaired into: Claude Code is not set up, or the folder went, and nothing is created.
  Each repair logs one `[claude-hook] repaired: <what was missing>; <detail>` line. Tested
  on 2026-11-07 against a scratch Claude folder (`docs/screenshots/restart-window-and-hook-fixes/`,
  hook tests 13 to 18): the entries came back after 1.9 to 4.3 seconds; with notifications
  turned off they stayed gone; a settings.json that did not parse was left alone and its
  entries came back about 4 seconds after it was valid again; another tool's hook in
  afterterm's group survived the opt-out.
- **Opt-out** is a single flag in `%APPDATA%\afterterm\prefs.json`
  (`claudeNotifications: "enabled" | "disabled"`, default enabled). Reconcile
  reads it first; `disabled` surgically removes only afterterm's own hook (from a group
  that also holds another tool's hook it takes out afterterm's hook alone, keeps the
  other and its matcher, and drops the group only when nothing is left) and
  stops re-adding them (this flag is what makes a manual removal *stick* — without
  it, reconcile can't tell "never installed" from "deliberately removed"). No
  settings UI yet; a future toggle just writes this flag. Reconcile reads
  prefs.json through `readPrefs` (`prefs.ts`), so a byte order mark from a hand
  edit no longer hides an opt-out, and a prefs.json that does not parse or cannot
  be read (locked, access denied) counts as enabled, since hooks are the default and
  a damaged file is far more likely than an opt-out, but is never written over
  (2026-11-07).
- **One-time toast**: the first time it registers (`prefs.claudeHookToastShown`),
  `pushSetupToast()` fires a "Claude Code notifications enabled" toast so the user
  knows their config was touched — it's not a silent dotfile edit. The toast uses
  a sentinel `tabId`; `app.tsx` `handleActivate` ignores clicks for unknown tabs.

Tests (no app needed): `assets/hooks/test-afterterm-notify.ps1` (22 cases, runs
the hook as a subprocess) and `src/claude-hook-install.test.ts` (147 cases, run
with `node src/claude-hook-install.test.ts` — Node 24+ strips the TS types).

### A toast follows an edit to its project (2026-09-25)

A toast is drawn in the overlay from the values it was pushed with, so a project edited while its toast was up kept the old name, colour and icon (Aryan's manual-testing entry). The push now carries `projectId`. `app.tsx` keeps the previous `groups` in a ref and, on every change, runs `projectLookChanges` (`threadView.ts`): the projects whose label, colour or icon changed, never one that is new in the list. For each it sends `notify:project-updated` (preload `notify.projectUpdated`) with the drawn colour (`GROUP_COLORS[color].border`); main forwards it to the overlay without showing it, and `NotifierApp` applies it with `applyProjectLook`, which returns the same array when no toast belongs to that project. The cards carry `data-project`, `data-color` and `data-icon`, which `drive toasts` reads from the overlay's page target. Verified in the harness: a done toast from a background shell in Website, then Edit project to green and the rocket icon, then a rename to "Website v2"; the toast on screen followed each change (`drive toasts` and whole-display captures in `docs/screenshots/small-fixes-2026-09-25/displays/`, which stay local).

### A toast goes on its own 5 seconds after it arrives while afterterm is focused (2026-09-29, release 0.9.0)

Until then a toast stayed until it was clicked or dismissed with its x, so while Aryan used afterterm the toasts piled up over the rail and the sidebar, which already show every thread's state (his entry of 2026-09-29 in `bugs.md`). The rule agreed with him:

- While the main window is focused, a toast goes 5 seconds after it arrives. Every type: done, attention, background and compacting.
- The pointer on any toast card pauses every toast, so the stack never moves under the pointer. Moving off the cards gives each toast a fresh 5 seconds.
- A toast that arrives while the main window is not focused (another app in front, minimized) stays, as before, until afterterm is focused again; from that moment it gets its 5 seconds. Losing focus again before they are up pauses it again, and the next focus starts a fresh 5 seconds.
- Going on its own only takes the toast off the overlay. It sends no `notify:dismiss-tab` and clears nothing in the main window: the thread's row, its project's pills and its rail tile keep the state. Clicking a toast and its x work as before, and when the last toast goes the hide-when-empty path hides the overlay.

The rule is pure, in `src/renderer/toastExpiry.ts` (`src/renderer/toastExpiry.test.ts`): a `ToastClock` of `{ focused, hoveredId, deadlines }`, where a deadline is a time or null while the clock is stopped. The clock runs only while focused with no live card under the pointer; `syncToasts` gives a new toast `now + TOAST_LIFETIME_MS` (or null) and drops a gone one, and `setMainFocus` and `setHoveredToast` restart every deadline whenever the change starts or stops the clock, so there is no time-left bookkeeping. Hover is kept by the card's id (`data-toast-id`), so a hovered card closed with its x does not leave the others paused. `NotifierApp.tsx` keeps the clock in state, resyncs it on every change to the toast list, feeds the existing mousemove handler's card into `setHoveredToast` (mouseleave clears it), and runs one `setTimeout` to `nextDeadline`, judging at `max(now, deadline)` when it fires so an early timer cannot strand a toast. Main answers `notifier:main-focused` once when the overlay loads and sends `notifier:main-focus` on every `focus` and `blur` of the main window (logged as `[harness] notifier:main-focus` under the harness). The blur also calls `repaintNotifier()`, since a foreground change is a moment DWM can paint the caption strip into the overlay.

Two small changes came with it. The hide-when-empty effect now runs on every new toast list instead of on its length: main shows the overlay on every push, and a push and a dismiss for the same thread rendered together would leave the length at 0 and the window shown with nothing in it (a candidate for the white bar with no toast; not reproduced in the harness, where the two messages rendered separately). A dismiss for a thread with no toast keeps the same list, so it does not trigger a needless hide. And under the harness (`harnessOnlyLogsExternal()`), a toast click logs `[harness] notify:tab-click <tab>` and skips `mainWindow.show()` and `focus()`, still switching the thread, so a self-test never takes OS focus from the person at the other monitor.

For the harness, the overlay page exposes `window.__afterterm.toastClock()` (the clock with `now`) and `window.__afterterm.mainFocus(bool)` (plays a focus change as if main sent it; the harness window never has real focus, so the not-focused path runs for real). Verified on 2026-09-29 by sampling `drive toasts` every second: a toast while focused went at 5 seconds; with the pointer on the card it stayed 8 seconds, then went 5 seconds after the pointer left; while not focused it stayed 12 seconds, went 5 seconds after focus, and paused again on a blur; two stacked toasts went at their own times; a real `✅` title in a background pwsh thread left the row at done and the rail tile at finished=1 after its toast went; a push and a dismiss for one thread left the overlay hidden; a click switched to the thread and the x only closed the card. Whole-display captures are in `docs/screenshots/release-0.9.0-toast-auto-hide/displays/`, which stay local.


# Notifications: the overlay toasts, the sidebar states, the spinner, the self-installed hook

Moved here from CLAUDE.md on 2026-09-20; CLAUDE.md keeps the short version.

## The notification system

Wired to Claude Code's hook events (the hook lives at `~/.claude/hooks/notify.ps1`, gated on `AFTERTERM=1`). When a background tab needs attention, afterterm surfaces it three ways:

- **Floating overlay toasts**: a separate always-on-top, transparent, frameless, click-through `BrowserWindow` (`notifierWindow` in main.ts) loads the same renderer with `?notifier=1`, which routes to `NotifierApp.tsx`. It stays **hidden** until a toast arrives (`showInactive()` on push), then hides again when the last toast clears. **The white bar** (a white strip painted across the top of the overlay, found again by Aryan on 2026-09-19 when coming back to afterterm with a toast up): the overlay is a transparent layered window, and DWM briefly turns its non-client caption rendering on around a show and around a foreground change (`WM_DWMNCRENDERINGCHANGED` 1 then 0, three milliseconds apart in the harness log); in that gap it paints the caption strip, white, into the top of the window, and Chromium afterwards repaints only its own content, so the strip stays until a full repaint. A race, so intermittent. The cure (Phase 9) is a full repaint, `webContents.invalidate()` through `repaintNotifier()` in main.ts, right after each moment DWM can touch the frame: the `showInactive` on push, the `WM_DWMNCRENDERINGCHANGED` message itself (hooked), and the main window's `focus` event. Verified in the harness with a scripted foreground change and a pixel scan of the strip above the card: one in two runs showed it before, none of nine after. Clicking a toast focuses the main window and switches to that tab. The card's headline is the thread name, line 2 is the project with its coloured folder and the message, and the state icon sits in a tinted circle (design in docs/mockups/toasts.html).
- **Sidebar thread indicator**: a background thread that needs you shows an amber bell at the right end of its row and the row breathes amber (5% to 16% of the colour over 2.4s); a finished turn shows a green check and a green breath until the thread is viewed. Since Phase 7, needs-you no longer clears on activation: it clears only on Enter, Esc or Ctrl+C in that thread, or the hook's next title, exactly as described below. `done` still clears on view, as before, and a `✅` that lands on the thread being viewed clears at once. Mark as unread (Phase 7, see below) shows the same amber bell and breath. Since Phase 8, a compacting thread shows its own purple icon (`IconCompact`) rather than sharing the working spinner, on the row, the header chip and the hover card. An asleep thread shows the moon and never a notification: sleeping a thread clears whatever it was showing (`sleepThread` in `app.tsx`), since a thread with no process has nothing left to notify about; an asleep thread the user marked unread keeps its bell regardless, since unread outranks asleep in `threadState`'s precedence.
- **Working spinner**: while Claude is mid-turn, the spinner sits at the right end of the row (after the state icon slot). A `▶ working` title (from the `UserPromptSubmit` hook) starts it, and since Phase 7 so does answering a permission prompt (Enter in that thread, see below). The title channel alone is unreliable at *stopping* it (a mid-turn `⚠` permission prompt or `⚙` compaction replaces `working` with nothing to restore it; and if `Stop`'s `✅` never fires the spinner sticks), so afterterm uses the PTY output stream as a second signal. The decision logic lives in `src/renderer/spinnerState.ts` (pure, unit-tested): **silence-clear** (drop `working` after ~2.5s of no output; Claude's TUI is never silent >~450ms mid-turn but is silent forever at idle) and **re-arm** (flip `compacting` back to `working` when output resumes after the pause; Phase 7 stopped this re-arming `attention`, since arrowing through a permission prompt's options echoes output too without answering anything). Wired in `app.tsx` (`handleOutput` + a 500ms tick) and fed by `Terminal/index.tsx` (`onOutput`). Empirical basis + capture harness: `scripts/spinner-harness/`.
- **Project row pills**: a collapsed or expanded project row shows a bell pill with the count of threads that need you and a play pill with the count that are working or running a server (Phase 5 done); nothing at zero.

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

### A toast follows an edit to its project (2026-09-25)

A toast is drawn in the overlay from the values it was pushed with, so a project edited while its toast was up kept the old name, colour and icon (Aryan's manual-testing entry). The push now carries `projectId`. `app.tsx` keeps the previous `groups` in a ref and, on every change, runs `projectLookChanges` (`threadView.ts`): the projects whose label, colour or icon changed, never one that is new in the list. For each it sends `notify:project-updated` (preload `notify.projectUpdated`) with the drawn colour (`GROUP_COLORS[color].border`); main forwards it to the overlay without showing it, and `NotifierApp` applies it with `applyProjectLook`, which returns the same array when no toast belongs to that project. The cards carry `data-project`, `data-color` and `data-icon`, which `drive toasts` reads from the overlay's page target. Verified in the harness: a done toast from a background shell in Website, then Edit project to green and the rocket icon, then a rename to "Website v2"; the toast on screen followed each change (`drive toasts` and whole-display captures in `docs/screenshots/small-fixes-2026-09-25/displays/`, which stay local).


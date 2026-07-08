# afterterm — Known Bugs

Running list of observed bugs that are **not yet fixed**. Fixed bugs get removed from here (their fix lives in git history / `CLAUDE.md`). For inherent *platform limitations* (input lag, Wispr, etc.) see the **Known Limitations** section in [`../CLAUDE.md`](../CLAUDE.md) — those are constraints, not bugs on a fix-list.

Format per bug: a short title, the date observed, what happens, repro if known, and any hypothesis about the cause.

---

## Notification overlay appears on the wrong monitor in a multi-monitor setup

**Observed:** 2026-06-30 · **Status:** open · **Severity:** low (cosmetic / placement)

**What happens:**
On a 2-monitor (or multi-monitor) setup, the floating notification overlay toasts can appear on a different monitor than the one afterterm's main window is on. Toasts should surface on the **same display where afterterm is running**, so the user actually sees them next to the app.

**Repro:**
1. Run afterterm with two or more monitors connected.
2. Move/keep the afterterm main window on a non-primary monitor.
3. Trigger a notification (e.g. a backgrounded Claude Code turn finishing).
4. Observe the toast appears on the (likely primary) display rather than the display hosting the main window.

**Hypothesis (unconfirmed):**
The `notifierWindow` `BrowserWindow` in `src/main.ts` is positioned without reference to the main window's current display. Likely defaults to the primary display or fixed coordinates. Fix direction: use Electron's `screen.getDisplayMatching(mainWindow.getBounds())` (or `getDisplayNearestPoint`) to compute the toast position within the work area of the display the main window currently occupies, and reposition on push (and ideally on monitor/display changes).

**Note:** Logged by Aryan on 2026-06-30 — document, don't fix yet.

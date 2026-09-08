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

---

## Hover card heading overflows the card for a long unbroken title

**Observed:** 2026-09-08 by Aryan during manual testing of the projects-and-threads build · **Phase:** 3 (the thread hover card) · **Status:** open · **Severity:** low (cosmetic) · **Screenshot:** `docs/screenshots/manual-testing/01-hover-card-heading-overflows-card-long-url-title.png`

**What happens:**
Hovering a sidebar thread row whose name is one long unbroken string (a chat titled with a URL, `https://engineering.atspotify.com/2026/3/inside-the-archive-2025-wrapped`) shows the hover card with the heading running past the card's right edge. The card is 280px wide; the heading has no rule for breaking a word that is wider than that, so the text spills out instead of wrapping.

**Repro:**
1. Have a chat thread whose Claude title is a URL or any other string with no spaces longer than the card.
2. Hover its sidebar row for 350ms.
3. The heading overflows the card; the `dl` rows below it stay inside (they ellipsise).

**Cause:** `.hover-card .hn` in `src/renderer/components/ThreadHoverCard.css` sets only weight and margin. Fix direction: let the heading wrap inside the card (`overflow-wrap: anywhere` or `word-break: break-word`), or clamp it to two lines with an ellipsis, matching how the sidebar row and the header truncate the same name.

# afterterm — Known Bugs

Running list of observed bugs that are **not yet fixed**. Fixed bugs get removed from here (their fix lives in git history / `CLAUDE.md`). For inherent *platform limitations* (input lag, Wispr, etc.) see the **Known Limitations** section in [`../CLAUDE.md`](../CLAUDE.md) — those are constraints, not bugs on a fix-list.

Format per bug: a short title, the date observed, what happens, repro if known, and any hypothesis about the cause.

This one file is where every bug goes, and `docs/screenshots/manual-testing/` is where every screenshot that comes with a bug goes (numbered, named for what it shows, committed, never deleted). A bug found during Aryan's manual testing after the projects-and-threads phases also carries the phase it belongs to and a link to its screenshot. Agreed with Aryan on 2026-09-08.

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

---

## Toast shadow spreads far past the card and is clipped at the overlay window's edge

**Observed:** 2026-09-08 by Aryan during manual testing · **Phase:** 1 (the overlay toast cards) · **Status:** open · **Severity:** low (cosmetic) · **Screenshot:** `docs/screenshots/manual-testing/02-toast-shadow-spread-too-wide-and-clipped-at-window-edge.png`

**What happens:**
The shadow around a notification toast spreads wide beyond the card and is cut off hard at the edge of the overlay window, so a grey rectangle shows around the card instead of a soft edge. Aryan expects a plain drop shadow that stays within the card's own container, without the wide spread.

**Repro:**
1. Let a Claude Code turn finish in a background thread so a "Done" toast appears.
2. Look at the toast's surroundings: a lighter rectangle with a hard edge sits around the card.

**Cause:** `.notif-card` in `src/renderer/NotifierApp.css` uses `box-shadow: 0 12px 40px rgba(0, 0, 0, .45)`, a 40px blur that reaches well past the toast container's 12px padding, and the overlay is a separate transparent window sized to the toasts, so whatever the shadow paints past its bounds is clipped straight. Fix direction: a small drop shadow that fits inside the container's padding (a few pixels of blur and offset), or padding large enough to hold the blur, so nothing reaches the window edge.

---

## The saved snapshot on the asleep pane opens scrolled to the top instead of the bottom

**Observed:** 2026-09-09 by Aryan during manual testing · **Phase:** 4 (sleep, wake and the scrollback tail) · **Status:** open · **Severity:** low (the newest lines are off screen until you scroll) · **Screenshot:** none attached

**What happens:**
A sleeping thread keeps a snapshot of its last lines, which Aryan can scroll through to see what was going on in that thread. The pane opens with the scroll position at the top of that snapshot, so the oldest saved lines show first. He expects the scroll bar to always be at the bottom, the way a terminal sits, so the most recent output is what he sees when he opens a sleeping thread.

**Repro:**
1. Sleep a thread that has more saved output than fits the pane (the tail keeps up to 200 lines).
2. Select that thread so the asleep pane shows.
3. The pane is scrolled to the top of the snapshot; the last lines before it slept need a manual scroll down.

**Cause:** `.asleep-pane` in `src/renderer/components/AsleepPane/AsleepPane.css` is an `overflow-y: auto` scroller, and `AsleepPane/index.tsx` never sets its scroll position, so the browser leaves it at 0. Fix direction: on mount and whenever the `tail` prop lands, set the pane's `scrollTop` to `scrollHeight` in the same effect that focuses the Wake button; the Wake box is `position: sticky` at `top: 20%`, so it stays in view when the pane is scrolled to the end.

---

## The dimmed snapshot replayed on wake stays on screen after the terminal comes back

**Observed:** 2026-09-09 by Aryan during manual testing · **Phase:** 4 (sleep, wake and the scrollback tail) · **Status:** open · **Severity:** low (cosmetic clutter after a wake) · **Screenshot:** none attached

**What happens:**
Waking a thread replays its greyed-out snapshot above a "Woke just now" divider and then scrolls the viewport back up so the old output, the divider and the fresh prompt sit together. Aryan expects the opposite: once the terminal is resumed, the greyed-out snapshot that was there before waking should clear away, leaving a clean terminal.

**Repro:**
1. Sleep a thread that has output in its scrollback.
2. Wake it from the pane's Wake button.
3. The dimmed replay of the old output sits above the divider and stays there, with the viewport scrolled up to show it, instead of the terminal starting clean at the new prompt.

**Cause:** deliberate current behaviour, not an accident: `createTerminal` in `src/renderer/components/Terminal/index.tsx` writes `renderTailForTerminal(lines, 'Woke just now', term.cols)` plus a screenful of newlines before the spawn, then scrolls back by `replayLines` once the first paint settles, exactly so the tail stays visible. Fix direction: decide with Aryan what "clean" means here, either dropping the replay altogether on wake (the snapshot is still readable on the asleep pane before waking) or keeping it in scrollback but leaving the viewport at the bottom, which is a one-line change to the `replayLines > 0` scroll-back block.

---

## There is no jump to top or jump to bottom button while scrolling long output

**Observed:** 2026-09-09 by Aryan during manual testing · **Phase:** pre-existing (the terminal scrollback), and it applies to Phase 4's asleep pane snapshot as well · **Status:** open · **Severity:** low (missing affordance) · **Screenshot:** none attached

**What happens:**
Scrolling through a long scrollback means dragging all the way back by hand. Aryan wants a floating button to appear while he keeps scrolling: scrolling up should offer an up arrow with a "Go to top" style label, and scrolling down should offer a down arrow with a "go all the way down" style label. He has not settled the wording yet, so that needs deciding with him.

Edge cases he asked to be covered:
1. If the scroll position is already at the bottom and he keeps scrolling down, the button must not appear.
2. If he was only a little way from the bottom and scrolling down reaches it, the button must not appear.

**Repro:**
1. Fill a terminal with enough output to scroll, or open a sleeping thread whose snapshot runs past the pane.
2. Scroll up through it, then scroll back down.
3. Nothing appears at any point offering to jump to either end.

**Cause:** nothing like this exists anywhere in the renderer: the only scroll handler in `src/renderer` is `onScroll={hideHover}` on the sidebar's `.scroll` div in `src/renderer/components/SidePanel/index.tsx`, and neither `Terminal/index.tsx` nor `AsleepPane/index.tsx` tracks scroll position at all. Fix direction: agree the wording and look with Aryan, then add one small overlay button per scroller, driven by scroll direction plus distance from the end (xterm exposes `viewportY` and `baseY` on `term.buffer.active` and `scrollToTop`/`scrollToBottom` on the terminal; the asleep pane is a plain div with `scrollTop`/`scrollHeight`), hidden whenever the remaining distance in the scroll direction is under a small threshold.

---

## The header's project, model and branch line is too faint to read at a glance

**Observed:** 2026-09-18 by Aryan during manual testing · **Phase:** 3 (thread identity, the header's line 2) · **Status:** open · **Severity:** low (legibility) · **Screenshot:** `docs/screenshots/manual-testing/03-header-project-model-branch-line-too-faint.png`

**What happens:**
At the top of a conversation the header shows the chat name, and under it a subheading with the folder name, the model name and the branch name ("aftertern · Opus 5 · manual-testing-fixes" in the screenshot). Aryan says this line is definitely not visible enough and wants the visibility of these three things improved.

**Repro:**
1. Open any chat thread in the workspace.
2. Look at the header under the thread name: the project, model and branch sit in small grey text on the dark pane background.

**Cause:** `.header-meta` in `src/renderer/components/Header/Header.css` renders line 2 at `font-size: 12.5px` in `var(--text3)` (`#8e8e8e` in `theme.css`), the palette's dimmest text token, on the `#191919` pane, while `.header-name` above it is 15px in `var(--text)` (`#ececec`). Fix direction: agree the treatment with Aryan, for example `var(--text2)` or brighter for the values with only the icons and separators left in text3, a size closer to 13.5px, or a chip-style treatment for each item, keeping the same three `data-meta` items.

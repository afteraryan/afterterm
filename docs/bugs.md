# afterterm — Known Bugs

Running list of observed bugs that are **not yet fixed**. Fixed bugs get removed from here (their fix lives in git history / `CLAUDE.md`). For inherent *platform limitations* (input lag, Wispr, etc.) see the **Known Limitations** section in [`../CLAUDE.md`](../CLAUDE.md) — those are constraints, not bugs on a fix-list.

Format per bug: a short title, the date observed, what happens, repro if known, and any hypothesis about the cause.

This one file is where every bug goes, and `docs/screenshots/manual-testing/` is where every screenshot that comes with a bug goes (numbered, named for what it shows, committed, never deleted). A bug found during Aryan's manual testing after the projects-and-threads phases also carries the phase it belongs to and a link to its screenshot. Agreed with Aryan on 2026-09-08.

---

Every entry from the manual-testing round after the projects-and-threads phases (seven bugs plus the thread-folder Explorer ask) was closed in Phase 9 on 2026-09-19; see PHASES.md's Phase 9 section and Log for what each fix was and how it was verified. Entries below are from Aryan's use of the Phase 9 build.

---

## The jump button stays on screen after scrolling stops instead of going away on its own

**Observed:** 2026-09-20 by Aryan during manual testing · **Phase:** 9 (long output, the jump button) · **Status:** open · **Severity:** low (a lingering control) · **Screenshot:** none attached

**What happens:**
Once the jump button has appeared during a scroll, it stays until the scroller reaches an end or the button is clicked. Aryan expects it to disappear on its own a moment after the scrolling stops, about a second, the exact time to be settled.

**Repro:**
1. Open a thread with long output (a live terminal or an asleep pane with a long tail).
2. Scroll up a few lines and stop.
3. The button appears and stays as long as the position is away from that end; nothing hides it while the mouse is idle.

**Cause:** the show-or-hide rule in `src/renderer/jumpScroll.ts` (`onScrollSample`) is a function of position and direction only; there is no idle timer anywhere. Fix direction: in both hosts (`AsleepPane/index.tsx`'s `onScroll`, `Terminal/index.tsx`'s `term.onScroll` sampling) start a timer on every user scroll sample that shows the button and clear the target when it fires (about a second, the exact value Aryan's to settle), resetting the timer on each further scroll, with the hide going through the existing scale-out; a hover over the button should probably hold it open.

---

## The top part of a submitted prompt in a live chat is greyed out while the rest is not

**Observed:** 2026-09-20 by Aryan during manual testing · **Phase:** pre-existing (terminal rendering of Claude Code's output) · **Status:** open · **Severity:** low (cosmetic, the text is still readable) · **Screenshot:** `docs/screenshots/manual-testing/04-live-chat-top-part-of-own-input-greyed-out.png`

**What happens:**
In a live chat thread, the prompt Aryan submitted is echoed under the `>` marker. Its first ten or so lines (down to "AR Study Buddy matters for three reasons.") are drawn in a dimmer grey than the lines that follow, which are in the normal text colour. He does not know why part of his own input is greyed out.

**Repro:**
As observed; repro not yet known. Seen after submitting a long multi-line prompt in a chat that was awake with the Claude Code banner at the top of the scrollback.

**Cause:** not investigated beyond a quick look. afterterm dims nothing in a live terminal: the only dimming in the renderer is the asleep pane's saved tail (`.past` at 30% opacity in `AsleepPane.css`), and the dimmed wake replay was removed in Phase 9, so the grey comes from the text attributes Claude Code's own TUI emitted for those rows (the dim attribute on the part of the message that had scrolled out of its live viewport, is one possibility). Fix direction: reproduce the same prompt in Windows Terminal first; if it looks the same there it is Claude Code's rendering and not afterterm's to fix.

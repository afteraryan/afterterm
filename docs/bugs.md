# afterterm — Known Bugs

Running list of observed bugs that are **not yet fixed**. Fixed bugs get removed from here (their fix lives in git history / `CLAUDE.md`). For inherent *platform limitations* (input lag, Wispr, etc.) see the **Known Limitations** section in [`../CLAUDE.md`](../CLAUDE.md) — those are constraints, not bugs on a fix-list.

Format per bug: a short title, the date observed, what happens, repro if known, and any hypothesis about the cause.

---

## Working spinner stops while Claude is still running (Stop-hook timing)

**Observed:** 2026-05-29 · **Status:** open · **Severity:** medium (misleading status)

> Two *other* spinner causes were fixed on 2026-05-29 and are no longer issues: (1) opening the tab used to clear the spinner — now `working` survives tab activation; (2) interrupting Claude (Esc/Ctrl+C) left the spinner stuck — typing into a working terminal now clears it. **What remains is only the Stop-hook timing case below.**

**What happens:**
The sidebar shows a rotating spinner on a tab while a Claude Code session is mid-turn, and it's supposed to stop when Claude is done. But Claude can emit a **text reply and then keep working** (more tool calls, a follow-up phase) — and in that case the spinner stops spinning even though Claude is still running. The indicator says "idle/done" while work is ongoing.

**Hypothesis (unconfirmed):**
The working state is driven entirely by Claude Code's hooks via tab-title prefixes:
- `UserPromptSubmit` hook → emits `▶ working` title → sets the tab's `working` notification → spinner spins.
- A `Stop` hook → emits `✅ done` (or `⏳`/`⚙`) → overwrites `working` → spinner stops.

Claude Code's `Stop` event fires at an assistant-turn boundary, which is **not always the end of all work** — Claude can produce a response and then continue (e.g. additional tool use, sub-phases). That intermediate `Stop` clears the `working` state prematurely. Because there's no new `UserPromptSubmit` (the user didn't submit again), the spinner never resumes for the remaining work. Relevant code: the `▶`/`working` mapping in `src/renderer/components/Terminal/index.tsx` (`detectNotification`), the hook `~/.claude/hooks/notify.ps1`, and the `UserPromptSubmit` wiring in `~/.claude/settings.json`.

**Likely fix direction (for when we tackle it):**
- Don't rely solely on the `UserPromptSubmit`→`Stop` pairing. Consider driving "working" off a more reliable signal — e.g. sustained PTY output activity, or a Claude Code hook that brackets the *entire* run rather than a single turn boundary.
- Or treat `Stop` as "may still be working" and only clear the spinner after a quiet period with no further PTY output.

**Note:** Logged by Aryan on 2026-05-29 — document, don't fix yet.

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

## Working spinner stays spinning after the turn ends (undecorated title can't clear `working`)

**Observed:** 2026-07-01 · **Status:** open · **Severity:** low (misleading status, cosmetic)

> This is the **inverse** of the "Working spinner stops while Claude is still running" bug above. That one clears `working` too *early*; this one **never clears it** — the spinner keeps spinning during idle after the turn is actually done. Different root cause (below), so tracked separately.

**What happens:**
A tab shows the sidebar working spinner while Claude is mid-turn, and it's supposed to stop when the turn ends. Sometimes the chat response finishes but the spinner keeps spinning indefinitely while the session sits idle. Observed after a turn completed (e.g. "PR is merged") — the tab spun on with no work running.

**Root cause (confirmed in code):**
`working` is set by the `▶` title (UserPromptSubmit hook) and is only ever *replaced* by a title that starts with a decorated prefix (`✅`/`⚠`/`⏳`/`⚙`). In `src/renderer/app.tsx`, `handleNotification` early-returns on an undecorated title:

```js
const handleNotification = useCallback((tabId, type, projectName) => {
  if (!type) return;          // ← a plain, undecorated title can't clear `working`
  state.setTabNotification(tabId, type);
  if (type === 'working') return;
  ...
```

So the only things that clear `working` are (a) a decorated non-working title via the `Stop`/`PreCompact` hook, or (b) the user pressing Esc/Ctrl+C in that tab (`handleUserInput`). Tab activation deliberately does **not** clear it. If the `Stop` hook's decorated title doesn't fire, or a later **plain** title (shell/Claude resetting the title with no emoji prefix) arrives after it, `handleNotification` hits `if (!type) return`, the clear is swallowed, and the spinner spins forever.

**Likely fix direction (for when we tackle it):**
- Don't let an undecorated title be a no-op *while `working` is set* — e.g. treat a plain title arriving after `working` as "turn ended, clear the spinner" (careful: this risks reintroducing the early-stop bug, since Claude emits plain titles mid-turn too).
- Or have the `Stop` hook always emit a decorated terminal title so a real clear is guaranteed.
- Or clear `working` after a quiet period with no further PTY output (same idea proposed for the early-stop bug — one mechanism could fix both).

**Note:** Logged by Aryan on 2026-07-01 — document, don't fix yet.

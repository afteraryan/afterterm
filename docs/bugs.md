# afterterm — Known Bugs

Running list of observed bugs that are **not yet fixed**. Fixed bugs get removed from here (their fix lives in git history / `CLAUDE.md`). For inherent *platform limitations* (input lag, Wispr, etc.) see the **Known Limitations** section in [`../CLAUDE.md`](../CLAUDE.md) — those are constraints, not bugs on a fix-list.

Format per bug: a short title, the date observed, what happens, repro if known, and any hypothesis about the cause.

---

## Tab drag-reorder: can't drop a tab into the first position (of a group, or on top of another tab)

**Observed:** 2026-05-29 · **Status:** open · **Severity:** low (annoyance, not blocking)

**What happens:**
When dragging a tab up/down in the side panel to reorder it, you cannot place a tab as the **first tab of a group** — there's no way to land it in the top slot. More generally, dropping a tab *on top of* another tab behaves unpredictably ("weird"): the drop position doesn't map cleanly to where you'd expect the tab to land.

**Hypothesis (unconfirmed):**
The reorder API is anchor-*after* based. `moveTab(tabId, afterTabId)` in `src/renderer/hooks/useTabState.ts` inserts the dragged tab *after* a target tab, with `afterTabId === null` meaning "very front of the whole list." There is no "insert *before* tab X" / "first slot *within* group G" anchor, so the first position inside a group is unreachable by drag. On top of that, the group-contiguity guard in `moveTab` (lines ~134-144) strips a tab's `groupId` when it lands somewhere not adjacent to its group — which can fire at group boundaries and make "drop at the top of a group" silently fall out of the group instead.

The "dropping on top of another tab is weird" symptom likely comes from the droppable hit-target in `src/renderer/components/SidePanel/index.tsx` resolving the drop to an after-anchor regardless of whether the cursor is over the top or bottom half of the target row — so dropping on the upper half of a tab still inserts *after* it.

**Likely fix direction (for when we tackle it):**
- Add a notion of drop position relative to the hovered row (top-half → insert before, bottom-half → insert after), the way most list DnD UIs work.
- Support an explicit "first slot of group G" target so the top-of-group position is reachable.
- Make sure the contiguity guard doesn't eject a tab when it's legitimately dropped at its group's leading edge.

**Note:** Deferred by Aryan on 2026-05-29 — "document this, we don't have to solve it now."

---

## Working spinner stops while Claude is still running

**Observed:** 2026-05-29 · **Status:** open · **Severity:** medium (misleading status)

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

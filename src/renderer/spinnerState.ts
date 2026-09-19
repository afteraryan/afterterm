// Pure decision logic for the sidebar "working" spinner. No React, no DOM, so it
// can be unit-tested (spinnerState.test.ts) and replayed against real captured PTY
// traces (scripts/spinner-harness/fixtures/*.jsonl).
//
// Why this exists (see docs/bugs.md). The spinner is driven by title prefixes that
// Claude Code hooks emit: ▶ (UserPromptSubmit) starts it, ✅/⏳ (Stop) end it. Two
// bugs came from trusting titles alone:
//   1. A mid-turn ⚠ (permission prompt) or ⚙ (compaction) title replaces `working`,
//      and nothing re-emits ▶ when Claude resumes → the spinner never comes back.
//   2. If Stop's ✅ never fires (Claude resets its title with no glyph prefix),
//      `working` is never cleared → the spinner spins forever at idle.
//
// The fix adds the PTY output stream as a second signal:
//   • RE-ARM:  output resuming after the pause's quiet flips compacting back to
//               working (fixes #1 for compaction).
//   • SILENCE: `working` clears after sustained output silence (fixes #2).
//
// Phase 7 (docs/design-03-sidebar-and-attention.md, decision 4) changed what ends
// attention. It used to be cleared by viewing the thread and re-armed by output;
// both lied: a permission prompt is still waiting after you look at it, and arrow
// keys at the prompt echo output without answering anything. Now attention ends
// only when the thread is actually answered: Enter in it (onAnswer, to working,
// then the silence clear takes over if Claude does not resume), Esc or Ctrl+C in
// it (onInterrupt, to quiet), or the hook's next title (onTitle, unchanged).
//
// This is empirically grounded (scripts/spinner-harness): across pure-think, tool-
// heavy, and mixed turns the PTY was never silent for more than ~450ms while Claude
// worked; at idle it is silent indefinitely; at a permission/compaction pause it goes
// silent for seconds and then resumes in a burst. Those three regimes are cleanly
// separable by an output-silence threshold.

export type Notif = 'working' | 'done' | 'attention' | 'background' | 'compacting' | undefined;

// Clear `working` once output has been silent this long. Chosen >5x the ~450ms
// worst-case in-turn gap measured across think/tools/mixed turns; idle is silent
// forever, so this only ever trips at a genuine end (or a multi-second stall right
// before a permission prompt, where dropping the spinner is fine, Claude is blocked
// waiting on you, not working).
export const SILENCE_CLEAR_MS = 2500;

// Re-arm from compacting only when output resumes after at least this much quiet.
// Long enough to skip the compaction render burst (which follows the title within
// ~700ms) and catch only the post-compaction resume. Attention used to re-arm the
// same way; it no longer does (see the header), since moving the cursor through
// a permission prompt's options echoes output too.
export const REARM_AFTER_QUIET_MS = 1500;

// Per-tab timing the decisions read/update. Kept tiny and serializable so the driver
// can hold one per tab in a plain Map.
export interface TabTiming {
  lastOutputAt: number;
}

export function initTiming(now: number): TabTiming {
  return { lastOutputAt: now };
}

// A title change. A decorated title sets its notif; an undecorated title changes
// nothing: we deliberately do NOT clear `working` on a plain title (that was the
// old early-stop bug); silence is what clears it. A title change is itself bytes on
// the wire, so it also refreshes the silence clock.
export function onTitle(current: Notif, titleNotif: Notif, timing: TabTiming, at: number): Notif {
  timing.lastOutputAt = at;
  return titleNotif === undefined ? current : titleNotif;
}

// A PTY output chunk. Re-arms `working` when we were paused at a compaction and
// output has resumed after a quiet gap, i.e. compaction finished and Claude is
// producing again. Attention is deliberately left alone: output at a permission
// prompt can be the user arrowing through its options, which answers nothing, so
// only onAnswer, onInterrupt or the next title move it. Always refreshes the clock.
export function onOutput(current: Notif, timing: TabTiming, at: number, byteLen: number): Notif {
  const gap = at - timing.lastOutputAt;
  timing.lastOutputAt = at;
  if (current === 'compacting' && byteLen > 0 && gap >= REARM_AFTER_QUIET_MS) {
    return 'working';
  }
  return current;
}

// A periodic clock tick. Clears `working` after sustained output silence. Only ever
// acts on `working`; attention/compacting/done are left for a title or re-arm to
// change, so a silent permission wait stays "needs permission", not blank.
export function onTick(current: Notif, timing: TabTiming, at: number): Notif {
  if (current === 'working' && at - timing.lastOutputAt > SILENCE_CLEAR_MS) return undefined;
  return current;
}

// A real user interrupt (Esc / Ctrl+C) ends the turn from afterterm's view: a
// working turn stops, and a permission prompt is cancelled (Esc at Claude Code's
// prompt declines it, Ctrl+C aborts the turn), so attention goes quiet too. Done,
// compacting and background are left for a title to change.
export function onInterrupt(current: Notif): Notif {
  return current === 'working' || current === 'attention' ? undefined : current;
}

// Enter pressed in the thread. At a permission prompt that is the answer (allow,
// or the highlighted option), so attention becomes working: Claude resumes and its
// output keeps the spinner alive, or it does not (the answer was "no" and the turn
// ends) and the silence clear drops working again within SILENCE_CLEAR_MS. Enter
// in any other state changes nothing here: a plain prompt submission is announced
// by the hook's own ▶ title, and Enter at a shell has no turn to affect. The
// caller refreshes the clock with `at` so the silence window is measured from the
// answer, not from the prompt's own render seconds or minutes earlier.
export function onAnswer(current: Notif, timing: TabTiming, at: number): Notif {
  if (current !== 'attention') return current;
  timing.lastOutputAt = at;
  return 'working';
}

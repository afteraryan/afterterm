// Pure decision logic for the sidebar "working" spinner. No React, no DOM — so it
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
//   • RE-ARM  — output resuming after the pause's quiet flips attention/compacting
//               back to working (fixes #1).
//   • SILENCE — `working` clears after sustained output silence (fixes #2).
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
// before a permission prompt, where dropping the spinner is fine — Claude is blocked
// waiting on you, not working).
export const SILENCE_CLEAR_MS = 2500;

// Re-arm from attention/compacting only when output resumes after at least this much
// quiet. Long enough to skip the prompt/compaction render burst (which follows the
// title within ~700ms) and catch only the post-decision resume.
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
// nothing — we deliberately do NOT clear `working` on a plain title (that was the
// old early-stop bug); silence is what clears it. A title change is itself bytes on
// the wire, so it also refreshes the silence clock.
export function onTitle(current: Notif, titleNotif: Notif, timing: TabTiming, at: number): Notif {
  timing.lastOutputAt = at;
  return titleNotif === undefined ? current : titleNotif;
}

// A PTY output chunk. Re-arms `working` when we were paused (attention/compacting)
// and output has resumed after a quiet gap — i.e. you answered the permission prompt
// / compaction finished and Claude is producing again. Always refreshes the clock.
export function onOutput(current: Notif, timing: TabTiming, at: number, byteLen: number): Notif {
  const gap = at - timing.lastOutputAt;
  timing.lastOutputAt = at;
  if ((current === 'attention' || current === 'compacting') && byteLen > 0 && gap >= REARM_AFTER_QUIET_MS) {
    return 'working';
  }
  return current;
}

// A periodic clock tick. Clears `working` after sustained output silence. Only ever
// acts on `working` — attention/compacting/done are left for a title or re-arm to
// change, so a silent permission wait stays "needs permission", not blank.
export function onTick(current: Notif, timing: TabTiming, at: number): Notif {
  if (current === 'working' && at - timing.lastOutputAt > SILENCE_CLEAR_MS) return undefined;
  return current;
}

// A real user interrupt (Esc / Ctrl+C) ends the turn from afterterm's view.
export function onInterrupt(current: Notif): Notif {
  return current === 'working' ? undefined : current;
}

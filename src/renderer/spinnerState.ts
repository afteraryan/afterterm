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
// plan-02 (Fix 11) adds Claude Code's own session record as a third signal: its busy
// status starts working from quiet (onRecordStatus) and holds it through silence
// (onTick), so a chat with no hooks has a spinner and a stalled turn keeps it.
//
// 2026-11-08 (AFT-25, AFT-43): background is a live state, not a badge. A thread is
// background while the hook's last word on its background work was ⏳ (the flag
// Tab.backgroundTasks, backgroundAfterTitle) and nothing louder is going on: every
// change of notif goes through withBackground, so a quiet thread with that flag shows
// background, viewed or not, until the hook's ✅ (the Stop that ran with nothing left),
// the thread's Claude going away or sleep. Seeing it no longer clears it; done still
// clears when seen (clearsWhenSeen).
//
// 2026-11-08 (AFT-42): a cancelled compaction sends no hook event (Claude Code runs
// PostCompact only after a compaction that finished), so compacting also ends on Esc
// or Ctrl+C in the thread (onInterrupt), on the session record leaving busy for idle
// (onRecordStatus), and after COMPACT_SILENCE_CLEAR_MS of output silence while the
// record does not say busy for a turn (onTick). Claude Code draws a spinner while a
// compaction runs, so the output is expected not to go silent that long during one;
// that is expected, not measured (scripts/spinner-harness/README.md).
//
// 2026-11-09 (review 1 of PR #90): a busy record holds working and compacting only
// when the thread has no background work, since Claude Code keeps its record busy for
// a background agent's whole run (measured 2026-11-08); and the shell's own prompt
// coming back ends the background work flag (backgroundAfterPrompt).
//
// This is empirically grounded (scripts/spinner-harness): across pure-think, tool-
// heavy, and mixed turns the PTY was never silent for more than ~450ms while Claude
// worked; at idle it is silent indefinitely; at a permission/compaction pause it goes
// silent for seconds and then resumes in a burst. Those three regimes are cleanly
// separable by an output-silence threshold.

import type { RecordStatus } from '../claude-session-record.ts';

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

// Clear `compacting` once output has been silent this long and the record does not
// say busy for a turn (AFT-42). Longer than SILENCE_CLEAR_MS because a compaction is
// long and a false clear has nothing to bring it back. Claude Code 2.1.319 shows a
// spinner ("Compacting conversation") while a compaction runs, so seconds of silence
// are expected to mean it has ended (cancelled, failed or finished). Expected, not
// measured: the one captured compaction trace (fixtures/compact.jsonl, an older
// Claude Code) has 3.6 s of silence after its ⚙, and nobody has yet timed the output
// of a long compaction, on screen or hidden. A false clear shows quiet for the rest of
// that compaction; nothing gets stuck.
export const COMPACT_SILENCE_CLEAR_MS = 5000;

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

// A periodic clock tick. Clears `working` after sustained output silence, and
// `compacting` after a longer one (AFT-42: a compaction cancelled with nothing after
// it used to keep its icon until some later redraw). Attention, done and background
// are left for a title or a key to change, so a silent permission wait stays "needs
// permission", not blank.
//
// `record` is what Claude Code's own session record says (plan-02, Fix 11). While it
// says busy, Claude is working however quiet the output is, so silence clears neither
// state: a turn that stalled for a few seconds used to lose its spinner for the rest
// of the turn (note-03, row 3). Once the record goes idle the silence rule applies
// again, measured from the last output, so a turn that ended long ago clears on the
// next tick.
//
// `background` is the thread's background work flag (Tab.backgroundTasks). With it
// set, busy says nothing about a turn: Claude Code 2.1.319 keeps the record busy for
// a background agent's whole run (measured 2026-11-08, busy from the prompt to the
// end of the turn that reported the agent's result). So busy holds working and
// compacting only with no background work; with some, the silence rule applies and
// withBackground turns the cleared state into background. That covers an agent's
// permission prompt answered with Enter (working, no Stop hook to end it) and a
// /compact that finishes while an agent runs (no idle record to end it). The cost: a
// real new turn over background work that goes quiet for SILENCE_CLEAR_MS shows the
// hourglass until its own ⏳ or ✅. Note that Claude Code also redraws its window
// title about once a second while it waits on a background agent (the same live
// run), and a title is output, so in practice the silence these need may not come
// until that stops.
export function onTick(current: Notif, timing: TabTiming, at: number, record?: RecordStatus, background = false): Notif {
  if (record === 'busy' && !background) return current;
  const quiet = at - timing.lastOutputAt;
  if (current === 'working' && quiet > SILENCE_CLEAR_MS) return undefined;
  if (current === 'compacting' && quiet > COMPACT_SILENCE_CLEAR_MS) return undefined;
  return current;
}

// A new status from Claude Code's session record (Fix 11). Busy starts the spinner
// from quiet only, so a chat with no hooks (no ▶ title ever comes) still shows that
// it is working. It never replaces done, needs-you, compacting or background: a hook
// title knows more than the record there, and the record is read every 2 seconds, so
// the first busy of a short turn can land after its ✅ and would otherwise wipe the
// finished turn's done badge (silence then clears the working it put there). A chat
// with no hooks never has done, so it loses nothing by this. Every other status
// leaves the notif alone: idle does not clear working (the silence clear in onTick
// does that, now that the record no longer holds it), and waiting does not set
// needs-you, which stays the hook's to say.
//
// The one exception is compacting (AFT-42). Main pushes a status only when it
// changes, so idle or shell arriving while the thread shows compacting means Claude
// Code has just stopped being busy: the compaction is over, finished or cancelled,
// and no hook says so after a cancel. (Shell is idle with a background shell task.)
export function onRecordStatus(current: Notif, record: RecordStatus | undefined): Notif {
  if (record === 'busy' && current === undefined) return 'working';
  if (current === 'compacting' && (record === 'idle' || record === 'shell')) return undefined;
  return current;
}

// A real user interrupt (Esc / Ctrl+C) ends the turn from afterterm's view: a
// working turn stops, a permission prompt is cancelled (Esc at Claude Code's prompt
// declines it, Ctrl+C aborts the turn), so attention goes quiet too, and a
// compaction is cancelled (Claude Code says "Compaction canceled." and runs no hook,
// AFT-42). Done and background are left alone: an interrupt neither answers a
// finished turn nor stops background work.
export function onInterrupt(current: Notif): Notif {
  return current === 'working' || current === 'attention' || current === 'compacting' ? undefined : current;
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

// The badge that only reports a turn that has ended: `done` (✅). Seeing the thread
// is all it asks for, so it clears when it is looked at. Needs-you is not one (a
// permission prompt is still waiting after a look), and neither are working and
// compacting, which are a turn still in progress. This is the one rule behind both
// clearing paths in app.tsx: activating a thread (clearThreadBadges) and a title
// landing on the thread being viewed (handleNotification, through onViewedTitle).
//
// `background` (⏳) cleared here too until 2026-11-08, as a "finished while you were
// away" badge. That hid the work it announced: a chat opened while its background
// agent still ran lost the hourglass for the rest of the run (AFT-43), and a chat on
// screen when its turn ended never showed it at all (AFT-25). It is a live state now
// (withBackground). What still holds from the 2026-09-25 fix (PR #39) is that the
// spinner stops when the turn ends: a ⏳ on the viewed thread swaps the spinner for
// the hourglass.
export function clearsWhenSeen(n: Notif): boolean {
  return n === 'done';
}

// Whether a chat still has background work running, as far as the hook's titles say
// (plan-02, Fix 7; Tab.backgroundTasks). The ⏳ title is the only signal for a
// background agent or a session cron (/loop, schedules): Claude Code's record says
// `shell` only for a background shell command, and busy both for a turn and for a
// background agent. Viewing never clears this flag, and since 2026-11-08 it is what
// the background state is drawn from (withBackground), so the restart window and the
// sidebar agree. A ⏳ title sets it; only a ✅ (done) clears it, since that is the
// hook's Stop running with nothing left (a Stop with tasks remaining sends ⏳ again;
// when a task ends Claude Code starts a turn to tell the model, so that Stop comes on
// its own). ▶, ⚠ and ⚙ leave it alone: a new turn can be interrupted with Esc, and
// Claude Code runs no Stop hook on an interrupt, so no ⏳ would come back; and a
// background agent's own permission prompt raises ⚠ while the agent still runs (seen
// in the 2026-11-07 live retest). An undecorated title (undefined) changes nothing.
// The Claude going away clears it too (its record going, backgroundAfterRecord, or the
// shell's prompt coming back, backgroundAfterPrompt), and so does sleep. An idle record
// does not: a session cron is counted by the hook and leaves the record idle between
// its runs.
export function backgroundAfterTitle(current: boolean, titleNotif: Notif): boolean {
  if (titleNotif === 'background') return true;
  if (titleNotif === 'done') return false;
  return current;
}

// The same flag when Claude Code's record for the thread changes. A record that goes
// away (a status, then none) means the thread's Claude has gone: a /exit either
// stopped its background work or left it detached from this thread, and no hook title
// will come to clear the flag, so it clears here. Any other change (a first status,
// one status to another, none to none) leaves it as it was.
export function backgroundAfterRecord(
  current: boolean,
  previous: RecordStatus | undefined,
  next: RecordStatus | undefined,
): boolean {
  return previous !== undefined && next === undefined ? false : current;
}

// The same flag when the thread's shell reports its own prompt (the OSC 133 marks,
// Tab.atPrompt; review 1 of PR #90). The shell's prompt is back only once the program
// it ran has ended, and a Claude that is running keeps it away, so a prompt means the
// thread's Claude has gone (/exit, a double Ctrl+C, a crash) and a plain shell has no
// background work. This covers a Claude whose record afterterm cannot read (an older
// Claude Code, or a record not matched to the thread), where backgroundAfterRecord
// never fires. A prompt going away (a command started) changes nothing. A shell with
// no marks (integration off, WSL) never reports a prompt, so its flag waits for the
// other signals, as before.
export function backgroundAfterPrompt(current: boolean, atPrompt: boolean): boolean {
  return atPrompt ? false : current;
}

// What a title's notif becomes when it lands on a thread. On the thread the user
// is looking at, with the window focused, a done badge has already been seen, so it
// clears at once; anything else, or any thread not in view, keeps it until the
// thread is opened.
export function onViewedTitle(next: Notif, viewing: boolean): Notif {
  return viewing && clearsWhenSeen(next) ? undefined : next;
}

// The notif a thread is given, once its background work flag is known (AFT-25,
// AFT-43). Every change of notif in app.tsx goes through here, so background is a
// state with a lifetime rather than a badge: a thread with background work running
// shows background whenever nothing louder (needs-you, working, done, compacting) is
// going on, whether or not it is being viewed. An interrupted turn, a silence clear,
// a cancelled compaction or a seen done falls back to background while the work
// runs, and a thread whose flag has cleared (its Claude went away) drops a leftover
// background to quiet. The hook's ✅ is what ends it in the ordinary case: the flag
// clears and the notif is done, which clears when seen.
export function withBackground(next: Notif, background: boolean): Notif {
  if (next === undefined && background) return 'background';
  if (next === 'background' && !background) return undefined;
  return next;
}

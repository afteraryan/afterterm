// Unit tests for the spinner decision logic — run directly on Node 24+ (strips types):
//   node src/renderer/spinnerState.test.ts
// Exits 0 if all pass, 1 on any failure.
//
// Two layers: (1) synthetic unit tests of each rule, and (2) REPLAY of real PTY
// traces captured from live `claude` turns (scripts/spinner-harness/fixtures/*.jsonl)
// to prove the silence heuristic never false-clears the spinner during genuine work.

import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  onTitle, onOutput, onTick, onInterrupt, onAnswer, onViewedTitle, clearsWhenSeen, initTiming,
  onRecordStatus, backgroundAfterTitle, backgroundAfterRecord, withBackground,
  SILENCE_CLEAR_MS, REARM_AFTER_QUIET_MS, COMPACT_SILENCE_CLEAR_MS,
} from './spinnerState.ts';
import type { RecordStatus } from '../claude-session-record.ts';
import type { Notif } from './spinnerState.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  — ' + detail : ''}`); fail++; }
}

console.log('\nspinnerState — unit rules\n');

// ── onTitle ───────────────────────────────────────────────────────────────
{
  const t = initTiming(0);
  check('▶ title sets working', onTitle(undefined, 'working', t, 100) === 'working');
  check('✅ title sets done', onTitle('working', 'done', t, 200) === 'done');
  check('⚠ title sets attention', onTitle('working', 'attention', t, 300) === 'attention');
  check('⚙ title sets compacting', onTitle('working', 'compacting', t, 400) === 'compacting');
  // The crux of the OLD early-stop bug: a plain/undecorated title must NOT clear working.
  check('undecorated title leaves working untouched', onTitle('working', undefined, t, 500) === 'working');
  check('title refreshes the silence clock', t.lastOutputAt === 500);
}

// ── onTick: silence clear ───────────────────────────────────────────────────
{
  const t = initTiming(1000);
  check('working held just under the silence window',
    onTick('working', t, 1000 + SILENCE_CLEAR_MS) === 'working');
  check('working cleared just past the silence window',
    onTick('working', t, 1000 + SILENCE_CLEAR_MS + 1) === undefined);
  // tick must never blank a paused/finished state — only working
  check('tick never clears attention (silent permission wait stays a prompt)',
    onTick('attention', initTiming(0), 999999) === 'attention');
  check('tick never clears done', onTick('done', initTiming(0), 999999) === 'done');
  check('tick never clears background', onTick('background', initTiming(0), 999999) === 'background');
}

// ── onTick: a compaction that ended with no hook title (AFT-42) ───────────────
{
  const t = initTiming(1000);
  check('the compacting silence window is longer than the working one', COMPACT_SILENCE_CLEAR_MS > SILENCE_CLEAR_MS);
  check('compacting held past the working window (a compaction is long)',
    onTick('compacting', t, 1000 + SILENCE_CLEAR_MS + 1) === 'compacting');
  check('compacting held just under its own window',
    onTick('compacting', t, 1000 + COMPACT_SILENCE_CLEAR_MS) === 'compacting');
  check('compacting cleared just past its own window (cancelled, nothing after it)',
    onTick('compacting', t, 1000 + COMPACT_SILENCE_CLEAR_MS + 1) === undefined);
  check('record busy: compacting survives any silence',
    onTick('compacting', t, 1000 + COMPACT_SILENCE_CLEAR_MS * 20, 'busy') === 'compacting');
  check('record idle, shell, waiting or none: the compacting silence clear applies',
    onTick('compacting', t, 1000 + COMPACT_SILENCE_CLEAR_MS + 1, 'idle') === undefined
    && onTick('compacting', t, 1000 + COMPACT_SILENCE_CLEAR_MS + 1, 'shell') === undefined
    && onTick('compacting', t, 1000 + COMPACT_SILENCE_CLEAR_MS + 1, 'waiting') === undefined
    && onTick('compacting', t, 1000 + COMPACT_SILENCE_CLEAR_MS + 1, undefined) === undefined);
}
{
  // Claude Code's compaction spinner animates: output every few hundred ms keeps the
  // compacting state for as long as the compaction runs, however long that is.
  const t = initTiming(0);
  let n: Notif = onTitle('working', 'compacting', t, 0);
  for (let at = 300; at <= 60_000; at += 300) {
    n = onOutput(n, t, at, 40);
    n = onTick(n, t, at + 150);
  }
  check('a minute of compaction spinner output keeps compacting', n === 'compacting');
  // Esc: "Compaction canceled." renders, then nothing.
  n = onOutput(n, t, 60_200, 120);
  n = onTick(n, t, 60_200 + COMPACT_SILENCE_CLEAR_MS);
  check('after the cancel renders: still compacting inside the window', n === 'compacting');
  n = onTick(n, t, 60_200 + COMPACT_SILENCE_CLEAR_MS + 500);
  check('after the cancel renders: quiet once the window passes', n === undefined);
}

// ── Claude Code's session record (plan-02, Fix 11) ───────────────────────────
{
  // A stalled turn: the output goes quiet for longer than the window, the record
  // still says busy, so the spinner stays.
  const t = initTiming(1000);
  check('record busy: working survives silence past the window',
    onTick('working', t, 1000 + SILENCE_CLEAR_MS * 10, 'busy') === 'working');
  check('record idle: the silence clear applies as before',
    onTick('working', t, 1000 + SILENCE_CLEAR_MS + 1, 'idle') === undefined);
  check('record waiting or shell: the silence clear applies too',
    onTick('working', t, 1000 + SILENCE_CLEAR_MS + 1, 'waiting') === undefined
    && onTick('working', t, 1000 + SILENCE_CLEAR_MS + 1, 'shell') === undefined);
  check('no record (none read, or WSL): the silence clear applies as before',
    onTick('working', t, 1000 + SILENCE_CLEAR_MS + 1, undefined) === undefined);
  check('record busy does not turn other states into working on a tick',
    onTick(undefined, t, 999999, 'busy') === undefined && onTick('done', t, 999999, 'busy') === 'done');

  // The record going idle after a long busy stretch: the next tick clears at once,
  // since the silence is measured from the last output, not from the status change.
  let n: Notif = 'working';
  n = onTick(n, t, 60_000, 'busy');
  check('held through a minute of busy silence', n === 'working');
  n = onTick(n, t, 60_500, 'idle');
  check('cleared on the first tick after the record says idle', n === undefined);
}
{
  check('busy from quiet starts working (a chat with no hooks)', onRecordStatus(undefined, 'busy') === 'working');
  check('busy keeps working', onRecordStatus('working', 'busy') === 'working');
  // The first busy of a short turn, read up to 2 s late, can land after the turn's ✅.
  check('busy never replaces done (a late busy must not wipe a finished turn)', onRecordStatus('done', 'busy') === 'done');
  check('busy never replaces needs-you, compacting or background',
    onRecordStatus('attention', 'busy') === 'attention'
    && onRecordStatus('compacting', 'busy') === 'compacting'
    && onRecordStatus('background', 'busy') === 'background');
  check('idle does not clear working by itself (the silence clear does)', onRecordStatus('working', 'idle') === 'working');
  check('waiting does not set needs-you (that is the hook\'s)', onRecordStatus(undefined, 'waiting') === undefined
    && onRecordStatus('working', 'waiting') === 'working');
  check('shell and no record change nothing',
    onRecordStatus(undefined, 'shell') === undefined && onRecordStatus('done', undefined) === 'done'
    && onRecordStatus('working', undefined) === 'working');
  // AFT-42: the record leaving busy while the thread shows compacting is the
  // compaction ending (finished or cancelled); no hook says so after a cancel.
  check('idle ends compacting', onRecordStatus('compacting', 'idle') === undefined);
  check('shell ends compacting (idle, with a background shell task)', onRecordStatus('compacting', 'shell') === undefined);
  check('waiting and no record leave compacting',
    onRecordStatus('compacting', 'waiting') === 'compacting' && onRecordStatus('compacting', undefined) === 'compacting');
  check('idle and shell end only compacting',
    onRecordStatus('background', 'idle') === 'background' && onRecordStatus('attention', 'idle') === 'attention'
    && onRecordStatus('done', 'shell') === 'done');
}

// ── onOutput: refresh clock + re-arm ────────────────────────────────────────
{
  // Output while working keeps the clock alive → a later tick won't clear.
  const t = initTiming(0);
  onOutput('working', t, 2000, 50);
  check('output refreshes clock → no false clear right after',
    onTick('working', t, 2000 + SILENCE_CLEAR_MS) === 'working');
}
{
  // Phase 7: attention never re-arms from output. Arrow keys at a permission prompt
  // move the highlight, which echoes output after any amount of quiet, and that
  // answers nothing. Before Phase 7 this same case re-armed to working.
  const t = initTiming(10000);
  const afterQuiet = 10000 + REARM_AFTER_QUIET_MS + 500;
  check('arrow keys at a permission prompt leave it needs-you (no re-arm after quiet)',
    onOutput('attention', t, afterQuiet, 400) === 'attention');
  check('output at a permission prompt still refreshes the clock', t.lastOutputAt === afterQuiet);
}
{
  // The prompt's own render burst (small gap right after ⚠) does not re-arm either.
  const t = initTiming(10000);
  check('attention does NOT re-arm on the immediate render burst',
    onOutput('attention', t, 10000 + 200, 400) === 'attention');
}
{
  // Nor does a long burst of output at the prompt (scrolling a diff in the prompt).
  const t = initTiming(10000);
  let n: Notif = 'attention';
  for (let i = 0; i < 20; i++) n = onOutput(n, t, 10000 + REARM_AFTER_QUIET_MS * (i + 1), 2000);
  check('repeated output bursts at a permission prompt keep it needs-you', n === 'attention');
}
{
  const t = initTiming(10000);
  check('compacting re-arms to working after quiet',
    onOutput('compacting', t, 10000 + REARM_AFTER_QUIET_MS + 100, 300) === 'working');
}
{
  // A zero-length blip shouldn't re-arm.
  const t = initTiming(10000);
  check('empty output does not re-arm',
    onOutput('attention', t, 10000 + REARM_AFTER_QUIET_MS + 100, 0) === 'attention');
}
{
  // Working output never spuriously becomes anything else.
  const t = initTiming(0);
  check('output while working stays working', onOutput('working', t, 5000, 500) === 'working');
}

// ── onInterrupt ─────────────────────────────────────────────────────────────
check('interrupt clears working', onInterrupt('working') === undefined);
// Phase 7: Esc or Ctrl+C at a permission prompt cancels it, so the bell goes.
check('interrupt clears attention (Esc or Ctrl+C at a prompt cancels it)', onInterrupt('attention') === undefined);
check('interrupt leaves undefined alone', onInterrupt(undefined) === undefined);
check('interrupt leaves done alone', onInterrupt('done') === 'done');
// AFT-42: Esc or Ctrl+C during a compaction cancels it ("Compaction canceled."), and
// Claude Code runs no hook after a cancel.
check('interrupt cancels compacting', onInterrupt('compacting') === undefined);
check('interrupt leaves background alone (it does not stop background work)', onInterrupt('background') === 'background');

// ── onAnswer (Phase 7) ──────────────────────────────────────────────────────
{
  // Enter at a permission prompt is the answer: needs-you becomes working.
  const t = initTiming(0);
  check('Enter at a permission prompt moves attention to working', onAnswer('attention', t, 5000) === 'working');
  check('Enter refreshes the silence clock to the answer time', t.lastOutputAt === 5000);
}
{
  // Enter, then Claude resumes: output keeps working alive past the silence window.
  const t = initTiming(0);
  let n: Notif = onAnswer('attention', t, 5000);
  n = onOutput(n, t, 5300, 800);
  n = onOutput(n, t, 5700, 800);
  n = onTick(n, t, 5700 + SILENCE_CLEAR_MS);
  check('Enter then output keeps working', n === 'working');
}
{
  // Enter, then silence: the answer was a "no" and the turn ended, so working
  // drops again once the silence window passes, exactly as a stuck spinner would.
  const t = initTiming(0);
  let n: Notif = onAnswer('attention', t, 5000);
  n = onTick(n, t, 5000 + SILENCE_CLEAR_MS);
  check('Enter then silence holds working inside the window', n === 'working');
  n = onTick(n, t, 5000 + SILENCE_CLEAR_MS + 1);
  check('Enter then silence ends working past the window', n === undefined);
}
{
  // Enter, then the hook's ✅: done wins as usual.
  const t = initTiming(0);
  let n: Notif = onAnswer('attention', t, 5000);
  n = onTitle(n, 'done', t, 6000);
  check('Enter then ✅ ends in done', n === 'done');
}
{
  // Enter in any other state changes nothing here and leaves the clock alone: a
  // plain prompt submission is announced by the hook's ▶, not by this signal.
  const t = initTiming(0);
  check('Enter while working stays working', onAnswer('working', t, 5000) === 'working');
  check('Enter while done stays done', onAnswer('done', t, 5000) === 'done');
  check('Enter while compacting stays compacting', onAnswer('compacting', t, 5000) === 'compacting');
  check('Enter while background stays background', onAnswer('background', t, 5000) === 'background');
  check('Enter while quiet stays quiet', onAnswer(undefined, t, 5000) === undefined);
  check('Enter outside attention leaves the clock alone', t.lastOutputAt === 0);
}
{
  // The full permission-prompt story, end to end: ⚠, a look and some arrowing,
  // then Enter, then Claude resumes, then ✅.
  const t = initTiming(0);
  let n: Notif = onTitle('working', 'attention', t, 1000);
  n = onOutput(n, t, 1400, 3000);                 // the prompt renders
  n = onOutput(n, t, 9000, 60);                    // arrow key echo, long after
  n = onTick(n, t, 30000);                         // minutes of looking at it
  check('prompt story: still needs-you after render, arrows and a long look', n === 'attention');
  n = onAnswer(n, t, 31000);
  check('prompt story: Enter answers it (working)', n === 'working');
  n = onOutput(n, t, 31200, 900);
  n = onTitle(n, 'done', t, 40000);
  check('prompt story: ends in done', n === 'done');
}
{
  // Esc at the prompt: the thread goes quiet, and later output does not revive it.
  const t = initTiming(0);
  let n: Notif = onTitle('working', 'attention', t, 1000);
  n = onInterrupt(n);
  check('Esc at a prompt goes quiet', n === undefined);
  n = onOutput(n, t, 1000 + REARM_AFTER_QUIET_MS + 100, 500);
  check('output after Esc stays quiet', n === undefined);
}

// ── clearsWhenSeen / onViewedTitle: what a look at the thread clears ─────────
{
  check('done clears when seen', clearsWhenSeen('done'));
  // AFT-43: background is a live state now, not a badge, so a look does not clear it.
  check('background does not clear when seen', !clearsWhenSeen('background'));
  check('needs-you does not clear when seen', !clearsWhenSeen('attention'));
  check('working does not clear when seen', !clearsWhenSeen('working'));
  check('compacting does not clear when seen', !clearsWhenSeen('compacting'));
  check('quiet has nothing to clear', !clearsWhenSeen(undefined));

  // AFT-25: a ⏳ landing on the thread being viewed used to clear at once, so a
  // chat on screen when its turn ended never showed its background agent. It stays
  // now, and the spinner still stops (working gives way to background).
  check('background on the viewed thread stays', onViewedTitle('background', true) === 'background');
  check('done on the viewed thread clears at once', onViewedTitle('done', true) === undefined);
  check('background on a thread not in view stays', onViewedTitle('background', false) === 'background');
  check('done on a thread not in view stays', onViewedTitle('done', false) === 'done');
  check('needs-you on the viewed thread stays', onViewedTitle('attention', true) === 'attention');
  check('working on the viewed thread stays', onViewedTitle('working', true) === 'working');
  check('compacting on the viewed thread stays', onViewedTitle('compacting', true) === 'compacting');
  check('an undecorated title on the viewed thread stays quiet', onViewedTitle(undefined, true) === undefined);
}
{
  // A background turn end, the way handleNotification runs it: the flag, then
  // onTitle, then the viewing rule, then withBackground. Viewed or not, the thread
  // shows background, and the spinner has stopped.
  const t = initTiming(0);
  const flag = backgroundAfterTitle(false, 'background');
  const viewed = withBackground(onViewedTitle(onTitle('working', 'background', t, 1000), true), flag);
  check('turn ending with background tasks, viewed: background, not the spinner', viewed === 'background');
  const unseen = withBackground(onViewedTitle(onTitle('working', 'background', t, 1000), false), flag);
  check('turn ending with background tasks, not viewed: background', unseen === 'background');
  check('opening it leaves background (AFT-43)', !clearsWhenSeen(unseen));
}

// ── The background work flag (plan-02, Fix 7) ───────────────────────────────
{
  check('a ⏳ title sets the flag', backgroundAfterTitle(false, 'background') === true);
  check('a second ⏳ keeps it', backgroundAfterTitle(true, 'background') === true);
  check('a ✅ title (Stop ran with nothing left) clears it', backgroundAfterTitle(true, 'done') === false);
  // A new turn can be interrupted with Esc, which runs no Stop hook, so no ⏳ comes back.
  check('a ▶ title (a new turn) leaves it set', backgroundAfterTitle(true, 'working') === true);
  // A background agent's own permission prompt raises ⚠ while the agent runs.
  check('a ⚠ title (a background agent asking permission) leaves it set', backgroundAfterTitle(true, 'attention') === true);
  check('a ⚙ title leaves it set', backgroundAfterTitle(true, 'compacting') === true);
  check('▶, ⚠ and ⚙ never set it',
    backgroundAfterTitle(false, 'working') === false && backgroundAfterTitle(false, 'attention') === false
    && backgroundAfterTitle(false, 'compacting') === false);
  check('a turn interrupted after ▶ keeps it until a later ✅',
    backgroundAfterTitle(backgroundAfterTitle(backgroundAfterTitle(false, 'background'), 'working'), undefined) === true);
  check('an undecorated title changes nothing',
    backgroundAfterTitle(true, undefined) === true && backgroundAfterTitle(false, undefined) === false);
  // On the thread being viewed both the state and the flag are set by a ⏳ now.
  const t = initTiming(0);
  const title: Notif = 'background';
  const flag = backgroundAfterTitle(false, title);
  const shown = withBackground(onViewedTitle(onTitle('working', title, t, 1000), true), flag);
  check('on the thread being viewed a ⏳ sets the flag and shows background', shown === 'background' && flag === true);

  // The thread's Claude going away (/exit): no hook title will come to clear it.
  check('the record going from idle to none clears the flag', backgroundAfterRecord(true, 'idle', undefined) === false);
  check('the record going from shell to none clears the flag', backgroundAfterRecord(true, 'shell', undefined) === false);
  check('a first status keeps the flag', backgroundAfterRecord(true, undefined, 'idle') === true);
  check('one status to another keeps the flag',
    backgroundAfterRecord(true, 'busy', 'idle') === true && backgroundAfterRecord(true, 'idle', 'shell') === true);
  check('no record before or after (a Claude the reader cannot see) keeps the flag',
    backgroundAfterRecord(true, undefined, undefined) === true);
  check('nothing ever sets the flag from the record', backgroundAfterRecord(false, undefined, 'shell') === false
    && backgroundAfterRecord(false, 'idle', undefined) === false);
}

// ── withBackground: background as a live state (AFT-25, AFT-43) ──────────────
{
  check('quiet with background work shows background', withBackground(undefined, true) === 'background');
  check('quiet with none stays quiet', withBackground(undefined, false) === undefined);
  check('a leftover background with no work left goes quiet', withBackground('background', false) === undefined);
  check('background with work running stays', withBackground('background', true) === 'background');
  check('louder states win over background work',
    withBackground('working', true) === 'working' && withBackground('attention', true) === 'attention'
    && withBackground('done', true) === 'done' && withBackground('compacting', true) === 'compacting');
  check('louder states are untouched without background work',
    withBackground('working', false) === 'working' && withBackground('done', false) === 'done');
}

// A thread the way app.tsx drives it: every event updates the flag first, then
// settles the notif against it, and opening the thread clears only what
// clearsWhenSeen says. Plays whole stories through the real functions.
function thread() {
  const t = initTiming(0);
  let notif: Notif = undefined;
  let bg = false;
  let record: RecordStatus | undefined = undefined;
  return {
    title(n: Notif, at: number, viewing: boolean) {
      bg = backgroundAfterTitle(bg, n);
      notif = withBackground(onViewedTitle(onTitle(notif, n, t, at), viewing), bg);
    },
    output(at: number, len = 50) { notif = withBackground(onOutput(notif, t, at, len), bg); },
    tick(at: number) { notif = withBackground(onTick(notif, t, at, record), bg); },
    esc() { notif = withBackground(onInterrupt(notif), bg); },
    open() { if (clearsWhenSeen(notif)) notif = withBackground(undefined, bg); },
    record(next: typeof record) {
      bg = backgroundAfterRecord(bg, record, next);
      record = next;
      notif = withBackground(onRecordStatus(notif, next), bg);
    },
    get notif() { return notif; },
    get bg() { return bg; },
  };
}
{
  // AFT-43: the turn ends with a background agent while another thread is in view,
  // then the chat is opened, then the user moves on and comes back.
  const th = thread();
  th.title('working', 1000, false);
  th.title('background', 9000, false);
  check('AFT-43: not in view, the ⏳ shows background', th.notif === 'background');
  th.open();
  check('AFT-43: opening the chat keeps background', th.notif === 'background');
  th.tick(60_000);
  th.open();
  check('AFT-43: a minute later and another look, still background', th.notif === 'background');
  // The agent ends: Claude Code starts a turn to tell the model, and its Stop has nothing left.
  th.title('working', 120_000, true);
  check('AFT-43: the report turn shows working', th.notif === 'working');
  th.title('done', 130_000, true);
  check('AFT-43: its ✅ on the viewed chat ends background and clears done', th.notif === undefined && !th.bg);
}
{
  // AFT-25: the chat is on screen the whole time.
  const th = thread();
  th.title('working', 1000, true);
  th.title('background', 9000, true);
  check('AFT-25: on screen, the ⏳ shows background (the spinner stops)', th.notif === 'background');
  th.output(9500, 3000);
  th.tick(9500 + SILENCE_CLEAR_MS + 1);
  th.tick(600_000);
  check('AFT-25: background holds through output and silence', th.notif === 'background');
}
{
  // A new prompt while the background work runs, then Esc: no Stop hook runs, so no
  // ⏳ comes back, and the thread falls back to background.
  const th = thread();
  th.title('background', 1000, true);
  th.title('working', 5000, true);
  check('a new turn over background work shows working', th.notif === 'working');
  th.esc();
  check('Esc on that turn falls back to background', th.notif === 'background');
}
{
  // A new turn whose ✅ never comes: the silence clear drops working to background.
  const th = thread();
  th.title('background', 1000, true);
  th.title('working', 5000, true);
  th.tick(5000 + SILENCE_CLEAR_MS + 1);
  check('a silence-cleared turn over background work shows background', th.notif === 'background');
}
{
  // A ✅ on a thread not in view while background was showing: done, then the look
  // clears it to quiet, since the flag went with the ✅.
  const th = thread();
  th.title('background', 1000, false);
  th.title('done', 2000, false);
  check('a ✅ not in view shows done', th.notif === 'done' && !th.bg);
  th.open();
  check('opening it then goes quiet', th.notif === undefined);
}
{
  // The thread's Claude goes away (/exit): the record goes from a value to none.
  const th = thread();
  th.record('busy');
  th.title('background', 1000, true);
  th.record(undefined);
  check('the Claude going away ends background', th.notif === undefined && !th.bg);
}
{
  // A background agent's own permission prompt: needs-you, answered, then background.
  const th = thread();
  th.title('background', 1000, false);
  th.title('attention', 2000, false);
  check('the agent\'s permission prompt shows needs-you', th.notif === 'attention' && th.bg);
  th.esc();
  check('declining it falls back to background', th.notif === 'background');
}
{
  // AFT-42: a compaction cancelled with Esc, on a thread with and without background work.
  const th = thread();
  th.title('compacting', 1000, true);
  th.esc();
  check('AFT-42: Esc during a compaction goes quiet at once', th.notif === undefined);
  const th2 = thread();
  th2.title('background', 500, true);
  th2.title('compacting', 1000, true);
  th2.esc();
  check('AFT-42: with background work running it falls back to background', th2.notif === 'background');
}
{
  // AFT-42: the same cancel seen through the record: busy while compacting, then idle.
  const th = thread();
  th.record('idle');
  th.title('compacting', 1000, true);
  th.record('busy');
  th.tick(1000 + COMPACT_SILENCE_CLEAR_MS * 3);
  check('AFT-42: a busy record holds compacting through silence', th.notif === 'compacting');
  th.record('idle');
  check('AFT-42: the record going idle ends it', th.notif === undefined);
}
{
  // AFT-42: no record at all (none read, or WSL), and no key: silence ends it.
  const th = thread();
  th.title('compacting', 1000, false);
  th.output(1200, 300);
  th.tick(1200 + COMPACT_SILENCE_CLEAR_MS);
  check('AFT-42: no record, inside the window: compacting', th.notif === 'compacting');
  th.tick(1200 + COMPACT_SILENCE_CLEAR_MS + 500);
  check('AFT-42: no record, past the window: quiet', th.notif === undefined);
}

// ── Replay real captured traces ─────────────────────────────────────────────
// Each fixture is a live `claude` turn: every line is a PTY chunk {at, gap, len,
// title, notif}. We drive the state machine exactly as the app would — onOutput for
// every chunk, onTitle when a chunk carried a title, and onTick every 500ms — then
// assert the spinner was HELD for the whole turn (no silence false-clear) and the
// turn was cleanly bracketed ▶→✅.
console.log('\nspinnerState — replay of real captured turns\n');

const TICK_MS = 500;
const FIX_DIR = fileURLToPath(new URL('../../scripts/spinner-harness/fixtures/', import.meta.url));

interface Entry { at: number; gap: number; len: number; title: string | null; notif: Notif | null; }

function replay(file: string) {
  const lines = fs.readFileSync(FIX_DIR + file, 'utf-8').split('\n').filter(Boolean);
  const entries: Entry[] = lines.map(l => JSON.parse(l));
  let notif: Notif = undefined;
  const timing = initTiming(0);
  let workingAt: number | null = null;
  let doneAt: number | null = null;
  let falseClears = 0;       // silence-clears of working before the real ✅
  let maxInTurnGap = 0;
  let nextTick = 0;

  const tickTo = (t: number) => {
    while (nextTick <= t) {
      notif = onTick(notif, timing, nextTick);
      if (workingAt !== null && doneAt === null && notif !== 'working') falseClears++;
      nextTick += TICK_MS;
    }
  };

  for (const e of entries) {
    tickTo(e.at);
    if (workingAt !== null && doneAt === null) maxInTurnGap = Math.max(maxInTurnGap, e.gap);
    notif = onOutput(notif, timing, e.at, e.len);
    if (e.title != null) {
      const tn: Notif = e.notif ?? undefined; // undecorated titles (notif null) → no change
      notif = onTitle(notif, tn, timing, e.at);
      if (tn === 'working' && workingAt === null) workingAt = e.at;
      if ((tn === 'done' || tn === 'background') && doneAt === null && workingAt !== null) doneAt = e.at;
    }
  }
  return { workingAt, doneAt, falseClears, maxInTurnGap, count: entries.length };
}

for (const name of ['think', 'tools', 'mixed']) {
  const file = `${name}.jsonl`;
  if (!fs.existsSync(FIX_DIR + file)) { check(`[${name}] fixture present`, false, 'missing ' + file); continue; }
  const r = replay(file);
  check(`[${name}] turn bracketed ▶→✅`, r.workingAt !== null && r.doneAt !== null,
    `working@${r.workingAt} done@${r.doneAt}`);
  check(`[${name}] spinner held all turn (0 silence false-clears)`, r.falseClears === 0,
    `${r.falseClears} false-clears`);
  check(`[${name}] max in-turn gap (${r.maxInTurnGap}ms) < silence window (${SILENCE_CLEAR_MS}ms)`,
    r.maxInTurnGap < SILENCE_CLEAR_MS, `${r.maxInTurnGap}ms`);
}

// The compaction probe (compact-probe.mjs): a turn, its ✅, then /compact. The
// compacting state must survive the 3.6 s quiet stretch after the ⚙ (that gap ends
// in output, which re-arms working), and nothing may be left showing at the end.
{
  const file = 'compact.jsonl';
  if (!fs.existsSync(FIX_DIR + file)) { check('[compact] fixture present', false, 'missing ' + file); }
  else {
    const entries: Entry[] = fs.readFileSync(FIX_DIR + file, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const timing = initTiming(0);
    let notif: Notif = undefined;
    let compactAt: number | null = null;
    let clearedWhileCompacting = false;
    let nextTick = 0;
    const tickTo = (t: number) => {
      while (nextTick <= t) {
        const before = notif;
        notif = onTick(notif, timing, nextTick);
        if (before === 'compacting' && notif !== 'compacting') clearedWhileCompacting = true;
        nextTick += TICK_MS;
      }
    };
    for (const e of entries) {
      tickTo(e.at);
      notif = onOutput(notif, timing, e.at, e.len);
      if (e.title != null) {
        notif = onTitle(notif, e.notif ?? undefined, timing, e.at);
        if (e.notif === 'compacting') compactAt = e.at;
      }
    }
    tickTo(entries[entries.length - 1].at + COMPACT_SILENCE_CLEAR_MS + TICK_MS);
    check('[compact] the ⚙ title was seen', compactAt !== null);
    check('[compact] silence never cut the compaction short (its 3.6 s gap ends in a re-arm)', !clearedWhileCompacting);
    check('[compact] nothing is left showing at the end', notif === undefined, `ended ${notif}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

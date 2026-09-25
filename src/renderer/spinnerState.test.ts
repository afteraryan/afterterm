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
  SILENCE_CLEAR_MS, REARM_AFTER_QUIET_MS,
} from './spinnerState.ts';
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
  check('tick never clears compacting', onTick('compacting', initTiming(0), 999999) === 'compacting');
  check('tick never clears done', onTick('done', initTiming(0), 999999) === 'done');
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
check('interrupt leaves compacting alone', onInterrupt('compacting') === 'compacting');
check('interrupt leaves background alone', onInterrupt('background') === 'background');

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
  check('background clears when seen', clearsWhenSeen('background'));
  check('needs-you does not clear when seen', !clearsWhenSeen('attention'));
  check('working does not clear when seen', !clearsWhenSeen('working'));
  check('compacting does not clear when seen', !clearsWhenSeen('compacting'));
  check('quiet has nothing to clear', !clearsWhenSeen(undefined));

  // The bug: a ⏳ landing on the thread being viewed kept its spinner, because
  // only done was cleared on this path while activation cleared both.
  check('background on the viewed thread clears at once', onViewedTitle('background', true) === undefined);
  check('done on the viewed thread clears at once', onViewedTitle('done', true) === undefined);
  check('background on a thread not in view stays', onViewedTitle('background', false) === 'background');
  check('done on a thread not in view stays', onViewedTitle('done', false) === 'done');
  check('needs-you on the viewed thread stays', onViewedTitle('attention', true) === 'attention');
  check('working on the viewed thread stays', onViewedTitle('working', true) === 'working');
  check('compacting on the viewed thread stays', onViewedTitle('compacting', true) === 'compacting');
  check('an undecorated title on the viewed thread stays quiet', onViewedTitle(undefined, true) === undefined);
}
{
  // A background turn end, the way handleNotification runs it: onTitle, then the
  // viewing rule. Viewed, the thread goes quiet; not viewed, it keeps the badge
  // for activation to clear.
  const t = initTiming(0);
  const viewed = onViewedTitle(onTitle('working', 'background', t, 1000), true);
  check('turn ending with background tasks, viewed: quiet', viewed === undefined);
  const unseen = onViewedTitle(onTitle('working', 'background', t, 1000), false);
  check('turn ending with background tasks, not viewed: background', unseen === 'background');
  check('the badge left on a thread not in view clears on opening it', clearsWhenSeen(unseen));
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

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

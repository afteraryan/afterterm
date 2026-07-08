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
  onTitle, onOutput, onTick, onInterrupt, initTiming,
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
  // Re-arm: attention + output resuming after a long quiet → working (Idea 1).
  const t = initTiming(10000);
  const afterQuiet = 10000 + REARM_AFTER_QUIET_MS + 500;
  check('attention re-arms to working when output resumes after quiet',
    onOutput('attention', t, afterQuiet, 400) === 'working');
}
{
  // The prompt's own render burst (small gap right after ⚠) must NOT re-arm.
  const t = initTiming(10000);
  check('attention does NOT re-arm on the immediate render burst',
    onOutput('attention', t, 10000 + 200, 400) === 'attention');
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
check('interrupt leaves attention alone', onInterrupt('attention') === 'attention');
check('interrupt leaves undefined alone', onInterrupt(undefined) === undefined);

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

// Unit tests for notify-state-probe.ts, with a fake helper: a small Node script
// that answers each line like the PowerShell one, after a delay, or hangs, or
// exits. Short timings keep the whole file to a few seconds. Run directly on
// Node 24+ (strips types):
//   node src/notify-state-probe.test.ts
// Exits 0 if all pass, 1 on any failure.

import { NotifyStateProbe, PROBE_TIMINGS } from './notify-state-probe.ts';
import type { ProbeTimings } from './notify-state-probe.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}
const show = (v: unknown) => JSON.stringify(v);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// The fake helper. Arguments: the delay before it answers anything (ms; -1 exits
// at once), the line it answers, how many questions it answers before it hangs
// (-1: never hangs), and when it exits on its own (ms; -1: never).
const FAKE = `
const delay = Number(process.argv[1]);
const line = process.argv[2];
const hangAfter = Number(process.argv[3]);
const exitAt = Number(process.argv[4]);
if (delay < 0) process.exit(3);
if (exitAt >= 0) setTimeout(() => process.exit(4), exitAt);
let ready = false, asked = 0, answered = 0, buf = '';
const flush = () => {
  while (ready && asked > answered) {
    if (hangAfter >= 0 && answered >= hangAfter) return;
    answered++;
    process.stdout.write(line + '\\n');
  }
};
setTimeout(() => { ready = true; flush(); }, delay);
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\\n')) >= 0) { buf = buf.slice(i + 1); asked++; } flush(); });
process.stdin.on('end', () => process.exit(0));
`;

const TIMES: ProbeTimings = { startAnswerMs: 300, startLimitMs: 1200, answerTimeoutMs: 250, idleExitMs: 500, restMs: 900 };

function probe(delay: number, line: string, hangAfter = -1, warnings: string[] = [], exitAt = -1) {
  return new NotifyStateProbe({
    helper: { command: process.execPath, args: ['-e', FAKE, String(delay), line, String(hangAfter), String(exitAt)] },
    timings: TIMES,
    warn: (m) => warnings.push(m),
  });
}

console.log('\nnotify-state-probe: the real timings\n');
{
  check('a toast waits at most 4 s for a starting helper', PROBE_TIMINGS.startAnswerMs === 4000);
  check('a helper that never answers is stopped after 10 s', PROBE_TIMINGS.startLimitMs === 10_000);
  check('a warm helper that hangs is given 1.5 s', PROBE_TIMINGS.answerTimeoutMs === 1500);
  check('the helper goes 15 s after the last question', PROBE_TIMINGS.idleExitMs === 15_000);
  check('after three failures it rests 5 minutes', PROBE_TIMINGS.restMs === 5 * 60_000);
}

console.log('\nnotify-state-probe: a helper that answers\n');
{
  const p = probe(0, 'quns=5 fg=1');
  const a = await p.query();
  check('the first answer is read', a.state === 'window-fullscreen' && a.line === 'quns=5 fg=1', show(a));
  check('the first question started the helper', a.started === true);
  const b = await p.query();
  check('the second uses the same helper', b.started === false && b.state === 'window-fullscreen', show(b));
  check('the helper is running', p.pid !== null);
  await sleep(TIMES.idleExitMs + 300);
  check('it goes after the idle time', p.pid === null);
  const c = await p.query();
  check('a question after that starts a new one', c.started === true && c.state === 'window-fullscreen', show(c));
  p.dispose();
  check('dispose stops it', p.pid === null);
  const d = await p.query();
  check('after dispose every answer is unknown', d.state === 'unknown' && d.started === false, show(d));
}

console.log('\nnotify-state-probe: a slow start is let finish (review 1)\n');
{
  const warnings: string[] = [];
  const p = probe(600, 'quns=2 fg=0', -1, warnings);
  const t0 = Date.now();
  const a = await p.query();
  const took = Date.now() - t0;
  // unknown proves it did not wait for the helper's answer (busy); the upper bound
  // is loose so a loaded machine does not fail it.
  check('the first question answers unknown at the start limit', a.state === 'unknown' && took >= 280 && took < 2000, `${took} ms, ${show(a)}`);
  check('the helper is left running', p.pid !== null);
  check('it says it is still starting', warnings.some(w => w.includes('still starting')), show(warnings));
  await sleep(500);
  const b = await p.query();
  check('the next question gets the helper\'s answer', b.state === 'busy' && b.started === false, show(b));
  check('a slow start is not a failure', !warnings.some(w => w.includes('failed')), show(warnings));
  p.dispose();
}

console.log('\nnotify-state-probe: a helper that never starts is stopped\n');
{
  const warnings: string[] = [];
  const p = probe(10_000, 'quns=5 fg=0', -1, warnings);
  const a = await p.query();
  check('the toast does not wait for it', a.state === 'unknown', show(a));
  check('it is still running before the limit', p.pid !== null);
  await sleep(TIMES.startLimitMs - TIMES.startAnswerMs + 300);
  check('it is stopped past the limit', p.pid === null);
  check('that counts as a failure', warnings.some(w => w.includes('did not start')), show(warnings));
  p.dispose();
}

console.log('\nnotify-state-probe: a warm helper that hangs\n');
{
  const warnings: string[] = [];
  const p = probe(0, 'quns=5 fg=0', 1, warnings);
  const a = await p.query();
  check('the first answer comes', a.state === 'accepts', show(a));
  const t0 = Date.now();
  const b = await p.query();
  check('the hung question answers unknown after its limit', b.state === 'unknown' && Date.now() - t0 >= 230, show(b));
  check('the hung helper is stopped', p.pid === null);
  check('it counts as a failure', warnings.some(w => w.includes('no answer')), show(warnings));
  p.dispose();
}

console.log('\nnotify-state-probe: three failures rest the probe, then it tries again (review 1)\n');
{
  const warnings: string[] = [];
  const p = probe(-1, 'quns=5 fg=0', -1, warnings);
  const answers = [];
  for (let i = 0; i < 3; i++) answers.push(await p.query());
  check('each failed start answers unknown', answers.every(a => a.state === 'unknown'), show(answers));
  check('the third failure rests the probe', warnings.some(w => w.includes('3 times in a row')), show(warnings));
  const resting = await p.query();
  check('while resting no helper is started', resting.started === false && p.pid === null, show(resting));
  check('while resting the answer is unknown', resting.state === 'unknown');
  await sleep(TIMES.restMs + 100);
  const after = await p.query();
  check('after the rest it tries again', after.started === true, show(after));
  p.dispose();
}

console.log('\nnotify-state-probe: a helper that exits while starting, after the toast has shown (review 2)\n');
{
  // It never answers and exits 500 ms after it starts: past the 300 ms wait (the
  // real one is 4 s), before the start limit. The question has already shown
  // its toast, so only the exit can count it.
  const warnings: string[] = [];
  const p = probe(10_000, 'quns=5 fg=0', -1, warnings, 500);
  const a = await p.query();
  check('the question does not wait for it', a.state === 'unknown', show(a));
  check('the wait itself is not a failure', !warnings.some(w => w.includes('failed')), show(warnings));
  await sleep(1000);
  check('the helper is gone', p.pid === null);
  check('its exit counts as a failure', warnings.some(w => w.includes('exited while starting')), show(warnings));
  for (let i = 0; i < 2; i++) { await p.query(); await sleep(1000); }
  check('three such exits rest the probe', warnings.some(w => w.includes('3 times in a row')), show(warnings));
  const resting = await p.query();
  check('while resting no helper is started', resting.started === false && p.pid === null, show(resting));
  p.dispose();
}

console.log('\nnotify-state-probe: the helper\'s "error" line\n');
{
  const p = probe(0, 'error');
  const a = await p.query();
  check('reads as unknown, which shows', a.state === 'unknown' && a.line === 'error', show(a));
  p.dispose();
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);

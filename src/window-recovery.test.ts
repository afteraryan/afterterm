// Unit tests for window-recovery.ts. Run directly on Node 24+ (strips types):
//   node src/window-recovery.test.ts
// Exits 0 if all pass, 1 on any failure.

import {
  HANG_GRACE_MS, RELOAD_LIMIT, RELOAD_WINDOW_MS, WEBGL_MAX_LOSSES,
  allowReload, afterRendererGone, afterChildGone, rendererAfterLoss,
} from './window-recovery.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}
const show = (v: unknown) => JSON.stringify(v);

console.log('\nwindow-recovery: the numbers\n');
{
  check('a hung page gets 15 seconds before it is ended', HANG_GRACE_MS === 15_000);
  check('at most 3 reloads', RELOAD_LIMIT === 3);
  check('within a minute', RELOAD_WINDOW_MS === 60_000);
  check('a terminal tries WebGL again after its first two losses', WEBGL_MAX_LOSSES === 3);
}

console.log('\nwindow-recovery: a crashing page is not reloaded forever\n');
{
  const first = allowReload([], 1000);
  check('the first reload is allowed', first.allowed && show(first.times) === '[1000]', show(first));
  const second = allowReload(first.times, 2000);
  check('the second is allowed', second.allowed && second.times.length === 2, show(second));
  const third = allowReload(second.times, 3000);
  check('the third is allowed', third.allowed && third.times.length === 3, show(third));
  const fourth = allowReload(third.times, 4000);
  check('a fourth within the minute is refused', !fourth.allowed, show(fourth));
  check('a refused reload is not counted', show(fourth.times) === '[1000,2000,3000]', show(fourth.times));
  check('and is tried again when the oldest leaves the minute', fourth.retryInMs === 1000 + RELOAD_WINDOW_MS - 4000, show(fourth));
  check('an allowed reload has no retry', first.retryInMs === undefined, show(first));
  const later = allowReload(fourth.times, 1000 + RELOAD_WINDOW_MS);
  check('once the first has left the minute, one more is allowed', later.allowed, show(later));
  check('and the times outside the minute are dropped', show(later.times) === `[2000,3000,${1000 + RELOAD_WINDOW_MS}]`, show(later.times));
  const clock = allowReload([5000], 4000);
  check('a time in the future (the clock moved back) is dropped', clock.allowed && show(clock.times) === '[4000]', show(clock));
  check('a limit can be passed in', !allowReload([1, 2], 3, 2).allowed);
}

console.log('\nwindow-recovery: what a renderer going away does\n');
{
  for (const reason of ['crashed', 'killed', 'oom', 'abnormal-exit', 'launch-failed', 'integrity-failure', 'memory-eviction']) {
    check(`${reason}: reload`, afterRendererGone(reason, false) === 'reload');
  }
  check('clean-exit: nothing (the page closed on purpose)', afterRendererGone('clean-exit', false) === 'nothing');
  check('while quitting: nothing, whatever the reason', afterRendererGone('crashed', true) === 'nothing');
}

console.log('\nwindow-recovery: what another process going away does\n');
{
  check('the GPU process crashed: the terminals redraw', afterChildGone('GPU', 'crashed') === 'repaint');
  check('the GPU process was killed: the terminals redraw', afterChildGone('GPU', 'killed') === 'repaint');
  check('the GPU process exited cleanly: only logged', afterChildGone('GPU', 'clean-exit') === 'log');
  check('a utility process crashed: only logged', afterChildGone('Utility', 'crashed') === 'log');
}

console.log('\nwindow-recovery: which renderer a terminal draws with after a WebGL loss\n');
{
  check('after the first loss: WebGL again', rendererAfterLoss(1) === 'webgl');
  check('after the second loss: WebGL again', rendererAfterLoss(2) === 'webgl');
  check('after the third loss: the DOM renderer', rendererAfterLoss(3) === 'dom');
  check('and after any more', rendererAfterLoss(7) === 'dom');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

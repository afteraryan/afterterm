// Phase 9: watch a terminal jump animate. Clicks the jump button and samples
// window.__afterterm.viewport() (the active terminal's viewportY and baseY) every
// ~50ms for the given number of milliseconds, printing one line per sample, so
// a test can see the viewport move along the eased curve rather than teleport.
//
//   node scripts/agent-harness/watch-jump.mjs [--ms 700] [--port 9333]
//
// Only the orchestrator drives a harness instance; do not run this against an
// instance someone else is driving.
import {
  LATEST_FILE, parseArgs, loadRun, resolvePort, listTargets, pickMainPage, Cdp, evaluate,
} from './lib.mjs';

const { opts } = parseArgs(process.argv.slice(2));
const run = loadRun(opts);
const port = resolvePort(opts, run);
const ms = Number(opts.ms ?? 700);
const page = pickMainPage(await listTargets(port));
if (!page) { console.error('watch-jump: no main page target'); process.exit(1); }
const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
try {
  const before = await evaluate(cdp, 'JSON.stringify(window.__afterterm.viewport())');
  console.log(`before: ${before}`);
  const clicked = await evaluate(cdp, `(() => { const b = document.querySelector('.jump-btn'); if (!b) return 'no button'; b.click(); return 'clicked ' + b.getAttribute('data-jump'); })()`);
  console.log(clicked);
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await evaluate(cdp, 'JSON.stringify(window.__afterterm.viewport())');
    console.log(`+${String(Date.now() - t0).padStart(4)}ms ${v}`);
    await new Promise(r => setTimeout(r, 50));
  }
  const jump = await evaluate(cdp, `(() => { const b = document.querySelector('.jump-btn'); return b ? 'jump: shown target=' + b.getAttribute('data-jump') : 'jump: hidden'; })()`);
  console.log(jump);
} finally {
  cdp.close();
}
void LATEST_FILE;

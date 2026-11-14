// Drives the loops tour mock (docs/mockups/loops-tour.html) in a headless Edge
// started with --remote-debugging-port, at the app's own size (the mock's stage is
// drawn 1:1 on a 1952px wide page: 1920 plus its 16px gutters), clicking Next with
// the same timing as the app's recording, so the two videos can be compared.
// Headless Edge opens no window, so it takes no focus.
//
//   msedge --headless=new --remote-debugging-port=9338 --user-data-dir=<scratch> <file url of the mock>
//   node scripts/agent-harness/tour-mock-drive.mjs --port 9338 [--read-ms 2000]
//   (record it with: node scripts/agent-harness/record.mjs --port 9338 --out <file.mp4>)
import { Cdp, evaluate, listTargets, pickMainPage, parseArgs, sleep } from './lib.mjs';

const { opts } = parseArgs(process.argv.slice(2));
const port = Number(opts.port ?? 9338);
const readMs = Number(opts['read-ms'] ?? 2000);
// How long each step's picture takes to play, as in the app recording.
const SETTLE = [1500, 5000, 4000, 1500, 1800, 1500, 2000, 1500];

const page = pickMainPage(await listTargets(port));
if (!page) throw new Error(`no page on port ${port}`);
const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
// Start again at step 1 (Skip ends the running tour; a click on the first step note restarts it).
await evaluate(cdp, `document.getElementById('cSkip').click(); setTimeout(() => document.querySelector('[data-go="0"]').click(), 50); 1`);
await sleep(600);
for (let i = 0; i < 8; i++) {
  await sleep(SETTLE[i] + readMs);
  console.log('step', i + 1, await evaluate(cdp, `document.getElementById('cTitle').textContent || '(the keys)'`));
  await evaluate(cdp, `document.getElementById('cNext').click(); 1`);
}
await sleep(3000);
cdp.close();

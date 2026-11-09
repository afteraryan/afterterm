// Tester helper (scratch, not in the repo): a real mouse drag between two cells of one
// terminal through CDP, then reads window.__afterterm.selection(tab) at chosen times.
// usage: node tdrag.mjs <data-dir> <tab> --from "<row text>" <col> --to "<row text>" <col>
//          [--steps 12] [--reads 0,1000,3000] [--shots <prefix>] [--press-only]
// --reads: ms after the release at which the selection is read (default 0,1000,3000).
// --shots: save a screenshot at every read as <prefix>-<ms>ms.png.
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
const lib = await import(pathToFileURL('D:/Pitara/Work/Tinkering/afterterm/.claude/worktrees/find-selection/scripts/agent-harness/lib.mjs').href);
const { loadRun, resolvePort, listTargets, pickMainPage, Cdp, evaluate, sleep } = lib;

const argv = process.argv.slice(2);
const [dataDir, tab] = argv;
const at = name => argv.indexOf(name);
const iFrom = at('--from'); const iTo = at('--to');
const fromText = argv[iFrom + 1]; const fromCol = Number(argv[iFrom + 2]);
const toText = argv[iTo + 1]; const toCol = Number(argv[iTo + 2]);
const opt = (name, def) => { const i = at(name); return i >= 0 ? argv[i + 1] : def; };
const steps = Number(opt('--steps', 12));
const reads = String(opt('--reads', '0,1000,3000')).split(',').map(Number);
const shotPrefix = opt('--shots', null);

const T0 = Date.now(); const lap = m => console.log('  [t+' + (Date.now() - T0) + 'ms] ' + m);
const run = loadRun({ 'data-dir': dataDir });
const port = resolvePort({ 'data-dir': dataDir }, run);
const page = pickMainPage(await listTargets(port));
const cdp = await Cdp.connect(page.webSocketDebuggerUrl); lap('connected');
try {
  const cell = async (text, col) => evaluate(cdp, `(() => { const r = window.__afterterm.findRow(${JSON.stringify(tab)}, ${JSON.stringify(text)}); return r ? { row: r, ...window.__afterterm.cellCentre(${JSON.stringify(tab)}, r, ${col}) } : null; })()`);
  const a = await cell(fromText, fromCol);
  const b = await cell(toText, toCol); lap('cells found');
  if (!a || !b || a.x === undefined || b.x === undefined) throw new Error(`a cell is not on screen (from ${JSON.stringify(a)}, to ${JSON.stringify(b)})`);
  const send = (type, x, y, button, extra = {}) => cdp.send('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), button, ...extra });
  await send('mouseMoved', a.x, a.y, 'none');
  await send('mousePressed', a.x, a.y, 'left', { clickCount: 1 });
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await send('mouseMoved', a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, 'left');
    await sleep(16);
  }
  await send('mouseReleased', b.x, b.y, 'left', { clickCount: 1 }); lap('released');
  const t0 = Date.now();
  console.log(`drag from row ${a.row} col ${fromCol} (${fromText}) to row ${b.row} col ${toCol} (${toText}), ${steps} steps`);
  for (const ms of reads) {
    const wait = ms - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
    const sel = await evaluate(cdp, `window.__afterterm.selection(${JSON.stringify(tab)})`);
    const live = await evaluate(cdp, `window.__afterterm.tail(${JSON.stringify(tab)}, 1)`);
    console.log(`+${ms}ms (read at ${Date.now() - t0}ms) selection: ${JSON.stringify(sel)} | last row: ${JSON.stringify(live)}`);
    if (shotPrefix) {
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(`${shotPrefix}-${ms}ms.png`, Buffer.from(shot.data, 'base64'));
    }
  }
} finally {
  cdp.close();
}
process.exit(0);

// AFT-72 toast hold test, driven over CDP against a harness dev build launched with
// --env AFTERTERM_NOTIFY_STATE=<state file>. Plays every branch of the hold by
// writing a state word into that file, pushes toasts through the main window's
// window.afterterm.notify.push, and samples what main knows
// (window.afterterm.harness.notifier()) and what the overlay's page knows (its
// cards and its expiry clock). Each row writes its samples to the JSON log and,
// when asked, a capture of the toast corner.
//
//   node hold-test.mjs --port <n> --state-file <file> --out <captures folder> [--rows a,b,...]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, listTargets, pickMainPage, pickNotifierPage, Cdp, evaluate, sleep } from '../../../../scripts/agent-harness/lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { opts } = parseArgs(process.argv.slice(2));
const port = Number(opts.port);
const stateFile = opts['state-file'];
const out = opts.out;
const rows = opts.rows ? String(opts.rows).split(',') : null;

const targets = await listTargets(port);
const main = await Cdp.connect(pickMainPage(targets).webSocketDebuggerUrl);
const ov = await Cdp.connect(pickNotifierPage(targets).webSocketDebuggerUrl);

const log = [];
const t0 = Date.now();
const note = (row, what, data) => {
  const entry = { t: Date.now() - t0, row, what, ...data };
  log.push(entry);
  console.log(JSON.stringify(entry));
};
const setState = (word) => fs.writeFileSync(stateFile, word);
const hold = () => evaluate(main, 'window.afterterm.harness.notifier()');
const overlay = () => evaluate(ov, `({
  cards: [...document.querySelectorAll('.notif-card')].map(c => c.dataset.toastId),
  clock: window.__afterterm.toastClock(),
})`);
const snap = async () => {
  const h = await hold();
  const o = await overlay();
  return {
    visible: h.visible, onScreen: h.onScreen, held: h.hold.held, toasts: h.hold.toasts,
    polling: h.polling, probes: h.probes, lastProbe: h.lastProbe?.state,
    cards: o.cards, overlayOnScreen: o.clock.onScreen, focused: o.clock.focused,
    deadlines: Object.fromEntries(Object.entries(o.clock.deadlines).map(([k, v]) => [k, v === null ? null : v - o.clock.now])),
  };
};
let seq = 0;
const push = async (tabId, label) => {
  const id = `${tabId}-${++seq}`;
  await evaluate(main, `window.afterterm.notify.push({ id: '${id}', tabId: '${tabId}', type: 'done', primaryLabel: '${label}', secondaryLabel: 'Toast hold test', projectColor: '#60a5fa', message: 'Finished' }); 'pushed'`);
  return id;
};
const dismiss = (tabId) => evaluate(main, `window.afterterm.notify.dismissTab('${tabId}'); 'dismissed'`);
const capture = (name) => {
  if (!out) return;
  const r = execFileSync('pwsh', ['-NoProfile', '-File', path.join(here, 'hold-capture.ps1'), '-Display', '2',
    '-Full', path.join(out, 'displays', `${name}.png`), '-Crop', path.join(out, `${name}.png`)], { encoding: 'utf8' });
  note('capture', name, { result: r.trim() });
};
// Samples every 100 ms until pred(snapshot) holds or the time runs out; returns
// the ms it took (or null) and the last snapshot.
const until = async (row, what, pred, ms) => {
  const start = Date.now();
  let s;
  while (Date.now() - start <= ms) {
    s = await snap();
    if (pred(s)) { const took = Date.now() - start; note(row, what, { took, ...s }); return { took, s }; }
    await sleep(100);
  }
  note(row, `${what} (NOT within ${ms} ms)`, s);
  return { took: null, s };
};
const clearAll = async () => {
  for (const tab of ['row-a', 'row-b', 'row-c', 'row-d', 'row-e', 'row-f']) await dismiss(tab);
  await sleep(400);
};
const want = (name) => !rows || rows.includes(name);

// The overlay's page never has real focus under the harness; play "not focused"
// so a toast stays on screen until the row is done with it (rows a to d and f),
// and "focused" for the lifetime row (e).
await evaluate(ov, 'window.__afterterm.mainFocus(false)');

if (want('a')) {
  // Row a: busy at the push holds the toast; accepts shows it within one poll.
  await clearAll();
  setState('busy');
  const tPush = Date.now();
  await push('row-a', 'Held while busy');
  await sleep(1500);
  const held = await snap();
  note('a', 'busy: 1.5 s after the push', held);
  capture('31-busy-toast-held-overlay-hidden');
  await sleep(4000);
  note('a', 'busy: 5.5 s after the push, still held across polls', await snap());
  setState('accepts');
  const r = await until('a', 'accepts written: overlay visible', s => s.visible, 4000);
  note('a', 'summary', { heldAtFirst: !held.visible && held.held, cardWaitingInOverlay: held.cards.length === 1, shownAfterMs: r.took, pushToShownMs: Date.now() - tPush });
  await sleep(300);
  capture('32-busy-then-accepts-toast-shown');
}

if (want('b')) {
  // Row b: a toast on screen hides when presentation mode comes on, stays hidden
  // through fullscreen, and shows again on unknown.
  await clearAll();
  setState('accepts');
  await push('row-b', 'On screen, then a presentation');
  await until('b', 'accepts: shown', s => s.visible, 3000);
  setState('presentation');
  const h = await until('b', 'presentation written: overlay hidden', s => !s.visible && s.held, 4000);
  capture('33-presentation-toast-on-screen-hidden');
  setState('fullscreen');
  await sleep(3500);
  note('b', 'fullscreen: one poll later, still held', await snap());
  setState('unknown');
  const u = await until('b', 'unknown written (a failed probe): overlay visible', s => s.visible, 4000);
  await sleep(300);
  capture('34-unknown-after-a-hold-toast-shown-again');
  note('b', 'summary', { hiddenAfterMs: h.took, shownAfterMs: u.took });
}

if (want('c')) {
  // Row c: accepts at the push shows at once, as before.
  await clearAll();
  setState('accepts');
  const start = Date.now();
  await push('row-c', 'Nothing in front');
  const r = await until('c', 'accepts at the push: overlay visible', s => s.visible, 2000);
  note('c', 'summary', { pushToVisibleMs: Date.now() - start, sampledTook: r.took });
  await sleep(300);
  capture('35-accepts-toast-shown-at-once');
}

if (want('d')) {
  // Row d: unknown at the push shows (a failed probe never hides toasts).
  await clearAll();
  setState('unknown');
  const start = Date.now();
  await push('row-d', 'Probe failed');
  const r = await until('d', 'unknown at the push: overlay visible', s => s.visible, 2000);
  note('d', 'summary', { pushToVisibleMs: Date.now() - start, sampledTook: r.took });
  await sleep(300);
  capture('36-unknown-toast-shown-at-once');
}

if (want('e')) {
  // Row e: a held toast's 5 seconds start when it shows, not when it arrived.
  await clearAll();
  await evaluate(ov, 'window.__afterterm.mainFocus(true)');
  setState('busy');
  await push('row-e', 'Lifetime from the show');
  await sleep(8000);
  const s8 = await snap();
  note('e', 'busy and focused: 8 s after the push', s8);
  setState('accepts');
  const shown = await until('e', 'accepts: shown', s => s.visible, 4000);
  const tShown = Date.now();
  const gone = await until('e', 'the toast went on its own', s => s.cards.length === 0, 9000);
  note('e', 'summary', { stillThereAfter8sHeld: s8.cards.length === 1, deadlineWhileHeld: s8.deadlines, shownAfterMs: shown.took, goneMsAfterShown: gone.took === null ? null : Date.now() - tShown });
  await evaluate(ov, 'window.__afterterm.mainFocus(false)');
}

if (want('f')) {
  // Row f: the toasts going while held ends the hold and the polling.
  await clearAll();
  setState('busy');
  await push('row-f', 'Dismissed while held');
  await until('f', 'busy: held', s => s.held, 3000);
  await dismiss('row-f');
  await sleep(800);
  const after = await snap();
  note('f', 'dismissed while held: 0.8 s later', after);
  await sleep(4000);
  const later = await snap();
  note('f', 'dismissed while held: 4.8 s later, no more probes', later);
  note('f', 'summary', { holdEnded: !after.held && !after.toasts, pollingStopped: !after.polling, probesStayed: later.probes === after.probes, visible: later.visible });
}

if (out) fs.writeFileSync(path.join(out, opts.log ?? '30-toast-hold-override-samples.json'), JSON.stringify(log, null, 2));
main.ws.close();
ov.ws.close();

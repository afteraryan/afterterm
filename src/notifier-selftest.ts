import { app, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';

// Headless geometry self-test for the notifier overlay.
//
// Runs only when AFTERTERM_NOTIFY_TEST=1. It drives the real overlay window
// through a push/dismiss sequence (the exact IPC path production uses) and reads
// back the live window bounds after each step, then asserts the window:
//   • starts hidden (no toasts)
//   • becomes visible and grows in height as toasts stack
//   • stays anchored to the bottom-right corner (constant bottom edge)
//   • never balloons to the old fixed 700px — it's content-sized
//   • carries no window title (the "index.html" caption / white-bar source)
//   • hides again once every toast is dismissed
//
// Results print as `NOTIFY_SELFTEST | ...` lines and are written to
// notify-selftest-result.json at the repo root, then the app quits.

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface Snapshot {
  label: string;
  visible: boolean;
  width: number;
  height: number;
  bottom: number;
}

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

export async function runNotifierSelfTest(win: BrowserWindow): Promise<void> {
  if (win.webContents.isLoading()) {
    await new Promise<void>((r) => win.webContents.once('did-finish-load', () => r()));
  }
  // Let React mount and register its onPush / ResizeObserver listeners.
  await wait(900);

  const snaps: Snapshot[] = [];
  const snap = (label: string) => {
    const b = win.getBounds();
    const s: Snapshot = { label, visible: win.isVisible(), width: b.width, height: b.height, bottom: b.y + b.height };
    snaps.push(s);
    console.log(`NOTIFY_SELFTEST | snap | ${label.padEnd(26)} visible=${s.visible} h=${s.height} bottom=${s.bottom}`);
    return s;
  };

  const push = (i: number) => {
    win.showInactive();
    win.webContents.send('notify:push', {
      id: `toast-${i}`,
      tabId: `tab-${i}`,
      type: 'done',
      primaryLabel: `session-${i}.exe`,
      message: `Fix modal routing and navigation on project pages — response complete (${i})`,
    });
  };
  const dismiss = (i: number) => win.webContents.send('notify:dismiss-tab', `tab-${i}`);

  const s0 = snap('initial (0 toasts)');
  push(1); await wait(450); const s1 = snap('1 toast');
  push(2); await wait(450); const s2 = snap('2 toasts');
  push(3); await wait(450); const s3 = snap('3 toasts');
  dismiss(2); await wait(450); const s2b = snap('after dismiss 1 (2 left)');
  dismiss(1); dismiss(3); await wait(550); const sEnd = snap('after dismiss all (0)');

  // The DWM caption (the "white bar") paints the *native window* title, which
  // page-title-updated.preventDefault() controls — not the document title.
  const title = win.getTitle();

  const checks: Check[] = [
    { name: 'starts hidden', pass: s0.visible === false,
      detail: `visible=${s0.visible}` },
    { name: '1 toast: visible & content-sized', pass: s1.visible && s1.height > 30 && s1.height < 200,
      detail: `h=${s1.height}` },
    { name: 'height grows with toast count', pass: s1.height < s2.height && s2.height < s3.height,
      detail: `${s1.height} < ${s2.height} < ${s3.height}` },
    { name: 'bottom edge stays anchored', pass: [s1, s2, s3, s2b].every(s => Math.abs(s.bottom - s1.bottom) <= 2),
      detail: `bottoms=${[s1, s2, s3, s2b].map(s => s.bottom).join(',')}` },
    { name: 'width fixed (~340, DPI rounding ok)', pass: [s1, s2, s3].every(s => Math.abs(s.width - 340) <= 4),
      detail: `widths=${[s1, s2, s3].map(s => s.width).join(',')}` },
    { name: 'shrinks when a toast is dismissed', pass: s2b.height < s3.height && s2b.height > 30,
      detail: `${s2b.height} < ${s3.height}` },
    { name: 'never balloons (content-sized, not 700)', pass: s3.height < 360,
      detail: `maxHeight=${s3.height}` },
    { name: 'no window title (white-bar caption source)', pass: title === '',
      detail: `title=${JSON.stringify(title)}` },
    { name: 'hides after all dismissed', pass: sEnd.visible === false,
      detail: `visible=${sEnd.visible}` },
  ];

  const passed = checks.filter(c => c.pass).length;
  const allPass = passed === checks.length;

  console.log('NOTIFY_SELFTEST | ─────────────────────────────────────────────');
  for (const c of checks) {
    console.log(`NOTIFY_SELFTEST | ${c.pass ? 'PASS' : 'FAIL'} | ${c.name.padEnd(46)} (${c.detail})`);
  }
  console.log(`NOTIFY_SELFTEST | RESULT | ${passed}/${checks.length} passed | ${allPass ? 'ALL PASS' : 'FAILURES PRESENT'}`);

  try {
    fs.writeFileSync(
      path.join(app.getAppPath(), 'notify-selftest-result.json'),
      JSON.stringify({ allPass, passed, total: checks.length, title, snaps, checks }, null, 2),
    );
  } catch (err) {
    console.log(`NOTIFY_SELFTEST | could not write result file: ${String(err)}`);
  }

  await wait(200);
  app.exit(allPass ? 0 : 1);
}

// Visual demo: push a few staggered toasts and leave them up so a human can
// eyeball the overlay — check for any residual white bar above the stack, and
// confirm clicks pass through to whatever is behind the empty/transparent areas.
// Run with AFTERTERM_NOTIFY_DEMO=1; the window stays open until the app is quit.
export async function runNotifierDemo(win: BrowserWindow): Promise<void> {
  if (win.webContents.isLoading()) {
    await new Promise<void>((r) => win.webContents.once('did-finish-load', () => r()));
  }
  await wait(800);
  const push = (i: number, type: string, label: string, msg: string) => {
    win.showInactive();
    win.webContents.send('notify:push', { id: `demo-${i}`, tabId: `demo-${i}`, type, primaryLabel: label, message: msg });
  };
  push(1, 'done', 'afteraryan.com', 'Fix modal routing and navigation on project pages · Response complete');
  await wait(1200);
  push(2, 'attention', 'pwsh · build', 'Needs your input — overwrite existing file?');
  await wait(1200);
  push(3, 'background', 'wsl · deploy', 'Background task still running');
  console.log('NOTIFY_DEMO | three toasts shown — inspect for white bar and click-through, then close the app.');
}

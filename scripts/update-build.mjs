// Replace the production afterterm build with a freshly built one, in one go:
// close the running app, swap the folders, start the new build, and wake every
// thread that was awake when the app closed (a chat comes back through
// `claude --resume`, a server through its last command, a shell fresh in its folder).
//
//   node scripts/update-build.mjs [--new <folder>] [--no-wake] [--dry-run] [--port <n>]
//
//   --new <folder>  the folder holding the new afterterm.exe. Default: the newest
//                   .claude/worktrees/*/out/afterterm-win32-x64 that has one.
//   --no-wake       close, swap and start only; leave every thread asleep.
//   --dry-run       print what would happen (the build, the threads) and stop.
//   --port <n>      the remote debugging port the new build is started with so this
//                   script can wake threads through it (default 9333). Local only.
//
// Run it from a PowerShell window that is NOT inside afterterm: closing the app
// ends every shell in it, this one included. The folder swap keeps the standard
// path, so the taskbar shortcut keeps working, and the old build stays beside it
// as out\afterterm-old-<timestamp> (the next `npm run build` cleans those up).
//
// What it cannot do: keep a process alive across the swap. ConPTY handles die with
// the app, so a Claude turn that was mid-run is interrupted and has to be sent
// again, and a shell loses whatever it was running (see
// docs/design-01-persistent-pty-host.md for the design that would fix that).

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  REPO_ROOT, parseArgs, powershell, listProcesses, isProductionAfterterm, pidExists, spawnViaWmi,
  listTargets, pickMainPage, pickNotifierPage, Cdp, evaluate, sleep,
} from './agent-harness/lib.mjs';

const { opts } = parseArgs(process.argv.slice(2));
const CUR = path.join(REPO_ROOT, 'out', 'afterterm-win32-x64');
const SESSION = path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'afterterm', 'session.json');
const PORT = Number(opts.port ?? 9333);
const WAKE = !opts['no-wake'];
const DRY = Boolean(opts['dry-run']);

function fail(msg) { console.error(`\n${msg}`); process.exit(1); }
function log(msg) { console.log(msg); }

// ─── 1. The new build ──────────────────────────────────────────────────────────
function newestWorktreeBuild() {
  const root = path.join(REPO_ROOT, '.claude', 'worktrees');
  if (!fs.existsSync(root)) return null;
  const found = [];
  for (const name of fs.readdirSync(root)) {
    const exe = path.join(root, name, 'out', 'afterterm-win32-x64', 'afterterm.exe');
    if (fs.existsSync(exe)) found.push({ dir: path.dirname(exe), mtime: fs.statSync(exe).mtimeMs });
  }
  found.sort((a, b) => b.mtime - a.mtime);
  return found[0]?.dir ?? null;
}

const NEW = opts.new ? path.resolve(String(opts.new)) : newestWorktreeBuild();
if (!NEW) fail('No new build found. Build one in a worktree (npm run build there) or pass --new <folder>.');
if (!fs.existsSync(path.join(NEW, 'afterterm.exe'))) fail(`No afterterm.exe in ${NEW}`);
if (path.resolve(NEW).toLowerCase() === CUR.toLowerCase()) fail('The new build is already the production build.');

function buildVersion(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'resources', 'app', 'package.json'), 'utf8')).version; } catch { return '?'; }
}
log(`New build:     ${NEW}  (version ${buildVersion(NEW)}, built ${new Date(fs.statSync(path.join(NEW, 'afterterm.exe')).mtimeMs).toLocaleString()})`);
log(`Current build: ${CUR}  (version ${fs.existsSync(CUR) ? buildVersion(CUR) : 'none'})`);

// ─── 2. What is awake right now ────────────────────────────────────────────────
// session.json is written two seconds after any change, so it is the live state
// up to that moment. Read it before the close: the quit flush marks every thread
// asleep, and that would be too late to know which ones to bring back.
let awake = [];
let activeTabId = null;
if (fs.existsSync(SESSION)) {
  try {
    const session = JSON.parse(fs.readFileSync(SESSION, 'utf8'));
    const tabs = Array.isArray(session.tabs) ? session.tabs : [];
    awake = tabs.filter(t => !t.asleep).map(t => ({ id: t.id, kind: t.claudeSessionId ? 'chat' : (t.port ? 'server' : 'shell'), title: t.claudeTitle || t.title || t.id }));
    activeTabId = session.activeTabId ?? null;
  } catch (e) {
    log(`Could not read ${SESSION} (${e.message}); nothing will be woken.`);
  }
}
log(`Awake threads: ${awake.length}${awake.length ? '\n' + awake.map(t => `  ${t.id}  ${t.kind}  ${t.title}`).join('\n') : ''}`);
if (!WAKE) log('(--no-wake: they will stay asleep after the restart)');

// ─── 3. Refuse to run from inside afterterm ────────────────────────────────────
// Closing the app ends every shell in it, this script included: the swap would
// never happen (that is exactly what went wrong on 2026-10-22, when the script was
// first tried from a Claude session inside the app). The parent chain says.
const procs = listProcesses();
function insideAfterterm() {
  const seen = new Set();
  let pid = process.pid;
  while (pid && !seen.has(pid)) {
    seen.add(pid);
    const p = procs.find(x => x.pid === pid);
    if (!p) return false;
    if (/^afterterm\.exe$/i.test(p.name ?? '')) return true;
    pid = p.ppid;
  }
  return false;
}
const inside = insideAfterterm();
if (inside) log('\nThis shell is running inside afterterm.');

if (DRY) { log(`\nDry run: nothing closed, swapped or started.${inside ? ' The real run must be started from a PowerShell window outside afterterm.' : ''}`); process.exit(0); }
if (inside) fail('Run this from a PowerShell window outside afterterm (Windows Terminal, or Win+R then powershell). Nothing was changed.');

// ─── 4. Close the app ──────────────────────────────────────────────────────────
function runningAfterterm() {
  return listProcesses().filter(isProductionAfterterm).map(p => p.pid);
}
const before = runningAfterterm();
if (before.length) {
  log(`\nClosing afterterm (${before.length} process(es))...`);
  // WM_CLOSE on the main window: the renderer flushes every thread's tail and the
  // session, main drains the PTYs, then the app quits. The same as clicking x.
  powershell(`Get-Process afterterm -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { $null = $_.CloseMainWindow() }`);
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline && before.some(pidExists)) await sleep(500);
  if (before.some(pidExists)) {
    fail('afterterm is still running after 60s. If it is asking whether to close a thread with a server, answer it, then run this again. Nothing was swapped.');
  }
  log('Closed.');
} else {
  log('\nafterterm is not running.');
}

// ─── 5. Swap the folders ───────────────────────────────────────────────────────
async function renameWithRetry(from, to) {
  let last;
  for (let i = 0; i < 20; i++) {
    try { fs.renameSync(from, to); return; } catch (e) { last = e; await sleep(500); }
  }
  throw last;
}
const old = path.join(REPO_ROOT, 'out', `afterterm-old-${Date.now()}`);
if (fs.existsSync(CUR)) {
  try { await renameWithRetry(CUR, old); } catch (e) { fail(`Could not move the current build aside (${e.code}): something still holds ${CUR}. Nothing was swapped.`); }
  log(`Old build kept at ${old}`);
}
try { await renameWithRetry(NEW, CUR); } catch (e) {
  // Put the old one back so the taskbar shortcut keeps working.
  try { fs.renameSync(old, CUR); } catch {}
  fail(`Could not move the new build into place (${e.code}). The old build is back at ${CUR}.`);
}
log(`New build is now at ${CUR} (version ${buildVersion(CUR)})`);

// ─── 6. Start it ───────────────────────────────────────────────────────────────
// Through WMI, not child_process: a child of this script would die with the shell
// this script runs in (lib.mjs, spawnViaWmi). The env is this shell's own, plus
// the debugging port when threads are to be woken, so the app and every shell it
// spawns see what a taskbar launch would give them.
const env = { ...process.env };
if (WAKE && awake.length) env.AFTERTERM_REMOTE_DEBUG_PORT = String(PORT);
const spawnDir = path.join(os.tmpdir(), 'afterterm-agent-harness');
fs.mkdirSync(spawnDir, { recursive: true });
let appPid;
try {
  appPid = spawnViaWmi({ commandLine: `"${path.join(CUR, 'afterterm.exe')}"`, cwd: CUR, env, dataDir: spawnDir });
} catch (e) {
  fail(`The build was swapped but afterterm could not be started (${e.message}). Start it from the taskbar.`);
}
log(`Started afterterm (pid ${appPid}).`);

if (!WAKE || !awake.length) process.exit(0);

// ─── 7. Wake what was awake ────────────────────────────────────────────────────
// Over the remote debugging port: the notifier window's own tab-click channel
// opens a thread by id (what a toast click does), and the asleep pane's Wake
// button is clicked in the main window, the same as a hand on the mouse.
async function waitFor(fn, ms, what) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try { const v = await fn(); if (v) return v; } catch {}
    await sleep(300);
  }
  throw new Error(`timed out waiting for ${what}`);
}

let main, notifier;
try {
  const targets = await waitFor(async () => {
    const t = await listTargets(PORT);
    return pickMainPage(t) && pickNotifierPage(t) ? t : null;
  }, 30_000, 'the app to come up');
  main = await Cdp.connect(pickMainPage(targets).webSocketDebuggerUrl);
  notifier = await Cdp.connect(pickNotifierPage(targets).webSocketDebuggerUrl);
  await waitFor(() => evaluate(main, `!!(window.__afterterm && window.__afterterm.tab(${JSON.stringify(awake[0].id)}))`), 20_000, 'the session to restore');
} catch (e) {
  fail(`The app started but could not be reached to wake threads (${e.message}). Wake them by hand.`);
}

const woken = [];
const failed = [];
for (const t of awake) {
  try {
    await evaluate(notifier, `window.afterterm.notifier.clickTab(${JSON.stringify(t.id)})`);
    await waitFor(() => evaluate(main, `!!document.querySelector('.asleep-pane[data-tab-id=' + ${JSON.stringify(JSON.stringify(t.id))} + '] button[data-wake]')`), 5_000, `the asleep pane of ${t.id}`);
    await evaluate(main, `document.querySelector('.asleep-pane[data-tab-id=' + ${JSON.stringify(JSON.stringify(t.id))} + '] button[data-wake]').click()`);
    await waitFor(() => evaluate(main, `(window.__afterterm.tab(${JSON.stringify(t.id)}) || {}).asleep === false`), 5_000, `${t.id} to wake`);
    woken.push(t);
    log(`  woke ${t.id}  ${t.kind}  ${t.title}`);
    // A chat's wake types `claude --resume` into its fresh shell; give it a moment
    // before the next thread takes the screen.
    await sleep(1500);
  } catch (e) {
    failed.push(t);
    log(`  could not wake ${t.id} (${t.title}): ${e.message}`);
  }
}
if (activeTabId && awake.some(t => t.id === activeTabId)) {
  try { await evaluate(notifier, `window.afterterm.notifier.clickTab(${JSON.stringify(activeTabId)})`); } catch {}
}
main.close(); notifier.close();
log(`\nDone. Woke ${woken.length} of ${awake.length} thread(s).${failed.length ? ' Wake the rest by hand.' : ''}`);
process.exit(0);

// Launch the afterterm dev build for an agent to drive: throwaway user-data dir
// (optionally seeded from a copy of a session.json), window placed on a chosen
// display, Chrome DevTools Protocol exposed on a local port.
//
//   node scripts/agent-harness/launch.mjs [--session <session.json>] [--data-dir <dir>]
//                                         [--display primary|secondary|N] [--port <n>]
//                                         [--log <file>] [--timeout <seconds>]
//                                         [--claude-resume none|background|all]
//                                         [--env KEY=VALUE ...]
//
// Safety: this never touches %APPDATA%\afterterm (the real profile) and never
// touches the running production afterterm. It only starts a fresh electron-forge
// dev process and records its pid so stop.mjs can kill exactly that tree.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  REPO_ROOT, LATEST_FILE, DEFAULT_PORT, parseArgs, writeJson, fetchJson, listTargets,
  pickMainPage, listProcesses, processTree, pidListeningOn, findProcess,
  isProductionAfterterm, isDevElectron, spawnViaWmi, pidExists, sleep,
} from './lib.mjs';

const { opts } = parseArgs(process.argv.slice(2));

if (opts.help) {
  console.log(`usage: node scripts/agent-harness/launch.mjs [options]
  --session <file>    session.json to seed the throwaway profile from (copied, never edited)
  --prefs <file>      JSON merged into the throwaway prefs.json (lastOpenedAt, editorPath, ...)
  --data-dir <dir>    user-data dir to use (default: a fresh folder under %TEMP%\\afterterm-agent-harness)
  --display <which>   primary | secondary | <index into screen.getAllDisplays()> (default: secondary)
  --port <n>          remote debugging port (default: ${DEFAULT_PORT})
  --log <file>        stdout+stderr of the dev build (default: <data-dir>\\harness.log)
  --timeout <sec>     how long to wait for the DevTools endpoint (default: 120)
  --claude-resume <m> which tabs keep their claudeSessionId in the seeded copy (default: none)
                        none:       every tab loses it, so no click can resume a real session
                        background: the active tab loses it so nothing resumes at launch; other
                                    tabs keep it (restorable marker shows) and resume when clicked
                        all:        the copy is seeded unchanged (the active tab resumes at once)
  --env KEY=VALUE     extra environment variable for the dev build (repeatable, or one
                        --env with several pairs separated by ";"). Cannot override
                        AFTERTERM_USER_DATA_DIR, AFTERTERM_DISPLAY,
                        AFTERTERM_REMOTE_DEBUG_PORT or AFTERTERM_HARNESS`);
  process.exit(0);
}

const port = Number(opts.port ?? DEFAULT_PORT);
const display = String(opts.display ?? 'secondary');
const timeoutMs = Number(opts.timeout ?? 120) * 1000;
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dataDir = path.resolve(opts['data-dir'] ?? path.join(os.tmpdir(), 'afterterm-agent-harness', `run-${stamp}`));
const logFile = path.resolve(opts.log ?? path.join(dataDir, 'harness.log'));
const sessionSource = opts.session ? path.resolve(opts.session) : null;
const claudeResume = String(opts['claude-resume'] ?? 'none');
if (!/^(background|none|all)$/.test(claudeResume)) fail(`bad --claude-resume ${claudeResume} (background, none or all)`);

if (!Number.isInteger(port) || port <= 0) fail(`bad --port ${opts.port}`);
if (!/^(primary|secondary|\d+)$/.test(display)) fail(`bad --display ${display} (primary, secondary or an index)`);

// --env KEY=VALUE, repeatable, or one --env with several pairs separated by ";".
// Never lets a caller override the four variables the harness itself relies on:
// a stray --env AFTERTERM_DISPLAY=primary would silently defeat the "stay off the
// display a person is working on" safety rule, so it fails loudly instead.
const RESERVED_ENV_KEYS = new Set([
  'AFTERTERM_USER_DATA_DIR', 'AFTERTERM_DISPLAY', 'AFTERTERM_REMOTE_DEBUG_PORT', 'AFTERTERM_HARNESS',
]);
const extraEnv = {};
const extraEnvKeys = [];
for (const raw of Array.isArray(opts.env) ? opts.env : []) {
  if (raw === true) fail('--env needs a KEY=VALUE argument');
  for (const pair of String(raw).split(';')) {
    const eq = pair.indexOf('=');
    if (eq === -1) fail(`bad --env ${pair} (expected KEY=VALUE)`);
    const key = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    if (!key) fail(`bad --env ${pair} (empty key)`);
    if (RESERVED_ENV_KEYS.has(key)) fail(`--env cannot override ${key}; the harness sets it itself`);
    extraEnv[key] = value;
    if (!extraEnvKeys.includes(key)) extraEnvKeys.push(key);
  }
}

// A DevTools endpoint already answering on the port means another harness run
// (or something else) owns it; two runs on one port would make drive/stop ambiguous.
if (await endpointAlive(port)) fail(`something already answers on http://127.0.0.1:${port}/json/version; stop it or pick another --port`);

// The real profile is read at most (when it is the --session source) and never
// used as the data dir.
const realProfile = path.join(process.env.APPDATA ?? '', 'afterterm');
if (realProfile && path.resolve(dataDir).toLowerCase() === realProfile.toLowerCase()) {
  fail(`refusing to use the real profile ${realProfile} as --data-dir`);
}

fs.mkdirSync(dataDir, { recursive: true });

if (sessionSource) {
  if (!fs.existsSync(sessionSource)) fail(`--session file not found: ${sessionSource}`);
  // The source is only ever read. The seed is written from the parsed copy so a
  // non-session file fails here rather than inside the app.
  const session = JSON.parse(fs.readFileSync(sessionSource, 'utf8'));
  // The active tab of a restored session resumes its Claude session at launch;
  // background tabs resume only when clicked. A copy of the live profile has the
  // session the real app has open right now as its active tab, and resuming that
  // same session from the dev build interfered with the live one (the live
  // Claude Code process restarted and the dev build's tree died). Any background
  // tab may be open in the live app too, and a harness click on it would resume
  // it, so the default strips every id; keep them only on purpose.
  if (claudeResume !== 'all' && Array.isArray(session.tabs)) {
    for (const tab of session.tabs) {
      if (claudeResume === 'none' || tab.id === session.activeTabId) { delete tab.claudeSessionId; delete tab.claudeCwd; }
    }
  }
  fs.writeFileSync(path.join(dataDir, 'session.json'), JSON.stringify(session, null, 2));
}

// The hook self-install fires a one-time "Claude Code notifications enabled" toast
// on a profile that has never shown it. Pre-marking it keeps the throwaway profile
// quiet; the hook itself stays enabled (reconcile is idempotent and the hook is
// already registered on a dev machine).
// --prefs <file> merges extra keys on top (a lastOpenedAt two days back makes Home show its
// "Last here" line; a fresh profile has no previous launch and shows nothing).
const extraPrefs = opts.prefs ? JSON.parse(fs.readFileSync(String(opts.prefs), 'utf8')) : {};
writeJson(path.join(dataDir, 'prefs.json'), { claudeHookToastShown: true, ...extraPrefs });

const forgeCli = path.join(REPO_ROOT, 'node_modules', '@electron-forge', 'cli', 'dist', 'electron-forge.js');
if (!fs.existsSync(forgeCli)) fail(`electron-forge CLI not found at ${forgeCli}; run npm install`);

const env = {
  ...process.env,
  ...extraEnv,
  AFTERTERM_USER_DATA_DIR: dataDir,
  AFTERTERM_DISPLAY: display,
  AFTERTERM_REMOTE_DEBUG_PORT: String(port),
  AFTERTERM_HARNESS: '1',
};

fs.appendFileSync(logFile, `\n=== agent-harness launch ${new Date().toISOString()} ===\n`);

// `node <forge cli> start`, run directly rather than through npx so there is one
// fewer wrapper in the tree. cmd.exe only exists to redirect stdout and stderr
// into the log file. The process is created through WMI (see spawnViaWmi) so it
// survives the shell that ran this script: a child spawned the ordinary way, even
// detached, died together with the agent's tool shell in testing.
const quote = s => `"${s}"`;
const commandLine = `cmd.exe /d /s /c "${quote(process.execPath)} ${quote(forgeCli)} start >> ${quote(logFile)} 2>&1"`;
let rootPid;
try {
  rootPid = spawnViaWmi({ commandLine, cwd: REPO_ROOT, env, dataDir });
} catch (e) {
  fail(`could not start the dev build: ${e.message}`);
}

const startedAt = new Date().toISOString();
const record = {
  pid: rootPid,
  rootImage: 'cmd.exe',
  electronPid: null,
  port,
  display,
  dataDir,
  log: logFile,
  repoRoot: REPO_ROOT,
  startedAt,
  sessionSource,
  claudeResume,
  extraEnv: extraEnvKeys,
  targets: [],
};
writeJson(path.join(dataDir, 'harness.json'), record);
writeJson(LATEST_FILE, record);

console.log(`data dir : ${dataDir}`);
console.log(`log      : ${logFile}`);
console.log(`root pid : ${rootPid} (cmd.exe wrapper; electron is found below)`);
console.log(`display  : ${display}`);
console.log(`extra env: ${extraEnvKeys.length ? extraEnvKeys.join(', ') : '(none)'}`);
console.log(`waiting for DevTools on http://127.0.0.1:${port} (up to ${timeoutMs / 1000}s)...`);

// Wait for the DevTools endpoint, then for the main window's page target (the
// endpoint comes up before the window has loaded anything).
const deadline = Date.now() + timeoutMs;
let version = null;
while (Date.now() < deadline) {
  if (!pidExists(rootPid)) fail(`the dev build exited early; tail of ${logFile}:\n${tail(logFile)}`);
  version = await endpointAlive(port);
  if (version) break;
  await sleep(500);
}
if (!version) fail(`DevTools endpoint did not answer within ${timeoutMs / 1000}s; tail of ${logFile}:\n${tail(logFile)}`);

let targets = [];
while (Date.now() < deadline) {
  try { targets = await listTargets(port); } catch { targets = []; }
  if (pickMainPage(targets)) break;
  await sleep(500);
}

// Identify the electron.exe browser process: the owner of the listening socket,
// falling back to the tree walk. Both are checked against the dev image path so
// a mistake here can never point stop.mjs at the production afterterm.
const procs = listProcesses();
const tree = processTree(procs, rootPid);
let electronPid = pidListeningOn(port);
let electron = electronPid ? findProcess(procs, electronPid) : null;
if (!isDevElectron(electron)) {
  electron = tree.find(isDevElectron) ?? null;
  electronPid = electron?.pid ?? null;
}
if (tree.some(isProductionAfterterm) || isProductionAfterterm(electron)) {
  fail('the launched tree contains a production afterterm process; refusing to record it');
}

// Creation time pins the pid: stop.mjs refuses a pid that Windows has since
// reused for another cmd.exe.
record.rootCreated = findProcess(procs, rootPid)?.created ?? null;
record.electronPid = electronPid;
record.electronPath = electron?.path ?? null;
record.browser = version.Browser ?? null;
record.tree = tree.map(p => ({ pid: p.pid, name: p.name }));
record.targets = targets.map(t => ({ type: t.type, url: t.url, id: t.id }));
writeJson(path.join(dataDir, 'harness.json'), record);
writeJson(LATEST_FILE, record);

console.log(`browser  : ${record.browser}`);
console.log(`electron : pid ${electronPid ?? 'unknown'} ${electron?.path ?? ''}`);
console.log(`tree     : ${summarise(record.tree)}`);
console.log('targets  :');
for (const t of targets) console.log(`  ${t.type.padEnd(8)} ${t.url}`);
if (!pickMainPage(targets)) console.log('  (main window page target not seen yet; drive.mjs will retry)');
console.log('');
console.log('drive it : npm run harness:drive -- bounds | sidebar | screenshot <out.png> | click "<selector>" | eval "<js>"');
console.log('stop it  : npm run harness:stop');
console.log(`record   : ${LATEST_FILE}`);

async function endpointAlive(p) {
  try { return await fetchJson(`http://127.0.0.1:${p}/json/version`, 1500); } catch { return null; }
}

// "electron.exe x5, cmd.exe x46" instead of a wall of pids.
function summarise(list) {
  const counts = new Map();
  for (const p of list) counts.set(p.name, (counts.get(p.name) ?? 0) + 1);
  return [...counts].map(([name, n]) => (n > 1 ? `${name} x${n}` : name)).join(', ');
}

function tail(file, lines = 30) {
  try { return fs.readFileSync(file, 'utf8').split('\n').slice(-lines).join('\n'); } catch { return '(no log)'; }
}

function fail(msg) {
  console.error(`launch: ${msg}`);
  process.exit(1);
}

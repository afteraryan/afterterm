// Stop a harness run: kill exactly the process tree launch.mjs recorded.
//
//   node scripts/agent-harness/stop.mjs [--data-dir <dir>]
//
// Reads harness.json (or latest.json), checks the recorded pid still exists and
// is still the same image it was at launch, checks the tree holds no production
// afterterm process, then kills that verified pid list with taskkill /F and
// verifies it is gone. It never kills by name and does not use taskkill /T (whose
// parent-id walk can pull in an unrelated process whose dead parent's pid was
// reused), so other electron or afterterm processes are untouched.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  LATEST_FILE, parseArgs, loadRun, writeJson, listProcesses, processTree, findProcess,
  isProductionAfterterm, sleep,
} from './lib.mjs';

const { opts } = parseArgs(process.argv.slice(2));

let run;
try { run = loadRun(opts); } catch (e) { fail(e.message); }
if (!run.pid) fail('the run record has no pid (was it launched with launch.mjs?)');
if (run.stoppedAt) fail(`this run was already stopped at ${run.stoppedAt}`);

const before = listProcesses();
const root = findProcess(before, run.pid);
if (!root) fail(`pid ${run.pid} no longer exists; nothing to stop (record: ${recordPath()})`);
if ((root.name ?? '').toLowerCase() !== (run.rootImage ?? '').toLowerCase()) {
  fail(`pid ${run.pid} is now ${root.name}, not the recorded ${run.rootImage}; the pid was reused, refusing to kill it`);
}
// Same image name is not enough for a cmd.exe root: compare creation time too
// (2s tolerance covers WMI rounding).
if (run.rootCreated && root.created && Math.abs(root.created - run.rootCreated) > 2000) {
  fail(`pid ${run.pid} was created at ${new Date(root.created).toISOString()}, the recorded root at ${new Date(run.rootCreated).toISOString()}; the pid was reused, refusing to kill it`);
}

const tree = processTree(before, run.pid);
const offenders = tree.filter(isProductionAfterterm);
if (offenders.length) {
  fail(`tree under pid ${run.pid} contains production afterterm processes, refusing: ${offenders.map(p => `${p.name}(${p.pid})`).join(', ')}`);
}
if (run.electronPid) {
  const el = findProcess(before, run.electronPid);
  if (el && !tree.some(p => p.pid === el.pid)) {
    console.log(`note: recorded electron pid ${run.electronPid} is no longer under the tree; only the tree is killed`);
  }
}

console.log(`killing tree under ${root.name}(${root.pid}): ${tree.map(p => `${p.name}(${p.pid})`).join(', ')}`);
try {
  execFileSync('taskkill.exe', ['/F', ...tree.flatMap(p => ['/PID', String(p.pid)])], { encoding: 'utf8', windowsHide: true, stdio: 'pipe' });
} catch (e) {
  // taskkill exits non-zero when some child already died between listing and
  // killing; verify below instead of trusting the exit code.
  console.log(`taskkill: ${String(e.stdout || e.message).trim()}`);
}

let remaining = tree;
for (let i = 0; i < 20 && remaining.length; i++) {
  await sleep(250);
  const now = listProcesses();
  remaining = tree.filter(p => {
    const still = findProcess(now, p.pid);
    return still && still.name === p.name;
  });
}
if (remaining.length) fail(`still alive after taskkill: ${remaining.map(p => `${p.name}(${p.pid})`).join(', ')}`);

run.stoppedAt = new Date().toISOString();
run.killed = tree.map(p => ({ pid: p.pid, name: p.name }));
try { writeJson(path.join(run.dataDir, 'harness.json'), run); } catch {}
try {
  if (fs.existsSync(LATEST_FILE) && JSON.parse(fs.readFileSync(LATEST_FILE, 'utf8')).pid === run.pid) writeJson(LATEST_FILE, run);
} catch {}

console.log(`stopped: ${tree.length} process(es) gone`);
console.log(`data dir kept at ${run.dataDir} (delete it yourself if you want it gone)`);

function recordPath() {
  return opts['data-dir'] ? path.join(opts['data-dir'], 'harness.json') : LATEST_FILE;
}

function fail(msg) {
  console.error(`stop: ${msg}`);
  process.exit(1);
}

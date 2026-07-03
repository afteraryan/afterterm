// Compacting-case probe. Confirms the second trigger of bug #1: does a `⚙`
// compacting title (PreCompact hook) behave like the ⚠ permission case —
// i.e. does it arrive as a distinct title, and does Claude's output RESUME
// afterward? The resume is the exact signal "Idea 1" (re-arm on resumed
// output) relies on to turn the spinner back on.
//
// Flow: ready → tiny turn 1 (build a little context) → on its ✅, send
// `/compact` → watch for ⚙ and whatever comes after it.
import { createRequire } from 'node:module';
import { writeFileSync, appendFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const pty = require('D:/Pitara/Work/Tinkering/afterterm/node_modules/node-pty');

const SESSION_DIR = 'C:/Users/Aryan/AppData/Local/Temp/claude/D--Pitara-Work-Tinkering-afterterm/1123ef3b-3885-4959-9763-70e7b89f0260/scratchpad/harness-sessions';
const OUT = `${SESSION_DIR}/compact-trace.jsonl`;
const READY_WAIT_MS = 4000;
const HARD_CAP_MS = 120000;

const env = { ...process.env };
if (env.PATH) env.PATH = env.PATH.replace(/"/g, '');
env.AFTERTERM = '1';
env.AFTERTERM_TAB_ID = 'harness-tab';
env.AFTERTERM_SESSION_DIR = SESSION_DIR;

const t0 = Date.now();
const ts = () => Date.now() - t0;
function titleOf(s) { const m = s.match(/\x1b\]0;([^\x07\x1b]*)(?:\x07|\x1b\\)/); return m ? m[1] : null; }
function notifOf(title) {
  if (title == null) return null;
  if (title.startsWith('▶')) return 'working';
  if (title.startsWith('✅')) return 'done';
  if (title.startsWith('⚠')) return 'attention';
  if (title.startsWith('⏳')) return 'background';
  if (title.startsWith('⚙')) return 'compacting';
  return null;
}

writeFileSync(OUT, '');
let lastAt = t0;
let phase = 'startup';   // startup → turn1 → compacting → observe
let compactAt = null;
let outputAfterCompact = 0;   // count of chunks after ⚙, and their gaps
let firstResumeGap = null;

console.log('[compact] spawning claude…');
const shell = pty.spawn('C:/Users/Aryan/.local/bin/claude.exe', [], {
  name: 'xterm-256color', cols: 120, rows: 30,
  cwd: 'D:/Pitara/Work/Tinkering/afterterm', env,
});

function finish(reason) {
  console.log(`\n[compact] finishing: ${reason}`);
  if (compactAt != null) {
    console.log(`[compact] ⚙ compacting title FIRED @${compactAt}ms  <-- confirms it replaces working like ⚠ does`);
    console.log(`[compact] chunks of output AFTER ⚙: ${outputAfterCompact}`);
    console.log(`[compact] first output gap after ⚙: ${firstResumeGap}ms  <-- Idea 1 would re-arm here`);
    console.log(`[compact] => output ${outputAfterCompact > 0 ? 'RESUMED after compacting (Idea 1 can detect it)' : 'did NOT resume'}`);
  } else {
    console.log('[compact] ⚙ compacting title NEVER fired — /compact may not have triggered PreCompact in this run');
  }
  console.log(`[compact] full trace: ${OUT}`);
  try { shell.kill(); } catch {}
  setTimeout(() => process.exit(0), 400);
}

shell.onData((data) => {
  const now = Date.now(); const gap = now - lastAt; lastAt = now; const at = now - t0;
  const title = titleOf(data); const notif = notifOf(title);
  appendFileSync(OUT, JSON.stringify({ at, gap, len: data.length, title, notif, phase }) + '\n');
  if (notif) console.log(`[${String(at).padStart(6)}ms] +${String(gap).padStart(6)}ms  TITLE=${JSON.stringify(title)}  notif=${notif}  phase=${phase}`);

  // Turn 1 finished → fire /compact
  if (phase === 'turn1' && notif === 'done') {
    phase = 'compacting';
    console.log('[compact] turn 1 done — sending /compact');
    setTimeout(() => { shell.write('/compact'); setTimeout(() => shell.write('\r'), 250); }, 500);
    return;
  }
  if (notif === 'compacting' && compactAt == null) {
    compactAt = at;
    phase = 'observe';
    console.log(`[compact] >>> ⚙ COMPACTING fired @${at}ms — now watching whether output resumes…`);
    return;
  }
  // After ⚙: count resumed output (ignoring the ⚙ title chunk itself)
  if (compactAt != null && at > compactAt) {
    outputAfterCompact++;
    if (firstResumeGap == null) firstResumeGap = gap;
    // Once we see a fresh ✅ (compaction done, back to idle) plus a moment, wrap up.
    if (notif === 'done') { setTimeout(() => finish('post-compact ✅ seen'), 3000); }
  }
});

shell.onExit(({ exitCode }) => console.log(`[compact] claude exited code=${exitCode}`));

setTimeout(() => {
  phase = 'turn1';
  console.log('[compact] submitting tiny turn-1 prompt');
  shell.write('Reply with only the single word: ready');
  setTimeout(() => shell.write('\r'), 250);
}, READY_WAIT_MS);

setTimeout(() => finish('HARD CAP reached'), HARD_CAP_MS);

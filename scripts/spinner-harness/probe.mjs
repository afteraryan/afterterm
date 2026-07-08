// Stage A probe: spawn interactive `claude` through a PTY and log the raw
// startup byte-stream with timestamps — WITHOUT sending any prompt. Goal is to
// learn the startup sequence (folder-trust prompt? a "ready" marker?) so the
// real capture harness can drive claude correctly. Kills claude after a fixed
// window. No turn runs, so ~zero token cost.
//
// node-pty is required from the MAIN checkout (worktrees don't copy node_modules).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pty = require('D:/Pitara/Work/Tinkering/afterterm/node_modules/node-pty');

const SESSION_DIR = 'C:/Users/Aryan/AppData/Local/Temp/claude/D--Pitara-Work-Tinkering-afterterm/1123ef3b-3885-4959-9763-70e7b89f0260/scratchpad/harness-sessions';
const WATCH_MS = 9000;

// Mirror afterterm's spawn env. cwd = main repo root (a dir claude has already
// been trusted in) to dodge the first-run folder-trust prompt.
const env = { ...process.env };
if (env.PATH) env.PATH = env.PATH.replace(/"/g, ''); // afterterm strips PATH quotes
env.AFTERTERM = '1';
env.AFTERTERM_TAB_ID = 'harness-tab';
env.AFTERTERM_SESSION_DIR = SESSION_DIR;

const t0 = Date.now();
const ts = () => String(Date.now() - t0).padStart(6, ' ');

// Extract an OSC-0 title if one is present in a chunk: ESC ]0; <title> (BEL | ESC \)
function titleOf(s) {
  const m = s.match(/\x1b\]0;([^\x07\x1b]*)(?:\x07|\x1b\\)/);
  return m ? m[1] : null;
}
// Compact, printable preview of a chunk (control chars shown as ·).
function preview(s) {
  return s.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '·').replace(/\x1b/g, '⎋').slice(0, 80);
}

console.log(`[probe] spawning claude via PTY, watching for ${WATCH_MS}ms, sending nothing…`);
const shell = pty.spawn('C:/Users/Aryan/.local/bin/claude.exe', [], {
  name: 'xterm-256color',
  cols: 120,
  rows: 30,
  cwd: 'D:/Pitara/Work/Tinkering/afterterm',
  env,
});

let lastChunkAt = t0;
let chunkCount = 0;
shell.onData((data) => {
  const now = Date.now();
  const gap = now - lastChunkAt;
  lastChunkAt = now;
  chunkCount++;
  const title = titleOf(data);
  const titleTag = title !== null ? `  <<TITLE: ${JSON.stringify(title)}>>` : '';
  console.log(`[${ts()}ms] +${String(gap).padStart(5)}ms  ${String(data.length).padStart(5)}B  ${preview(data)}${titleTag}`);
});

shell.onExit(({ exitCode }) => {
  console.log(`[probe] claude exited early, code=${exitCode}`);
});

setTimeout(() => {
  console.log(`[probe] window elapsed — ${chunkCount} chunks seen. killing claude.`);
  try { shell.kill(); } catch {}
  setTimeout(() => process.exit(0), 500);
}, WATCH_MS);

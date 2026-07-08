// Stage B capture: spawn interactive `claude` through a PTY, wait for ready,
// submit ONE think-heavy, tool-free prompt, and log every PTY chunk's timestamp
// + inter-chunk gap. The turn is bracketed by the same hook titles afterterm
// reads: "▶ … working" (UserPromptSubmit) starts it, "✅/⏳ … done" (Stop) ends it.
//
// This directly answers: during a heavy THINK (no tool calls, no visible
// streaming forced), does claude emit periodic bytes, or does the PTY go
// silent long enough to fool a quiet-window spinner heuristic?
//
// Full chunk log is written to a JSONL file for offline replay through the
// (future) pure clear-decision module.
import { createRequire } from 'node:module';
import { writeFileSync, appendFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const pty = require('D:/Pitara/Work/Tinkering/afterterm/node_modules/node-pty');

const SESSION_DIR = 'C:/Users/Aryan/AppData/Local/Temp/claude/D--Pitara-Work-Tinkering-afterterm/1123ef3b-3885-4959-9763-70e7b89f0260/scratchpad/harness-sessions';

const READY_WAIT_MS = 4000;   // let claude finish startup before submitting
const POST_DONE_MS  = 5000;   // keep logging after ✅ to see idle silence
const HARD_CAP_MS   = 210000; // absolute safety kill

// Scenario library. Pass the name as argv[2] (default: think).
//  think — pure reasoning, no tools (worst case for a silence heuristic).
//  tools — several sequential tool calls with real execution latency (gap #1).
//  mixed — an interim text reply THEN continued tool work in one turn: the exact
//          "reply, then keep working" shape behind bug #1 (Stop firing too early).
const SCENARIOS = {
  think:
    'Without using any tools whatsoever, ultrathink and reason step by step about ' +
    'this classic puzzle, then give the full answer: You have 12 identical-looking ' +
    'coins. Exactly one is counterfeit and differs in weight (you do NOT know if it ' +
    'is heavier or lighter). Using only a balance scale exactly 3 times, describe a ' +
    'complete strategy that always identifies the fake coin AND whether it is heavy ' +
    'or light. Lay out the entire decision tree for all three weighings.',
  tools:
    'Using your Bash and Read tools, do these as SEPARATE sequential steps, ' +
    'narrating briefly between each: (1) run `git log --oneline -10`, (2) read ' +
    'package.json, (3) run `git status`, (4) list the src directory with `ls src`, ' +
    '(5) read the first 40 lines of CLAUDE.md. Do not batch them — one tool call at ' +
    'a time — then give a one-paragraph summary of what you found.',
  mixed:
    'First, in ONE sentence, tell me what this repository is. Then WITHOUT stopping, ' +
    'investigate using your tools one step at a time, thinking between steps: read ' +
    'package.json, then run `git log --oneline -5`, then read the first 50 lines of ' +
    'src/main.ts, then run `ls src/renderer/components`. After all that, give me a ' +
    'short summary of the architecture. Take your time.',
  // Forces a mid-turn permission prompt (a Write to a non-allowlisted path). The
  // harness auto-REJECTS it (sends Esc) so nothing is actually written — we only
  // need to observe whether ⚠ (attention) fires BETWEEN ▶ and ✅, i.e. mid-turn.
  perm:
    'Using your Write tool, create a brand new file at ' +
    'C:/Users/Aryan/AppData/Local/Temp/claude/D--Pitara-Work-Tinkering-afterterm/1123ef3b-3885-4959-9763-70e7b89f0260/scratchpad/harness-sessions/harness-perm-test.txt ' +
    'whose entire contents are the single word: hello',
};
const SCENARIO = process.argv[2] && SCENARIOS[process.argv[2]] ? process.argv[2] : 'think';
const PROMPT = SCENARIOS[SCENARIO];
const OUT = `${SESSION_DIR}/capture-${SCENARIO}.jsonl`;
console.log(`[capture] scenario = ${SCENARIO}`);

const env = { ...process.env };
if (env.PATH) env.PATH = env.PATH.replace(/"/g, '');
env.AFTERTERM = '1';
env.AFTERTERM_TAB_ID = 'harness-tab';
env.AFTERTERM_SESSION_DIR = SESSION_DIR;

const t0 = Date.now();
const ts = () => Date.now() - t0;

function titleOf(s) {
  const m = s.match(/\x1b\]0;([^\x07\x1b]*)(?:\x07|\x1b\\)/);
  return m ? m[1] : null;
}
// afterterm's notification prefixes
function notifOf(title) {
  if (title == null) return null;
  if (title.startsWith('▶')) return 'working';     // ▶
  if (title.startsWith('✅')) return 'done';        // ✅
  if (title.startsWith('⚠')) return 'attention';   // ⚠
  if (title.startsWith('⏳')) return 'background';  // ⏳
  if (title.startsWith('⚙')) return 'compacting';  // ⚙
  return null;
}

writeFileSync(OUT, ''); // truncate
let lastAt = t0;
let workingAt = null, doneAt = null;
const gapsDuringTurn = [];   // {at, gap} for chunks while working, before done
const midTurnEvents = [];    // {at, notif, title} for any NON-working notif before done
let submitted = false;
let rejectSent = false;

console.log(`[capture] spawning claude; will submit after ${READY_WAIT_MS}ms…`);
const shell = pty.spawn('C:/Users/Aryan/.local/bin/claude.exe', [], {
  name: 'xterm-256color', cols: 120, rows: 30,
  cwd: 'D:/Pitara/Work/Tinkering/afterterm', env,
});

function finish(reason) {
  console.log(`\n[capture] finishing: ${reason}`);
  // Summary of gaps DURING the turn (▶ → ✅) — the number your objection hinges on.
  if (gapsDuringTurn.length) {
    const gaps = gapsDuringTurn.map(g => g.gap);
    const max = Math.max(...gaps);
    const over = (thr) => gaps.filter(g => g > thr).length;
    console.log(`[capture] === IN-TURN GAP SUMMARY (▶ working → ✅ done) ===`);
    console.log(`[capture] chunks during turn : ${gaps.length}`);
    console.log(`[capture] MAX inter-chunk gap : ${max}ms   <-- the decisive number`);
    console.log(`[capture] gaps >1000ms: ${over(1000)}   >2000ms: ${over(2000)}   >3000ms: ${over(3000)}   >4000ms: ${over(4000)}`);
    const top = [...gapsDuringTurn].sort((a,b)=>b.gap-a.gap).slice(0,8)
      .map(g => `${g.gap}ms@${g.at}ms`).join(', ');
    console.log(`[capture] largest in-turn gaps: ${top}`);
  } else {
    console.log(`[capture] no in-turn chunks recorded (turn bracketing may have failed — check trace)`);
  }
  if (workingAt != null && doneAt != null) {
    console.log(`[capture] turn wall-time: ${doneAt - workingAt}ms (▶ @${workingAt}ms → ✅ @${doneAt}ms)`);
  } else {
    console.log(`[capture] working@${workingAt} done@${doneAt} (one missing)`);
  }
  if (midTurnEvents.length) {
    console.log(`[capture] === MID-TURN SPINNER-KILLERS (cleared working before the real end) ===`);
    for (const e of midTurnEvents) console.log(`[capture]   ${e.notif} @${e.at}ms  title=${JSON.stringify(e.title)}`);
  } else {
    console.log(`[capture] no mid-turn spinner-killers (working survived intact to the end)`);
  }
  console.log(`[capture] full chunk trace: ${OUT}`);
  try { shell.kill(); } catch {}
  setTimeout(() => process.exit(0), 400);
}

shell.onData((data) => {
  const now = Date.now();
  const gap = now - lastAt;
  lastAt = now;
  const at = now - t0;
  const title = titleOf(data);
  const notif = notifOf(title);

  appendFileSync(OUT, JSON.stringify({ at, gap, len: data.length, title, notif }) + '\n');

  if (notif) console.log(`[${String(at).padStart(6)}ms] +${String(gap).padStart(5)}ms  TITLE=${JSON.stringify(title)}  notif=${notif}`);

  if (notif === 'working' && workingAt == null) { workingAt = at; console.log(`[capture] >>> turn START (▶) @${at}ms`); }
  // Record gaps only while inside the turn window.
  if (workingAt != null && doneAt == null) gapsDuringTurn.push({ at, gap });

  // Any NON-working, NON-terminal notif arriving mid-turn is a spinner-killer:
  // it replaces `working`, and only a new ▶ (UserPromptSubmit) can restore it.
  if (workingAt != null && doneAt == null && notif && notif !== 'working' && notif !== 'done' && notif !== 'background') {
    midTurnEvents.push({ at, notif, title });
    console.log(`[capture] !!! MID-TURN SPINNER-KILLER: ${notif} (${JSON.stringify(title)}) @${at}ms — this clears working with no way back`);
    // Auto-reject the permission prompt (Esc) so nothing is actually written; we
    // already have the evidence we needed (⚠ fired mid-turn).
    if (notif === 'attention' && !rejectSent) {
      rejectSent = true;
      setTimeout(() => { console.log('[capture] sending Esc to reject the prompt'); shell.write('\x1b'); }, 600);
    }
  }

  if ((notif === 'done' || notif === 'background') && workingAt != null && doneAt == null) {
    doneAt = at;
    console.log(`[capture] >>> turn END (${notif}) @${at}ms — logging ${POST_DONE_MS}ms of post-turn idle…`);
    setTimeout(() => finish('post-done window elapsed'), POST_DONE_MS);
  }
});

shell.onExit(({ exitCode }) => console.log(`[capture] claude exited code=${exitCode}`));

setTimeout(() => {
  if (submitted) return;
  submitted = true;
  console.log(`[capture] submitting prompt (${PROMPT.length} chars) + Enter`);
  shell.write(PROMPT);
  setTimeout(() => shell.write('\r'), 250); // small delay so the input box settles before Enter
}, READY_WAIT_MS);

setTimeout(() => finish('HARD CAP reached'), HARD_CAP_MS);

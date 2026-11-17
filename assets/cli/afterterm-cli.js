// The `afterterm` command inside afterterm's terminals (design-07, loops; AFT-126, chat).
//
// afterterm writes two small launchers into <userData>\bin (afterterm.cmd for cmd and
// PowerShell, `afterterm` for Git Bash) and puts that folder first on PATH, only in
// its own terminals. Each launcher runs this file with afterterm's own executable in
// Node mode (ELECTRON_RUN_AS_NODE=1, as VS Code's `code` command does), so no Node
// install is needed.
//
// This file only carries the request: its arguments, its folder, and the chat it
// runs in go to the running afterterm over the loops pipe, and the answer is
// printed. All the rules are in afterterm (src/loops-cli.ts, src/chat-start.ts).
// Plain JavaScript, no dependencies.
//
// `afterterm chat start` reads its prompt from stdin and sends it over the pipe. It
// never writes the prompt anywhere. It waits for Aryan's click and for the chat to
// get the prompt, so its wait is long.

'use strict';
const net = require('net');

const argv = process.argv.slice(2);
const pipe = process.env.AFTERTERM_LOOPS_PIPE;
const token = process.env.AFTERTERM_LOOPS_TOKEN;
const CHAT_WAIT_MS = 15 * 60 * 1000; // 10 minutes for the click, then Claude Code opening
const LOOPS_WAIT_MS = 10000;

function done(code, out, err) {
  if (out) process.stdout.write(out);
  if (err) process.stderr.write(err);
  // Let the writes reach the console before leaving.
  process.stdout.write('', () => process.exit(code));
}

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve(undefined);
    let text = '';
    // A stdin that is neither a terminal nor ever sends anything (a tool that leaves
    // it open) must not hold the command: with nothing in 3 seconds there is no prompt.
    const idle = setTimeout(() => { if (!text) { process.stdin.pause(); resolve(undefined); } }, 3000);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { text += c; if (text.length > 400000) { clearTimeout(idle); process.stdin.destroy(); resolve(text); } });
    process.stdin.on('end', () => { clearTimeout(idle); resolve(text); });
    process.stdin.on('error', () => { clearTimeout(idle); resolve(text || undefined); });
  });
}

function send(request, waitMs) {
  const sock = net.connect(pipe);
  let buf = '';
  let finished = false;
  const timer = setTimeout(() => {
    if (finished) return;
    finished = true;
    sock.destroy();
    done(1, '', 'afterterm did not answer in time\n');
  }, waitMs);
  sock.setEncoding('utf8');
  sock.on('connect', () => sock.write(JSON.stringify(request) + '\n'));
  sock.on('data', (c) => { buf += c; });
  sock.on('end', () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    let r;
    try { r = JSON.parse(buf.trim()); } catch (e) { return done(1, '', 'afterterm sent an answer this command could not read\n'); }
    done(typeof r.code === 'number' ? r.code : 1, r.out || '', r.err || '');
  });
  sock.on('error', (e) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    const gone = e && (e.code === 'ENOENT' || e.code === 'ECONNREFUSED');
    done(1, '', gone ? 'afterterm is not running\n' : `afterterm could not be reached: ${e && e.message}\n`);
  });
}

const env = {
  thread: process.env.AFTERTERM_TAB_ID || undefined,
  session: process.env.CLAUDE_CODE_SESSION_ID || undefined,
  cwd: process.cwd(),
};

if (argv[0] !== 'loops' && argv[0] !== 'chat') {
  const known = argv.length === 0 || argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h';
  const help = 'afterterm loops help    the pieces of work started in every project\n'
    + 'afterterm chat help     open a Claude Code chat in a project, after Aryan clicks Start\n';
  done(known ? 0 : 1, known ? help : '', known ? '' : 'afterterm: the commands here are "afterterm loops" and "afterterm chat". Try: afterterm help\n');
} else if (!pipe || !token) {
  done(1, '', 'afterterm is not running (or this terminal was not opened by afterterm)\n');
} else if (argv[0] === 'chat') {
  const wantsPrompt = argv[1] === 'start' && !argv.includes('--help') && !argv.some((a) => a === '--prompt' || a.startsWith('--prompt='));
  (wantsPrompt ? readStdin() : Promise.resolve(undefined)).then((stdin) => {
    send({ token, kind: 'chat', argv, env, stdin }, CHAT_WAIT_MS);
  });
} else {
  send({ token, kind: 'cli', argv, env }, LOOPS_WAIT_MS);
}

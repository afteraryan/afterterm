// The `afterterm` command inside afterterm's terminals (design-07, loops).
//
// afterterm writes two small launchers into <userData>\bin (afterterm.cmd for cmd and
// PowerShell, `afterterm` for Git Bash) and puts that folder first on PATH, only in
// its own terminals. Each launcher runs this file with afterterm's own executable in
// Node mode (ELECTRON_RUN_AS_NODE=1, as VS Code's `code` command does), so no Node
// install is needed.
//
// This file only carries the request: its arguments, its folder, and the chat it
// runs in go to the running afterterm over the loops pipe, and the answer is
// printed. All the rules are in afterterm (src/loops-cli.ts). Plain JavaScript, no
// dependencies.

'use strict';
const net = require('net');

const argv = process.argv.slice(2);
const pipe = process.env.AFTERTERM_LOOPS_PIPE;
const token = process.env.AFTERTERM_LOOPS_TOKEN;

function done(code, out, err) {
  if (out) process.stdout.write(out);
  if (err) process.stderr.write(err);
  // Let the writes reach the console before leaving.
  process.stdout.write('', () => process.exit(code));
}

if (argv[0] !== 'loops') {
  const known = argv.length === 0 || argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h';
  done(known ? 0 : 1, known ? 'afterterm loops help    the pieces of work started in every project\n' : '', known ? '' : 'afterterm: the only command here is "afterterm loops". Try: afterterm loops help\n');
} else if (!pipe || !token) {
  done(1, '', 'afterterm is not running (or this terminal was not opened by afterterm)\n');
} else {
  const env = {
    thread: process.env.AFTERTERM_TAB_ID || undefined,
    session: process.env.CLAUDE_CODE_SESSION_ID || undefined,
    cwd: process.cwd(),
  };
  const sock = net.connect(pipe);
  let buf = '';
  let finished = false;
  const timer = setTimeout(() => {
    if (finished) return;
    finished = true;
    sock.destroy();
    done(1, '', 'afterterm did not answer in time\n');
  }, 10000);
  sock.setEncoding('utf8');
  sock.on('connect', () => sock.write(JSON.stringify({ token, kind: 'cli', argv, env }) + '\n'));
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

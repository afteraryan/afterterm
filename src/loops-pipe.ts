// The loops pipe (design-07): how `afterterm loops` and the chat-start hook reach
// the loops store in main. A local named pipe, one JSON line in, one JSON line
// out, then the connection closes.
//
//   in:  { token, kind: 'cli', argv: string[], env: { thread?, session?, cwd } }
//        { token, kind: 'brief', env: { thread?, session?, cwd } }
//   out: { code, out, err }
//
// The pipe's name and a per-launch token reach only afterterm's own terminals,
// through their environment (AFTERTERM_LOOPS_PIPE, AFTERTERM_LOOPS_TOKEN). A
// request without the token is refused, so another program on the machine cannot
// change loops by finding the pipe. Each data folder gets its own pipe, so a
// harness run and the test build never talk to the real app.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { chatStartBrief, runLoopsCommand, type CallerEnv, type CliReply, type LoopsBackend, type LoopsContext } from './loops-cli.ts';

const MAX_REQUEST_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 5000;

export function loopsPipeName(userDataDir: string): string {
  const h = crypto.createHash('sha1').update(userDataDir.toLowerCase()).digest('hex').slice(0, 12);
  return `\\\\.\\pipe\\afterterm-loops-${h}`;
}

export function newToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

export interface LoopsPipeOpts {
  pipeName: string;
  token: string;
  backend: LoopsBackend;
  context: () => LoopsContext;
  log?: (line: string) => void;
}

function asEnv(v: unknown): CallerEnv {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const s = (k: string) => (typeof o[k] === 'string' && o[k] ? (o[k] as string).slice(0, 1000) : undefined);
  return { thread: s('thread'), session: s('session'), cwd: s('cwd') ?? '' };
}

// One request, already parsed, to its reply. Exported for the tests.
export function handleRequest(opts: Pick<LoopsPipeOpts, 'token' | 'backend' | 'context'>, req: unknown, now = Date.now()): CliReply {
  if (!req || typeof req !== 'object') return { code: 2, out: '', err: 'bad request\n' };
  const r = req as Record<string, unknown>;
  const given = typeof r.token === 'string' ? r.token : '';
  const a = Buffer.from(given);
  const b = Buffer.from(opts.token);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { code: 5, out: '', err: 'afterterm refused this request: run afterterm loops from a terminal inside afterterm\n' };
  }
  const env = asEnv(r.env);
  if (r.kind === 'brief') {
    return { code: 0, out: chatStartBrief(opts.backend.list(), opts.context(), env, now) + '\n', err: '' };
  }
  if (r.kind === 'cli') {
    const argv = Array.isArray(r.argv) ? r.argv.filter((x): x is string => typeof x === 'string').slice(0, 64) : [];
    return runLoopsCommand(opts.backend, opts.context(), env, argv, now);
  }
  return { code: 2, out: '', err: 'bad request\n' };
}

export function startLoopsPipe(opts: LoopsPipeOpts): net.Server {
  const log = opts.log ?? (() => {});
  const server = net.createServer((sock) => {
    let buf = '';
    let answered = false;
    const reply = (r: CliReply) => {
      if (answered) return;
      answered = true;
      try { sock.end(JSON.stringify(r) + '\n'); } catch { /* the client went */ }
    };
    sock.setEncoding('utf8');
    sock.setTimeout(REQUEST_TIMEOUT_MS, () => { reply({ code: 2, out: '', err: 'timed out\n' }); sock.destroy(); });
    sock.on('error', () => { /* a client that hung up is not our error */ });
    sock.on('data', (chunk: string) => {
      buf += chunk;
      if (buf.length > MAX_REQUEST_BYTES) { reply({ code: 2, out: '', err: 'request too large\n' }); sock.destroy(); return; }
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      let req: unknown;
      try { req = JSON.parse(buf.slice(0, nl)); } catch { reply({ code: 2, out: '', err: 'bad request\n' }); return; }
      try {
        const r = handleRequest(opts, req);
        const kind = (req as { kind?: string }).kind;
        const argv = (req as { argv?: unknown[] }).argv;
        log(`[loops] ${kind}${Array.isArray(argv) ? ' ' + String(argv[0] ?? '') + ' ' + String(argv[1] ?? '') : ''} -> ${r.code}`);
        reply(r);
      } catch (e) {
        log(`[loops] request failed: ${(e as Error).message}`);
        reply({ code: 1, out: '', err: `afterterm could not do that: ${(e as Error).message}\n` });
      }
    });
  });
  server.on('error', (e) => log(`[loops] pipe error: ${(e as Error).message}`));
  server.listen(opts.pipeName, () => log(`[loops] listening on ${opts.pipeName}`));
  return server;
}

// ---------- the launchers ----------

// The two launchers written to <userData>\bin: afterterm.cmd (cmd, PowerShell) and
// a POSIX `afterterm` (Git Bash). Both run the client script with afterterm's own
// executable in Node mode. Paths use forward slashes, which both Windows and
// Git Bash accept.
export function launcherTexts(execPath: string, scriptPath: string): { cmd: string; sh: string } {
  const fwd = (p: string) => p.replace(/\\/g, '/');
  const cmd = [
    '@echo off',
    'rem afterterm loops: written by afterterm at every launch (src/loops-pipe.ts)',
    'setlocal',
    'set ELECTRON_RUN_AS_NODE=1',
    `"${execPath}" "${scriptPath}" %*`,
    'exit /b %ERRORLEVEL%',
    '',
  ].join('\r\n');
  const sh = [
    '#!/bin/sh',
    '# afterterm loops: written by afterterm at every launch (src/loops-pipe.ts)',
    `ELECTRON_RUN_AS_NODE=1 exec "${fwd(execPath)}" "${fwd(scriptPath)}" "$@"`,
    '',
  ].join('\n');
  return { cmd, sh };
}

// Writes the launchers when they differ from what is there (a new install folder
// after an update, a dev build). Never throws: without them the command is
// missing, and the app works.
export function writeLaunchers(binDir: string, execPath: string, scriptPath: string, log: (l: string) => void = () => {}): boolean {
  try {
    fs.mkdirSync(binDir, { recursive: true });
    const { cmd, sh } = launcherTexts(execPath, scriptPath);
    for (const [name, text] of [['afterterm.cmd', cmd], ['afterterm', sh]] as const) {
      const file = path.join(binDir, name);
      let old: string | null = null;
      try { old = fs.readFileSync(file, 'utf8'); } catch { /* not there yet */ }
      if (old !== text) fs.writeFileSync(file, text, 'utf8');
    }
    return true;
  } catch (e) {
    log(`[loops] could not write the afterterm command: ${(e as Error).message}`);
    return false;
  }
}

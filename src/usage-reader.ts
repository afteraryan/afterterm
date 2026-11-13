// Reads Claude plan usage by running /usage in a hidden Claude Code (AFT-85).
//
// Claude Code has no documented way to ask for plan usage, and the login token must not be
// used by another program, so afterterm does what a person would: it starts Claude Code in a
// pseudo-terminal nobody sees, types /usage, reads the screen (usage-screen.ts turns the rows
// into numbers) and closes it again. Tested on 2026-11-12: the limits show about 4 seconds
// after launch, the breakdown a few seconds later. No model is called, so it costs no usage.
//
// Rules this module keeps:
//  - On demand only. Nothing starts until read() is called (the usage card opening).
//  - One run at a time. A call while one is running joins it. Otherwise every call reads again,
//    so opening the card or pressing refresh never shows numbers from an earlier read (Aryan,
//    2026-11-13); the old numbers are cleared the moment a read starts.
//  - The hidden Claude Code runs in its own folder (<userData>\usage-reader), never in a
//    project, and without the AFTERTERM marker, so afterterm's notification hook ignores it.
//    The first run answers Claude Code's one-time "do you trust this folder" question for that
//    folder only.
//  - It is always closed: the whole process tree is killed when the numbers are in, on a
//    timeout, on an error and when the app quits (stop()).
//  - Nothing is typed except the trust answer and "/usage". Every key is sent only after the
//    screen has been read and shows what it is meant for.

import * as pty from 'node-pty';
import * as xtermHeadless from '@xterm/headless';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseUsageScreen, readerStep, type ParsedUsage, type ReaderStage, type UsageError, type UsageState } from './usage-screen.ts';

export type { UsageError, UsageState, UsageStatus } from './usage-screen.ts';

// @xterm/headless is a UMD package: the app's bundle sees `Terminal` as a named export, plain Node
// (the scratch scripts that run this file directly) sees it only on `default`.
const headlessNs: Record<string, any> = xtermHeadless as any;
const Terminal: typeof import('@xterm/headless').Terminal = headlessNs.Terminal ?? headlessNs['default'].Terminal;

const COLS = 110;
const ROWS = 80;
const TICK_MS = 250;
const RUN_TIMEOUT_MS = 45_000;
/** With the limits on screen but no breakdown, give the scan this long before settling. */
const BREAKDOWN_GRACE_MS = 25_000;

/** Environment for the hidden Claude Code: the user's own, minus anything that says "inside afterterm or another Claude". */
export function cleanEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) continue;
    if (k === 'AFTERTERM' || k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_')) continue;
    out[k] = v;
  }
  return out;
}

/** claude.exe on PATH, else where Claude Code installs itself. Null when neither exists. */
export function findClaude(env: NodeJS.ProcessEnv = process.env): string | null {
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).map((d) => d.replace(/"/g, '')).filter(Boolean);
  dirs.push(path.join(os.homedir(), '.local', 'bin'));
  for (const d of dirs) {
    const exe = path.join(d, 'claude.exe');
    try { if (fs.statSync(exe).isFile()) return exe; } catch { /* next */ }
  }
  return null;
}

function killTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }, () => resolve());
  });
}

type Run = { cancel: () => void };

/**
 * One hidden run. Calls onUpdate with every new parse and onDone once (with an error name or null).
 * Never throws.
 */
function startRun(
  claudePath: string,
  cwd: string,
  onUpdate: (u: ParsedUsage) => void,
  onDone: (err: UsageError | null) => void,
): Run {
  let finished = false;
  let proc: pty.IPty | null = null;
  const term = new Terminal({ cols: COLS, rows: ROWS, allowProposedApi: true, scrollback: 0 });
  const startedAt = Date.now();
  let timer: NodeJS.Timeout | null = null;
  let stage: ReaderStage = 'start';
  let typedAt = 0;
  let limitsAt = 0;
  let last = '';
  let seen = '';

  const rows = (): string[] => {
    const buf = term.buffer.active;
    const out: string[] = [];
    for (let i = 0; i < ROWS; i++) out.push(buf.getLine(i)?.translateToString(true) ?? '');
    return out;
  };
  const finish = (err: UsageError | null) => {
    if (finished) return;
    finished = true;
    if (timer) clearInterval(timer);
    const p = proc;
    proc = null;
    try { term.dispose(); } catch { /* already gone */ }
    if (p) { try { p.write('\x1b'); } catch { /* gone */ } void killTree(p.pid); }
    onDone(err);
  };

  try {
    fs.mkdirSync(cwd, { recursive: true });
    proc = pty.spawn(claudePath, [], { name: 'xterm-256color', cols: COLS, rows: ROWS, cwd, env: cleanEnv(process.env) });
  } catch {
    finish('not-installed');
    return { cancel: () => {} };
  }
  proc.onData((d) => { if (!finished) term.write(d); });
  proc.onExit(() => { if (!finished) finish('exited'); });

  timer = setInterval(() => {
    if (finished || !proc) return;
    const now = Date.now();
    const screen = rows();
    const text = screen.join('\n');
    if (now - startedAt > RUN_TIMEOUT_MS) {
      // A harness run logs what the hidden screen showed, so a timeout can be diagnosed.
      if (process.env.AFTERTERM_HARNESS === '1') {
        console.log(`[usage] timeout in stage "${stage}"; screen:\n` + screen.filter((r) => r.trim()).join('\n'));
      }
      finish('timeout');
      return;
    }

    if (stage !== 'running') {
      // What to type next is decided from the screen alone (usage-screen.ts, readerStep).
      const step = readerStep(stage, text);
      if (step.send !== null) proc.write(step.send);
      if (step.stage === 'typed' && stage !== 'typed') typedAt = now;
      stage = step.stage;
      if (stage === 'typed' && now - typedAt > 8000) finish('unreadable');
      return;
    }

    const parsed = parseUsageScreen(screen);
    const key = JSON.stringify(parsed);
    if (parsed.limits.length > 0) {
      if (!limitsAt) limitsAt = now;
      // Claude Code draws the screen in pieces (a row at a time), so a parse is shown only once the
      // next tick reads the same thing. The card then never shows two limits and a third a moment later.
      const settled = key === seen;
      seen = key;
      if (settled && key !== last) { last = key; onUpdate(parsed); }
      if (settled && !parsed.scanning && parsed.breakdown) { finish(null); return; }
      if (now - limitsAt > BREAKDOWN_GRACE_MS) finish(null);
    }
  }, TICK_MS);

  return { cancel: () => finish(null) };
}

export type UsageReader = {
  /** Start a read, join the one running, or answer from the cache. Returns the state right now. */
  read(): UsageState;
  state(): UsageState;
  /** Close any hidden Claude Code (the app is quitting). */
  stop(): void;
};

export function createUsageReader(opts: {
  /** The folder the hidden Claude Code runs in. */
  cwd: string;
  /** Called with the whole state whenever it changes. */
  onChange: (s: UsageState) => void;
  now?: () => number;
  findClaudePath?: () => string | null;
}): UsageReader {
  const now = opts.now ?? Date.now;
  const find = opts.findClaudePath ?? findClaude;
  let state: UsageState = { status: 'idle', usage: null, updated: null, error: null };
  let run: Run | null = null;

  const set = (patch: Partial<UsageState>) => { state = { ...state, ...patch }; opts.onChange(state); };

  return {
    state: () => state,
    read() {
      if (run) return state;
      const claude = find();
      if (!claude) { set({ status: 'error', error: 'not-installed' }); return state; }
      // Every read starts from nothing, a refresh included: the card shows its skeleton until the new
      // numbers arrive (Aryan, 2026-11-13), so old numbers are never shown as if they were fresh.
      set({ status: 'loading', error: null, usage: null });
      // A start that fails reports itself from inside startRun, before it has returned. Keeping the
      // handle after that would leave `run` set for a run that is already over, and every later read
      // would join it and do nothing (AFT-88). So the handle is kept only if the run is still going.
      let over = false;
      const handle = startRun(
        claude,
        opts.cwd,
        (u) => set({ usage: u }),
        (err) => {
          over = true;
          run = null;
          if (err && !(state.usage && state.usage.limits.length > 0)) set({ status: 'error', error: err });
          else set({ status: 'ready', error: null, updated: now() });
        },
      );
      if (!over) run = handle;
      return state;
    },
    stop() { run?.cancel(); run = null; },
  };
}

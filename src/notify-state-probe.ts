// Asks Windows whether a full-screen app or a presentation is in front
// (SHQueryUserNotificationState in shell32), for the toast hold (AFT-72,
// notify-hold.ts). afterterm has no native module, so the call is made by a
// Windows PowerShell helper that main starts when a toast is about to show and
// keeps while the overlay has toasts: it reads a line on stdin and answers one
// line, "quns=<n>", "hr=<n>" or "error".
//
// Why a helper that stays, not one PowerShell per question (measured on
// 2026-11-09 on Aryan's machine): a fresh powershell.exe that makes the call
// takes about 500 ms and 530 ms of CPU, every time. Asked every 3 seconds for as
// long as a game runs, that is a sixth of a core for hours. The helper pays the
// start once (about 470 ms to the first answer) and answers every later question
// in under 2 ms. It goes 15 seconds after the last question, so it runs only
// while toasts are up or waiting.
//
// The P/Invoke is built with Reflection.Emit, not Add-Type: Add-Type compiles C#
// through csc.exe in Windows PowerShell 5.1 (a temp file and about 150 ms more),
// and Emit needs neither. Windows PowerShell 5.1 by its full path, never pwsh: it
// is on every Windows, and PATH cannot swap it.
//
// Every failure answers 'unknown', which shows the toasts: a helper that cannot
// start, that times out, that exits, or a machine where PowerShell is blocked.
// After three failures in a row the probe stops trying for the rest of the run.

import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import path from 'path';
import { parseProbeLine } from './notify-hold.ts';
import type { NotifyState } from './notify-hold.ts';

// The helper's script. Single quotes only, and sent as -EncodedCommand, so
// nothing in it is unpicked by a command line. Its only output is the answers;
// PowerShell's own noise goes to stderr, which is ignored.
const HELPER_SCRIPT = `
$ErrorActionPreference = 'Stop'
$m = $null
try {
  $asm = [System.Reflection.Emit.AssemblyBuilder]::DefineDynamicAssembly((New-Object System.Reflection.AssemblyName 'AftertermQuns'), 'Run')
  $tb = $asm.DefineDynamicModule('AftertermQuns').DefineType('Quns', 'Public, Class')
  $pm = $tb.DefinePInvokeMethod('SHQueryUserNotificationState', 'shell32.dll', 'Public, Static, PinvokeImpl', 'Standard', [int], [Type[]]@([int].MakeByRefType()), 'Winapi', 'Auto')
  $pm.SetImplementationFlags('PreserveSig')
  $m = $tb.CreateType().GetMethod('SHQueryUserNotificationState')
} catch { }
while ($null -ne ($line = [Console]::In.ReadLine())) {
  if ($null -eq $m) { [Console]::Out.WriteLine('error'); [Console]::Out.Flush(); continue }
  try {
    $a = [object[]]@(0)
    $hr = $m.Invoke($null, $a)
    if ($hr -eq 0) { [Console]::Out.WriteLine('quns=' + $a[0]) } else { [Console]::Out.WriteLine('hr=' + $hr) }
  } catch { [Console]::Out.WriteLine('error') }
  [Console]::Out.Flush()
}
`;

// The first answer includes PowerShell's start (about 0.5 s here, more on a slow
// or busy machine); a toast waits for it, so it is bounded.
const START_TIMEOUT_MS = 4000;
// Later answers take under 2 ms; this only catches a helper that has hung.
const ANSWER_TIMEOUT_MS = 1500;
// How long the helper stays after the last question. Longer than the 3 second
// poll, so it lives exactly while the overlay has toasts.
const IDLE_EXIT_MS = 15_000;
const MAX_FAILURES = 3;

export interface ProbeAnswer {
  state: NotifyState;
  // How long the question took, in ms.
  ms: number;
  // Whether this question started a new helper.
  started: boolean;
}

export interface NotifyStateProbeOptions {
  // Warnings (a failure, giving up). Defaults to console.warn.
  warn?: (message: string) => void;
}

export function windowsPowerShellPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env.SystemRoot || env.windir || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

export class NotifyStateProbe {
  private child: ChildProcess | null = null;
  private answered = false;           // the running helper has answered at least once
  private buffer = '';
  // Questions waiting for their line, oldest first; the helper answers in order.
  private waiting: Array<(line: string | null) => void> = [];
  private idleTimer: NodeJS.Timeout | null = null;
  private failures = 0;
  private gaveUp = false;
  private disposed = false;
  private warn: (message: string) => void;

  constructor(options: NotifyStateProbeOptions = {}) {
    this.warn = options.warn ?? ((m) => console.warn(m));
  }

  // The helper's pid, or null when none is running (for the harness).
  get pid(): number | null {
    return this.child?.pid ?? null;
  }

  query(): Promise<ProbeAnswer> {
    const startedAt = Date.now();
    if (this.gaveUp || this.disposed) {
      return Promise.resolve({ state: 'unknown', ms: 0, started: false });
    }
    let started = false;
    if (!this.child) {
      if (!this.start()) return Promise.resolve(this.fail('could not start', startedAt, true));
      started = true;
    }
    const child = this.child as ChildProcess;
    this.clearIdle();
    return new Promise<ProbeAnswer>((resolve) => {
      let settled = false;
      const timeout = this.answered ? ANSWER_TIMEOUT_MS : START_TIMEOUT_MS;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        // A helper that does not answer in time is stuck or far too slow: stop it,
        // and the next question starts a new one.
        this.stop();
        resolve(this.fail(`no answer in ${timeout} ms`, startedAt, started));
      }, timeout);
      this.waiting.push((line) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (line === null) {
          resolve(this.fail('the helper exited', startedAt, started));
          return;
        }
        this.answered = true;
        this.failures = 0;
        this.armIdle();
        resolve({ state: parseProbeLine(line), ms: Date.now() - startedAt, started });
      });
      try {
        child.stdin?.write('q\n');
      } catch {
        // The exit handler answers every waiting question with null.
      }
    });
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
  }

  private start(): boolean {
    let child: ChildProcess;
    try {
      const encoded = Buffer.from(HELPER_SCRIPT, 'utf16le').toString('base64');
      child = spawn(
        windowsPowerShellPath(),
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] },
      );
    } catch {
      return false;
    }
    this.child = child;
    this.answered = false;
    this.buffer = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      if (this.child !== child) return;
      this.buffer += chunk;
      let i: number;
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, i);
        this.buffer = this.buffer.slice(i + 1);
        this.waiting.shift()?.(line);
      }
    });
    // A write to a helper that has gone raises EPIPE on the stream, not the call.
    child.stdin?.on('error', () => { /* the exit handler answers */ });
    const gone = () => {
      if (this.child !== child) return;
      this.child = null;
      this.clearIdle();
      const pending = this.waiting;
      this.waiting = [];
      for (const answer of pending) answer(null);
    };
    child.on('error', gone);
    child.on('exit', gone);
    return true;
  }

  // Ends the running helper: stdin closed (it leaves its loop and exits), and
  // killed as well, in case it is the one that hung.
  private stop(): void {
    this.clearIdle();
    const child = this.child;
    if (!child) return;
    this.child = null;
    const pending = this.waiting;
    this.waiting = [];
    for (const answer of pending) answer(null);
    try { child.stdin?.end(); } catch { /* already closed */ }
    try { child.kill(); } catch { /* already gone */ }
  }

  private fail(reason: string, startedAt: number, started: boolean): ProbeAnswer {
    this.failures += 1;
    if (this.failures >= MAX_FAILURES && !this.gaveUp) {
      this.gaveUp = true;
      this.stop();
      this.warn(`[notify-hold] Windows' full-screen check failed ${MAX_FAILURES} times in a row (last: ${reason}); toasts show without it for the rest of this run`);
    } else {
      this.warn(`[notify-hold] Windows' full-screen check failed (${reason}); the toast shows`);
    }
    return { state: 'unknown', ms: Date.now() - startedAt, started };
  }

  private armIdle(): void {
    this.clearIdle();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.waiting.length === 0) this.stop();
    }, IDLE_EXIT_MS);
  }

  private clearIdle(): void {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
  }
}

// Asks Windows whether a full-screen app or a presentation is in front, for the
// toast hold (AFT-72, notify-hold.ts), two ways at once:
// SHQueryUserNotificationState (shell32), Windows' own answer, which looks at
// the primary display only; and whether the foreground window covers the whole
// monitor it is on, which works on any monitor (added on 2026-11-09 after the
// real check: a borderless full-screen window on the second monitor read as
// "accepts"). afterterm has no native module, so the calls are made by a Windows
// PowerShell helper that main starts when a toast is about to show and keeps
// while the overlay has toasts: it reads a line on stdin and answers one line,
// "quns=<n|err> fg=<1|0|err>", or "error" when it could not set itself up.
// parseProbeLine (notify-hold.ts) turns that into a state; either signal holds.
//
// Why a helper that stays, not one PowerShell per question (measured on
// 2026-11-09 on Aryan's machine): a fresh powershell.exe that makes the call
// takes about 500 ms and 530 ms of CPU, every time. Asked every 3 seconds for as
// long as a game runs, that is a sixth of a core for hours. The helper pays the
// start once (about 470 ms to the first answer) and answers every later question
// in under 2 ms. It goes 15 seconds after the last question, so it runs only
// while toasts are up or waiting.
//
// The P/Invokes are built with Reflection.Emit, not Add-Type: Add-Type compiles C#
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

// The helper's script, for afterterm's own process id (its windows never count
// as a full-screen app). Single quotes only, and sent as -EncodedCommand, so
// nothing in it is unpicked by a command line. Its only output is the answers;
// PowerShell's own noise goes to stderr, which is ignored.
//
// fg is 1 when the foreground window covers the whole monitor it is on: its
// visible bounds (DWM's extended frame bounds, or the window rectangle when DWM
// has none) contain the monitor's rectangle (MonitorFromWindow, GetMonitorInfo),
// all in physical pixels (per-monitor DPI awareness on the helper's thread). Not
// counted: no foreground window, afterterm's own windows, the desktop and the
// taskbars (Progman, WorkerW, Shell_TrayWnd, Shell_SecondaryTrayWnd), and an
// ordinary maximized window with a title bar, which covers a monitor that has no
// taskbar (a second monitor without one, or an auto-hidden taskbar) without being
// full screen. A full-screen app, a browser's full screen and a slide show have
// no title bar, and a borderless game is not maximized.
function helperScript(ownPid: number): string {
  return `
$ErrorActionPreference = 'Stop'
$own = ${ownPid}
$t = $null
try {
  $asm = [System.Reflection.Emit.AssemblyBuilder]::DefineDynamicAssembly((New-Object System.Reflection.AssemblyName 'AftertermQuns'), 'Run')
  $tb = $asm.DefineDynamicModule('AftertermQuns').DefineType('Quns', 'Public, Class')
  function Def($name, $dll, $ret, $params) {
    $pm = $tb.DefinePInvokeMethod($name, $dll, 'Public, Static, PinvokeImpl', 'Standard', $ret, [Type[]]$params, 'Winapi', 'Unicode')
    $pm.SetImplementationFlags('PreserveSig')
  }
  Def 'SHQueryUserNotificationState' 'shell32.dll' ([int]) @([int].MakeByRefType())
  Def 'GetForegroundWindow' 'user32.dll' ([IntPtr]) @()
  Def 'GetWindowThreadProcessId' 'user32.dll' ([uint32]) @([IntPtr], [uint32].MakeByRefType())
  Def 'GetClassNameW' 'user32.dll' ([int]) @([IntPtr], [System.Text.StringBuilder], [int])
  Def 'GetWindowLongW' 'user32.dll' ([int]) @([IntPtr], [int])
  Def 'IsZoomed' 'user32.dll' ([bool]) @([IntPtr])
  Def 'GetWindowRect' 'user32.dll' ([bool]) @([IntPtr], [int[]])
  Def 'DwmGetWindowAttribute' 'dwmapi.dll' ([int]) @([IntPtr], [int], [int[]], [int])
  Def 'MonitorFromWindow' 'user32.dll' ([IntPtr]) @([IntPtr], [uint32])
  Def 'GetMonitorInfoW' 'user32.dll' ([bool]) @([IntPtr], [int[]])
  Def 'SetThreadDpiAwarenessContext' 'user32.dll' ([IntPtr]) @([IntPtr])
  $t = $tb.CreateType()
  try { [void]$t::SetThreadDpiAwarenessContext([IntPtr]::new(-4)) } catch { }
} catch { $t = $null }
function Quns {
  try { $q = 0; if ($t::SHQueryUserNotificationState([ref]$q) -eq 0) { return [string]$q } } catch { }
  return 'err'
}
function Fg {
  try {
    $h = $t::GetForegroundWindow()
    if ($h -eq [IntPtr]::Zero) { return '0' }
    $owner = [uint32]0
    [void]$t::GetWindowThreadProcessId($h, [ref]$owner)
    if ($owner -eq $own) { return '0' }
    $sb = New-Object System.Text.StringBuilder 256
    [void]$t::GetClassNameW($h, $sb, 256)
    if (@('Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd') -contains $sb.ToString()) { return '0' }
    $style = $t::GetWindowLongW($h, -16)
    if ($t::IsZoomed($h) -and (($style -band 0x00C00000) -eq 0x00C00000)) { return '0' }
    $r = New-Object int[] 4
    if ($t::DwmGetWindowAttribute($h, 9, $r, 16) -ne 0) { if (-not $t::GetWindowRect($h, $r)) { return 'err' } }
    $mi = New-Object int[] 10
    $mi[0] = 40
    if (-not $t::GetMonitorInfoW($t::MonitorFromWindow($h, 2), $mi)) { return 'err' }
    if ($r[0] -le $mi[1] -and $r[1] -le $mi[2] -and $r[2] -ge $mi[3] -and $r[3] -ge $mi[4]) { return '1' }
    return '0'
  } catch { return 'err' }
}
while ($null -ne ($line = [Console]::In.ReadLine())) {
  if ($null -eq $t) { [Console]::Out.WriteLine('error') }
  else { [Console]::Out.WriteLine('quns=' + (Quns) + ' fg=' + (Fg)) }
  [Console]::Out.Flush()
}
`;
}

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
  // The helper's line as it came ("quns=5 fg=1"), or null when there was none;
  // it says which signal fired (logged under the harness).
  line: string | null;
  // How long the question took, in ms.
  ms: number;
  // Whether this question started a new helper.
  started: boolean;
}

export interface NotifyStateProbeOptions {
  // afterterm's own process id: its windows (the main window, the overlay) never
  // count as a full-screen app. Defaults to this process.
  ownPid?: number;
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
  private ownPid: number;

  constructor(options: NotifyStateProbeOptions = {}) {
    this.warn = options.warn ?? ((m) => console.warn(m));
    this.ownPid = options.ownPid ?? process.pid;
  }

  // The helper's pid, or null when none is running (for the harness).
  get pid(): number | null {
    return this.child?.pid ?? null;
  }

  query(): Promise<ProbeAnswer> {
    const startedAt = Date.now();
    if (this.gaveUp || this.disposed) {
      return Promise.resolve({ state: 'unknown', line: null, ms: 0, started: false });
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
        resolve({ state: parseProbeLine(line), line: line.trim(), ms: Date.now() - startedAt, started });
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
      const encoded = Buffer.from(helperScript(this.ownPid), 'utf16le').toString('base64');
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
    return { state: 'unknown', line: null, ms: Date.now() - startedAt, started };
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

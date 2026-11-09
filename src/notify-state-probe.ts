// Asks Windows whether a full-screen app or a presentation is in front, for the
// toast hold (AFT-72, notify-hold.ts), two ways at once:
// SHQueryUserNotificationState (shell32), Windows' own answer, which looks at
// the primary display only; and whether the foreground window covers the whole
// monitor it is on, which works on any monitor (added on 2026-11-09 after the
// real check: a borderless full-screen window on the second monitor read as
// "accepts"). afterterm has no native module, so the calls are made by a Windows
// PowerShell helper that main starts when a toast is about to show and keeps
// while the overlay has toasts: it reads a line on stdin and answers one line,
// "quns=<n|err> fg=<1|0|own|err>", or "error" when it could not set itself up.
// parseProbeLine (notify-hold.ts) turns that into a state; either signal holds.
//
// Why a helper that stays, not one PowerShell per question (measured on
// 2026-11-09 on Aryan's machine): a fresh powershell.exe that makes the call
// takes about 500 ms and 530 ms of CPU, every time. Asked every 3 seconds for as
// long as a game runs, that is a sixth of a core for hours. The helper pays the
// start once (about 0.5 to 0.75 s to the first answer) and answers every later
// question in a few ms. It goes 15 seconds after the last question, so it runs
// only while toasts are up or waiting.
//
// The P/Invokes are built with Reflection.Emit, not Add-Type: Add-Type compiles C#
// through csc.exe in Windows PowerShell 5.1 (a temp file and about 150 ms more),
// and Emit needs neither. Windows PowerShell 5.1 by its full path, never pwsh: it
// is on every Windows, and PATH cannot swap it.
//
// Every failure answers 'unknown', which shows the toasts: a helper that cannot
// start, that hangs, that exits, or a machine where PowerShell is blocked. A slow
// start is not a failure: the toast waits at most 4 seconds and shows, and the
// helper is let finish starting (up to 10 seconds) for the next question, since
// a busy CPU during a game is exactly when it starts slowly. After three failures
// in a row the probe rests for 5 minutes, then tries again (review 1, 2026-11-09).

import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import path from 'path';
import { parseProbeLine } from './notify-hold.ts';
import type { NotifyState } from './notify-hold.ts';

// The helper's script, for afterterm's own process id. Single quotes only, and
// sent as -EncodedCommand, so nothing in it is unpicked by a command line. Its
// only output is the answers; PowerShell's own noise goes to stderr, which is
// ignored.
//
// fg is 1 when the foreground window covers the whole monitor it is on: its
// visible bounds (DWM's extended frame bounds, or the window rectangle when DWM
// has none) contain the monitor's rectangle (MonitorFromWindow, GetMonitorInfo),
// all in physical pixels (per-monitor DPI awareness on the helper's thread).
// fg is 'own' when the foreground window is afterterm's (its main window or the
// overlay), so Windows' busy for afterterm's own full screen (F11) does not hold
// its toasts. Not counted (fg=0): no foreground window; the desktop, the taskbars
// and Task View (Progman, WorkerW, Shell_TrayWnd, Shell_SecondaryTrayWnd,
// XamlExplorerHostIslandWindow); and any maximized window with a title bar or a
// resizing frame (WS_CAPTION or WS_THICKFRAME), which covers a monitor that has
// no taskbar (a second monitor without one, or an auto-hidden taskbar) without
// being full screen. A browser's full screen and a slide show drop both styles,
// and a borderless game is a WS_POPUP window with neither.
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
$shell = @('Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'XamlExplorerHostIslandWindow')
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
    if ($owner -eq $own) { return 'own' }
    $sb = New-Object System.Text.StringBuilder 256
    [void]$t::GetClassNameW($h, $sb, 256)
    if ($shell -contains $sb.ToString()) { return '0' }
    $style = $t::GetWindowLongW($h, -16)
    $framed = (($style -band 0x00C00000) -eq 0x00C00000) -or (($style -band 0x00040000) -ne 0)
    if ($framed -and $t::IsZoomed($h)) { return '0' }
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

export interface ProbeTimings {
  // How long a toast waits for a starting helper's first answer (PowerShell's
  // start, about 0.5 to 0.75 s here, more on a busy machine) before it shows.
  startAnswerMs: number;
  // A helper that has not answered at all this long after it was started is
  // stopped, and that counts as a failure.
  startLimitMs: number;
  // Later answers take a few ms; this only catches a helper that has hung.
  answerTimeoutMs: number;
  // How long the helper stays after the last question. Longer than the 3 second
  // poll, so it lives exactly while the overlay has toasts.
  idleExitMs: number;
  // After MAX_FAILURES in a row, how long the probe rests (every question
  // answers 'unknown', which shows) before it tries again.
  restMs: number;
}

export const PROBE_TIMINGS: ProbeTimings = {
  startAnswerMs: 4000,
  startLimitMs: 10_000,
  answerTimeoutMs: 1500,
  idleExitMs: 15_000,
  restMs: 5 * 60_000,
};
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
  // afterterm's own process id: the helper says fg=own for its windows (the main
  // window, the overlay). Defaults to this process.
  ownPid?: number;
  // Warnings (a failure, resting). Defaults to console.warn.
  warn?: (message: string) => void;
  // For the unit tests only: another helper (a Node script answering like the
  // PowerShell one) and shorter times.
  helper?: { command: string; args: string[] };
  timings?: Partial<ProbeTimings>;
}

export function windowsPowerShellPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env.SystemRoot || env.windir || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

// A question waiting for its line. It is settled once: by its line, by its own
// time limit, or by the helper going.
interface Waiter {
  settled: boolean;
  answer: (line: string | null) => void;
}

export class NotifyStateProbe {
  private child: ChildProcess | null = null;
  private answered = false;           // the running helper has answered at least once
  private buffer = '';
  // Questions in the order they were written; the helper answers in order, so
  // each line goes to the oldest, settled or not.
  private waiting: Waiter[] = [];
  private idleTimer: NodeJS.Timeout | null = null;
  private startTimer: NodeJS.Timeout | null = null;
  private failures = 0;
  private restUntil = 0;
  private disposed = false;
  private warn: (message: string) => void;
  private ownPid: number;
  private helper: { command: string; args: string[] } | null;
  private times: ProbeTimings;

  constructor(options: NotifyStateProbeOptions = {}) {
    this.warn = options.warn ?? ((m) => console.warn(m));
    this.ownPid = options.ownPid ?? process.pid;
    this.helper = options.helper ?? null;
    this.times = { ...PROBE_TIMINGS, ...options.timings };
  }

  // The helper's pid, or null when none is running (for the harness).
  get pid(): number | null {
    return this.child?.pid ?? null;
  }

  query(): Promise<ProbeAnswer> {
    const startedAt = Date.now();
    if (this.disposed || startedAt < this.restUntil) {
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
      const starting = !this.answered;
      const limit = starting ? this.times.startAnswerMs : this.times.answerTimeoutMs;
      const waiter: Waiter = {
        settled: false,
        answer: (line) => {
          if (waiter.settled) return;
          waiter.settled = true;
          clearTimeout(timer);
          if (line === null) resolve(this.fail('the helper exited', startedAt, started));
          else resolve({ state: parseProbeLine(line), line: line.trim(), ms: Date.now() - startedAt, started });
        },
      };
      const timer = setTimeout(() => {
        if (waiter.settled) return;
        waiter.settled = true;
        if (starting) {
          // Still starting: the toast shows now, and the helper is let finish
          // (startLimitMs stops one that never does). Not a failure.
          this.warn(`[notify-hold] the full-screen check is still starting after ${limit} ms; the toast shows`);
          resolve({ state: 'unknown', line: null, ms: Date.now() - startedAt, started });
          return;
        }
        // A warm helper that does not answer has hung: stop it, and the next
        // question starts a new one.
        this.stop();
        resolve(this.fail(`no answer in ${limit} ms`, startedAt, started));
      }, limit);
      this.waiting.push(waiter);
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
      const command = this.helper?.command ?? windowsPowerShellPath();
      const args = this.helper?.args ?? ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded];
      child = spawn(command, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    } catch {
      return false;
    }
    this.child = child;
    this.answered = false;
    this.buffer = '';
    this.startTimer = setTimeout(() => {
      this.startTimer = null;
      if (this.child !== child || this.answered) return;
      // Never answered: stop it. A question still waiting fails through the stop;
      // otherwise the failure is noted here.
      const live = this.waiting.some(w => !w.settled);
      this.stop();
      if (!live) this.noteFailure(`it did not start in ${this.times.startLimitMs} ms`);
    }, this.times.startLimitMs);
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      if (this.child !== child) return;
      this.buffer += chunk;
      let i: number;
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, i);
        this.buffer = this.buffer.slice(i + 1);
        this.answered = true;
        this.failures = 0;
        this.clearStart();
        this.waiting.shift()?.answer(line);
        this.armIdle();
      }
    });
    // A write to a helper that has gone raises EPIPE on the stream, not the call.
    child.stdin?.on('error', () => { /* the exit handler answers */ });
    const gone = () => {
      if (this.child !== child) return;
      this.child = null;
      this.clearIdle();
      this.clearStart();
      const pending = this.waiting;
      this.waiting = [];
      // A question still waiting fails through its answer below. A helper that
      // goes before it ever answered, after every question had already shown its
      // toast (the 4 second wait), is a failure too (review 2): otherwise one
      // that is always killed while starting, by an antivirus scan for example,
      // is started again on every poll and the 5 minute rest never comes.
      const live = pending.some(w => !w.settled);
      const neverAnswered = !this.answered;
      for (const w of pending) w.answer(null);
      if (neverAnswered && !live) this.noteFailure('it exited while starting');
    };
    child.on('error', gone);
    child.on('exit', gone);
    return true;
  }

  // Ends the running helper: stdin closed (it leaves its loop and exits), and
  // killed as well, in case it is the one that hung.
  private stop(): void {
    this.clearIdle();
    this.clearStart();
    const child = this.child;
    if (!child) return;
    this.child = null;
    const pending = this.waiting;
    this.waiting = [];
    for (const w of pending) w.answer(null);
    try { child.stdin?.end(); } catch { /* already closed */ }
    try { child.kill(); } catch { /* already gone */ }
  }

  private fail(reason: string, startedAt: number, started: boolean): ProbeAnswer {
    this.noteFailure(reason);
    return { state: 'unknown', line: null, ms: Date.now() - startedAt, started };
  }

  private noteFailure(reason: string): void {
    if (Date.now() < this.restUntil) return;
    this.failures += 1;
    if (this.failures >= MAX_FAILURES) {
      this.failures = 0;
      this.restUntil = Date.now() + this.times.restMs;
      this.warn(`[notify-hold] the full-screen check failed ${MAX_FAILURES} times in a row (last: ${reason}); toasts show without it for ${Math.round(this.times.restMs / 1000)} s`);
      this.stop();
    } else {
      this.warn(`[notify-hold] the full-screen check failed (${reason}); the toast shows`);
    }
  }

  private armIdle(): void {
    this.clearIdle();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (!this.waiting.some(w => !w.settled)) this.stop();
    }, this.times.idleExitMs);
  }

  private clearIdle(): void {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
  }

  private clearStart(): void {
    if (this.startTimer) { clearTimeout(this.startTimer); this.startTimer = null; }
  }
}

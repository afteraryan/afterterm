// Shared pieces for the agent harness scripts (launch, drive, stop).
// Plain Node, no dependencies: Node 22+ ships global fetch and WebSocket.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// The repo root is resolved from this file's location, not process.cwd(), so the
// scripts work no matter which directory the caller runs them from (and so a
// worktree checkout drives its own sources, not the main checkout's).
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Well-known pointer to the most recent run, so drive/stop need no arguments.
export const POINTER_DIR = path.join(os.tmpdir(), 'afterterm-agent-harness');
export const LATEST_FILE = path.join(POINTER_DIR, 'latest.json');

export const DEFAULT_PORT = 9333;

// Minimal argv parser: `--key value`, `--flag`, and bare positionals.
export function parseArgs(argv) {
  const opts = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        opts[key] = next;
        i++;
      } else {
        opts[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { opts, positional };
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

// Locate the run record: an explicit --data-dir wins, then latest.json. A --port
// alone is enough for drive.mjs (it only needs the DevTools endpoint).
export function loadRun(opts) {
  if (opts['data-dir']) {
    const file = path.join(path.resolve(opts['data-dir']), 'harness.json');
    if (!fs.existsSync(file)) throw new Error(`no harness.json in ${opts['data-dir']}`);
    return readJson(file);
  }
  if (fs.existsSync(LATEST_FILE)) return readJson(LATEST_FILE);
  if (opts.port) return { port: Number(opts.port) };
  throw new Error(`no run recorded at ${LATEST_FILE}; pass --data-dir <dir> or --port <n>`);
}

export function resolvePort(opts, run) {
  const port = Number(opts.port ?? run?.port ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port <= 0) throw new Error(`bad port: ${opts.port}`);
  return port;
}

// ─── Processes (Windows) ──────────────────────────────────────────────────────

function powershell(script) {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
}

// Every process on the machine with its parent, name, image path and creation
// time. One call, then the tree walk happens in JS; cheaper than a PowerShell
// call per node.
export function listProcesses() {
  const out = powershell(
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,@{n="Created";e={[DateTimeOffset]::new($_.CreationDate).ToUnixTimeMilliseconds()}} | ConvertTo-Json -Compress',
  );
  const rows = JSON.parse(out || '[]');
  return (Array.isArray(rows) ? rows : [rows]).map(r => ({
    pid: r.ProcessId,
    ppid: r.ParentProcessId,
    name: r.Name,
    path: r.ExecutablePath ?? null,
    created: typeof r.Created === 'number' ? r.Created : null,
  }));
}

export function findProcess(procs, pid) {
  return procs.find(p => p.pid === pid) ?? null;
}

// Root plus all descendants, by walking ParentProcessId. Windows keeps the parent
// id of orphaned processes, so a subtree stays discoverable even if a middle
// process has already exited. The same fact makes a naive walk dangerous: pids
// are reused, so an unrelated old process whose long-dead parent's pid is now one
// of ours would look like a child (seen in practice: OneDrive.Sync.Service under
// a fresh electron.exe). A real child is created after its parent, so anything
// older than the node it hangs off is dropped. taskkill /T does no such check,
// which is why stop.mjs kills the pids this function returns instead.
export function processTree(procs, rootPid) {
  const byParent = new Map();
  for (const p of procs) {
    if (!byParent.has(p.ppid)) byParent.set(p.ppid, []);
    byParent.get(p.ppid).push(p);
  }
  const result = [];
  const seen = new Set();
  const stack = [rootPid];
  while (stack.length) {
    const pid = stack.pop();
    if (seen.has(pid)) continue;
    seen.add(pid);
    const self = findProcess(procs, pid);
    if (!self) continue;
    result.push(self);
    for (const child of byParent.get(pid) ?? []) {
      if (self.created !== null && child.created !== null && child.created < self.created) continue;
      stack.push(child.pid);
    }
  }
  return result;
}

// Does a Windows pid exist right now? Signal 0 only probes.
export function pidExists(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// Start a process through WMI's Win32_Process.Create instead of child_process.
// The new process is created by the WMI provider host, so it has no parent,
// console or process-group tie to whatever shell ran this script. A child spawned
// with child_process (even detached: true) was killed together with the agent's
// tool shell when that shell was recycled; a WMI-created one is not. Win32_Process
// replaces the whole environment with what is given, so the caller passes the
// full env. The request goes through a JSON file to sidestep quoting.
export function spawnViaWmi({ commandLine, cwd, env, dataDir }) {
  const request = path.join(dataDir, 'harness-spawn.json');
  fs.writeFileSync(request, JSON.stringify({
    commandLine,
    cwd,
    env: Object.entries(env).filter(([k, v]) => k && v !== undefined).map(([k, v]) => `${k}=${v}`),
  }));
  const script = `
$req = Get-Content -Raw -LiteralPath '${request.replace(/'/g, "''")}' | ConvertFrom-Json
$startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0; EnvironmentVariables = [string[]]$req.env }
$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = [string]$req.commandLine; CurrentDirectory = [string]$req.cwd; ProcessStartupInformation = $startup }
"$($r.ReturnValue) $($r.ProcessId)"`;
  const out = powershell(script).trim();
  const [ret, pid] = out.split(/\s+/).map(Number);
  if (ret !== 0 || !pid) throw new Error(`Win32_Process.Create returned ${out} (0 means success)`);
  return pid;
}

// The process that owns the listening DevTools socket is the Electron browser
// process itself, which is more reliable than guessing among electron.exe
// children (renderer, GPU and utility processes share the image name).
export function pidListeningOn(port) {
  try {
    const out = powershell(
      `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction Stop | Select-Object -First 1).OwningProcess`,
    ).trim();
    const pid = Number(out);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

// The production afterterm (Aryan's live shells) must never be touched. Anything
// under an out\afterterm-* folder, or named afterterm.exe, is off limits.
export function isProductionAfterterm(proc) {
  if (!proc) return false;
  if (/^afterterm\.exe$/i.test(proc.name ?? '')) return true;
  return /[\\/]out[\\/]afterterm-/i.test(proc.path ?? '');
}

export function isDevElectron(proc) {
  return !!proc && /^electron\.exe$/i.test(proc.name ?? '') && /node_modules/i.test(proc.path ?? '');
}

// PowerShell is not DPI-aware by default, so on a scaled primary monitor Windows
// hands it virtualised coordinates that mix badly across monitors. Declaring
// per-monitor awareness first makes every rectangle below a physical pixel
// rectangle, the same space screenshot-display.ps1 captures in. (Electron's own
// DIP space differs: it re-lays displays out by scale factor, which is why the
// page witness in drive bounds shows different numbers for the same window.)
const DPI_AWARE_PRELUDE = `
Add-Type -Namespace Harness -Name Dpi -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(System.IntPtr value);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
'@
if (-not [Harness.Dpi]::SetProcessDpiAwarenessContext([System.IntPtr]::op_Explicit(-4))) { [void][Harness.Dpi]::SetProcessDPIAware() }
`;

// Displays in physical pixels (see DPI_AWARE_PRELUDE).
export function listDisplays() {
  const out = powershell(
    DPI_AWARE_PRELUDE +
    'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens | ForEach-Object { [pscustomobject]@{ name=$_.DeviceName; primary=$_.Primary; x=$_.Bounds.X; y=$_.Bounds.Y; width=$_.Bounds.Width; height=$_.Bounds.Height } } | ConvertTo-Json -Compress',
  );
  const rows = JSON.parse(out || '[]');
  return Array.isArray(rows) ? rows : [rows];
}

// Visible top-level windows owned by a process, with their native rectangles in
// physical pixels. Electron's DevTools endpoint does not implement
// Browser.getWindowForTarget, so this OS-level view (same coordinate space as
// listDisplays) is how an agent proves where a window really is.
export function listWindows(pid) {
  const script = DPI_AWARE_PRELUDE + `
Add-Type -Namespace Harness -Name Win -MemberDefinition @'
public delegate bool EnumProc(System.IntPtr h, System.IntPtr l);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, System.IntPtr l);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr h);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint pid);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool GetWindowRect(System.IntPtr h, out RECT r);
[System.Runtime.InteropServices.DllImport("user32.dll", CharSet=System.Runtime.InteropServices.CharSet.Unicode)] public static extern int GetWindowText(System.IntPtr h, System.Text.StringBuilder s, int n);
public struct RECT { public int Left, Top, Right, Bottom; }
public static System.Collections.Generic.List<string> Find(uint want) {
  var found = new System.Collections.Generic.List<string>();
  EnumWindows((h, l) => {
    uint pid; GetWindowThreadProcessId(h, out pid);
    if (pid != want || !IsWindowVisible(h)) return true;
    RECT r; GetWindowRect(h, out r);
    var sb = new System.Text.StringBuilder(512); GetWindowText(h, sb, 512);
    found.Add(string.Format("{0}|{1}|{2}|{3}|{4}", r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top, sb.ToString()));
    return true;
  }, System.IntPtr.Zero);
  return found;
}
'@
[Harness.Win]::Find(${pid}) | ForEach-Object { $_ }`;
  const out = powershell(script);
  return out.split(/\r?\n/).filter(Boolean).map(line => {
    const [x, y, width, height, ...title] = line.split('|');
    return { x: Number(x), y: Number(y), width: Number(width), height: Number(height), title: title.join('|') };
  });
}

export function displayContaining(displays, x, y) {
  return displays.find(d => x >= d.x && x < d.x + d.width && y >= d.y && y < d.y + d.height) ?? null;
}

// ─── DevTools (CDP) ───────────────────────────────────────────────────────────

export async function fetchJson(url, timeoutMs = 3000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

export async function listTargets(port) {
  return fetchJson(`http://127.0.0.1:${port}/json`);
}

// The main window is the page target whose URL is not the notifier overlay
// (`?notifier=1`). DevTools' own pages and service workers are skipped.
export function pickMainPage(targets) {
  const pages = targets.filter(t => t.type === 'page' && !/notifier=1/.test(t.url) && !/^devtools:/.test(t.url));
  return pages[0] ?? null;
}

export function pickNotifierPage(targets) {
  return targets.find(t => t.type === 'page' && /notifier=1/.test(t.url)) ?? null;
}

export class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
        else p.resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners.get(msg.method) ?? []) fn(msg.params);
      }
    });
    ws.addEventListener('close', () => {
      for (const p of this.pending.values()) p.reject(new Error(`socket closed during ${p.method}`));
      this.pending.clear();
    });
  }

  static connect(wsUrl, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => { ws.close(); reject(new Error(`timeout connecting to ${wsUrl}`)); }, timeoutMs);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(new Cdp(ws)); });
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error(`could not connect to ${wsUrl}`)); });
    });
  }

  send(method, params = {}, timeoutMs = 15000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method}: no reply within ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        method,
        resolve: v => { clearTimeout(timer); resolve(v); },
        reject: e => { clearTimeout(timer); reject(e); },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }

  close() {
    try { this.ws.close(); } catch {}
  }
}

// Runtime.evaluate with the conveniences every command wants: promises awaited,
// values returned by value, exceptions surfaced as errors.
export async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (r.exceptionDetails) {
    const text = r.exceptionDetails.exception?.description ?? r.exceptionDetails.text;
    throw new Error(`page threw: ${text}`);
  }
  return r.result?.value;
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

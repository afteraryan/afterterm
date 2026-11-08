# AFT-41 z-order test: puts a solid magenta window over the toast area of the
# secondary display (never activated, never focused), arranges one z-order
# scenario, pushes a toast through the harness, captures display 2 and measures
# how much of the toast card is covered by the magenta window.
#
#   pwsh -File zorder-test.ps1 -ElectronPid <pid> -DataDir <harness data dir> -Scenario plain|topmost-other|lost-topmost -OutDir <dir> -Tag <name>
param(
  [Parameter(Mandatory = $true)][int]$ElectronPid,
  [Parameter(Mandatory = $true)][string]$DataDir,
  [Parameter(Mandatory = $true)][ValidateSet('plain', 'topmost-other', 'lost-topmost')][string]$Scenario,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [Parameter(Mandatory = $true)][string]$Tag,
  [string]$Repo = 'D:\Pitara\Work\Tinkering\afterterm\.claude\worktrees\notifier-and-display'
)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class ZT {
  public delegate IntPtr WndProc(IntPtr h, uint m, IntPtr w, IntPtr l);
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct WNDCLASSEX { public uint cbSize; public uint style; public WndProc lpfnWndProc; public int cbClsExtra; public int cbWndExtra; public IntPtr hInstance; public IntPtr hIcon; public IntPtr hCursor; public IntPtr hbrBackground; public string lpszMenuName; public string lpszClassName; public IntPtr hIconSm; }
  [StructLayout(LayoutKind.Sequential)] public struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public int x; public int y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern ushort RegisterClassEx(ref WNDCLASSEX c);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr CreateWindowEx(uint ex, string cls, string name, uint style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr inst, IntPtr param);
  [DllImport("user32.dll")] public static extern IntPtr DefWindowProc(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool DestroyWindow(IntPtr h);
  [DllImport("gdi32.dll")] public static extern IntPtr CreateSolidBrush(uint color);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr GetModuleHandle(string n);
  [DllImport("user32.dll")] public static extern bool PeekMessage(out MSG m, IntPtr h, uint min, uint max, uint remove);
  [DllImport("user32.dll")] public static extern bool TranslateMessage(ref MSG m);
  [DllImport("user32.dll")] public static extern IntPtr DispatchMessage(ref MSG m);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int idx);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
  // True when a sits above b in the z-order (walking down from a reaches b).
  public static bool Above(IntPtr a, IntPtr b) { IntPtr h = GetWindow(a, 2); int n = 0; while (h != IntPtr.Zero && n++ < 100000) { if (h == b) return true; h = GetWindow(h, 2); } return false; }
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, System.Text.StringBuilder s, int n);
  static WndProc keep = (h, m, w, l) => DefWindowProc(h, m, w, l);
  static bool registered;
  public static IntPtr MakeBlocker(int x, int y, int w, int h) {
    IntPtr inst = GetModuleHandle(null);
    if (!registered) {
      var wc = new WNDCLASSEX();
      wc.cbSize = (uint)Marshal.SizeOf(typeof(WNDCLASSEX));
      wc.lpfnWndProc = keep; wc.hInstance = inst;
      wc.hbrBackground = CreateSolidBrush(0x00FF00FF); // magenta (BGR)
      wc.lpszClassName = "AftZBlocker";
      RegisterClassEx(ref wc);
      registered = true;
    }
    // WS_POPUP; WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW: never activated, no taskbar button.
    IntPtr hwnd = CreateWindowEx(0x08000080, "AftZBlocker", "z-order blocker", 0x80000000, x, y, w, h, IntPtr.Zero, IntPtr.Zero, inst, IntPtr.Zero);
    ShowWindow(hwnd, 4); // SW_SHOWNOACTIVATE
    return hwnd;
  }
  public static void Pump(int ms) {
    int end = Environment.TickCount + ms; MSG m;
    while (Environment.TickCount < end) {
      while (PeekMessage(out m, IntPtr.Zero, 0, 0, 1)) { TranslateMessage(ref m); DispatchMessage(ref m); }
      System.Threading.Thread.Sleep(10);
    }
  }
  public static List<IntPtr> ZOrder() {
    var list = new List<IntPtr>();
    EnumWindows((h, l) => { list.Add(h); return true; }, IntPtr.Zero);
    return list;
  }
  public static string Cls(IntPtr h) { var sb = new System.Text.StringBuilder(256); GetClassName(h, sb, 256); return sb.ToString(); }
}
'@

[void][ZT]::SetProcessDpiAwarenessContext([IntPtr]::op_Explicit(-4))
# pwsh is already system-DPI-aware, so the process call fails; the thread call
# still makes every rectangle on this thread physical pixels.
if ([ZT]::SetThreadDpiAwarenessContext([IntPtr]::op_Explicit(-4)) -eq [IntPtr]::Zero) { throw "could not set per-monitor DPI awareness" }
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$HWND_TOP = [IntPtr]::Zero
$HWND_TOPMOST = [IntPtr]::op_Explicit(-1)
$HWND_NOTOPMOST = [IntPtr]::op_Explicit(-2)
$SWP = 0x0001 -bor 0x0002 -bor 0x0010 # NOSIZE | NOMOVE | NOACTIVATE

function Find-Overlay {
  foreach ($h in [ZT]::ZOrder()) {
    [uint32]$p = 0; [void][ZT]::GetWindowThreadProcessId($h, [ref]$p)
    if ($p -ne $ElectronPid) { continue }
    if ([ZT]::Cls($h) -ne 'Chrome_WidgetWin_1') { continue }
    $r = New-Object ZT+RECT; [void][ZT]::GetWindowRect($h, [ref]$r)
    if (($r.R - $r.L) -eq 340) { return $h }
  }
  return [IntPtr]::Zero
}
function Describe([IntPtr]$h) {
  $z = [ZT]::ZOrder(); $i = $z.IndexOf($h)
  $r = New-Object ZT+RECT; [void][ZT]::GetWindowRect($h, [ref]$r)
  $ex = [ZT]::GetWindowLong($h, -20)
  [pscustomobject]@{ hwnd = $h.ToInt64(); z = $i; visible = [ZT]::IsWindowVisible($h); topmost = [bool]($ex -band 0x8); rect = "$($r.L),$($r.T) $($r.R - $r.L)x$($r.B - $r.T)" }
}
function Drive([string]$js) {
  Push-Location $Repo
  try { node scripts/agent-harness/drive.mjs eval $js --data-dir $DataDir | Out-Null } finally { Pop-Location }
}

$screens = [System.Windows.Forms.Screen]::AllScreens
$d2 = $screens | Where-Object { -not $_.Primary } | Select-Object -First 1
if (-not $d2) { throw 'no secondary display' }
$wa = $d2.WorkingArea
# The magenta window covers the bottom-right corner of the secondary display's work area,
# where the toast stack sits (12px from the corner, 340px wide).
$bw = 720; $bh = 460
$bx = $wa.X + $wa.Width - $bw; $by = $wa.Y + $wa.Height - $bh

$overlay = Find-Overlay
if ($overlay -eq [IntPtr]::Zero) { throw 'overlay window not found' }
$fgBefore = [ZT]::GetForegroundWindow()

$blocker = [ZT]::MakeBlocker($bx, $by, $bw, $bh)
[ZT]::Pump(300)
switch ($Scenario) {
  'plain' { [void][ZT]::SetWindowPos($blocker, $HWND_TOP, 0, 0, 0, 0, $SWP) }
  'topmost-other' { [void][ZT]::SetWindowPos($blocker, $HWND_TOPMOST, 0, 0, 0, 0, $SWP) }
  'lost-topmost' {
    # What Windows does when it drops a window's topmost flag: the overlay becomes
    # an ordinary window, and the magenta window then sits above it.
    [void][ZT]::SetWindowPos($overlay, $HWND_NOTOPMOST, 0, 0, 0, 0, $SWP)
    [void][ZT]::SetWindowPos($blocker, $HWND_TOP, 0, 0, 0, 0, $SWP)
  }
}
[ZT]::Pump(300)
$beforePush = Describe $overlay
$blockerInfo = Describe $blocker

$tabId = "z-$Tag"
Drive "window.afterterm.notify.push({ id: '$tabId-' + Date.now(), tabId: '$tabId', type: 'done', primaryLabel: 'Toast above other windows', secondaryLabel: 'Toast demo', projectColor: '#60a5fa', message: 'Finished ($Scenario)' }); 'pushed'"
[ZT]::Pump(1500)

$afterPush = Describe $overlay
$blockerAfter = Describe $blocker
$above = [ZT]::Above($overlay, $blocker)
$fgAfter = [ZT]::GetForegroundWindow()

# Whole display capture (git-ignored folder), then a crop of the magenta area only.
$dispDir = Join-Path $OutDir 'displays'
New-Item -ItemType Directory -Force $dispDir | Out-Null
$b = $d2.Bounds
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.X, $b.Y, 0, 0, $bmp.Size); $g.Dispose()
$dispPath = Join-Path $dispDir "$Tag-display2.png"
$bmp.Save($dispPath, [System.Drawing.Imaging.ImageFormat]::Png)

$cropRect = New-Object System.Drawing.Rectangle ($bx - $b.X), ($by - $b.Y), $bw, $bh
$crop = $bmp.Clone($cropRect, $bmp.PixelFormat)
$cropPath = Join-Path $OutDir "$Tag.png"
$crop.Save($cropPath, [System.Drawing.Imaging.ImageFormat]::Png)
$crop.Dispose()

# How much of the toast card is magenta: the overlay rect inset by 16px (inside its
# 12px padding), so only the card itself is measured.
$r = New-Object ZT+RECT; [void][ZT]::GetWindowRect($overlay, [ref]$r)
$magenta = 0; $total = 0
for ($y = $r.T + 16; $y -lt $r.B - 16; $y += 2) {
  for ($x = $r.L + 16; $x -lt $r.R - 16; $x += 2) {
    $c = $bmp.GetPixel($x - $b.X, $y - $b.Y)
    $total++
    if ($c.R -gt 230 -and $c.G -lt 30 -and $c.B -gt 230) { $magenta++ }
  }
}
$bmp.Dispose()
$frac = if ($total) { [math]::Round(100.0 * $magenta / $total, 1) } else { -1 }

Drive "window.afterterm.notify.dismissTab('$tabId'); 'dismissed'"
[ZT]::Pump(800)
[void][ZT]::DestroyWindow($blocker)

[pscustomobject]@{
  scenario = $Scenario
  overlayBeforePush = $beforePush
  overlayAfterPush = $afterPush
  blocker = $blockerAfter
  toastCardCoveredByMagentaPct = $frac
  overlayAboveBlocker = $above
  foregroundUnchanged = ($fgBefore -eq $fgAfter)
  display = $dispPath
  crop = $cropPath
} | ConvertTo-Json -Depth 4

# AFT-15 harness test: the main window's home. Runs on the secondary display only.
#   pwsh -File placement-test.ps1 -Step <name> -DataDir <dir> [-X <px> -Y <px>]
# Steps:
#   rect       the main window's rectangle in physical pixels and its display
#   move       moves the main window to physical X,Y with SetWindowPos (no activation),
#              refusing any point off the secondary display
#   state      window.afterterm.harness.windowHome() (the home, the pending move, the displays)
#   sim        plays an event: -Event display-removed|display-added|resume|unlock-screen,
#              -Fake: the window is said to be on a made-up laptop display (the primary's
#              bounds, id 999); -NoHome: the secondary display is left out of the list
#   capture    whole display 2 to -Out
param(
  [Parameter(Mandatory = $true)][string]$Step,
  [Parameter(Mandatory = $true)][string]$DataDir,
  [int]$X = 0, [int]$Y = 0,
  [string]$Event = '',
  [switch]$Fake, [switch]$NoHome,
  [string]$Out = '',
  [string]$Repo = 'D:\Pitara\Work\Tinkering\afterterm\.claude\worktrees\notifier-and-display'
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'zt.ps1')

$rec = Get-Content (Join-Path $DataDir 'harness.json') | ConvertFrom-Json
$ElectronPid = [int]$rec.electronPid
$screens = [System.Windows.Forms.Screen]::AllScreens
$d2 = $screens | Where-Object { -not $_.Primary } | Select-Object -First 1

function Main-Window {
  $best = [IntPtr]::Zero; $area = 0
  foreach ($h in [ZT]::ZOrder()) {
    [uint32]$p = 0; [void][ZT]::GetWindowThreadProcessId($h, [ref]$p)
    if ($p -ne $ElectronPid -or -not [ZT]::IsWindowVisible($h)) { continue }
    $r = New-Object ZT+RECT; [void][ZT]::GetWindowRect($h, [ref]$r)
    $a = ($r.R - $r.L) * ($r.B - $r.T)
    if ($a -gt $area) { $area = $a; $best = $h }
  }
  return $best
}
function Rect-Of([IntPtr]$h) {
  $r = New-Object ZT+RECT; [void][ZT]::GetWindowRect($h, [ref]$r)
  $onD2 = $r.L -ge $d2.Bounds.X -and $r.R -le ($d2.Bounds.X + $d2.Bounds.Width)
  "x=$($r.L) y=$($r.T) w=$($r.R - $r.L) h=$($r.B - $r.T) onSecondary=$onD2"
}
function Eval([string]$js) {
  Push-Location $Repo
  try { (node scripts/agent-harness/drive.mjs eval $js --data-dir $DataDir) -join "`n" } finally { Pop-Location }
}

switch ($Step) {
  'rect' { Rect-Of (Main-Window) }
  'move' {
    $h = Main-Window
    $r = New-Object ZT+RECT; [void][ZT]::GetWindowRect($h, [ref]$r)
    $w = $r.R - $r.L; $hh = $r.B - $r.T
    $wa = $d2.WorkingArea
    if ($X -lt $wa.X -or $Y -lt $wa.Y -or ($X + $w) -gt ($wa.X + $wa.Width) -or ($Y + $hh) -gt ($wa.Y + $wa.Height)) { throw "refusing to move off the secondary display's work area" }
    # SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE
    [void][ZT]::SetWindowPos($h, [IntPtr]::Zero, $X, $Y, 0, 0, 0x0001 -bor 0x0004 -bor 0x0010)
    "moved to " + (Rect-Of $h)
  }
  'state' { Eval "window.afterterm.harness.windowHome()" }
  'sim' {
    if (-not $Fake) { Eval "window.afterterm.harness.windowHome({ event: '$Event' })"; break }
    # The displays as main sees them, with the primary replaced by a made-up laptop
    # display (same bounds, id 999) that the window is said to be on.
    $js = @"
(async () => {
  const s = await window.afterterm.harness.windowHome();
  const primaryish = s.displays.find(d => d.id !== s.home.displayId) || s.displays[0];
  let displays = s.displays.map(d => d.id === primaryish.id ? { ...d, id: 999 } : d);
  if ($(if ($NoHome) { 'true' } else { 'false' })) displays = displays.filter(d => d.id !== s.home.displayId);
  return window.afterterm.harness.windowHome({ event: '$Event', displays, windowDisplayId: 999 });
})()
"@
    Eval $js
  }
  'capture' {
    $b = $d2.Bounds
    $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($b.X, $b.Y, 0, 0, $bmp.Size); $g.Dispose()
    New-Item -ItemType Directory -Force (Split-Path $Out) | Out-Null
    $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
    "captured $Out"
  }
  default { throw "unknown step $Step" }
}

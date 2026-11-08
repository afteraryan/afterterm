# AFT-13 white bar check. A magenta backdrop window (ordinary, never activated)
# sits under the toast area of the secondary display so a white strip cannot be
# confused with whatever else is on that display. Each iteration:
#   A. a second toast joins the stack (push, wait, push another);
#   B. every toast goes (both dismissed in one tick, or one after the other on
#      odd iterations), then the overlay should be hidden.
# After each step the overlay area is captured at 100, 400 and 1200 ms and
# scanned for near-white pixels in the padding above the first card, and for
# any row of the window that is mostly near-white.
param(
  [Parameter(Mandatory = $true)][int]$ElectronPid,
  [Parameter(Mandatory = $true)][string]$DataDir,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [Parameter(Mandatory = $true)][string]$Tag,
  [int]$Iterations = 10,
  [string]$ScratchDir = $PSScriptRoot,
  [string]$Repo = 'D:\Pitara\Work\Tinkering\afterterm\.claude\worktrees\notifier-and-display'
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'zt.ps1')

$HWND_TOP = [IntPtr]::Zero
$SWP = 0x0001 -bor 0x0002 -bor 0x0010

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
function Drive([string]$js) {
  Push-Location $Repo
  try { node scripts/agent-harness/drive.mjs eval $js --data-dir $DataDir | Out-Null } finally { Pop-Location }
}
function Toasts {
  Push-Location $Repo
  try { (node scripts/agent-harness/drive.mjs toasts --data-dir $DataDir) -join ' | ' } finally { Pop-Location }
}
function Push([string]$tab, [string]$label) {
  Drive "window.afterterm.notify.push({ id: '$tab-' + Date.now(), tabId: '$tab', type: 'done', primaryLabel: '$label', secondaryLabel: 'Toast demo', projectColor: '#60a5fa', message: 'Finished' }); 'ok'"
}

$screens = [System.Windows.Forms.Screen]::AllScreens
$d2 = $screens | Where-Object { -not $_.Primary } | Select-Object -First 1
$wa = $d2.WorkingArea
$bw = 720; $bh = 460
$bx = $wa.X + $wa.Width - $bw; $by = $wa.Y + $wa.Height - $bh
$overlay = Find-Overlay
if ($overlay -eq [IntPtr]::Zero) { throw 'overlay window not found' }
$fgBefore = [ZT]::GetForegroundWindow()
$backdrop = [ZT]::MakeBlocker($bx, $by, $bw, $bh)
[void][ZT]::SetWindowPos($backdrop, $HWND_TOP, 0, 0, 0, 0, $SWP)
[ZT]::Pump(400)

$cropDir = Join-Path $ScratchDir "whitebar-$Tag"
New-Item -ItemType Directory -Force $cropDir | Out-Null
$dispDir = Join-Path $OutDir 'displays'
New-Item -ItemType Directory -Force $dispDir | Out-Null

# Capture the backdrop area now (fast) and analyse later, so the 100/400/1200 ms
# timings hold. A whole-display capture is taken at the 400 ms sample.
$caps = New-Object System.Collections.ArrayList
function Scan([string]$step, [int]$i, [int]$ms, [bool]$full) {
  $vis = [ZT]::IsWindowVisible($overlay)
  $r = New-Object ZT+RECT; [void][ZT]::GetWindowRect($overlay, [ref]$r)
  $bmp = New-Object System.Drawing.Bitmap $bw, $bh, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($bx, $by, 0, 0, $bmp.Size); $g.Dispose()
  $name = '{0:D2}-{1}-{2}ms' -f $i, $step, $ms
  if ($full) {
    $b = $d2.Bounds
    $fb = New-Object System.Drawing.Bitmap $b.Width, $b.Height
    $fg = [System.Drawing.Graphics]::FromImage($fb)
    $fg.CopyFromScreen($b.X, $b.Y, 0, 0, $fb.Size); $fg.Dispose()
    $fb.Save((Join-Path $dispDir "$Tag-$name-display2.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $fb.Dispose()
  }
  [void]$caps.Add([pscustomobject]@{ i = $i; step = $step; ms = $ms; visible = $vis; top = $r.T; height = ($r.B - $r.T); bmp = $bmp; name = $name })
}
function Analyse($c) {
  $bmp = $c.bmp
  $rect = New-Object System.Drawing.Rectangle 0, 0, $bw, $bh
  $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bytes = New-Object byte[] ($data.Stride * $bh)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
  $stride = $data.Stride
  $bmp.UnlockBits($data)
  # The 12px padding above the first card, in backdrop coordinates (only while shown).
  $padTop = if ($c.visible) { $c.top - $by } else { -1 }
  $res = [ZT]::WhiteScan($bytes, $stride, $bw, $bh, $padTop, $padTop + 12, 170)
  $bmp.Save((Join-Path $cropDir "$($c.name).png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  [pscustomobject]@{ i = $c.i; step = $c.step; ms = $c.ms; visible = $c.visible; height = $c.height; padWhitePx = $res[0]; whiteRows = $res[1]; nearWhitePx = $res[2] }
}

$rows = @()
for ($i = 1; $i -le $Iterations; $i++) {
  $a = "wa$i"; $b2 = "wb$i"
  # A. A second toast joins the stack.
  Push $a 'First toast'
  [ZT]::Pump(700)
  Push $b2 'Second toast joins'
  $t0 = [Environment]::TickCount
  foreach ($ms in 100, 400, 1200) {
    $wait = $ms - ([Environment]::TickCount - $t0); if ($wait -gt 0) { [ZT]::Pump($wait) }
    Scan 'second-toast-joins' $i $ms ($ms -eq 400)
  }
  # B. Every toast goes.
  if ($i % 2 -eq 1) {
    Drive "window.afterterm.notify.dismissTab('$a'); window.afterterm.notify.dismissTab('$b2'); 'ok'"
    $step = 'both-dismissed-together'
  } else {
    Drive "window.afterterm.notify.dismissTab('$b2'); 'ok'"
    [ZT]::Pump(300)
    Drive "window.afterterm.notify.dismissTab('$a'); 'ok'"
    $step = 'dismissed-one-after-the-other'
  }
  $t0 = [Environment]::TickCount
  foreach ($ms in 100, 400, 1200) {
    $wait = $ms - ([Environment]::TickCount - $t0); if ($wait -gt 0) { [ZT]::Pump($wait) }
    Scan $step $i $ms ($ms -eq 400)
  }
  [ZT]::Pump(300)
}
$toastsLeft = Toasts
$rows = @($caps | ForEach-Object { Analyse $_ })
[void][ZT]::DestroyWindow($backdrop)
$fgAfter = [ZT]::GetForegroundWindow()

$rows | Format-Table -AutoSize | Out-String -Width 200
$summary = [pscustomobject]@{
  samples = $rows.Count
  samplesWithWhiteInPadding = @($rows | Where-Object { $_.padWhitePx -gt 0 }).Count
  samplesWithMostlyWhiteRows = @($rows | Where-Object { $_.whiteRows -gt 0 }).Count
  emptySamplesStillVisible = @($rows | Where-Object { $_.step -ne 'second-toast-joins' -and $_.visible }).Count
  toastsLeftAtEnd = $toastsLeft
  foregroundUnchanged = ($fgBefore -eq $fgAfter)
  crops = $cropDir
}
$summary | ConvertTo-Json
$rows | ConvertTo-Json | Set-Content (Join-Path $cropDir 'samples.json')

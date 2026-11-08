# AFT-72 toast hold, the real check: no AFTERTERM_NOTIFY_STATE, so the dev build
# asks Windows through its PowerShell helper. A stand-in for a full-screen app (a
# WinForms form, no border, maximized, TopMost) covers the whole secondary
# display, first shown without being activated, then brought to the front. In
# each phase a toast is pushed through the harness, and the script records what
# Windows answers to this script itself, what the dev build's probe answered and
# whether the overlay is visible. The previous foreground window gets the focus
# back as soon as the activated phase is captured.
#
#   pwsh -File hold-real-check.ps1 -DataDir <harness data dir> -Out <captures folder> -Log <json>
param(
  [Parameter(Mandatory = $true)][string]$DataDir,
  [Parameter(Mandatory = $true)][string]$Out,
  [Parameter(Mandatory = $true)][string]$Log,
  [string]$Repo = 'D:\Pitara\Work\Tinkering\afterterm\.claude\worktrees\notifier-and-display'
)
$ErrorActionPreference = 'Stop'

Add-Type -Namespace HoldReal -Name W -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(System.IntPtr value);
[System.Runtime.InteropServices.DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int state);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, System.IntPtr pid);
[System.Runtime.InteropServices.DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool BringWindowToTop(System.IntPtr h);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetWindowPos(System.IntPtr h, System.IntPtr after, int x, int y, int cx, int cy, uint flags);
'@
[void][HoldReal.W]::SetProcessDpiAwarenessContext([System.IntPtr]::op_Explicit(-4))
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$names = @{ 1 = 'not-present'; 2 = 'busy'; 3 = 'fullscreen'; 4 = 'presentation'; 5 = 'accepts'; 6 = 'quiet-time'; 7 = 'app' }
function Quns { $q = 0; $hr = [HoldReal.W]::SHQueryUserNotificationState([ref]$q); if ($hr -ne 0) { return "hr=$hr" }; return $names[$q] }
function Pump([int]$ms) { $end = [Environment]::TickCount + $ms; while ([Environment]::TickCount -lt $end) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 20 } }
function Drive([string]$js) {
  Push-Location $Repo
  try { $r = node scripts/agent-harness/drive.mjs eval $js --data-dir $DataDir 2>&1 | Out-String } finally { Pop-Location }
  [System.Windows.Forms.Application]::DoEvents()
  return $r.Trim()
}
function Hold { (Drive 'window.afterterm.harness.notifier()') | ConvertFrom-Json }
function Capture([string]$name) {
  $r = pwsh -NoProfile -File (Join-Path $PSScriptRoot 'hold-capture.ps1') -Display 2 -Full (Join-Path $Out "displays\$name.png") -Crop (Join-Path $Out "$name.png")
  [System.Windows.Forms.Application]::DoEvents()
  return $r
}
$entries = New-Object System.Collections.Generic.List[object]
function Note([string]$phase, [string]$what, $data) {
  $e = [ordered]@{ phase = $phase; what = $what; at = (Get-Date).ToString('HH:mm:ss.fff') }
  if ($data) { foreach ($k in $data.Keys) { $e[$k] = $data[$k] } }
  $entries.Add([pscustomobject]$e)
  Write-Output (($e | ConvertTo-Json -Compress -Depth 6))
}
function Sample([string]$phase, [string]$what) {
  $h = Hold
  Note $phase $what ([ordered]@{ windowsToThisScript = (Quns); visible = $h.visible; held = $h.hold.held; toasts = $h.hold.toasts; probes = $h.probes; lastProbe = $h.lastProbe; helperPid = $h.helperPid })
  return $h
}
function Push([string]$tab, [string]$label) {
  [void](Drive "window.afterterm.notify.push({ id: '$tab-' + Date.now(), tabId: '$tab', type: 'done', primaryLabel: '$label', secondaryLabel: 'Toast hold test', projectColor: '#60a5fa', message: 'Finished' }); 'pushed'")
}
function Dismiss([string]$tab) { [void](Drive "window.afterterm.notify.dismissTab('$tab'); 'dismissed'") }

$screen = [System.Windows.Forms.Screen]::AllScreens | Where-Object { -not $_.Primary } | Select-Object -First 1
if (-not $screen) { throw 'no secondary display' }

# Phase 0: nothing in front of afterterm's corner. The first push starts the helper.
Note 'p0' 'start' ([ordered]@{ windowsToThisScript = (Quns) })
Push 'real-p0' 'Nothing full screen'
Pump 1500
[void](Sample 'p0' '1.5 s after the push')
Note 'p0' 'capture' ([ordered]@{ result = (Capture '40-real-check-no-stand-in-toast-shown') })
Dismiss 'real-p0'
Pump 600

# The stand-in: a borderless, maximized, always-on-top form covering the secondary display.
$form = New-Object System.Windows.Forms.Form
$form.FormBorderStyle = 'None'
$form.StartPosition = 'Manual'
$form.Location = $screen.Bounds.Location
$form.Size = $screen.Bounds.Size
$form.TopMost = $true
$form.ShowInTaskbar = $false
$form.BackColor = [System.Drawing.Color]::FromArgb(40, 54, 74)
$form.Text = 'AFT-72 stand-in full-screen window'
$label = New-Object System.Windows.Forms.Label
$label.Text = 'Stand-in full-screen window (AFT-72 test)'
$label.ForeColor = [System.Drawing.Color]::White
$label.Font = New-Object System.Drawing.Font('Segoe UI', 28)
$label.AutoSize = $true
$label.Location = New-Object System.Drawing.Point(80, 80)
$form.Controls.Add($label)

$previous = [HoldReal.W]::GetForegroundWindow()
try {
  # Phase 1: shown over the whole display, not activated (the foreground stays where it
  # was): the window is created, then shown with SetWindowPos(HWND_TOPMOST,
  # SWP_SHOWWINDOW | SWP_NOACTIVATE) at the display's full bounds, taskbar area included.
  $form.CreateControl()
  $hwnd = $form.Handle
  $b = $screen.Bounds
  [void][HoldReal.W]::SetWindowPos($hwnd, [System.IntPtr]::op_Explicit(-1), $b.X, $b.Y, $b.Width, $b.Height, 0x0040 -bor 0x0010)
  Pump 800
  $fg1 = [HoldReal.W]::GetForegroundWindow()
  Note 'p1' 'stand-in up, not in front' ([ordered]@{ formIsForeground = ($fg1 -eq $hwnd); formBounds = "$b"; windowsToThisScript = (Quns) })
  Push 'real-p1' 'Stand-in up, not in front'
  Pump 1500
  [void](Sample 'p1' '1.5 s after the push')
  Note 'p1' 'capture' ([ordered]@{ result = (Capture '41-real-check-stand-in-up-and-foreground-windows-said-accepts-toast-shown') })
  Dismiss 'real-p1'
  Pump 600

  # Phase 2: the stand-in brought to the front (the foreground window).
  $fgThread = [HoldReal.W]::GetWindowThreadProcessId([HoldReal.W]::GetForegroundWindow(), [System.IntPtr]::Zero)
  $me = [HoldReal.W]::GetCurrentThreadId()
  [void][HoldReal.W]::AttachThreadInput($me, $fgThread, $true)
  [void][HoldReal.W]::BringWindowToTop($hwnd)
  [void][HoldReal.W]::SetForegroundWindow($hwnd)
  [void][HoldReal.W]::AttachThreadInput($me, $fgThread, $false)
  Pump 500
  $fg2 = [HoldReal.W]::GetForegroundWindow()
  Note 'p2' 'stand-in brought to the front' ([ordered]@{ formIsForeground = ($fg2 -eq $hwnd); windowsToThisScript = (Quns) })
  Push 'real-p2' 'Stand-in in front'
  Pump 1500
  [void](Sample 'p2' '1.5 s after the push')
  Note 'p2' 'capture' ([ordered]@{ result = (Capture '42-real-check-stand-in-activated-windows-said-accepts-toast-shown') })
  Pump 2500
  [void](Sample 'p2' '4 s after the push, after one poll')
} finally {
  # Give the focus back first, then take the stand-in away.
  [void][HoldReal.W]::SetForegroundWindow($previous)
  $form.Close()
  $form.Dispose()
}

# Phase 3: the stand-in gone; the held toast should show within one poll.
$start = [Environment]::TickCount
$shownAfter = $null
while (([Environment]::TickCount - $start) -lt 5000) {
  $h = Hold
  if ($h.visible) { $shownAfter = [Environment]::TickCount - $start; break }
  Start-Sleep -Milliseconds 150
}
Note 'p3' 'stand-in closed' ([ordered]@{ shownAfterMs = $shownAfter; foregroundRestored = ([HoldReal.W]::GetForegroundWindow() -eq $previous) })
[void](Sample 'p3' 'after the stand-in closed')
Pump 300
Note 'p3' 'capture' ([ordered]@{ result = (Capture '43-real-check-stand-in-closed-toast-shown') })
Dismiss 'real-p2'

$entries | ConvertTo-Json -Depth 6 | Out-File -Encoding utf8 $Log

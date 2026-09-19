# Capture one whole physical display to a PNG.
#
#   pwsh -File scripts/agent-harness/screenshot-display.ps1 -Display 2 -Out shot.png
#
# -Display is 1-based in the order Windows lists screens (1 is normally the
# primary). This is an OS-level capture, so unlike a CDP page screenshot it shows
# the native title bar, the notifier overlay toasts and every other window on that
# display. Used to prove the harness app landed on the right monitor.

param(
  [Parameter(Mandatory = $true)][int]$Display,
  [Parameter(Mandatory = $true)][string]$Out
)

$ErrorActionPreference = 'Stop'

# PowerShell is not DPI-aware by default, so on a scaled primary monitor
# Screen.Bounds would come back in virtualised units and CopyFromScreen would grab
# the wrong (partial) region. Declare per-monitor awareness before touching the
# screen API so every rectangle is in physical pixels.
Add-Type -Namespace Harness -Name Dpi -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool SetProcessDpiAwarenessContext(System.IntPtr value);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool SetProcessDPIAware();
'@
$perMonitorV2 = [System.IntPtr]::op_Explicit(-4)
if (-not [Harness.Dpi]::SetProcessDpiAwarenessContext($perMonitorV2)) {
  [void][Harness.Dpi]::SetProcessDPIAware()
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$screens = [System.Windows.Forms.Screen]::AllScreens
if ($Display -lt 1 -or $Display -gt $screens.Count) {
  throw "Display must be between 1 and $($screens.Count); found: $(($screens | ForEach-Object { $_.DeviceName }) -join ', ')"
}
$screen = $screens[$Display - 1]
$b = $screen.Bounds

$bitmap = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bitmap)
try {
  $g.CopyFromScreen($b.X, $b.Y, 0, 0, $bitmap.Size)
} finally {
  $g.Dispose()
}

$outPath = [System.IO.Path]::GetFullPath($Out)
$dir = [System.IO.Path]::GetDirectoryName($outPath)
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
$bitmap.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()

Write-Output ("{0} primary={1} bounds=({2},{3} {4}x{5}) -> {6}" -f $screen.DeviceName, $screen.Primary, $b.X, $b.Y, $b.Width, $b.Height, $outPath)

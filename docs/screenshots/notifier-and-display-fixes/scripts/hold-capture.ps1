# AFT-72 toast hold test: captures a whole display (kept in displays/, which git
# ignores) and a crop of the bottom-right corner of its work area, where the toast
# overlay sits (kept in the captures folder).
#
#   pwsh -File hold-capture.ps1 -Display 2 -Full <png> -Crop <png>
param(
  [Parameter(Mandatory = $true)][int]$Display,
  [Parameter(Mandatory = $true)][string]$Full,
  [Parameter(Mandatory = $true)][string]$Crop,
  [int]$Width = 420,
  [int]$Height = 320
)
$ErrorActionPreference = 'Stop'
Add-Type -Namespace HoldCap -Name Dpi -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(System.IntPtr value);'
[void][HoldCap.Dpi]::SetProcessDpiAwarenessContext([System.IntPtr]::op_Explicit(-4))
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$screen = [System.Windows.Forms.Screen]::AllScreens[$Display - 1]
$b = $screen.Bounds
$wa = $screen.WorkingArea
$bitmap = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bitmap)
$g.CopyFromScreen($b.X, $b.Y, 0, 0, $bitmap.Size)
$g.Dispose()
foreach ($p in @($Full, $Crop)) { $d = [System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($p)); if (-not (Test-Path $d)) { New-Item -ItemType Directory -Force $d | Out-Null } }
$bitmap.Save([System.IO.Path]::GetFullPath($Full), [System.Drawing.Imaging.ImageFormat]::Png)
# The corner of the work area, relative to the display's own bitmap.
$cx = ($wa.X + $wa.Width) - $b.X - $Width
$cy = ($wa.Y + $wa.Height) - $b.Y - $Height
$rect = New-Object System.Drawing.Rectangle $cx, $cy, $Width, $Height
$part = $bitmap.Clone($rect, $bitmap.PixelFormat)
$part.Save([System.IO.Path]::GetFullPath($Crop), [System.Drawing.Imaging.ImageFormat]::Png)
$part.Dispose(); $bitmap.Dispose()
Write-Output ("{0} work area ({1},{2} {3}x{4}), crop {5},{6} {7}x{8}" -f $screen.DeviceName, $wa.X, $wa.Y, $wa.Width, $wa.Height, $cx, $cy, $Width, $Height)

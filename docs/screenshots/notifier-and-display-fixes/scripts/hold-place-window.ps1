# AFT-72 toast hold test: puts the harness's main window in the bottom-right corner
# of a display's work area, under the toast overlay, without activating it, so the
# crops show the dev build behind the toasts rather than whatever else is there.
#
#   pwsh -File hold-place-window.ps1 -Hwnd <main window handle> -Display 2
param(
  [Parameter(Mandatory = $true)][long]$Hwnd,
  [Parameter(Mandatory = $true)][int]$Display
)
$ErrorActionPreference = 'Stop'
Add-Type -Namespace HoldPlace -Name W -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(System.IntPtr value);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetWindowPos(System.IntPtr h, System.IntPtr after, int x, int y, int cx, int cy, uint flags);
'@
[void][HoldPlace.W]::SetProcessDpiAwarenessContext([System.IntPtr]::op_Explicit(-4))
Add-Type -AssemblyName System.Windows.Forms
$wa = [System.Windows.Forms.Screen]::AllScreens[$Display - 1].WorkingArea
$w = 1280; $h = 780
$x = $wa.X + $wa.Width - $w; $y = $wa.Y + $wa.Height - $h
# HWND_TOP, SWP_NOACTIVATE (0x10) | SWP_NOSIZE not set: move and size.
$ok = [HoldPlace.W]::SetWindowPos([System.IntPtr]::new($Hwnd), [System.IntPtr]::Zero, $x, $y, $w, $h, 0x0010)
Write-Output "moved to $x,$y ${w}x$h : $ok"

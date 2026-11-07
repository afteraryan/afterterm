# Pauses one test Claude Code process for a few seconds, to stand in for a freeze or
# heavy load. Refuses any pid that is not a claude.exe under the given harness electron.
param([int] $ClaudePid, [int] $ElectronPid, [int] $Seconds = 4)
$p = Get-CimInstance Win32_Process -Filter "ProcessId=$ClaudePid"
if (-not $p -or $p.Name -ne 'claude.exe') { throw "pid $ClaudePid is not claude.exe" }
$shell = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ParentProcessId)"
if (-not $shell -or [int]$shell.ParentProcessId -ne $ElectronPid) { throw "pid $ClaudePid is not under the harness electron $ElectronPid" }
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class Nt {
  [DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr h);
  [DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr h);
}
'@
$proc = [Diagnostics.Process]::GetProcessById($ClaudePid)
# Starting pwsh and compiling the type above takes a few seconds, so a caller that
# samples the app "during" the pause must go by these times, not by when it ran this
# script (found 2026-11-07: a sample taken 2.5 s after starting it came before the pause).
# Write-Host goes out at once, so a caller reading the output as it comes sees the start.
[void][Nt]::NtSuspendProcess($proc.Handle)
$t0 = Get-Date
Write-Host "suspended claude.exe $ClaudePid at $($t0.ToString('HH:mm:ss.fff'))"
try { Start-Sleep -Seconds $Seconds }
finally { [void][Nt]::NtResumeProcess($proc.Handle) }
"resumed claude.exe $ClaudePid at $((Get-Date).ToString('HH:mm:ss.fff')), paused {0:N1}s" -f ((Get-Date) - $t0).TotalSeconds

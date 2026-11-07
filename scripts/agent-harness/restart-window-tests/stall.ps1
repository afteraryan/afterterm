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
[void][Nt]::NtSuspendProcess($proc.Handle)
Start-Sleep -Seconds $Seconds
[void][Nt]::NtResumeProcess($proc.Handle)
"paused claude.exe $ClaudePid for ${Seconds}s, resumed"

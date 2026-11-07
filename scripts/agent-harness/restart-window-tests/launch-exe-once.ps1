# Runs the exact packaged 0.15.0 exe from the 2026-11-06 incident once, reports what
# it did to a Claude settings file, and kills only the pid it started.
param(
  [Parameter(Mandatory)] [string] $Exe,           # the packaged afterterm.exe to run
  [Parameter(Mandatory)] [string] $Name,          # test name, the data dir is named after it
  [string] $PrefsJson = '{"claudeHookToastShown":true}',
  [string] $ClaudeDir = '',                       # becomes CLAUDE_CONFIG_DIR when given
  [string] $ScratchHome = '',                     # becomes USERPROFILE and HOME when given
  [int] $HoldSeconds = 6,
  [string] $WatchSettings = ''                    # the settings file to report on
)
if ($PrefsJson -match 'disabled' -and -not $ClaudeDir) { throw 'An opt-out needs -ClaudeDir <scratch>: a scratch home does not protect the real settings.' }
$real = "$env:USERPROFILE\.claude\settings.json"
$realScript = "$env:USERPROFILE\.claude\hooks\afterterm-notify.ps1"
$beforeReal = (Get-FileHash $real).Hash
$beforeScript = (Get-FileHash $realScript).Hash
$DD = "$env:TEMP\afterterm-agent-harness\rw-$Name"
New-Item -ItemType Directory -Force $DD | Out-Null
$PrefsJson | Set-Content "$DD\prefs.json" -Encoding ascii
$beforeWatch = if ($WatchSettings -and (Test-Path $WatchSettings)) { (Get-Item $WatchSettings).LastWriteTime } else { $null }
$env:AFTERTERM_USER_DATA_DIR = $DD
$env:AFTERTERM_DISPLAY = 'secondary'
$env:AFTERTERM_HARNESS = '1'
Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue
if ($ClaudeDir) { $env:CLAUDE_CONFIG_DIR = $ClaudeDir }
if ($ScratchHome) { $env:USERPROFILE = $ScratchHome; $env:HOME = $ScratchHome }
$t0 = Get-Date
$p = Start-Process -FilePath $Exe -WorkingDirectory $DD -PassThru
Start-Sleep -Seconds $HoldSeconds
& taskkill.exe /PID $p.Id /T /F 2>&1 | Out-Null
"[$Name] started $($t0.ToString('HH:mm:ss')), pid $($p.Id), killed after ${HoldSeconds}s"
if ($WatchSettings) {
  if (Test-Path $WatchSettings) {
    $i = Get-Item $WatchSettings
    $j = Get-Content $WatchSettings -Raw | ConvertFrom-Json
    $ev = if ($j.hooks) { @($j.hooks.PSObject.Properties.Name) } else { @() }
    "[$Name] watched file written at $($i.LastWriteTime.ToString('HH:mm:ss')) (changed: $($i.LastWriteTime -ne $beforeWatch))"
    "[$Name] hook events now: [$($ev -join ', ')]"
    "[$Name] hooks json: $(($j.hooks | ConvertTo-Json -Compress -Depth 8))"
    "[$Name] other keys kept: $((@($j.PSObject.Properties.Name) | Where-Object { $_ -ne 'hooks' }) -join ', ')"
  } else { "[$Name] watched file does not exist" }
}
"[$Name] REAL settings unchanged: $($beforeReal -eq (Get-FileHash $real).Hash)"
"[$Name] REAL hook script unchanged: $($beforeScript -eq (Get-FileHash $realScript).Hash)"
"[$Name] prefs after: $((Get-Content "$DD\prefs.json" -Raw) -replace '\s+',' ')"

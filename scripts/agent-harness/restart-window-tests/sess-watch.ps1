# NOTE: this reads the real sessions folder ($env:USERPROFILE\.claude\sessions) by design, and skips the .key files beside the records. An agent must not run it unless reading the real records is the intent.
# Logs every change in Claude Code's own per-process records for sessions started in
# the test folder. Reads only <pid>.json, never the .key files beside them.
param([string] $Cwd, [string] $Out, [int] $Seconds = 900)
$dir = "$env:USERPROFILE\.claude\sessions"
$last = @{}
$end = (Get-Date).AddSeconds($Seconds)
while ((Get-Date) -lt $end) {
  foreach ($f in [IO.Directory]::GetFiles($dir, '*.json')) {
    if ($f -notmatch '\\\d+\.json$') { continue }
    try { $j = [IO.File]::ReadAllText($f) | ConvertFrom-Json -ErrorAction Stop } catch { continue }
    if ("$($j.cwd)" -notlike "$Cwd*") { continue }
    $sid = "$($j.sessionId)"
    $key = "status=$($j.status) session=$($sid.Substring(0,[Math]::Min(8,$sid.Length))) kind=$($j.kind)"
    if ($last["$($j.pid)"] -ne $key) {
      $last["$($j.pid)"] = $key
      "$((Get-Date).ToString('HH:mm:ss.f')) pid=$($j.pid) $key" | Add-Content -LiteralPath $Out
    }
  }
  Start-Sleep -Milliseconds 200
}

# Live hooks test, driven carefully: every prompt is sent only when the screen shows
# Claude's plain input box and no dialog, otherwise the test stops and prints the screen.
param([string] $DD, [string] $Rw, [string] $Tab)
function dr { node scripts/agent-harness/drive.mjs @args --data-dir $DD }
$log = "$Rw\hook-fired.log"
$local = "$Rw\cwd-hot\.claude\settings.local.json"
function count { if (Test-Path $log) { @(Get-Content $log).Count } else { 0 } }
function ready {
  $s = (dr tail 8 --tab $Tab) -join "`n"
  if ($s -match 'Esc to cancel|Enter to confirm|Enter to continue|to change|1\. Yes') { "NOT READY, a dialog is up:`n$s"; return $false }
  if ($s -notmatch 'manual mode on') { "NOT READY, no manual mode line:`n$s"; return $false }
  return $true
}
function stage([string] $word) {
  $r = ready
  if ($r -ne $true) { $r; exit 2 }
  $b = count
  dr type "Say only the word $word." | Out-Null
  dr key Enter | Out-Null
  Start-Sleep -Seconds 10
  "  hook lines fired for this prompt: $((count) - $b)"
}
Copy-Item "$Rw\hot-on.json" $local -Force
if (Test-Path $log) { Clear-Content $log }
"starting Claude"
dr type "claude --setting-sources local --model haiku --strict-mcp-config --permission-mode default" | Out-Null
dr key Enter | Out-Null
Start-Sleep -Seconds 10
"--- stage 1: hooks on from the start ---"
stage 'one'
"--- stage 2: hooks removed from the file while the chat runs ---"
Copy-Item "$Rw\hot-off.json" $local -Force
Start-Sleep -Seconds 5
stage 'two'
"--- stage 3: hooks put back while the chat runs ---"
Copy-Item "$Rw\hot-on.json" $local -Force
Start-Sleep -Seconds 5
stage 'three'
"--- stage 4: another turn, to be sure ---"
stage 'four'
"--- the screen ---"
dr tail 16 --tab $Tab
"--- full hook log ---"
Get-Content $log

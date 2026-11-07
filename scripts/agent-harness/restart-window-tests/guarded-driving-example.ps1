# The last two checks, with a hard guard: nothing is typed unless the target thread is
# confirmed active on screen, in manual mode, with no dialog up. Any failure aborts.
param([string] $DD, [string] $Rw)
$ErrorActionPreference = 'Stop'
function dr { node scripts/agent-harness/drive.mjs @args --data-dir $DD }
function abort([string] $why) { "ABORT: $why"; exit 2 }
function activate([string] $tab) {
  # Opens the fold first, so the row exists, then clicks it and reads back which is active.
  dr eval "(() => { const more = [...document.querySelectorAll('.side-panel *')].find(e => e.children.length === 0 && /^Show \d+ more/.test((e.innerText||'').trim())); if (more) more.click(); return !!more; })()" | Out-Null
  Start-Sleep -Milliseconds 400
  $n = (dr eval "document.querySelectorAll('.th[data-tid=$tab]').length") -replace '"',''
  if ($n -ne '1') { abort "row for $tab not found ($n)" }
  dr click ".th[data-tid=$tab]" | Out-Null
  Start-Sleep -Milliseconds 500
  $isActive = (dr eval "window.__afterterm.tab('$tab') && document.querySelector('.th[data-tid=$tab]').className") -replace '"',''
  "row classes for ${tab}: $isActive"
}
function guardTyping([string] $tab) {
  $header = (dr eval "(() => { const e = document.querySelector('.th.sel'); return e ? e.dataset.tid : ''; })()") -replace '"',''
  if ($header -ne $tab) { abort "active thread is '$header', expected $tab" }
  $s = (dr tail 8 --tab $tab) -join "`n"
  if ($s -match 'Esc to cancel|Enter to confirm|Enter to continue|to change|1\. Yes|esc to interrupt') { abort "$tab has a dialog or is busy:`n$s" }
  if ($s -notmatch 'manual mode on') { abort "$tab is not in manual mode:`n$s" }
}
function recordFor([string] $cwdLike) {
  foreach ($f in [IO.Directory]::GetFiles("$env:USERPROFILE\.claude\sessions", '*.json')) {
    if ($f -notmatch '\\\d+\.json$') { continue }
    $j = [IO.File]::ReadAllText($f) | ConvertFrom-Json
    if ("$($j.cwd)" -like $cwdLike) { "pid=$($j.pid) session=$($j.sessionId) status=$($j.status)" }
  }
}

"=== does the record follow /clear? (tab-7) ==="
activate 'tab-7'
guardTyping 'tab-7'
"before /clear: $(recordFor "$Rw\cwd-hot*")"
dr type "/clear" | Out-Null
Start-Sleep -Milliseconds 400
dr key Enter | Out-Null
Start-Sleep -Seconds 4
"after /clear:  $(recordFor "$Rw\cwd-hot*")"
dr tail 5 --tab tab-7 | Select-Object -First 2

"=== a hidden thread: does working hold for a whole real turn? (tab-9) ==="
activate 'tab-9'
guardTyping 'tab-9'
dr type "Run exactly this command with your shell tool and nothing else: ping -n 22 127.0.0.1" | Out-Null
dr key Enter | Out-Null
Start-Sleep -Milliseconds 700
activate 'tab-4'
Start-Sleep -Seconds 34
$log = (dr eval "window.__rw.log.filter(l => l.includes('tab-9 ')).slice(-6).join('|')") -replace '"',''
$log -split '\|\s*(?=\d)' | ForEach-Object { $_.Trim() }

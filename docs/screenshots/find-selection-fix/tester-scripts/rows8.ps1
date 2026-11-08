# Tester script (scratch): row 8, switch to another thread and back, then search and drag again. Writers run in both threads.
$s = 'C:\Users\Aryan\AppData\Local\Temp\claude\fa0123314555e1c0\a0efc8aa-7861-41bd-83eb-c902edfef41f\scratchpad\tester-find-selection'
$d = "$s\d.ps1"
$o = "$s\out\t7"
New-Item -ItemType Directory -Force $o | Out-Null
$log = "$o\row8-log.txt"
function StateExpr($tab) { "(() => { const sel = window.__afterterm.selection('$tab') ?? {has:false,text:''}; const other = window.__afterterm.selection('$($tab -eq 'tab-1' ? 'tab-2' : 'tab-1')') ?? {has:false,text:''}; return { activeRow: document.querySelector('.side-panel .th.sel')?.dataset.tid, bars: document.querySelectorAll('.find-bar').length, focus: document.activeElement.className, count: document.querySelector('.find-count')?.textContent ?? null, input: document.querySelector('.find-input')?.value ?? null, '$tab hasSel': sel.has, '$tab selLen': sel.text.length, '$tab selStart': sel.text.slice(0, 24), 'other hasSel': other.has, 'other selLen': other.text.length, lastRow: (window.__afterterm.tail('$tab', 1) ?? [])[0] }; })()" }
function Show($tab, $label) { "--- $label" | Tee-Object -Append $log; & $d eval (StateExpr $tab) | Tee-Object -Append $log }
function Drag($tab, $from, $to, $reads, $prefix) {
  node "$s\tdrag.mjs" "$s\data" $tab --from $from[0] $from[1] --to $to[0] $to[1] --reads $reads --shots "$o\$prefix" 2>&1 | ForEach-Object { if ($_ -match '^\+') { $_.Substring(0, [Math]::Min(120, $_.Length)) + ' ... ' + $_.Substring([Math]::Max(0, $_.Length - 45)) } else { $_ } } | Tee-Object -Append $log
}
function ClickTerm { $i = & $d eval "[...document.querySelectorAll('.xterm-screen')].findIndex(e => e.getBoundingClientRect().width > 0)"; & $d click ".xterm-screen" $i | Out-Null }
function Search { & $d key f --ctrl --shift | Out-Null; Start-Sleep -Milliseconds 500; & $d key a --ctrl | Out-Null; Start-Sleep -Milliseconds 200; & $d type "blue" | Out-Null; Start-Sleep -Milliseconds 400; & $d key Enter | Out-Null; Start-Sleep -Milliseconds 800 }

"=== row 8 on a69503f, $(Get-Date -Format o)" | Tee-Object $log
# Setup: tab-2 awake with output and a writer (not recorded)
& $d click ".side-panel .th" 1 | Out-Null; Start-Sleep -Milliseconds 800
Show 'tab-2' 'setup: tab-2 selected (asleep pane expected)'
& $d click "[data-wake]" 0 | Out-Null; Start-Sleep -Seconds 3
Show 'tab-2' 'setup: tab-2 awake'
ClickTerm
& $d type "for /L %i in (1,1,30) do @echo row %i red green blue yellow orange violet" | Out-Null
& $d key Enter | Out-Null; Start-Sleep -Seconds 2
& $d type "powershell -NoProfile -File $s\tick-plain.ps1" | Out-Null
& $d key Enter | Out-Null; Start-Sleep -Seconds 3
Show 'tab-2' 'setup: tab-2 has output and a writer'
& $d click ".side-panel .th" 0 | Out-Null; Start-Sleep -Milliseconds 800
Show 'tab-1' 'setup: back on tab-1'

& $d record start --out "$o\row8.mp4"
# 8a: bar open with a live search on tab-1, then switch to tab-2
ClickTerm
Search
Show 'tab-1' '8a: tab-1 bar open, search live'
& $d screenshot "$o\row8a-tab1-search-live.png" | Out-Null
& $d click ".side-panel .th" 1 | Out-Null; Start-Sleep -Milliseconds 800
Show 'tab-2' '8a: after switching to tab-2 (bar must be closed)'
& $d screenshot "$o\row8b-tab2-after-switch-bar-closed.png" | Out-Null

# 8b: search and drag in tab-2
ClickTerm
Search
Show 'tab-2' '8b: tab-2 bar open, search live'
Drag 'tab-2' @('row 10 ', 5) @('row 14 ', 20) '0,1000,3000' 'row8c-tab2-drag'
Show 'tab-2' '8b: tab-2 after the reads'

# 8c: back to tab-1, drag with no search, then search and drag again
& $d click ".side-panel .th" 0 | Out-Null; Start-Sleep -Milliseconds 800
Show 'tab-1' '8c: back on tab-1 (bar must be closed)'
& $d screenshot "$o\row8d-tab1-after-return.png" | Out-Null
Drag 'tab-1' @('row 20 ', 5) @('row 24 ', 20) '0,1000,3000' 'row8e-tab1-drag-no-search'
Show 'tab-1' '8c: tab-1 after a drag with no search'
Search
Show 'tab-1' '8c: tab-1 searched again, bar open'
Drag 'tab-1' @('row 6 ', 5) @('row 9 ', 20) '0,1000,3000' 'row8f-tab1-drag-after-second-search'
Show 'tab-1' '8c: tab-1 after the reads'
& $d screenshot "$o\row8g-tab1-final.png" | Out-Null

& $d record stop | Out-Null
"=== done $(Get-Date -Format o)" | Tee-Object -Append $log

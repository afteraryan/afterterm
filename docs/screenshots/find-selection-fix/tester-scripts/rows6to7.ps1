# Tester script (scratch): rows 6 (right-click copy, Ctrl+C copy) and 7 (Ctrl+Shift+A with a live search), writer running.
$s = 'C:\Users\Aryan\AppData\Local\Temp\claude\fa0123314555e1c0\a0efc8aa-7861-41bd-83eb-c902edfef41f\scratchpad\tester-find-selection'
$d = "$s\d.ps1"
$o = "$s\out\t6"
New-Item -ItemType Directory -Force $o | Out-Null
$log = "$o\rows6to7-log.txt"
$state = "(() => { const sel = window.__afterterm.selection('tab-1'); const c = window.__copied ?? null; return { bars: document.querySelectorAll('.find-bar').length, focus: document.activeElement.className, count: document.querySelector('.find-count')?.textContent ?? null, input: document.querySelector('.find-input')?.value ?? null, hasSel: sel.has, selLen: sel.text.length, selStart: sel.text.slice(0, 30), selPos: sel.position, copyCount: window.__copyCount ?? null, copiedLen: c === null ? null : c.length, copiedEqualsSel0: c !== null && window.__sel0 !== undefined ? c === window.__sel0 : null, copiedStart: c === null ? null : c.slice(0, 30), lastRow: window.__afterterm.tail('tab-1', 1)[0] }; })()"
function Show($label) { "--- $label" | Tee-Object -Append $log; & $d eval $state | Tee-Object -Append $log }
function Drag($from, $to, $reads, $prefix) {
  node "$s\tdrag.mjs" "$s\data" tab-1 --from $from[0] $from[1] --to $to[0] $to[1] --reads $reads --shots "$o\$prefix" 2>&1 | ForEach-Object { if ($_ -match '^\+') { $_.Substring(0, [Math]::Min(150, $_.Length)) + ' ... ' + $_.Substring([Math]::Max(0, $_.Length - 40)) } else { $_ } } | Tee-Object -Append $log
}
function Remember { & $d eval "window.__sel0 = window.__afterterm.selection('tab-1').text; window.__copied = null; window.__sel0.length" | Tee-Object -Append $log }

"=== rows 6 and 7 on a69503f, $(Get-Date -Format o)" | Tee-Object $log
& $d record start --out "$o\rows6to7.mp4"

# Row 6a: bar closed, drag, right-click
Show 'row 6a: start (bar closed, no selection expected)'
Drag @('row 10 ', 5) @('row 14 ', 20) '0' 'row6a-drag'
Remember
& $d rightclick ".xterm-screen" 0 | Tee-Object -Append $log
Start-Sleep -Milliseconds 400
Show 'row 6a: after right-click (copied should equal the selection, selection cleared)'
& $d screenshot "$o\row6a-after-right-click.png" | Out-Null

# Row 6b: bar open with a live search, drag, right-click
& $d key f --ctrl --shift | Out-Null; Start-Sleep -Milliseconds 500
& $d key a --ctrl | Out-Null; Start-Sleep -Milliseconds 200
& $d type "blue" | Out-Null; Start-Sleep -Milliseconds 400
& $d key Enter | Out-Null; Start-Sleep -Milliseconds 800
Show 'row 6b: bar open, search for blue live'
Drag @('row 20 ', 5) @('row 24 ', 20) '0,1500' 'row6b-drag'
Remember
& $d rightclick ".xterm-screen" 0 | Tee-Object -Append $log
Start-Sleep -Milliseconds 400
Show 'row 6b: after right-click with the bar open'
& $d screenshot "$o\row6b-after-right-click-bar-open.png" | Out-Null

# Row 6c: Ctrl+C with a selection copies it and does not stop the writer
Drag @('row 6 ', 5) @('row 9 ', 20) '0' 'row6c-drag'
Remember
& $d key c --ctrl | Tee-Object -Append $log
Start-Sleep -Milliseconds 400
Show 'row 6c: after Ctrl+C (copied should equal the selection; writer must still tick)'
Start-Sleep -Milliseconds 1500
Show 'row 6c: 1.5 s later (writer still ticking?)'

# Row 7: Ctrl+Shift+A with a live search
& $d click ".find-input" 0 | Out-Null
& $d key Enter | Out-Null; Start-Sleep -Milliseconds 600
Show 'row 7: bar open, search live again (Enter in the box)'
& $d screenshot "$o\row7-a-search-live-before-select-all.png" | Out-Null
& $d eval "document.querySelector('.xterm-helper-textarea').focus(); document.activeElement.className" | Tee-Object -Append $log
& $d key a --ctrl --shift | Out-Null; Start-Sleep -Milliseconds 300
Show 'row 7: right after Ctrl+Shift+A'
& $d screenshot "$o\row7-b-select-all-0ms.png" | Out-Null
Start-Sleep -Milliseconds 1000
Show 'row 7: 1 s after'
Start-Sleep -Milliseconds 2000
Show 'row 7: 3 s after'
& $d screenshot "$o\row7-c-select-all-3s.png" | Out-Null
& $d eval "[window.__afterterm.tail('tab-1', 1)[0], document.querySelector('.find-count')?.textContent]" | Tee-Object -Append $log

& $d record stop | Out-Null
"=== done $(Get-Date -Format o)" | Tee-Object -Append $log


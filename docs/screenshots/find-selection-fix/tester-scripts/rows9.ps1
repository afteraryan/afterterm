# Tester script (scratch): row 9, with a search live over output the first right-click copies the match and the second pastes.
$s = 'C:\Users\Aryan\AppData\Local\Temp\claude\fa0123314555e1c0\a0efc8aa-7861-41bd-83eb-c902edfef41f\scratchpad\tester-find-selection'
$d = "$s\d.ps1"
$o = "$s\out\t8"
New-Item -ItemType Directory -Force $o | Out-Null
$log = "$o\row9-log.txt"
$state = "(() => { const sel = window.__afterterm.selection('tab-1'); const c = window.__copied ?? null; return { activeRow: document.querySelector('.side-panel .th.sel')?.dataset.tid, bars: document.querySelectorAll('.find-bar').length, focus: document.activeElement.className, count: document.querySelector('.find-count')?.textContent ?? null, hasSel: sel.has, selText: sel.text.slice(0, 30), copyCount: window.__copyCount ?? null, copied: c === null ? null : c.slice(0, 30), lastRow: window.__afterterm.tail('tab-1', 1)[0] }; })()"
function Show($label) { "--- $label" | Tee-Object -Append $log; & $d eval $state | Tee-Object -Append $log }
function VisIdx { & $d eval "[...document.querySelectorAll('.xterm-screen')].findIndex(e => e.getBoundingClientRect().width > 0)" }
"=== row 9 on a69503f, $(Get-Date -Format o)" | Tee-Object $log
& $d record start --out "$o\row9.mp4"
Show 'row 9: start (bar closed, writer shows typed=[] )'
$i = VisIdx
& $d click ".xterm-screen" $i | Out-Null
& $d key f --ctrl --shift | Out-Null; Start-Sleep -Milliseconds 500
& $d key a --ctrl | Out-Null; Start-Sleep -Milliseconds 200
& $d type "blue" | Out-Null; Start-Sleep -Milliseconds 400
& $d key Enter | Out-Null; Start-Sleep -Milliseconds 800
& $d eval "window.__copied = null; window.__copyCount = 0; 'reset'" | Out-Null
Show 'row 9: bar open, search live, the match is selected'
& $d screenshot "$o\row9a-search-live-match-selected.png" | Out-Null
& $d rightclick ".xterm-screen" $i | Out-Null; Start-Sleep -Milliseconds 400
Show 'row 9: after the FIRST right-click (match copied, selection cleared)'
Start-Sleep -Milliseconds 1500
Show 'row 9: 1.5 s later, writer has written 3 more times (selection must still be empty)'
& $d screenshot "$o\row9b-after-first-right-click.png" | Out-Null
& $d rightclick ".xterm-screen" $i | Out-Null; Start-Sleep -Milliseconds 1200
Show 'row 9: after the SECOND right-click (nothing copied again, PASTE-MARK reached the writer)'
& $d screenshot "$o\row9c-after-second-right-click-pasted.png" | Out-Null
& $d record stop | Out-Null
"=== done $(Get-Date -Format o)" | Tee-Object -Append $log

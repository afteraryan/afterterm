# Tester script (scratch): rows 2 to 5 in one go, under one recording, while the writer runs.
$s = 'C:\Users\Aryan\AppData\Local\Temp\claude\fa0123314555e1c0\a0efc8aa-7861-41bd-83eb-c902edfef41f\scratchpad\tester-find-selection'
$d = "$s\d.ps1"
$o = "$s\out\t5"
New-Item -ItemType Directory -Force $o | Out-Null
$state = "(() => { const sel = window.__afterterm.selection('tab-1'); return { bars: document.querySelectorAll('.find-bar').length, focus: document.activeElement.className, count: document.querySelector('.find-count')?.textContent ?? null, input: document.querySelector('.find-input')?.value ?? null, selText: sel.text.length > 60 ? sel.text.slice(0, 40) + '...(' + sel.text.length + ' chars)' : sel.text, selPos: sel.position, lastRow: window.__afterterm.tail('tab-1', 1)[0] }; })()"
function Show($label) { "--- $label"; & $d eval $state }

"=== rows 2 to 5, take 5 on a69503f, $(Get-Date -Format o)" | Tee-Object "$o\rows2to5-log.txt"
& $d record start --out "$o\rows2to5.mp4"

# Row 2: search, bar open, drag-select, read right away, after 1 s and after 3 s
& $d key f --ctrl --shift | Out-Null; Start-Sleep -Milliseconds 400
& $d key a --ctrl | Out-Null; Start-Sleep -Milliseconds 200
& $d type "blue" | Out-Null; Start-Sleep -Milliseconds 400
& $d key Enter | Out-Null; Start-Sleep -Milliseconds 800
Show 'row 2: bar open, search for blue done' | Tee-Object -Append "$o\rows2to5-log.txt"
& $d screenshot "$o\row2-a-bar-open-after-search.png" | Out-Null
"--- row 2: drag-select row 10 col 5 to row 14 col 20, bar open" | Tee-Object -Append "$o\rows2to5-log.txt"
node "$s\tdrag.mjs" "$s\data" tab-1 --from "row 10 " 5 --to "row 14 " 20 --reads 0,1000,3000 --shots "$o\row2-b-drag" 2>&1 | Tee-Object -Append "$o\rows2to5-log.txt"
Show 'row 2: state after the reads' | Tee-Object -Append "$o\rows2to5-log.txt"

# Row 3: Enter in the find bar again
& $d click ".find-input" 0 | Out-Null
"--- row 3: Enter in the find bar" | Tee-Object -Append "$o\rows2to5-log.txt"
& $d key Enter | Out-Null; Start-Sleep -Milliseconds 400
Show 'row 3: after first Enter' | Tee-Object -Append "$o\rows2to5-log.txt"
& $d screenshot "$o\row3-a-after-enter.png" | Out-Null
& $d key Enter | Out-Null; Start-Sleep -Milliseconds 400
Show 'row 3: after second Enter' | Tee-Object -Append "$o\rows2to5-log.txt"
Start-Sleep -Milliseconds 2000
Show 'row 3: two seconds later' | Tee-Object -Append "$o\rows2to5-log.txt"

# Row 4: close with Esc from the box, drag-select
"--- row 4: Esc in the find box" | Tee-Object -Append "$o\rows2to5-log.txt"
& $d key Escape | Out-Null; Start-Sleep -Milliseconds 500
Show 'row 4: bar closed with Esc' | Tee-Object -Append "$o\rows2to5-log.txt"
& $d screenshot "$o\row4-a-bar-closed-with-esc.png" | Out-Null
node "$s\tdrag.mjs" "$s\data" tab-1 --from "row 20 " 5 --to "row 24 " 20 --reads 0,1000,3000 --shots "$o\row4-b-drag" 2>&1 | Tee-Object -Append "$o\rows2to5-log.txt"
Show 'row 4: state after the reads' | Tee-Object -Append "$o\rows2to5-log.txt"

# Row 5: reopen, search, close with the x, drag-select
"--- row 5: reopen the bar, search, close with the x button" | Tee-Object -Append "$o\rows2to5-log.txt"
& $d key f --ctrl --shift | Out-Null; Start-Sleep -Milliseconds 500
Show 'row 5: bar reopened (text kept?)' | Tee-Object -Append "$o\rows2to5-log.txt"
& $d key a --ctrl | Out-Null; Start-Sleep -Milliseconds 200
& $d type "blue" | Out-Null; Start-Sleep -Milliseconds 400
& $d key Enter | Out-Null; Start-Sleep -Milliseconds 800
Show 'row 5: Enter pressed, search live' | Tee-Object -Append "$o\rows2to5-log.txt"
& $d screenshot "$o\row5-a-bar-open-search-live.png" | Out-Null
& $d click ".find-btn[title^='Close']" 0 | Out-Null; Start-Sleep -Milliseconds 500
Show 'row 5: bar closed with the x' | Tee-Object -Append "$o\rows2to5-log.txt"
& $d screenshot "$o\row5-b-bar-closed-with-x.png" | Out-Null
node "$s\tdrag.mjs" "$s\data" tab-1 --from "row 6 " 5 --to "row 9 " 20 --reads 0,1000,3000 --shots "$o\row5-c-drag" 2>&1 | Tee-Object -Append "$o\rows2to5-log.txt"
Show 'row 5: state after the reads' | Tee-Object -Append "$o\rows2to5-log.txt"

& $d record stop | Out-Null
"=== done $(Get-Date -Format o)" | Tee-Object -Append "$o\rows2to5-log.txt"


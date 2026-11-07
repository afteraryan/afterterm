# Runs one real Claude with another notify hook registered alongside afterterm's, and
# reports whether afterterm still gets its working state. Guards every keystroke.
param([string] $DD, [string] $Rw, [string] $Tab, [string] $Settings, [string] $Shot)
function dr { node scripts/agent-harness/drive.mjs @args --data-dir $DD }
function screenHasDialog { $s = (dr tail 8 --tab $Tab) -join "`n"; return ($s -match 'Esc to cancel|Enter to confirm|Enter to continue|to change|1\. Yes') }
dr key t --ctrl --shift | Out-Null
Start-Sleep -Milliseconds 600
dr key Enter | Out-Null
Start-Sleep -Seconds 2
dr type "cd /d `"$Rw\cwd`" & set CLAUDE_CONFIG_DIR=& claude --setting-sources local --settings `"$Settings`" --model haiku --strict-mcp-config --permission-mode default --allowedTools `"Bash(ping:*)`"" | Out-Null
dr key Enter | Out-Null
Start-Sleep -Seconds 11
if (screenHasDialog) { "NOT READY:"; dr tail 12 --tab $Tab; exit 2 }
dr type "Run exactly this command with your shell tool and nothing else: ping -n 25 127.0.0.1" | Out-Null
dr key Enter | Out-Null
Start-Sleep -Seconds 10
"--- on screen ---"
dr tail 5 --tab $Tab
"--- what afterterm believes, mid-reply ---"
dr eval "(() => { const t = window.__afterterm.tab('$Tab'); return { title: t.title, notification: t.notification, hasId: !!t.claudeSessionId }; })()"
"--- restart window ---"
dr click "[data-update-button]" | Out-Null
Start-Sleep -Milliseconds 700
dr dom "[data-restart-rows] .tr" | Select-Object -Last 1
dr dom ".up-dstat" | Select-Object -Last 1
dr screenshot $Shot | Out-Null
dr click ".up-dfoot .b.q.s" | Out-Null
"--- state changes for this thread ---"
(dr eval "window.__rw.log.filter(l => l.includes('$Tab ')).join('|')") -replace '"','' -split '\|\s*(?=\d)' | Where-Object { $_ -match 's tab-' } | ForEach-Object { $_.Trim() }

# Tester writer: rewrites one row in place twice a second for 10 minutes, no scrolling. No search word in the row.
1..1200 | ForEach-Object { [Console]::Write("`rlive writer tick $_ ok   "); Start-Sleep -Milliseconds 500 }

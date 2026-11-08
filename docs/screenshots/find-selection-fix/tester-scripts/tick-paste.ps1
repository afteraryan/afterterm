# Tester writer: rewrites one row twice a second and shows anything typed or pasted into the terminal, so a paste is visible.
$typed = ''
1..1200 | ForEach-Object {
  while ([Console]::KeyAvailable) { $k = [Console]::ReadKey($true); $typed += $k.KeyChar }
  [Console]::Write("`rlive writer tick $_ typed=[$typed]   ")
  Start-Sleep -Milliseconds 500
}

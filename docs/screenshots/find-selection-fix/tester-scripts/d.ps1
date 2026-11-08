# Tester wrapper: drive.mjs against my own data dir only.
$wt = 'D:\Pitara\Work\Tinkering\afterterm\.claude\worktrees\find-selection'
$data = 'C:\Users\Aryan\AppData\Local\Temp\claude\fa0123314555e1c0\a0efc8aa-7861-41bd-83eb-c902edfef41f\scratchpad\tester-find-selection\data'
node "$wt\scripts\agent-harness\drive.mjs" @args --data-dir $data

# Stands in for another tool's notify hook: reads the payload and sets its own title,
# the same way afterterm's hook does.
[Console]::In.ReadToEnd() | Out-Null
'{"terminalSequence":"\u001b]0;OTHER HOOK TITLE\u0007"}'
exit 0

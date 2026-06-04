<#
test-afterterm-notify.ps1  —  self-contained test harness for the bundled hook.

Runs afterterm-notify.ps1 as a real subprocess (exactly how Claude Code invokes
it), feeds crafted hook payloads on stdin, and asserts the emitted OSC-0 title.
No afterterm, no Claude Code, no human needed — just `pwsh -File` this.

Exit code 0 = all pass, 1 = a failure (so CI / a build step can gate on it).
#>

$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'afterterm-notify.ps1'

$E_ALERT = [char]0x26A0; $E_DONE = [char]0x2705; $E_HOUR = [char]0x23F3
$E_COMP  = [char]0x2699; $E_WORK = [char]0x25B6
$ESC = [char]27; $BEL = [char]7

$pass = 0; $fail = 0

# Run the hook as a subprocess with a given AFTERTERM value + stdin payload.
# Returns the raw stdout string.
function Invoke-Hook {
    param([string]$Json, [string]$Afterterm = '1')
    $prev = $env:AFTERTERM
    if ($null -eq $Afterterm) { Remove-Item Env:AFTERTERM -ErrorAction SilentlyContinue }
    else { $env:AFTERTERM = $Afterterm }
    try {
        $out = $Json | & pwsh -NoProfile -File $script
    } finally {
        if ($null -eq $prev) { Remove-Item Env:AFTERTERM -ErrorAction SilentlyContinue }
        else { $env:AFTERTERM = $prev }
    }
    return ($out -join "`n")
}

# Decode stdout JSON -> the title text between ESC]0; and the trailing BEL(s).
function Get-Title {
    param([string]$Out)
    if ([string]::IsNullOrWhiteSpace($Out)) { return $null }
    $seq = ($Out | ConvertFrom-Json).terminalSequence
    if (-not $seq) { return $null }
    $t = $seq -replace "^$([regex]::Escape($ESC))\]0;", ''
    return $t.TrimEnd($BEL)
}

function Assert-Title {
    param([string]$Name, [string]$Json, [string]$Expected, [string]$Afterterm = '1')
    $title = Get-Title (Invoke-Hook -Json $Json -Afterterm $Afterterm)
    if ($title -eq $Expected) {
        Write-Host "  PASS  $Name" -ForegroundColor Green
        $script:pass++
    } else {
        Write-Host "  FAIL  $Name" -ForegroundColor Red
        Write-Host "        expected: [$Expected]"
        Write-Host "        actual:   [$title]"
        $script:fail++
    }
}

function Assert-Empty {
    param([string]$Name, [string]$Json, [string]$Afterterm = '1')
    $out = Invoke-Hook -Json $Json -Afterterm $Afterterm
    if ([string]::IsNullOrWhiteSpace($out)) {
        Write-Host "  PASS  $Name" -ForegroundColor Green
        $script:pass++
    } else {
        Write-Host "  FAIL  $Name (expected no output)" -ForegroundColor Red
        Write-Host "        actual: [$out]"
        $script:fail++
    }
}

$cwd = 'C:\\Tinkering\\afterterm'   # -> project "afterterm"

Write-Host "`nafterterm-notify.ps1 tests`n"

# 1. The gate: no AFTERTERM -> complete no-op, whatever the event.
Assert-Empty 'gate: no output when AFTERTERM unset' `
    "{`"hook_event_name`":`"Stop`",`"cwd`":`"$cwd`"}" -Afterterm $null

# 2. SessionStart -> bare project name, no glyph.
Assert-Title 'SessionStart -> baseline project title' `
    "{`"hook_event_name`":`"SessionStart`",`"cwd`":`"$cwd`"}" `
    'afterterm'

# 3. UserPromptSubmit -> working spinner.
Assert-Title 'UserPromptSubmit -> working' `
    "{`"hook_event_name`":`"UserPromptSubmit`",`"cwd`":`"$cwd`"}" `
    "$E_WORK afterterm - working"

# 4. Notification (permission_prompt), NOT auto -> needs permission.
Assert-Title 'Notification (manual) -> needs permission' `
    "{`"hook_event_name`":`"Notification`",`"cwd`":`"$cwd`",`"permission_mode`":`"default`"}" `
    "$E_ALERT afterterm - needs permission"

# 5. Notification while in AUTO mode -> suppressed entirely.
Assert-Empty 'Notification (auto) -> suppressed' `
    "{`"hook_event_name`":`"Notification`",`"cwd`":`"$cwd`",`"permission_mode`":`"auto`"}"

# 6. Stop, nothing running -> clean done.
Assert-Title 'Stop (clean) -> done' `
    "{`"hook_event_name`":`"Stop`",`"cwd`":`"$cwd`"}" `
    "$E_DONE afterterm - done"

# 7. Stop with 2 running background tasks -> bg count.
$bg = "{`"hook_event_name`":`"Stop`",`"cwd`":`"$cwd`",`"background_tasks`":[" +
      "{`"status`":`"running`",`"description`":`"build`"}," +
      "{`"status`":`"running`",`"description`":`"watch`"}," +
      "{`"status`":`"completed`",`"description`":`"old`"}]}"
Assert-Title 'Stop (2 running, 1 completed) -> bg (2 running)' $bg `
    "$E_HOUR afterterm - bg (2 running)"

# 8. Stop where a running task + a cron are both live -> counted together.
$bgcron = "{`"hook_event_name`":`"Stop`",`"cwd`":`"$cwd`"," +
          "`"background_tasks`":[{`"status`":`"running`",`"description`":`"build`"}]," +
          "`"session_crons`":[{`"id`":`"c1`"}]}"
Assert-Title 'Stop (1 task + 1 cron) -> bg (2 running)' $bgcron `
    "$E_HOUR afterterm - bg (2 running)"

# 9. PreCompact -> compacting.
Assert-Title 'PreCompact -> compacting' `
    "{`"hook_event_name`":`"PreCompact`",`"cwd`":`"$cwd`"}" `
    "$E_COMP afterterm - compacting"

# 10. Empty stdin -> no output, no crash.
Assert-Empty 'empty stdin -> no output' ''

# 11. Garbage stdin -> no output, no crash.
Assert-Empty 'invalid JSON -> no output' 'not json at all'

# 12. Missing cwd -> falls back, still emits a title (project from process cwd).
$noCwd = Get-Title (Invoke-Hook "{`"hook_event_name`":`"SessionStart`"}")
if (-not [string]::IsNullOrWhiteSpace($noCwd)) {
    Write-Host "  PASS  missing cwd -> still emits a title ($noCwd)" -ForegroundColor Green
    $pass++
} else {
    Write-Host "  FAIL  missing cwd -> emitted nothing" -ForegroundColor Red
    $fail++
}

Write-Host "`n$pass passed, $fail failed`n"
exit ([int]($fail -gt 0))

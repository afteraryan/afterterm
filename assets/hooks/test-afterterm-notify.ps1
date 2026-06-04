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
# Optionally sets the per-tab session-capture env (AFTERTERM_TAB_ID / _SESSION_DIR).
# Returns the raw stdout string.
function Invoke-Hook {
    param([string]$Json, [string]$Afterterm = '1', [string]$TabId, [string]$SessionDir)
    $prev = $env:AFTERTERM; $prevTab = $env:AFTERTERM_TAB_ID; $prevDir = $env:AFTERTERM_SESSION_DIR
    if ($null -eq $Afterterm) { Remove-Item Env:AFTERTERM -ErrorAction SilentlyContinue } else { $env:AFTERTERM = $Afterterm }
    if ($TabId)      { $env:AFTERTERM_TAB_ID = $TabId }       else { Remove-Item Env:AFTERTERM_TAB_ID -ErrorAction SilentlyContinue }
    if ($SessionDir) { $env:AFTERTERM_SESSION_DIR = $SessionDir } else { Remove-Item Env:AFTERTERM_SESSION_DIR -ErrorAction SilentlyContinue }
    try {
        $out = $Json | & pwsh -NoProfile -File $script
    } finally {
        if ($null -eq $prev)    { Remove-Item Env:AFTERTERM -ErrorAction SilentlyContinue }             else { $env:AFTERTERM = $prev }
        if ($null -eq $prevTab) { Remove-Item Env:AFTERTERM_TAB_ID -ErrorAction SilentlyContinue }      else { $env:AFTERTERM_TAB_ID = $prevTab }
        if ($null -eq $prevDir) { Remove-Item Env:AFTERTERM_SESSION_DIR -ErrorAction SilentlyContinue } else { $env:AFTERTERM_SESSION_DIR = $prevDir }
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

# ── Session capture file channel (resume-on-restart) ──────────────────────────
# The hook writes <AFTERTERM_SESSION_DIR>\<AFTERTERM_TAB_ID>.json = { sessionId, cwd }
# so afterterm can `claude --resume` it next launch. Independent of the title channel.
$sid = '11111111-2222-3333-4444-555555555555'
$cwdDecoded = 'C:\Tinkering\afterterm'   # $cwd after JSON unescaping
$tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ("afterterm-test-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null

function Assert-SessionFile {
    param([string]$Name, [string]$Json, [string]$TabId, [string]$ExpectedSid, [string]$ExpectedCwd)
    $f = Join-Path $tmpDir "$TabId.json"
    Remove-Item $f -ErrorAction SilentlyContinue
    Invoke-Hook -Json $Json -TabId $TabId -SessionDir $tmpDir | Out-Null
    if (-not (Test-Path $f)) { Write-Host "  FAIL  $Name (no file written)" -ForegroundColor Red; $script:fail++; return }
    $obj = Get-Content $f -Raw | ConvertFrom-Json
    if ($obj.sessionId -eq $ExpectedSid -and $obj.cwd -eq $ExpectedCwd) {
        Write-Host "  PASS  $Name" -ForegroundColor Green; $script:pass++
    } else {
        Write-Host "  FAIL  $Name" -ForegroundColor Red
        Write-Host "        expected: [$ExpectedSid;$ExpectedCwd]"
        Write-Host "        actual:   [$($obj.sessionId);$($obj.cwd)]"
        $script:fail++
    }
}

function Assert-NoSessionFile {
    param([string]$Name, [string]$Json, [string]$TabId, [string]$SessionDir, [string]$Afterterm = '1')
    $f = Join-Path $tmpDir "$TabId.json"
    Remove-Item $f -ErrorAction SilentlyContinue
    Invoke-Hook -Json $Json -TabId $TabId -SessionDir $SessionDir -Afterterm $Afterterm | Out-Null
    if (-not (Test-Path $f)) { Write-Host "  PASS  $Name" -ForegroundColor Green; $script:pass++ }
    else { Write-Host "  FAIL  $Name (file unexpectedly written)" -ForegroundColor Red; $script:fail++ }
}

# 13. SessionStart with session_id + tab env -> writes <tabId>.json with id + cwd.
Assert-SessionFile 'SessionStart -> writes session file' `
    "{`"hook_event_name`":`"SessionStart`",`"cwd`":`"$cwd`",`"session_id`":`"$sid`"}" 'tab-1' $sid $cwdDecoded

# 14. (Re)written on every title-emitting event, e.g. Stop — refreshes each turn.
Assert-SessionFile 'Stop -> refreshes session file' `
    "{`"hook_event_name`":`"Stop`",`"cwd`":`"$cwd`",`"session_id`":`"$sid`"}" 'tab-2' $sid $cwdDecoded

# 15. The title channel is unchanged by the file write.
Assert-Title 'SessionStart (+session_id) -> title still clean' `
    "{`"hook_event_name`":`"SessionStart`",`"cwd`":`"$cwd`",`"session_id`":`"$sid`"}" 'afterterm'

# 16. No session_id -> nothing to capture, no file.
Assert-NoSessionFile 'no session_id -> no file' `
    "{`"hook_event_name`":`"SessionStart`",`"cwd`":`"$cwd`"}" 'tab-3' $tmpDir

# 17. No AFTERTERM_SESSION_DIR (not launched by afterterm) -> no file.
Assert-NoSessionFile 'no session-dir env -> no file' `
    "{`"hook_event_name`":`"SessionStart`",`"cwd`":`"$cwd`",`"session_id`":`"$sid`"}" 'tab-4' ''

# 18. Gate still wins: AFTERTERM unset -> no file even with the tab env present.
Assert-NoSessionFile 'gate: AFTERTERM unset -> no file' `
    "{`"hook_event_name`":`"SessionStart`",`"cwd`":`"$cwd`",`"session_id`":`"$sid`"}" 'tab-5' $tmpDir $null

Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "`n$pass passed, $fail failed`n"
exit ([int]($fail -gt 0))

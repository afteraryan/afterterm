<#
afterterm-notify.ps1  —  Claude Code notification hook, afterterm edition.

This is the SELF-CONTAINED hook that afterterm ships and registers into a
user's ~/.claude/settings.json. Its only job is to decorate the terminal tab
TITLE on Claude Code state transitions. afterterm's renderer parses those
title prefixes (✅ ⚠ ⏳ ⚙ ▶) off the PTY stream and drives the in-app overlay
toasts + sidebar indicators.

It deliberately does NOT spawn Windows popups. The full notify.ps1 on a dev
machine does both (popup outside afterterm, title inside); the distributable
only ever needs the in-afterterm behavior, so the popup path — and its
popup.vbs / wscript dependency — is dropped. One file, no siblings.

GATE: the very first thing this does is exit 0 unless AFTERTERM=1. afterterm
sets AFTERTERM=1 on every PTY it spawns. So even though this hook is
registered GLOBALLY, it is a complete no-op in the user's other terminals —
zero output, zero latency, zero popups. It only wakes up inside afterterm.

States (event -> title emitted):
  SessionStart                       -> "<project>"                      (baseline)
  UserPromptSubmit                   -> "▶ <project> - working"          (spinner)
  Notification (permission_prompt)   -> "⚠ <project> - needs permission" (+ bell)
  Stop, background_tasks running > 0 -> "⏳ <project> - bg (N running)"
  Stop, nothing running              -> "✅ <project> - done"
  PreCompact                         -> "⚙ <project> - compacting"

Auto-mode: when the live permission_mode is "auto", Claude Code auto-approves
permission requests itself, so the permission prompt is noise — suppressed
entirely (no title). Every other state is a real transition and still fires.
#>

$ErrorActionPreference = 'Continue'

# --- GATE: no-op outside afterterm -------------------------------------------
if ($env:AFTERTERM -ne '1') { exit 0 }

# Force UTF-8 stdout so the state glyphs survive whichever PowerShell host CC
# invokes. Windows PowerShell 5.1 defaults to the OEM codepage, which would
# mangle ✅/⚠/⏳/⚙/▶ before afterterm reads them; pwsh 7 is already UTF-8. This
# line makes the hook host-agnostic either way.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

# --- Read the hook event payload from stdin -----------------------------------
$stdinText = [Console]::In.ReadToEnd()
if (-not $stdinText) { exit 0 }

try {
    $payload = $stdinText | ConvertFrom-Json -ErrorAction Stop
} catch {
    exit 0
}

$event   = [string]$payload.hook_event_name
$cwd     = if ($payload.cwd) { [string]$payload.cwd } else { (Get-Location).Path }
$project = Split-Path -Leaf $cwd
if (-not $project) { $project = 'session' }

# Live permission mode travels in every hook payload, so Shift+Tab toggles are
# honored even when settings.json's default differs. Missing -> not auto (the
# more verbose, fail-safe branch).
$IsAutoMode = ($payload.permission_mode -eq 'auto')

# Claude Code stamps every hook payload with the active session UUID. afterterm uses
# it to resume this exact session after an app restart (`claude --resume <id>` is the
# rename-proof key, and it is cwd-scoped, so the cwd matters too). Empty if absent.
$SessionId = if ($payload.session_id) { [string]$payload.session_id } else { '' }

# --- Report the session id + cwd to afterterm (resume-on-restart) --------------
# This deliberately does NOT use the terminalSequence/title channel: when the user
# also has another notify hook registered, Claude Code writes only the FIRST hook's
# terminal output and silently drops ours — so the title channel can't carry this.
# Instead afterterm hands us a private per-tab file path via env (AFTERTERM_TAB_ID +
# AFTERTERM_SESSION_DIR) and we write the mapping straight to disk.
# Completely inert when the env isn't set (i.e. not launched by this afterterm).
#
# ONLY user-turn events may claim the tab (see $CaptureEvents). Claude Code runs a
# shared background daemon that pre-spawns throwaway "spare" sessions, and that
# daemon inherits AFTERTERM_TAB_ID / AFTERTERM_SESSION_DIR from whichever PTY first
# started it. Those spares fire SessionStart, so capturing on SessionStart let a
# spare overwrite the tab's real mapping with its own id. A retired spare never
# writes a transcript, so the next launch ran `claude --resume <id>` against a
# session that does not exist. A spare is never handed a user prompt and never
# finishes a turn, so gating on UserPromptSubmit/Stop keeps it out entirely while
# the real session refreshes the mapping on every turn.
$CaptureEvents = @('UserPromptSubmit', 'Stop')

if ($SessionId -and $CaptureEvents -contains $event -and
    $env:AFTERTERM_TAB_ID -and $env:AFTERTERM_SESSION_DIR) {
    try {
        $sessFile = Join-Path $env:AFTERTERM_SESSION_DIR ($env:AFTERTERM_TAB_ID + '.json')
        @{ sessionId = $SessionId; cwd = $cwd } | ConvertTo-Json -Compress |
            Set-Content -Path $sessFile -Encoding UTF8 -NoNewline
    } catch {}
}

# State glyphs. Kept in the BMP / Dingbats range so they render without
# surrogate-pair trouble across terminals.
$E_ALERT = [char]0x26A0  # ⚠ permission needed
$E_DONE  = [char]0x2705  # ✅ clean done
$E_HOUR  = [char]0x23F3  # ⏳ background tasks running
$E_COMP  = [char]0x2699  # ⚙ compacting
$E_WORK  = [char]0x25B6  # ▶ working

$ESC = [char]27
$BEL = [char]7

function Emit-Title {
    param([string]$Title, [bool]$RingBell = $false)
    $seq = "$ESC]0;$Title$BEL"
    if ($RingBell) { $seq += $BEL }
    # CC schema: terminalSequence is a TOP-LEVEL field. It is written to the
    # PTY verbatim; afterterm reads the OSC-0 title back out of the stream.
    @{ terminalSequence = $seq } | ConvertTo-Json -Compress
}

switch ($event) {
    'SessionStart' {
        Emit-Title -Title $project
    }

    'UserPromptSubmit' {
        Emit-Title -Title "$E_WORK $project - working"
    }

    'Notification' {
        # settings.json matcher restricts this to permission_prompt. In auto
        # mode CC handles the approval itself, so there is nothing to surface.
        if (-not $IsAutoMode) {
            Emit-Title -Title "$E_ALERT $project - needs permission" -RingBell $true
        }
    }

    'Stop' {
        # Count only background_tasks still "running"; the array can carry
        # completed/failed entries we don't want to alarm on. Add any
        # session-scoped crons still scheduled.
        $runningTasks = @()
        if ($payload.background_tasks) {
            $runningTasks = @($payload.background_tasks | Where-Object { $_.status -eq 'running' })
        }
        $cronCount = if ($payload.session_crons) { @($payload.session_crons).Count } else { 0 }
        $total = $runningTasks.Count + $cronCount

        if ($total -gt 0) {
            Emit-Title -Title "$E_HOUR $project - bg ($total running)"
        } else {
            Emit-Title -Title "$E_DONE $project - done"
        }
    }

    'PreCompact' {
        Emit-Title -Title "$E_COMP $project - compacting"
    }

    default {
        # Unknown event: nothing to do.
    }
}

exit 0

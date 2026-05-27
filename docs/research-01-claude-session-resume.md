# Claude Session Resume: Research Findings

**Date:** 2026-05-28
**Branch:** `feature/claude-session-resume`
**Status:** Research only — no code yet

---

## Goal

When afterterm closes and reopens, automatically resume Claude Code sessions that were active. The user shouldn't have to remember session names or type resume commands.

## Claude Code Session Storage

Sessions live at:
```
%USERPROFILE%\.claude\projects\<project-dir-hash>\<session-id>.jsonl
```

### Directory naming

The project directory hash is the CWD with path separators and colons replaced by dashes:
- `D:\Tinkering\afterterm` → `D--Tinkering-afterterm`
- `C:\Users\devac` → `C--Users-devac`

### JSONL structure

Each session is a `.jsonl` file named `<session-uuid>.jsonl`. Lines are JSON objects with a `type` field:

| type | description | example |
|---|---|---|
| `mode` | Session creation metadata | `{"type":"mode","sessionId":"5c5850fb-..."}` |
| `permission-mode` | Permission mode (auto/manual) | |
| `file-history-snapshot` | Files known at start | |
| `user` | User message | |
| `assistant` | Assistant response | |
| `custom-title` | **Session rename** | `{"type":"custom-title","customTitle":"afterterm-begins","sessionId":"5c5850fb-..."}` |
| `last-prompt` | Bookmark to last prompt position | `{"type":"last-prompt","leafUuid":"...","sessionId":"..."}` |

### Getting the current session name

The **last** `custom-title` event in the JSONL has the current name. If no `custom-title` exists, the session was never renamed — use the session UUID as the resume identifier.

### Resume commands

```
claude --resume "afterterm-begins"     # by name
claude --resume 5c5850fb-...           # by UUID
claude --resume                        # most recent session for CWD (picker if ambiguous)
```

## Claude Code Hook System

Aryan's hook at `C:\Users\devac\.claude\hooks\notify.ps1` fires on these events:

| Event | When | What the hook does |
|---|---|---|
| `SessionStart` | Claude session begins | Sets tab title to project name (last CWD segment) |
| `Notification` | Permission prompt | Sets title to `⚠ project - needs permission`, spawns popup |
| `Stop` | Turn ends | Sets title to `✅ project - done` or `⏳ project - bg (N running)` |
| `PreCompact` | Context compaction | Sets title to `⚙ project - compacting` |

### Hook payload fields (observed)

```json
{
  "hook_event_name": "Stop",
  "cwd": "D:\\Tinkering\\afterterm",
  "permission_mode": "auto",
  "message": "...",
  "background_tasks": [{ "status": "running", "description": "..." }],
  "session_crons": [...]
}
```

### What's NOT in the hook payload (needs investigation)

- **`session_id`** — does the payload include the active session UUID? Would eliminate the need to read JSONL files.
- **`session_name` / `custom_title`** — does it include the current session name if renamed?
- **Other events** — `UserPromptSubmit`, `PostToolUse`, `PreToolUse`, `PostToolBatch` exist but aren't wired in the current hook. Could they be useful?

## TODO: Investigate further

1. **Full hook payload schema**: Run a test hook that dumps the raw payload for each event type. Check if `session_id` or `session_name` are included. If so, afterterm can capture session identity from the title sequence without reading JSONL files.

2. **Hook events not currently used**: `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolBatch` — what's in their payloads? Could be useful for activity detection (knowing if Claude is actively working vs idle).

3. **`Stop` event timing**: Does `Stop` fire when the user closes the terminal, or only on clean exits? If it fires on terminal close, afterterm could capture the session ID at that moment.

4. **Multiple Claude sessions in one project**: If two tabs both run Claude in the same CWD, the JSONL approach gets ambiguous. Need to figure out how to match tab → session when there are multiple active sessions for one project directory.

5. **Claude Code CLI flags**: Does `claude --resume` accept a `--cwd` flag? Could afterterm resume from any directory by pointing at the project path?

## Proposed Implementation (when ready)

1. **Detect claude tabs**: Match tab title against hook patterns (`✅`, `⚠`, `⏳`, `⚙` prefixes, or bare project names that match the CWD's last segment)
2. **On close**: For each claude tab, derive the project dir hash from CWD, find the most recent JSONL, read the last `custom-title` event (or use session UUID)
3. **Save in session.json**: `{ ..., resumeCommand: "claude --resume \"afterterm-begins\"" }`
4. **On restore**: For tabs with a `resumeCommand`, send it to the PTY after the shell starts

### Open question

Should afterterm auto-resume Claude sessions silently, or show a prompt? Auto-resume is smoother but could be surprising if the user doesn't want to resume. A middle ground: show the resume command in the scrollback snapshot (so the user sees it) and auto-execute after a brief delay with a "press Ctrl+C to cancel" note.

# Claude Code Hooks — Notes (UNVERIFIED, parked)

**Status:** parked / low priority · **Date:** 2026-05-29

> ⚠️ These notes come from an agent's web research, not from the installed Claude Code. Aryan doesn't fully trust them and they're not a priority right now. **Verify every event name/payload field against the actual installed CC version before relying on any of this** — hook event names have changed across versions, and a wrong name silently no-ops.

## Why this was investigated

The working spinner starts on `UserPromptSubmit` and stops on `Stop`, but `Stop` fires at a turn boundary, not at "all work done" — so the spinner can stop while Claude is still running. We wanted to know if other hooks give a more reliable "working vs idle" signal. (See the spinner bug in `bugs.md`.)

## Core takeaway

A reliable "actively working" signal is a small **state machine** driven by tool/subagent hooks, not the prompt/stop pair:

- `PreToolUse` → working
- `PostToolBatch` → still working if more batches come (once per parallel batch; lighter than `PostToolUse` which fires per tool)
- `SubagentStart` / `SubagentStop` → track background agents
- `Stop` → done **only if** no tools pending AND no subagents running; otherwise keep spinning
- plus a ~5s quiet-timeout safety net to clear a stuck spinner

**Tradeoff (why we didn't already do this):** `PreToolUse`/`PostToolBatch` fire on every tool call/batch, each spawning a fresh `pwsh` (~300–500ms cold start) — many more hook invocations per turn than today's one-per-Enter.

## Hooks that looked useful (verify before use)

- `PermissionRequest` — richer than `Notification`/`permission_prompt`; reportedly carries `tool_name` + `tool_input`, so a permission toast could say *what* is being asked.
- `SubagentStart` / `SubagentStop` — know when background work is running.
- Turn duration = timestamp diff between prompt start and real done.
- Tool payloads reportedly carry `effort.level`, `cwd`, `permission_mode`, `transcript_path`, `session_id`.

## Currently wired (for reference)

`~/.claude/hooks/notify.ps1` on: SessionStart, Notification (matcher `permission_prompt`), Stop, PreCompact, UserPromptSubmit. Emits OSC title prefixes (`▶ ✅ ⚠ ⏳ ⚙`) parsed by afterterm. `terminalSequence` is a root-level hook output field (not inside `hookSpecificOutput`).

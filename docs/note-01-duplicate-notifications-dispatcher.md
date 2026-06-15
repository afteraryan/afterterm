# Note — Duplicate Claude notifications inside afterterm, and the dispatcher fix

**Date:** 2026-06-04 · **Status:** fixed on the dev machine (settings.json only); **codebase install-hook still needs updating** (see bottom).

## Symptom

Inside afterterm, finishing a Claude Code turn produced **two** notifications at once:

1. A **Windows MessageBox popup** (the "normal terminal" notification), and
2. The **afterterm in-app overlay toast**.

Only the overlay should appear while inside afterterm. On another laptop the same
setup showed only **one** (the overlay), which is the desired behavior.

## Root cause

The dev machine's `~/.claude/settings.json` had **two hook entries registered per
event** — both fired on every event:

| Script | What it does inside afterterm |
|---|---|
| `~/.claude/hooks/notify.ps1` | Always pops a **Windows MessageBox** (+ emits a title). It has **no** `AFTERTERM` awareness — there is no `if ($env:AFTERTERM ...)` guard anywhere in it. So it pops even inside afterterm. |
| `~/.claude/hooks/afterterm-notify.ps1` | Emits **only** the tab-title decoration that drives afterterm's overlay. Gated on `AFTERTERM=1`; a no-op outside afterterm. No popup. |

Because both were registered, inside afterterm you got the popup (`notify.ps1`)
**and** the overlay (`afterterm-notify.ps1`).

**Important correction to an earlier assumption:** `notify.ps1` does **not**
"route to the overlay and suppress its popup inside afterterm." That was wrong —
verified by reading the file. It is the plain popup hook with zero afterterm
awareness. The two scripts are independent: one = popup, the other = overlay.

### Why the other laptop showed only one

Its `settings.json` registered **only** `notify.ps1` (no `afterterm-notify.ps1`).
For it to show the overlay-and-not-a-popup inside afterterm, that machine's
`notify.ps1` must be a **different, afterterm-aware variant** (with the
`AFTERTERM` guard baked in). We never read that file, so this is inferred, not
confirmed — but it's the only consistent explanation.

## Fix applied (config only — no .ps1 files touched)

`settings.json` hooks have **no native if/else** — the `matcher` field only
filters on event/tool subtype (e.g. `permission_prompt`), never on env vars. So
the branch was put **inside the hook `command`** as a one-line dispatcher,
collapsing the two entries per event into one:

```jsonc
{
  "type": "command",
  "command": "pwsh",
  "args": [
    "-NoProfile",
    "-Command",
    "if ($env:AFTERTERM -eq '1') { & 'C:\\Users\\Aryan\\.claude\\hooks\\afterterm-notify.ps1' } else { & 'C:\\Users\\Aryan\\.claude\\hooks\\notify.ps1' }"
  ]
}
```

- Inside afterterm (`AFTERTERM=1`) → only `afterterm-notify.ps1` runs → overlay only, no popup.
- Normal terminal → only `notify.ps1` runs → Windows popup, as before.
- `UserPromptSubmit` uses the same idea but with no `else` (only afterterm needs the `▶ working` spinner).

**stdin passthrough:** Claude Code pipes the event JSON to the command's stdin.
The dispatcher `pwsh` doesn't read stdin itself; it calls the chosen script with
`&`, which runs in the same process so `[Console]::In.ReadToEnd()` in the child
reads the inherited stdin. Confirmed by test.

Applied via `Write` to `C:\Users\Aryan\.claude\settings.json`. Backup of the
pre-change (doubled) file kept at
`C:\Users\Aryan\.claude\settings.json.bak-before-dispatcher`.

### Test results (all passed)

| Test | Condition | Output | Verdict |
|---|---|---|---|
| 1 | Inside afterterm, `Stop` | `✅ afterterm - done` | only afterterm hook ran — no popup |
| 2 | Normal terminal, `SessionStart` | `afterterm` baseline | only `notify.ps1` ran |
| 3 | Inside afterterm, `SessionStart` | `afterterm` baseline | afterterm hook |
| 4 | Inside afterterm, fake cwd `MyCoolProject` | `✅ MyCoolProject - done` | stdin payload genuinely reached the child |

Tested by invoking the exact dispatcher command directly (what CC runs), not a
full live turn. User confirmed the live afterterm app now shows a single
notification.

## TODO — update the self-install hook system to use this approach

`src/claude-hook-install.ts` (`reconcileClaudeHook`) is currently **additive**:
it merges `afterterm-notify.ps1` entries **alongside** whatever the user already
has. On a machine that already runs its own `notify.ps1` (popup) hook, that's
exactly what produces the double notification above.

The install system should adopt the **dispatcher pattern** instead of blindly
adding a second entry:

- Register **one** dispatcher entry per event that branches on `AFTERTERM`,
  rather than a standalone `afterterm-notify.ps1` entry that coexists with the
  user's popup hook.
- Decide what the `else` branch points at: the user's existing hook if present,
  or nothing if not. Must stay **idempotent** and must not clobber the user's own
  hooks (same guarantees `reconcileClaudeHook` already makes).
- Keep the `prefs.json` opt-out and the surgical-removal path working with the
  new single-entry shape.

See also `docs/bugs.md` and the Notification System section in `CLAUDE.md`.

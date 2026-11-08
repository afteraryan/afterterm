# Background and compacting states: self-test captures (2026-11-08)

AFT-25, AFT-43 (background stays while the work runs) and AFT-42 (compacting ends when a compaction is cancelled), branch `fix-background-and-compacting-states`.

## How the test was run

- The dev build from the branch through the agent harness, on the secondary display (`drive bounds`: DISPLAY2, primary false), port 9341, its own data dir and an empty scratch `CLAUDE_CONFIG_DIR`. The real `settings.json` and hook script were hashed before the launch, after it and after the stop, and did not change.
- No Claude Code was started. A seeded project "States test" with two PowerShell 7 threads, "Chat with an agent" and "Other thread". A small script in the thread's folder wrote the same titles the notify hook writes (`./title work`, `bg`, `done`, `compact`, and `plain`, an undecorated title, since a terminal reports a title only when it changes):

```powershell
param([string]$kind)
if ($kind -eq 'plain') { [Console]::Write("$([char]27)]0;work-folder$([char]7)"); return }
$glyph = @{ bg = [char]0x23F3; done = [char]0x2705; compact = [char]0x2699; work = [char]0x25B6; perm = [char]0x26A0 }[$kind]
$text = @{ bg = 'bg (1 running)'; done = 'done'; compact = 'compacting'; work = 'working'; perm = 'needs permission' }[$kind]
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::Write("$([char]27)]0;$glyph work-folder - $text$([char]7)")
```

- `document.hasFocus` was stubbed to return true in the page, standing in for a focused window, so a title on the thread on screen took the "being looked at" path (the harness window had focus anyway when checked). State was read with `drive sidebar`, `header`, `rail`, `home` and `window.__afterterm.tab('tab-1')`, and from rows 7 to 9 with an in-page sampler of the thread's state every 50 ms.
- The whole run is one recording: `00-whole-test-background-and-compacting-states.mp4`.

## Results

| Row | What was done | What was seen | Captures | Result |
|---|---|---|---|---|
| 1 | On "Chat with an agent", on screen: `work` then `bg` | Row `[shell/background]` with the hourglass, project pill `bg=1`, header chip "Background tasks", `notification: background`, `backgroundTasks: true`. Before the fix this path cleared the hourglass at once (AFT-25; seen in `../background-tasks-fix/05-after-the-fix-viewed-thread-shows-no-background-spinner.png`, the 2026-09-25 change that made it so) | 01 | Pass |
| 2 | Opened "Other thread", then the chat again | Hourglass on the chat's row while away and after coming back (AFT-43) | 02, 03 | Pass |
| 3 | 7 s of silence, then `Get-Date` in the chat and 4 s more | Still background (neither silence window touches it) | 04 | Pass |
| 4 | `done` on the chat on screen | Quiet at once, `backgroundTasks` cleared | 05 | Pass |
| 5 | `work; Start-Sleep 3; bg` in the chat, then "Other thread" opened at once | The hourglass arrived on the chat's row while away; opening the chat kept it | 06, 07 | Pass |
| 6 | `work` (a new turn over background work), then Esc | Working, then background again at once | 08, 09 | Pass |
| 7 | `done`, then `compact`, then Esc | Compacting on the row, the header and the rail tile's corner; quiet at once on Esc, tile gone | 10, 11 | Pass |
| 8 | `plain`, then `compact`, then nothing | Sampler: compacting at 0.69 s, quiet at 6.70 s, about 5 s after the prompt's last output (no record in this run, so the silence rule ended it). Still compacting at 2.6 s, past the working state's 2.5 s window | 12, 13 | Pass |
| 9 | `bg`, `compact`, then Esc | Compacting, then background (the work is still running), not quiet | 14, 15 | Pass |
| 10 | Home | The project's hourglass pill and the total `bg=1` | 16 | Pass |

The first try at row 8 typed `compact` right after row 7's `compact`: the title did not change, so no title event came and the thread stayed quiet. That is how a terminal reports titles, not the change under test; the `plain` step was added for the retry.

## Not tested here

- A real Claude Code: no background agent, no real compaction and no session record were run. The record's part (busy holds compacting, idle ends it) is covered by unit tests only.
- The rail: it has never shown background (Aryan's decision with PR #40), and this change leaves that as it was.

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

## Round 2 (2026-11-09): the shell's prompt ends background work

After review 1 of PR #90 the background work flag also clears when the thread's shell shows its own prompt again (the Claude has gone). That breaks the method above: `./title bg` typed at a PowerShell prompt returns to the prompt at once, so the hourglass now ends as soon as it starts. **Rows 1 to 10 above were run before this rule; to repeat them now, hold the prompt while writing the titles**, for example `./title plain; ./title bg; Start-Sleep 600`, and end the command (Ctrl+C) to stand in for the Claude going away.

Same harness set-up as above (port 9341, its own data dir, scratch `CLAUDE_CONFIG_DIR`, `document.hasFocus` stubbed, the real files' hashes unchanged before, during and after, with the `settings.json` hash Aryan's edit of 2026-11-09 gave it). State sampled in the page every 40 ms. One recording: `62-whole-test-the-shell-prompt-ends-background.mp4`.

| Row | What was done | What was seen | Captures | Result |
|---|---|---|---|---|
| 11 (first try) | `./title bg` at the prompt | The hourglass stayed with the shell back at its prompt. The ⏳ title and the prompt's mark came in one batch of output, and the first version of the rule read the flag from the last render, where it was still unset. Fixed by deciding inside the state update (`endBackgroundWork` in `useTabState.ts`) | 60, 61 | Fail, fixed |
| 11 | The same, after the fix | Sampler: the ⏳ title arrives with the prompt (1.01 s) and the thread stays quiet with no flag; the hourglass never shows on a plain shell | 63 | Pass |
| 12 | `./title plain; ./title bg; Start-Sleep 600` | Hourglass on the row, the pill and the header while the command holds the prompt; still there after opening "Other thread" and coming back, 6 s later | 64, 65 | Pass |
| 13 | Ctrl+C ends the command | The prompt is back and the hourglass goes at once (`atPrompt` true, no flag) | 66 | Pass |
| 14 | `Start-Sleep 600`, then `__afterterm.setNotification('tab-1', 'background')` | `notification: background` and `backgroundTasks: true`; still there 3.5 s later; Ctrl+C then clears both | 67 | Pass |

The review's two busy-record cases need a record that says busy, which only a real Claude Code gives: an agent's permission prompt answered with Enter (back to the hourglass once the main turn has ended, since review 2 only then) is unit-tested only (`spinnerState.test.ts`), and a `/compact` that finishes while an agent runs is a known gap (compacting stays until the agent's report turn), also in the unit tests.

## Not tested here

- A real Claude Code: no background agent, no real compaction and no session record were run. The record's part (busy holds compacting, idle ends it) is covered by unit tests only.
- The rail: it has never shown background (Aryan's decision with PR #40), and this change leaves that as it was.

# Tester's report: the hourglass stays while background work runs, and a cancelled compaction clears (2026-11-08)

AFT-25, AFT-43 and AFT-42, branch `fix-background-and-compacting-states`, tested at commit `29ae7ae` (the branch as it stood on 2026-11-08 at 22:55). The later fix round commits (`a820e9f`, `a02ee23`, `93407c8`, all made on 2026-11-09 after this run ended) were not tested here; "Round 2 live rows" at the end tests the branch at `00dba51`, which has them.

## Every row passed, including the real Claude Code run

All eleven rows were run to the end on 2026-11-08 between 22:56 and 23:08. The run was not cut off: the harness was stopped and the hashes checked at 23:08; only this report was written later.

## How the test was run

- The dev build from the worktree through the agent harness, on the secondary display (`drive bounds`: DISPLAY2, primary false), port 9363, data dir `tester-thread-states`, an empty scratch `CLAUDE_CONFIG_DIR`, and `AFTERTERM_CLAUDE_SESSIONS_DIR` pointed at the real Claude sessions folder (read only) so the session record reader could see the Claude in Part B. `document.hasFocus()` was true in the page, so a title on the thread on screen took the "being looked at" path.
- Fixture: one project "States test" with two asleep chats ("Chat one", "Chat two", made-up session ids, never woken) and one cmd thread "Title shell", which was woken and used for both parts.
- Part A wrote the hook's titles with cmd `title` commands (`title ⏳ States test - bg (1 running)`, `✅ ... - done`, `▶ ... - working`, `⚠ ... - needs permission`, `⚙ ... - compacting`). An in-page sampler logged every change of the thread's title, state, background work flag and record status (`20-synthetic-titles-state-log.txt`; Chromium throttled it to about one sample a second at times, so its times are accurate to about a second).
- Part B ran a real Claude Code 2.1.319 (Haiku 5.5) in the same cmd thread after `set CLAUDE_CONFIG_DIR=`, in an empty scratch folder, so the real login and the real hook were used (`echo` showed `AFTERTERM=1` and no `CLAUDE_CONFIG_DIR`). Same sampler, with the thread's kind added (`40-real-claude-state-log.txt`), and the reader's lines from the harness log (`40-harness-log-record-reader-lines.txt`).
- Recordings: `20-synthetic-titles-whole-test.mp4` (Part A, 189 s) and `40-real-claude-background-agent-whole-test.mp4` (Part B, 357 s).

## Part A: synthetic titles in a cmd thread

| Row | What was done | What was seen | Captures | Result |
|---|---|---|---|---|
| 1 | `⏳` title on the thread on screen | Row `[shell/background]` with the hourglass, project pill hourglass 1, header chip "Background tasks", flag set. Still the same 7 seconds later. No rail tile (the rail does not list a project for background alone, as before) | 21, 22 | Pass |
| 2 | Opened "Chat one", then "Title shell" again | The hourglass stayed on the row and the pill while away, and the chip was back on return. The sampler logged no change at all across the switch; background held from 17:28:14 to 17:29:21 UTC, until row 3's title | 23, 24 | Pass |
| 3 | `✅` title on the thread on screen | Quiet at once (the done cleared because it was seen), flag cleared, no pill | 25 | Pass |
| 4 | `⏳` again, then one cmd line: `▶` title, `ping -n 7`, `⚠` title; then Enter | Spinner on the row, pill and chip while the ping printed, flag kept. Then needs-you: bell on the row, chip "Needs you", pill and rail tile with 1, flag kept. Enter turned it to working (17:30:16.2 UTC) and the hourglass came back 3.3 s later (17:30:19.5), when the output had been silent for 2.5 s | 26, 27, 28 | Pass |
| 5 | `✅` first so the thread was quiet, then `⚙` title and nothing | Compacting on the row, chip, pill and the rail tile's corner from 17:30:46.2 UTC; still compacting at 4.1 s; quiet at 17:30:52.2, 6.0 s after the title, tile gone | 29, 30, 31 | Pass |
| 6 | A second `⚙` title (a new text, so the title changed), then Esc 0.3 s later | Compacting at 17:31:09.22 UTC, quiet at 17:31:09.53, tile gone | 32 | Pass |

## Part B: a real Claude Code with a background agent

| Row | What was done | What was seen | Captures | Result |
|---|---|---|---|---|
| 7 | Sent the prompt from the brief at 23:03:50 local | Claude asked whether to trust the empty scratch folder first (see "What I did differently"). After the prompt: working from 17:33:52 UTC (record busy). Claude started one background agent (`Agent(Run ping for 90 seconds)`, "Backgrounded agent") and ended its turn: the hourglass came at 17:33:57 UTC, 7 s after sending, with the flag set, chip "Background tasks", row hourglass, pill 1. Claude's screen said "Waiting for 1 background agent to finish". The record stayed busy for the whole agent run, and the state stayed background under it | 41, 42, 43 | Pass |
| 8 | Opened "Chat one" at 23:04:31, back at 23:04:42 | The hourglass stayed on the chat's row and the pill while away; on return the chip read "Background tasks" again, state background, flag set, record busy | 44, 45 | Pass |
| 9 | Waited for the agent | The agent finished after 1m 37s. Claude's next turn showed the spinner at 17:35:33 UTC (flag still set), its `✅` came at 17:35:35 and the thread went quiet at once with the flag cleared; the record went idle at 17:35:37. The hourglass held for 96 s, from 17:33:57 to 17:35:33, the whole agent run, viewed or not | 46, 47 | Pass |
| 10 | `/compact`, then Esc within 2 s, twice | First try: Enter at 23:06:16.17; spinner at 1.06 s while Claude showed "Running PreCompact hooks"; the `⚙` came at 17:36:17.23 UTC; Esc at 1.23 s after Enter; quiet by 17:36:18.22 (record idle at 17:36:19). Second try: compacting at 0.84 s (chip "Compacting", Claude showing "Compacting conversation… (0s)", row, pill, rail tile), Esc at 1.18 s, quiet 0.65 s after Esc with the tile gone (record idle a second later). Both times Claude cancelled the compaction: `/compact` went back into its input box and the context stayed at 68k. Cleared well inside 10 s both times, through the Esc path | 48, 49, 50, 51 | Pass |
| 11 | `/exit`, then `exit` | After `/exit` the cmd prompt was back (`marks`: at prompt yes), the record status and the flag were gone, state quiet. The row keeps the chat icon, since the thread kept its session id. After `exit` the thread closed and "Chat two" (asleep, nothing spawned) became the active thread. Claude's record file for the session was gone from the sessions folder, and the scratch folder was still empty | 52, 53 | Pass |

## What I did differently from the brief

- **I accepted Claude Code's folder trust question** ("Yes, I trust this folder") for my own empty scratch folder `scratchpad\t1\work` (capture 41). The brief says to press Esc on a setup prompt; I judged this folder question not to be the setup panel meant, and Esc there would have ended Part B. It adds that folder to the trusted list in the real `~/.claude.json`, which is neither of the two hashed files. Earlier testers in this round did the same (several `rw-fixes-chat-*` folders are in that list).
- **No permission prompt appeared**: the real settings have auto mode on, so the background agent's `ping` ran without asking. A background agent's own permission prompt was therefore not exercised.
- **`/compact` was run twice** (rows 48 to 51): the first still caught the spinner, not the compacting icon, because the `⚙` came 0.2 s after it; the second was timed to catch the icon. Both were cancelled within 1.3 s.

## Things to know

- Claude Code's status line said "You've used 97% of your 5-hour limit" at 23:05 on 2026-11-08 (capture 46).
- The rail never shows a tile for a project whose only state is background (row 1). AFT-25 lists the rail tile among the places the state was missing; the rail's rule is unchanged by this branch (PR #40's decision).
- In a real run, Claude's own spinner titles (`◐`, `◑`, `✳`) replace the hook's `⏳` title within a second; the state held because an undecorated title changes nothing.
- Not tested: the commits made after this run (`a820e9f`, `93407c8`), a background agent's permission prompt, and a compaction that ends by the record going idle or by output silence alone in a real Claude (in both real cancels the Esc came first).

## Hashes of the real Claude files

| File | Before the launch | After the launch | After the stop | Now (2026-11-09) |
|---|---|---|---|---|
| `settings.json` | `2CBF2BE4E19D4BC064091C306D676F5BD3A73A344D761D677C61BB4E75126919` | same | same | `62E5463075E36910FC970D8721FBE6DD554955E55A4FDB528DB723E73F54E5BE` |
| `hooks\afterterm-notify.ps1` | `21A8E8A0A170955FB4E1760E49020DC22FE2261CA1C45DAAAB3173E3E668633B` | same | same | same |

The run's "before" hash of `settings.json` predates the orchestrator's edit of 2026-11-09, made at Aryan's request with the hook entries unchanged; the file did not change during this run.

## Round 2 live rows: the branch at 00dba51 passes every live row (2026-11-09)

The branch after both review rounds (`a820e9f`, `93407c8`, `cc34352`, head `00dba51`), run on 2026-11-09 from 01:41 to 01:47 local time. The rules were the same as before: data dir `tester-thread-states-r2`, a new empty scratch `CLAUDE_CONFIG_DIR`, the window on DISPLAY2 (primary false), and in the one cmd thread `set CLAUDE_CONFIG_DIR=` then `claude --model haiku` in the same scratch folder (trusted in round 1, so no trust question this time). Auto mode was on. The sampler ran at full rate this time, so the times in `60-round-2-real-claude-state-log.txt` are accurate to about 50 ms (UTC; local is UTC+5:30). The whole run is one recording, `60-round-2-real-claude-whole-test.mp4` (275 s). The record reader's lines are in `60-harness-log-record-reader-lines.txt`.

| Row | What was done | What was seen | Captures | Result |
|---|---|---|---|---|
| A1 | The background agent prompt (`ping -n 90 127.0.0.1`), sent at 01:43:01 | Working from the hook's `▶` (20:13:02.2 UTC). Claude started the agent and ended its turn: the `⏳` title came at 20:13:08.9, 7.6 s after sending, and the row, pill and chip showed the hourglass with the flag set and the record busy | 61, 62 | Pass |
| A2 | Opened "Chat one" at 01:43:19, back at 01:43:21 | The hourglass stayed on the chat's row and the pill while away, and the chip read "Background tasks" on return; state background, flag set, record busy | 63, 64 | Pass |
| C1 | While the agent ran: "Ask me one yes/no question with your question tool and wait.", sent at 01:43:36 | Working from `▶` (20:13:37.6). Claude showed its question at about 20:13:40; the record said waiting at 20:13:40.8, and at 20:13:41.8 the state fell back to the hourglass (the working silence clear), showing it for 4.4 s while the question was on screen (65). The hook's `⚠` came at 20:13:46.2: needs-you on the row, chip "Needs you", the pill and a rail tile, flag kept (66). Answered "Yes" at 20:14:07.9: working (67). Claude's turn ended with the agent still running and its `⏳` brought the hourglass back at 20:14:12.1, 4.2 s after the answer (68) | 65, 66, 67, 68 | Pass |
| A3 | Waited for the agent | The agent finished after 1m 39s. Its report turn opened with `▶` at 20:14:45.5 (working, 69). The `✅` came at 20:14:48.8: quiet at once, flag cleared; the record went idle at 20:14:49.1 (70). The hourglass showed from 20:13:08.9 to 20:14:45.5 (97 s), apart from the 35 s of the question's turn | 69, 70 | Pass |
| C2 | No agent running: the same question prompt, sent at 01:45:05 | Working from `▶` (20:15:06.2), the record said waiting at 20:15:09.2, and the state went quiet at 20:15:10.8, 3.8 s before the hook's `⚠` arrived at 20:15:14.6: needs-you (71). Answered "Yes" at 20:15:23.9: working (72). The `✅` at 20:15:26.7 made it quiet at once (73) | 71, 72, 73 | Pass |
| B | A second agent (`ping -n 60`): the hourglass came at 20:15:49.8 (74). Then `/exit` while it ran | Claude asked "Background work is running" with Exit and stop tasks, Move to background and exit, Stay (75). I chose "Exit and stop tasks" at 01:46:21.1. At 20:16:21.4, 0.3 s later, the state, the flag and the record all cleared together; the cmd prompt was back at 20:16:23.2 (`marks`: at prompt yes). The row shows no hourglass, the header no chip, and the terminal a plain prompt (76) | 74, 75, 76 | Pass |

### What round 2 found

- **A question from Claude shows needs-you even in auto mode.** The hook's `⚠` came for the AskUserQuestion prompt both times. It came 4 to 5 s after the question was on screen. Meanwhile the thread showed what it had before the turn: the hourglass with the agent running, quiet without one. This gap behaves the same as in 0.16.0; the review 2 notes in `spinnerState.ts` describe it.
- **The answer-back-to-the-hourglass rule for an agent's own prompt was not exercised.** In C1 the question came inside an open turn (after `▶`), so the answer correctly gave working, and the hourglass came back from the turn's own `⏳`. The other case needs a needs-you that arrives with no turn open: a background agent's own permission prompt. Auto mode approved the agent's `ping` without asking, so no such prompt came. Producing one would mean leaving auto mode, which this round ruled out.
- **The shell prompt path was not isolated.** In row B the record going away cleared the flag 0.3 s after the exit, before the prompt was back (1.8 s later). The prompt rule is the fallback for a Claude whose record afterterm cannot read, and here the record was readable.
- Row B was run with background work still running, the harder case. Exiting with nothing running is round 1's row 11.
- No compaction was run in round 2.

### Hashes for round 2

| File | Before the launch | After the stop |
|---|---|---|
| `settings.json` | `62E5463075E36910FC970D8721FBE6DD554955E55A4FDB528DB723E73F54E5BE` | same |
| `hooks\afterterm-notify.ps1` | `21A8E8A0A170955FB4E1760E49020DC22FE2261CA1C45DAAAB3173E3E668633B` | same |

The harness was stopped with `harness:stop` (12 processes). Claude's record for the round 2 session was gone from the sessions folder afterwards, and the scratch folder was still empty.

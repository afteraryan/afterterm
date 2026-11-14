# Loops: what was built

Loops are the pieces of work started in every project (design-07, `docs/design-07-loops.md`, and its two mocks). This is the record of the build: what each part is, where it lives, what was decided while building, and how it was tested. Linear: AFT-82, with one sub-issue per phase (AFT-95 to AFT-101). The phases and every decision with its reason are also in `PHASES.md` under Loops.

## Where each part lives

| Part | Files |
|---|---|
| The rules (rotting, order, counts, the card's 5, the remembered chat, the parent-close rule, one level of nesting, delete for 30 days) | `src/loops.ts`, tested in `src/loops.test.ts` |
| The store: `<userData>\loops.json`, main the only writer | `src/loops-store.ts`, tested in `src/loops-store.test.ts`; IPC `loops:list`, `loops:act`, `loops:changed` in `src/main.ts` |
| `afterterm loops`: every command, its output and the chat-start text | `src/loops-cli.ts`, tested in `src/loops-cli.test.ts` |
| The pipe, its token, the launchers | `src/loops-pipe.ts`; the client `assets/cli/afterterm-cli.js`; tested end to end in `src/loops-pipe.test.ts` |
| The skill | `src/loops-skill.ts` (writes `<Claude folder>\skills\afterterm\SKILL.md`, and removes the `afterterm-loops` skill that 0.19.0 and 0.20.0 wrote; AFT-110) |
| The chat-start hook | `assets/hooks/afterterm-notify.ps1`, `Get-LoopsBrief` on SessionStart |
| Messages per day for the calendar | `src/activity-counts.ts`, `src/activity-store.ts`, `src/renderer/streakView.ts`, each with its test; IPC `activity:get`, `activity:changed` |
| The renderer's helpers (Open chat, the filter, project colours, the context sent to main) | `src/renderer/loopsView.ts`, tested in `src/renderer/loopsView.test.ts` |
| The list both Home and the card draw | `src/renderer/components/Loops/` (`LoopList.tsx`, `LoopMenu.tsx`, `LoopIcons.tsx`, `Loops.css`) |
| Home's Progress column | `src/renderer/components/Home/Progress.tsx`, `Progress.css`; the layout in `Home/index.tsx`, `Home.css` |
| The workspace card | `src/renderer/components/Loops/LoopsCard.tsx`, `LoopsCard.css`; its button in `Header`; Ctrl+Shift+L in `main.ts` |
| State in the app | `src/renderer/app.tsx` (`openLoopChat`, Progress open and its filter, the card open, `showProgress`), `src/renderer/hooks/useLoops.ts`, `useTabState.openResumedChat` |
| Harness support | `scripts/agent-harness/loops-seed.mjs` (the mocks' data), `launch.mjs --loops`, `loops-measure.mjs` (spec values from computed styles), `activity-fixtures.mjs` (fixture transcripts), `window.afterterm.harness.setSize` |

## How it works

**A loop** is stored with status open or closed only. Rotting is worked out each time from the loop's last activity (a ping, a note, any edit, by an agent or by Aryan; a sub-loop's activity counts for its parent): 5 calendar days with none, and an open loop that is not an idea shows as rotting. So any activity makes it open again without anything being written back. Archive and delete are times on the loop, not statuses; a deleted loop is purged 30 days later, when the store loads.

**One writer.** Main owns `loops.json` (`LoopsStore`, saved 150 ms after a change, written to a `.tmp` and renamed; a file that does not parse is moved aside, never overwritten). The UI's changes come through `loops:act` as Aryan's (they never replace the remembered chat); the command's come through the pipe as an agent's, with the chat it ran in.

**The command.** At every launch main writes two launchers to `<userData>\bin` (`afterterm.cmd` for cmd and PowerShell, `afterterm` for Git Bash) that run `assets/cli/afterterm-cli.js` on afterterm's own executable in Node mode (`ELECTRON_RUN_AS_NODE=1`). Every terminal afterterm opens gets that folder first on its PATH, the pipe's name (`AFTERTERM_LOOPS_PIPE`, one per data folder) and a token made at launch (`AFTERTERM_LOOPS_TOKEN`). The client sends its arguments, its folder, the thread (`AFTERTERM_TAB_ID`) and Claude Code's session (`CLAUDE_CODE_SESSION_ID`) to main and prints the answer. A wrong token is refused (exit 5); no pipe gives "afterterm is not running" (exit 1). The renderer sends main each thread's project, session and folder (`loops:context`), so the command knows which project its thread is in.

**The chat-start text.** On SessionStart the hook asks the pipe for a short brief (the open loops of the chat's project, most recent first, at most 8; for a resumed chat, the loop it last touched and its status note) and returns it as `additionalContext`. Within 2 seconds or not at all: an older afterterm, or no answer, gives the title only, as before.

**The calendar's counts.** Main reads the transcripts' structure only (user turns, not tool results, subagent lines, meta lines, interrupts, slash-command and task-notification wrappers), dedupes by uuid and keeps a count per local day in `<userData>\activity.json`. The first launch with no such file reads every transcript still on disk, in 1 MB reads with yields, starting 5 seconds after launch; then a 30 second poll and a nudge after each turn read only what was appended. This runs in the app, so a fresh install and an update from any older version (the in-app update or an installer run by hand) both fill the past on their first launch.

**Open chat.** The loop's thread when it is open (woken when asleep), else that session's entry in the project's history (resumed), else a new chat thread in the loop's project that resumes the session where it was. A worktree that is gone opens in the project's folder with "Folder gone, opened in the project folder". A loop with no session says "No chat".

## The loops tour (AFT-103)

A one-time guided tour on Home, built from the mock `docs/mockups/loops-tour.html` (its STEPS, ART, CSS, `place()`, `apply()` and `finish()`). Eight cards, solid blue (#2d66f2), 420px wide, 18px radius, a NEW tag and a progress ring in the corner, Back, Skip and Next; the calendar's card green; the last split on a hard diagonal, 75% blue and 25% green, with a 👍 that pops in with a burst of dots. Each card but the keys step has a picture: afterterm's own UI enlarged and tilted on a deeper panel, with a cursor where there is an action. A 3px ring sits 6px outside the part of the screen the card is about, and the card sits beside it with a pointer, never over it.

| Part | Files |
|---|---|
| When it shows and what it remembers (prefs.json `toursSeen`) | `src/tours.ts`, tested in `src/tours.test.ts`; IPC `tours:seen`, `tours:mark-seen` in `src/main.ts` |
| The steps, what each does to the app, the examples, the placement | `src/renderer/loopsTour.ts`, tested in `src/renderer/loopsTour.test.ts` |
| The card, the ring, the movement, the pictures | `src/renderer/components/LoopsTour/` |
| The app's side (the view per step, examples in place of empty data, the loops card held open, the opened loop) | `src/renderer/app.tsx` (`tourStep`, `startTour`, `endTour`); `forceOpen` on `LoopList`; `example` on `Progress` and `LoopsCard` |
| Harness | `tour-measure.mjs` (one step against the mock's values), `tour-mock-drive.mjs` (the mock in headless Edge), `drive screenshot --clip --scale` |

The examples (five loops, three sub-loops, three example projects, 16 weeks of days with a six-day streak) exist only in the renderer, at 85% with an "Example" tag beside the Progress heading and in the loops card. Someone with a loop or a calendar day of their own sees their own instead. Every decision is in `PHASES.md` under Loops.

## Decided while building

Every decision is in `PHASES.md` under Loops with its reason. The ones that change what Aryan sees:

- Closing a loop does not move it in the list; reopening does (it counts as activity).
- Counts are of top-level loops; sub-loops show as "1/5".
- Reopening a sub-loop of a closed parent reopens the parent.
- A second ping within a day changes nothing.
- The command's names and exit codes (design-07 left them open).
- A deleted worktree: the chat opens in the project folder with a note.
- Delete shows Undo for 6 seconds; deleted loops (30 days) are listed under the Archived filter, below the archived ones, where Restore brings one back.
- Home's Projects list shows six rows before Show more (three per column, as in the mock).
- The card's rotting button is hidden while nothing rots.
- Progress open or closed, and the card open or closed, are kept per viewer in local storage.
- The calendar counts 1,541 of Aryan's messages over the 38 days on disk, not the 1,771 in design-07: the spec's exclusions leave out 71 slash commands, 192 task-notification turns and 39 interrupts. Counting slash commands would be a one-line change.

## Not covered

- WSL terminals do not get the `afterterm loops` command (their PATH and paths would need translating; WSL is not on the development machine).
- A transcript's last line with no newline at the end is not counted until it gets one (Claude Code always writes one).

## How it was tested

Unit tests (all in `npm test`): `loops.test.ts` 65 checks, `loops-store.test.ts` 12, `loops-cli.test.ts` 56, `loops-pipe.test.ts` 24 (a real pipe, the real client and the real hook under PowerShell), `loopsView.test.ts` 22, `activity-counts.test.ts` 47, `activity-store.test.ts` 31, `streakView.test.ts` 38. The hook's own harness: 30 of 30 under pwsh and Windows PowerShell.

In the dev build through the harness (every run with its own data folder, a scratch Claude folder, made-up session ids, recorded; captures and recordings in `docs/screenshots/loops/`):

- **The command** from real cmd, PowerShell and Git Bash threads: start, sub-loop, list, update, ping twice (the second changes nothing), the refused parent close (exit 3), close in order and with `--with-sub-loops`; the hook run from a thread for a new and a resumed chat; "afterterm is not running" after the app closed. (`p2-*`)
- **The list and Open chat**: open in place, the menu and its submenus (turning left at the window's edge), label, move, rename, "Close 2 sub-loops?", delete and Undo; Open chat for an asleep thread, a history entry, a chat in neither, no chat, and a deleted worktree. (`p4-*`)
- **Home** at 1920 by 1032 beside the mock: every filter path, the calendar's four-week slide, Progress closing and opening, the projects search. (`p5-*`)
- **The card**: stays through an outside click, Esc and thread switches; the button and Ctrl+Shift+L; rows; Rotting and All. (`p6-*`)
- **Exact values**, measured from computed styles in the build with `loops-measure.mjs`: Home 77 of 77, the card 35 of 35 (`p5-12-home-measured-against-the-spec.txt`, `p6-05-card-measured-against-the-spec.txt`).
- **Animations** recorded beside the mocks' own, the mocks driven in headless Edge at the same size: Home `p5-13` (mock) and `p5-14` (app), the card `p6-08` (mock) and `p6-09` (app). The app uses the mocks' durations and curves.
- **Fixed during the build on Aryan's report**: the current-streak outline on the last square was cut at the calendar card's edge.
- **The counts** (Phase 3): 320 of 320 messages on the small fixture, every day equal; appended messages counted within 33 s; no change after a restart; 2,000 files and 621 MB backfilled in 1.3 s with no main-thread stall over 30 ms; a quit after 684 of 10,000 files carried on to 35,100 of 35,100 on the next launch.

### The loops tour

Unit tests: `tours.test.ts` 17 checks, `loopsTour.test.ts` 71 (every step's scene, the examples and their counts, the example calendar's streak, the placement never covering the ring and staying in the window for every kind of target, the keys step placed from the loops card). In the dev build through the harness at 1920 by 1032, two launches (captures and recordings in `docs/screenshots/loops/tour/`):

- **A new user** (the mocks' projects and threads, no loops, an empty Claude folder): the tour showed on Home on launch. Every step measured with `tour-measure.mjs`: steps 1 and 8 15 of 15, steps 2 to 5 and 7 23 of 23, step 6 27 of 27 (the ring 6px outside its target on all four sides, the card clear of the ring and the target and inside the window, the colours, no sub-line, the ring filling a step at a time, the keys card placed exactly 24px left of the loops card). After Done the examples were gone, Home showed "No loops yet", no loops.json was written, and prefs.json said `toursSeen: ["loops"]`; a reload showed no tour. Back gave step 2 again (23 of 23). Skip on step 3: no tour after a reload. Step 6 with every thread closed: the loops button in the empty header, 27 of 27. Take the loops tour replayed from step 1. Under reduced motion nothing moves and Done ends at once. (`01` to `11`, `20` to `23`, `26`)
- **Someone with loops and calendar days** (`loops-seed.mjs`, 22 loops, and 320 fixture messages over 31 days): relaunched on the same folder, no tour (seen after Done). Replayed from the About window: their own loops and calendar, no examples, no Example tag; the rotting step rang their first rotting loop, the sub-loops step opened their first loop with sub-loops; every step passed as above; afterwards no loop was left open and loops.json was unchanged. (`12` to `19`, `25`, `27`)
- **Beside the mock**: the mock driven in headless Edge with the same timing (`24`) against the app (`22`): the same steps, places and movement. One difference on purpose: the example idea does not rot, as in the app's rules.

### Install and update

Run on 2026-11-14 with sandbox installers ("afterterm (test)", its own install folder, data and Claude folder) built from this branch at version 0.19.0 and from the v0.18.1 tag. The Claude folder held six weeks of fixture transcripts (`activity-fixtures.mjs small`: 320 messages over 31 days, with every kind of line that must not count) before anything was installed. Setup was driven through Windows UI Automation (Install, Next, Finish), and each copy was read over its DevTools port.

| Test | Result |
|---|---|
| Fresh install of 0.19.0 | Setup finished in 33 s; on the first launch, before any message was sent, the calendar had 320 of 320 messages over 31 of 31 days, every day equal (`p7-01`) |
| `afterterm loops` in the installed copy | A loop started and listed from a Command Prompt thread of the installed copy: the launcher runs the installed exe in Node mode (`p7-02`); run outside afterterm's terminals it says so |
| Update from 0.18.1 through the update feed and Setup's update mode | 0.18.1 installed (no loops, no counts), offered 0.19.0 from a local feed; Update, the download, Restart to update, Restart now; back as 0.19.0 29 s later, and on that first launch the calendar had 320 of 320 messages, every day equal (`p7-03` to `p7-05`) |
| 0.19.0 installed by hand over 0.18.1 | 0.18.1 installed and opened, then closed; the 0.19.0 Setup run over it; on its first launch 320 of 320, every day equal (`p7-06`) |
| Startup with a large transcript folder | The final dev build with 10,000 transcripts (2.1 GB) and `AFTERTERM_LAG_PROBE=1` for 90 s: all 35,100 of 35,100 messages counted in 101 s. The stalls over 30 ms at window creation (135, 379, 38 and 114 ms, in the first 2 s) come before the backfill and were there before loops. During the backfill there were five, 31 to 70 ms: the save, which rewrote the 1.5 MB `activity.json` with a synchronous `JSON.stringify` and write every 2 s. Fixed: the save is now built in slices that yield (`serializeActivityFile`) and written without blocking. Measured on the same data, the old save blocked for 16 to 19 ms each time in plain Node; the new one's longest slice is 4.9 ms. The dev build was not launched again to repeat the 90 s run, since every launch opens a window (see below) |

The test installs were removed afterwards and the earlier test data folder (`%LOCALAPPDATA%fterterm-test`, kept aside during the tests) was put back as it was.

Every Setup run and dev build launch opens a window, which takes focus from whatever Aryan is using, even on the second display (Aryan, 2026-11-14). Tests that open windows are to be agreed with him first.

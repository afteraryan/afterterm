# Claude usage card (AFT-85)

A gauge at the bottom of the rail (Ctrl+Shift+U) opens a small card with the plan usage shown by Claude Code's `/usage`: the limits first, then a breakdown. Designed with Aryan on 2026-11-13; the clickable mock is `docs/mockups/usage-card.html`.

## Where the numbers come from, and why

Claude Code has no documented way to ask for plan usage. Options looked at on 2026-11-12 and 2026-11-13:

| Way | Verdict |
|---|---|
| Claude Code's status line feed | Documented and safe, but it has no per-model (Fable) figure, only updates while a chat runs, and the status line is one slot, so afterterm would have to wrap the user's own. Dropped. |
| The `api/oauth/usage` endpoint with the login token | Works and has Fable, but it is undocumented, has reports of persistent 429s, and reading the token for another program may break Anthropic's terms for consumer plans. Dropped. |
| Counting tokens in transcripts | Gives tokens, not the percent of a limit. Dropped. |
| **A hidden Claude Code running `/usage`** | Chosen. Official app doing its own work, no token read, no settings changed, Fable included, no model call. About 3 to 5 seconds to the limits and about 7 to 10 to the breakdown. |

## How it works

- `src/usage-screen.ts` (pure, unit-tested): turns the rows of the `/usage` screen into limits, tips and groups, tidies the text (time zone dropped, folder paths shortened), and decides what to type next from the screen (`readerStep`).
- `src/usage-reader.ts` (main): starts Claude Code in a pseudo-terminal in `<userData>\usage-reader`, renders it with `@xterm/headless`, answers the trust question once, types `/usage`, publishes the limits as soon as the screen has settled for two ticks, publishes the breakdown when "Scanning local sessions" is gone, and always kills the process tree. One run at a time, a fresh read on every open and every refresh (no cache), 45 seconds at most.
- `usage:read`, `usage:state` and `usage:update` carry the state to the renderer; Ctrl+Shift+U arrives as the `usage` shortcut.
- `src/renderer/usageView.ts` (pure, unit-tested): bar colours (blue, yellow from 75%, red from 90%), the 50% "big number" line, which phase each tab is in.
- `components/UsageCard`: the card. Its elements stay in place between updates so the height, the tab highlight and the bars can animate.

## Decisions (Aryan, 2026-11-13)

- On demand only. No meters on screen, no row in the sidebar, nothing on Home or in the title bar.
- A small centred card, rows like Claude's own usage page, header only "Usage", two tabs, refresh and close. No explanatory text anywhere.
- Every open reads again. A one-minute cache existed for a day and was removed on 2026-11-13, when Aryan opened the card again and was shown the earlier numbers.
- A skeleton on every read, a refresh included (main clears the old numbers when a read starts). Aryan first accepted "keep the numbers and only spin the icon" on a refresh, then asked for the skeleton on 2026-11-13.
- The gauge is a bare icon like the rest of the rail. A button surface at rest was tried on 2026-11-13 and Aryan preferred it without.
- While a read runs, a limit that has not arrived keeps its skeleton row (`pendingLimitRows`), so the card never shrinks and grows back when Fable's row comes a moment after the others.
- Numbers blue, a number of 50% or more yellow. Five other Breakdown layouts and coloured blocks were tried and rejected.
- The Fable row is shown by default. A setting to hide it is not built yet.

## Things worth knowing

- The hidden Claude Code runs without `AFTERTERM` or any `CLAUDE_CODE_*` variable, so afterterm's notification hook ignores it.
- Claude Code draws its selection pointer as `❯` or `>` depending on the terminal; the first run inside the app stuck on the trust question because only `❯` was recognised (fixed, tested).
- `@xterm/headless` 6.0.0 names a `module` file that is not in the package, so `vite.main.config.ts` aliases it to `lib-headless/xterm-headless.mjs`.
- A global `.spin` class already exists in `theme.css` (the small loading circle). The refresh icon's class is `u-reading` because `.spin` also rotated the whole button.
- A start that fails (the spawn throws) reports itself from inside `startRun`, before it returns. `read()` keeps the returned handle only while the run is still going; until AFT-88 it kept it anyway, so one failed start left the reader believing a run was in progress, and every later open did nothing until a restart. `src/usage-reader.test.ts` covers it with a Claude path that cannot start.
- If afterterm's main process is killed hard (no quit handler), the hidden Claude Code goes with it: tested on 2026-11-13 with a forced kill of the main process alone mid-read, and the hidden one was gone at once with nothing left behind.
- Tooltips are lifted above modals (`.tip` z-index 2100) so a tooltip inside the card shows.
- Not tested live: Ctrl+Shift+U (the harness cannot send key chords to the main process) and a plan with no Fable line or no breakdown (covered by parser tests only).

## How it was tested

Unit tests: `src/usage-screen.test.ts` (parser, reset text, the keystroke decisions, the cache) and `src/renderer/usageView.test.ts`. Real runs: the reader against Aryan's real Claude Code (limits and breakdown parsed, no leftover process), then the dev build through the harness on the secondary display. Screenshots and a recording are in `docs/screenshots/aft-85-usage/`.

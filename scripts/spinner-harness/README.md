# spinner-harness

Dev-only harness that measured the PTY behavior behind the working-spinner fix
(`src/renderer/spinnerState.ts`). It spawns a **real interactive `claude`** through
node-pty with `AFTERTERM=1` (so the notify hook fires the same `▶`/`✅`/`⚠`/`⚙`
titles afterterm reads) and timestamps every output chunk — reproducing exactly the
stream the renderer sees, without needing the Electron GUI.

## Scripts

- `probe.mjs` — spawns `claude`, logs the startup byte-stream for a few seconds, sends nothing. Used to learn the startup sequence (no turn, ~zero token cost).
- `capture.mjs <scenario>` — submits one prompt and logs every inter-chunk gap between `▶ working` and `✅ done`. Scenarios: `think` (pure reasoning, no tools), `tools` (real tool calls), `mixed` (interim reply then more work), `perm` (forces + auto-rejects a permission prompt to prove `⚠` fires mid-turn).
- `compact-probe.mjs` — runs a tiny turn then `/compact` to confirm `⚙` behaves like `⚠` and that output resumes afterward.

## Findings (what the fix is built on)

- Mid-turn, across think/tools/mixed, the PTY was **never silent > ~450ms**.
- At idle it is silent **indefinitely**.
- At a permission (`⚠`) / compaction (`⚙`) pause it goes silent for **seconds**, then resumes in a burst.

Those three regimes are cleanly separable by an output-silence threshold, which is
what `spinnerState.ts` uses (silence-clear + resume re-arm).

## fixtures/

`*.jsonl` are captured traces (one JSON object per PTY chunk: `{at, gap, len,
title, notif}`). **`src/renderer/spinnerState.test.ts` replays these**, so they must
stay committed — they turn a live measurement into a deterministic regression test.

## Note on paths

These `.mjs` scripts contain machine-specific absolute paths (the scratchpad session
dir, `node-pty` from the main checkout, `claude.exe` location). They're kept as a
record of methodology; adjust the constants at the top of each file to re-run
elsewhere. Running `capture.mjs`/`compact-probe.mjs` spends real Claude usage.

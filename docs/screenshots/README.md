# Screenshots and recordings

Every screenshot and every screen recording an agent takes while testing a phase is saved
here and kept. Nothing in this folder is deleted, by anyone, at any time. One subfolder per
phase (`phase-1/`, `phase-2/`, ...), with numbered file names that say what the capture
shows.

Recordings are mp4 files made with `node scripts/agent-harness/drive.mjs record start --out
<phase>/NN-<what-it-shows>.mp4` and `record stop` (CDP screencast of the page, stitched by
ffmpeg, so they work while the dev window sits behind other windows). They sit next to the
screenshots with the same numbering, one per flow that was driven, from Phase 3 on (Aryan
asked for it on 2026-09-07 so a test run can be watched, not only read).

`<phase>/displays/` holds whole-monitor captures from `scripts/agent-harness/screenshot-display.ps1`.
Those show every window on that monitor, including personal ones, so that subfolder is
ignored by git and only lives on this machine. Everything else in here is committed with
the phase so a reader of PHASES.md can see what was verified.

`manual-testing/` holds every screenshot Aryan sends with a bug during his manual testing,
numbered and named for what it shows, committed and never deleted, the same rule as the phase
folders. The bug itself is an entry in `docs/bugs.md` that links the screenshot. Agreed on
2026-09-08.

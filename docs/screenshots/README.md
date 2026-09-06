# Screenshots

Every screenshot an agent takes while testing a phase is saved here and kept. Nothing in
this folder is deleted, by anyone, at any time. One subfolder per phase (`phase-1/`,
`phase-2/`, ...), with numbered file names that say what the capture shows.

`<phase>/displays/` holds whole-monitor captures from `scripts/agent-harness/screenshot-display.ps1`.
Those show every window on that monitor, including personal ones, so that subfolder is
ignored by git and only lives on this machine. Everything else in here is committed with
the phase so a reader of PHASES.md can see what was verified.

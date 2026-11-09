# Why Claude Code's output is printed twice (AFT-11) and why the top of a prompt looks dim (AFT-5)

Investigated 2026-11-08 and 2026-11-09 on branch `check-terminal-output`, Windows 11 build
10.0.26200.9711, node-pty 1.1.0 (the system ConPTY), xterm.js 6.0.0, Claude Code 2.1.319 with
Haiku 5.5. Every run was a harness dev build on the secondary display with a scratch
`CLAUDE_CONFIG_DIR`. The capture numbers below are files in this folder.

## The two answers

**AFT-11: Claude Code makes the copies, and afterterm was giving it many more chances than it needed.**
Each time a terminal changes size, Claude Code redraws its screen. When the terminal got
narrower, the rows that the narrowing pushed above the top of the screen can no longer be
reached by any program, so they stay in the scrollback and the redraw prints the same text
again below them, at the new width. That is the picture in the issue: the same block twice,
the second copy wrapped at another width. Plain output resized the same way never doubles.
afterterm decided how often this happened, and four of its resizes were avoidable: coming back
from Home resized every chat on screen wider and back again, a slow drag of the window's edge
sent one resize per pause, a thread woken while out of view started at 80 columns and was
resized the first time it was shown, and one resize repeated the size the PTY already had. All
four are fixed on this branch. A real narrowing (making the window narrower, showing the
sidebar, splitting the pane) can still leave one copy, because that is how Claude Code redraws.

**AFT-5: not afterterm's, and nothing to soften.** afterterm dims nothing in a live terminal, and
the cells of a submitted prompt carry no dim attribute and no grey colour. The seam has a plain
cause: when a prompt is taller than the screen, the rows that scrolled above the screen while it
was typed are never redrawn after Enter (the PTY log has each of them exactly once), so they keep
the look they had in the input box while the rows below get the echo's look. In Claude Code
2.1.278, the version in Aryan's screenshot, those two looks differed; in 2.1.319 they are the
same, so the seam is only visible as a stray input-box border line above the echo.

## AFT-11 evidence

### How many resizes afterterm sent before the fix

A temporary log in main counted every `pty:resize` per thread (the code is in
`probe-code-used-for-the-check.patch`; a lighter version stays as `AFTERTERM_RESIZE_PROBE=1`).
Run 1 (`02-resize-log-run-1.txt`, recording `02-...mp4`) and run 3 (`42-resize-log-claude-run.txt`).

| Action | Resizes sent to the PTY | Note |
|---|---|---|
| Wake a thread on screen | 1 (80x24 to 112x42), right after the spawn | The PTY was always spawned at 80x24 |
| Wake a thread from its menu while another is on screen | 1 resize to the same size (80x24 to 80x24), then 1 more when it is first shown | It ran at 80 columns until shown (`10-...png`: the prompt stays wrapped at 80) |
| Switch threads | 0 | |
| Hide or show the sidebar | 1 each | Debounced by the 80 ms fit |
| Go to Home and back to the workspace | **2 that cancel out** (112 to 145, then back to 112) | Seen once throttling was off; the fit caught the terminal before the sidebar slid back in |
| Drag the window's edge quickly | 1 | |
| Drag the window's edge with pauses (10 steps 200 ms apart) | **10** | One per pause longer than 80 ms |
| Make a split, release the divider | 1 each per thread | Already held to the release (design-06) |

A resize to the same size does not make a program redraw: four of them sent to the Ink-like
script below produced no new render, so that one was harmless, only wasteful.

### Plain output resized 13 times never doubles

`long-lines.mjs` prints 80 numbered lines of 130 characters and exits. The terminal was then
made narrower and wider 13 times (`30-...png`, `31-plain-output-buffer-after-13-resizes.txt`).
Every line is in the scrollback once. One row was lost instead (the start of line 61, at the
row where xterm's scrollback meets the screen ConPTY redraws after a resize), which is a
different, rarer effect and is listed under "Other things seen".

### A program that redraws on resize leaves copies

`ink-like.mjs` does what Ink (Claude Code's screen library) does: it wraps its own text to the
width, erases the rows it believes it wrote and writes them again whenever the size changes.

- Wider (`16-...png`): clean, one block.
- Narrower (`17-...png`): the top of the old block, wrapped at the old width, stays above the
  new one, because the narrowing turned some rows into two and the program erased too few.
- `--tall` (`18-...png`): with a block taller than the screen it clears the screen and prints
  everything again (Ink's path on Windows, which does not clear the scrollback). Two resizes
  left three full copies.

### A real Claude Code does the same

`20-claude-code-long-prompt-and-two-resizes.mp4` (cut before the exit screen, which showed the
test session's id). A 15-line prompt (`prompt-15-lines.txt`) asked for a numbered list.

- Wider by hiding the sidebar (`25-...png`): redrawn cleanly, no copy.
- Narrower by showing the sidebar (`26-...png`): one small leftover.
- A slow drag of the window's edge, 6 steps (`27-...png`, `28-claude-code-buffer-after-slow-drag-six-resizes.txt`,
  scrolled up in `29-...png`): lines five to eight of the prompt are in the scrollback five or
  six times, each copy wrapped at the width of one step. The list itself, which was inside the
  screen, is printed once.
- The chat out of view while the window was made narrower, then shown (`33`, `34`, `35`): the
  one resize it got on showing added another copy.

### What ConPTY does on a resize

Microsoft's reference for `ResizePseudoConsole` only says it "Resizes the internal buffers for
a pseudoconsole to the given size" ([learn.microsoft.com](https://learn.microsoft.com/en-us/windows/console/resizepseudoconsole)).
The behaviour is described in the Windows Terminal repository, issue
[#16911, "Document the resize quirk for ConPTY"](https://github.com/microsoft/terminal/issues/16911):
after a resize "ConPTY outputs the reflowed buffer and overwrites any content currently in the
terminal", and the maintainer explains that a terminal using the resize quirk flag "would need
to reflow their own buffer in the exact same way, to keep things in sync". The PTY log of the
Claude Code run matches: every resize was followed by a full redraw of the screen from its top
row (`ESC[H`, then every row), about 3 KB each time.

Windows Terminal could not be tried by hand here. It uses the same ConPTY and Claude Code
redraws the same way, so a real narrowing there is expected to leave the same copies; only the
avoidable resizes were afterterm's own.

## The fix on this branch

`src/renderer/resizeGate.ts` (pure, 27 checks in `resizeGate.test.ts`) decides what a thread's
PTY is told:

1. **A PTY starts at its terminal's size.** `pty:create` takes the columns and rows. A terminal
   that cannot measure itself (made while out of view, or while Home or a project page covers
   the workspace) starts at the size of the last terminal shown alone with the same font size.
2. **A PTY is never sent the size it already has.**
3. **Coming back from Home refits with the same 80 ms debounce as every other fit,** so the
   sidebar sliding back in no longer causes a resize and a resize back.
4. **During a drag of the window's edge the terminals still follow the window, but the PTYs are
   told nothing until it ends,** then get the final size once. Main sends the drag's start and
   end from Electron's `will-resize` and `resized` events; a drag held still for 1.5 s also
   ends the hold, so the terminals can never stay unsized.

Since AFT-33 (merged while this was being built) a reloaded page attaches to the running shells.
The gate starts from the shell's own size there, and AFT-33's deliberate repaint (one row less,
then the real size) is kept as it is.

### Evidence the fix works

Before the merge with main: `50-...mp4`, `51` to `62` (`62-fix-resize-log.txt`). After merging
main (current code): `70-merged-resize-rows-on-current-main.mp4`, `71` to `75`
(`75-merged-resize-log.txt`).

| Action | Before | After |
|---|---|---|
| Wake a thread on screen | spawned 80x24, then 1 resize | spawned at 112x42, 0 resizes (`51`) |
| Wake a thread from its menu, out of view, then show it | 1 same-size resize, 1 more on showing | spawned at 112x42, 0 resizes (`52`, `71`) |
| Wake from the project page, then show it | (same as above) | spawned at 112x42, 0 resizes (`54`) |
| Home and back, twice | 4 (2 each) | 0 (`57`) |
| Home, window made narrower, back | | 1 per thread on screen, to the new size (`59`) |
| Sidebar hide, show | 1 each | 1 each |
| Split, divider release | 1 each | 1 each (`58`, `74`) |
| Reload the page (AFT-33 attach) | | only AFT-33's two repaint resizes per thread |
| Drag of the window's edge, 6 steps 250 ms apart, played with `window.__afterterm.holdResizes` | 6 resizes, the tall script printed 6 more copies | 1 resize, 1 more copy (`60`, `61`, `73`) |

`npm test`: 40 files, exit 0, 3432 checks passed, 0 failed.

## AFT-5 evidence

- 15-line prompt: every cell of the echo has the default colour and no dim
  (`24-claude-code-prompt-echo-cell-attributes.txt`, read straight from xterm's buffer).
- 45-line prompt, taller than the screen (`prompt-45-lines.txt`, `36-...png` before Enter,
  `38-...png` after): no cell is dim or grey (`37-...txt` for the input box, `39-...txt` for the
  echo). The PTY log shows each "Row N" line was sent once, while it was typed, and never again
  after Enter, so rows 1 to 8 (above the screen at that moment) are the input box's own rows. A
  row of the input box's top border is left right above the echo (row 88 in `39-...txt`), which a
  normal echo does not have.
- afterterm's only dimming is the asleep pane's saved tail, which is not a live terminal.

So the seam in Aryan's screenshot sits where the top of the screen was when he pressed Enter.
Above it is how Claude Code 2.1.278 drew the input box, below it how it drew the echo. That is
Claude Code's drawing and a limit every terminal has (no program can redraw rows that have left
the screen); afterterm cannot change either.

## Other things seen, not fixed here

- **Stray characters in Claude Code's status line and list** (`23-...png` "6.capple", `40-...png`).
  Likely ConPTY and xterm.js disagreeing on the width of emoji such as the folder and branch
  icons Claude Code puts in its status line, so a row is drawn one cell off. Not verified; worth
  its own issue (xterm.js has a Unicode 11 width addon).
- **A row lost where the scrollback meets the screen after many resizes** (`31-...txt`, line 61).
  The other side of the ConPTY reflow mismatch quoted above; rare, and only after repeated
  narrowing and widening.

## What could not be tested

- A real drag of the window's edge with the mouse: the harness cannot drag a window edge without
  moving Aryan's cursor, and `SetWindowPos` raises no `will-resize`. The drag was played through
  `window.__afterterm.holdResizes`, which runs the same renderer code main's events run; main's
  two event handlers and the 1.5 s fallback are checked by reading only.
- Windows Terminal side by side with afterterm.
- Claude Code 2.1.278 (Aryan's version for AFT-5).

## Files in this folder

`fixture-session.json` (the harness session: one project, three cmd threads), `ink-like.mjs`,
`long-lines.mjs`, `prompt-15-lines.txt`, `prompt-45-lines.txt`, `tiny-repo/` (where the real
Claude Code ran), `probe-code-used-for-the-check.patch` (the temporary logging, cell reader and
PTY dump used for the evidence, not merged).

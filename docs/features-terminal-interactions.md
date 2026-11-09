# Terminal Interactions

Conveniences that plain conhost/cmd has and afterterm now matches. All wired in
`src/renderer/components/Terminal/index.tsx` unless noted.

## Clickable links

- `WebLinksAddon` underlines plain `http(s)` URLs in output; click opens the default browser.
- OSC 8 hyperlinks (emitted by `ls --hyperlink`, ripgrep, and other modern CLIs) are handled
  by the terminal's `linkHandler` constructor option.
- Both route through the `shell:openExternal` IPC. `main.ts` **safelists** `http:` / `https:` /
  `mailto:` so a malicious escape sequence can't launch arbitrary protocol handlers.

### Links over several rows (AFT-61, 2026-11-07)

**The bug.** Claude Code does not detect hyperlink support in afterterm (on Windows it looks
for `WT_SESSION` or `FORCE_HYPERLINK`), so it prints links as text. A long one it cuts at the
edge itself and moves the cursor to the next row (`ESC[r;cH`), so xterm sees separate lines.
The addon joins only rows the terminal wrapped (`isWrapped`), so a click on the first row
opened that row's part of the address (measured: 102 to 110 of 216 characters) and the other
rows nothing. In reply text, `text (link)`, inline code, tool output and your own prompt alike.

**What afterterm does now.** `Terminal/webLinks.ts` is a link provider registered *before* the
addon (xterm gives a cell to the first provider with a link on it). The rules are pure, in
`src/renderer/webLinks.ts`, tried in order:

1. **A chat's transcript.** The prefix on a link's first row goes to main
   (`session-files:urls`), which answers with the transcript's links starting with it, newest
   first. `session-files.ts` collects every link from every transcript line in the same
   incremental read as the Files button (`state.urls`, at most `MAX_URLS`, `cleanUrl` trims
   punctuation and an unopened closing bracket). `followUrl` checks that the rows below spell
   out the rest; the candidate shown longest wins, so two links with the same first row are
   told apart by the rows below, and a link that ends on its first row stays one row long
   however close to the edge it ends. A line Claude Code shortened with "…" (a tool call's line)
   matches as shortened and opens the whole link. Copies in the transcript that end in "…"
   are never kept: one matched the shortened Bash line exactly and beat the real link, the
   one bug the real-chat test found.
2. **The cut column.** Without a transcript match, a link that runs to the exact column a row
   is cut at goes on at the start of the next row, after its indent: in a chat full width,
   one short (your own prompt) and five short (tool output), measured on Claude Code 2.1.319;
   in a shell full width only. A row the terminal wrapped always continues. A link whose row
   ends in punctuation or a closing bracket ended there, and one shortened with "…" is not given
   out. A link on one row is left to the addon.

**Known limit.** A complete link that is not in a chat's transcript (a shell program's, or
Claude Code's own screens such as `/mcp`) and ends exactly at the cut column is joined to the
first word of the next row. A program's own cut rows never rewrap, so after a resize the
column rule no longer matches them and they open cut, as before; the transcript does not
care about columns, and Claude Code redraws its chat at the new width.

**Rejected: `FORCE_HYPERLINK=1` in the PTY's environment.** Claude Code then sends OSC 8
hyperlinks and every row of a link opens it whole, but a named link to a local file loses its
path (`absolute notes` instead of `absolute notes (C:\...\notes.md)`), its target is not
`http`, so the safelist drops it and afterterm's file link has nothing to match; the variable
also reaches every command Claude runs, and every link gets a permanent dashed underline.

**Verified** (captures and recordings in `docs/screenshots/wrapped-links/`): a real Claude Code
chat, 29 of 29 clicks open the whole 216 character link, before and after a font change, with
file links and a short named link unchanged; a fixture chat (a made-up session over a fixture
transcript) and a plain shell, 26 of 26, including the known limit; 43 cases in
`src/renderer/webLinks.test.ts`.

## Right-click

Copies the selection (and clears it) if one exists; on a file link, opens its menu (Open, Open
file location, Copy file path); otherwise pastes, the classic Windows console QuickEdit behavior.
The native context menu is suppressed.

The link is worked out when the right-click happens (`linkAt` in `Terminal/fileLinks.ts`, from the
cell under the pointer), not remembered from the hover: xterm forgets the link under the pointer
whenever its row redraws, and a chat's output and a click into the other half of a split both
redraw, so a remembered hover pasted instead. A right-click that only closes the menu does not paste.
While the menu is up no key reaches the shell, so an Esc to close it cannot interrupt Claude Code.

Which app a link opens in is `openKind` in `filePaths.ts`. A file afterterm opens must never run
(Aryan, 2026-11-06), so `openWithDefaultApp` in `main.ts`, the one place a file reaches Windows'
default app, refuses anything `isSafeForDefaultApp` does not list, and with no editor detected a
code file opens in Notepad. See `docs/edited-files/phases.md`, "Decisions".

## Find (Ctrl+Shift+F)

- `SearchAddon`, one instance per terminal. A floating bar in the top-right of the terminal
  area (like conhost's Find dialog) searches **only the active tab's** scrollback.
- Incremental highlight as you type, Enter / Shift+Enter to step forward/back, an `n/total`
  match counter driven by `onDidChangeResults`. Esc closes the bar only from the bar's own box.
  In the terminal Esc belongs to the program (it interrupts Claude Code), so afterterm never
  takes it there, on purpose: do not add an Esc to the terminal's key handler. The x closes the
  bar from anywhere.
- Switching tabs closes the bar (search is single-terminal by design).
- Implementation: the bar is a React sibling of `.terminal-host`. Terminal containers are
  appended *imperatively* into `.terminal-host` so React never reconciles them — keeping the
  manually-managed xterm DOM and the React-managed find bar from fighting over the same parent.
- Highlight colors: all-occurrences uses a dim low-key amber; the current match uses a bright
  bordered amber so the two are clearly distinguishable (an earlier pass had them too close).

### Selecting text while the find bar is open (AFT-44, 2026-11-08)

**The bug.** Once a search had been made, text could not be selected with the mouse (reported
2026-10-21). Reproduced in the harness: with the bar open and a program writing output, a drag
across two lines ended with only the word being searched for selected, within 300 ms.

**The cause.** `SearchAddon` (0.16.0) keeps its highlights current by re-running its last search
200 ms after every write to the terminal (`_updateMatches`, on `onWriteParsed`), and each run
selects the match it finds, starting from wherever the current selection is. That replaced the
user's selection. A chat that is working writes all the time, and the bar does not close when the
terminal is clicked (Esc only closes it while its own box has focus, see above), so the search
stayed live until the bar's x was used. Closing the bar with `clearDecorations` also cannot cancel a re-run
already waiting (read from the addon's source, not reproduced): that run would search for
`undefined` and clear the selection.

**What afterterm does now.** A search is ended by replacing its addon, not by clearing it
(`endSearch` in `Terminal/index.tsx`: dispose the addon, which cancels a waiting re-run, and
load a fresh one, `attachSearch`). It ends when the bar closes, when the thread changes, on a
left or right press in the terminal (capture phase, before xterm starts its selection) and on
Ctrl+Shift+A. The right press is included because a search left running selected its match again
after every write, so a second right-click copied the match instead of pasting. The listener is on
`mousedown`, not `pointerdown`, on purpose: xterm's scrollbar cancels `pointerdown`, so a press on
the scrollbar does not end the search. The bar stays open with its text and a blank match count;
Enter or an arrow starts a fresh search from the selection. After a plain click nothing is
selected, so then Enter searches from the top of the scrollback and Shift+Enter from the bottom.
The match that was selected stays selected, so Esc after a search still leaves the found text
ready to copy.

**Rejected: keeping the highlights while the user selects.** The addon has no way to refresh its
highlights without selecting a match, so keeping them means the selection is lost.

**Tested** (captures and recordings in `docs/screenshots/find-selection-fix/`, a cmd thread with a
program rewriting one row twice a second so the screen does not scroll): before the fix the drag
is replaced by the match (`23`, `24`, `20-before-fix-bug-whole-sequence.mp4`); after it, with the
bar open the selection is the dragged text 3 seconds and 6 writes later, Ctrl+C copies it, a second
search from the same bar works and a drag after it holds, a drag after closing the bar with its x
or with Esc holds, and Ctrl+Shift+A with a search live selects the whole buffer and keeps it
(`30-after-fix-whole-sequence.mp4`, `31` to `39`). `window.__afterterm.selection(tabId)` reads
xterm's selection for the harness.

## The jump button (Phase 9)

- One round button sits at the centre of the terminal card, and a matching one at the centre of
  the asleep pane, over the scrolled content.
- It shows only while you have scrolled away from an end of the output, and points the way you
  would need to scroll to get back: scrolled up, it points up ("to top"); scrolled down from
  there, it points down ("to bottom"). It hides once that end is within a few lines.
- It appears and disappears by scaling only, no fade, and carries no tooltip.
- A click scrolls to that end with an eased animation (instant under reduced motion).
- A wheel over the button scrolls the terminal or the pane underneath, exactly as if the button
  were not there.
- Only scrolling the user actually started counts. Output arriving, a refit, or the button's own
  animated jump never makes it appear; a click on it hides it at once.

Implementation: `src/renderer/jumpScroll.ts` holds the pure rule (which way the button points,
when it shows, the eased jump, the wheel-to-lines maths for a terminal, the user-scroll guard)
with its tests; `src/renderer/components/JumpButton` is the button itself; the terminal side
samples `viewportY`/`baseY` on xterm's `onScroll` in `Terminal/index.tsx`, and the asleep pane
samples its own `scrollTop`.

## Font zoom (Ctrl+scroll)

- **Per-tab** font size, clamped 6–40px.
- Persisted in `session.json` as `Tab.fontSize` and reapplied on the next spawn.
- The wheel handler runs in capture phase + `preventDefault` so xterm's viewport doesn't also
  scroll while zooming.

## File drag-and-drop

- Drop file(s)/folder(s) from Explorer to paste their absolute path(s), space-separated and
  quoted if they contain spaces.
- The path is resolved via `webUtils.getPathForFile`, exposed in preload as
  `window.afterterm.files.pathForFile` — Electron 32+ removed the old `File.path` property.

## No key reloads the window (AFT-26, 2026-11-08)

Electron gives an app a default menu when it sets none, and the window answers that menu's keys
even with the menu bar hidden. Its View menu held Reload (Ctrl+R) and Force Reload
(Ctrl+Shift+R). A reload restarts the page, which restores `session.json`, so every thread came
back asleep and the app landed on Home (Aryan, 2026-09-30: "doing ctrl+shift+R suddenly takes me
to home and puts all sessions to sleep"). A menu key acts only when the page did not use the key:
Ctrl+R in a terminal went to the shell, but Ctrl+Shift+R (which xterm ignores) and Ctrl+R with
focus outside a terminal reloaded.

`src/app-menu.ts` (`appMenuTemplate`) is Electron's default Windows menu without those two
items (and without its Help menu, which has no keys), set in `main.ts` before the windows open. Every other key the default menu answered stays
(copy and paste in text fields, Ctrl+0, Ctrl+Plus and Ctrl+Minus, F11, Ctrl+Shift+I for the
developer tools, Ctrl+M, Ctrl+W). The keys are not swallowed in `before-input-event` instead,
because the terminal needs Ctrl+R (reverse history search in PowerShell and bash). F5 was never
in the menu; in cmd it recalls the last command, as it should. Unit test: `src/app-menu.test.ts`
(no reload role anywhere in the menu, every other default role kept).

One exception is kept on purpose: the developer tools (Ctrl+Shift+I, in every build) have their
own Ctrl+R, Ctrl+Shift+R and F5, which reload the page while the developer tools window has
focus, and the app menu has no say over them.

**How it was tested.** A key sent through CDP (`drive key`) never reaches a menu item: Electron
runs a menu role on `BaseWindow.getFocusedWindow()` (read from Electron 35's own code), and a
harness window never has OS focus, so `drive key r --ctrl --shift` did nothing even before the
fix. So a harness run now logs every menu item that answers a key, once at startup
(`[harness] menu key <path> role=<role> key=<key>`, `logMenuKeys` in `main.ts`). Before the fix
the log listed `View > Reload ... CmdOrCtrl+R` and `View > Force Reload ... Shift+CmdOrCtrl+R`;
after it, neither, and the other thirteen keys unchanged. With two awake cmd threads, Ctrl+Shift+R,
Ctrl+R and F5 sent with the terminal focused and again with nothing focused left the page
unreloaded, the workspace on screen and both threads awake. Captures:
`docs/screenshots/reload-and-recovery/01` to `09`.

## A chat's terminal is resized as rarely as possible (AFT-11, 2026-11-08)

**Why.** Aryan saw blocks of Claude Code's output printed twice, the second copy wrapped at
another width. The check (`docs/screenshots/terminal-output-check/findings.md`) found that every
resize a PTY gets makes Claude Code redraw its screen, and when the terminal got narrower the
rows pushed above the screen stay in the scrollback, so the redraw prints them again below.
Plain output resized the same way never doubles, and the same is expected to happen with Ink
apps in any terminal on ConPTY (Windows Terminal was not tried). afterterm cannot stop the
redraw, but it was sending avoidable resizes:
coming back from Home resized every chat on screen wider and back (the fit ran before the
sidebar slid back in), a slow drag of the window's edge sent one resize per pause past the
80 ms debounce, a thread woken out of view ran at 80x24 and was resized when first shown, and
the size sync after a spawn could repeat the size the PTY already had.

**What was built.** `src/renderer/resizeGate.ts` (pure) keeps one gate per thread in
`Terminal/index.tsx` (`gatesRef`), and every resize goes through `sendResize`:

- `pty:create` takes the columns and rows, so a PTY starts at its terminal's size
  (`ptySpawnSize` in `main.ts`, 80x24 when nothing usable is sent), and answers with the size it
  really spawned at; the gate starts from that answer (`ptySizeFrom`), so it never believes a
  size the PTY lacks. A terminal that cannot measure itself (in the park, or in a column while
  Home or a project page covers the workspace) starts at the size of the last terminal shown
  alone with the same font size (`sizeHintRef`, `spawnSize`); at launch there is none yet. A
  re-attached terminal (AFT-33) takes the running shell's size. `isMeasured` is the one rule for
  a measured size (FitAddon answers `undefined` or NaN for a hidden terminal).
- `onTerminalResize` never sends the size the PTY already has.
- A drag of the window's edge: main sends `window:edge-drag` true on Electron's first
  `will-resize` and false on `resized` (or after 1.5 s with no step, so a missed end cannot leave
  the terminals unsized). The terminals keep following the window; the gates keep the newest
  size, and once the layout has been still for 120 ms after the end (`EDGE_DRAG_SETTLE_MS`; an
  end that arrives before the window's last size did sent a stale size, then the real one) the
  panes are fitted once more and each PTY gets that size once (`onHoldChange`). In dev builds
  `window.__afterterm.holdResizes(true|false)` plays the same two messages, and under the harness
  `window.afterterm.harness.edgeDrag({ widths, stepMs, end })` makes the main window emit
  `will-resize` per step and `resized` at the end, so main's handlers run too.
- Coming back to the workspace refits through each terminal's 80 ms `scheduleFit` instead of at
  once, so the sidebar's slide is one change.
- `AFTERTERM_RESIZE_PROBE=1` logs every spawn size and resize as `[resize]` lines.

**How it was tested.** `src/renderer/resizeGate.test.ts` (43 checks). In the harness, counting
`[resize]` lines: a wake on screen and a wake out of view each spawn at the pane's size with no
resize after, Home and back sends none, the sidebar and the split send one each as before, and a
6-step drag sends one resize where it sent six (an Ink-like script that reprints on every resize
printed one copy instead of six). Re-run on current main after the AFT-33 merge, where a reload
only sends AFT-33's own repaint pair. After review (2026-11-09) the drag was also played through
main's own events with `harness.edgeDrag`: ended by `resized`, ended by the 1.5 s fallback, and
ended at once after the last step, one resize each (the last gave two before the 120 ms settle).
A real mouse drag of the edge was not tested (the harness cannot drag without the person's
cursor). Captures and the full record: `docs/screenshots/terminal-output-check/`.

## Shortcut placement note

`Ctrl+Shift+A` (select all), `Ctrl+Shift+F` (find), and `Ctrl+scroll` (zoom) are handled in
xterm's custom key/wheel handlers, **not** `main.ts`'s `before-input-event`, because they act
on a specific terminal instance (its selection, search, font size). `Ctrl+Shift+F` uses Shift
deliberately — a bare `Ctrl+F` would clobber readline's forward-char inside shells / Claude Code.

## Dependency pinning

`@xterm/addon-web-links` and `@xterm/addon-search` are pinned to their latest **stable**
(0.12.x / 0.16.x), which declare no `@xterm/xterm` peer dep and so coexist with xterm 6. The
v6-native addon builds are still beta (`*-beta.x`, peer `^6.1.0-beta`) — do **not** bump to
those until xterm 6.1 ships stable, or `npm install` will hit ERESOLVE.

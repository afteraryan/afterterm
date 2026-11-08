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
  match counter driven by `onDidChangeResults`, Esc to close.
- Switching tabs closes the bar (search is single-terminal by design).
- Implementation: the bar is a React sibling of `.terminal-host`. Terminal containers are
  appended *imperatively* into `.terminal-host` so React never reconciles them — keeping the
  manually-managed xterm DOM and the React-managed find bar from fighting over the same parent.
- Highlight colors: all-occurrences uses a dim low-key amber; the current match uses a bright
  bordered amber so the two are clearly distinguishable (an earlier pass had them too close).

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
items, set in `main.ts` before the windows open. Every other key the default menu answered stays
(copy and paste in text fields, Ctrl+0, Ctrl+Plus and Ctrl+Minus, F11, Ctrl+Shift+I for the
developer tools, Ctrl+M, Ctrl+W). The keys are not swallowed in `before-input-event` instead,
because the terminal needs Ctrl+R (reverse history search in PowerShell and bash). F5 was never
in the menu; in cmd it recalls the last command, as it should. Unit test: `src/app-menu.test.ts`
(no reload role anywhere in the menu, every other default role kept).

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

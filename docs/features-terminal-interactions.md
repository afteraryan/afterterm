# Terminal Interactions

Conveniences that plain conhost/cmd has and afterterm now matches. All wired in
`src/renderer/components/Terminal/index.tsx` unless noted.

## Clickable links

- `WebLinksAddon` underlines plain `http(s)` URLs in output; click opens the default browser.
- OSC 8 hyperlinks (emitted by `ls --hyperlink`, ripgrep, and other modern CLIs) are handled
  by the terminal's `linkHandler` constructor option.
- Both route through the `shell:openExternal` IPC. `main.ts` **safelists** `http:` / `https:` /
  `mailto:` so a malicious escape sequence can't launch arbitrary protocol handlers.

## Right-click

Copies the selection (and clears it) if one exists, otherwise pastes — the classic Windows
console QuickEdit behavior. The native context menu is suppressed.

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

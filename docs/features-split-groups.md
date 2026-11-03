# Two threads side by side

The record of how design-06 (`docs/design-06-split-groups.md`, agreed with Aryan on 2026-11-03
against `docs/mockups/split-groups-final.html`) was built, on branch `split-groups` from
`worktree-split-groups-mockup` (90792f5). Not split into phases. Read the design first; this file
says where each part lives, what was decided while building it, and how it was tested.

In the UI it is a "group". In code it is a **split** (`Split`, `splitId`), because `Group` in
the code is a project.

## Where it lives

| Part | File |
|---|---|
| The rules, pure and unit-tested | `src/renderer/splitView.ts` (`splitView.test.ts`, 76 checks) |
| The state and its actions | `src/renderer/hooks/useTabState.ts`: `splits`, `makeSplit`, `ungroup`, `setSplitRatio`, and the split-aware `closeTab`, `addToGroup`, `removeFromGroup`, `placeThreadAt` |
| Saved and restored | `src/renderer/sessionMigration.ts`: top-level `splits` in `session.json`, written only when there is one |
| The main pane: columns, divider, drop zones | `src/renderer/components/Terminal/index.tsx`, styles in `src/renderer/index.css` (`.term-panes`, `.term-col`, `.term-card`, `.term-divider`, `.dz`) |
| The drag onto the main pane | `src/renderer/components/SidePanel/usePanelDrag.ts` (`paneAt`, `paneHover`, `dropOnPane`) and `app.tsx` (`paneTargetAt`, `onPaneDrop`) |
| The line joining the two rows, the other half's lighter row | `SidePanel/index.tsx` (`.sgw` wrapper, `isPartner`), `SidePanel.css` |
| Ungroup | `threadMenu.tsx`: an optional `ungroup` action, passed only by the sidebar row's menu |
| The header chip | `threadView.ts` (`chipText`), `Header/index.tsx` (also its `compact` variant for a half) |

## How it works

**One focused half, no set of on-screen ids.** `activeTabId` stays the one focused half. What is on
screen is derived from it: `panesFor(splits, activeTabId)` is the active thread's split, left to
right, or the active thread alone. So a split is on screen exactly when its focused half is the
active thread, and everything that already keyed off the active thread now means "the focused
half": the toast suppression in `handleNotification` (`viewing`), and done clearing on view. Rule 1
(the other half still toasts, its Done stays until it is focused) needed no code of its own.

**The two threads are always next to each other in the tab list, `a` then `b`.** `createSplit`
moves the dragged thread next to the other in left-right order; `placeThreadKeepingSplits` keeps
the pair together on every sidebar drop (a split thread dropped in its own project takes its
partner along; one dropped in another project leaves its split; any other thread dropped between
the two rows lands just below them); `restoreSplits` repairs a hand-edited file. Session order
(Ctrl+Tab walks the tab list) and panel order (`visibleThreadIds`, whose fold now never cuts a
pair apart through `foldLimit`) therefore pass through both halves one after the other, which is
Aryan's 1, 2+3, 4 example (rule 2) with no special case in the cycle.

**Ending a split.** `dissolveSplitOf` on Ungroup, on close (`closeTab`, which also hands the
focus to the other half when the focused one closes, through `activeAfterClose`: rule 3), and on a
move to another project (`addToGroup`, `removeFromGroup`, a sidebar drop: rule 6). Dragging a
split thread onto another thread makes a new split and ends its old one.

**Refused drops.** `paneDropTarget`: with a split on screen any drop is refused over the whole
pane with "Two at most"; otherwise a thread from another project (General counts as its own, a
thread whose project was deleted counts as General) is refused on the half under the pointer with
"Same project only". Dragging the thread already on screen, or a half of the split on screen, is
no target at all.

**The main pane.** `TerminalArea` used to keep every xterm container in one host and hide all but
the active one with `display: none`. It now renders one column per thread on screen (keyed by
thread id), each with the thread's whole header (`renderHeader`: dots menu, editor button, Files
button) and a card. Each card has a slot `div` React never touches; a layout effect keyed on the
panes moves each terminal's container into its column's slot, or back into a hidden park. An
asleep half shows its own `AsleepPane` inside its card (`renderAsleep`), so one half can be asleep
beside one awake; the existing reconcile effect needed no change for that. The jump button and the
find bar render in the focused half's card only. A press anywhere in a column (header or card)
focuses that half (`onFocusPane` is `handleActivate`). The focus outline is drawn by
`.term-card.focus::after` on top of the card, since the terminal's canvas covers the card itself
and an inset shadow on the card would be hidden.

**The divider.** The whole 12px gap between the columns is its hit area (the mockup's gap; the July
attempt's lesson was that 5px was missed and 9px was the least that worked). During a drag the two
columns' `flex` is set directly, with pointer capture so the drag keeps going over the canvases,
and the pane's ResizeObserver is told to do nothing; on release the ratio is committed to state
once and both terminals are fitted once, which is what resizes their PTYs. Limits 25% to 75%; a
double-click puts it back at 50/50.

**The drag onto the main pane.** The brief said the sidebar's `DndContext` had to reach the main
pane. The sidebar does not use `@dnd-kit` any more: since 0.12.0 its drags are its own pointer
code, `usePanelDrag.ts`. That hook now treats a thread carried past the panel's right edge as over
the main pane: it hides its line, asks the app what a drop there would do, lights the zone through
the app, and on release makes the split (or floats the card back on a refusal). Inside the panel
nothing changed. Run before and after in the harness: the same four drags (a reorder inside a
project, a thread onto another project's row, a thread out into General, a project into Pinned)
printed identical sidebars on the base commit and on this build.

**Saved.** `session.json` keeps each split's pair, the sides (`a` left, `b` right) and the
divider position. On load a split is dropped when either thread is gone, the two are in different
projects, the two are the same thread, or a thread is already in an earlier split. Both threads
come back asleep, as every restored thread does (rule 5), each with its own Wake.

## Decided while building

- **The divider's hit area is the full 12px gap**, from the mockup's CSS, rather than exactly
  9px. 9px was the July attempt's minimum that worked.
- **A refused drop's label is drawn in its own layer above the dragged card.** The card floats just
  right of the pointer (z-index 60) and, with the pointer over the left half, covered the centred
  "Same project only" label (found in the harness, capture 06). The red zone stays below the card;
  only the label (`.dz-text`) is above it.
- **Ungroup sits just before Close** in the row menu, after the editor entries.
- **The other half's row does not breathe** while it has the lighter selected look, as in the
  mockup (`.th.done:not(.sel):not(.on)`); its icon still shows Done.
- **The header chip, everywhere:** working is the spinner alone (hover says Working), a running
  server is the play icon and `:5173` (hover says Running). Needs you, Done and Asleep keep their
  words. `runningLabel` ("Running on :5173") stays for the hover card's Status row.

## Tested

Unit: `splitView.test.ts` (creating and ending splits, the refusals, the cycle order, the fold,
restoring), 11 new checks in `sessionMigration.test.ts`, 5 in `threadView.test.ts` for the chip.

Harness, 2026-11-03, on the secondary display with a made-up seed (shells only, no Claude
session ids). Captures and five recordings in `docs/screenshots/split-groups/`:

- Dropping on the right half and on the left half; the zone lights the half it would take.
- Both refusals, and that releasing on them changes nothing.
- Typing goes only to the focused half (`echo` in each, read back from each buffer).
- A toast from the unfocused half while the other was focused, and its Done kept until focused.
- The divider: no refit while held (capture 13), refit on release, the 25% limit, double-click.
- Ungroup from the row menu (and its absence from the header menu and from a lone thread's menu).
- Closing the focused half with Ctrl+Shift+W, and the other half from its row.
- Sleeping and waking each half on its own, from the header and from the row; both asleep.
- Ctrl+Shift+Down from 1 through 2+3 to 4 and back up; Ctrl+Tab the same way.
- A new thread from Ctrl+Shift+T opens alone.
- A split half dragged within its project takes its partner along; to another project, and Move to
  project from the menu, end the split.
- A relaunch (graceful quit, then a launch from the same data): the split, its sides and its
  divider come back, both halves asleep, each waking on its own.

Not tested in the harness: a toast for the focused half while the window has the focus (the
harness window on the secondary display does not hold the focus; the code path is the one that
was already there), and the rail tile and search palette landing on a split thread (they go
through the same `handleActivate` as a click, which was tested).

Found and left as it is: editing renderer code while the dev build has awake terminals can close
them, because the hot-reloaded terminal layer starts new PTYs before the old ones' exits are
handled. Dev builds only; a packaged build does not hot-reload.

# Handoff: sidebar order, drag and drop, and Archive

Decided with Aryan on 2026-11-01. This file holds every decision for this piece of work and where to see it. **Delete this file in the last commit of the work**, once everything below is built, tested and in `docs/to-verify.md`. The lasting record goes in the usual places (see "When it is done").

## Where to see the design

Two working mockups. They are the source of truth for look, motion and copy: open them, use them, copy their values.

| What | Artifact (Aryan's account) | Same page in the repo |
|---|---|---|
| Archive with awake threads | https://claude.ai/artifact/EkP5y8S51DbVcS23cychmH | `docs/mockups/sidebar-archive-with-awake-threads.html` |
| Drag and drop in the panel | https://claude.ai/artifact/A2noP6uFioUUR6KpfyRrEa | `docs/mockups/sidebar-drag-and-drop.html` |

The repo copies are identical to the artifacts. Open them in a browser; everything is inline.

## The bug entries this closes

All in `docs/bugs.md`:

- "Projects in the panel's Recent group swap places whenever a thread in another project is used" (2026-10-22)
- "Opening a chat from another project moves that project to the top of Recent in the sidebar, without typing anything and without an animation" (2026-09-30)
- "Drag and drop in the sidebar: projects cannot be reordered, dragging to Pinned does not pin, no indicator for a drop at the top, hovered projects highlight during a project drag, and a thread cannot be dragged out of every project" (2026-09-22). Its "Fix direction" paragraph is out of date: Recent is now reorderable. Follow this file, not that paragraph.
- "Archiving a project from the sidebar hides it everywhere except Home, instead of moving it into Other projects" (2026-10-02)
- "The search palette (Ctrl+Shift+P) does not list archived projects" (2026-10-07): no longer needed once archived projects are ordinary projects in Other projects. Close it as resolved by this work.

## 1. Nothing moves because it was used

The panel (Pinned, Recent, the threads inside each project) never reorders itself because something was used.

- Recent stops sorting by `lastActiveAt` (`panelLists` in `src/renderer/attention.ts`). Each project keeps its place.
- Which projects are in Recent does not change: still the 3-day window or an awake thread (`RECENT_WINDOW_MS`, `isRecent`). Only the order changes.
- A project that enters Recent (opened from Home, the Other projects drawer, the palette, or one of its threads woken) goes at the **top** of Recent and then stays where it is while it remains in Recent. If it drops out and comes back later, it enters at the top again.
- A new or resumed thread goes at the **top** of its project (as `insertNewThread` does today). The threads already there each shift down one and keep their order.
- Opening a chat, typing in a thread, a notification, a wake: none of these move a project or a thread.
- When a row enters at the top, the rows below slide down with an animation (the slide in the drag mockup's drops, `flip()`, is the reference).
- **Home is not part of this.** Home's Projects list keeps its order by recent activity.
- The order must survive a restart (persist it; new persisted fields go in `sessionMigration.ts`).

## 2. Drag and drop in the panel

Built to `docs/mockups/sidebar-drag-and-drop.html`. Today's code: `src/renderer/components/SidePanel/index.tsx` (`handleDragEnd`, `onMoveGroupAfterGroup`), `moveGroupAfterGroup` and `moveTab` in `src/renderer/hooks/useTabState.ts`.

**Projects**
- Drag a project up or down inside Pinned and inside Recent. The order is kept (and persisted).
- Dropping a project into Pinned pins it, with the toast "Pinned <name>". Dragging a pinned project down into Recent unpins it, with "Unpinned <name>".
- A drop line shows where it lands, including above the first project of a section.
- While a project is dragged, no other project row highlights.
- The dragged card shows the project row plus "N threads".

**Threads**
- Drag a thread between two threads (inside its own project or another): an indented line shows the exact place, and it lands there. This is also how threads are reordered by hand.
- Drop a thread on a project's own row: that row highlights and the thread goes in at the top of that project.
- **Taking a thread out of its project:** drop it on the Pinned heading or above it. It goes into General. The line shows above the Pinned heading. **No area opens during a drag** (an earlier version opened a General drop zone at the top and pushed the whole list down under the pointer; Aryan rejected it). General itself shows only while it holds a thread.

**The card and the line**
- The dragged card is the full row, floating **to the right of the pointer**, vertically centred on it, so the line is never under the card.
- The line: a 2px bar in the accent blue with a small ring at its start. It slides between places, but when it first appears it appears in place (no slide in from its last position).
- No line shows while the row would land where it already is. Letting go there, letting go on nothing, or Esc: the card floats back to the row.
- A press becomes a drag only after the pointer moves 7px, so a click never flashes the card or the line.
- The source row stays in place, dimmed, during the drag.
- Targets are computed from the layout (`offsetTop`), not from rects mid-animation, so they never flicker while rows slide.
- The list scrolls with the wheel during a drag, and holding a dragged row near the list's top or bottom edge scrolls it.
- On a drop, everything that moved slides into place, and the dropped row slides from where the card was.

**From and to, on a thread's card**
- While the thread would stay in its own project, the card is just the thread.
- Once it would land in a different project (or in General), a line opens under the thread's name on the card: the old project's coloured folder and name, an arrow, the new project's coloured folder and name. It folds away again if the thread is brought back over its own project. General shows as a dashed grey folder and "General".
- **When both names are too long for one line:** it stays one line, the card's width. The folders and the arrow are never cut. The **new** project's name gives way first, down to about four letters and an ellipsis (34px minimum); the **old** project's name keeps the most (48px minimum, shrink weight 1 against 6). Aryan's reason: the pointer is already over the new project, so the person can see it; the card is the only place that still says where the thread came from.

## 3. Archive

Built to `docs/mockups/sidebar-archive-with-awake-threads.html`. Today's code: `setGroupArchived` in `src/renderer/hooks/useTabState.ts`, `buildProjectMenu` in `src/renderer/projectMenu.tsx`, the Archived section on Home (`homeView.ts`, `components/Home`), the palette (`paletteView.ts`).

- The menu item still says **Archive**, and it is never greyed out.
- Archiving moves the project into the panel's **Other projects** drawer. It is no longer hidden everywhere except Home.
- **A project with awake threads:** clicking Archive opens a window first, in the look of the Restart to update window (`src/renderer/components/RestartToUpdate`, `UpdateDialog`; the mockup copies their values):
  - Heading: "Archive", the project's folder icon in its own colour, then its name and "?".
  - A list of the awake threads, one row each: kind icon and name on the left; on the right the thread's **current status** with the same icon and words as the sidebar and the hover card (`statusText` in `threadView.ts`: "Working", "Running on :4321", "Done", and so on). A thread with no state shows "Awake" in grey.
  - Footer: an amber bell and "These threads will go to sleep", then **Cancel** and **Archive** (Archive focused). Esc cancels; a click beside the window does not close it.
- On Archive: the awake threads go to sleep one after the other (each row's icon turns into the moon, about 140ms apart), then the project folds out of Recent and the rows below slide up, the Other projects count bumps, and the toast says **"Moved to Other projects"**. Aryan liked this sequence specifically; keep it.
- A project with nothing awake archives straight away, with the same fold, bump and toast.
- An archived project sits at the top of the Other projects drawer.
- **Using it brings it back:** opening it from the drawer, or waking one of its threads, brings it back into Recent at the top (section 1), with the slide and a short highlight on its row.
- **Home's Archived section goes away.** Archived projects show in Home's normal Projects list like any other project.
- Not decided yet, ask Aryan before choosing: what the project menu's Restore item becomes (today it shows for an archived project), and whether archiving a pinned project still unpins it.

## When it is done

1. `npm test` passes, with unit tests for the new order rules (Recent's order, entering at the top, nothing moving on use, archive and its return) in the existing pure modules' test files.
2. A full self-test in the dev build through the agent harness on the secondary display (`scripts/agent-harness/README.md`), recorded on video, every capture kept under `docs/screenshots/<this work>/`.
3. The four bug entries above move from `docs/bugs.md` to `docs/bugs-fixed.md`, the palette entry is closed, `CHANGELOG.md`'s Unreleased gets the user-facing lines, `docs/to-verify.md` gets each change with how to check it, and `PHASES.md` loses the lines these close (the "Decided and waiting to be built" sentence at the top, and the backlog lines on the drag and drop and on opening a chat moving its project).
4. Delete this file in the same change.

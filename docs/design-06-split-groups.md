# Design 06: two threads side by side

Agreed with Aryan on 2026-11-03 against `docs/mockups/split-groups-final.html`. The page he chose
from, with every option shown, is `docs/mockups/split-groups.html`; its captures are in
`docs/screenshots/split-groups-mockup/`. This is not split into phases (Aryan, 2026-11-03).

## What it is

Two threads of the same project, or two General threads, can be shown side by side in the main
pane. In the sidebar they become a group: the two rows stay in their project, joined by a thin
line on their left. A group has no name and no number. It exists only while it holds two threads.

This release allows two threads in a group and no more. Three or more, and other arrangements,
come after two is solid.

## The decisions

| Question | Decision | Rejected |
|---|---|---|
| Where do you drop a thread to put it beside another? | On either half of the open terminal. The half it will take lights up while you drag. | Only the screen's edges (middle opens it); onto another thread's row in the sidebar |
| How does a group look in the sidebar? | A thin line on the left joining the two rows. No name, no number. | A "Group 1" row with the threads under it; the line with "Group 1" at its top; both rows in a box |
| What goes above the two terminals? | Each half has the full header a thread has today. | One group header with a name strip per half; one header that follows the focused half |
| How do you see which half you are typing in? | A thin light outline on that half. | The other half dims; a coloured line on top |
| How do you take a group apart? | Right-click either thread of the group in the sidebar: Ungroup. Nothing in the work area does it. | An Ungroup button above the terminals; dragging a thread out; right-clicking a group row |
| When both threads of a group are asleep, how do you wake them? | Each half has its own Wake button, as a single thread does today. | One Wake both button; both |

Also decided on 2026-11-03, for the header everywhere, not only in a group:

- A working chat's chip is the spinner alone, no "Working" word.
- A running server's chip is the play icon and the port alone (`:5173`), no "Running on".
  "Needs you" and "Asleep · 2d" keep their words.

## How it behaves

**Making a group.** Drag a thread's row from the sidebar over the open terminal. The half under the
pointer lights up; dropping puts the dragged thread on that side and the open one on the other.
Focus goes to the dragged thread. The dragged row moves next to the other in the sidebar, in their
left-right order.

**Drops that are refused.** The drop zone turns red with a short label and releasing does nothing:

- "Same project only": the dragged thread is from another project (General counts as its own).
- "Two at most": a group is already on screen.

Dragging a thread that is already in a group into a new one ends its old group.

**Clicking.** Clicking either thread of a group shows the group with that half focused. Clicking
any other thread shows it alone, as today. Clicking a half (header or terminal) focuses it; typing
goes to the focused half only. The focused row in the sidebar has the selected look, the other
half's row a lighter one.

**The divider.** Drag it to resize, between a quarter and three quarters. Double-click it for half
and half. Terminals refit and PTYs resize once, when the drag ends, not on every move.

**Ending a group.** Ungroup in a grouped row's right-click menu, between Sleep and Close. Both
threads keep running; the focused one stays on screen alone. Closing either thread also ends the
group, and the other stays on screen alone.

**Sleep and wake.** Each half sleeps and wakes on its own, from its header's menu or the row's.
An asleep half shows the asleep pane (the dimmed tail, Wake, "Chat asleep since 2d ago") inside
its half. The group stays while either or both halves are asleep.

## Rules the mockup does not show

All agreed with Aryan on 2026-11-03.

1. Only the focused half counts as being looked at. The other half still gets its toasts while
   the window is focused, and its Done stays until that half is focused (Aryan: "If I'm focusing
   on one, I need a toast for the other").
2. Ctrl+Tab, Ctrl+Shift+Down/Up, the rail tiles and the search palette, landing on a grouped
   thread, show its group with that half focused (the same as a click). Aryan's example: threads
   1 to 4, with 2 and 3 a group. From 1, Down shows the group with 2 focused; Down again keeps
   the group on screen and moves the focus to 3; Down again shows 4 alone. Up runs the same way
   back. The two threads of a group are always next to each other in both orders, so the cycle
   passes through a group's halves one after the other.
3. Ctrl+Shift+W closes the focused half's thread; the group ends and the other half stays alone.
4. A new thread (Ctrl+Shift+T, New thread) opens alone; it never joins the group on screen.
5. Groups survive a relaunch: `session.json` keeps the pair, the sides and the divider position.
   Both threads come back asleep like every restored thread, each with its own Wake.
6. Moving a grouped thread to another project ends its group.
7. The project page's lists, the hover card and Home are unchanged: a grouped thread is listed as
   a thread.

## Not in this release

- Three or more threads in a group, top and bottom splits, any other layout.
- Groups across projects.
- Group names, renaming, a group row.
- Keyboard shortcuts for splitting or moving focus between halves.
- Dragging a half by its header to swap sides.

## Building it

- In code the new thing is called a **split** (`Split`, `Tab.splitId` or a `splits` list), never
  a group: `Group` in the code is still a project (`TabBar/types.ts`).
- Persisted through `sessionMigration.ts` like every new field; an unreadable split is dropped,
  leaving two plain threads.
- The terminal area shows one xterm container today and hides the rest with `display: none`
  (`Terminal/index.tsx`). A split shows two, each sized by its half; each half's xterm needs its
  own fit on resize and on divider release.
- The drag starts from the sidebar's existing `@dnd-kit` rows (`SidePanel/index.tsx`). The main pane
  becomes a drop target, so the `DndContext` has to reach it; the sidebar's own drags (reorder,
  move to project) must keep working unchanged.
- Header and FilesButton render per half; the chip change applies to the single-thread header too.
- An earlier, unmerged attempt at panes (July 2026, before the projects-and-threads redesign) is in
  the worktree `.claude/worktrees/multi-pane-layout`, uncommitted, with its own
  `docs/design-02-multi-pane-layout.md`. Its code is on a base four months old and is not reused.
  Two lessons from its testing carry over: a 9px hit area for the divider (a 5px one was missed and
  selected terminal text instead), and refitting only on release.

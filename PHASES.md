# Phases

What is still open in afterterm, and, once a round of work starts, the phases it is split into. Keep it current as work happens: what has to be done, what is done, what is pending.

**No round is in progress.** The last one, projects and threads (Phases 0 to 9 and the fixes after them), was released as afterterm 0.9.0 on 2026-09-30. Its full record, with every decision and its date, is [`docs/phases-01-projects-and-threads.md`](docs/phases-01-projects-and-threads.md). When the next round starts, ask Aryan whether to split it into phases; if he says yes, the phases go here and the items below move into them.

Two other lists stay where they are: changes waiting for Aryan to check in his build are in [`docs/to-verify.md`](docs/to-verify.md), and the edited-files feature keeps its own status in [`docs/edited-files/phases.md`](docs/edited-files/phases.md).

## Unphased backlog

### Bugs and requests that need a decision or a design from Aryan first

Each one is an open entry in [`docs/bugs.md`](docs/bugs.md).

- A chat running a background agent shows only its server as running: show both, or something else.
- Restore the previous session a few threads at a time, with progress, instead of waking each thread by hand.
- A list of the awake threads, to switch between them when they are spread across Pinned and Recent.
- The sidebar's drag and drop, as one piece of work: reorder within Pinned, drop into Pinned to pin, a line for a drop at the top, no highlight on projects during a project drag, and a way to drag a thread out into General.
- Fold the Search and New thread rows into the sidebar's top row.
- A search box on Home's project list, with matching projects animating in and out.
- The Other projects drawer: type to search it, and a New project button (one piece of work).
- Project icons: more and better built-in icons, and uploading an image as an icon (one piece of work).
- Choose which waiting thread a rail tile opens.
- Open a chat's Claude Code session in a terminal outside afterterm, from both thread menus (and decide whether the afterterm thread sleeps first).
- File links: open a file in its type's default app, and offer Open file location on right-click. Today MP4 and HTML links open in VS Code. Which types go to the default app needs a rule, since Windows often maps `.ts` to a video player.
- Opening a chat moves its project to the top of Recent; Aryan wants a project to move up only when something is typed in it, and the move animated.
- Thread states lost on a restart (only Mark as unread survives): keep the real state and show it over Asleep. The quick version that turns them into Unread was turned down on 2026-09-29.

### Bugs that need to be reproduced first

Each one is an open entry in [`docs/bugs.md`](docs/bugs.md).

- The white bar above the toasts, and a bar with no toast at all. Hardened in 0.9.0 but never reproduced; open until Aryan says it is gone.
- After the laptop sleeps, the window and its toasts move to the primary screen and stay there.
- A block of Claude's output is printed twice in the terminal.
- The top part of a submitted prompt is greyed out. Check against Windows Terminal first: it is likely Claude Code's own rendering.

### Ideas not yet placed

- Worktree grouping on the project page.
- Daily check-in ("working on these today?") as an optional Home mode.
- Keep closed General threads somewhere, if losing them turns out to hurt.
- Drag a thread between projects in the sidebar (Move to project covers it; drag is nicer).
- Multi-window: one window per pinned project.
- Rename `Group` and `Tab` to Project and Thread in the code.
- Project notes (`docs/ideas.md`), reconsidered after the status-note rejection.

### Decisions Aryan takes on his own time

- Whether the "Last here 2d ago" line under Home's date stays. It is an experiment; nobody asks about it and nobody extends it.

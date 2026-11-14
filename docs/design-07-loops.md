# Design 07: Loops

Agreed with Aryan on 2026-11-12 and 2026-11-14. Linear issue: AFT-82 (every decision is also a dated comment there). Mocks, both clickable, both drawn at the real window size:

- Home: `docs/mockups/loops-home.html` (published at https://claude.ai/artifact/XkyTGajF6cx3uRoVRT2X28)
- The workspace card: `docs/mockups/loops-always-visible.html` (published at https://claude.ai/artifact/MCH9AJjJWAvGUXVHhGrLHk)

The mocks are the source of truth for sizes, colours, spacing and motion. Where this document and a mock disagree, ask Aryan.

## What a loop is

A loop is a piece of work Aryan started in any project: a feature, a bug, or an idea he has discussed with Claude. Its purpose is to show what he is working on now and what he started long ago and has not finished. A thought only in his head is not a loop. Loops are independent of Linear and of PRs; nothing starts or closes a loop from a PR or a branch.

| Field | Meaning |
|---|---|
| Title | Short name |
| Project | The afterterm project it belongs to; "General" when it belongs to none. The agent decides it; afterterm never checks or changes it; Aryan can move it |
| Label | Exactly one of Feature (work started), Bug (a fix started), Idea (discussed, not started). Icons: a box, a bug, a bulb |
| Status | Open, Closed or Rotting |
| Description | What the loop is for. Written when it starts, rarely changed |
| Status note | Where it was left: the last thing that happened. Replaced on every update |
| Remembered chat | One chat. The chat that created the loop; when another agent edits the loop from another chat, that chat replaces it. Aryan's own edits in the UI do not change it |
| Times | Created, last activity, last ping |

**Sub-loops.** One level only (a loop and its sub-loops). A sub-loop always has its parent's project and has the same fields. A parent with open sub-loops cannot just close: the UI asks first ("Close 2 sub-loops?" style, words not sentences), and an agent must discuss it with Aryan before closing it.

**Rotting.** A loop rots after **5 calendar days** with no activity. Activity is a ping, a status note, or any edit, by an agent or by Aryan; activity in a sub-loop counts for its parent. Weekends count, and a loop waiting on someone else rots too (both accepted). Ideas never rot. Closed loops never rot. Any activity makes a rotting loop Open again. (Data behind 5 days, from his chat history: half his comebacks to a branch happen within 1.5 days, 75% within about 4; at 5 days about 1 in 5 real comebacks would pass through rotting first.)

**Archive** is a place, not a status: an archived loop leaves every list and sits under an Archived filter. **Delete** is recoverable for 30 days. Agents can archive and delete too. There is no merging of loops.

**Order.** Most recent activity first. A closed loop keeps its place, with a green tick and a dimmed title, until more recent loops pass it.

## How agents and Aryan change loops

- **Aryan:** in the UI (right-click menus below).
- **Agents:** through a command-line tool, `afterterm loops`, with commands to list, show, start, update (status note, description, label, title, project, parent), ping, close, reopen, archive and delete. Agents create and close loops freely; Aryan reopens one if an agent got it wrong.
- **Ping** means "I am working on this". It brings the loop to the top. An agent pings only when its last ping was more than a day ago.
- **Why a CLI and not MCP** (research on AFT-82): no setup in any project, works for any agent that has a shell, costs nothing in context when idle. afterterm puts the command on PATH and passes the thread and project in through the environment, only in its own terminals, so an agent never has to work out which chat it is in.
- **One writer.** afterterm's main process owns the loops store; the CLI talks to it over a local pipe with a per-launch token. When afterterm is not running the CLI says so plainly and does nothing.
- **Agents learn about loops** from a short skill (what counts as a loop, when to start, update, ping and close, the parent-close rule) and from a chat-start hook (Claude Code's SessionStart, through afterterm's existing hook, only when `AFTERTERM=1`) that lists the open loops for the chat's folder and, for a resumed chat, the loop it was on with its status note. This prevents duplicate loops.
- **Opening a loop's chat** (right-click, Open chat) must work for a chat in a worktree and one not in a worktree, awake, asleep or closed (resumed from the project's history), in the folder the session was really in. A chat whose worktree was deleted is an open case to test.

## The workspace card

Mock: `loops-always-visible.html`.

- A floating card, 320px wide, at the top right over the terminal, in the workspace only. It shows every project's loops.
- Opened and closed only by the loops button in the thread header (loops icon and the remaining count) or **Ctrl+Shift+L**. No shrink button. Clicking outside it or pressing Esc never closes it. It stays open across threads until closed. It flies into the header button and back.
- Heading: "Loops" and a solid amber "N rotting" button (amber fill, dark text and clock icon) that opens Home's Progress filtered to rotting.
- The 5 most recent loops, open or closed, never rotting.
- A row: status circle (open ring, green tick when closed), the label icon (grey), the title (wraps, never cut off), the sub-loop count "1/5" (closed of total; clicking it opens the loop), the project name in the project's colour, the time since last activity.
- A click on a row opens it in place: the row and a box under it become one grey shape with no gap, the full width of the list, holding the description and, under it, the status note in grey with a small clock and no time. Then its sub-loops, which open the same way. Opening and closing fold with an animation.
- Right-click: Open chat, Close or Reopen, then Update, which opens beside it: Status, Label (with icons), Rename, Move to project (not for a sub-loop), Archive, Delete.
- Foot: "N remaining" (open plus rotting, never closed) over a thin bar that fills green with the closed share, no closed number, and a small white "All" button that opens Home's Progress.

## Home

Mock: `loops-home.html`, the Progress layout. The page itself never scrolls; each section that overflows scrolls on its own.

- **Left, the projects section, at 90% of today's sizes:** the date and its pills, Pinned as today's tall cards in two columns, Projects in two columns. In the Projects heading, left of the plus, a search box: always faintly visible, no placeholder, fixed width, filters as you type, a long query shows its end with a leading ellipsis. Show more opens the full list. This column scrolls on its own.
- **Right, the Progress column, a fixed 472px** (no resize handle). Its heading has a button that closes it (the projects take the full width, and a "Progress N" button at the top right opens it again), with a slide.
- **Progress, top to bottom:** the streak calendar card and the count card (both at 80% of the mock's base size), then the filter, then the list of every loop at full size, scrolling on its own.
- **The count card:** the remaining number large, then open, rotting (amber number) and closed, each a button that filters the list, then the bar.
- **The filter:** an icon only. It slides open in the same row: Status (All, Open, Rotting, Closed, Archived), the three label icons, a Project dropdown. A highlight slides between choices; the list fades in row by row when a filter changes; closed, active filters show as removable chips beside the icon.
- **The list** uses the same rows, opening, joined box and right-click menu as the card.

## The streak calendar

- 22 weeks (about five months), the last column always the current week. Every day of the week labelled. The card never changes size. The arrows move four weeks, with a pure slide (no fade, no blur) on a smooth ease-out.
- "N day streak" and "Longest N days". The current streak is outlined subtly. A legend from less to more.
- **A day counts the messages Aryan sent to Claude that day**, across all projects: user turns in the transcripts, excluding tool results, subagent (sidechain) lines, meta lines, interrupts and local-command wrappers, deduplicated by uuid, in local time. Counted from structure fields only; the text is never used or stored.
- **Shades:** none is empty; 1 to 4 darkest; 5 to 14 dark; 15 to 39 bright; 40 or more brightest. Lenient at the start so a new user sees green quickly; the top is earned.
- **Filling it:** afterterm keeps its own count per day. On the first launch of the version that has loops (a fresh install or an update from an older version), it reads every transcript still on disk and fills the past, then keeps counting as messages arrive. It must keep its own counts because Claude Code deletes old transcripts (Aryan's go back only to 2026-09-26). The same holds for every user, not only Aryan. No AI is involved and nothing leaves the machine.
- His data for reference (2026-11-14): 38 active days, 1,771 messages, median 34 per active day, busiest 187.

## Visual rules

- Solid colours only. No tinted washes: no coloured background with text or a dot of the same hue, whatever its alpha.
- Minimal words in the UI. No sentences.
- Plain, literal labels.

## Not built and not decided

- Exact command and flag names of `afterterm loops`.
- Where the chat-start hook's text sits and how long it may be.
- What happens when a loop's chat cannot be resumed (its worktree is gone).
- The project page may be removed (AFT-94); loops do not depend on it.

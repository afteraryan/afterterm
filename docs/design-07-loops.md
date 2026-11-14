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

## Frontend spec: exact values

Every value below is the final, on-screen size at 100% zoom on Aryan's 1920 by 1080 screen. The mocks reach some of them through CSS `zoom` (0.9 for the projects section, 0.8 for the two Progress cards); build to the final values, not by copying the zoom.

### Colours (solid only)

| Token | Value | Used for |
|---|---|---|
| bg | #212121 | Home and workspace surface |
| side | #171717 | Rail, panel, title bar |
| pane | #191919 | Terminal card, filter segment track, filter dropdown |
| card | #262626 | The floating card |
| raise | #2f2f2f | Pinned cards, count card, calendar card |
| hover | #2f2f2f, hover2 #383838 | Row hover; the card's row hover is #383838 |
| joined | #333333 | An opened loop's row and its box |
| line | #333333 | The card's border and foot rule |
| text #ececec, text2 #b4b4b4, text3 #8e8e8e, text4 #5c5c5c | | |
| btn #ececec on btn-text #0d0d0d | | All button, selected filter chip, active filter segment's text stays text |
| green #4ade80, green-ink #06170b | | Closed tick, the remaining bar's fill |
| rot #e8a23a, rot hover #f3b04c, ink #141414 | | Rotting button, rotting count circle, rotting status circle |
| track #474747 | | The remaining bar's empty part |
| menu #2f2f2f, menu border and hover #3d3d3d, danger #f87171 | | Right-click menus |
| heat: none #363636, 1 #1f6b47, 2 #2c9a62, 3 #4ade80, 4 #b9f6d0 | | Calendar squares |
| search box #262626, hover and focus #2a2a2a | | Projects search |

Project colours come from the project. Label icons are grey (text3; text4 on a closed loop).

### Icons

Label icons (14 by 14 viewBox, stroke 1.4, round caps and joins, no fill), paths in the mocks' `I.Feature`, `I.Bug`, `I.Idea`: Feature is the box (isometric cube), Bug the bug, Idea the bulb. Status: open is a 1.5px ring in text3; closed a filled green circle with a dark tick; rotting a filled amber circle with a dark clock. The loops icon is two overlapping circles. The rotting button and the status note use a small clock.

### Home, the projects section (today's Home at 90%)

Take today's Home values (Home.css) and multiply every size by 0.9: date 23.4px; Pinned cards min height 83px, padding 14px, radius 14px, name 12.6px weight 500, pill 22px high with 11.3px text, time 11.7px, gap 11px, two columns; Projects rows: name 12.6px weight 500, padding 9px 11px, icon 14px, time 11.7px, two columns; section labels 12px. The search box: 171 by 23px, radius 6px, icon 12px, text 11.7px, no placeholder, fixed width (does not grow on focus), a long query shows its end with a leading ellipsis. Show more toggles the full list. The section scrolls on its own; the page never scrolls.

### Home, the Progress column

- Width fixed at 472px; 40px gap to the projects section; 40px page padding on both sides. No resize handle.
- Heading "Progress" (10px text3 in the mock at 0.8; use 10px) with the close button at its right. Closing animates the column to zero width (grid columns, 340ms, cubic-bezier(.2,.8,.2,1)); a "Progress N" button (30px high, raise background, 12.5px) appears at the top right and opens it again the same way.
- The calendar card and the count card are 472px wide. Calendar card: padding 9px 10px 8px, radius 10px, gap 6px; heading "N day streak" 13.6px weight 500; "Longest N days" 9.2px; squares 16px with 3.2px gaps, radius 3.2px; month labels 8.8px; day labels Sun to Sat 9.2px; legend 8.8px; arrows 16px.
- Count card: padding 9px 10px, radius 10px, gap 6px; the remaining number 19.2px weight 500 with "remaining" 10.4px; open, rotting, closed buttons 18.4px high, text 10px, the rotting number in an amber circle 13.6px; the bar 4px.
- Filter row (full size): a 22px icon button; the segments 19px high with 11.5px text, the project dropdown 22px high; chips 20px high with 11.5px text.
- The list (full size): rows 31px, title 12.5px, padding 0 8px, radius 8px, gap 8px; status circle 11 to 12px; label icon 12px; "1/5" 11px; project name and time 11.5px; sub-loop rows 26px with 12px titles, indented 21px.
- An opened loop: the row and the box share #333333 with no gap (row radius 8px 8px 0 0, box 0 0 8px 8px), the box spans the list's full width, padding 2px 8px 7px, description 12px text, status note 11.5px text3 with an 11px clock, line height 1.45, 6px between them, nothing truncated.

### The workspace card

320px wide, 64px from the top of the main pane and 24px from its right edge, radius 14px, 1px #333333 border, shadow 0 12px 32px #000. Heading padding 10px 10px 8px 14px, "Loops" 13px weight 500, the rotting button 24px high, padding 0 9px, radius 7px, 12px weight 500. Rows as in the Progress list, except titles wrap (line height 1.35, 6px top and bottom padding) and are never cut off. Foot: border-top 1px #333333, padding 10px 10px 10px 14px, "N remaining" 12px, the bar 5px, the All button 22px high, padding 0 9px, radius 6px, 11.5px weight 500. The header button: 30px high, loops icon and the remaining number 12px, highlighted while the card is open.

### Menus

Right-click menu: min width 176px, padding 4px, radius 10px, items 13px with padding 6px 10px and radius 7px, a check column for choices, label icons beside Feature, Bug and Idea, a chevron for submenus. A submenu opens beside its parent (to the left when there is no room on the right), never replaces it. Delete in danger red.

### Motion (all off under reduced motion)

| What | How |
|---|---|
| A loop opens | Its box and sub-loops grow from zero height and fade in, 240ms, cubic-bezier(.2,.8,.2,1), the sub-loops 30ms after the box |
| A loop closes | They fold to zero height and fade, 200ms, same curve, then the row settles |
| The card opens or closes | It flies to and from the header button (scale and move), 300ms; closing cubic-bezier(.4,0,.2,1), opening cubic-bezier(.2,.8,.2,1) |
| Progress closes or opens | The column's width animates, 340ms, cubic-bezier(.2,.8,.2,1) |
| The filter opens | The segments slide open in the row (width and opacity), 320ms; the highlight slides between choices, 240ms |
| The filter changes | Rows fade up 6px into place, 300ms, 28ms apart, at most 300ms of delay; filter chips pop in, 220ms |
| The calendar moves | The old weeks slide out one side while the new slide in from the other, full width, 520ms, cubic-bezier(.16,1,.3,1); no fade, no blur |

### In the mocks, ignore

- `loops-home.html`: the layouts other than Progress (Two columns, Three columns, Top band, Board, Strips, Panels) and their code, the resize handle code, the config box, the stage scaling and full-screen code, the fake data, and toasts that stand in for navigation.
- `loops-always-visible.html`: the "Opened loop" and "Row and box" switches (decided: full width, joined), the "Shrunk" switch (only a preview of the closed state), the full-screen code, the fake data and toasts.

## Visual rules

- Solid colours only. No tinted washes: no coloured background with text or a dot of the same hue, whatever its alpha.
- Minimal words in the UI. No sentences.
- Plain, literal labels.

## Not built and not decided

- Exact command and flag names of `afterterm loops`.
- Where the chat-start hook's text sits and how long it may be.
- What happens when a loop's chat cannot be resumed (its worktree is gone).
- The project page may be removed (AFT-94); loops do not depend on it.

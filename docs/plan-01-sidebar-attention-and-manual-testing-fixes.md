# Plan 01: the next round of work after the projects-and-threads phases

**Status.** This plan was executed as Phases 7, 8 and 9 (branches `phase-7-attention-state`,
`phase-8-sidebar-rail-and-panel`, `phase-9-output-and-visual-fixes`), merged to `main` through
PR #23 on 2026-09-19, with follow-ups merged through PR #31 on 2026-09-20. No release has been
cut yet: Aryan is using the build first. Section 3's fifteen questions were all answered; the
answers are recorded in `PHASES.md`'s Phase 7, 8 and 9 sections and its Log. `docs/bugs.md` is
empty.

Written 2026-09-18 against branch `manual-testing-fixes`, which holds Phases 0 to 6 of
[`design-02-projects-and-threads.md`](design-02-projects-and-threads.md) plus every bug logged
from Aryan's manual testing. `main` is still at 0.8.0; nothing from the phases has shipped, and
the next release is 0.9.0 (the version bump happens at release time and is not planned here).

This is a plan, not a design and not a phase. It ranks clusters of work by effectiveness (Aryan's
rule: the changes that close the most logged problems and remove the most daily friction come
first, whatever their size), proposes a phase order, lists the questions only Aryan can answer,
and says what was left out. The next round follows the working agreement in
[`../PHASES.md`](../PHASES.md) unchanged: one orchestrator session per phase, one worktree and
branch per phase chained off the previous one (the first new branch comes off
`manual-testing-fixes`), self-testing through the agent harness on the secondary monitor,
screenshots and recordings kept under `docs/screenshots/<phase>/`, and Aryan tests nothing until a
phase is finished and polished.

Inputs read: `CLAUDE.md`, `PHASES.md`, `design-02`, `docs/bugs.md` (eleven open bugs as of
2026-09-18: the ten from 2026-06-30 to 2026-09-14 plus the faint header line logged on
2026-09-18), `docs/research-02-enjoy-dev-ideas-for-afterterm.md`, `docs/ideas.md`, and the
renderer files where the sidebar and attention logic lives (`threadView.ts`, `sidebarWalk.ts`,
`app.tsx`, `SidePanel/index.tsx`, `useTabState.ts`, `spinnerState.ts`, `Terminal/index.tsx`).

## Section 1: the clusters, ranked by effectiveness

Size uses the PHASES.md scale for main-process (backend) work: none, small, medium, large. Since
most of this round is renderer work, a renderer size is given beside it.

### Cluster 1: the sidebar shows what needs you, and needs-you means what it says

**Rank 1.** This is one problem seen from many angles: the sidebar models process state per row,
but nothing in the app aggregates attention, nothing keeps it honest, and the sections do not
separate what the user cares about from everything else. It is the whole of research-02's bucket
1, four of the eleven bugs, and two entries in `ideas.md`.

**Problems it closes**

From `docs/bugs.md`:
- "Pinned and unpinned projects read as one block in the sidebar, and the unpinned list cannot be collapsed"
- "The sidebar has no button to collapse or expand every project at once"
- "Threads that are mid-turn are hard to find and switch between in the sidebar"
- "An unpinned project that just became active does not move to the top of the sidebar's Projects section"

From `docs/research-02-enjoy-dev-ideas-for-afterterm.md`, bucket 1, every item:
- "An always-on rail, VS Code style"
- "Attention badges on the rail tiles"
- "The rail shows only projects that need attention"
- "Only current projects in the expanded sidebar"
- "Bring a project in, close a project out"
- "An attention filter over the thread list"
- "A thread that is waiting on the user stays 'needs you' until it is actually answered"
- "Mark a chat thread as unread"

Also from research-02, bucket 2: "The Search row in the sidebar is a button with a shortcut
label. It should be a real search input". Placed here rather than in the sweep because the rail
and panel redesign re-lays out exactly the top of the panel where the Search row sits; doing the
row twice would be waste.

From `docs/ideas.md`:
- "Arrow Key Tab Navigation" (Ctrl+Shift+Up/Down between threads). Not a sidebar item on its own,
  but the bugs.md fix direction for the mid-turn bug names "a keyboard cycle through working
  threads" as one candidate, so the design decides whether a cycle is part of the answer.
- "Tab Attention / Notification System": the Claude-driven parts are built (row badge, title
  prefix, project pills, overlay toasts). What is left, a badge that counts across the whole app
  and a persistent needs-you, is this cluster. The shell-side parts (BEL, a long command
  finishing, a process erroring) are not; see Section 4.

**What it changes in the app**

- The attention model: `needs-you` stops clearing on a glance. Today `handleActivate` in
  `app.tsx` calls `clearThreadBadges`, which drops any notification other than `working` the
  moment a row is selected, and the overlay toast with it. The new rule clears it only when the
  state genuinely moves on. The signals already exist: the hook's next title event
  (`handleNotification` via `onTitle`), output resuming after quiet (`onOutput` in
  `spinnerState.ts`, the same re-arm that flips attention back to working), and the raw
  keystrokes in `term.onData` in `Terminal/index.tsx`, where Enter (`\r`) is available for free
  as "the user answered" while arrow keys are multi-character sequences that never match it.
  Today `onUserInput` only fires for a bare Esc or Ctrl+C, so an "answered" signal is a small
  addition next to it, not a new channel.
- A persisted `unread` flag on a chat thread, set from the thread menu, cleared by the same rule
  as needs-you, counted wherever needs-you is counted, and probably rendered with the same bell.
- A pure aggregate over `threadState` that answers "which projects need me, with counts" and
  "which threads match a filter" for the rail, the filter and Home's totals from one place
  (`projectCounts` in `threadView.ts` is the seed of it).
- The sidebar structure: an always-on rail beside a panel instead of today's either/or
  (`panelCollapsed` in `app.tsx`, Ctrl+Shift+B), rail tiles with badges, the rule for which
  projects appear in the panel, a way to bring a project in and close it out, an attention
  filter at the top of the thread list, a visual split between pinned and unpinned rows, a
  collapse-all control, and activity ordering of the unpinned section (`sidebarSections` in
  `threadView.ts` keeps walk order today; `homeView.ts` already sorts by `lastActiveAt`).
- The Search row becomes a real input with the palette's matching behind it.
- Persistence for whatever the design adds: `unread`, a section collapsed flag, the set of
  projects brought into the panel. Note for the design: bugs.md's fix direction for the collapse
  says "persisted the way the sidebar's own collapsed state is", but the sidebar's own collapsed
  state is not persisted at all today (`useState(false)` in `app.tsx`), so the design has to say
  what survives a relaunch.

**Files it touches**

`src/renderer/threadView.ts` (state, counts, sections, ordering), `src/renderer/app.tsx`
(`handleActivate`, `clearThreadBadges`, `handleNotification`, `handleUserInput`, the sidebar
collapsed state, shortcut dispatch), `src/renderer/spinnerState.ts` (the clearing rule if it
moves there), `src/renderer/components/Terminal/index.tsx` (the Enter signal),
`src/renderer/hooks/useTabState.ts` (unread, collapse all, section and panel state),
`src/renderer/components/TabBar/types.ts` and `src/renderer/sessionMigration.ts` (persisted
fields), `src/renderer/components/SidePanel/index.tsx` and `SidePanel.css` (the rail and panel
rewrite), `src/renderer/threadMenu.tsx` (Mark as unread), `Header/index.tsx` and
`ThreadHoverCard.tsx` (state wording), `Home/index.tsx` and `homeView.ts` (totals come from the
shared aggregate), `NotifierApp.tsx` only if unread toasts, `src/main.ts` only for a new shortcut
in `before-input-event`, `scripts/agent-harness/drive.mjs` (a `rail` command, filter and badge
readers). Probably a new pure module for the rail and filter logic, unit-tested like
`sidebarWalk.ts`. `sidebarWalk.ts` itself likely stays as it is.

**Size:** backend none to small (a shortcut, nothing else in main). Renderer large: the biggest
renderer change since Phase 1.

**Design step first: yes, a `design-03` document.** research-02 already says so, and the reasons
hold: eight of the items interact (the rail rule, the panel rule and the pinned split are three
answers to "what do I see"), two of them are in tension with design-02, and the mid-turn bug has
no settled shape. The design should come with a clickable mock in `docs/mockups/`, the way
design-02 was agreed against `afterterm-next.html`, since most of the open questions are about
what sits where.

What the design has to decide:
1. The rail rule. Aryan's 2026-09-18 addition says a tile appears only when a project has
   something pending (needs you, done not yet viewed). The original VS Code idea is every project
   with a badge. The design picks one, and says where the current project shows when it has
   nothing pending, and whether a tile lingers once its attention clears (a tile that vanishes
   under the pointer the moment it is clicked is the failure to avoid).
2. The panel rule ("only current projects"). design-02 rejected letting process state decide
   intent (no auto-pin, no pin decay); a panel that hides projects by activity is a view filter,
   not a pin, but the design must say so and reconcile it with Pinned and Projects as they are.
   It must also say whether "bring in and close out" is the mechanism or a filter is, and whether
   the Projects-section collapse from bugs.md is still wanted once this lands (it may be the same
   wish in a milder form).
3. Close-out with sleeping. "Closing a project sleeps N threads, asks first" is one confirm away
   from the "Sleep all" that design-02 rejected. Per project rather than global is a different
   thing, but it should be a deliberate choice.
4. What clears needs-you: the hook's next event only, or also Enter in that thread, or also
   output resuming. Whether browsing options with the arrow keys counts (recommendation: no;
   Enter and the hook do, arrows and output alone do not). Whether `done` gets the same
   treatment or keeps clearing on view.
5. Unread: chats only (Aryan's wording), persisted across relaunch or not, counted as needs-you
   or as its own count, whether it toasts, and how it clears (opening the thread, or the same
   answered rule).
6. The filter: All, Needs you, Working, Unread as tabs or a segmented control; per project or
   one flat list across every project (a flat list is what actually fixes "hard to find and
   switch between"); whether a running server counts under Working (Aryan says working means
   mid-turn, and today `projectCounts` folds running into the play pill, so the two would diverge).
7. The mid-turn bug's shape: is the filter enough, or is a strip of working threads or a keyboard
   cycle (Ctrl+Shift+Up/Down, from `ideas.md`) wanted as well. Constraint from Phase 1.1: the
   32px title bar is the drag region and nothing shares its row with the caption buttons, so a
   Chrome-style strip would need its own row, not the title bar.
8. Ordering: what "active" means for the unpinned section (latest activity stamp, or any working
   thread), whether Pinned stays in saved order, and whether the panel order and Home's order
   should be the same rule.
9. The collapse-all control's placement and whether it is a shortcut too.
10. What a pinned row looks like versus an unpinned one, and where the divider goes.
11. What the sidebar shows on Home and the project page, since the rail is "always on" and those
    screens have no sidebar today (design-02: Home is "a full screen, no sidebar").

Hard constraints from research-02's bucket 4 that the design must respect: no message snippets
anywhere (a needs-you row never quotes the agent's question, unlike Enjoy's amber card), no chat
UI, no drastic redesign (the rail and panel are an extension of the sidebar, not a rebuild of the
workspace).

**Dependencies:** none on other clusters. Cluster 2 and the sweep do not touch the sidebar.

**Recommended split into two phases** (both from the one design): the attention state first
(needs-you persists, unread, the shared aggregate, the answered signal), then the layout (rail,
panel rule, filter, sections, ordering, collapse all, search input). The state phase is the
smaller one and it is what the badges count, so the layout phase then ships numbers that are
already honest and gets tested once. Section 2 has the order.

### Cluster 2: long output opens at the newest lines and can be jumped through

**Rank 2.** Three bugs about where the viewport sits in a long tail or scrollback, all on the
sleep and wake flow that is new in 0.9.0 and used many times a day.

**Problems it closes**, from `docs/bugs.md`:
- "The saved snapshot on the asleep pane opens scrolled to the top instead of the bottom"
- "The dimmed snapshot replayed on wake stays on screen after the terminal comes back"
- "There is no jump to top or jump to bottom button while scrolling long output"

**What it changes:** the asleep pane sets its scroll position to the end whenever its `tail`
lands (the same effect that focuses the Wake button); the wake replay either stops scrolling the
viewport back up (a one-line change to the `replayLines > 0` block in `createTerminal`) or is
dropped from the wake entirely, per Aryan's answer; and one small overlay button per scroller
(the terminal, via `term.buffer.active.viewportY` and `baseY` plus `scrollToTop` and
`scrollToBottom`, and the asleep pane, via `scrollTop` and `scrollHeight`) that appears while
scrolling away from an end and never when the remaining distance in that direction is under a
small threshold, covering both of Aryan's edge cases. The wording is his to settle.

**Files:** `src/renderer/components/AsleepPane/index.tsx` and its CSS,
`src/renderer/components/Terminal/index.tsx`, a new small component for the jump button with a
pure helper for the show-or-hide rule (unit-tested), `scripts/agent-harness/drive.mjs` (a reader
for the button's visibility). Nothing in main.

**Size:** backend none. Renderer small.

**Design step first: no.** Two answers from Aryan (Section 3) and it can go straight to a phase.

**Dependencies:** none.

### Cluster 3: the visual and placement fix sweep

**Rank 3.** Independent small fixes, gathered into one item as agreed. Their combined value is
real (the header line is on screen the whole time, the toast shadow on every toast), but none of
them changes how the app is used.

**Problems it closes**, from `docs/bugs.md`:
- "The header's project, model and branch line is too faint to read at a glance"
- "Toast shadow spreads far past the card and is clipped at the overlay window's edge"
- "Hover card heading overflows the card for a long unbroken title"
- "Notification overlay appears on the wrong monitor in a multi-monitor setup" (also in
  PHASES.md's unphased backlog as "Notification overlay placement on multi-monitor setups")

From `docs/ideas.md`: "Notification Pop-up UI" is otherwise built (the Phase 1 toast cards); the
shadow is what is left of it.

From `docs/research-02`, bucket 2: "The shortcut labels on the New thread row and the others
could be smaller or fewer." Aryan said fine to leave, so it is listed here only so it is not lost;
the Cluster 1 layout phase can take it if the row is being redrawn anyway.

**What it changes:** `.header-meta` in `Header.css` gets a brighter and slightly larger
treatment agreed with Aryan; `.notif-card` in `NotifierApp.css` gets a shadow that fits inside
the container's padding; `.hover-card .hn` in `ThreadHoverCard.css` wraps or clamps a long word;
`positionNotifier` in `src/main.ts` places the overlay in the work area of
`screen.getDisplayMatching(mainWindow.getBounds())` instead of `getTargetDisplay()` (which is
the primary display unless the harness sets `AFTERTERM_DISPLAY`), repositioning on push and on
display change, with the harness's `AFTERTERM_DISPLAY` override kept.

**Files:** `Header.css`, `NotifierApp.css`, `ThreadHoverCard.css`, `src/main.ts` (the notifier
placement only), `scripts/agent-harness/screenshot-display.ps1` for the multi-monitor check.

**Size:** backend small (the notifier placement). Renderer small.

**Design step first: no.** One wording-free decision (the header treatment) from Aryan, then
straight to a phase, most likely the same phase as Cluster 2.

**Dependencies:** none. The multi-monitor bug carries a "document, don't fix yet" note from
2026-06-30; the later backlog entry in PHASES.md lists it as wanted, so it is planned here and
Section 3 asks Aryan to confirm.

## Section 2: the proposed phase order

Numbering continues from PHASES.md. Branches chain off `manual-testing-fixes`, each from the one
before it, per the working agreement.

0. **Design 03: the sidebar, the rail and the attention model.** Reason: it is the biggest lever
   in the round and nothing in Cluster 1 can start without it. A document at
   `docs/design-03-sidebar-and-attention.md` plus a clickable mock, agreed with Aryan the way
   design-02 was. No code.
1. **Phase 7: attention state.** Branch `phase-7-attention-state`. Needs-you persists until
   answered, mark as unread, the shared attention aggregate, the answered signal. Reason: it is
   the foundation the rail badges and the filter count, it is small, and it improves the current
   sidebar on its own (bells stop lying) even before the layout changes.
2. **Phase 8: the rail and the panel.** Branch `phase-8-sidebar-rail-and-panel`. The always-on
   rail with badges, the panel rule and bring-in and close-out, the attention filter, the
   pinned and unpinned split, collapse all, activity ordering, the search input. Reason: it
   closes four bugs and six research items in one change, on numbers Phase 7 already made honest.
3. **Phase 9: long output and the fix sweep.** Branch `phase-9-output-and-visual-fixes`. Clusters
   2 and 3 together: seven bugs, none of which touches the sidebar. Reason: too small to be two
   phases, and by then every remaining open bug is closed in one pass before the release.
4. **Release 0.9.0.** Merge to `main` through a PR once Aryan has tested, then `npm run release`
   per `docs/guide-02-releases.md`. Reason: the standing agreement says the manual-testing bug
   list is fixed and then a release is cut.

The alternative, if Aryan wants 0.9.0 out before the sidebar work (the standing agreement from
2026-09-07 reads that way: test, fix the list, release): Phase 7 becomes Clusters 2 and 3
together, 0.9.0 ships with every bug except the four sidebar ones closed, and design-03 plus the
two sidebar phases follow as 0.10.0. The work is the same either way; only the order and the
release boundary change, and that is the first question below.

## Section 3: questions for Aryan, grouped by cluster

Only questions whose answer changes the work. Everything else the orchestrator decides and
reports at the handoff, as before.

**The release boundary**
1. Does 0.9.0 ship after the seven non-sidebar bugs are fixed, with the sidebar redesign as
   0.10.0, or does it wait for the sidebar work? This decides whether Section 2's order or its
   alternative is followed.

**Cluster 1, needed before design-03 can be written**
2. The rail: only projects with something pending (your 2026-09-18 rule), or every project with
   a badge (the VS Code shape you first described)? If only pending, where does the project you
   are currently in show when it has nothing pending?
3. The panel: which projects are in it? Your floor was "awake threads or the projects I am
   working on". Is "recently worked on" part of it, and with what window? And is the mechanism
   "bring in and close out" by hand, or an automatic rule, or both?
4. Does closing a project out of the panel sleep its awake threads (with the confirm), or only
   hide the project and leave them running?
5. What answers a needs-you? Only the hook's next event (Claude reports working or done), or
   also pressing Enter in that thread? Should browsing a question's options with the arrow keys
   leave it as needs-you (the recommendation)? Does "done, not yet viewed" keep clearing on
   view, or should it persist too?
6. Mark as unread: chats only, as you said? Should it survive a relaunch? Does it count in the
   same bell as needs-you, or get its own count and filter tab? Should marking a thread unread
   fire a toast?
7. The attention filter: over the current project's threads, or one flat list across every
   project? Your mid-turn bug is really about reaching working threads anywhere, which a flat
   list answers and a per-project filter does not.
8. For finding working threads: is the filter enough, or do you also want a keyboard cycle
   through working threads (Ctrl+Shift+Up/Down, or a dedicated key) or a visible strip of them?
   A strip cannot go in the 32px title bar (Phase 1.1 keeps that row for the caption buttons), so
   it would be a new row under it or a block at the top of the panel.
9. Sorting the unpinned section: by the latest activity stamp (typing, output, activation, the
   way Home sorts), or should any project with a working thread jump above the rest regardless?
   Does Pinned keep the order you dragged it into?
10. The collapse-all button: in the icon row (Home, Workspace, sidebar toggle) or on the Projects
    label? Should it have a shortcut?

**Cluster 2**
11. On wake, should the dimmed snapshot be dropped entirely (it stays readable on the asleep pane
    before you wake), or kept in the scrollback with the viewport left at the fresh prompt?
12. Wording and look for the jump buttons: "Go to top" and "Go to bottom", or arrows only? One
    button that flips with scroll direction, or two?

**Cluster 3**
13. The header line: brighter text at the same size, slightly larger, or each item as a small
    chip? Any of the three is a CSS-only change; the choice is yours.
14. The multi-monitor notifier bug was logged "document, don't fix yet" on 2026-06-30 and later
    listed as wanted in PHASES.md's backlog. Fix it in this round?
15. The "Last here 2d ago" line under the Home date, the experiment from 2026-09-07 that you
    said you would decide on during this manual testing: keep it or remove it? (Asked now
    because the testing is under way; it was not to be asked before.)

## Section 4: what was deliberately left out, and why

**Already built, so not planned** (checked against CLAUDE.md before counting):
- `ideas.md` "Claude Session Resume": built as lazy wake and history Resume in Phase 4 (nothing
  auto-resumes; Wake or Resume runs `claude --resume` in the saved cwd).
- `ideas.md` "Scrollback Snapshot": built as the scrollback tail in Phase 4; the file says so.
- `ideas.md` "Notification Pop-up UI": the Phase 1 toast cards are the redesign; only the shadow
  bug remains and it is in Cluster 3.
- `ideas.md` "Tab Attention / Notification System", the Claude-driven parts: row badge, title
  prefix, project pill counts and toasts all exist. The rest is Cluster 1 or the shell-side
  attention item below.
- research-02 bucket 3 "Resume a closed chat from the UI": built in Phase 4 (the project page's
  History tab with Resume, and history rows in the palette). Aryan's own note says to check this
  first; it is what he described, and only a closed thread in General is gone for good.
- PHASES.md backlog "Drag a thread between projects in the sidebar": already works. The sidebar's
  drag-and-drop moves a thread onto a project row or between rows of another project
  (`handleDragEnd` in `SidePanel/index.tsx`, joining the drop target's project through
  `onMoveTab` and `onAddToGroup`).

**Parked or explicitly not wanted, so not planned:**
- `ideas.md` "Zero-config Claude Code hooks through a bundled plugin and a PATH shim": parked
  by Aryan on 2026-09-18, per the brief.
- `ideas.md` "Project Notes Tab" and PHASES.md backlog "Project notes": as written (bold, italic,
  checkboxes, lists, a Notion-like editor) it is the "full docs editor with fonts and sizes"
  that research-02 bucket 4 rules out, and design-02 rejected the typed status note. The
  view-only variant in research-02 bucket 3 ("Docs per project, viewing only") is something
  Aryan wants to think about before any shape is proposed, so it waits for him, not for a plan.
- research-02 bucket 4 as a whole (chat UI, full editor, message snippets, drastic redesign) is
  treated as constraints on Cluster 1, not as work.

**Open but deferred, with the reason:**
- `ideas.md` "Update self-install hook to a dispatcher": a real fix for double notifications on a
  machine with its own hook, but the parked zero-config idea would delete the self-install path
  it patches. Deciding between them is a question for a later round, not worth building twice.
  The dev machine already carries the manual fix from `note-01`.
- `ideas.md` "Dependency check on first launch": small and self-contained, but it helps other
  people's machines, not Aryan's daily use, and the same self-install path may change. Better
  placed right before the first release that goes to someone else.
- `ideas.md` "Multiple Terminal Windows on Screen at Once" and PHASES.md backlog "Multi-window:
  one window per pinned project": large, spans session persistence and the PTY map in main, and
  nobody asked for it during manual testing. It also overlaps the multi-pane worktree that
  already exists (`worktree-multi-pane-layout`), which needs a decision of its own first.
- The shell-side attention items in `ideas.md` (BEL, a long command finishing, a process
  erroring, a background process exiting, taskbar flash): they would make a shell able to need
  you, which widens the state model design-02 fixed as Claude-only. Worth raising once design-03
  has settled what needs-you means, not before.
- PHASES.md backlog "Worktree grouping on the project page", "Daily check-in as an optional Home
  mode", "Keep closed General threads somewhere": none surfaced in manual testing and none
  closes a logged problem. They stay in the backlog.
- PHASES.md backlog "Rename Group and Tab to Project and Thread in code": a mechanical change
  with no user-visible effect; it would collide with every branch in this round and is best done
  in a quiet gap between rounds.
- The Chrome-style tab strip named in the mid-turn bug: not left out, but not planned as a
  feature either. It is one candidate answer inside design-03 (Section 1, decision 7), weighed
  against a flat filter and a keyboard cycle, since Aryan said he does not know the right
  solution yet.

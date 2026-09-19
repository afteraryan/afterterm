# Design 03: the sidebar, the always-on rail and the attention model

This design extends the sidebar from [`design-02-projects-and-threads.md`](design-02-projects-and-threads.md) so that it answers "what needs me" honestly and from anywhere: a needs-you that stays until it is actually answered, a way to put attention back on a thread by hand, one aggregate every count reads from, an always-on rail with badges beside the panel, a rule for which projects the panel shows, a filter over the thread list, a clear split between pinned and unpinned projects, a collapse-all control, activity ordering, and a real search input. It is Cluster 1 of [`plan-01-sidebar-attention-and-manual-testing-fixes.md`](plan-01-sidebar-attention-and-manual-testing-fixes.md).

Status: draft, written 2026-09-19 for discussion with Aryan. The variant sheets are built; nothing in the app has changed. Each decision below is marked **pending** until Aryan picks, then records the date and the variant chosen. Execution is two phases, 7 and 8, listed at the end and in [`../PHASES.md`](../PHASES.md).

Constraints carried in from earlier documents, not re-argued here:

- design-02's Pinned rule: pinned is explicit and only explicit; nothing pins on its own, no pin decay, process state never decides intent.
- design-02's "Rejected along the way": no Sleep all, no rename in afterterm, no derived subheadings, no typed notes.
- research-02 bucket 4: no message snippets anywhere (a needs-you row never quotes the question), no chat UI, no drastic redesign. Every variant here is the sidebar of today plus something; none rebuilds the workspace.
- Phase 1.1: the 32px title bar is the drag region and nothing shares its row with the caption buttons.
- Aryan's instruction for this round: do not make drastic changes for the sake of changing.

## The problems this closes

From `docs/bugs.md`: pinned and unpinned projects read as one block and the unpinned list cannot be collapsed; there is no collapse-all button; mid-turn threads are hard to find and switch between; an unpinned project that just became active does not rise in the Projects section.

From `docs/research-02-enjoy-dev-ideas-for-afterterm.md`, bucket 1, every item: the always-on rail, badges on the rail tiles, the rail showing only what needs attention, only current projects in the panel, bring a project in and close it out, an attention filter, needs-you until answered, mark as unread. Plus bucket 2's search input.

From `docs/ideas.md`: the app-wide attention count and the persistent needs-you from "Tab Attention / Notification System"; the keyboard cycle from "Arrow Key Tab Navigation" is decided here too.

## The variant sheets

One file per layout decision in `docs/mockups/`, variants switchable at the top of each page, every variant on the same data (eight live projects, three pinned, threads in every state, one thread in General) and in the app's own markup, tokens and icons (`design-03-shared.css`, `design-03-shared.js`, both taken from `afterterm-next.html`). Each variant's note says which logged problem it closes. Open them in a browser; rows, project names, tiles and controls react.

| Sheet | Decision |
|---|---|
| `sidebar-rail-variants.html` | 1, the rail rule; 11, the rail on every screen (the "Show Home" option) |
| `sidebar-panel-variants.html` | 2, the panel rule, and 3, bring in and close out |
| `sidebar-attention-filter-variants.html` | 6, the filter; 7, how mid-turn threads are found |
| `sidebar-pinned-split-variants.html` | 10, pinned versus unpinned rows and the divider |
| `sidebar-collapse-all-variants.html` | 9, the collapse-all control |
| `sidebar-search-input-variants.html` | the Search row as an input |

Decisions 4, 5 and 8 (what clears needs-you, unread, ordering) are about state and rules, not layout, so they have no sheet; they are questions below with a recommendation each.

## Decisions

### 1. Which projects get a tile on the rail

**Pending.** Sheet: `sidebar-rail-variants.html`.

The rail is a 56px column at the left edge that never goes away. It holds Home and Workspace at the top (so those two icons are in the same place on every screen, as design-02 requires), then one tile per project the rule admits, then at the bottom the panel toggle, and Search and New thread only while the panel is hidden (today's collapsed rail, kept). A tile is the project's coloured folder on a faint tint of its colour; an initial letter was tried and rejected during the build because every one of Aryan's projects starts with "after", so the initials all read "A". The tile of the project you are in has a ring. Badges: an amber count of threads that need you (including marked-unread ones) at the top right, and a small spinner at the bottom right while any thread is mid-turn. Hovering shows the name and the counts. Clicking a tile opens the workspace on that project: the first thread that needs you, else the first Done, else the most recently active awake thread. Right-click gives the project menu.

- A. Only projects with something pending (Aryan's 2026-09-18 rule), plus the current project so the rail is never empty and a tile never vanishes under the pointer.
- B. Every live project, pinned first, badges where pending (the VS Code shape).
- C. Pinned always, in pinned order; unpinned only while pending or current, below a separator. **Recommended:** it keeps the rail as stable navigation for the projects Aryan chose, adds only what is asking, and keeps Pinned the one thing set by hand.

Lingering: in A and C a tile whose attention clears stays while its project is current; it drops the next time another project becomes current. Nothing animates away under the pointer.

### 2. Which projects are in the panel

**Pending.** Sheet: `sidebar-panel-variants.html`.

- A. Every project as today, with the Projects section foldable as one block. Closes the fold half of the bug and nothing from research-02.
- B. Current projects by rule: Pinned, plus unpinned projects with an awake thread or activity within a window (1, 3 or 7 days); the rest behind "Other projects · N". A view filter, not a pin.
- C. Open projects by hand: Pinned, plus the projects you opened (from Home, the palette, the rail, or Other projects), until you close them out; the set is persisted. **Recommended:** it is the same principle as Pinned, nothing moves without a click, and "in the panel" always covers "has awake threads" because close-out sleeps them first.

### 3. Closing a project out of the panel

**Pending.** Part of the same sheet. Close-out is the x that appears on hover on an unpinned project row in the panel (and "Close out of sidebar" in the project menu). If the project has awake threads, a confirm asks first: "Close afterthought out of the sidebar?" / "2 threads are awake. Closing sleeps them; the project stays on Home and in the palette." / Cancel / Sleep and close. With nothing awake it closes out at once. This is per project and one confirm, not the global Sleep all design-02 rejected; the alternative is to hide the project and leave its threads running, which would make the panel lie about what is running. Recommended: sleep, with the confirm.

### 4. What clears needs-you

**Pending.** No sheet. Today `handleActivate` clears the badge the moment a row is selected, so a glance counts as an answer. The new rule: needs-you persists until one of these, and nothing else:

1. The hook reports the state moved on: `▶ working` from `UserPromptSubmit` or `✅` from `Stop` (`onTitle` in `spinnerState.ts`, unchanged).
2. Enter is pressed in that thread (`\r` in `term.onData`, next to the existing Esc and Ctrl+C interrupt check). Enter is what submits an answer to a permission prompt, an AskUserQuestion or a typed reply, so it is the one keystroke that means "answered". It moves the thread to working; if Claude does not actually resume, the existing 2.5s silence-clear drops working again.
3. Esc or Ctrl+C in that thread (the existing interrupt path): a cancelled prompt is no longer waiting on the user, so the thread goes quiet.

Not clearing it: opening or viewing the thread; arrow keys (multi-character sequences that never match `\r`); output alone. The output re-arm in `spinnerState.ts` (`onOutput`) stops flipping attention to working, since browsing options with the arrow keys echoes output and would count as an answer; it keeps re-arming compacting. Single-key answers that some prompts accept without Enter are not caught by afterterm, but the hook's next event catches them, so the worst case is a badge that outlives its prompt by one turn, never one that clears early.

`done` keeps clearing on view: a finished turn asks nothing further, and the rail rule counts "done, not yet viewed" exactly as design-02 defined it. The overlay toast for a needs-you is still dismissed when the thread is opened (the toast says "go look", the badge says "still waiting").

Recommended: the rule above, all three signals.

### 5. Mark as unread

**Pending.** No sheet. A new entry "Mark as unread" in the one thread menu (`threadMenu.tsx`), for chats only (Aryan's wording; a shell has no conversation to come back to). It sets `Tab.unread`, persisted in `session.json` so a thread marked on Friday still asks on Monday, and shown with the same amber bell and breath as needs-you (one bell, one meaning: this thread wants you). It counts in every needs-you count (row, project pills, rail badge, Home totals, the filter's Needs you). It clears when the thread is opened: coming back to it is the whole point of the mark, so here a glance is the answer, unlike a prompt. It does not toast. An asleep thread keeps its unread mark and shows the bell on its dimmed row, since the mark is about the user, not the process. The menu entry reads "Mark as read" while set.

Recommended: as written. Alternatives Aryan may prefer: its own filter tab and count (the sheet's filter has All, Needs you, Working; Unread would be a fourth), or clearing by the same answered rule as needs-you.

### 6. The attention filter

**Pending.** Sheet: `sidebar-attention-filter-variants.html`.

- A. A segmented control under New thread: All, Needs you, Working, with counts across every project. All is today's sectioned list; a filter is one flat list across every project, each row prefixed with its project's folder and name. **Recommended:** the flat list is what makes switching between working threads one click each, wherever they live.
- B. An attention block above the sections, always present when something is pending: Needs you rows, Working rows, then the sections as today. No mode; the same rows appear twice.
- C. A strip of working threads under the title bar, Chrome style, on its own 36px row (the title bar cannot host it). Shown for comparison; not recommended, since it costs terminal height on every screen and duplicates the rows.

Working means mid-turn chats only, per Aryan. A running server shows its port on its row and is not counted as Working unless Aryan wants it to be (an option on the sheet). Today's play pill on project rows folds running into working; the design makes the pill mean working only, and the port on the row carries running.

### 7. How mid-turn threads are found

**Pending.** The filter above is the main answer. In addition, a keyboard cycle: Ctrl+Shift+Down and Ctrl+Shift+Up move through the thread rows the panel is showing, in panel order, skipping rows hidden by a collapsed project or the fold; while a filter is on, that is a cycle through the filtered rows, which is a working-threads cycle for free. Ctrl+Tab and Ctrl+Shift+Tab keep their session-order cycle. Recommended: build the cycle in Phase 8 with the filter.

### 8. Ordering

**Pending.** No sheet. The Projects section (unpinned) is sorted by `lastActiveAt` descending, the rule Home already uses, so a project that just had activity (typing, output, activation) rises to the top. Any working thread stamps activity through the existing PTY activity stamping, so a project with a working thread is always near the top without a second rule. Pinned keeps its saved (dragged) order; the rail's pinned tiles follow the same order. Home and the panel share one rule. Recommended: as written.

### 9. The collapse-all control

**Pending.** Sheet: `sidebar-collapse-all-variants.html`.

- A. One button in the icon row beside the sidebar toggle; collapse-all or expand-all, derived from whether any project is expanded. **Recommended:** it is the single toggle at the top the bug asks for.
- B. A button on each section's label row, per section, visible on hover.
- C. A plus the Projects section fold from decision 10, shown side by side.

A shortcut is a separate question: Ctrl+Shift+E is free.

### 10. Pinned rows versus unpinned rows

**Pending.** Sheet: `sidebar-pinned-split-variants.html`. In every variant the Projects section folds as a whole from its label (chevron), persisted.

- A. A divider line between the sections, rows as today. **Recommended:** the smallest change that makes the two sections read apart, together with the fold.
- B. A plus a small pin glyph at the right of each pinned row.
- C. Pinned projects in a raised block, unpinned plain below. The strongest split and a second surface tone inside the sidebar.

### 11. The sidebar on Home and the project page

**Pending.** The rail sheet's "Show Home" option shows it. Recommended: the rail is on every screen (that is what "always on" buys: the badges answer "what needs me" from Home too), and it carries the Home and Workspace icons, so Home's and the project page's own icon row goes and those two icons never move. The panel is workspace-only, as today.

### Decisions the orchestrator takes unless Aryan objects

- The panel stays 264px; with the rail the sidebar area is 320px in total. Narrowing the panel to compensate would squeeze thread names that are already ellipsed.
- Ctrl+Shift+B keeps toggling the panel; the rail is unaffected by it.
- The panel-hidden state and the Projects fold are persisted in `session.json` under a new optional `ui` object (0.8.1 ignores unknown keys), since bugs.md asks for the fold to survive and today nothing about the sidebar does.
- `notification` (needs-you, working, done) stays transient: every thread restores asleep, and an asleep thread has no prompt left to answer. `unread` is the only attention flag that persists.
- Counts everywhere come from one pure module, `src/renderer/attention.ts`: per-project and total counts of needs-you (including unread), working, running and done, and the thread list for a filter. `projectCounts` in `threadView.ts` becomes a call into it. Home's totals, the project pills, the rail badges and the filter counts read the same numbers.

## The attention model, stated once

A thread's state (`threadState` in `threadView.ts`) in precedence order: unread (a chat the user marked, shown even while asleep), asleep, needs-you, working, done, compacting, background, running, quiet.

Needs-you begins with the hook's `⚠` title. It ends with the hook's next `▶` or `✅`, with Enter in that thread (to working), or with Esc or Ctrl+C in that thread (to quiet). It does not end with viewing, arrow keys or output.

Unread begins with Mark as unread. It ends with opening the thread or Mark as read.

Done begins with the hook's `✅`. It ends with viewing, as today.

Working begins with the hook's `▶` or with Enter on a needs-you. It ends with silence (2.5s), Esc or Ctrl+C, or the hook's `✅`.

## Persisted fields this adds

- `Tab.unread?: boolean` (chats only; absent means false).
- `session.json` top-level `ui?: { panelHidden?: boolean; projectsFolded?: boolean; openProjects?: string[] }` (the last only if decision 2 picks C). Added in `sessionMigration.ts`; every 0.8.1 key keeps its name and meaning.

## Phase 7: attention state

Branch `phase-7-attention-state`, worktree `.claude/worktrees/phase-7-attention-state`, from `design-03-sidebar-and-attention`.

- [ ] Needs-you persists: `handleActivate` no longer clears `attention`; `clearThreadBadges` keeps dismissing the toast and clearing `done`.
- [ ] The answered signal: Enter (`\r`) in `term.onData` calls a new `onAnswer` next to `onUserInput`; `spinnerState.ts` gains `onAnswer(current)` (attention to working) and `onInterrupt` also clears attention; `onOutput` stops re-arming from attention (keeps compacting). Tests for every transition, including the arrow-key case.
- [ ] Mark as unread and Mark as read in `threadMenu.tsx`; `Tab.unread` in `types.ts`, `sessionMigration.ts` (persisted, validated as boolean), `useTabState.ts` (`setUnread`); cleared in `handleActivate`.
- [ ] `threadState` gains `unread` with its precedence; `stateLabel`, `StateIcon`, the breath, the header chip and the hover card word it.
- [ ] `src/renderer/attention.ts`, pure and unit-tested: per-project and total counts, filter lists; `projectCounts` and Home's totals read from it.
- [ ] Harness: `drive.mjs` `sidebar` prints the unread mark; a `counts` reader for the aggregate.
- [ ] Self-test on the secondary monitor with screenshots and recordings in `docs/screenshots/phase-7/`: a needs-you that survives a click, clears on Enter, on Esc and on the hook's next title, and does not clear on arrows; mark unread, relaunch, still unread, opens and clears.
- [ ] CLAUDE.md and PHASES.md updated.

Done when: a permission prompt in a background thread stays needs-you after it is clicked into and looked at, and clears the moment it is answered; a chat marked unread on one launch still carries the bell on the next.

## Phase 8: the rail and the panel

Branch `phase-8-sidebar-rail-and-panel`, from `phase-7-attention-state`.

- [ ] The rail: a new `Rail` component beside `SidePanel`, tiles per the chosen rule, badges from `attention.ts`, tooltip, click and right-click; on every screen if decision 11 says so.
- [ ] The panel rule and close-out with its confirm (`ConfirmDialog`), per decision 2 and 3.
- [ ] The filter, the flat list and the keyboard cycle (main.ts `before-input-event` for Ctrl+Shift+Up/Down).
- [ ] Pinned split, the Projects fold, collapse-all, activity ordering in `sidebarSections`.
- [ ] The search input.
- [ ] Persistence in `session.json`'s `ui` object.
- [ ] Harness: `rail`, `filter` and `fold` readers in `drive.mjs`.
- [ ] Self-test with screenshots and recordings in `docs/screenshots/phase-8/`; CLAUDE.md and PHASES.md updated.

Done when: from Home, the rail shows which projects need you with counts; clicking a tile lands on the thread that needs you; the Needs you and Working filters list every such thread across projects in one list; the Projects section sorts by activity, folds, and pinned rows read apart from it.

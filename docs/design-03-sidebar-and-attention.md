# Design 03: the sidebar, the always-on rail and the attention model

This design extends the sidebar from [`design-02-projects-and-threads.md`](design-02-projects-and-threads.md): a rail that always shows which projects need you, a sidebar that lists only pinned and recent projects, a needs-you that stays until it is answered, a way to mark a chat unread, one aggregate every count reads from, per-group collapse buttons, a real search box, activity ordering and a keyboard cycle through threads. It is Cluster 1 of [`plan-01-sidebar-attention-and-manual-testing-fixes.md`](plan-01-sidebar-attention-and-manual-testing-fixes.md).

Status: agreed with Aryan on 2026-09-19 against the pages in `docs/mockups/`. Execution is Phases 7 and 8 in [`../PHASES.md`](../PHASES.md). Nothing in the app has changed yet.

Constraints carried in and kept: design-02's Pinned rule (pinned is explicit and only explicit, nothing pins or unpins on its own); design-02's rejections (no Sleep all, no rename in afterterm, no derived subheadings, no typed notes); research-02 bucket 4 (no message snippets anywhere, no chat UI, no drastic redesign); Phase 1.1's title bar (the 32px strip is the drag region and nothing shares its row).

## The pages this was agreed against

All in `docs/mockups/`, built on `design-03-shared.css` and `design-03-shared.js` (the tokens, markup and icons of `afterterm-next.html`, plus one data set: eight projects, three pinned, threads in every state).

- `design-03-final-sidebar.html`: **the agreed result**, every decision applied on one page, plus the eleven tile layouts that were compared (layout 1 is the one chosen).
- `design-03-index.html` and the six `sidebar-*-variants.html` pages: the questionnaire, one question per page, two or three answers each. Kept as the record of what was compared.

## Decisions, all taken 2026-09-19

### 1. The rail shows only projects that need you

The rail is a 76px column at the left edge, on every screen (workspace, Home, project page). Top to bottom: the sidebar toggle (only while the sidebar is hidden on the workspace), the Home/Workspace toggle, Search and New thread (only while the sidebar is hidden on the workspace), a thin separator, then one tile per project that has a thread waiting for you (needs-you, or marked unread) or a thread that finished and has not been viewed. A project with nothing pending is not on the rail, whether or not it is pinned or current. Nothing sits at the bottom of the rail.

The Home/Workspace toggle is one vertical pill (background `#101010`, a shade darker than the rail's `#171717`) holding the two icons; the highlight (`#2a2a2a`) slides from one to the other in 150ms with a slight overshoot (`cubic-bezier(.3,1.2,.4,1)`). Since the rail carries these two icons on every screen, Home's and the project page's own icon row goes.

Motion (all under the app's easing, off under reduced motion): hiding the sidebar (the toggle or Ctrl+Shift+B) closes the panel's width over 320ms while its contents fade, and the rail's two blocks (the toggle above the Home/Workspace pill, Search and New thread below it) open to their height with the buttons fading in one after the other, so the tiles glide down; showing the sidebar reverses it. Going to Home from the workspace slides the sidebar shut first, then the screen changes, and the rail's two blocks close; coming back, the screen changes and the sidebar slides open from zero, unless it was hidden before Home, in which case it stays hidden and the rail's blocks reopen. Agreed against `design-03-final-sidebar.html` on 2026-09-19.

A tile is the project's icon (decision 12) on a faint tint of the project colour. Beside the tile, in the tile's own row, a column of badges, only the non-zero ones, top to bottom: waiting for you (amber), working (grey), finished (green). Nothing overlaps another tile and nothing covers the icon. This is layout 1 of the eleven compared; initials were rejected early because every one of Aryan's projects starts with "after"; corner badges, fanned badges and bare numbers were rejected as cluttered or unframed.

Hovering a tile shows the app tooltip with the project name, nothing else, beside the tile on its right, vertically centred (the rail sits at the window edge, so tooltips on it go sideways, not underneath). Hovering a badge shows the tooltip for what it is, "Waiting for you", "Working" or "Finished", with no number (the number is on the badge). No hover card on the rail (decided 2026-09-19, replacing an earlier card with one line per number). Clicking a tile opens the workspace on that project: the first thread waiting for you, else the first finished one, else the most recently active awake thread; the project is expanded in the panel. Right-click gives the project menu.

### 2. The panel lists pinned and recent projects; everything else is docked at the bottom

The panel, top to bottom: the icon row (panel toggle only, since the rail carries Home and Workspace), the Search box, New thread, then the scrolling list: General (threads with no project, only when there are any), **Pinned** (heading with a pin icon; the pinned projects in their dragged order; a thin line under the group), **Recent** (unpinned projects that have at least one awake thread or activity in the last 3 days, sorted by latest activity, newest first). There is no "Projects" section any more.

**Other projects · N** is a row docked at the bottom of the panel, outside the scroll, collapsed by default. Clicking it expands the rest of the unpinned projects upward as dim rows with no thread lists; clicking one brings it in: it stamps the project's activity to now (so the Recent rule holds it for 3 days), selects its first thread (waking nothing) and expands it. No close-out control: a project leaves Recent when it has no awake thread and its activity passes the window. Archived projects are nowhere in the panel, as today. This is a view filter over activity, not a pin: `Group.pinned` is untouched by any of it.

### 3. No close-out confirm

Nothing sleeps a project's threads from the panel. Since a project with an awake thread is Recent by rule, the panel never hides a running thread.

### 4. Needs-you stays until it is answered

Today `handleActivate` in `app.tsx` clears the badge the moment a row is selected. Now needs-you persists until one of these, and nothing else:

1. The hook reports the state moved on: `▶ working` from `UserPromptSubmit` or `✅` from `Stop` (`onTitle` in `spinnerState.ts`, unchanged).
2. Enter (`\r`) is pressed in that thread (`term.onData` in `Terminal/index.tsx`, beside the existing Esc and Ctrl+C check). The thread goes to working; if Claude does not resume, the 2.5s silence-clear drops it again.
3. Esc or Ctrl+C in that thread (the existing interrupt path): the thread goes quiet.

Not clearing it: viewing the thread, arrow keys, output alone. `onOutput` in `spinnerState.ts` stops re-arming from attention (arrow keys echo output); it keeps re-arming compacting. The overlay toast is still dismissed when the thread is opened. `done` keeps clearing on view, and (Aryan, 2026-09-19, at the Phase 7 handoff) a `✅` that lands while the user is already looking at that thread, with the window focused, clears at once rather than waiting for the next activation; with the app behind another window it stays done until the thread is looked at.

### 5. Mark as unread

"Mark as unread" in the one thread menu (`threadMenu.tsx`), chats only; "Mark as read" while set. Sets `Tab.unread`, persisted. Shown with the same amber bell and breath as needs-you, counted in every waiting-for-you count (row, project pills, rail badge, Home totals). Clears when the thread is opened, and (Aryan, 2026-09-19, at the Phase 7 handoff) the moment the user types in it or wakes it, so marking the thread you are looking at unread lasts until you act on it. No toast. An asleep thread keeps the mark and shows the bell on its dimmed row.

### 6 and 7. Mid-turn threads are reached through the rail and a keyboard cycle

No filter control, no attention block, no strip: the sidebar's look is unchanged by this. The rail is how projects that need you are reached from anywhere. Ctrl+Shift+Down and Ctrl+Shift+Up move through every thread row the panel is showing, in panel order, across projects (from the last thread of one project to the first of the next), skipping rows hidden by a collapsed project or the five-row fold, wrapping at the ends. Ctrl+Tab keeps its session-order cycle.

### 8. Ordering

Recent is sorted by `lastActiveAt` descending, the rule Home already uses. Pinned keeps its dragged order.

### 9. Collapse buttons on the group headings

Each of the Pinned and Recent headings has a small button at its right end, visible when the heading is hovered, that collapses or expands every project in that group (icon and tooltip derived from whether any of them is expanded). The Recent heading also carries the New project plus, and the collapse button sits directly beside it. No global collapse-all, no shortcut.

### 10. Pinned versus unpinned

A thin line under the Pinned group and a pin icon in the Pinned heading. Rows are otherwise as today (pinned full weight, unpinned lighter).

### 11. The sidebar on Home and the project page

The rail is on every screen and carries the Home and Workspace icons; Home's and the project page's own icon row goes. The panel is workspace-only, as today.

### 12. Project icons

A project has an optional icon, chosen in the New project and Edit project dialog (`GroupModal`) from a set of ten solid, filled glyphs at the folder's weight: book, robot, bulb, globe, pen, film, house, music note, bell, rocket. The terminal glyph is not in the set (it is the Workspace icon). The rail tile shows the chosen icon, or the folder when none is chosen. Persisted as `Group.icon`. Orchestrator's decision, open to Aryan: the sidebar rows, Home cards and project page keep the coloured folder.

### 13. The Search box

The Search row is a text box. Typing filters the panel in place, case-insensitive substring over project names and thread names: a project whose name matches keeps all its threads; otherwise only its matching threads show under its row; empty groups are omitted; nothing matching shows "No matches". While there is text, the New thread row is hidden and the docked Other projects row is hidden. Escape or the clear button empties it. Ctrl+Shift+P still opens the palette (the only place closed threads are searched).

### Decisions the orchestrator takes

- The panel stays 264px; with the 76px rail the sidebar area is 340px.
- Ctrl+Shift+B keeps toggling the panel; the rail is never hidden.
- `notification` stays transient (every thread restores asleep, with no prompt left to answer). `unread` persists.
- The panel-hidden state persists in `session.json` under a new optional `ui` object. Per-project collapse is `Group.collapsed`, as today. The Other projects fold and the search text are transient.
- All counts come from one pure module, `src/renderer/attention.ts`: per-project and total counts of waiting (needs-you plus unread), working, running, finished; the rail's project list; the panel's Recent and Other lists. `projectCounts` in `threadView.ts`, Home's totals and the rail read the same numbers.
- The project row's play pill keeps counting working and running together, as today; only the rail separates them.

## The attention model, stated once

State precedence (`threadState` in `threadView.ts`): unread (a chat the user marked, shown even while asleep), asleep, needs-you, working, done, compacting, background, running, quiet.

- Needs-you begins with the hook's `⚠`. It ends with the hook's next `▶` or `✅`, Enter in that thread (to working), or Esc or Ctrl+C in that thread (to quiet). Not with viewing, arrows or output.
- Unread begins with Mark as unread. It ends with opening the thread, typing in it, waking it, or Mark as read.
- Done begins with `✅`. It ends with viewing, as today; a `✅` that arrives on the thread being viewed ends at once.
- Compacting begins with `⚙` and ends with output resuming (to working) or the next title. From Phase 8 it is shown as its own state, not as the working spinner (below).
- Working begins with `▶` or with Enter on a needs-you. It ends with silence (2.5s), Esc or Ctrl+C, or `✅`.

"Waiting for you" everywhere in the UI means needs-you plus unread.

## Persisted fields this adds

- `Tab.unread?: boolean` (chats only; absent means false).
- `Group.icon?: string` (one of the ten icon ids; absent means the folder).
- `session.json` top-level `ui?: { panelHidden?: boolean }`.

All added in `sessionMigration.ts` with validation; every 0.8.1 key keeps its name and meaning; 0.8.1 ignores the new keys.

## Phase 7: attention state

Branch `phase-7-attention-state`, worktree `.claude/worktrees/phase-7-attention-state`, created from `design-03-sidebar-and-attention`.

- [ ] Needs-you persists: `handleActivate` no longer clears `attention`; `clearThreadBadges` keeps dismissing the toast and clearing `done`.
- [ ] The answered signal: Enter (`\r`) in `term.onData` calls a new `onAnswer` next to `onUserInput`; `spinnerState.ts` gains `onAnswer(current)` (attention to working); `onInterrupt` also clears attention; `onOutput` stops re-arming from attention (keeps compacting). Tests for every transition, including the arrow-key case.
- [ ] Mark as unread and Mark as read in `threadMenu.tsx`; `Tab.unread` in `types.ts`, `sessionMigration.ts`, `useTabState.ts` (`setUnread`); cleared in `handleActivate`.
- [ ] `threadState` gains `unread` with its precedence; `stateLabel`, `StateIcon`, the breath, the header chip and the hover card word it ("Unread").
- [ ] `src/renderer/attention.ts`, pure and unit-tested: per-project and total counts (waiting, working, running, finished), the rail list, the Recent and Other lists with the 3-day rule; `projectCounts` and Home's totals read from it.
- [ ] Harness: `drive.mjs` `sidebar` prints the unread mark; a `counts` reader for the aggregate.
- [ ] Self-test on the secondary monitor with screenshots and recordings in `docs/screenshots/phase-7/`: a needs-you that survives a click, clears on Enter, on Esc and on the hook's next title, and does not clear on arrows; mark unread, relaunch, still unread, opens and clears.
- [ ] CLAUDE.md and PHASES.md updated.

Done when: a permission prompt in a background thread stays needs-you after it is clicked into and looked at, and clears the moment it is answered; a chat marked unread on one launch still carries the bell on the next.

### Added at the Phase 7 handoff, 2026-09-19

- **Compacting is its own state** (Aryan). Today a compacting chat shows the same grey spinner as working and is counted nowhere. From Phase 8 it gets its own compacting icon on the sidebar row, the header chip and the hover card's Type row (`StateIcon`'s `'compacting'` case, `stateLabel` already says "Compacting"), a project with a compacting chat appears on the rail with its own compacting badge, and `attention.ts` gains a `compacting` count next to waiting, working, running and finished (the project row's play pill keeps counting working and running only, unless Aryan says otherwise). `background` (`⏳`) stays as it is.
- **The five-row fold stays open while a hidden row is waiting for you** (Aryan agreed with the orchestrator's suggestion). `foldThreads` in `threadView.ts` only knows the active id; a hidden row that is needs-you or unread (the same definition `attention.ts` uses for waiting) must keep the list open too. Logged in `docs/bugs.md`; built with the panel in Phase 8.

## Phase 8: the rail and the panel

Branch `phase-8-sidebar-rail-and-panel`, worktree `.claude/worktrees/phase-8-sidebar-rail-and-panel`, created from `phase-7-attention-state`.

- [x] The rail: a new `Rail` component on every screen, in the order and with the motion of decision 1 (the two animated blocks, the Home/Workspace pill with its sliding highlight, the sidebar sliding shut on the way to Home and open on the way back), tiles from `attention.ts`, badges in a column beside the tile, tooltips beside the tile (name) and beside each badge (what it is), click and right-click; Home's and the project page's icon row removed; the panel's icon row keeps only the toggle.
- [x] Project icons: the ten solid glyphs in `Icons.tsx`, the picker in `GroupModal`, `Group.icon` persisted, the tile reads it.
- [x] The panel: Pinned (pin icon, line), Recent (3-day rule, activity order), Other projects docked at the bottom with bring-in; no Projects section.
- [x] Collapse buttons on the two headings beside the plus.
- [x] The Search box filtering in place, New thread and Other projects hidden while typing.
- [x] Ctrl+Shift+Down/Up through the shown rows (`main.ts` `before-input-event`, `app.tsx` dispatch, panel order from a pure helper).
- [x] `ui.panelHidden` persisted.
- [x] Compacting as its own state: icon on the row, chip and hover card, a compacting badge on the rail tile, a `compacting` count in `attention.ts` (added 2026-09-19).
- [x] The five-row fold stays open while a hidden row is waiting for you (added 2026-09-19, `docs/bugs.md`).
- [x] Harness: `rail`, `dock` and `search` readers in `drive.mjs`.
- [x] Self-test with screenshots and recordings in `docs/screenshots/phase-8/`; CLAUDE.md and PHASES.md updated.

Done when: from Home, the rail shows exactly the projects with a thread waiting or finished, with the three numbers beside each tile; clicking a tile lands on the thread that needs you; the panel shows Pinned and Recent only, with Other projects docked at the bottom; typing in Search narrows the list in place; Ctrl+Shift+Down crosses from one project's last thread to the next project's first.

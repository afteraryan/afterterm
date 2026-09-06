# Phases: projects and threads

Execution plan for [`docs/design-02-projects-and-threads.md`](docs/design-02-projects-and-threads.md). One phase is finished and polished before the next goes deep. Each phase ships as its own release so the app is usable throughout.

Status values: `pending`, `in progress`, `done`. Dates are absolute. This file is the shared state for every session and agent working on the redesign: update the status table and the checklist as work happens, and add a dated line to the log at the bottom when a phase starts, finishes, or is handed to Aryan for testing.

## How this work is done

Agreed with Aryan on 2026-09-06.

**Orchestration.** Each phase is run by an orchestrator session that plans the phase, spawns subagents for independent pieces (renderer, main process, tests, docs), merges their work, and tests the result itself. The orchestrator comes back to Aryan only when the phase is finished and has passed its own testing, to hand it over for use. It does not ask Aryan to try half-built work.

**One worktree and branch per phase, chained.** Phases 0 and 1 (and 1.1) live together on `worktree-projects-and-threads-plan`; that is done and stays as it is. From Phase 2 on, each phase gets its own git worktree and branch, created from the previous phase's branch: Phase 2 branches from `worktree-projects-and-threads-plan`, Phase 3 from Phase 2's branch, Phase 4 from Phase 3's, and so on. Name them `phase-2-home-and-projects`, `phase-3-thread-identity`, and so on. A phase never commits to an earlier phase's branch, and nothing is merged to `main` until Aryan has tested and says so. Record the branch name in the phase's Log line.

**Self-testing, every phase.** Before a phase is called done:
- Unit tests for everything with logic (data model, migration, detection, parsing), run and green.
- The app launched and driven by the agent on the **secondary monitor**, never on the primary where Aryan is working: every screen and interaction of the phase exercised, with screenshots captured. Phase 0 sets up the harness for this (see its checklist).
- The done-when line of the phase verified against the running app, not against the code.
- Every screenshot taken during that testing is saved under `docs/screenshots/<phase>/` in the repo and kept; nothing there is ever deleted (agreed with Aryan on 2026-09-07).

**Testing by Aryan, three stages per phase.**
1. Dev build launched through the agent harness (`npm run harness -- --session <copy of session.json>`), which points `AFTERTERM_USER_DATA_DIR` at a throwaway folder seeded with a copy of the production `session.json` so it shows real projects and threads, not sample data, and puts the window on the secondary display. Fully separate from the running app. The harness strips Claude session ids by default (`--claude-resume none`): resuming the live session from a second build restarted it.
2. An unreleased production build (`npm run build`), which Aryan runs as the primary afterterm for a few days. Bugs go into `docs/bugs.md` tagged with the phase.
3. Fix the list, then release.

Never close the running afterterm. A dev build runs beside it. A copied `session.json` carries Claude session ids; resume stays lazy (on click), so the two builds do not fight over a session unless the same thread is opened in both.

**Decisions taken on 2026-09-06.**
- Search shortcut is **Ctrl+Shift+P**. Ctrl+K stays with the terminal.
- Code keeps `Group` and `Tab`; only the UI says Project and Thread. Code rename is backlog.
- Under the date on Home: the counter pills totalled across projects. When both counts are zero the area is empty, nothing is shown, no "0" and no placeholder.
- Sleep and wake, history, servers and shell integration stay in their phases; nothing is pulled forward.

| Phase | What it delivers | Backend work | Status |
|---|---|---|---|
| 0 | Data model and naming | small | done, with Aryan for testing |
| 1 | Visual system and sidebar | none | done, with Aryan for testing |
| 1.1 | Title bar, close on rows, view transitions | none | in progress |
| 2 | Home, pin, archive, project page | small | pending |
| 3 | Thread identity: chat titles, branch, worktree, timestamps | medium | pending |
| 4 | Sleep, wake, history, scrollback tail | medium | pending |
| 5 | Servers: running state, port, open localhost | medium to large | pending |
| 6 | Shell integration for PowerShell, Git Bash, WSL | large | pending |

## Phase 0: Data model and naming

Goal: the fields every later phase needs, with `session.json` staying loadable by older builds where possible.

- [x] `Group`: add `pinned`, `archived`, `lastActiveAt`. Default: unpinned, not archived, now. `lastActiveAt` is stamped when the user activates one of the group's tabs or opens a terminal in it; PTY activity stamping stays in Phase 2.
- [x] `Tab`: add `lastActiveAt`, `asleep`. Default: now, false. Nothing sets `asleep` true until Phase 4.
- [x] Code keeps `Group` and `Tab`; the UI says Project and Thread (decided).
- [x] Agent test harness (`scripts/agent-harness/`, README there): a script that launches the dev build with a throwaway `AFTERTERM_USER_DATA_DIR` seeded from a given `session.json`, places the window on the secondary display (`screen.getAllDisplays()`, an `AFTERTERM_DISPLAY` env var), and lets an agent drive and screenshot it. Every later phase uses it.
- [x] Session save and restore for the new fields, with a migration for files that lack them (`src/renderer/sessionMigration.ts`; saved files carry `version: 2` and every 0.8.1 key, so 0.8.1 still opens them).
- [x] Invert the sidebar walk (`src/renderer/sidebarWalk.ts`): build from projects, then their threads, so an empty project renders as a row rather than nothing. Existing sessions keep their visible order; projects with no threads are appended after the live list. The Projects shelf is left in place and now duplicates those rows; Phase 1 retires it.
- [x] Unit tests for the migration and the walk (`npm test` runs all four test files).

Done when: a session saved by the current release loads, every project and thread carries the new fields, and the sidebar renders projects with zero threads without the shelf.

## Phase 1: Visual system and sidebar

Goal: the workspace looks and behaves like the mock, using only data the app already has.

Cosmetic, no main-process changes.

- [x] Palette, type (Inter), radii, no-border surfaces, white primary button, tooltips, menus, animations, reduced motion.
- [x] Solid coloured folder icons, open and closed, replacing the group colour bar and dot.
- [x] State icon set A: bell, spinner, play, check, moon. Wired to today's notification states (`attention` = needs you, `working`, `done` transient until viewed). Running and asleep arrive in later phases; the icons ship now.
- [x] Sidebar: brand row with Home and Workspace icons and a collapse toggle; Search and New thread rows; Pinned and Projects sections; General for ungrouped tabs; collapse rail. `Ctrl+Shift+B` toggles the rail.
- [x] Project rows: click anywhere toggles; + and project page icon on hover; pin icon and counter pills on unpinned rows.
- [x] Thread rows: kind icon (chat when a session id is captured, shell otherwise), name, state icon at the right; five per project then "Show N more"; auto-expand to keep the open thread visible; expand and collapse animation.
- [x] Main pane header: kind icon, name, project on line 2, state chip, ⋯ menu. Branch and worktree slots are present but empty until Phase 3.
- [x] Right-click and ⋯ menu: Open, Move to project (submenu with back chevron), Open project page, Close. Sleep and Wake appear in Phase 4. No rename: `/rename` in Claude Code is the only rename.
- [x] Retire the Projects shelf: an empty project is a normal row.
- [x] Overlay toasts restyled (`NotifierApp.css` and the card markup only): thread name as headline, project with folder on line 2, state icon in a tinted circle, no border or stripe, rise entrance. Window behaviour untouched.
- [x] Remove the old glow and pulse styles.

Done when: a fresh session and a restored session both look like the mock's workspace, every menu and hover works, and no old visual remains.

## Phase 1.1: Title bar, close on rows, view transitions

Goal: three things the mock missed and Aryan found while testing Phase 1. Same branch and worktree as Phase 1; this is a continuation, not a new phase. Cosmetic, renderer and window options only.

- [ ] **A real title bar.** The mock had put "afterterm", the version and the Home and Workspace icons in a 56px row that also had to host the OS caption buttons, and the header collided with them. Fix: a separate 32px strip across the full width, in a tone darker than anything below it (`#121212`), holding "afterterm" and the version badge on the left and the Windows caption buttons on the right (the existing `titleBarOverlay`, height set to 32, colour set to the strip's grey, symbols `#8e8e8e`). The strip is the drag region. Everything else starts underneath it: the sidebar's icon row (Home, Workspace, collapse toggle) at 56px, the search and new-thread rows, the main header. Home and the project page get the same strip with their icon row under it. The old 36px branded strip goes.
- [ ] **Close button on thread rows.** On hover the row gains 24px of right padding (animated, 140ms) and an × fades into the freed space at the right edge; the port and state icon move left with the padding, never over the name. The name is the only flexible part of the row and truncates with an ellipsis to whatever is left. The selected row keeps this layout without hover, so its × is always present. × does what Close in the menu does; clicking it must not select the row.
- [ ] **Transitions between screens.** Into the Workspace: the sidebar slides in from the left (18px, 260ms) and the main pane from the right (14px, 260ms, 40ms later). Into Home: the page rises (12px, scale .985, 280ms) and its sections stagger top to bottom at 40ms intervals. Into a project page: the same rise. The title bar and the Home and Workspace icons never move. All off under reduced motion.
- [ ] Screenshots of the three into `docs/screenshots/phase-1/`, and the harness run repeated for the title bar on both displays.

Reference: `docs/mockups/afterterm-next.html` has all three implemented in HTML and CSS (search for `.titlebar`, `.th .xb`, and the `sidein`, `mainin`, `homein`, `stagger` keyframes). Copy the values, not the code.

Done when: the caption buttons sit in their own strip on every screen with nothing under them, hovering any thread row shows an × without anything overlapping the name, and switching Home and Workspace animates as described.

## Phase 2: Home, pin, archive, project page

Goal: the launcher and the project page, so intent has a place.

Small backend: `lastActiveAt` stamped on PTY input and output, and a stored "last opened" time for the app.

- [ ] Home screen: date, Pinned cards, Projects rows with "Show more", Archived link, + on the Projects label.
- [ ] Pin and unpin from cards, rows, sidebar, right-click and the project page. Archive and Restore.
- [ ] Clicking a card or row opens the workspace on that project. The project page opens only from its icon or the menu.
- [ ] Project page: header, Open, New thread, Pin, Edit, Archive; Live and Asleep tabs; History tab present but empty until Phase 4; search over the lists.
- [ ] Open in File Explorer and Open in the editor: logo buttons at the right end of the project page's action row, and entries in every project right-click menu with the logo at the right of the label. Main process: `explorer.exe <folder>`; editor detection at startup (`editorPath` in `prefs.json`, then what `code` really resolves to, then standard install folders, then the uninstall registry), product identified from the exe name so a `code` that opens Cursor is labelled Cursor. Hidden when nothing is found, with a Choose editor… file picker in the menu that writes `editorPath`. Disabled with a tooltip when the project folder is missing. Full edge-case table in the design doc.
- [ ] New thread chooser with project filter and shell dropdown (all five shells); + on a project row creates directly; `Ctrl+Shift+T` opens the chooser.
- [ ] Search palette (`Ctrl+Shift+P`) over projects and threads. History entries join in Phase 4.
- [ ] Under the date: the counter pills totalled across all projects (bell, play). Nothing rendered when both are zero.

Done when: every project you own is visible from Home, pinning is the only way into Pinned, and a project with nothing running is one click from a terminal.

## Phase 3: Thread identity

Goal: a thread says what it is without being opened.

Main process:

- [ ] Chat title: unchanged, it is the terminal title Claude Code sets and updates on `/rename`; only strip the hook's state glyph from the text. Fallback for a chat with no title yet (before Claude's first reply): the first user prompt from the session's JSONL under `~/.claude/projects/`.
- [ ] Model: the latest assistant message's model from the same JSONL, mapped to a display name with context size when present ("Opus 5", "Opus 5 · 1M", "Fable 5.1"). Header line 2 for chat threads, re-read each turn so `/model` shows up.
- [ ] Branch: read `.git/HEAD` in the thread's cwd, re-read when cwd changes and on a slow poll.
- [ ] Worktree: detect a `.git` file (not directory) and derive the worktree folder relative to the main repo.
- [ ] Header line 2 shows branch and worktree with their icons; the hover card shows the same.
- [ ] `lastActiveAt` drives the time shown on cards, rows and the project page.

Limits to state in the release notes: branch and worktree only work where cwd is captured, which is cmd only until Phase 6.

Done when: a chat row shows its Claude title with no state glyph in the text, the header shows the model and context size, and a thread in a worktree shows the branch and folder.

## Phase 4: Sleep, wake, history, scrollback tail

Goal: closing afterterm, or putting a thread down, stops costing context.

Main process:

- [ ] Sleep: kill the PTY tree, keep the tab record, mark `asleep`. Restored tabs start asleep instead of "restorable", replacing today's ✳ marker.
- [ ] Wake: respawn in cwd; `claude --resume` for chats (existing); a fresh prompt for shells. Servers re-run their last command only once Phase 5 has it; until then a server wakes as a shell in its folder.
- [ ] Scrollback tail: on sleep and close, write the last N lines to `%APPDATA%\afterterm\threads\<id>.txt`; on wake, replay dimmed above a "Woke just now" divider.
- [ ] History: on close, append `{title, kind, sessionId, cwd, closedAt}` to the project's history in `session.json` (or a sibling file if it grows). Resume from the project page and from `Ctrl+K`.
- [ ] Sidebar and header: moon icon, "Asleep · 2d" chip, large Wake button in the pane, Sleep and Wake in the menus.
- [ ] Lazy resume stays: waking is always user-initiated, never all at once on launch.

Done when: relaunching shows every previous thread asleep with its old output visible, and closing a chat leaves it findable and resumable.

## Phase 5: Servers

Goal: problem 1 from the original brief, a running server looks different and tells you its port.

Main process:

- [ ] Process tree walk per PTY (children of the shell pid), polled on a slow interval and on output bursts.
- [ ] Listening socket match (`Get-NetTCPConnection -State Listen` or `netstat -ano`) to a pid in that tree. Result: `port` on the tab, state Running.
- [ ] Sidebar row shows `:5173`; header chip says "Running on :5173"; counter pills count it; "Open localhost:5173" in the menus opens the browser through the existing safelisted `shell:openExternal`.
- [ ] Last command capture for cmd through the existing `PROMPT` injection (OSC 133 style marks), so waking a server re-runs it.
- [ ] Confirm before closing a thread that owns a listening port.

Done when: `npm start` in a tab turns its row green with a port within a couple of seconds, and waking that thread after a relaunch brings the server back.

## Phase 6: Shell integration for the other shells

Goal: everything above works in PowerShell 7, Windows PowerShell, Git Bash and WSL, not only cmd.

- [ ] Prompt hooks per shell that emit cwd (OSC 9;9 or OSC 7) and command marks, injected at spawn without clobbering custom prompts (oh-my-posh, starship). Detect an existing prompt function and wrap rather than replace.
- [ ] Opt-out per shell in `prefs.json` for people whose prompts break.
- [ ] Update the CWD capture table in `CLAUDE.md`.

Done when: a Git Bash or PowerShell thread restores to its folder, shows its branch, and re-runs its server on wake.

## Unphased backlog

Things we know we want and have not placed.

- Worktree grouping on the project page.
- What sits under the date on Home, if not decided in Phase 2.
- Daily check-in ("working on these today?") as an optional Home mode.
- Keep closed General threads somewhere, if losing them turns out to hurt.
- Drag a thread between projects in the sidebar (Move to project covers it; drag is nicer).
- Multi-window: one window per pinned project.
- Rename Group and Tab to Project and Thread in code.
- Notification overlay placement on multi-monitor setups (`docs/bugs.md`).
- Project notes (`docs/ideas.md`), reconsidered after the status-note rejection.

## Log

- 2026-09-06: design agreed, plan written, working agreement recorded. No phase started.
- 2026-09-06: Phase 0 started by an orchestrator session on branch `worktree-projects-and-threads-plan`. Split into four pieces: types and migration, sidebar walk, agent harness, tests.
- 2026-09-06: Phase 0 finished and handed to Aryan for testing. Verified through the harness with a copy of the real session (46 tabs, 14 groups, 3 with no tabs): the 0.8.1 file loaded, the saved file came back as version 2 with every new field on every tab and group, the three empty groups rendered as rows with the shelf collapsed, and + on an empty group opened a cmd in its folder. Unit tests: 123 checks green. Not released; no PR.
- 2026-09-07: Phase 1 started by an orchestrator session on branch `worktree-projects-and-threads-plan`. Split into three waves: visual system (theme, Inter bundled from `assets/fonts/`, icons, menu, tooltip, pure thread-view logic with tests), then the sidebar restructure, main pane header and toast cards, then docs and the harness self-test.
- 2026-09-07: Phase 1 finished and handed to Aryan for testing. Three waves: visual system, icons, menu and thread-view logic (Sonnet); sidebar restructure (Opus), header and app wiring (Sonnet), toast cards (Sonnet); docs (Haiku). Verified through the harness on the secondary display with a copy of the real session (47 tabs, 14 projects, 3 empty), with the same copy carrying placeholder session ids (chat kinds, restorable rows) and with an empty profile (one thread in General): Inter loaded from the bundle, no old class in the DOM, project rows collapse and expand, five-row fold with Show more and the forced-open case, thread and project right-click menus with the Move to project submenu and back chevron, the header dots menu, the Edit and New project modals, project delete, the New thread row and its shell menu, drag of a thread onto a project row, Ctrl+Shift+B rail, needs-you, done, background, compacting and working states with pills, breath and the header chip, four toast cards on the overlay, reduced motion emulation. Unit tests: 198 checks green across five files. Screenshots in `docs/screenshots/phase-1/`. Fixed during the test: hidden thread lists are inert, a collapsed project expands when its thread is activated, hover buttons no longer squeeze a project name beside its pills. Not released; no PR.
- 2026-09-07: Phase 1.1 started by the Phase 1 orchestrator session, same branch `worktree-projects-and-threads-plan`. Split into two pieces by file: title bar strip, window options and screen transitions; sidebar brand row trim and the close button on thread rows.

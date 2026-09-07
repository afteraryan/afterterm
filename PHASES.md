# Phases: projects and threads

Execution plan for [`docs/design-02-projects-and-threads.md`](docs/design-02-projects-and-threads.md). One phase is finished and polished before the next goes deep. Each phase ships as its own release so the app is usable throughout.

Status values: `pending`, `in progress`, `done`. Dates are absolute. This file is the shared state for every session and agent working on the redesign: update the status table and the checklist as work happens, and add a dated line to the log at the bottom when a phase starts, finishes, or is handed to Aryan for testing.

## How this work is done

Agreed with Aryan on 2026-09-06.

**Orchestration.** Each phase is run by an orchestrator session that plans the phase, spawns subagents for independent pieces (renderer, main process, tests, docs), merges their work, and tests the result itself. The orchestrator comes back to Aryan only when the phase is finished and has passed its own testing, to hand it over for use. It does not ask Aryan to try half-built work.

**One worktree and branch per phase, chained.** Phases 0 and 1 (and 1.1) live together on `worktree-projects-and-threads-plan`; that is done and stays as it is. From Phase 2 on, each phase gets its own git worktree and branch, created from the previous phase's branch: Phase 2 branches from `worktree-projects-and-threads-plan`, Phase 3 from Phase 2's branch, Phase 4 from Phase 3's, and so on. Name them `phase-2-home-and-projects`, `phase-3-thread-identity`, and so on. A phase never commits to an earlier phase's branch, and nothing is merged to `main` until Aryan has tested and says so. Record the branch name in the phase's Log line.

**Self-testing, every phase.** Aryan tests nothing until every phase is done (decided 2026-09-07, see below), so the orchestrator's own testing is the only testing a phase gets. It has to be thorough enough that the finished app has no issues from the agent's side, main process or renderer, on the real session copy and on an empty profile. Before a phase is called done:
- Unit tests for everything with logic (data model, migration, detection, parsing), run and green.
- The app launched and driven by the agent on the **secondary monitor**, never on the primary where Aryan is working: every screen and interaction of the phase exercised, with screenshots captured. Phase 0 sets up the harness for this (see its checklist).
- The done-when line of the phase verified against the running app, not against the code.
- Every screenshot and every screen recording taken during that testing is saved under `docs/screenshots/<phase>/` in the repo and kept; nothing there is ever deleted (screenshots agreed 2026-09-07, recordings added the same day at Aryan's request during Phase 3).
- The app driven through the harness is recorded (`drive record start` / `record stop`, mp4 through CDP screencast and ffmpeg) for every flow that is exercised, so the run can be watched afterwards, not only read from screenshots.

**Testing by Aryan: once, after every phase is done.** Decided 2026-09-07 at the Phase 2 handoff. Aryan does no manual testing between phases, and no agent asks him to. When Phase 6 is finished he takes an unreleased production build (`npm run build`) as his primary afterterm for a few days, bugs go into `docs/bugs.md` tagged with the phase they belong to, the list is fixed, then a release is cut. The harness (`npm run harness -- --session <copy of session.json>`, a throwaway `AFTERTERM_USER_DATA_DIR` seeded from a copy of the real `session.json`, window on the secondary display, Claude session ids stripped by default) is the agent's tool, not Aryan's.

**How a phase ends.** One orchestrator session works on one phase only. When its phase is done and self-tested it comes back to Aryan with three things, in this order: the questions only Aryan can decide, the decisions it took on its own that he should know about, and, once that discussion is over, the handoff prompt for the next phase, pasted in the chat so a fresh session can start from it. It does not start the next phase itself.

Never close the running afterterm. A dev build runs beside it. A copied `session.json` carries Claude session ids; resume stays lazy (on click), so the two builds do not fight over a session unless the same thread is opened in both.

**Decisions taken on 2026-09-06.**
- Search shortcut is **Ctrl+Shift+P**. Ctrl+K stays with the terminal.
- Code keeps `Group` and `Tab`; only the UI says Project and Thread. Code rename is backlog.
- Under the date on Home: the counter pills totalled across projects. When both counts are zero the area is empty, nothing is shown, no "0" and no placeholder.
- Sleep and wake, history, servers and shell integration stay in their phases; nothing is pulled forward.

**Decisions taken on 2026-09-07 (Phase 2 handoff).**
- The app always opens on Home, projects or not.
- The app's last-opened time (`lastOpenedAt` in prefs.json, the previous launch) gets a **subtle experiment in the UI**, built in Phase 3: a quiet line under the Home date, never a main element. Aryan runs the experiment as a user; whenever work on afterterm resumes, the agent revisits it with him and asks whether it was useful, then it is kept or removed. Projects and threads keep using their own `lastActiveAt`.
- Aryan tests manually only once every phase is done; no agent asks him to test in between. Self-testing has to be thorough enough that the finished app has no issues from the agent's side, backend or frontend.

| Phase | What it delivers | Backend work | Status |
|---|---|---|---|
| 0 | Data model and naming | small | done |
| 1 | Visual system and sidebar | none | done |
| 1.1 | Title bar, close on rows, view transitions | none | done |
| 2 | Home, pin, archive, project page | small | done |
| 3 | Thread identity: chat titles, branch, worktree, timestamps | medium | done |
| 4 | Sleep, wake, history, scrollback tail | medium | done |
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

- [x] **A real title bar.** The mock had put "afterterm", the version and the Home and Workspace icons in a 56px row that also had to host the OS caption buttons, and the header collided with them. Fix: a separate 32px strip across the full width, in the sidebar's own grey (`#171717`; Aryan changed this from `#121212` on 2026-09-07 so the strip and the sidebar are one colour), holding "afterterm" and the version badge on the left and the Windows caption buttons on the right (the existing `titleBarOverlay`, height set to 32, colour set to the strip's grey, symbols `#8e8e8e`). The strip is the drag region. Everything else starts underneath it: the sidebar's icon row (Home, Workspace, collapse toggle) at 56px, the search and new-thread rows, the main header. Home and the project page get the same strip with their icon row under it. The old 36px branded strip goes.
- [x] **Close button on thread rows.** On hover the row gains 24px of right padding (animated, 140ms) and an × fades into the freed space at the right edge; the port and state icon move left with the padding, never over the name. The name is the only flexible part of the row and truncates with an ellipsis to whatever is left. The selected row keeps this layout without hover, so its × is always present. × does what Close in the menu does; clicking it must not select the row.
- [x] **Transitions between screens.** Into the Workspace: the sidebar slides in from the left (18px, 260ms) and the main pane from the right (14px, 260ms, 40ms later). Into Home: the page rises (12px, scale .985, 280ms) and its sections stagger top to bottom at 40ms intervals. Into a project page: the same rise. The title bar and the Home and Workspace icons never move. All off under reduced motion.
- [x] Screenshots of the three into `docs/screenshots/phase-1/`, and the harness run repeated for the title bar on both displays.

Reference: `docs/mockups/afterterm-next.html` has all three implemented in HTML and CSS (search for `.titlebar`, `.th .xb`, and the `sidein`, `mainin`, `homein`, `stagger` keyframes). Copy the values, not the code.

Done when: the caption buttons sit in their own strip on every screen with nothing under them, hovering any thread row shows an × without anything overlapping the name, and switching Home and Workspace animates as described.

## Phase 2: Home, pin, archive, project page

Goal: the launcher and the project page, so intent has a place.

Small backend: `lastActiveAt` stamped on PTY input and output, and a stored "last opened" time for the app.

- [x] Home screen: date, Pinned cards, Projects rows with "Show more", Archived link, + on the Projects label.
- [x] Pin and unpin from cards, rows, sidebar, right-click and the project page. Archive and Restore.
- [x] Clicking a card or row opens the workspace on that project. The project page opens only from its icon or the menu.
- [x] Project page: header, Open, New thread, Pin, Edit, Archive; Live and Asleep tabs; History tab present but empty until Phase 4; search over the lists.
- [x] Open in File Explorer and Open in the editor: logo buttons at the right end of the project page's action row, and entries in every project right-click menu with the logo at the right of the label. Main process: `explorer.exe <folder>`; editor detection at startup (`editorPath` in `prefs.json`, then what `code` really resolves to, then standard install folders, then the uninstall registry), product identified from the exe name so a `code` that opens Cursor is labelled Cursor. Hidden when nothing is found, with a Choose editor… file picker in the menu that writes `editorPath`. Disabled with a tooltip when the project folder is missing. Full edge-case table in the design doc.
- [x] New thread chooser with project filter and shell dropdown (all five shells); + on a project row creates directly; `Ctrl+Shift+T` opens the chooser.
- [x] Search palette (`Ctrl+Shift+P`) over projects and threads. History entries join in Phase 4.
- [x] Under the date: the counter pills totalled across all projects (bell, play). Nothing rendered when both are zero.

Done when: every project you own is visible from Home, pinning is the only way into Pinned, and a project with nothing running is one click from a terminal.

## Phase 3: Thread identity

Goal: a thread says what it is without being opened.

Main process:

- [x] Chat title: unchanged, it is the terminal title Claude Code sets and updates on `/rename`; only strip the hook's state glyph from the text. Fallback for a chat with no title yet (before Claude's first reply): the first user prompt from the session's JSONL under `~/.claude/projects/`. (`src/renderer/chatTitle.ts` for the glyph strip, `src/claude-transcript.ts` for the first-prompt fallback, `threadName` in `src/renderer/threadView.ts` for the rule.)
- [x] Model: the latest assistant message's model from the same JSONL, mapped to a display name with context size when present ("Opus 5", "Opus 5 · 1M", "Fable 5.1"). Header line 2 for chat threads, re-read each turn so `/model` shows up. (`src/claude-transcript.ts`: `latestModel`, `modelDisplayName`; pushed on every hook write via the `claude-session:meta` IPC.)
- [x] Branch: read `.git/HEAD` in the thread's cwd, re-read when cwd changes and on a slow poll. (`src/git-info.ts`, `GIT_POLL_MS` in `src/renderer/app.tsx`.)
- [x] Worktree: detect a `.git` file (not directory) and derive the worktree folder relative to the main repo. (`src/git-info.ts`.)
- [x] Header line 2 shows branch and worktree with their icons; the hover card shows the same. (`src/renderer/components/Header/index.tsx`, `src/renderer/components/ThreadHoverCard.tsx`.)
- [x] `lastActiveAt` drives the time shown on cards, rows and the project page. (`relativeTime` in `src/renderer/homeView.ts`.)
- [x] **Experiment: last opened on Home.** One quiet line under the date (below the counter pills when they show), text3 colour, 12.5px, reading "Last here 2d ago" from `window.afterterm.app.lastOpenedAt` and `relativeTime`. Shown only when the gap is over an hour, nothing on the first launch (null) or after a quick relaunch. No icon, no card, nothing else moves. Documented in CLAUDE.md as an experiment Aryan is running as a user: whenever work resumes, ask him whether it was useful, then keep or remove it. (`lastHereLine` in `src/renderer/homeView.ts`, `.home-lasthere` in `src/renderer/components/Home/index.tsx`.)

Limits to state in the release notes: branch and worktree only work where cwd is captured, which is cmd only until Phase 6.

Done when: a chat row shows its Claude title with no state glyph in the text, the header shows the model and context size, and a thread in a worktree shows the branch and folder.

## Phase 4: Sleep, wake, history, scrollback tail

Goal: closing afterterm, or putting a thread down, stops costing context.

Main process:

- [x] Sleep: kill the PTY tree, keep the tab record, mark `asleep`. Restored tabs start asleep instead of "restorable", replacing today's ✳ marker. (`sleepTab`/`restoredTab` in `src/renderer/sleepWake.ts`, `teardownTerminal` in `src/renderer/components/Terminal/index.tsx`, `restoreSession` in `src/renderer/hooks/useTabState.ts`.)
- [x] Wake: respawn in cwd; `claude --resume` for chats (existing); a fresh prompt for shells. Servers re-run their last command only once Phase 5 has it; until then a server wakes as a shell in its folder. (`wakeTab`/`wakePlan` in `src/renderer/sleepWake.ts`, `createTerminal` in `src/renderer/components/Terminal/index.tsx`.)
- [x] Scrollback tail: on sleep and close, write the last N lines to `%APPDATA%\afterterm\threads\<id>.txt`; on wake, replay dimmed above a "Woke just now" divider. (`src/thread-tail.ts`: `trimTail`, `serializeTail`, `parseTail`, `renderTailForTerminal`; `threads:saveTail`/`saveTailsSync`/`readTail`/`deleteTail`/`prune` in `src/main.ts`; `captureTail` and the wake replay in `src/renderer/components/Terminal/index.tsx`; `handleTail` and the `beforeunload` flush in `src/renderer/app.tsx`.)
- [x] History: on close, append `{title, kind, sessionId, cwd, closedAt}` to the project's history in `session.json` (or a sibling file if it grows). Resume from the project page and from `Ctrl+K`. Went into `session.json` directly rather than a sibling file (`Group.history`, capped at `HISTORY_MAX`); resume is from the project page's History tab and from the search palette (`Ctrl+Shift+P`, not `Ctrl+K`, per the Phase 0 decision), not a separate `Ctrl+K`. (`src/renderer/history.ts`: `historyEntryFor`, `appendHistory`, `tabFromHistory`, `isResumable`; `closeTab`/`resumeFromHistory` in `src/renderer/hooks/useTabState.ts`; `resumeThread` in `src/renderer/app.tsx`.)
- [x] Sidebar and header: moon icon, "Asleep · 2d" chip, large Wake button in the pane, Sleep and Wake in the menus. (`IconMoon`/`StateIcon` in `src/renderer/components/Icons.tsx`, `asleepLabel`/`asleepSinceText` in `src/renderer/sleepWake.ts`, `src/renderer/components/AsleepPane/index.tsx`, `buildThreadMenu` in `src/renderer/threadMenu.tsx`.)
- [x] Lazy resume stays: waking is always user-initiated, never all at once on launch. Phase 4 goes further than "stays": every restored thread now starts asleep (not just background ones), so nothing at all resumes automatically, not even the active tab. (`restoredTab` in `src/renderer/sleepWake.ts`; `docs/features-claude-session-resume.md` updated.)

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
- 2026-09-07: Phase 1.1 finished and handed to Aryan for testing, same branch `worktree-projects-and-threads-plan`. Title bar strip and transitions (Sonnet), sidebar icon row and close button (Sonnet). Verified through the harness with the real session copy: the 32px strip holds the name, version and the OS caption buttons with nothing under them, captured natively on the secondary display (100%) and, with the window moved there at the bottom of the z-order, on the primary (125%); hovering a row adds 24px of padding and the x with no overlap of the name (measured), the selected row keeps it, clicking the x closed the thread and left the selection where it was; the workspace entry animates the sidebar body and the main pane only (computed styles: sidein 260ms, mainin 260ms with a 40ms delay, none on the icon row or the strip). Mid-test Aryan asked for the strip and the caption buttons to take the sidebar grey (#171717), which is in. Screenshots 33 to 39 in `docs/screenshots/phase-1/`. Not released; no PR.
- 2026-09-07: Phase 1.1 follow-up from Aryan while testing: the main pane's top-left corner is rounded where the strip and the sidebar meet it, so it matches the terminal card. Screenshot 40.
- 2026-09-07: Phase 2 started by an orchestrator session on branch `phase-2-home-and-projects` (worktree `.claude/worktrees/phase-2-home-and-projects`, created from `worktree-projects-and-threads-plan` at d0ce70c). Split into two waves: main process (activity stamping, last-opened time, Explorer and editor launch, editor detection), Home and project page, chooser and palette, harness hover and drag; then app wiring, sidebar and menus, then the harness self-test and docs.
- 2026-09-07: Phase 2 finished and handed to Aryan for testing on branch `phase-2-home-and-projects` (pushed; no PR, no merge). Wave 1: main process (Opus: PTY activity stamps, last-opened time, Explorer launch, editor detection with tests, editor open and Choose editor, Ctrl+Shift+P), Home and project page with the shared project menu (Sonnet), chooser and palette (Sonnet), harness hover, drag, screen trees and occluded-window capture (Sonnet). Wave 2: app wiring, pin, archive, activity, sidebar and menus (Opus). Docs (Haiku). Verified through the harness on the secondary display, pushed to the bottom of the z-order because a video was playing there, with a copy of the real session (48 threads, 14 projects, 3 empty, one without a folder), a small seed carrying pinned, archived, missing-folder and no-folder projects, and an empty profile: Home opens first (at first only when projects existed; changed to always after the handoff, see the next line); pin from a Home row, a card, the sidebar row and the project page; Pinned card and section; card click opens the workspace on that project; Show more and Show less; the project menu with the Explorer and VS Code logos, the no-folder variant, the archived variant, and the missing-folder variant with both entries disabled and the "Folder not found" tip; archive from the menu and the page, the Archived link, Restore from the row and the page, opening an archived row restores it; the project page icon from Home rows, sidebar rows, the thread menu and the header menu; Live, Asleep and empty History tabs, search, tooltip on the logo buttons; New thread chooser from the row, the rail and Ctrl+Shift+T (from Home it switches to the workspace first and keeps focus), filter, arrows, the shell dropdown, Enter creating a pwsh thread in the chosen project; the palette from Ctrl+Shift+P and the Search row, filter, Enter, toggle and Escape; needs-you totals pill under the date and the project pill; activity stamps on typing landing in the saved session.json and lastOpenedAt in prefs.json; entrance animations (homein 280ms, stagger 40ms and 80ms) and their absence under reduced motion, measured in one CDP session; Explorer launch (window opened and closed again); sidebar drag still moves a thread into a project. Unit tests: 324 checks green across nine files. Fixed during the test: the terminal took focus from the chooser opened by the shortcut, Escape only worked from the input, an unknown editor id fell back to the primary editor and launched it, and every project read "now" after a relaunch because a shell banner counted as activity (main now ignores a PTY's first 5s). Screenshots 01 to 37 in `docs/screenshots/phase-2/`. Not released; no PR.
- 2026-09-07: Phase 2 follow-up from Aryan: the app always opens on Home, projects or not (it had opened the workspace when there was no project). Same branch, one-line rule change in `initialScreen` with its test.
- 2026-09-07: Working agreement changed at the Phase 2 handoff: Aryan tests once, after every phase is done, never in between; each phase ends with the questions for Aryan, the decisions taken, then the handoff prompt for the next phase. The last-opened time becomes a subtle Home experiment, built in Phase 3, to be revisited with Aryan when work resumes.
- 2026-09-07: Phase 3 started by an orchestrator session on branch `phase-3-thread-identity` (worktree `.claude/worktrees/phase-3-thread-identity`, created from `phase-2-home-and-projects` at 331677f). Split into two waves: main process (transcript reader for the first prompt and the model, git HEAD and worktree reader) with the data model and pure renderer rules; then header line 2, the hover card, the Home experiment line and the app wiring; then the harness self-test and docs.
- 2026-09-07: Phase 3 finished and self-tested on branch `phase-3-thread-identity` (pushed; no PR, no merge). Wave 1: main process (Opus: `claude-transcript.ts` reading the first prompt and the latest model from the session transcript with head and tail reads, `git-info.ts` reading HEAD and the worktree folder, the `claude-session:meta` and `git:info` IPC with a push after every hook write) and the data model and pure rules (Sonnet: Tab.model, branch, worktree, `chatTitle.ts`, `threadName`, `modelLabel`, `lastHereLine`). Wave 2: app and sidebar wiring with the hover card mount and the 30 s poll (Opus), header line 2 and the hover card (Sonnet), the Home line, project page rows, palette names and the harness `header`, `hover-card` and `hover --wait` commands (Sonnet). Then the screencast recorder `drive record start/stop` (Sonnet, asked for by Aryan mid-phase) and the docs (Sonnet). Verified through the harness on the secondary display, pushed to the bottom of the z-order because the running afterterm sits there, with a copy of the real 0.8.1 session (49 threads, 14 projects: header shows project and branch main for the active cmd thread, hover card on a shell row), with a seed of six threads and fixture transcripts under a scratch `AFTERTERM_CLAUDE_PROJECTS_DIR` (a chat in this worktree shows "Opus 5 · 1M", branch `phase-3-thread-identity` and worktree `.claude\worktrees\phase-3-thread-identity`; a chat with a "cmd.exe" title is named by its first prompt "Fix the spinner sticking after compaction" and shows "Fable 5.1", branch main, no worktree; a session switched to Sonnet shows "Sonnet 5"; a chat in a folder with no repo shows the model from the attachment and no branch; a simulated hook write after an appended assistant turn changed the header from "Opus 5 · 1M" to "Sonnet 5" without a relaunch; `cd` out of the worktree in the active cmd thread changed the header to branch main with no worktree; the palette finds the chat by its first prompt; the project page rows carry kind, branch and worktree; the hover card on a restored chat says "Chat · Resumes on click"; model, branch, worktree and claudeTitle land in the saved session.json with no transient field; a relaunch from that file keeps the chat names and the header), with a relaunch after a quick restart (no "Last here" line) and a prefs seed two days back ("Last here 2d ago" under the date), and with an empty profile (Home without the line, Ctrl+Shift+T creates a shell in General with no branch). Fixed during the test: the Claude title was only kept in memory, so on the second relaunch every chat fell back to its first prompt (every restored shell overwrites the raw title with "cmd.exe"); it is now a persisted, additive tab key. The restorable row tooltip doubled up with the hover card; the card carries the note instead. The recorder padded every frame to 1/12 s, which stretched recording 15 to 64 s for a 20 s run; frames faster than the rate are now dropped (recording 15 is kept as it is, 16 to 19 are real time). Unit tests: 503 checks green across 12 files. Screenshots 01 to 19 and recordings 15 to 20 in `docs/screenshots/phase-3/`. Limit: branch and worktree show only where the cwd is captured, cmd only for shells until Phase 6; chats get their cwd from the hook and work from any shell. Not released; no PR.
- 2026-09-07: Phase 4 started by an orchestrator session on branch `phase-4-sleep-wake-history` (worktree `.claude/worktrees/phase-4-sleep-wake-history`, created from `phase-3-thread-identity` at a48664c). Split into two waves: main process (scrollback tail files and their IPC) with the pure sleep, wake, history and migration rules; then the Terminal, tab state and app wiring, the asleep pane, chip, menus, project page History tab and palette entries, and the harness commands; then the harness self-test and docs.
- 2026-09-07: Phase 4 finished and self-tested on branch `phase-4-sleep-wake-history` (pushed; no PR, no merge). Wave 1: main process (Opus: `src/thread-tail.ts` with the tail file rules, the `threads:*` IPC for save, synchronous save-all at quit, read, delete and prune under `%APPDATA%fterterm	hreads\<id>.txt`, `pty.offExit` in the preload) and the pure rules and data model (Sonnet: `sleepWake.ts`, `history.ts`, `Tab.sleptAt` and `Group.history` in the migration, palette history results, tests). Wave 2: the terminal layer, tab state and app wiring (Opus: `Tab.asleep` as the source of truth, no xterm and no PTY for an asleep thread, tail capture on sleep and close, replay on wake, the pending-destroy guard, close to history, resume from history, every restored thread asleep, the quit flush), the components (Sonnet: `AsleepPane`, the "Asleep · 2d" chip, Sleep and Wake in the thread menu, the hover card, asleep rows at 45%, the project page History tab with Resume, the palette History section) and the harness (Sonnet: `pane` and `tail` commands, History rows in `project` and `palette`, `[asleep]` in `sidebar`); docs (Sonnet). Fixed during the test: the wake replay was wiped by ConPTY's first paint (it clears the viewport and positions absolutely), so the tail now goes into scrollback before the spawn and the viewport scrolls back to it once the banner has landed; the harness tail reader took the last N rows of a mostly blank viewport; a graceful quit had no harness command (added `drive window quit`, with the main window's close confirm skipped under `AFTERTERM_HARNESS=1`). Verified through the harness on the secondary display, pushed to the bottom of the z-order because the running afterterm sits there: with a seed of five threads, three projects and four history entries plus tail files and fixture transcripts under a scratch `AFTERTERM_CLAUDE_PROJECTS_DIR` (Home, every row asleep with the moon at 45%, the pane with the dimmed tail, the Wake button and "Chat asleep since 2d ago", the chip "Asleep · 2d", the hover card "Chat · Asleep · 2d", Wake replaying the tail dimmed above "Woke just now" with the cmd banner and the `claude --resume` attempt under it, Sleep from the row menu capturing the new tail and killing the shell (one cmd.exe left in the process tree, the harness wrapper), a shell asleep 5m waking to its prompt, closing an asleep project chat with the "Moved to history" toast and its tail file kept, closing a General thread with nothing left behind, the orphan tail pruned at launch, the project page History tab with four rows and Resume on the chats only, Resume recreating the thread under its title with the model from the transcript and the tail replayed, the palette's History row opening the project page on its History tab, Ctrl+Shift+W filing the resumed thread back into history with its screen written to disk, the header menu showing Wake on an asleep thread; a relaunch after a hard kill restoring an awake thread asleep; a graceful quit stamping every thread asleep and flushing the typed output, and the relaunch after it showing that output in the pane, with an empty pane for a thread that never ran), with a copy of the real 0.8.1 session (51 threads, 14 projects: every thread restored asleep and no PTY spawned, a shell woken in its folder and slept from the header menu, the hover card, the project page Asleep tab with eight rows and an empty History, the palette without a History group; the saved file keeps every 0.8.1 key, all 51 asleep, `history: []` on every project), and with an empty profile (a fresh shell awake, slept from the header menu, woken from the row menu with the replay, closed with Ctrl+Shift+W leaving no history, no toast and no tail file, a new shell taking its place). Unit tests: 669 checks green across 15 files. Screenshots 01 to 33 and recordings 01, 05, 19, 22, 24 and 30 in `docs/screenshots/phase-4/`. Decision taken: nothing wakes on launch, the previously active chat included; the user wakes it from the pane or the menu. Not released; no PR.

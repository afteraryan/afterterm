# Phases: projects and threads

Execution plan for [`docs/design-02-projects-and-threads.md`](docs/design-02-projects-and-threads.md). One phase is finished and polished before the next goes deep. Each phase ships as its own release so the app is usable throughout.

Status values: `pending`, `in progress`, `done`. Dates are absolute.

| Phase | What it delivers | Backend work | Status |
|---|---|---|---|
| 0 | Data model and naming | small | pending |
| 1 | Visual system and sidebar | none | pending |
| 2 | Home, pin, archive, project page | small | pending |
| 3 | Thread identity: chat titles, branch, worktree, timestamps | medium | pending |
| 4 | Sleep, wake, history, scrollback tail | medium | pending |
| 5 | Servers: running state, port, open localhost | medium to large | pending |
| 6 | Shell integration for PowerShell, Git Bash, WSL | large | pending |

## Phase 0: Data model and naming

Goal: the fields every later phase needs, with `session.json` staying loadable by older builds where possible.

- [ ] `Group`: add `pinned`, `archived`, `lastActiveAt`. Default: unpinned, not archived, now.
- [ ] `Tab`: add `lastActiveAt`, `asleep`. Default: now, false.
- [ ] Decide whether code renames Group to Project and Tab to Thread, or only the UI does. Recommendation: UI only in this phase, code rename later if it earns its keep.
- [ ] Session save and restore for the new fields, with a migration for files that lack them.
- [ ] Invert the sidebar walk: build from projects, then their threads, so an empty project renders as a row rather than nothing. This retires the Projects shelf's reason to exist (see Phase 1).
- [ ] Unit tests for the migration and the walk.

Done when: a session saved by the current release loads, every project and thread carries the new fields, and the sidebar renders projects with zero threads without the shelf.

## Phase 1: Visual system and sidebar

Goal: the workspace looks and behaves like the mock, using only data the app already has.

Cosmetic, no main-process changes.

- [ ] Palette, type (Inter), radii, no-border surfaces, white primary button, tooltips, menus, animations, reduced motion.
- [ ] Solid coloured folder icons, open and closed, replacing the group colour bar and dot.
- [ ] State icon set A: bell, spinner, play, check, moon. Wired to today's notification states (`attention` = needs you, `working`, `done` transient until viewed). Running and asleep arrive in later phases; the icons ship now.
- [ ] Sidebar: brand row with Home and Workspace icons and a collapse toggle; Search and New thread rows; Pinned and Projects sections; General for ungrouped tabs; collapse rail. `Ctrl+Shift+B` toggles the rail.
- [ ] Project rows: click anywhere toggles; + and project page icon on hover; pin icon and counter pills on unpinned rows.
- [ ] Thread rows: kind icon (chat when a session id is captured, shell otherwise), name, state icon at the right; five per project then "Show N more"; auto-expand to keep the open thread visible; expand and collapse animation.
- [ ] Main pane header: kind icon, name, project on line 2, state chip, ⋯ menu. Branch and worktree slots are present but empty until Phase 3.
- [ ] Right-click and ⋯ menu: Open, Move to project (submenu with back chevron), Open project page, Close. Sleep and Wake appear in Phase 4. No rename: `/rename` in Claude Code is the only rename.
- [ ] Retire the Projects shelf: an empty project is a normal row.
- [ ] Remove the old glow and pulse styles.

Done when: a fresh session and a restored session both look like the mock's workspace, every menu and hover works, and no old visual remains.

## Phase 2: Home, pin, archive, project page

Goal: the launcher and the project page, so intent has a place.

Small backend: `lastActiveAt` stamped on PTY input and output, and a stored "last opened" time for the app.

- [ ] Home screen: date, Pinned cards, Projects rows with "Show more", Archived link, + on the Projects label.
- [ ] Pin and unpin from cards, rows, sidebar, right-click and the project page. Archive and Restore.
- [ ] Clicking a card or row opens the workspace on that project. The project page opens only from its icon or the menu.
- [ ] Project page: header, Open, New thread, Pin, Edit, Archive; Live and Asleep tabs; History tab present but empty until Phase 4; search over the lists.
- [ ] Open in File Explorer and Open in the editor: logo buttons top-right of the project page and entries in every project right-click menu. Main process: `explorer.exe <folder>`; editor detection at startup (`editorPath` in `prefs.json`, then what `code` really resolves to, then standard install folders, then the uninstall registry), product identified from the exe name so a `code` that opens Cursor is labelled Cursor. Hidden when nothing is found, with a Choose editor… file picker in the menu that writes `editorPath`. Disabled with a tooltip when the project folder is missing. Full edge-case table in the design doc.
- [ ] New thread chooser with project filter and shell dropdown (all five shells); + on a project row creates directly; `Ctrl+Shift+T` opens the chooser.
- [ ] Search palette (`Ctrl+K`) over projects and threads. History entries join in Phase 4.
- [ ] Decide and build what sits under the date (see Open decisions in the design doc).

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

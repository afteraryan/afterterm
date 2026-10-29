# Phases

What is still open in afterterm, and, once a round of work starts, the phases it is split into. Keep it current as work happens: what has to be done, what is done, what is pending.

**In progress: automatic updates** (started 2026-10-30, on the `worktree-auto-update` branch). The last finished round, projects and threads (Phases 0 to 9 and the fixes after them), was released as afterterm 0.9.0 on 2026-09-30; its full record, with every decision and its date, is [`docs/phases-01-projects-and-threads.md`](docs/phases-01-projects-and-threads.md).

## Automatic updates

An installed afterterm finds a newer release on GitHub, tells the user ("afterterm 0.11.0 is available", with What's new, Update, Later and Skip this version), downloads the installer in the background with progress, checks it against the sha256 GitHub publishes, and on "Restart to update" closes, installs quietly, reopens and wakes every thread that was awake. Never forced; a setting turns the checks off.

Decided before Phase 1 (Aryan, 2026-10-30):

- The source is the GitHub Releases API (`releases/latest` on afteraryan/afterterm). No server of our own.
- Each release has one asset, `afterterm-<version>-setup.exe`. The download is checked against the asset's `digest` (sha256) before it runs, since the installer is not code-signed.
- Only installed copies check and update. A build run from `out\` or a harness run never checks.
- Setup gets a quiet update mode: no welcome screen, same folder and shortcuts, reopens afterterm when done.
- Updating closes afterterm (ConPTY cannot survive it), and the app says so before the restart.
- afterterm saves which threads are awake at quit and wakes them on the next launch (chats through `claude --resume`). This replaces `scripts/update-build.mjs`'s wake over CDP.
- Anyone on 0.10.0 or older installs the first version with the updater by hand, once.
- For testing, an environment variable points the update check at a local JSON file and a local installer, so no fake public release is ever published.

### Phase 1: Mockup

Status: **in progress**.

A clickable HTML mockup in afterterm's own look, one plain question per page, covering the update notice, What's new, the download progress and Restart to update. Aryan agrees to it before any app code is written.

- [x] Read the installer, release and idea docs; worktree entered.
- [x] Mockup pages: `docs/mockups/update-index.html` and seven questions (`update-1-where.html` to `update-7-turn-off.html`), sharing `update-shared.css` and `update-shared.js`. Each page answers on a working copy of afterterm and uses the answers already picked on the others. Checked in headless Edge; captures in `docs/screenshots/auto-update-phase-1/`.
- [ ] Aryan's answers to the seven questions, recorded here with the date.

### Phase 2: Development

Status: not started.

Everything above, built and unit-tested, in one phase.

- [ ] Update check against `releases/latest`: compare versions, respect Skip and Later, never on a dev or harness build, off when the setting says so.
- [ ] The local override (environment variable) for the release JSON and the installer.
- [ ] The notice, What's new, the background download with progress, the sha256 check (a mismatch is refused and the file deleted), Restart to update with its warning.
- [ ] The setting that turns the checks off.
- [ ] Setup's quiet update mode: same folder, same shortcuts, no welcome screen, reopens afterterm.
- [ ] Awake threads saved at quit (a field in `session.json` through `sessionMigration.ts`) and woken on the next launch.
- [ ] Unit tests for the pure parts (version compare, release parsing, the checksum, the wake list), added to `npm test`.
- [ ] CHANGELOG.md (Unreleased) and `docs/to-verify.md` entries.

### Phase 3: Testing

Status: not started.

End to end with the sandbox build ("afterterm (test)", `npm run installer -- --sandbox`): install an older test version, serve a newer one through the local override, and go through the notice, Later, Skip, the download, the checksum check (a corrupted file refused), Restart to update and the threads waking. Screenshots and recordings in `docs/screenshots/auto-update-phase-3/`.

### Phase 4: Releasing

Status: not started. Only when Aryan says so: the version bump through a PR, then the release.

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

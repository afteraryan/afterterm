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

Status: **done** (2026-10-30).

A clickable HTML mockup in afterterm's own look, one plain question per page, covering the update notice, What's new, the download progress and Restart to update. Aryan agrees to it before any app code is written.

- [x] Read the installer, release and idea docs; worktree entered.
- [x] Mockup pages: `docs/mockups/update-index.html` and seven questions (`update-1-where.html` to `update-7-turn-off.html`), sharing `update-shared.css` and `update-shared.js`, also published as a private artifact (https://claude.ai/artifact/1HjH2EmUjnA6DkqJhnFka7). Each page answers on a working copy of afterterm and uses the answers already picked on the others. Checked in headless Edge; captures in `docs/screenshots/auto-update-phase-1/`.
- [x] Aryan's answers, 2026-10-30:
  1. Where the notice shows: **in the title bar.** An "Update available" button beside the version number; nothing opens by itself; clicking it opens the notice under it. While downloading the button shows a small bar and "Downloading 47%"; when ready it becomes a white "Restart to update" button.
  2. What's new: **opens inside the notice**, folding open under the title with Update, Later and Skip this version still underneath.
  3. After Later: **a day later**, even if afterterm stays open.
  4. Before the restart: **ask every time, and list every awake thread.** Heading "Restart afterterm to update?" (no version number, no paragraph under it); a table, one row per awake thread, the name on the left and a short outcome on the right ("Resumes", "Runs again on :5173", "Opens in its folder", and "Stops mid-turn" in yellow for a chat mid-turn); one small status line left of the buttons, "✓ Safe to restart" or "1 chat stops mid-turn"; buttons Not now and Restart now. The window shows even when nothing is busy.
  5. Between closing and reopening: **a small window with progress** ("Updating afterterm to 0.11.0", a bar, a percentage), in Setup's look.
  6. After reopening: **where I was, with a short note.** afterterm opens on the thread that was open, the threads that were awake wake, and a pill at the bottom says "Updated to 0.11.0" with a What's new button; a small round × sits on the pill's top-right corner, outside the pill, and the pill goes by itself after a few seconds.
  7. Turning checks off and checking by hand: **an About window**, opened by clicking the version number. Logo, name, version; one update row that keeps one height in every state (last checked plus Check for updates; Checking; "afterterm 0.11.0 is available" plus What's new and Update; a download bar plus What's new and Cancel; "afterterm 0.11.0 is ready" plus What's new and Restart to update); What's new slides a panel open under that row and the window grows smoothly, and slides shut the same way; a switch "Check for updates automatically"; one link, "afterterm on GitHub"; Close fades the window out.
- Also decided while reviewing (2026-10-30): a chat stopped mid-turn is resumed by afterterm itself (`claude --resume`), but Claude does not finish the interrupted reply, so the user sends the message again. Screens say only "Stops mid-turn"; the explanation lives in docs. In-app copy stays minimal: a heading, short rows, one small status line, no explaining paragraphs.

### Phase 2: Development

Status: **done** (2026-10-30), in PR #58; Aryan's checks are in `docs/to-verify.md`. The record is [`docs/features-updates.md`](docs/features-updates.md); captures and the recording are in `docs/screenshots/auto-update-phase-2/`.

Everything above, built and unit-tested, in one phase.

- [x] Update check against `releases/latest`: compare versions, respect Skip and Later (24 hours), never on a dev or harness build, off when the setting says so. (`src/update-check.ts`, `src/updater.ts`)
- [x] The local override (environment variable) for the release JSON and the installer: `AFTERTERM_UPDATE_FEED`, with `AFTERTERM_UPDATE_CHECK_DELAY_MS`; `scripts/agent-harness/update-feed.mjs` writes a feed.
- [x] The title bar button and its notice, What's new folding open inside it, the background download with progress, the sha256 check (a mismatch is refused and the file deleted), the restart window listing every awake thread.
- [x] The About window from the version number: Check for updates, the update row through every state (375px in every one, checked in the harness), What's new, the automatic switch, the GitHub link, the animations.
- [x] Reopening where the user was, with the "Updated to" pill.
- [x] Setup's quiet update mode: same folder, same shortcuts, no welcome screen, a small progress window, reopens afterterm. (The sandbox installer was built once in the worktree to prove it compiles; not installed or run. Running it is Phase 3.)
- [x] Awake threads saved at quit (`wakeAfterUpdate` in `session.json` through `sessionMigration.ts`, written only by an update restart) and woken on the next launch, only when the update went in.
- [x] Unit tests for the pure parts (version compare, release parsing, the checksum, the wake list), added to `npm test` (`src/update-check.test.ts`, 107 checks; `wakeAfterUpdate` in `sessionMigration.test.ts`).
- [x] CHANGELOG.md (Unreleased) and `docs/to-verify.md` entries. Also `docs/features-updates.md`, CLAUDE.md, the release guide and the harness README.

Decided while building (2026-10-30), where design-05 said nothing or the mockup and the design differed:

- The sandbox build ("afterterm (test)") only takes an asset named `afterterm-test-<version>-setup.exe`, so it can never download and run the real installer over itself.
- The About window in a copy that is not installed (dev, `out\`, harness without a feed) reads "Updates install only into an installed copy." with Check for updates turned off. A check by hand that cannot reach GitHub reads "Couldn't check for updates."; a timed one stays silent.
- After a failed download the notice's Update button reads "Try again" (the About window's too).
- The "Ready" notice keeps the mockup's "Restart afterterm to finish." and Later there only closes the notice: the white "Restart to update" button stays, since the download is already done.
- Pressing Update from the About window on a version held back by Later or Skip shows the title bar button again for the download.
- The "Updated to" pill stays while the pointer rests on it (like the overlay toasts); the threads after an update wake 250 ms apart.
- The restart window: Escape is Not now, a click beside it does nothing, and with no awake thread it shows only the heading, the status line and the buttons.
- Setup's update mode on failure: "afterterm could not be updated", the reason, Close, and "Open afterterm" when the old copy is still there. It waits 60 seconds for afterterm to quit, then 30 more for nothing to run from the folder.
- A third test variable, `AFTERTERM_UPDATE_SLOW_MS`, spreads a local installer's copy over that long so the progress can be watched and captured. It does nothing to a real download.
- What's new is left out wherever the release has no notes.

Answered by Aryan (2026-10-30):

1. A chat waiting on a permission prompt (needs-you, the bell) also reads "Stops mid-turn" in the restart window: it loses that prompt on restart just as a chat mid-reply loses its reply. (`isMidTurn` in `src/update-check.ts`.)
2. Push the branch and open the PR: done.

### Phase 3: Testing

Status: **done** (2026-10-31). Captures and two recordings in `docs/screenshots/auto-update-phase-3/`.

What was run: the test build installed for real (0.10.0 over the 0.9.0 test install, Start menu shortcut unticked), then updated twice from inside the app, 0.10.0 to 0.11.0 and 0.11.0 to 0.12.0, through a local feed; afterwards the test build was uninstalled and the earlier test data put back.

- [x] An installed copy knows it is installed; with no feed it checked the real GitHub `releases/latest` and correctly found nothing for the test build.
- [x] A download that does not match the release is refused and deleted; the real one is downloaded and its hash verified.
- [x] The restart window: a chat waiting for permission reads "Stops mid-turn".
- [x] Restart now: the app quit in 8 seconds, `pendingUpdate` and `wakeAfterUpdate` written, Setup's update window waited for it, installed, and reopened the app (17 seconds from Restart now to the new version on screen, the second time).
- [x] The Settings > Apps entry and the app both report the new version; the desktop shortcut kept (same file, same date), the unticked Start menu shortcut still absent, after both updates.
- [x] Reopened on the workspace and the thread that was open; the four threads that were awake woke (a chat typed `claude --resume <id>`, the server ran `node serve.js` again on :5199), the asleep one stayed asleep; "Updated to 0.12.0" shown; the old installer deleted.
- [x] A reinstall that is not an update restart opens on Home with everything asleep and no pill.
- [x] **Found and fixed:** the install folder is not in the Settings > Apps entry; electron-builder writes `InstallLocation` to `HKCU\Software\<same key>`. Neither the installed-copy check nor Setup (since 0.10.0) found it, so no installed copy would ever have updated. Both now read it there, with the uninstaller's folder as fallback (`installFolder`, `ExistingInstallFolder`).
- [x] **Found and fixed:** Setup's update window opened behind the window in front (afterterm itself was not the foreground app in the test). It is now topmost and activated while it works.
- [x] A real conversation comes back (Aryan, 2026-10-31): he logged the test build into Claude Code, told a chat to remember "pineapple", the test build updated 0.11.0 to 0.12.0 (16 seconds), the chat woke through `claude --resume`, and after Claude Code's own folder-trust question it answered "pineapple". The restart window had listed it as "Resumes", "Safe to restart".
- Not covered: the real GitHub download path end to end (it needs a public release; the first real one is the 0.11.0 release itself).

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

# Design 05: automatic updates

Agreed with Aryan on 2026-10-30 against the clickable mockup `docs/mockups/update-index.html` (published privately as https://claude.ai/artifact/1HjH2EmUjnA6DkqJhnFka7). Phases and status are in `PHASES.md` ("Automatic updates"). This document is what Phase 2 builds. Where it says "the mockup", open `docs/mockups/update-shared.js` and `update-shared.css`: the copy, sizes, colours and motion there are the agreed look, built on `src/renderer/theme.css` tokens.

## What the user gets

An installed afterterm finds a newer release on GitHub and says so with an "Update available" button in the title bar. Nothing opens by itself and nothing is forced. Update downloads the installer in the background with progress, checks it against the sha256 GitHub publishes, and offers "Restart to update". That asks first, listing every awake thread and what happens to it; then afterterm closes, a small window shows the install's progress, afterterm opens again on the thread that was open, the threads that were awake wake, and a short "Updated to 0.11.0" pill appears. An About window, opened from the version number, checks by hand and turns automatic checks off.

## Decisions

### Where updates come from

- `GET https://api.github.com/repos/afteraryan/afterterm/releases/latest` (drafts and prereleases are excluded by GitHub). Send a `User-Agent` and `Accept: application/vnd.github+json`. No token. Treat 403/429 (rate limit) and network errors as "no update this time", quietly.
- Version: `tag_name` without the leading `v`; compare as semver `MAJOR.MINOR.PATCH` numbers against `app.getVersion()`. Newer only.
- The asset is the one named exactly `afterterm-<version>-setup.exe`. Its `digest` field is `sha256:<hex>`. **No digest, or a digest that is not sha256, means the update is not offered** (the installer is unsigned; the hash is the only check).
- Release notes: the release `body` (Markdown, written from CHANGELOG.md's section: `###` headings, `-` bullets, `**bold**`, links, and image lines). Render a small subset in the renderer: headings, bullets, bold, links (open in the browser through the existing `shell.openExternal` path). Skip images. A pure, unit-tested converter, no new dependency.

### Who checks

- Only an installed copy. "Installed" means `app.isPackaged` and the exe's folder is the `InstallLocation` of this product's Settings > Apps entry (the same entry Setup.cs reads; the sandbox build has its own entry and app id, so it checks against its own). Read the registry asynchronously, never blocking startup.
- A dev build, a build run from `out\`, and a harness run never check. A harness run sets `AFTERTERM_USER_DATA_DIR`; treat that as "not installed" too.
- **Test override:** `AFTERTERM_UPDATE_FEED=<path to a JSON file>` replaces the GitHub URL. The file has the same shape as the GitHub response (`tag_name`, `body`, `assets[]` with `name`, `size`, `digest`, `browser_download_url`); `browser_download_url` may be a `file:///` URL or a plain local path to an installer. When the override is set, checks run even in a build that is not installed, so the UI can be exercised in the harness; but "Restart to update" in a build that is not installed does not run Setup: it shows "Updates install only into an installed copy" in the notice and stops. Optional `AFTERTERM_UPDATE_CHECK_DELAY_MS` shortens the first check's delay for tests.
- When: first check about 10 seconds after launch, then every 6 hours while running. Never while a download is in progress.

### Settings and remembered state (prefs.json, through `src/prefs.ts`)

- `updateChecks: 'enabled' | 'disabled'` (default enabled). The About window's switch "Check for updates automatically" writes it. A manual "Check for updates" works even when disabled.
- `updateSkippedVersion`: Skip this version. That version is never shown again; a newer one is.
- `updateLaterUntil`: epoch ms. Later hides the button for **24 hours**, even if afterterm stays open; then it shows again.
- `updateLastChecked`: epoch ms, shown in the About window ("Last checked today at 09:12").
- `pendingUpdate: { from, to, activeThreadId, screen }` written just before the restart; read and cleared on the next launch (see "After the restart").

### The title bar button (mockup question 1, "In the title bar")

- `components/TitleBar`: after the version badge, a pill. Must be `-webkit-app-region: no-drag` (the strip is the window's drag region).
- States: "Update available" (green tint, small green dot); while downloading, a small bar plus "Downloading 47%"; when ready, a white "Restart to update" pill that opens the restart window directly. Hidden while Later or Skip applies, unless the user opens it from the About window.
- Clicking "Update available" or "Downloading" opens **the notice** under the button (popover, 390px, `#2a2a2a`, radius 16): icon, "afterterm 0.11.0 is available", "You have 0.10.0.", a What's new toggle that **folds the notes open inside the notice** (mockup question 2), then Update, Later, Skip this version. Downloading: "Downloading afterterm 0.11.0", "You can keep working while it downloads.", a bar, "40.7 of 71.4 MB", percentage, Cancel. A click outside closes it.
- A download that fails its checksum: the file is deleted and the notice says "The download didn't match the release, so it was deleted." with Try again. A network failure: "The download stopped." with Try again. Keep it that short.

### The restart window (mockup question 4, "Ask, and list every thread")

Shown every time "Restart to update" is pressed, busy or not. Minimal; no extra text:

- Heading "Restart afterterm to update?" No version number, no paragraph.
- A table, one row per **awake** thread (asleep threads are not listed): kind icon, name on the left, outcome on the right:
  - a chat: "Resumes"; a chat mid-turn (spinner state, working): **"Stops mid-turn"** in yellow (`--need`);
  - a thread with a listening port: "Runs again on :5173";
  - any other shell: "Opens in its folder".
- One small status line left of the buttons: "✓ Safe to restart" (soft green) or "1 chat stops mid-turn" / "2 chats stop mid-turn" (yellow, bell icon).
- Buttons: Not now, Restart now.
- Behind "Stops mid-turn" (for docs, not the screen): afterterm resumes the chat itself with `claude --resume`, but Claude does not finish the interrupted reply; the user sends the message again.

### Installing (mockup question 5, "A small window with progress")

- Setup (`installer/setup/Setup.cs` + `Setup.xaml`, built by `scripts/build-installer.js`) gains a quiet update mode, for example `--update --wait-pid <pid> --version <x>`:
  - waits for that afterterm process to exit (with a timeout and a clear failure);
  - shows only a small window in Setup's own look: the logo, "Updating afterterm to 0.11.0", a bar, a percentage; no welcome page, no Claude Code check page, no Report issue;
  - installs into the **same folder** (found the way Setup already finds it, through the Settings > Apps entry), keeping the shortcuts exactly as they are: pass `--no-desktop-shortcut` / `--no-start-menu-shortcut` only when that shortcut does not exist now, and make sure the NSIS engine does not delete or add shortcuts the user has;
  - starts afterterm again and closes.
- afterterm side: on Restart now, write `pendingUpdate` and the wake list (below), then start the verified installer detached with those arguments, then quit through the existing `before-quit` path (ConPTY teardown). If Setup cannot start, stay open and say so in the notice.
- Downloads live in the app's data folder under `updates\` (for the sandbox, its own data folder). Download to `<name>.partial`, hash it, rename only when the hash matches. Delete old installers on the next launch after a successful update.

### After the restart (mockup question 6, "Where I was, with a short note")

- **Waking what was awake happens only after an update** (Aryan, 2026-10-30). A normal quit and relaunch keeps the 0.9.0 rule: every thread starts asleep.
- Before quitting for the update, save the ids of the awake threads (a new persisted field through `sessionMigration.ts`, for example `wakeAfterUpdate: string[]`) and, in `pendingUpdate`, the thread and screen that were open.
- On the next launch, when `pendingUpdate.to` equals the running version: open that screen and thread instead of Home, wake each listed thread through the existing wake path (`wakePlan`, a chat through `claude --resume <id>`, a server re-running its last command, a shell fresh in its folder), then clear both fields. If the versions differ (the install failed), clear them and start as usual.
- Show a pill at the bottom centre (the in-app Toast look): "Updated to 0.11.0" and a What's new button (opens the notes in a window over the app). A small round × sits on the pill's top-right corner, outside the pill, not inside it; the pill keeps its usual size. It goes by itself after a few seconds.
- This replaces `scripts/update-build.mjs`'s wake over CDP for installed copies; that script stays for Aryan's dev builds.

### The About window (mockup question 7)

- Opened by clicking the version badge (a button, `no-drag`, hover state). A modal in the existing modal look: logo, "afterterm", "Version 0.10.0".
- **One update row that keeps one height in every state** (one line, text left, buttons right; the window must not change size when an update is found):
  - nothing found yet: "Last checked today at 09:12." + Check for updates; after a check with nothing new: "You have the newest version.";
  - checking: spinner + "Checking..." + the button disabled;
  - found: "afterterm 0.11.0 is available" + What's new + Update;
  - downloading: an inline bar + percentage + What's new + Cancel;
  - ready: "afterterm 0.11.0 is ready" + What's new + Restart to update (opens the restart window).
- What's new slides a notes panel open under the row; the window grows smoothly with it, and it slides shut the same way (grid-template-rows 0fr to 1fr, about 340ms on `--ease`); the chevron turns. The row's text fades in when its state changes. Close fades and sinks the window out (about 170ms). All motion off under `prefers-reduced-motion` (theme.css's global rule).
- A switch row: "Check for updates automatically". One link: "afterterm on GitHub".

### Where the code goes

- `src/update-check.ts` (pure, unit-tested in `src/update-check.test.ts`): version compare, release parsing and asset choice, digest parsing, whether to show (skipped, later-until, setting), the restart window's rows from thread records, the release-notes subset parser if it lives in main. Add the test file to `package.json`'s `test` script.
- `src/updater.ts` (main): the timer, the fetch, the download with progress and the hash, the registry check, starting Setup, IPC (`update:state` pushed to the renderer; `update:check`, `update:download`, `update:cancel`, `update:later`, `update:skip`, `update:restart`, `update:set-auto`), exposed through `preload.ts` and typed in `afterterm.d.ts`.
- Renderer: `TitleBar` (button and notice), a `components/AboutWindow`, a `components/RestartToUpdate` window, the updated pill in `app.tsx`, wake-after-update in `useTabState.ts` / `app.tsx`.
- Docs: a `docs/features-updates.md` record; CLAUDE.md (file structure, a "How the app works today" paragraph, the env vars); CHANGELOG.md Unreleased; `docs/to-verify.md`.

### Not in this round

- Code signing. SmartScreen may still warn on the first manual install; the in-app update runs Setup directly.
- Keeping a process alive across the swap (`docs/design-01-persistent-pty-host.md`).
- The local-folder source for Aryan's dev builds from `docs/ideas.md` ("In-app update"); `scripts/update-build.mjs` keeps doing that.

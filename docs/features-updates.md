# Automatic updates

The record of the automatic-updates feature: what it does, how it is built, and how it was tested. The agreed design is [`design-05-automatic-updates.md`](design-05-automatic-updates.md) (Aryan's answers to the mockup, 2026-10-30); the phases and their status are in [`PHASES.md`](../PHASES.md), "Automatic updates". Read this before changing the area.

## What the user gets

An installed afterterm checks GitHub for a newer release and says so with an "Update available" button beside the version in the title bar. Nothing opens by itself and nothing is forced. Update downloads the installer in the background with progress, checks it against the sha256 GitHub publishes, and the button becomes "Restart to update". That opens a window listing every awake thread and what happens to it; Restart now closes afterterm, a small Setup window shows the install's progress, afterterm opens again on the screen and thread that were open, the threads that were awake wake, and an "Updated to 0.11.0" pill appears. The About window (click the version) checks by hand and turns automatic checks off.

## Where the code is

| File | What it holds |
|---|---|
| `src/update-check.ts` | Pure, unit-tested (`src/update-check.test.ts`, in `npm test`): versions (`parseVersion`, `compareVersions`, `isNewer`), the release and its asset (`parseRelease`, `assetNameFor`, `parseDigest`, `downloadSource`), Later and Skip (`isSuppressed`, `LATER_MS`), the state shape (`UpdateState`, `titleBarButtonShows`), texts (`megabytes`, `percent`, `lastCheckedText`, `errorText`), the restart window's rows (`restartRows`, `restartStatus`), the record of an update restart (`asPendingUpdate`, `updateLanded`), old downloads (`installerVersion`, `staleDownloads`), the release-notes parser (`parseNotes`, `parseInline`) and `samePath`. |
| `src/updater.ts` | Main process: `initUpdater` (called from `main.ts`'s `whenReady`). Reads which copy this is, runs the timer, fetches the release, downloads with progress and the hash, starts Setup, and the IPC. |
| `src/prefs.ts` | The prefs.json keys: `updateChecks`, `updateSkippedVersion`, `updateLaterUntil`, `updateLastChecked`, `pendingUpdate`. |
| `src/renderer/sessionMigration.ts` | `wakeAfterUpdate` in session.json. |
| `src/renderer/components/TitleBar` | The version button (opens About), the update button and the notice under it. |
| `src/renderer/components/RestartToUpdate` | "Restart afterterm to update?" |
| `src/renderer/components/AboutWindow` | The About window. |
| `src/renderer/components/UpdatedPill` | "Updated to 0.11.0" after an update restart. |
| `src/renderer/components/UpdateDialog` | The frame the three windows share (scrim, card, the 170ms fade-and-sink close) and `WhatsNewDialog`. |
| `src/renderer/components/UpdateNotes` | Release notes rendered from `parseNotes`; links go through `shell.openExternal`'s safelist. Also the shared progress bar styles. |
| `src/renderer/app.tsx` | The update state, the windows, `restartNow`, the quit flush's `wakeAfterUpdate`, and reopening after an update. |
| `installer/setup/Setup.cs`, `Setup.xaml` | Setup's update mode (`PageUpdate`). |
| `scripts/agent-harness/update-feed.mjs` | Writes a test feed for `AFTERTERM_UPDATE_FEED`. |

Every update class name starts with `up-`: the mockup's short names (`.nt`, `.sw`, `.pop`) are already used elsewhere in the app.

## Who checks

`updater.ts` decides once per launch, asynchronously, so nothing waits on it:

- **Installed** means `app.isPackaged`, `AFTERTERM_USER_DATA_DIR` not set (a harness run), and the exe's folder is the `InstallLocation` of the uninstall entry whose `DisplayName` is this product's name (`afterterm`, or `afterterm (test)` for the sandbox build): the same entry Setup reads. The registry is read through PowerShell, not `reg.exe`, because `reg.exe` prints in the console code page and would garble an install path under an accented user name.
- A dev build, a build run from `out\` and a harness run never check. The About window says "Updates install only into an installed copy." and its Check for updates is off.
- `AFTERTERM_UPDATE_FEED=<json file>` makes checks run in any build (see Testing). Even then, only an installed copy ever runs Setup.

Checks: the first about 10 seconds after launch (`AFTERTERM_UPDATE_CHECK_DELAY_MS` shortens it), then every 6 hours, only while `updateChecks` is not `disabled`, never while a download runs. A check by hand from the About window works with the switch off. A timed check stays out of sight (no "Checking..."), so the title bar button never blinks; a check by hand that cannot reach GitHub says "Couldn't check for updates."; a timed one says nothing.

## The release

`GET https://api.github.com/repos/afteraryan/afterterm/releases/latest` with a `User-Agent` and `Accept: application/vnd.github+json`, no token, through Electron's `net.fetch` (Chromium's network stack, so the system proxy applies). A 403 or 429 (the rate limit) or a network error is "no update this time".

`parseRelease` offers a release only when its `tag_name` is a plain `MAJOR.MINOR.PATCH` newer than the running version, it is not a draft or prerelease, it carries the asset named exactly `afterterm-<version>-setup.exe` (`afterterm-test-<version>-setup.exe` for the sandbox build, so a sandbox copy can never pick up and run the real installer), and that asset's `digest` is `sha256:<64 hex>`. No digest, or another algorithm, and the update is not offered: the installer is not code-signed, so the hash is the only check there is.

## The download

To `<userData>\updates\<asset>.partial`, hashed while it streams, renamed to `<asset>` only when the sha256 matches. A mismatch deletes the file and the notice says "The download didn't match the release, so it was deleted." with Try again; a network failure says "The download stopped." Cancel aborts and deletes the partial file. An installer already on disk for the same release is hashed again at the next check and reused (straight to "Restart to update"). Restart to update hashes it once more right before running it. Old installers and unfinished downloads are deleted at the first check after launch (`staleDownloads`: anything not newer than the running version).

Progress reaches the renderer at most every 100ms through `update:state`.

## Later and Skip

- **Later** writes `updateLaterUntil` = now + 24 hours and hides the title bar button; a timer brings it back when the day is up, even if afterterm stays open.
- **Skip this version** writes `updateSkippedVersion`; that version never shows in the title bar again, a newer one does.
- The About window shows a found version either way. Pressing Update there (or anywhere) shows the button again for the download: Later and Skip only hold back a version nobody has asked for.

## The restart window

Opened by the white "Restart to update" button, or by the About window's own. Shown every time, busy or not. One row per awake thread (asleep threads are not listed), from `restartRows`:

| Thread | Row |
|---|---|
| A chat whose session can be resumed (`wakePlan` gives a `resumeSessionId`) | "Resumes" |
| The same chat while its spinner is on (notification `working` or `compacting`) or while it waits on a permission prompt (`attention`, the bell); `isMidTurn` | "Stops mid-turn", in `--need` yellow |
| A server whose last command runs again on wake (`wakePlan` gives a `runCommand`) | "Runs again on :5173" |
| Anything else | "Opens in its folder" |

The status line: "Safe to restart" (soft green, a check) or "1 chat stops mid-turn" / "2 chats stop mid-turn" (yellow, a bell). The rows follow the threads live while the window is open.

**What "Stops mid-turn" means** (for docs, not the screen): afterterm resumes that chat itself with `claude --resume`, but Claude does not finish the reply it was in the middle of, and a permission prompt it was waiting on is gone; the user sends that message again.

A chat waiting on a permission prompt counts as mid-turn too (Aryan, 2026-10-30, after the Phase 2 review): its pending tool call is lost the same way.

## Restart now

1. The renderer records the awake thread ids (`wakeAfterUpdateRef`) and calls `update:restart` with the open thread, the screen and the project page's project.
2. Main refuses when this copy is not installed (the notice says "Updates install only into an installed copy.") or the installer's hash no longer matches.
3. Main writes `pendingUpdate` = `{ from, to, notes, activeThreadId, screen, projectId }` to prefs.json, then starts `<installer> --update --wait-pid <afterterm's pid>`, detached, **with the updates folder as its current folder**: a process whose current folder is the install folder stops the engine from replacing it (see CLAUDE.md, "Close afterterm before building"). If it does not start, the record is removed and the notice says "The installer didn't start."
4. Main quits through `app.quit()`, the usual path: `before-quit` drains the PTYs, and the renderer's `beforeunload` flush writes session.json with every thread asleep (`sleepAllForShutdown`) plus `wakeAfterUpdate`. No other quit writes that key.

## Setup's update mode

`afterterm-<version>-setup.exe --update --wait-pid <pid>` shows only `PageUpdate` in a 470px window: the logo, "Updating afterterm to 0.11.0", a bar, a percentage. Then:

1. The install folder is the existing install's (`ExistingInstallFolder`, the Settings > Apps entry). No entry: "afterterm is not installed on this PC."
2. Waits up to 60 seconds for that pid to exit, then up to 30 more for no afterterm to run from the folder. Otherwise: "afterterm is still open. Close it and run the update again."
3. Runs the engine silently into that folder with the same progress bar as a normal install (`RunInstall`).
4. **Shortcuts stay exactly as they are.** electron-builder's engine already keeps them on a reinstall: every install writes `KeepShortcuts=true` to the uninstall entry, and when that is set and the old exe exists, the old uninstaller runs with `--keep-shortcuts` and the new install neither recreates nor removes the desktop and Start menu shortcuts (`installSection.nsh`, `addDesktopLink` and `addStartMenuLink`). Setup also passes `--no-desktop-shortcut` / `--no-start-menu-shortcut` for a shortcut that does not exist now, so a missing one is never added even if that registry value were gone.
5. Starts afterterm (current folder: the install folder, as a shortcut would) and closes.
6. A failure shows the title "afterterm could not be updated", the reason, and Close plus "Open afterterm" when the exe is still there.

No welcome page, no Claude Code check, no Report issue. The normal installer is unchanged apart from sharing `RunInstall` and `OpenApp`.

## After the restart

`initUpdater` reads `pendingUpdate` at launch and removes it from prefs.json at once, so only the next launch sees it. When `to` equals the running version (`updateLanded`), the renderer gets it once through `update:take-launch` (a reload does not repeat it). Then `app.tsx`:

- opens that screen (and project page) instead of Home, and makes that thread active;
- wakes every id in session.json's `wakeAfterUpdate` that still exists and is asleep, 250ms apart, through the same `wakeThread` every Wake button uses (a chat resumes through `claude --resume`, a server re-runs its last command, a shell opens in its folder);
- shows the "Updated to 0.11.0" pill: the in-app toast's look, What's new (opens `WhatsNewDialog`), a small round x on the pill's top-right corner outside it; it goes by itself after 6 seconds, held while the pointer is on it.

`wakeAfterUpdate` is never written again by a normal save, so the next launch is an ordinary one. When the versions differ (the install failed and the old version came back), the record is dropped and the launch is ordinary: every thread asleep, the 0.9.0 rule (Aryan, 2026-10-30: waking what was awake happens only after an update).

This replaces `scripts/update-build.mjs`'s wake over CDP for installed copies; that script stays for Aryan's dev builds.

## The About window

Opened by the version badge (a `no-drag` button with a hover state). Logo, "afterterm", "Version 0.10.0", then one update row that keeps one height (`min-height: 52px`, one line, no wrapping) in every state, so the window never changes size when an update is found:

| State | Row |
|---|---|
| Not an installed copy | "Updates install only into an installed copy." + Check for updates (off) |
| Nothing found yet | "Last checked today at 09:12." + Check for updates |
| A check by hand found nothing | "You have the newest version." |
| Checking | spinner, "Checking...", the button off |
| Found | "afterterm 0.11.0 is available" + What's new + Update (Try again after a failed download) |
| Downloading | a bar and the percentage + What's new + Cancel |
| Ready | "afterterm 0.11.0 is ready" + What's new + Restart to update |

What's new slides a notes panel open under the row (`grid-template-rows` 0fr to 1fr, 340ms on `--ease`) and the window grows with it; the chevron turns. The row's text fades in when its state changes (keyed by state). The switch "Check for updates automatically" writes `updateChecks`. One link, "afterterm on GitHub". Close (and Escape, and a click beside the window) fades and sinks it out over 170ms. All motion is off under `prefers-reduced-motion` (theme.css's global rule; the frame also skips the close delay).

## IPC

`update:state` (main to renderer, every change), `update:get`, `update:take-launch`, `update:check`, `update:download`, `update:cancel`, `update:later`, `update:skip`, `update:restart`, `update:set-auto`. Exposed as `window.afterterm.update` in `preload.ts`, typed in `afterterm.d.ts`.

## Environment variables

| Variable | Effect |
|---|---|
| `AFTERTERM_UPDATE_FEED=<path>` | A JSON file in GitHub's response shape replaces the GitHub URL; `browser_download_url` may be a `file:///` URL or a plain local path. Checks run in any build. |
| `AFTERTERM_UPDATE_CHECK_DELAY_MS=<ms>` | The first check's delay (default 10000). |
| `AFTERTERM_UPDATE_SLOW_MS=<ms>` | Spreads a local installer's copy over that long, so a test can watch the progress. Has no effect on an https download. |

## Testing

Unit tests: `node src/update-check.test.ts` (part of `npm test`) and the `wakeAfterUpdate` section of `src/renderer/sessionMigration.test.ts`.

Harness (Phase 2 self-test, 2026-10-30, captures in `docs/screenshots/auto-update-phase-2/`):

1. `node scripts/agent-harness/update-feed.mjs --out <dir>` writes `feed.json` and a stand-in installer (`--bad-digest` writes `feed-bad.json`).
2. `npm run harness -- --data-dir <dir> --port <n> --env AFTERTERM_UPDATE_FEED=<dir>\feed.json --env AFTERTERM_UPDATE_CHECK_DELAY_MS=3000 --env AFTERTERM_UPDATE_SLOW_MS=15000 --env CLAUDE_CONFIG_DIR=<scratch>`.
3. Selectors: `[data-update-button]` (with the phase as its value), `[data-update-notice]`, `[data-whats-new]`, `[data-version-button]`, `[data-about-row]` (the row's state), `[data-about-notes]`, `[data-auto-switch]`, `[data-restart-rows]` (rows carry `data-outcome`), `[data-restart-now]`, `[data-updated-pill]`.
4. Hooks on `window.__afterterm`: `update()` (the state), `wake(id)`, and `setNotification(id, 'working')` to put a chat mid-turn (the spinner logic clears it after 2.5 seconds of silence, so hold it with an interval while capturing).
5. To make a shell a chat without a real Claude Code session, write `<data-dir>\claude-sessions\<tab>.json` with a made-up UUID, as the hook would.
6. The launch after an update: seed `--session` with `wakeAfterUpdate` and `--prefs` with a `pendingUpdate` whose `to` is the dev build's version.

What was checked: the button and the notice, What's new folding open, the download with progress in the button and the notice, the ready state, the restart window with a chat mid-turn and with nothing busy (the rows update live), Restart now refused in a dev build without writing anything, the About window at 375px in every state (ready, What's new open 583px and shut again, found, downloading, newest version), the checksum refusal deleting the file, Later (24 hours in prefs), Skip (still hidden after a new check, shown in About), the switch writing prefs, the GitHub link, the after-update launch (workspace, the server thread active, exactly the listed threads awake, a server running its command again, the pill, What's new), and a normal launch with a leftover `wakeAfterUpdate` (everything asleep, Home, no pill). The sandbox installer was built once to prove Setup compiles; it was not installed or run. The end-to-end run with an installed copy is Phase 3.

## Not in this round

Code signing; keeping processes alive across the swap (`design-01-persistent-pty-host.md`); the local-folder source for Aryan's dev builds (`scripts/update-build.mjs` keeps doing that).

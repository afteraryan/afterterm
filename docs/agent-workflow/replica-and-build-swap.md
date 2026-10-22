# Leaving Aryan a replica dev build, and replacing his production build without a release

Two procedures an agent needs at the end of a phase, both learned on 2026-09-19 while handing Phase 9 over.

## A replica dev build for Aryan

After a phase's self-test, a dev build seeded with a full copy of Aryan's real data is left running on the secondary display so he can use the phase before it is merged (see "Agent test harness" in `CLAUDE.md` and `scripts/agent-harness/README.md`). The data dir is throwaway; his real `%APPDATA%\afterterm` is never pointed at.

1. Stop whatever harness run is up: `npm run harness:stop` (check every thread in it is asleep first, so nothing running is killed mid-turn).
2. Copy his data into a fresh data dir: `session.json` and `prefs.json` to files the launcher reads, and the tail files into `<data-dir>\threads\` yourself, since `launch.mjs` copies only `session.json` and writes `prefs.json`:

   ```powershell
   $base = "$env:TEMP\afterterm-agent-harness"; $rep = "$base\aryan-<phase>-replica"
   New-Item -ItemType Directory -Force "$rep\threads" | Out-Null
   Copy-Item "$env:APPDATA\afterterm\threads\*.txt" "$rep\threads\" -Force
   Copy-Item "$env:APPDATA\afterterm\session.json" "$base\aryan-<phase>-session.json" -Force
   Copy-Item "$env:APPDATA\afterterm\prefs.json" "$base\aryan-<phase>-prefs.json" -Force
   ```

3. Launch with the session ids kept and real launches allowed:

   ```powershell
   node scripts/agent-harness/launch.mjs --session "$base\aryan-<phase>-session.json" --prefs "$base\aryan-<phase>-prefs.json" --data-dir $rep --display secondary --claude-resume all --open-external
   ```

   `--open-external` matters. Under the harness (`AFTERTERM_HARNESS=1`) main logs `shell:openExternal` and `projects:openInExplorer` instead of launching, so nothing can pop a window onto the display an automated test is using. In Aryan's first Phase 9 replica that guard made "Open in File Explorer" and "Open localhost" silently do nothing, and they looked broken. `--open-external` sets `AFTERTERM_OPEN_EXTERNAL=1`, which `harnessOnlyLogsExternal()` in `src/main.ts` honours. Use it only for a replica left for him, never for an automated self-test.

4. Tell him the data dir. Confirm the window is on the secondary display with `drive bounds` (`onDisplay.primary: false`).

## Replacing his production build without a release

Aryan runs `D:\Pitara\Work\Tinkering\afterterm\out\afterterm-win32-x64\afterterm.exe` from a taskbar shortcut, and a Claude session often lives inside it. `npm run build` in the main checkout renames that folder first and fails while the app runs from it (see "Portable Build" in `CLAUDE.md`), so the build is done elsewhere and swapped in afterwards, when he has closed the app. No version bump and no tag: he uses the build for a few days first, and `npm run release` (see `docs/guide-02-releases.md`) comes later. The version badge keeps the old number until then.

1. Merge the branch to `main` through a PR (direct pushes to `main` are blocked), then build in a worktree, whose `out\` is its own path: `npm run build` there. Stop any harness run first: the package step writes `.vite/build`, which the dev server also uses. The worktree can be a throwaway one at `main` (`git worktree add .claude/worktrees/build-<version> origin/main --detach`, copy `node_modules` in with robocopy, build).
2. Tell Aryan the build is ready and give him the one command. **The switch is his to run, from a PowerShell window outside afterterm** (Windows Terminal, or Win+R then `powershell`), never from a Claude session inside the app, which the close would kill (that is what happened on 2026-10-22 the first time, and the swap never ran):

   ```powershell
   node D:\Pitara\Work\Tinkering\afterterm\scripts\update-build.mjs
   ```

   `scripts/update-build.mjs` is the whole procedure, decided with Aryan on 2026-10-22 after its first run ("This should be the practice from now on whenever I have to switch a build"): it reads which threads are awake from `session.json`, closes afterterm cleanly (the renderer's quit flush saves every tail and the session), moves the current build aside as `out\afterterm-old-<timestamp>`, moves the newest worktree build into `out\afterterm-win32-x64` (the taskbar shortcut keeps working; the next `npm run build` cleans the old folders up), starts the new build through WMI so it is not a child of the window the script ran in, and wakes every thread that was awake, through the notifier's tab-click channel and the asleep pane's Wake button over the remote debugging port. A chat comes back through `claude --resume`, a server through its last command. Flags: `--new <folder>` to name the build instead of taking the newest, `--no-wake` to leave every thread asleep, `--dry-run` to see the build and the threads without touching anything. It refuses to run when its own shell is inside afterterm.

   What it cannot do: keep a process alive across the swap. A Claude turn that was mid-run is interrupted and has to be sent again; a chat that never had a turn (no session id captured yet) wakes as a plain shell. The fix for that is `docs/design-01-persistent-pty-host.md`, not built.
3. The old hand procedure, for reference: close afterterm, `Move-Item` the current build to `out\afterterm-old-<timestamp>`, `Move-Item` the worktree build to `out\afterterm-win32-x64`, start from the taskbar, every thread asleep.

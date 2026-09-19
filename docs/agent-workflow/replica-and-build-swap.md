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

1. Merge the branch to `main` through a PR (direct pushes to `main` are blocked), then build in the phase worktree, whose `out\` is its own path: `npm run build` there. Stop any harness run first: the package step writes `.vite/build`, which the dev server also uses.
2. Once Aryan has closed afterterm, swap the folders. A script for this was left at `%TEMP%\afterterm-agent-harness\swap-build.ps1`; its whole content is:

   ```powershell
   $cur = 'D:\Pitara\Work\Tinkering\afterterm\out\afterterm-win32-x64'
   $new = 'D:\Pitara\Work\Tinkering\afterterm\.claude\worktrees\<worktree>\out\afterterm-win32-x64'
   if (Get-Process afterterm -ErrorAction SilentlyContinue) { Write-Host 'afterterm is still running. Close it, then run this again.'; exit 1 }
   if (-not (Test-Path "$new\afterterm.exe")) { Write-Host "new build not found at $new"; exit 1 }
   $old = "D:\Pitara\Work\Tinkering\afterterm\out\afterterm-old-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
   Move-Item $cur $old
   Move-Item $new $cur
   Write-Host "done. old build kept at $old"
   ```

   The standard path is kept, so the taskbar shortcut keeps working; the old build stays beside it as `afterterm-old-<timestamp>` and the next `npm run build` cleans those up. If the agent's own session runs inside afterterm, the swap is his to run after closing it; if he has already closed it, the agent runs the swap.
3. He starts afterterm from the taskbar. Session data is shared (`%APPDATA%\afterterm`), so nothing is lost; every thread starts asleep as after any relaunch.

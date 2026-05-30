# Handoff: Guarantee child-shell cleanup on force-kill (Windows Job Object)

**For:** a fresh agent picking up this task. **Written:** 2026-05-30.
**Status:** not started. Design/research done; implementation is yours.

---

## 0. First steps (do these before anything else)

1. **Read `D:\Tinkering\afterterm\CLAUDE.md` in full** — project overview, architecture (node-pty in main, xterm in renderer), the **Windows-Specific Gotchas** section, and the **Packaging Notes** (ASAR/native-module handling). This task adds a native capability, so packaging matters.
2. **Create and enter an isolated git worktree** using your worktree tool (e.g. `EnterWorktree`) — do **not** work in the main checkout. Branch name suggestion: `job-object-child-cleanup`. Base it on `main` (currently at commit `48bdf6d`, which already contains the graceful-close fix described below). Do all work inside that worktree; exit it when done.
3. Skim the **Related docs** in §6 below.

> The user (Aryan) is a tinkerer, not a developer — explain the *why*, discuss UX/risk before big moves, and **test things yourself before telling him they work** (this has been a repeated ask). He runs the dev server himself (`npm start`); you generally cannot run the GUI, so verify via headless tests + process inspection (see §5).

---

## 1. The problem

afterterm spawns a shell (cmd.exe / pwsh) per tab via **node-pty (ConPTY)**. On Windows there is **no automatic child cleanup**: when the afterterm process dies, its shells are *not* killed — they're reparented and linger as orphans. Over a day of normal use this accumulated to **79 stray `cmd.exe`** across multiple dead/zombie app instances.

Two distinct death modes:
- **Graceful quit** (window close, app.quit): app code runs → we can `taskkill`. **This is already handled** (see §2).
- **Abnormal death** — `TerminateProcess` / `taskkill /F` / Task Manager "End process tree" / a crash / **Ctrl+C on the `npm start` dev server**: **no app code runs at all**, so any JS-based cleanup is bypassed. **This is the unsolved case and the whole point of this task.** It bites the dev loop especially, since Ctrl+C-ing the dev server is a force-kill that orphans every shell on each restart.

---

## 2. What is ALREADY done (committed on `main`, base `48bdf6d`)

A graceful-close fix landed (commit `98330b3`, rebased as part of `48bdf6d`), in `src/main.ts`:
- Closing the main window now calls **`app.quit()`** (not just `mainWindow.close()`). Previously the always-on-top **notifier overlay window** kept the process alive (`window-all-closed` never fired), leaving a headless **zombie holding every shell** — that was the real cause of the pileup.
- Split the quit guard into two flags: `isQuitting` (suppress the "N terminals still running" close dialog) and **`ptysDrained`** (ensures the PTY `taskkill /T /F` drain in `destroyAllPtys()` runs exactly once on quit). Previously one overloaded flag meant a confirmed-close could skip the drain.
- `mainWindow.on('closed')` also calls `app.quit()` so a zero-terminal close doesn't leave the notifier keeping the process alive.

> ⚠️ These graceful-close changes were **verified by code-trace only, not in a running GUI build.** The user has not yet confirmed them live. Don't assume they're proven. Your Job Object work is *complementary* — it covers the force-kill case the graceful fix cannot.

The existing graceful drain lives in `destroyAllPtys()` + the `before-quit` handler in `src/main.ts` (search for `destroyAllPtys`, `before-quit`, `taskkill`). Keep it — Job Object is an *additional* OS-enforced safety net, not a replacement.

---

## 3. The chosen approach: Windows Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`

This is the **only** mechanism that survives a force-kill, because it does not rely on your code running. Verified across three Microsoft-authored sources (Job Objects doc; "Terminating a Process" doc; Richter's handle-table writeup):

- Create a Job Object, set extended limit `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, and `AssignProcessToJobObject` each spawned shell PID into it.
- When the afterterm process dies **by any means** (including `TerminateProcess`), the kernel scans its handle table and closes all handles. If the job handle was the **last** open handle to the job, the kill-on-close limit fires and the OS terminates every process in the job — no app code needed.

**This was the research conclusion: there is no simpler alternative that covers force-kill.** Everything else (`taskkill /T`, `tree-kill`, ConPTY's `ClosePseudoConsole`, a polling watchdog) either needs your code to run or has a race window. A watchdog that merely *holds the job handle* is just this same job object relocated into a helper process.

### Critical gotchas (get these wrong and it silently does nothing)

1. **Handle hygiene.** The job handle must be held **only by the main process** and be **non-inheritable**. If any child inherits/duplicates the handle, that child keeps the job alive after the parent dies and the auto-kill never fires. (Raymond Chen / "The Old New Thing" stresses exactly this.)
2. **libuv breaks your children out of jobs.** Node's process layer (libuv) spawns children with `JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK`, so processes you spawn — and especially their grandchildren — **escape** any ambient job (including Electron/Chromium's own job). You therefore must create your **own** job and explicitly assign into it; you cannot piggyback on Electron's. (libuv issue #3179; MS Job Objects doc.) Nested jobs (Win8+) make coexistence fine on Windows 11.
3. **ConPTY arrangement.** The shell may run under a `conhost.exe`/`OpenConsole.exe` host. **Verify the actual process tree**: in our earlier inspection, `cmd.exe` was parented directly to the afterterm main process, so node-pty's `pty.pid` *appears* to be the cmd.exe — but confirm this on the current Windows 11 build, and make sure both the host *and* the shell end up in the job (assign on each spawn). ConPTY host arrangement has changed across Windows releases.
4. **node-pty gives you a PID, not a HANDLE.** You'll need `OpenProcess(pid)` → `AssignProcessToJobObject(job, hProcess)`. node-pty has **no** built-in job/tree cleanup (maintainer says "walk and kill by hand"); `pty.kill()` is unreliable on Windows and doesn't reap the tree.

### Where to hook it in code

`src/main.ts`, the **`pty:create` IPC handler** (search `ipcMain.handle('pty:create'`). After `pty.spawn(...)` returns, you have `p.pid`. That's where to assign the new shell into the job. Create the job once at startup, hold its handle in a module-level variable in main.

---

## 4. Implementation options (pick one; ranked)

There is **no turnkey npm package** for "assign to kill-on-close job" — don't adopt an obscure single-author dependency for something this load-bearing.

1. **Tiny N-API native addon (recommended best-fit).** ~100 lines of C++: `CreateJobObjectW` + `SetInformationJobObject(JobObjectExtendedLimitInformation, KILL_ON_JOB_CLOSE)` + an exported `assign(pid)` that does `OpenProcess` + `AssignProcessToJobObject`. You already ship native addons (`conpty.node` via node-pty), so the toolchain exists — **but** mind the project's packaging dance: ASAR unpack for `*.node`, the `packageAfterCopy` hook, and the N-API/electron-rebuild notes in CLAUDE.md. New addon must be built for Electron's ABI and unpacked from ASAR.
2. **FFI via `koffi` (no compile step).** `koffi` is the actively-maintained FFI for Node (the successor to the effectively-unmaintained `ffi-napi`). Call `kernel32` `CreateJobObjectW`/`SetInformationJobObject`/`OpenProcess`/`AssignProcessToJobObject` from JS. Avoids native rebuilds (a real win given the project's electron-rebuild pain), but marshalling the `JOBOBJECT_EXTENDED_LIMIT_INFORMATION` struct is fiddly and bugs are runtime, not compile-time. **Verify koffi packages correctly into the Electron Forge build** (it has its own native binary).

**Discuss the choice with Aryan before committing to one** — it's a real tradeoff (compile/ABI pain vs. FFI fiddliness) and affects packaging. Lead with a recommendation.

---

## 5. How to verify (you must test this yourself — do not hand Aryan an unverified fix)

You can't run the GUI, but you can prove the mechanism headlessly. node-pty loads under plain `node` **when run from the project root** (`node_modules` resolution):

1. **Process inspection** (PowerShell) — count and attribute shells:
   ```powershell
   Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" | Group-Object ParentProcessId | ForEach-Object {
     $p = Get-Process -Id $_.Name -EA SilentlyContinue
     "$($_.Name) [$(if($p){$p.ProcessName}else{'DEAD'})]: $($_.Count)"
   }
   ```
2. **The real test:** write a throwaway node script in the project root that (a) creates the job + assigns a spawned node-pty cmd.exe, (b) prints the cmd.exe PID, then (c) **`process.exit()` without cleanup** (simulating a crash/force-kill). From a *separate* shell, confirm the cmd.exe PID is **gone** after the parent exits. If it survives, the job/handle hygiene is wrong. Delete the script after. (A similar throwaway test confirmed the OSC-9;9 cwd capture earlier; node-pty loaded fine under node v24 from the project dir.)
3. Also test the **graceful** path still works (close → drain) and that you didn't regress it.

**Deny-rule caution:** there is a settings.json deny rule blocking you from killing `afterterm.exe` (the user's prod app). Dev `electron.exe` is safe to kill. When testing, don't taskkill prod afterterm; use your own throwaway processes.

---

## 6. Related docs to read

- `D:\Tinkering\afterterm\CLAUDE.md` — **required**; architecture, Windows gotchas, packaging.
- `docs/design-01-persistent-pty-host.md` — a *future* design to make shells survive an app restart via a detached PTY-host daemon. Relevant because: (a) it's the same subsystem, (b) if that daemon is ever built, the job object would live in the daemon. Don't implement it now, but your job-object code should be written so it isn't painful to relocate later.
- `docs/bugs.md` — open bugs (e.g. the working-spinner Stop-hook timing case). Not directly related but good situational awareness.
- `docs/research-01-claude-code-hooks.md` — unrelated to this task; ignore unless curious.

---

## 7. Things I'm unsure about (flagging honestly — verify, don't trust)

- **What `pty.pid` actually points to under current ConPTY** (the cmd.exe directly, or a conhost host that owns the cmd.exe). Earlier process data suggested cmd.exe is a direct child of afterterm's main process, implying `pty.pid` is the cmd.exe — but confirm on this machine/build, and ensure the conhost is also captured (assign-on-spawn; consider whether you must also catch grandchildren the shell spawns, e.g. a `claude`/node process — kill-on-job-close should get all job members, but only if they didn't break away).
- **Whether grandchildren stay in the job.** Job membership is normally inherited by children of a job member — but if the shell or a tool re-spawns with `SILENT_BREAKAWAY_OK`, they'd escape. Test with a nested process (e.g. start `claude` or a long `ping -t` inside the shell, force-kill the parent, confirm the grandchild dies too).
- **koffi vs native-addon packaging** in this specific Electron Forge + Vite + no-ASAR setup. The project already fights native-module packaging (see CLAUDE.md). Whichever you pick, **build the portable app (`npm run build`) and confirm the capability survives packaging**, not just `npm start`.
- **Windows Terminal reportedly fixed orphan-on-force-close in v1.20**, strongly implying a job object, but I could not pin the exact source file. Treat as corroboration, not a copyable reference.
- The **graceful-close fix in §2 is itself unverified in a live GUI.** If during your work you can get Aryan to confirm it (close app → shells disappear), great; otherwise note it stays unverified.

---

## 8. Definition of done

- A Job Object is created in main at startup (non-inheritable handle, held only by main, `KILL_ON_JOB_CLOSE` set).
- Every spawned PTY (and its ConPTY host) is assigned to it on creation.
- Headless test proves: parent dies *without* running cleanup → all its cmd.exe (and a nested grandchild) are terminated by the OS.
- Graceful close still works and isn't regressed.
- Survives `npm run build` (packaged app), not just dev.
- `CLAUDE.md` updated: note the job-object cleanup under Windows Gotchas / Architecture, and update the "Closing a PTY does NOT kill child processes" note to reflect the new safety net.
- Branch pushed; summarize for Aryan what was verified vs. what still needs his GUI confirmation.

# Servers: port detection, running state, open localhost, last command

A tab running a dev server (`npm start`, `vite`, `next dev`) looks like every other terminal until Phase 5: the port is somewhere up in the scrollback and the row gives no sign of it. afterterm now finds the port, names and labels the thread as a running server, offers to open it in a browser, and re-runs the same command when the thread wakes back up.

## What the user sees

A tab whose process tree opens a listening TCP port turns green within about a second of the server printing its ready line:

- The sidebar row is named by the command that started it ("npm start"), not by the shell's own live title, and shows `:5173` next to that name, with the play state icon.
- The header chip reads "Running on :5173".
- The project row's play pill, which already counted working chats, now counts a running server too: a project's totals on Home and in the sidebar reflect it with no separate counter needed.
- The hover card's Type row reads "Server · Running on :5173", with a Last ran row showing the command that was typed. The project page's thread line appends `:5173` after branch and worktree.
- Right-click the row, or the header's dots menu, for "Open localhost:5173", which opens the default browser.
- Sleep a server thread and its port is kept (nothing else marks it a server), so the asleep pane reads "Server asleep since 2d ago · runs npm start". Sleeping asks first, the same as closing: "Sleep the server on :5173?" "This thread is listening on :5173. Sleeping it stops the server; Wake runs npm start again." Cancel keeps it running. Wake, and afterterm re-types that command once the fresh shell has its prompt.
- Close a thread that is still listening and afterterm asks first: "Close the server on :5173?" Cancel keeps it running.
- A tree listening on more than one port is named and shown by the one that started listening latest, ties falling back to the lowest port.

## Detection joins netstat with a process list

Finding the port means joining two lists Windows will give up, in `src/server-detect.ts` (pure, no Electron, unit-tested) and orchestrated from `src/main.ts`:

1. The listening TCP sockets and the pid that owns each one: `netstat -ano`, filtered to `TCP` rows in state `LISTENING` (`parseNetstatListeners`).
2. Every running process with its parent pid and creation time, from one `Get-CimInstance Win32_Process` call turned into compact JSON (`parseProcessList`).

A tab only knows its shell's own pid, and `npm start` is several processes deep: cmd.exe spawns npm's node, which spawns the server's node, and only the last one listens. `descendantPids` expands the shell pid into the whole tree using the process list, and `portForTree` returns the port that started listening latest anywhere in that tree, ties falling back to the lowest port. Decided by Aryan on 2026-09-07, replacing an earlier "lowest port wins" rule.

Windows re-uses pids, so a plain parent walk could adopt a stranger's whole subtree if a long-dead shell's pid gets handed to something unrelated. `descendantPids` guards against this the same way `scripts/agent-harness/lib.mjs` already does: an edge where a "child" was created before its claimed parent is dropped, since that child cannot really belong to that parent.

### Why the poll is shaped this way

The two commands cost very different amounts on Windows. Measured on the development machine: `netstat -ano` about 45 ms, a fresh `powershell.exe -Command "Get-CimInstance Win32_Process ..."` about 1 s, `Get-NetTCPConnection -State Listen` about 1.5 s (not used), `wmic` not present on this Windows at all.

So `netstat` runs on every poll, and the far more expensive process list is only re-read when it might actually be stale: the set of listening sockets changed, a PTY was created or destroyed since the last read, or the cache is over a minute old (`SERVER_PROC_MAX_AGE_MS`).

Polling itself runs on two schedules. A slow interval, every 10 seconds (`SERVER_POLL_MS`), catches anything the burst schedule missed. The burst schedule fires 700 ms after the last output chunk on any PTY settles (`SERVER_BURST_DELAY_MS`), rate-limited to at most once every 2 seconds (`SERVER_BURST_MIN_GAP_MS`) so a chatty build watcher cannot turn every line of output into a poll. This is what makes the port show up within about a second of the server printing its banner, instead of waiting up to 10 seconds for the slow interval.

## The port on the record

`Tab.port` is persisted, optional, and validated on load as an integer from 1 to 65535 (anything else is dropped, never clamped or coerced). While a thread is awake, main keeps it current by pushing `pty:port` (`preload.ts`'s `pty.onPort`) whenever the listener set for that tab's tree changes, including a push of `null` when the server stops.

While a thread is asleep the port is left exactly as it is. It is the one thing that marks a sleeping shell as a server rather than a plain shell, which is what lets the asleep pane say "runs npm start" and lets a wake re-run that command. This is why the renderer's `pty:port` listener in `app.tsx` drops an incoming `null` for a thread that is already asleep: sleeping kills the process tree, and main only reports the listener gone once the kill has actually run, so a `null` landing in that gap would otherwise erase the port the instant a server thread fell asleep. Only a `null` for a thread that is still awake, meaning its own server was stopped without the shell going away, clears the port. This exact sequencing bug turned up and was fixed during the Phase 5 self-test.

Running state has a precedence, in `threadView.ts`'s `threadState`: asleep wins over everything (no process, nothing to run or notify about), then a notification wins over running (a permission prompt or a finished turn asks something of the user, a live port does not), and only once neither applies does a captured port make the thread `running`.

## Naming: a server is named by its command

A shell's live title reads "npm start" or "cmd.exe - node server.js", which is really the shell's own title, not the server's name. `threadView.ts`'s `threadName` names a thread by `lastCommand` instead of the live title whenever it is a shell (no `claudeSessionId`) with a captured `port` and a non-empty `lastCommand`, trimmed. Asleep or awake makes no difference, since the port persists through sleep and is itself what marks the shell as a server. A shell with a port but no captured command, or a command but no port, keeps the live title; a chat keeps its own name chain (`claudeTitle`, the Claude summary glyph, `firstPrompt`, then the live title) unchanged even when it happens to carry a port and a command. Decided by Aryan on 2026-09-07.

## Last command: OSC 133 marks in cmd's prompt

Waking a server needs to know what to re-run. afterterm captures the last command typed at a shell prompt using OSC 133, the de facto shell-integration sequence VS Code, iTerm2 and WezTerm already parse. cmd's injected `PROMPT` (`main.ts`, alongside the existing OSC 9;9 cwd report) now also emits `133;A` before the visible prompt and `133;B` right after it.

`src/renderer/commandMarks.ts` (pure, no xterm, unit-tested) holds the state machine: A means a fresh, untouched prompt; B stamps where the prompt ended (the buffer row and column) and marks the terminal "at a prompt"; C or D, the shell announcing a command started or finished, clears that flag the same way a consumed Enter would, so a shell that emits them without an Enter first can never leave a stale position for the next Enter to misread.

`Terminal/index.tsx` reads the buffer between that stamped position and the cursor the moment Enter is pressed, before the keystroke is written to the PTY, and hands the cleaned text (trimmed, control characters stripped, capped at 500 characters) to `setLastCommand`. This deliberately reads the buffer rather than the keys the user typed: line editing (backspace, arrow-key edits), history recall (the up arrow) and tab completion all change what ends up submitted, so only the terminal's own screen buffer, what the shell actually echoed back, is guaranteed to match what really ran.

This works for cmd only, until Phase 6 adds the equivalent prompt hook for the other shells. A pwsh, Git Bash or WSL thread still gets a port (process-tree detection has nothing shell-specific about it) but no `lastCommand`, so its server wakes as a plain fresh prompt in its folder rather than being re-run.

## Wake: re-running the command

`wakePlan` in `sleepWake.ts` returns a `runCommand` only when the thread has a captured port and its `lastCommand`, trimmed, is non-empty, under 500 characters and free of control characters. This mirrors exactly the check already applied to a chat's `resumeSessionId` (a canonical UUID or nothing), since `runCommand` is about to become a typed shell command the same way a resume id becomes a typed `claude --resume` command. A server thread never resumes a chat, so `resumeSessionId` is always null whenever `runCommand` is set.

`Terminal/index.tsx` types the command 700 ms after spawn (`SHELL_READY_MS`), the same wait already used for a chat's resume to land after the shell's first prompt appears.

## The close confirm

Closing a thread that is still listening stops something the user cannot get back just by reopening it, so it asks first. `needsCloseConfirm` (true only for an awake thread with a captured port) and `closeConfirmText` live in `threadView.ts`; the dialog itself, `ConfirmDialog`, is a generic yes/no component that knows nothing about servers, the caller supplies every string:

> **Close the server on :5173?**
> This thread is listening on :5173. Closing it stops the server.
> [Cancel] [Close thread]

`closeThread` in `app.tsx` is the one function every close path calls, whether that is the row's × button, `Ctrl+Shift+W`, the sidebar menu or the header menu, so the confirm is reached the same way from all four. Escape and Cancel leave the thread running. A thread whose server has already stopped closes with no confirm, and a PTY that exited on its own (`handlePtyExit`) never confirms either: by the time the process is gone there is nothing left to lose.

## The sleep confirm

Sleep tears down the same process tree Close does, so it asks the same way. `needsSleepConfirm` in `threadView.ts` is the same rule as `needsCloseConfirm` (an awake thread with a captured port), implemented in terms of it so the two rules cannot drift apart. `sleepConfirmText(port, lastCommand)` returns:

> **Sleep the server on :5173?**
> This thread is listening on :5173. Sleeping it stops the server; Wake runs npm start again.
> [Cancel] [Sleep thread]

The last clause of the body names what Wake actually does: "Wake runs npm start again" when a `lastCommand` was captured, or "Wake opens a fresh prompt" when it was not. `sleepThread` in `app.tsx` checks `needsSleepConfirm` and opens the same `ConfirmDialog` component the close confirm uses instead of sleeping outright; Escape and Cancel leave the thread running, Sleep thread runs the ordinary `sleepThreadNow`.

## Testing this with the harness

`scripts/agent-harness/` gained three commands for Phase 5 (full reference in `scripts/agent-harness/README.md`):

- `drive confirm` reads the confirm dialog's title, body and button text, whether it was raised by Close or by Sleep.
- `drive opened` reads the URL the last "Open localhost:port" click reached, from `window.__afterterm.lastOpenExternal`; under the harness main logs `[harness] shell:openExternal <url>` instead of opening a real browser.
- `drive marks --tab <id>` reads the OSC 133 state machine (`window.__afterterm.commandState`), useful for checking the marks landed without reading the raw buffer.

A typical run seeds a project whose folder holds a tiny server (for example `node -e "require('http').createServer((q,r)=>r.end('hi')).listen(48765)"` as its `npm start`), types `npm start` into a woken thread, waits a few seconds, then reads `sidebar` (its row now named "npm start") and `header` for the port and chip, right-clicks for "Open localhost", reads `opened`, closes the row and reads `confirm`, sleeps, reads `confirm` again and clicks `[data-confirm]` to actually sleep, reads `pane` for the "runs npm start" line, wakes and reads `tail` for the re-typed command, then does a graceful `window quit` and relaunch to confirm the port comes back. Full flow in the README's "Phase 5 flow" section.

Verified this way on 2026-09-07: `npm start` turned a row green with `:48765` and the chip "Running on :48765" about a second after the server's ready line; the row's name switched from the shell's live title to "npm start"; Ctrl+C cleared the port within 3 seconds; Sleep asked first and, once confirmed, kept the port ("runs npm start"); Wake re-typed the command after 700 ms and the server was back within 4 seconds, both after a plain sleep/wake and after a graceful quit and relaunch; "Open localhost:48765" reached `shell:openExternal`; the close confirm appeared from the row's ×, Ctrl+Shift+W and both menus, and Close thread killed the tree and filed the thread into history.

## Limits

- A server started with `start` or otherwise detached from the shell's own process tree is invisible the moment the shell returns: detection only ever walks the PTY's own descendants.
- Only TCP listeners are found. A UDP-only service shows no port.
- A chat thread never re-runs anything. `runCommand` is a shell-only idea; a chat's wake path only ever considers `resumeSessionId`.
- `lastCommand` is simply the last Enter at a captured prompt. Typing an unrelated command after stopping the server replaces what a later wake would re-run.
- pwsh, Git Bash and WSL threads get a port (process-tree detection is shell-agnostic) but no `lastCommand` until Phase 6's prompt hooks land, so their servers wake as a plain fresh prompt rather than being re-run.

# afterterm: Persistent PTY Host — Design Doc

**Status:** Design / not started  
**Date:** 2026-05-29  
**Goal:** Let afterterm update to a new build *without killing running terminals* — close the app, reopen it, and find every shell (and every running Claude Code session) still alive, scrollback intact.

---

## Table of Contents

1. [The Problem](#1-the-problem)
2. [Why the Current Architecture Can't Do It](#2-why-the-current-architecture-cant-do-it)
3. [The Solution: A Detached PTY Host](#3-the-solution-a-detached-pty-host)
4. [Prior Art: How VS Code Does It (and Why Ours Differs)](#4-prior-art-how-vs-code-does-it-and-why-ours-differs)
5. [Architecture](#5-architecture)
6. [The Wire Protocol](#6-the-wire-protocol)
7. [Scrollback Buffering and Replay](#7-scrollback-buffering-and-replay)
8. [Daemon Lifecycle](#8-daemon-lifecycle)
9. [Teardown and Crash Handling (the inversion)](#9-teardown-and-crash-handling-the-inversion)
10. [Risks and Hard Parts](#10-risks-and-hard-parts)
11. [Phased Implementation Plan](#11-phased-implementation-plan)
12. [Open Questions](#12-open-questions)
13. [Decision Checklist Before Building](#13-decision-checklist-before-building)

---

## 1. The Problem

Today, updating afterterm is destructive:

1. `npm run build` produces a new `afterterm.exe`.
2. To use it, you must **close the running app**.
3. Closing the app kills the Electron process.
4. Every shell — cmd, pwsh, and any **Claude Code session running inside a tab** — dies with it.
5. On relaunch, session restore rebuilds the *layout* (tab order, groups, CWDs) and spawns **fresh** shells. Scrollback, command history, and running processes are gone.

For a tool whose whole point is hosting long-lived terminal work — especially long Claude Code sessions — this is the single biggest friction point. You avoid updating because updating costs you your working state.

**The goal:** make a build update feel like reloading a web page. Close, reopen, everything's still there.

---

## 2. Why the Current Architecture Can't Do It

Everything lives in **one process**:

```
afterterm.exe (single Electron process)
├── main process      → owns ConPTY handles via node-pty, spawns shells
├── renderer process  → xterm.js display + input
└── notifier window   → toast overlay
```

Two facts make this fatal for hot-updating:

1. **ConPTY handles are owned by the process that created them.** When you call `CreatePseudoConsole` (which node-pty does under the hood), the kernel ties that pseudoconsole to the calling process. Windows provides **no API to transfer or reconnect** a ConPTY to a different process after the fact. When the owning process exits, the kernel object is destroyed. This is a Windows constraint, not an afterterm bug. (See `CLAUDE.md` → "Windows ConPTY cannot be reconnected after app restart — the kernel object dies with the process.")

2. **The code we iterate on lives in the same process as the PTYs.** Almost all of today's work — IPC handlers, the notifier window, keyboard shortcuts, session persistence — is in `main.ts`. Any change there requires restarting the main process, which is exactly the process holding the ConPTY handles.

So: the thing that changes often (app logic) is welded to the thing that must never die (the PTYs). We have to separate them.

---

## 3. The Solution: A Detached PTY Host

Split afterterm into **two independent processes**:

- **PTY host daemon** — a small, long-lived background process. Its *only* job is to own ConPTY handles and the shell processes. It rarely changes. It is **not** a child of Electron — it has its own lifetime and survives the app closing.
- **afterterm (Electron)** — the window, the UI, the notifier, the tab-group logic. This is the part you iterate on. It is a **client** of the daemon. It is free to die and relaunch.

They talk over a **named pipe** (Windows IPC).

The update flow becomes:

1. `npm run build` → new `afterterm.exe`.
2. Close afterterm. **The daemon keeps running** — shells and Claude sessions untouched.
3. Reopen afterterm.
4. On launch it connects to the daemon, asks "what terminals do you have?", re-attaches to each, and replays buffered scrollback into fresh xterm.js instances.
5. You're back exactly where you were — including mid-stream Claude Code output.

The key insight: **a normal close/reopen now preserves terminals.** We don't even need fancy in-place hot-reload — we just need the PTYs to outlive the window.

---

## 4. Prior Art: How VS Code Does It (and Why Ours Differs)

VS Code has solved a *very similar* problem. It runs a **"pty host"** — a separate process (an Electron `UtilityProcess`) that owns terminal processes. When you **reload the window** (`Developer: Reload Window` / Ctrl+R), your terminals survive because the pty host process persists across the renderer reload. VS Code calls these "persistent terminal sessions" and buffers output to replay on reconnect.

**Where ours must differ:** VS Code's pty host is a *child* of its main process. A full **quit** of VS Code still tears down the pty host and kills local terminals (only Remote/server-backed terminals truly persist across a full quit). VS Code's persistence is scoped to *window reload*, not *app restart*.

Our requirement is stronger: survive a full app **update**, which means a full process exit and relaunch of a *different binary*. So our daemon cannot be a child of the Electron process. It must be **fully detached** — spawned with `detached: true`, not tied to the parent's lifetime — so that closing Electron (or replacing the .exe) leaves it running.

This is the one meaningful architectural departure from the VS Code model, and it drives several downstream decisions (lifecycle, versioning, crash handling).

---

## 5. Architecture

```
┌───────────────────────────────────┐         ┌────────────────────────────────────┐
│  afterterm.exe  (Electron)         │         │  afterterm-ptyhost  (Node process)   │
│  ── updates / restarts kill this ──│         │  ── detached, survives app restart ──│
│                                    │         │                                      │
│  renderer (xterm.js, React UI)     │  named  │  node-pty (ConPTY handles)           │
│        ▲                           │  pipe   │  shell processes: cmd / pwsh / claude│
│        │ IPC                       │ ◄─────► │  per-PTY scrollback ring buffer      │
│  main (window, notifier, routing)  │         │  session registry                   │
│        │                           │         │                                      │
│  pipe client ─────────────────────┼─────────┼─► pipe server                        │
└───────────────────────────────────┘         └────────────────────────────────────┘
```

**Process boundaries:**

- The daemon is a plain Node process (not Electron). node-pty 1.1.0 ships N-API prebuilds that work across ABIs (per `CLAUDE.md`), so running it outside Electron is actually *simpler* — no `@electron/rebuild` concerns.
- The daemon binds a named pipe at a well-known path, e.g. `\\.\pipe\afterterm-ptyhost`.
- On launch, Electron tries to connect to that pipe. If the connection fails (no daemon running), Electron spawns the daemon (detached) and retries.

**What moves where:**

| Concern | Today | After |
|---|---|---|
| Spawn shell / hold ConPTY | main.ts | **daemon** |
| Write keystrokes to PTY | main.ts | daemon (proxied through main) |
| Resize PTY | main.ts | daemon (proxied) |
| Kill PTY / tree cleanup | main.ts | **daemon** |
| Scrollback buffer | (none — xterm only) | **daemon** |
| Window / tab-group UI | main + renderer | unchanged (Electron) |
| Notifier overlay | main + renderer | unchanged (Electron) |
| Session layout persistence | main.ts | unchanged (Electron) — but now references daemon session IDs |

**Routing question (decide during design):** does the renderer talk to the daemon *through* Electron main (renderer ↔ main ↔ pipe ↔ daemon), or does it connect to the pipe more directly? Routing through main keeps the security model identical to today (renderer stays sandboxed, no direct pipe access) at the cost of one extra hop. **Recommendation: route through main.** The extra hop is cheap and preserves contextIsolation.

---

## 6. The Wire Protocol

A small, **versioned**, length-prefixed JSON (or MessagePack) message protocol over the pipe. Versioning matters because the app updates independently of the daemon — a new app talking to an old daemon must degrade gracefully or trigger a controlled daemon upgrade.

**App → Daemon:**

| Message | Payload | Meaning |
|---|---|---|
| `hello` | `{ protocolVersion }` | Handshake; daemon replies with its version + session list |
| `list` | — | "What terminals do you have?" |
| `create` | `{ sessionId, shellId, cwd, cols, rows }` | Spawn a new shell |
| `attach` | `{ sessionId }` | Re-attach to an existing shell; daemon replies with buffered scrollback |
| `detach` | `{ sessionId }` | Stop streaming (app closing) but **keep the shell alive** |
| `input` | `{ sessionId, data }` | Keystrokes |
| `resize` | `{ sessionId, cols, rows }` | Window resize |
| `kill` | `{ sessionId }` | Genuinely terminate this shell + child tree |
| `shutdown` | `{ force }` | "Quit and kill everything" (explicit user action) |

**Daemon → App:**

| Message | Payload | Meaning |
|---|---|---|
| `hello-ack` | `{ protocolVersion, sessions: [...] }` | Handshake reply |
| `scrollback` | `{ sessionId, data }` | Replay buffer on attach |
| `data` | `{ sessionId, data }` | Live PTY output |
| `exit` | `{ sessionId, exitCode }` | Shell exited on its own |
| `error` | `{ sessionId?, message }` | Something went wrong |

**Critical distinction:** `detach` vs `kill`. Closing the app sends `detach` for every terminal (keep alive). Closing a *tab* sends `kill` (genuinely terminate). Getting this distinction right is the heart of the feature.

---

## 7. Scrollback Buffering and Replay

The visual state of a terminal lives in xterm.js, in the renderer. When the app relaunches, every xterm.js instance is brand new and blank. To restore what you were looking at, the **daemon must buffer each terminal's raw output stream** and replay it on `attach`.

**How replay works:** xterm.js reconstructs its screen by parsing the raw byte stream (text + ANSI escape sequences). If we feed it the same bytes again, it rebuilds the same screen — cursor position, colors, the lot. This is exactly what VS Code does for persistent sessions.

**Design decisions:**

- **Bounded buffer.** Unbounded = memory leak. Cap per terminal at roughly what xterm's scrollback holds — e.g. last **5000 lines** or a byte cap (say 2–4 MB). Use a ring buffer: oldest bytes drop off the front.
- **Replay is fast enough.** A few MB parsed on attach is milliseconds. No streaming/throttling needed for replay.
- **Alternate-screen apps (Claude Code's Ink UI, vim, less).** These use the alternate screen buffer and absolute cursor positioning, and they *redraw themselves* constantly. Replaying the raw stream reconstructs them well in practice (VS Code relies on this). There can be minor transient artifacts at the moment of reattach, usually corrected by the app's next redraw. **This is the part most worth prototyping early** — Claude Code is the primary in-tab workload, so it must reattach cleanly.
- **Resize on reattach.** The new window may be a different size. On `attach`, after replaying scrollback, send a `resize` to the current dimensions so the shell/TUI reflows. Claude Code reacts to SIGWINCH-equivalent and redraws.

---

## 8. Daemon Lifecycle

A detached process that outlives the app raises the obvious question: **when does it ever stop?** Get this wrong and you accumulate zombie shells running forever in the background.

**Spawn:** Electron, on launch, attempts to connect to the pipe. Connection refused → spawn the daemon detached → retry connect. (Handle the race where two app launches both try to spawn — daemon should be a singleton, e.g. guard via a named mutex or "pipe already bound" detection.)

**Survive:** Normal app close (window X, Ctrl+Shift+W of the last tab, even app quit) sends `detach` for all terminals and disconnects from the pipe — but the daemon keeps every shell running.

**Stop — needs an explicit policy. Options:**

- **(a) Idle shutdown.** When the last terminal is `kill`ed (not detached) AND no client is connected, the daemon exits. Simple. But means closing the app with zero terminals open leaves nothing to persist — fine.
- **(b) Explicit "Quit and close all terminals."** A distinct menu action / shortcut that sends `shutdown { force: true }`: kill every shell tree, then daemon exits. This is the "I'm really done" action.
- **(c) Reaper timeout.** If no client reconnects within N minutes/hours of the last detach, assume the user is gone and shut down. Protects against forgotten daemons after a crash.

**Recommendation:** implement **(b)** as the primary intentional path, plus **(a)** as the natural floor (no terminals + no client = nothing to do = exit). Consider **(c)** later as a safety net. The UX needs **two clear close affordances**: "close window (keep terminals running)" vs "quit and kill everything." This must be discussed before building — see Open Questions.

---

## 9. Teardown and Crash Handling (the inversion)

This is subtle and important: **today's PTY teardown logic is the exact opposite of what we'll now want.**

`CLAUDE.md` documents hard-won fixes:
- "ConPTY teardown assertion crash — drain and kill asynchronously before `app.quit()` using a `before-quit` handler with `isQuitting` flag."
- "Closing a PTY does NOT kill child processes — must use `taskkill /PID <pid> /T /F` for tree cleanup."

Today, app quit → deliberately kill all PTYs (carefully, to avoid the assertion crash). **In the new model, app quit must NOT kill PTYs** — that's the whole point. So:

- The `before-quit` drain-and-kill logic is **removed from Electron** for the normal-close path. Electron quit just sends `detach` and disconnects.
- All the crash-safe ConPTY teardown logic **moves into the daemon**, and only runs on genuine `kill` / `shutdown` — not on client disconnect.
- The `taskkill /T /F` tree cleanup moves to the daemon too.

**The uncomfortable truth:** the daemon becomes a single point of failure. If the daemon crashes, *every* terminal dies at once — worse than today, where a crash takes down a window you were already looking at. The daemon must be **rock solid**, and the ConPTY teardown stability gotchas (which are exactly afterterm's existing pain points) now live in the most critical process. Daemon code must stay minimal precisely so it can be made bulletproof.

**Mitigations to consider:**
- Keep daemon logic tiny and dependency-light.
- Wrap every PTY operation in defensive error handling; never let one bad PTY take down the daemon.
- Consider persisting the session registry to disk so a crashed-and-respawned daemon could at least report what *was* running (the shells themselves are still gone, but we'd know to tell the user).

---

## 10. Risks and Hard Parts

| Risk | Severity | Notes |
|---|---|---|
| Daemon = single point of failure | **High** | A daemon crash kills all terminals at once. Must be bulletproof. |
| ConPTY teardown stability moves into daemon | **High** | This is already afterterm's flakiest area (assertion crashes). Now it's in the critical process. |
| Alt-screen TUI replay artifacts (Claude Code!) | **Medium** | Primary workload. Prototype reattach early or the whole feature underdelivers. |
| Protocol versioning / app-daemon skew | **Medium** | New app + old daemon. Need graceful handling or controlled daemon upgrade. |
| Zombie daemon / forgotten shells | **Medium** | Lifecycle policy must be clear. Reaper timeout as safety net. |
| Daemon self-update still hard | **Low** | If the daemon protocol changes, you *do* eat a restart. Mitigate by keeping the daemon stable and rarely changed. |
| Singleton race on spawn | **Low** | Two app launches racing to spawn the daemon. Named mutex / pipe-bound detection. |
| Security: pipe access | **Low** | Named pipe should be ACL'd to the current user. Route renderer through main to preserve sandbox. |

**The honest summary:** this trades a *predictable, annoying* problem (lose state on update) for a *rare but catastrophic* one (daemon crash loses everything). The win is real, but it concentrates fragility into one component that must be engineered to a much higher reliability bar than anything in afterterm today.

---

## 11. Phased Implementation Plan

Build it incrementally so each phase is independently testable. **Do not attempt all at once.**

**Phase 0 — Spike (throwaway).**  
Prove the riskiest assumption: spawn a detached Node process holding one node-pty shell, bind a named pipe, connect from a separate script, write/read, disconnect, reconnect, and **replay a Claude Code session's scrollback into a fresh xterm**. If alt-screen replay is unacceptable, we learn it here before committing. *This phase decides whether the project is worth doing.*

**Phase 1 — Extract the PTY host (still child-of-Electron).**  
Move all node-pty logic into a separate process, but spawned as a normal child first (VS Code's model). Renderer ↔ main ↔ pipe ↔ host. Terminals survive a **renderer reload** but not app quit yet. This de-risks the protocol and IPC plumbing without the detached-lifetime complications.

**Phase 2 — Detach the host.**  
Make the host a detached, independent process with its own lifetime. Implement spawn-on-launch, connect/reconnect, the singleton guard. Now terminals survive **app restart**. Invert the teardown logic (Section 9).

**Phase 3 — Scrollback + clean reattach.**  
Ring-buffer per session, `scrollback` replay on attach, resize-on-reattach. Tune the buffer cap. Polish Claude Code reattach specifically.

**Phase 4 — Lifecycle + UX.**  
Implement the two close affordances ("close window" vs "quit & kill all"), idle shutdown, optional reaper timeout. Wire session-layout persistence to daemon session IDs so layout restore re-attaches instead of recreating.

**Phase 5 — Hardening.**  
Defensive error handling around every PTY op, daemon crash recovery, protocol version negotiation, stress-test with many terminals and heavy output.

Each phase is a commit milestone. Phase 0 is a go/no-go gate.

---

## 12. Open Questions

1. **UX for the two kinds of "close."** How does the user distinguish "close the window, keep my shells running" from "quit and kill everything"? Window X = detach? A separate menu item for full quit? This is a **UX discussion to have before building** (per our working norms — discuss UX before implementing). A wrong default here is dangerous: someone expecting "X closes everything" could leave dozens of Claude sessions running invisibly.
2. **Does the daemon show any presence?** A tray icon? Otherwise it's an invisible background process the user can't see or manage. A tray icon ("afterterm — 7 terminals running, no window open") would make it discoverable and killable.
3. **Buffer cap value.** 5000 lines? A byte cap? Match xterm's scrollback (currently 5000) or allow more for persistence?
4. **One daemon or one-per-... ?** Single global daemon for all afterterm windows, presumably. Confirm we never want multiple isolated hosts.
5. **What about a daemon crash mid-session?** Do we surface "your terminals were lost because the host crashed," or silently respawn? Persisted session registry would let us at least explain.
6. **Dev vs prod daemon.** Dev (`npm start`, electron.exe) and prod (afterterm.exe) — do they share one daemon or use distinct pipe names? Sharing risks version skew during development; separate names is safer. Lean **separate**.

---

## 13. Decision Checklist Before Building

Do not start Phase 1 until these are answered:

- [ ] **Phase 0 spike passed** — Claude Code scrollback replays acceptably into a fresh xterm after detach/reconnect.
- [ ] **Close UX decided** — clear, safe affordances for "keep running" vs "kill all" (Open Q1).
- [ ] **Daemon presence decided** — tray icon or not (Open Q2).
- [ ] **Lifecycle policy chosen** — which of idle / explicit / reaper shutdown (Section 8).
- [ ] **Dev/prod pipe naming decided** (Open Q6).
- [ ] **Accepted the tradeoff** — daemon as single point of failure, with the reliability bar that implies (Section 10).

---

## Appendix: Relationship to Existing `CLAUDE.md` Notes

This design directly reworks several documented behaviors. When/if implemented, update `CLAUDE.md`:

- "Windows ConPTY cannot be reconnected after app restart" → still true *within a process*, but the daemon now means shells outlive the app.
- "Session Restore" section → restore now re-attaches to live daemon sessions instead of always spawning fresh shells (with fresh-spawn as the fallback when the daemon has no matching session).
- "ConPTY teardown assertion crash" / "before-quit drain" → this logic moves to the daemon and no longer runs on normal app close.
- The Architecture section gains a third process.

# afterterm — Ideas

## Project Notes Tab

Each group/project gets a "Notes" tab as its first tab — not a terminal, but a lightweight rich-text editor. Think Notion inside the side panel.

**Features:**
- [ ] Bullet points (unordered + ordered lists)
- [ ] Checkboxes (toggleable, like Notion to-dos)
- [ ] **Bold**, *italic*, __underline__ formatting
- [ ] Auto-save (debounced, same as session save — 2s after last edit)
- [ ] Stored per-group in `%APPDATA%\afterterm\notes\<group-id>.json` (or markdown)
- [ ] Always the first tab when you open a group — click the group, see your notes

**Open questions:**
- Editor library: contenteditable + lightweight markdown? Or a proper rich-text lib like TipTap/ProseMirror?
- Should notes be per-group only, or also a global scratchpad?
- Keyboard shortcut to toggle between notes and terminal tabs?

---

## Tab Attention / Notification System

When a terminal needs the user's attention, the tab should change visually — like how browser tabs show a dot or flash when a background tab has activity.

**Use cases:**
- Claude Code finishes a turn (the existing hook already sets tab title to `✅ project - done`)
- A long-running command finishes (`npm install`, `cargo build`)
- A process errors out
- Permission prompt waiting

**Visual indicators:**
- [ ] Dot/badge on the tab in the side panel (colored by severity: green = done, orange = needs attention, red = error)
- [ ] Tab title prefix changes (already happening via Claude hooks)
- [ ] Side panel group header shows attention count (e.g., "rails api · 2")
- [ ] Optional: Windows taskbar flash (Electron's `win.flashFrame(true)`)
- [ ] Optional: system notification toast via Electron `Notification` API

**Detection methods:**
- Parse OSC title sequences for known patterns (✅, ⚠, ⏳, ⚙ from Claude hooks)
- Watch for BEL character (`\x07`) in PTY output — shells/apps ring the bell for attention
- Detect process exit in background tabs

---

## Claude Session Resume

*See [research-01-claude-session-resume.md](research-01-claude-session-resume.md) for detailed findings.*

When afterterm closes and reopens, automatically resume Claude Code sessions using `claude --resume "<session-name>"`. Session names are stored in Claude Code's JSONL files at `~/.claude/projects/<hash>/`. Branch: `feature/claude-session-resume`.

---

## Arrow Key Tab Navigation

Move between tabs using arrow keys with a modifier. Faster than Ctrl+Tab cycling when you know which direction you want to go.

- [ ] `Ctrl+Shift+↓` — next tab
- [ ] `Ctrl+Shift+↑` — previous tab
- [ ] Vertical arrows match the side panel layout (tabs are stacked vertically, not horizontal)
- [ ] Should skip collapsed group members (only land on visible tabs)

---

## Multiple Terminal Windows on Screen at Once

Open multiple afterterm windows simultaneously — each is an independent Electron `BrowserWindow` with its own tab groups, side panel, and session. Useful for side-by-side project views without collapsing groups.

**Open questions:**
- Launch from tray icon or `File > New Window`?
- Session persistence: one `session.json` per window, or a multi-window manifest?
- Should groups be moveable between windows (drag out → new window)?

---

## Notification Pop-up UI

Improve UI of notification pop-ups. Need more context and better information hierarchy.

---

## Scrollback Snapshot

Built in Phase 4, as the scrollback tail. See "Sleep, wake, history and the scrollback tail (Phase 4)" in `CLAUDE.md` for what shipped: a tail is written on sleep and on close, and replayed dimmed above a "Woke just now" divider on wake.

---

## Update self-install hook to a dispatcher (stop double notifications)

`src/claude-hook-install.ts` (`reconcileClaudeHook`) registers
`afterterm-notify.ps1` **additively** — alongside whatever hooks the user already
has. On a machine that already runs its own popup `notify.ps1`, that produces
**two** notifications inside afterterm (Windows popup *and* the overlay).

**Idea:** instead of adding a standalone second entry, register **one dispatcher
entry per event** that branches on `AFTERTERM`:

```
if AFTERTERM=1  → afterterm-notify.ps1   (overlay only)
else            → the user's own hook    (or nothing if none)
```

- [ ] One dispatcher entry per event, not a coexisting `afterterm-notify.ps1` entry.
- [ ] Stay idempotent + never clobber the user's own hooks (keep current guarantees).
- [ ] Keep `prefs.json` opt-out + surgical removal working with the single-entry shape.

Full write-up of the diagnosis and the manual fix already applied on the dev
machine: [`note-01-duplicate-notifications-dispatcher.md`](note-01-duplicate-notifications-dispatcher.md).

---

## Dependency check on first launch

afterterm's Claude Code notifications only work if the recipient machine has
**Claude Code** installed and **`pwsh`** (PowerShell 7) on PATH. Right now a
fresh install silently does nothing if either is missing — the self-install
hook (`claude-hook-install.ts`) skips when there's no `~/.claude`, and the hook
can't run without `pwsh`.

**Idea:** on startup, detect these and surface the result instead of failing
silently.

- [ ] Check for `~/.claude` (Claude Code installed) — if absent, the notifier
      hook won't attach; show a one-time, dismissible notice.
- [ ] Check `pwsh` is resolvable on PATH — if absent, the hook command would
      error; warn and link to the PowerShell 7 install.
- [ ] (Optional) check 7-Zip etc. are only build-time deps — not needed at runtime.
- [ ] Keep it non-blocking: afterterm must run fine as a plain terminal even
      with neither present. This is purely to explain *why* notifications are
      quiet, not to gate the app.

Not urgent — afterterm is fully usable without it; this just removes a "why
aren't notifications working?" mystery.

---

## Zero-config Claude Code hooks through a bundled plugin and a PATH shim

Noted 2026-09-18 while comparing notes with enjoy.dev. Not being worked on; interesting, parked.

Today afterterm self-installs its notify hook into the user's `~/.claude/settings.json` (five
event entries, all pointing at one copied script) plus an opt-out flag in prefs.json and a
first-run toast, because at the time of `docs/research-01-claude-code-hooks.md` Claude Code had
no way to load a hook for one session only. That is no longer true. Current Claude Code has two
flags for it, both confirmed on this machine with `claude --help`:

- `--plugin-dir <path>` loads a plugin from a folder for that session only, and a plugin can carry
  its own hooks in `hooks/hooks.json`.
- `--settings <file-or-json>` applies a settings file for that session only (enjoy.dev uses this
  to switch hooks off in the sessions it drives).

The idea: bundle the notify hook as a plugin folder inside afterterm, and prepend a folder to each
PTY's PATH (afterterm already owns the PTY environment, that is how `AFTERTERM=1` gets in) holding
a tiny `claude.cmd` shim, plus a `claude` shell script for Git Bash, that runs the real claude with
`--plugin-dir <bundled plugin>`. Then nothing is ever written to `~/.claude`: no settings.json
edit, no copied script, no reconcile on startup, no opt-out flag, no toast, and no `AFTERTERM=1`
gate in the script, since the hooks only exist inside afterterm terminals in the first place. The
whole of `src/claude-hook-install.ts` and its tests would go.

The trade-off Aryan wants to think about: it only catches `claude` typed at the prompt through
PATH. A thread that starts Claude by absolute path, through a personal alias, through `npx`, or
where the user's own PATH already resolves `claude` ahead of the shim, gets no notifications in
that thread, silently. So either afterterm has to start Claude with the exact command itself
(which changes how a thread is opened) or the shim has to be reliable enough that plain `claude`
always hits it. Still to verify: that `--plugin-dir` hooks fire for the interactive TUI, not only
headless mode (ten minutes in the harness). A middle option, registering the plugin once so
settings.json holds a single `"enabledPlugins"` line, only moves the clutter into
`~/.claude/plugins`, so it is not worth doing.

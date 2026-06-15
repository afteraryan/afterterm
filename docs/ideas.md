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

On close, save each tab's visible buffer (last ~50 lines from xterm.js). On restore, write it into the fresh terminal before the user starts typing. Gives visual context about what was happening before the close — no scrollback lost.

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

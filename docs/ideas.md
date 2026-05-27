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

## Scrollback Snapshot

On close, save each tab's visible buffer (last ~50 lines from xterm.js). On restore, write it into the fresh terminal before the user starts typing. Gives visual context about what was happening before the close — no scrollback lost.

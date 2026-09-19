# afterterm

[![vibe coded](https://img.shields.io/badge/vibe_coded-100%25-blueviolet)](https://github.com/afteraryan/afterterm)

A terminal emulator for Windows built around **projects and threads**, not tabs: a Home screen of the projects you're working on, and inside each one, chats (Claude Code sessions) and shells that keep their name, their last output and their state even after you close the app. Built for running several Claude Code sessions side by side.

> ⚡ afterterm is **vibe coded** — built almost entirely through AI pair-programming
> (Claude Code). Expect that character: fast-moving, pragmatic, occasionally rough.

<!--
  Screenshot: drop an image at docs/screenshot.png (and optionally a docs/tab-groups.gif).
  A shot showing Home with a few pinned project cards, or the workspace with the rail and
  a chat thread's header (model, branch, worktree), sells the feature best.
-->
![afterterm](docs/screenshot.png)

## Why

Every terminal lets you open a dozen tabs. Almost none of them know what a "project" is, and none of them treat a Claude Code session as anything more than a process with a title. afterterm starts from projects instead: give one a folder, a colour and an icon, and every thread inside it, a chat or a plain shell, belongs there. A chat is named after the Claude Code conversation itself, and its header shows the model, the git branch and the worktree it's running in, so you can tell threads apart without opening them.

Closing afterterm, or putting a thread down, no longer costs you anything: every thread restored from a previous launch starts asleep, showing the last output it produced, and wakes only when you ask it to, a chat resuming its Claude Code session (`claude --resume`) in the right folder. A shell running a dev server is detected by its listening port, named by the command that started it, and offered "Open localhost" and a re-run of that same command on wake.

## Features

- **Home screen**: a date heading, pinned project cards, and the rest of your projects sorted by recent activity, with an archived section tucked away
- **Projects**: a folder, a colour, one of ten icons and a default shell; a project page lists its live, asleep and closed (history) threads
- **Threads: chats and shells**: a chat is named from the Claude Code conversation (its title, its summary, or the first prompt before that); the header and the sidebar hover card show the model, the git branch and the worktree
- **Sleep and wake**: every thread restored from a previous launch starts asleep with its last output shown on an asleep pane; nothing respawns until you wake it, and a chat resumes its Claude Code session on wake
- **Jump button**: a round button appears when you've scrolled away from the newest or oldest output, on both a live terminal and an asleep pane's saved output, and jumps you back with an eased animation
- **Servers**: a thread running a dev server is detected by its listening port, shown on its row and header, offered "Open localhost:port", and re-runs its last command when woken; closing or sleeping a thread that's still listening asks first
- **Shell integration**: working-directory and prompt-mark capture for Command Prompt, PowerShell 7, Windows PowerShell, Git Bash and WSL, wrapping any custom prompt (oh-my-posh, starship, a hand-written one) instead of replacing it, with a per-shell opt-out
- **The always-on rail and panel**: a rail shows only the projects that need you, with badges for what's waiting, working, finished or compacting; the panel lists pinned and recently active projects, with everything else docked at the bottom; needs-you stays until a thread is actually answered, not just glanced at, and a chat can be marked unread
- **Keyboard-driven**: cycle every visible thread across projects with Ctrl+Shift+Up/Down, filter the panel with an in-place search box, and more (see below)
- **Claude Code notifications**: an always-on-top overlay shows toasts on the display holding the main window when a background thread needs you, backed by a self-installed, additive Claude Code hook that's a complete no-op outside afterterm
- **Open in File Explorer and Open in your editor**: for a project's folder and for a single thread's own folder (a chat's Claude Code folder, or a shell's working directory)
- **Multiple shells**: auto-detects Command Prompt, PowerShell 7, Windows PowerShell, Git Bash and WSL; pick which to open from the shell dropdown
- **Session restore**: reopens your projects, threads and their working directories on relaunch, every thread asleep until you act on it
- **GPU-accelerated rendering** — xterm.js with a WebGL renderer (canvas fallback) stays smooth under heavy output
- **Terminal niceties** — clickable links (incl. OSC 8), find-in-scrollback, right-click copy/paste, per-tab font zoom, file drag-and-drop

## Built for Claude Code

afterterm is designed for the workflow of running many [Claude Code](https://www.claude.com/product/claude-code) sessions in parallel:

- **A chat knows what it's called and where it's working**: its name comes from the Claude Code conversation, and the header shows the model, the git branch and the worktree, read without ever running `git`.
- **Notifications when a session needs you**: when a background thread finishes, asks for permission, or hits an error, afterterm shows an always-on-top overlay toast on the display holding the window (even when afterterm is behind other apps), plus a bell on the thread's row that stays until the thread is actually answered, not just looked at.
- **A chat resumes where it left off**: waking an asleep chat thread runs `claude --resume` in its own working directory, whether that's the project's folder or a worktree the session moved into since.
- **Zero setup, no surprises** — afterterm ships its own Claude Code hook and self-installs it for you. The install is additive and idempotent: it never touches or overwrites your existing hooks, it shows a one-time toast the first time it edits your config (no silent dotfile changes), and a single prefs flag opts out — and *stays* opted out. Outside afterterm the hook is a complete no-op: zero output, zero latency, nothing in your other terminals.

> None of this requires Claude Code — afterterm is a perfectly good general-purpose terminal — but it's where the design effort went.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| Ctrl+Shift+T | New thread chooser (project and shell) |
| Ctrl+Shift+P | Search palette over projects and threads |
| Ctrl+Shift+W | Close current tab |
| Ctrl+Tab | Next tab |
| Ctrl+Shift+Tab | Previous tab |
| Ctrl+Shift+Down / Ctrl+Shift+Up | Next and previous thread in sidebar order, crossing projects |
| Ctrl+Shift+B | Toggle the sidebar between full width and the icon rail |
| Ctrl+V | Paste (bracketed paste) |
| Ctrl+C | Copy selection (SIGINT when no selection) |
| Ctrl+Shift+A | Select all scrollback |
| Ctrl+Shift+F | Find in current tab's scrollback |
| Ctrl+scroll | Zoom font size (per-tab) |
| Right-click | Copy selection if any, else paste (Windows QuickEdit style) |

## Install

Grab the latest self-extracting installer from the [Releases](https://github.com/afteraryan/afterterm/releases) page and double-click it. No unzip tool needed.

> Windows only. Built and tested on Windows 11.

## Build from source

Requires **Node.js** and **Windows** (afterterm uses ConPTY via node-pty).

```powershell
git clone https://github.com/afteraryan/afterterm.git
cd afterterm
npm install

npm start          # run in development
npm run build      # produce a portable build in out\afterterm-win32-x64\
```

## Tech stack

[Electron](https://www.electronjs.org/) · [xterm.js](https://xtermjs.org/) · [node-pty](https://github.com/microsoft/node-pty) · [React](https://react.dev/) · [@dnd-kit](https://dndkit.com/) for drag-and-drop.

node-pty runs in Electron's main process (holds the ConPTY handles); xterm.js renders in the renderer, with IPC between them. See [`CLAUDE.md`](CLAUDE.md) for the full architecture notes.

## Status

Early days — currently `0.x` and Windows-only. Expect rough edges.

## Contributing

Issues and PRs welcome — start at the [issue tracker](https://github.com/afteraryan/afterterm/issues).

## License

[MIT](LICENSE) © Aryan Saxena

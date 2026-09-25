# Edited files: phases and status

The execution record for [`design-04-edited-files.md`](design-04-edited-files.md). This file is only about this feature; the repo-wide `PHASES.md` is not used for it. Keep it current as work happens: what had to be done, what is done, what is pending, and every decision with its date.

Rule: finish and polish one phase (unit tests, harness self-test, recordings, fixes) before going deep into the next. Aryan tests once, at the end, in a replica dev build left running for him (see [`testing-and-handoff.md`](testing-and-handoff.md)).

## Status

| Phase | What it contains | Status |
|---|---|---|
| 1 | The Files button and its list, built from Claude's own record: files changed with Claude's tools, subagents' edits, pasted images; the fold rows and the motion | pending |
| 2 | Files Claude changed with a command (`cat >>`, `sed -i`, scripts, `cp`), found by watching the chat's folder while its commands run | pending |
| 3 | File paths in the terminal output become clickable, like web links | pending |
| Handoff | Final self-test of all three together, a replica dev build left running for Aryan, the to-verify entries | pending |

Status words: `pending`, `in progress`, `implemented, untested by Aryan`. Only Aryan marks something `done`, after he has used it.

## Phase 1: the Files button from Claude's record

To do:
- [ ] Read a session's changes from its JSONL: every `Edit`, `Write`, `MultiEdit`, `NotebookEdit` tool call (`input.file_path`, entry `timestamp`), whether a `Write` created the file (`toolUseResult.type === "create"`), newest first, one row per path.
- [ ] Also read the session's subagent records (`<sessionId>/subagents/*.jsonl` beside the session file).
- [ ] Read the pasted images: user-message `image` blocks (base64) with their `[Image #N]` number and timestamp.
- [ ] Classify by extension: documents (`.md`, `.mdx`, `.txt`), code (everything else except images), images Claude made are left out.
- [ ] Keep the list current: re-read when the hook's file channel reports `UserPromptSubmit` or `Stop`, when a thread is restored, and when the list is opened.
- [ ] The header button (stacked-files icon, "N files", no button at zero, kept while asleep).
- [ ] The list: Documents rows, the Code fold row, the Images you pasted fold row; folded rows show only label and count; Code starts unfolded when there are no documents; a part with nothing has no row.
- [ ] Open a file in VS Code (a new file-opening path; `editors:open` only accepts folders today), open a pasted image in the default app, right-click menu (Open in VS Code, Show in File Explorer, Copy path), Esc and click outside close.
- [ ] Motion as in the prototype, off under reduced motion.
- [ ] Unit tests for every pure piece; harness self-test with recordings in `docs/screenshots/edited-files-phase-1/`.

Done: nothing yet.

## Phase 2: files changed by a command

To do:
- [ ] Watch the chat's folder (`threadFolder`) while the chat is working; ignore `node_modules`, `.git`, `out`, `dist`, `.vite` and similar.
- [ ] Keep a change only if it happened while one of that chat's `Bash`/`PowerShell` tool calls was running (the tool call's timestamp to its result's timestamp in the JSONL).
- [ ] Two chats in one folder both running a command at that moment: list the file in both.
- [ ] Merge these into the same list as Phase 1, marked new or changed the same way.
- [ ] Unit tests for the attribution rule; a harness run where a real Claude chat in the dev build writes a markdown file with a shell command.

Done: nothing yet.

## Phase 3: clickable file paths in the output

To do:
- [ ] An xterm link provider for file paths beside the existing web-links addon (`Terminal/index.tsx`).
- [ ] Recognise paths (`/` or `\`, `C:\`, `./`, `../`, `~/`, a name with an extension), resolve relative ones against the chat's folder then the project folder, underline only what exists on disk.
- [ ] Bare names link only when they match a file this chat changed; two with the same name open the newest.
- [ ] `Write(...)` and `Update(...)` lines each open their own file, matched by time.
- [ ] Join a path Claude Code broke across two lines.
- [ ] Open by kind: markdown and code in VS Code, images in the default app, folders in File Explorer.
- [ ] Unit tests for recognising and resolving; harness self-test.

Done: nothing yet.

## Unphased backlog

Known and wanted, not assigned to a phase:
- A Files tab on the project page across all its chats, showing which worktree each file is in.
- Images Claude made (screenshots, SVGs) in the list.

## Decisions

- 2026-09-25: the design in `design-04-edited-files.md` agreed with Aryan against `docs/mockups/edited-files-button.html`.
- 2026-09-25: this feature's documents live in `docs/edited-files/`, not in `PHASES.md` (Aryan).
- 2026-09-25: built in three phases in one worktree, `edited-files-build`, branched from `edited-files-design` (which holds the design and is rebased on `main` as of `40423ca`).
- Open, decided without asking and changeable: the button's count includes code; `.html` and `.pdf` count as code.

## Log

- 2026-09-25: design agreed; phases written; handoff prompt given to the building agent.

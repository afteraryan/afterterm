# Edited files: phases and status

The execution record for [`design-04-edited-files.md`](design-04-edited-files.md). This file is only about this feature; the repo-wide `PHASES.md` is not used for it. Keep it current as work happens: what had to be done, what is done, what is pending, and every decision with its date.

Rule: finish and polish one phase (unit tests, harness self-test, recordings, fixes) before going deep into the next. Aryan tests once, at the end, in a replica dev build left running for him (see [`testing-and-handoff.md`](testing-and-handoff.md)).

## Status

| Phase | What it contains | Status |
|---|---|---|
| 1 | The Files button and its list, built from Claude's own record: files changed with Claude's tools, subagents' edits, pasted images; the fold rows and the motion | implemented, untested by Aryan |
| 2 | Files Claude changed with a command (`cat >>`, `sed -i`, scripts, `cp`), found by watching the chat's folder while its commands run | pending |
| 3 | File paths in the terminal output become clickable, like web links | pending |
| Handoff | Final self-test of all three together, a replica dev build left running for Aryan, the to-verify entries | pending |

Status words: `pending`, `in progress`, `implemented, untested by Aryan`. Only Aryan marks something `done`, after he has used it.

## Phase 1: the Files button from Claude's record

To do:
- [x] Read a session's changes from its JSONL: every `Edit`, `Write`, `MultiEdit`, `NotebookEdit` tool call (`input.file_path`, entry `timestamp`), whether a `Write` created the file (`toolUseResult.type === "create"`), newest first, one row per path.
- [x] Also read the session's subagent records (`<sessionId>/subagents/*.jsonl` beside the session file).
- [x] Read the pasted images: user-message `image` blocks (base64) with their `[Image #N]` number and timestamp.
- [x] Classify by extension: documents (`.md`, `.mdx`, `.txt`), code (everything else except images), images Claude made are left out.
- [x] Keep the list current: re-read when the hook's file channel reports `UserPromptSubmit` or `Stop`, when a thread is restored, and when the list is opened.
- [x] The header button (stacked-files icon, "N files", no button at zero, kept while asleep).
- [x] The list: Documents rows, the Code fold row, the Images you pasted fold row; folded rows show only label and count; Code starts unfolded when there are no documents; a part with nothing has no row.
- [x] Open a file in VS Code (a new file-opening path; `editors:open` only accepts folders today), open a pasted image in the default app, right-click menu (Open in VS Code, Show in File Explorer, Copy path), Esc and click outside close.
- [x] Motion as in the prototype, off under reduced motion.
- [x] Unit tests for every pure piece; harness self-test with recordings in `docs/screenshots/edited-files-phase-1/`.

Done (2026-09-25):
- `src/session-files.ts` (pure): parses transcript lines into changed files (one row per path, case-insensitive, newest time, New when any Write created it), edit events, pasted images and shell-command windows. Lines that cannot matter are skipped with a substring check before `JSON.parse`. A failed edit (`is_error`) or one still waiting for its result is not listed. `src/session-files-store.ts`: the incremental reader in main, a byte offset per file (the transcript and each subagent file), chunked with a yield between chunks; decodes a pasted image back out of its line on demand. Measured on Aryan's largest transcript (60 MB): 347 ms for the first read, no block over 31 ms, 0 ms after.
- IPC in `main.ts`: `session-files:list`, `:thumb` (a 320 px data URL through `nativeImage`), `:openPasted`, `:pastedPath`; `files:open` (the primary editor, `-g file:line` for VS Code and its forks), `files:openDefault`, `files:reveal` (`explorer /select,`), `app:home`. Every opener logs `[harness] …` instead of launching under the harness.
- `src/renderer/filesView.ts` (pure): the button label, the three parts, the folder labels, the times. `components/FilesButton`: the button, the list (fixed under the button, mounted while the button exists so closing animates), the folds, thumbnails loaded on first unfold, the right-click menu, Esc and outside click.
- `drive files` in the harness; `drive opened` prints `file:` and `reveal:`.
- Tests: `session-files.test.ts` (89), `session-files-store.test.ts` (17), `filesView.test.ts` (36).

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
- 2026-09-25 (builder, open to change): files under Claude Code's own temp folder (`%TEMP%\claude\…`, its scratchpad scripts) are left out of the list. In the design chat 6 of the 9 code rows were scratch scripts.
- 2026-09-25 (builder): one paste that Claude Code logged twice (same `[Image #N]`, same bytes) is listed once. Seen in a real session (#8 twice).
- 2026-09-25 (builder): a file outside the chat's own folder but inside the project's folder shows its folder relative to the project ("docs" for a chat running in `app\`), the same order the design uses to resolve paths; outside both, the full folder with the home folder as `~`.
- 2026-09-25 (builder): the list keeps the prototype's "No documents in this chat yet" line when only code changed (the prototype's "Only code changed" state shows it), rather than no line at all.
- 2026-09-25 (builder): the right-click menu uses the editor's own logo beside "Open in VS Code" and the Explorer folder beside "Show in File Explorer", on the right like the thread and project menus (Aryan asked for their icons during the build). "Copy path" has no icon.
- 2026-09-25 (builder): the Code and pasted folds remember their state per thread until another thread is shown.
- 2026-09-25 (builder, follows the design literally): a chat whose only record is pasted images has no button, so those images are not reachable from the header. Question for Aryan in the handoff.

## Log

- 2026-09-25: design agreed; phases written; handoff prompt given to the building agent.
- 2026-09-25: Phase 1 built and self-tested in the harness on copies of Aryan's real sessions (the design chat: 7 documents, code, 3 pasted images with temp copies; tab-80: 7 pasted images decoded because the temp copies are gone; tab-88: only code, Code unfolded; "Source code extraction from APK": a subagent's document; a 19.5 MB session read in 272 ms; a chat with no changes and a shell: no button; reduced motion). Screenshots 01 to 16 and recordings 01 to 04 in `docs/screenshots/edited-files-phase-1/`. Recording 01 also shows a stray close of the list that could not be reproduced afterwards; a trace left on for the rest of the run caught only closes with a cause.

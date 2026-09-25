# Design 04: the files a chat changed, and clickable file paths in the output

This design answers the bug "There is no list of the files a chat has edited, and no way to open one without a clickable path in the output" in [`bugs.md`](../bugs.md). A chat gets a Files button in its header that lists the documents it changed first, then its code and the images you pasted into it, each folded to a count. Separately, any file path Claude writes in the terminal becomes clickable like a web link.

Status: agreed with Aryan on 2026-09-25 against the pages in `docs/mockups/`. Nothing in the app has changed yet.

## The pages this was agreed against

All in `docs/mockups/`:

- `edited-files-button.html`: **the agreed result**, a clickable prototype of the button and its list with every state, and the open and fold animations.
- `edited-files-variants.html`: the first round. Part 1 is seven proposals made before looking at other tools; Part 2 is five more made after looking at T3 Code, the Codex app, Claude Code's `/diff`, Claude desktop, Conductor, Warp, Zed, VS Code Copilot, Cursor, opencode, Cline, JetBrains and ChatGPT Canvas (each linked on the page).
- `edited-docs-variants.html`: the second round, after Aryan said documents matter more than code: four ways to keep code out of the way (B1 to B4), the button's label, clickable names in the output, and how each kind of change is found.

## What Aryan wants, in his words

The problem is simple: he wants to reach the documents a chat has edited, quickly. Code matters less and should stay out of the way until he asks for it. He does not care about reviewing diffs; IDEs care about that and afterterm is not one.

## Decisions, all taken 2026-09-25

### 1. A Files button in the thread header

The header of a chat gets a pill button left of the state chip: the stacked-files icon (two overlapping pages, the icon used on the first two mockup pages) and the count, "11 files". Nothing else: no breakdown by kind, no thumbnail, no different icon when only code changed. The count is every document and code file the chat changed (pasted images are not counted). No button while the chat has changed nothing. An asleep chat keeps its button, and its list still opens.

### 2. The list: documents first, then code and pasted images, each folded to a count

Clicking the button opens a list under it, newest change first within each part:

1. **Documents** (`.md`, `.mdx`, `.txt`): one row each, with the name, a New tag when the chat created it, the folder, and how long ago.
2. **Code**: everything else the chat changed, folded into one row that shows only "Code" and its count. Clicking it unfolds the code files in place, in smaller type.
3. **Images you pasted**: one row that shows only its label and count. Clicking it unfolds thumbnails, each with its `#N` and the time it was pasted.

A folded row shows no file names or other detail until it is opened. When the chat changed only code, the Code row starts unfolded. A part with nothing in it has no row. Images Claude itself made (screenshots, SVGs) are left out for now.

Clicking a document or code file opens it in VS Code (the detected editor, `editor-detect.ts`) and closes the list; clicking a pasted image opens it full size in the Windows default app. Right-click on a row: Open in VS Code, Show in File Explorer, Copy path. Esc or a click outside closes the list.

### 3. Motion

The list grows out of the button's corner (scale from 0.96 and a 6px drop, fading in, about 220ms on the app's easing) and closes a little faster than it opens (about 140ms). A folded row eases its height open (about 260ms), its chevron turns a quarter, and its rows fade in one after another (about 22ms apart); folding back is quicker. Everything is off under reduced motion. The prototype page has the exact values.

### 4. File paths in Claude's output are clickable

Any file path in the terminal behaves like a web link does today: hovering underlines it, clicking opens it. No buttons are added. This covers the paths in `Write(...)` and `Update(...)` lines, paths inside a `Bash(...)` command, and paths Claude writes in its reply, whether or not Claude Code draws them in purple.

- **Why purple does not help.** Claude writes paths in Markdown backticks; Claude Code draws that inline code in purple and removes the backticks, so afterterm sees only coloured text. Paths are recognised from the text itself.
- **Recognising a path**: text with a `/` or `\`, a drive (`C:\`), `./`, `../`, `~/`, or a name ending in an extension.
- **Resolving it**: absolute as written; relative against the chat's own folder (`threadFolder`, so a worktree chat resolves inside its worktree), then the project's folder; `~` is the home folder.
- **Only real files link.** The path is checked on disk before it is underlined, so a worktree name or a lone `.md` stays plain.
- **A bare name** such as `index.tsx` links only when it matches a file this chat changed. If two changed files share the name, it opens the newest and the hover shows which; afterterm never asks.
- **Each `Update(...)` or `Write(...)` line opens its own file**, matched to its own edit in the chat's record by the time the line appeared, so two files with the same name never get confused.
- **A path split over two lines** (Claude Code breaks long lines itself) is joined when it runs to the right edge and the next line continues it.
- **Where it opens**: markdown and code in VS Code, an image in the default app, a folder in File Explorer.

## Where the files come from

Checked against Aryan's real transcripts on 2026-09-25.

| How the file changed | How afterterm finds it | How sure |
|---|---|---|
| Claude's `Edit`, `Write`, `MultiEdit` or `NotebookEdit` tool | The session's JSONL has `input.file_path` and a `timestamp` on every entry; a `Write` result says `type: "create"` for a new file | Exact |
| A command Claude ran (`cat >>`, `sed -i`, a Python script, `cp`) | Watch the chat's folder while that chat is working; keep a change only if it happened while one of the chat's `Bash`/`PowerShell` tool calls was running (the tool call's time to its result's time) | Very likely |
| A subagent the chat started | The subagent's own JSONL under `<sessionId>/subagents/` | Exact |
| A file outside the chat's folder | Only through Claude's own tools; the folder watch does not reach it | Exact for tools |
| Two chats in one folder, both running a command at that moment | Listed in both | Rare |
| Aryan editing a file himself | Left out: no command of the chat was running | n/a |

Commands matter: in Aryan's longest afterterm chat Claude used `Write` 4 times and ran 38 shell commands that look like they write files. A list built from the tools alone would miss most documents.

The folder watch ignores `node_modules`, `.git`, `out`, `dist` and similar build folders. Files are classified by extension only.

### Pasted images

Every image pasted into Claude Code is stored in the session's JSONL as a user-message `image` block (base64 PNG) next to the `[Image #N]` text, with the entry's timestamp: 75 such images across 26 of Aryan's sessions on 2026-09-25. Claude Code also writes each one to `%TEMP%\claude\<project dir>\<sessionId>\images\<N>.png` (seen in this session; undocumented, and Windows may clear it). Afterterm reads the list from the JSONL, opens the temp file when it exists, and otherwise decodes the image once into `%APPDATA%\afterterm\pasted\<sessionId>\<N>.png` and opens that.

## Rejected, and why

- A panel on the right of the terminal, or a thin strip on the right edge: no ribbons on the other side.
- A row of file chips under the header: disliked.
- Edited files nested under the chat in the sidebar: it disturbs the thread list.
- A full changes panel with diffs, a per-reply grouping, or selecting lines to send to Claude: too much for "open the recent documents".
- A bar along the bottom of the terminal, or a picker that shows the changed lines: IDE patterns; afterterm does not review code.
- A keyboard picker for edited files: not now.
- Asking which file was meant when two share a name: resolved by time and recency instead.
- On the button: a breakdown by kind ("4 docs, 3 images"), a thumbnail of the newest image, a different look when only code changed.
- Images Claude made listed with a picture: second priority, left out for now.
- Any preview text (file names, times) on a folded row.

## Left for later

- A Files tab on the project page across all its chats, which would have to show which worktree each file is in.
- Images Claude made (screenshots, SVGs) in the list.

## Choices made without asking, open to change

- The button's count includes code files, not only documents.
- `.html` and `.pdf` count as code, because documents are only `.md`, `.mdx` and `.txt`.

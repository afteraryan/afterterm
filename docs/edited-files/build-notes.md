# Edited files: build notes

What the building agent needs to know about the code before starting. The design is [`design-04-edited-files.md`](design-04-edited-files.md); status lives in [`phases.md`](phases.md). Everything here was checked against the code and Aryan's transcripts on 2026-09-25; verify before relying on it.

## Where things are today

- **Transcript reading**: `src/claude-transcript.ts`, pure and unit-tested (`claude-transcript.test.ts`). `readTranscriptMeta` reads only the first and last 256 KB (`CHUNK_BYTES`) of a session's JSONL, which is enough for the first prompt and the latest model but **not** for a complete list of changed files. `findTranscript` finds the file by session id across project dirs (a session can move worktree). Main calls it from `readClaudeMeta` behind the `claude-session:meta` IPC (`src/main.ts`, around the `ipcMain.handle('claude-session:meta', …)` handler).
- **When a session's data refreshes**: the hook's per-tab file channel reports the session id and cwd on `UserPromptSubmit` and `Stop`; the renderer sees it through `window.afterterm.claudeSession.onUpdate` and `onMeta` (`src/renderer/app.tsx`, near `applyClaudeMeta`). Restore and wake also read metadata.
- **A thread's folder**: `threadFolder(tab)` in `src/renderer/threadView.ts` (`claudeCwd` over `cwd`), so a worktree chat resolves inside its worktree.
- **Opening things**: `editors:open` (`src/main.ts`) takes a **folder** only (`isUsableFolder`) and launches the detected editor detached; there is no file-opening path yet. `projects:openInExplorer` opens a folder. Both log instead of launching under the harness (`harnessOnlyLogsExternal()`), unless `AFTERTERM_OPEN_EXTERNAL=1`; any new opener must do the same.
- **The header**: `src/renderer/components/Header/index.tsx` and `Header.css`. The dots menu and the state chip are there; the Files button goes left of the state chip.
- **Menus and tooltips**: `src/renderer/components/Menu.tsx` (positioned menu) and `Tooltip.tsx` (`data-tip`).
- **Terminal links**: `src/renderer/components/Terminal/index.tsx` loads `WebLinksAddon` (around line 437) with `shell.openExternal`; file links are a separate `term.registerLinkProvider`.
- **Motion and tokens**: `src/renderer/theme.css` (`--ease`, `--fast`, `--med`, the reduced-motion rule). The prototype's values are in `docs/mockups/edited-files-button.html`.
- **Persisted fields**: none should be needed; the list is rebuilt from the transcript. If one is added, it goes through `sessionMigration.ts`.

## What the transcript looks like

One JSON object per line. Relevant shapes, checked on real sessions:

- Assistant tool calls: `message.content[]` items with `type: "tool_use"`, `name` (`Edit`, `Write`, `MultiEdit`, `NotebookEdit`, `Bash`, `PowerShell`, `Agent`, …) and `input` (`file_path` for the edit tools, `command` for shells). The entry has a `timestamp` (ISO).
- Tool results: user entries with a `toolUseResult`. For `Write`: `{ type: "create" | "update", filePath, content, structuredPatch, … }`. For `Edit`: `{ filePath, oldString, newString, structuredPatch, … }`. The `tool_result` content item carries the matching `tool_use_id`, which gives a shell command's end time.
- Pasted images: user entries whose `message.content[]` has `{ type: "image", source: { type: "base64", media_type: "image/png", data } }`, beside a text item containing `[Image #N]`. 75 across 26 of Aryan's sessions on 2026-09-25.
- Subagents: `<projects dir>/<project dir>/<sessionId>/subagents/agent-*.jsonl`, same format.
- Pasted-image files: Claude Code also writes `%TEMP%\claude\<project dir>\<sessionId>\images\<N>.png` (observed in one session, undocumented; may be cleared by Windows).

## Suggested shape (the builder decides)

- A pure module (for example `src/session-files.ts`) that takes JSONL text and returns `{ changed: [{ path, kind, created, at }], pasted: [{ n, at, mediaType }], shellWindows: [{ start, end }] }`. Paths normalised (case-insensitive on Windows, relative paths resolved against the entry's `cwd`), deduplicated keeping the newest time. Unit-tested with fixture lines modelled on the shapes above.
- Main reads the whole file incrementally: remember the byte offset per session and parse only what was appended, so a long session is not re-read every turn.
- IPC: `session-files:list (sessionId, cwd)` returning the lists; `files:open (path)` opening a file in the detected editor (VS Code) with the same harness guard; `files:openDefault (path)` through `shell.openPath` for an image; `files:reveal (path)` selecting the file in Explorer (`explorer /select,`). A pasted image is decoded on demand to `<userData>\pasted\<sessionId>\<N>.png` when the temp file is gone.
- Phase 2's watcher lives in main (`fs.watch` recursive works on Windows), started while a chat is working and stopped a little after its turn ends; the attribution against `shellWindows` is pure and unit-tested.
- Phase 3's path recogniser and resolver are pure (for example `src/renderer/filePaths.ts`) and unit-tested; the existence check is one batched IPC per rendered line range, cached.

## Things that will bite

- `npm test` lists every test file in `package.json`'s `test` script; add new test files there.
- Never read the whole transcript on the renderer thread, and never block main on a large file: use offsets.
- The harness shares `~/.claude` with Aryan's real Claude Code (the hook lives there). Reading transcripts is fine; never write under `~/.claude/projects`.
- Windows paths in transcripts use backslashes and mixed drive-letter case; normalise before comparing.
- `CLAUDE.md`'s docs list, `docs/to-verify.md` and `CHANGELOG.md` ("Unreleased") get entries in the same change as the code.

# Test report: the header's worktree item and editor button open the worktree top (AFT-45, PR #86)

Tested 2026-11-08 by a separate tester, branch `fix-header-worktree-folder` at c7c0fe1, in the agent harness on the secondary display (`drive bounds`: window at x=2240, DISPLAY2, `primary: false`). The run used its own data dir (`tester-worktree-folder`), port 9355, a scratch `CLAUDE_CONFIG_DIR` and a scratch `AFTERTERM_CLAUDE_PROJECTS_DIR`, and never `--open-external`, so nothing was launched: the main process logged `[harness] projects:openInExplorer <folder>` and `[harness] editors:open <editor> <folder>` instead, and those log lines are the evidence of what would have opened. No source code was changed.

## Result in one line

Every row passed. The header's worktree item, the header's editor button, the sidebar menu and the project page row menu all open the top of the git working tree for a chat in a subfolder of a worktree. The project item and the project menu still open the project root. A shell with no git opens its own folder. A thread whose folder is gone opens nothing and its controls say "Folder not found".

## Fixture

One pinned project "fixture project" (root `D:\Pitara\Work\Tinkering\afterterm`, the main checkout) with seven threads, all asleep, made-up session ids, launched with `--claude-resume all` so `claudeCwd` is kept. No real Claude Code was started. Fixture file: `09-fixture-session.json`.

| Thread | Kind | Its own folder (claudeCwd, else cwd) |
|---|---|---|
| tab-1 | chat | `<worktree>\src\renderer` (this worktree, a linked worktree of the main checkout) |
| tab-2 | shell | a scratch folder with no `.git` anywhere above it |
| tab-3 | chat | a scratch folder that does not exist, no git above it |
| tab-4 | chat | `<worktree>\src\renderer\deleted-subfolder` (missing, inside a live worktree) |
| tab-5 | chat | `<main checkout>\.claude\worktrees\deleted-wt\src` (missing, walks up to the main checkout) |
| tab-6 | shell | `<main checkout>\src\renderer` (plain checkout subfolder) |
| tab-7 | chat | the worktree top itself (control) |

## Rows

| Row | Result | Capture | What was seen |
|---|---|---|---|
| 1a. Chat in a worktree subfolder: header worktree item | Pass | `10-row1-chat-in-worktree-subfolder-header.png`, `11-row1-hover-header-worktree-item.png`, `11-row1-evidence.txt` | Folder is `...\worktree-folder\src\renderer`; clicking the item logged `projects:openInExplorer D:\Pitara\Work\Tinkering\afterterm\.claude\worktrees\worktree-folder` (the top, not `\src\renderer`). |
| 1b. Same chat: header editor button | Pass | `12-row1-hover-header-editor-button.png`, `11-row1-evidence.txt` | Logged `editors:open VS Code ...\worktrees\worktree-folder`. |
| 1c. Same chat: sidebar menu, Open in File Explorer | Pass | `13-row1-sidebar-menu-tab1.png`, `11-row1-evidence.txt` | Log grew by one line, the worktree top. |
| 1d. Same chat: sidebar menu, Open in VS Code | Pass | `13-row1-sidebar-menu-tab1.png`, `11-row1-evidence.txt` | Log grew by one line, the worktree top. |
| 1e. Same chat: header dots menu, Open in File Explorer (extra) | Pass | `14-row1-header-dots-menu.png`, `11-row1-evidence.txt` | The dots menu has the Explorer item and no editor item (by design); it logged the worktree top. |
| 1f. Same chat: project page row menu, both items (extra) | Pass | `49-project-page-thread-row-menu.png`, `49-project-page-row-menu-evidence.txt` | Asleep tab of the project page, right-click on the row: Explorer and VS Code both logged the worktree top. |
| 1g. Control chat at the worktree top (extra) | Pass | `42-control-chat-at-worktree-top-header.png`, `41-row3b-and-control-evidence.txt` | Worktree item and editor button both logged the worktree top. |
| 2a. Header project item | Pass | `15-row2-hover-header-project-item.png`, `15-row2-evidence.txt` | On the tab-1 chat, clicking the project item logged `projects:openInExplorer D:\Pitara\Work\Tinkering\afterterm` (the project root). |
| 2b. Project menu, Open in File Explorer | Pass | `16-row2-project-menu.png`, `15-row2-evidence.txt` | Logged the project root. |
| 2c. Project menu, Open in VS Code (extra) | Pass | `15-row2-evidence.txt` | Logged `editors:open VS Code D:\Pitara\Work\Tinkering\afterterm`. |
| 3a. Shell at a folder with no git: sidebar menu, header editor button | Pass | `20-row3-shell-no-git-header.png`, `21-row3-evidence.txt` | The header has no branch or worktree item; the sidebar Explorer item, the sidebar VS Code item and the editor button each logged the scratch folder itself. |
| 3b. Shell in a plain checkout subfolder (extra, the orchestrator's ruling) | Pass | `40-row3b-shell-in-plain-repo-subfolder-header.png`, `41-row3b-and-control-evidence.txt` | `<main checkout>\src\renderer` opens `D:\Pitara\Work\Tinkering\afterterm`, the top of the checkout: editor button, sidebar Explorer item and sidebar VS Code item. |
| 3c. Live shell that cds (extra) | Pass | `44-row3b-live-shell-cd-changes-what-opens.mp4`, `46-row3b-live-shell-after-cd-to-no-git-folder.png`, `47-row3b-live-shell-after-cd-into-worktree-subfolder.png`, `48-row3b-live-shell-after-cd-into-main-checkout-src.png`, `45-row3b-live-shell-evidence.txt` | Woke the cmd shell (tab-6), then typed three `cd` commands. After cd to the no-git folder the branch left the header and the editor button logged that folder (a stale top is not reused). After cd into `<worktree>\src\renderer` the worktree item appeared and both it and the editor button logged the worktree top. After cd into the main checkout's `src` the editor button logged the main checkout top. |
| 4a. Chat whose folder is gone, no git above it | Pass | `30-row4a-chat-folder-gone-header.png`, `32-row4a-sidebar-menu-disabled-items.png`, `31-row4-evidence.txt` | Editor button is the dimmed span with tip "Folder not found"; sidebar menu items Open in File Explorer and Open in VS Code are disabled with the same tip; clicking all of them left the log unchanged (no launch). |
| 4b. Chat in a deleted subfolder of a live worktree (extra) | Pass | `33-row4b-deleted-subfolder-in-live-worktree-header.png`, `31-row4-evidence.txt` | The worktree item, editor button and both menu items are disabled with "Folder not found"; clicking them logged nothing. The git read still finds the worktree above the missing folder, so this is the case the missing-folder guard exists for. |
| 4c. Chat in a deleted worktree whose path walks up to the main checkout (extra) | Pass | `34-row4c-deleted-worktree-header.png`, `31-row4-evidence.txt` | Editor button and both menu items disabled with "Folder not found", nothing logged. The guard stops the controls resolving to the main checkout above the deleted worktree. |

Every row above also has its click lines in `43-harness-log-all-harness-lines.txt` (every `[harness]` line of the run, among them the 22 Explorer and editor open lines, in order). Between each pair of clicks the number of log lines was counted, so a click that should open nothing is shown to add zero lines.

## Unit tests

`npm test` in the worktree: exit 0, 35 test files, 2965 passed, 0 failed (the sum of every file's "N passed, M failed" line). The `threadFolderTarget opens the top of the git working tree (AFT-45)` section is in the output and passes.

## Observations (not failures)

1. Row 4b: when a chat's subfolder is deleted but its worktree still exists, both controls are disabled, so nothing opens even though the worktree itself could be opened. This is what the plan says ("a chat whose folder no longer exists: nothing opens, the buttons say the folder is missing"). If Aryan would rather the worktree top still opens in that case, that is a design change, not a bug in this fix.
2. Row 4c, not caused by this fix: the header of a chat in a deleted worktree shows the main checkout's branch (`manual-testing-fixes`), because the git read walks up from the missing path to the main checkout. That is how `src/git-info.ts` already worked.
3. The header's dots menu has Open in File Explorer but no editor entry. That is the existing design.

## What was not tested

- A chat that is awake with a real Claude Code moving into a subfolder (no real Claude was started, by the rules). Every chat here was asleep, so its `claudeCwd` came from the seeded session, not from a live transcript. The awake path for a shell was tested (row 3c).
- Real Explorer or VS Code launches: the harness logs them instead of launching, so what was checked is the folder handed to main, not the program that opens.
- Git Bash and WSL shells, and a worktree on a different drive.
- A click in the first moments after launch, before the first git read has filled the top. The code works the target out again at the click, but that moment was not exercised.

## Implementer's captures (00 to 06), what each shows

- `00-test-results.txt`: the implementer's own results, read only after this run. It lists five threads and what each control opened. Its folders and outcomes match what this run found.
- `01-chat-in-worktree-subfolder-header.png`: the header of the chat "Chat in a worktree subfolder" in the project "Worktree test project": model Opus 5, branch `fix-header-worktree-folder`, the worktree item `.claude\worktrees\worktree-folder`, the VS Code button, an "Asleep 2h" chip and a Wake button, with five asleep threads in the sidebar.
- `02-header-buttons-open-the-worktree-top.mp4`: a 204 second screen recording of the same window. It shows the hover on the worktree item with its "Open in File Explorer" tip, then the thread's right-click menu open for a long stretch, then the "Chat whose folder was deleted" thread with the "Folder not found" tip. A click that opens a folder changes nothing on screen, so the video cannot show what opened; the log lines carry that.
- `03-chat-in-subfolder-hover-worktree-item.png`: the pointer on the worktree item, which is underlined, with the tip "Open in File Explorer".
- `04-chat-in-subfolder-sidebar-menu.png`: the right-click menu on that chat: Wake, Mark as unread, Move to project, Open project page, Open in File Explorer, Open in VS Code, Rename, Close.
- `05-chat-with-deleted-folder-buttons-disabled.png`: the chat "Chat whose folder was deleted", with the worktree item and the VS Code button dimmed and the tip "Folder not found".
- `06-shell-in-repo-subfolder-header.png`: the header of "Shell in a subfolder of the main checkout": project and branch `manual-testing-fixes`, no worktree item, and the VS Code button with its "Open in VS Code" tip.

## Real Claude files

Hashes of `C:\Users\Aryan\.claude\settings.json` and `C:\Users\Aryan\.claude\hooks\afterterm-notify.ps1`, before the first launch, after the launch, and after stopping the harness and running `npm test`. All matched the expected values each time.

| File | Before | After |
|---|---|---|
| `settings.json` | `2CBF2BE4E19D4BC064091C306D676F5BD3A73A344D761D677C61BB4E75126919` | `2CBF2BE4E19D4BC064091C306D676F5BD3A73A344D761D677C61BB4E75126919` |
| `hooks\afterterm-notify.ps1` | `21A8E8A0A170955FB4E1760E49020DC22FE2261CA1C45DAAAB3173E3E668633B` | `21A8E8A0A170955FB4E1760E49020DC22FE2261CA1C45DAAAB3173E3E668633B` |

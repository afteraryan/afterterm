---
description: Record a bug Aryan found during manual testing, with its screenshots, in docs/bugs.md and docs/screenshots/manual-testing/, then commit and push
---

Record the bug described below in the repo, exactly the way `docs/bugs.md` and `docs/screenshots/README.md` say bugs are kept. Do not fix it, do not touch any source file, do not ask questions unless the description is unusable.

**No causes.** Write nothing about causes. Some older entries in `docs/bugs.md` have one; new entries do not.

Bug report from Aryan: $ARGUMENTS

Steps, in order:

0. **Get onto `manual-testing-fixes` first, before writing anything.** Bugs are only ever recorded on that branch, never on the branch you happen to be working on. Check `git branch --show-current`. If it is not `manual-testing-fixes`, do not stop and do not ask: go to the checkout that has it and come back afterwards.
   - Find it with `git worktree list` (usually the repo root, `D:\Pitara\Work\Tinkering\afterterm`).
   - If this session is inside a worktree it entered with EnterWorktree, leave with `ExitWorktree` (`action: "keep"`, never `remove`), which lands in the repo root. If the branch is checked out in another worktree instead, switch with `EnterWorktree` and that `path`.
   - Pull, do steps 1 to 3 there, then return to the worktree you were in with `EnterWorktree` and its `path`, and say in the reply that you did.

1. **Screenshots.** Every image attached to this message appears in the prompt as `[Image #N]` followed by `[Image: source: <path>]`. Copy each source file into `docs/screenshots/manual-testing/` under the next free two-digit number (look at the folder first: files are `NN-<what-it-shows>.png`, take the highest NN plus one, keep the file's own extension). The name after the number says what the screenshot shows, plainly and literally, in kebab-case (for example `03-project-page-history-tab-empty-after-close.png`). Never overwrite or delete anything in that folder.

2. **The entry.** Append to `docs/bugs.md` (after a `---` separator, matching the existing entries) a section with:
   - A plain, literal heading that states the defect (what is wrong, where), not a teaser.
   - An `**Observed:**` line with today's date (`YYYY-MM-DD`) and "by Aryan during manual testing", the `**Phase:**` the feature belongs to (find it from `PHASES.md` and the phase sections of `CLAUDE.md`: Phase 1 is the visual system, sidebar and toast cards, 1.1 the title bar and close x, 2 Home, project page, chooser and palette, 3 thread identity and the hover card, 4 sleep, wake, history and the tail, 5 servers, 6 shell integration; use "pre-existing" when it predates the redesign), `**Status:** open`, a `**Severity:**` (low for cosmetic, medium when a feature misbehaves, high when something is lost or broken), and a `**Screenshot:**` path per saved image.
   - `**What happens:**` in Aryan's words, tidied, with what he expects instead when he said so.
   - `**Steps to make it happen again:**` as numbered steps when they follow from what Aryan said, otherwise "Not known yet; seen as described above."
   - `**Evidence:**` everything Aryan gave: the screenshots (each with a line on what it shows), exact text he quoted, times, thread or project names. Write "Only the description above." when there is nothing more.
   No em dashes anywhere. Headings plain. No abbreviations such as "repro".

3. **Commit and push** on `manual-testing-fixes`: `git add docs/bugs.md docs/screenshots/manual-testing`, a commit message `docs: log <short bug title> from manual testing (Phase N)` ending with the attribution block this session uses, then `git push`.

4. Reply in a few lines: the heading you used, the phase, the screenshot path(s), the commit hash, and the worktree you returned to if you moved. Nothing else.

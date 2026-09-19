---
description: Record a bug Aryan found during manual testing, with its screenshots, in docs/bugs.md and docs/screenshots/manual-testing/, then commit and push
---

Record the bug described below in the repo, exactly the way `docs/bugs.md` and `docs/screenshots/README.md` say bugs are kept. Do not fix it, do not touch any source file, do not ask questions unless the description is unusable.

Bug report from Aryan: $ARGUMENTS

Steps, in order:

1. **Screenshots.** Every image attached to this message appears in the prompt as `[Image #N]` followed by `[Image: source: <path>]`. Copy each source file into `docs/screenshots/manual-testing/` under the next free two-digit number (look at the folder first: files are `NN-<what-it-shows>.png`, take the highest NN plus one, keep the file's own extension). The name after the number says what the screenshot shows, plainly and literally, in kebab-case (for example `03-project-page-history-tab-empty-after-close.png`). Never overwrite or delete anything in that folder.

2. **The entry.** Append to `docs/bugs.md` (after a `---` separator, matching the existing entries) a section with:
   - A plain, literal heading that states the defect (what is wrong, where), not a teaser.
   - An `**Observed:**` line with today's date (`YYYY-MM-DD`) and "by Aryan during manual testing", the `**Phase:**` the feature belongs to (find it from `PHASES.md` and the phase sections of `CLAUDE.md`: Phase 1 is the visual system, sidebar and toast cards, 1.1 the title bar and close x, 2 Home, project page, chooser and palette, 3 thread identity and the hover card, 4 sleep, wake, history and the tail, 5 servers, 6 shell integration; use "pre-existing" when it predates the redesign), `**Status:** open`, a `**Severity:**` (low for cosmetic, medium when a feature misbehaves, high when something is lost or broken), and a `**Screenshot:**` path per saved image.
   - `**What happens:**` in Aryan's words, tidied, with what he expects instead when he said so.
   - `**Repro:**` as numbered steps when they can be inferred, otherwise "as observed; repro not yet known".
   - `**Cause:**` only what a quick look at the code shows (grep the component or CSS named by the feature, read the rule or function involved, name the file). One or two sentences with a fix direction. Say "not investigated" if you cannot find it in a couple of minutes; do not guess.
   No em dashes anywhere. Headings plain.

3. **Commit and push** on the current branch (it should be `manual-testing-fixes`; if it is not, say so and stop before committing): `git add docs/bugs.md docs/screenshots/manual-testing`, a commit message `docs: log <short bug title> from manual testing (Phase N)` ending with the attribution block this session uses, then `git push`.

4. Reply in a few lines: the heading you used, the phase, the screenshot path(s), the commit hash. Nothing else.

---
description: Record a bug Aryan found during manual testing as an issue in Linear's afterterm project, with its screenshots
---

Record the bug described below as an issue in Linear, the way `CLAUDE.md` ("All work is tracked in Linear") says issues are kept. Do not fix it, do not change any file in the repo, do not commit, and do not ask questions unless the description is unusable. If the Linear tools do not load, tell Aryan and stop; do not fall back to `docs/bugs.md`.

**No causes.** Write nothing about causes.

Bug report from Aryan: $ARGUMENTS

Steps, in order:

1. **Look for an existing issue.** Use `list_issues` with project `afterterm`, a `query` on the bug's main words and `includeArchived: true`.
   - The same bug, still open: add what is new as a comment with `save_comment`, including any screenshots from step 2. Do not create a second issue.
   - The same bug in "Fixed, check it": the fix did not hold. Move it back to Todo and put Aryan's words in a comment.
   - The same bug in "Done": it is a new issue. Carry on to step 3, and link the old issue with `relatedTo`.
   - Otherwise carry on to step 3.

2. **Screenshots.** Every image attached to this message appears in the prompt as `[Image #N]` followed by `[Image: source: <path>]`. Open each one first. If it shows another person, a video call or a personal window, leave it out and say so in the reply: Aryan decides whether a cropped copy is wanted. For the rest, strictly one at a time:
   - Call `prepare_file_upload` with a filename that says plainly what the image shows in kebab-case, its content type and its exact size (`wc -c`).
   - Straight away, PUT the file with curl, sending every returned header unchanged. The URL expires after 60 seconds.
   - Keep the markdown it returns.

   Screenshots go on the issue. They no longer go in `docs/screenshots/manual-testing/`.

3. **The issue.** Call `save_issue` with team `Afteraryan builds`, project `afterterm`, and:
   - **title:** short, plain and literal: it states the defect (what is wrong, where), not a teaser.
   - **state:** `Todo`, unless Aryan has to choose or design something first (`Needs your decision`), or nobody knows how to make it happen again (`Backlog`).
   - **priority:** `2` when something is lost or broken, `3` when a feature misbehaves, `4` when it is cosmetic or a request.
   - **labels:** `Bug` or `Feature`, plus one label from the Area group listed in `CLAUDE.md`. If none fits, add one to the group with `save_issue_label` and say so in the reply.
   - **description**, in this order:
     - `**Observed:**` today's date (`YYYY-MM-DD`) and "by Aryan during manual testing".
     - `**Phase:**` the feature's phase (`docs/phases-01-projects-and-threads.md`: Phase 1 is the visual system, sidebar and toast cards, 1.1 the title bar and close x, 2 Home, project page, chooser and palette, 3 thread identity and the hover card, 4 sleep, wake, history and the tail, 5 servers, 6 shell integration), "pre-existing" when it predates the redesign, or "none" for a new feature.
     - `**Severity:**` low, medium or high, with the reason in brackets.
     - `## What happens`: in Aryan's words, tidied, with what he expects instead when he said so.
     - `## Steps to make it happen again`: numbered steps when they follow from what he said, otherwise "Not known yet; seen as described above."
     - `## Evidence`: everything Aryan gave: each screenshot with a line on what it shows, exact text he quoted, times, thread or project names. Write "Only the description above." when there is nothing more.
     - `## Screenshots`: the markdown from step 2, when there are any.

   No em dashes anywhere. Headings plain. No abbreviations such as "repro".

4. Reply in a few lines: the issue id with its link, its status, priority and area, and how many screenshots it has. Say so if you left a screenshot out or added to an existing issue. Nothing else.

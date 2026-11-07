---
description: Work on afterterm's Linear issues by id (for example /fix-tasks AFT-27 AFT-34): marks them In Progress, does the work in a worktree, self-tests it and moves them to Fixed, check it
---

Work on these Linear issues in one thread: $ARGUMENTS

Follow "All work is tracked in Linear" in `CLAUDE.md` throughout. If the Linear tools do not load, tell Aryan and stop.

1. **No ids given:** list the Todo issues in project `afterterm`, highest priority first, ask which ones to take, and stop.

2. **Read each issue:** `get_issue`, `list_comments` for its discussion, and `extract_images` on its description for the screenshots.

3. **Check each one can be started.** Start the ones that can, and tell Aryan about the rest:
   - Todo: start it.
   - Backlog: it waits for a reproduction, or Aryan put it off. If it waits for a reproduction, try to reproduce it first; if you cannot, say so in a comment and leave it where it is.
   - Needs your decision: do not start it. Put the question to Aryan.
   - In Progress: another session may be on it. Read its latest comment and ask Aryan before taking it.
   - Fixed, check it, Done or Canceled: say so and ask what he wants.

4. **Mark it started, before any other work:** move each issue to In Progress with `save_issue`. Then enter a worktree with the EnterWorktree tool and comment on each issue with what you are about to do, the worktree, the branch and the session id (`$CLAUDE_CODE_SESSION_ID`).

5. **Do the work the usual way.** Read the `docs/features-*.md` file named in `CLAUDE.md` for the area first. Then the fix, unit tests (`npm test`), and a self-test on the real app through the agent harness (`scripts/agent-harness/README.md`), with captures and recordings kept in `docs/screenshots/<short-name>/`. Add a line to `CHANGELOG.md` if Aryan would notice the change, and open a PR that names the issue ids in its title. Never close or rebuild the running afterterm.

   Keep each issue current as you go: a short comment at each new stage (cause found, plan agreed, PR opened, self-test passed). If you find something only Aryan can decide, move the issue to Needs your decision with the question in a comment.

6. **When it is finished and self-tested,** move each issue to Fixed, check it, with a comment: what changed, the PR, where he can try it (the release, or the replica dev build from `docs/agent-workflow/replica-and-build-swap.md`), and numbered steps to check it. Never move an issue to Done: only Aryan does that.

   **If you stop before that,** comment where it stands and what is next, and move it back to Todo if nobody will carry on.

7. Reply with one line per issue: its id, its status, the PR, and where to try it.

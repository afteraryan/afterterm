# Fable orchestration: how a Fable session runs a round of work through agents

Read this whenever a Fable session orchestrates work on afterterm. Written 2026-11-08 from the restart window and hook fixes round (PR #81), which these rules come from.

## The orchestrator does not write code and does not test

- The Fable session plans, briefs agents, checks evidence, decides and reports.
- It writes no code and runs no tests, no harness and no app itself.
- It may read files, diffs, logs and captures, and run small read-only checks (hash a file, `git log`, `gh pr view`).
- Docs and commits may be done by the orchestrator or by an agent.
- Every Agent call names a model: Sonnet, Opus or Haiku. Never Fable, never `subagent_type: fork` (a fork inherits Fable), never the Workflow tool.
- Opus: main-process work, state across several files, every review, anything that drives a real Claude Code.
- Sonnet: bounded code with a clear spec, unit tests, docs, merges, PRs, Linear bookkeeping.
- Haiku: mechanical checks and listings.
- One agent at a time edits the worktree.
- Never run an implementer while a tester has a thread awake: a code edit hot-reloads the harness terminals.
- Read-only agents (reviewers, capture checkers) may run beside others.

## Before the first stage

- Read the rules on `origin/main` (the CLAUDE.md there), not the branch's copy, and look for rules newer than the plan.
- Merge `origin/main` into the branch before the docs stage and again before the PR.
- Hash the real `~/.claude/settings.json` and `~/.claude/hooks/afterterm-notify.ps1` at the start. Have testers re-hash after every launch, and stop everything if a hash changes.
- Enter a worktree with EnterWorktree.
- Copy `node_modules` from a sibling worktree when `package-lock.json` matches.
- Run `npm test` for a baseline.

## Every brief carries

- The worktree path and branch, and "check the branch and a clean tree before changing anything".
- The writing rules: plain headings, no em dashes.
- The attribution lines.
- "Never close, restart or build over Aryan's running afterterm."
- For testers, the harness rules:
  - `--data-dir` named for the task on every call.
  - Secondary display, with the bounds checked.
  - One driver per instance.
  - `--env CLAUDE_CONFIG_DIR=<scratch>`.
  - Never seed `claudeNotifications`.
  - No real session ids.
  - Confirm the active thread and read the screen before every keystroke.
  - Never press Continue on Claude's "Teach auto mode" panel.
- The plan section for this stage, the files to read, and "report short: what changed, the evidence and where it is; long output goes in files".
- An agent knows only what the brief says. Rules that live in memory or in the orchestrator's head must be written into the brief.

## Quality gates

- "It works" is not evidence. Evidence is a diff, test output, a capture or a recording. Open some of it yourself.
- After each implementation stage:
  - The implementer commits and shows the `npm test` output.
  - A separate Opus reviewer gets the diff and the plan section, not the implementer's summary.
  - Findings go back to the implementer.
  - Re-review until a round returns zero real findings. A short confirm is enough for a small follow-up.
- The orchestrator decides the judgement calls a reviewer raises and states the decision in the next brief. A decision that turns out wrong is reverted openly.
- A tester never fixes. An implementer never tests its own change.
- Every test row gets a named capture or recording. A separate agent opens every capture. The orchestrator opens a fixed set itself.
- Prove what the plan marks as read, not run.
- Say plainly what cannot be tested and why (WSL not installed, a login a scratch folder cannot have).
- Before the PR, a fresh Opus audit of the whole diff against the plan, then a short re-audit after the fixes it caused.

## Process

- Prepare the next brief while an agent runs. Spawn nothing that depends on an unfinished result.
- Continue an agent with SendMessage when it already has the context. Start a fresh one for an independent read.
- A denied action is reported, never routed around. Ask Aryan when the permission mode allows.
- Agents may sign commits with their own model's Co-Authored-By line. Do not spend a round changing it.

## The report to Aryan

- What was built.
- Which test rows passed and which failed.
- What could not be tested, and why.
- What changed from the plan, and why.
- The review findings that were fixed.
- The PR link.
- Who did each stage.
- Anything left undone, said plainly as not done.

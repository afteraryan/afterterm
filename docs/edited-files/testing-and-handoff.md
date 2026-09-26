# Edited files: testing, and the build left for Aryan

How the building agent tests each phase, and what it leaves running for Aryan at the end. Status lives in [`phases.md`](phases.md).

## Rules that always apply

- Never close, restart or rebuild Aryan's running afterterm; never run `npm start`, `npm run build` or `npm run release` in the main checkout. Dev builds only through the agent harness (`scripts/agent-harness/README.md`).
- Every window goes on the secondary display: launch with `--display secondary` and check `drive bounds` (`onDisplay.primary: false`) before any click or screenshot.
- One driver per harness instance: a subagent must not drive the instance the orchestrator is driving.
- Screenshots and recordings go in `docs/screenshots/edited-files-phase-<N>/`, numbered, named for what they show, never deleted. Record every driven flow with `drive record start --out …mp4` and `record stop`.
- Self-tests never use `--open-external`, so nothing launches on a screen; opening is checked through the `[harness]` log lines.
- The Files list needs a thread's `claudeSessionId`, which the harness's default `--claude-resume none` strips. To test on real sessions, seed with `--claude-resume background` or `all`, and **never Wake** a thread bound to a real session: waking runs `claude --resume` on it, and a session Aryan has open in his live app must not be resumed twice (see the harness README's safety rule). Reading a transcript never needs a wake; an asleep thread's button and list must work anyway.
- A new chat the agent starts in the dev build (for Phase 2) runs in a scratch project folder, not in a real repo.

## What each phase must prove

Phase 1:
- A chat with documents and code changes: the button shows the right count; the list opens with the animation; Documents newest first; the Code row shows only its count and unfolds; a click opens the file (harness log line); right-click menu works; Esc and click outside close.
- A chat with only code changes: the Code row starts unfolded.
- A chat with pasted images: the Images you pasted row, thumbnails on unfold, a click opens the image (the temp file, or the decoded copy when the temp file is missing).
- A chat with nothing changed: no button. An asleep chat: the button and list still work.
- A chat whose subagent wrote a document: it is listed.
- Reduced motion: no animation (`drive emulate-media`).
- A long real session: the list is correct and reading it does not stall the app.

Phase 2:
- In the dev build, a real Claude chat in a scratch project writes a markdown file with a shell command (`cat >`, `Set-Content`): it appears in the list after the turn.
- A file you (the agent) change in that folder while the chat is idle is not listed.

Phase 3:
- Paths in `Write(...)`, `Update(...)`, inside `Bash(...)`, and in plain reply text underline on hover and open on click; relative paths resolve in a worktree chat; a worktree name and a lone `.md` stay plain; two changed `index.tsx` files each open their own; a path split over two lines links whole.

## The replica dev build left for Aryan

After the final self-test, leave a dev build running for Aryan, following `docs/agent-workflow/replica-and-build-swap.md` ("A replica dev build for Aryan"): a throwaway data dir seeded with a copy of his `session.json`, `prefs.json` and thread tails, launched with `--claude-resume all --open-external --display secondary`. His real `%APPDATA%\afterterm` is never pointed at. Leave it running; do not stop it when done.

Make sure the replica lets him see every case without work on his part:
- Find sessions in his transcripts that have, between them: documents and code changed, only code changed, pasted images (with the temp file present and with it missing), a subagent's document, and command-made markdown. A small script over `~/.claude/projects/*/*.jsonl` finds them.
- If his session copy has no thread bound to such a session, add one to the copied `session.json` only (a restored, asleep chat thread with that `claudeSessionId` and `claudeCwd`, in the right project), never to his real file.
- Tell him, in the final message, which thread shows which case, the data dir, and that it is a copy.

## What goes in the repo with the code

- `docs/to-verify.md`: one entry per change he will notice, with numbered steps that name the replica's threads.
- `CHANGELOG.md` under "Unreleased", at feature level.
- `CLAUDE.md`: the file-structure entries for new files, and a short "How the app works today" paragraph for edited files pointing at `docs/edited-files/`.
- `phases.md`: status, done items ticked, decisions with dates, a Log line per phase naming the recordings.

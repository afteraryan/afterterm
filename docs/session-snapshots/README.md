# Session snapshots

Point-in-time captures of which afterterm tabs / Claude Code sessions were open, in
which project, on a given date. One file per snapshot, named `YYYY-MM-DD.md`.

## What these are — and are NOT

- **Derived, not authoritative.** The live source of truth is the running app's
  `%APPDATA%\afterterm\session.json`. A snapshot is a frozen, human-readable copy of
  that file at one moment. It is **stale the instant it's written** — afterterm
  rewrites `session.json` every ~2s and on close.
- **Machine-local.** They contain this machine's absolute paths and Claude session
  UUIDs, so the dated files are **git-ignored** (see root `.gitignore`). Only this
  `README.md` is tracked, so the *convention* lives in the repo even though the
  *contents* don't.

## Why snapshots exist (the lesson that created this folder)

Windows ConPTY can't be reconnected after an app restart, and `session.json` gets
overwritten continuously — so if you want to be able to **re-open the exact set of
Claude sessions you had on some past day**, you need a frozen record. The one thing
that makes a snapshot *restorable* rather than just nostalgic is the **Claude session
UUID** per tab: `claude --resume <uuid>` only works if you kept the UUID. An early
snapshot saved session *names* but no UUIDs, which made recovery painful — so the
generator now always records UUIDs.

## Make a fresh snapshot

```powershell
node scripts/snapshot-sessions.js
```

Writes `docs/session-snapshots/<today>.md` from the live `session.json`, including each
Claude tab's UUID, cwd, and group. Pass a path to snapshot a different session file:

```powershell
node scripts/snapshot-sessions.js "C:\path\to\some\session.json"
```

## Restoring sessions from a snapshot

Each Claude entry lists its `claude --resume <uuid>` command and cwd. To bring a whole
past layout back, the robust path is to rebuild a `session.json` that re-adds those
tabs (with their `claudeSessionId` + `claudeCwd`) and let afterterm lazily resume them
on next launch. The transcripts themselves live in `~/.claude/projects/<slug>/<uuid>.jsonl`
and survive independently of `session.json`.

## Gotchas

- **Trust the group cwd, not the per-tab cwd.** cmd.exe sets a console title that looks
  path-like but is garbage ("title poison"); a tab's own `cwd` may be that artifact.
  The group's saved cwd is the reliable project directory.
- **Counts can drift from reality.** A snapshot reflects the moment it was taken; tabs
  opened/closed afterward won't be in it.

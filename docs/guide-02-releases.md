# Versioning & releases

How afterterm builds are versioned, and how to cut a new release. This is the
canonical process — follow it so every build is traceable to a commit.

## Version scheme — semver `MAJOR.MINOR.PATCH`

`package.json` `"version"` is the single source of truth. Bump the **leftmost**
digit that applies, and reset the ones to its right to 0:

| Bump | When | Example |
|---|---|---|
| **PATCH** (`Z`) | backward-compatible **bug fix** only | spinner fix → `0.5.0` → `0.5.1` |
| **MINOR** (`Y`) | **new feature**, nothing broken | session resume → `0.4.1` → `0.5.0` |
| **MAJOR** (`X`) | **breaking change** (incompatible `session.json`, removed feature, redesign) | → `1.0.0` |

afterterm is in **`0.x`** = pre-stable: anything may change, and breaking changes
usually just bump MINOR. Move to `1.0.0` only when it's "stable enough to hand a
stranger." Mnemonic: **break it → X, add to it → Y, fix it → Z.**

### Version lineage

`git tag -l -n1` is the authoritative list (this table is a convenience that can lag):

| Tag | Milestone |
|---|---|
| `v0.1.0` | Initial — terminal + Chrome-style tab groups |
| `v0.2.0` | Notification system (toasts, overlay, tab glow, spinner) |
| `v0.3.0` | Terminal conveniences (links, find, zoom, right-click, drag-drop) |
| `v0.4.0` | Bundled Claude notify hook + self-install + shareable installer |
| `v0.4.1` | Terminal fit debounce |
| `v0.5.0` | Claude session resume + auto-capture (+ lazy resume, versioning tooling) |
| `v0.6.0` | Titlebar branding — icon + name + version badge |
| `v0.7.0` | Sidebar: restorable-session ✳ marker + bottom padding |
| `v0.8.0` | Project groups: new/edit group modal + Projects shelf for groups with no terminals |
| `v0.8.1` | Session capture gated to real user turns (daemon spare sessions no longer hijack a tab) |

(`v0.1.0`–`v0.4.1` were backfilled onto the existing history; releases from `v0.5.0` on were cut with `npm run release`.)

## Cutting a release

```powershell
# 1. Decide + bump the version in package.json (one line edit) and commit it.
# 2. From the MAIN repo checkout (so output lands in the standard out\ folder):
npm run release           # builds portable folder + out\afterterm-<version>-setup.exe, tags vX.Y.Z
git push origin vX.Y.Z    # publish the tag
gh release create vX.Y.Z out\afterterm-<version>-setup.exe --title "afterterm X.Y.Z" --notes "..."
```

`npm run release` (`scripts/release.js`) **refuses** to run if the version is already
tagged — the guard against shipping a stale build under an old number. Bump first.

**Two notes for whoever cuts it:**
- **Where you build from matters.** Run from the main repo checkout so the build lands
  in `D:\Tinkering\afterterm\out\` (the standard folder). If you build from a temporary
  git worktree, its `out\` is elsewhere — move `afterterm-win32-x64\` + the installer
  into the standard folder afterward (preserving the prior build as `afterterm-old-<ts>`).
- **A Claude Code session can't push the version-bump commit straight to `main`** — the
  auto-mode classifier blocks direct pushes to the default branch. Open a one-line bump
  PR, merge it, then run the release. Aryan running it locally can just commit to `main`.

## Artifacts & what's preserved

- **`out/afterterm-win32-x64/`** — the portable folder, the build you actually run.
  It's overwritten each build (the *current* build), not archived.
- **`out/afterterm-<version>-setup.exe`** — the **versioned installer** (~67 MB
  self-extracting). This is the archival artifact: keep these / attach them to the
  **GitHub Release** for the tag. The installer regenerates the folder, so there's
  no need to archive the 200 MB folders.
- **Git tag `vX.Y.Z`** — ties the release to the exact commit. The real identity of
  a build is its tag/commit, not the folder name.

## Quick dev build vs release

- **`npm run build`** (`scripts/build.js`) — fast, zero-downtime dev build. Overwrites
  `afterterm-win32-x64` (renaming any running build out of the way). No version stamp,
  no tag. Use while iterating.
- **`npm run release`** — the versioned, tagged, distributable build. Use to ship.

## Where the build runs from

The portable `afterterm-win32-x64` folder is self-contained — move it anywhere and
run `afterterm.exe`. (Session state in `%APPDATA%\afterterm` is shared across builds,
so your tabs/sessions carry over — and Claude sessions auto-resume.)

**Updating in place requires the app to be closed.** `npm run build` moves the current
build aside and writes a fresh one, but that rename fails while afterterm is running
from that folder, and `npm run release` refuses outright (`make-shareable.ps1`'s guard).
A running `.exe` does not block its own folder being renamed; a process whose *current
directory* is that folder does, and launching `afterterm.exe` from Explorer or a pinned
taskbar shortcut sets exactly that. So in practice: close it, build, reopen.

**To cut a release without closing the app**, build from a separate copy whose `out\` is
a different path:

```powershell
git worktree add --detach .claude\worktrees\release-build <commit>
# copy node_modules in (robocopy /E /MT:16), then from that worktree:
npm run release
```

The tag lands in the shared repo either way. Afterwards copy
`out\afterterm-<version>-setup.exe` into the main checkout's `out\`, and swap the built
`afterterm-win32-x64` folder in whenever the app is next closed. `v0.8.0` and `v0.8.1`
were both cut this way.

// Reading the git branch and worktree for a folder, without running git.
//
// A thread shows the branch it is on and, when it runs in a linked worktree, which
// worktree folder that is. Spawning `git` per thread on a poll is far too expensive
// on Windows, and everything needed is in two small files:
//
//   <repo>/.git/HEAD                                for an ordinary checkout
//   <worktree>/.git                                 a file: "gitdir: <path>"
//   <repo>/.git/worktrees/<name>/HEAD               a linked worktree's own HEAD
//
// So this walks up from the cwd looking for a .git entry and reads at most two files.
// It never throws and never runs a process, so it is safe on a slow poll for every
// live thread. The fs is a parameter so the tests can hand it a fake tree.

import nodeFs from 'node:fs';
import path from 'node:path';

/** The subset of node's fs that gitInfo uses. */
export interface GitFs {
  existsSync(path: string): boolean;
  statSync(path: string): { isDirectory(): boolean };
  readFileSync(path: string, encoding: 'utf-8'): string;
}

export interface GitInfo {
  /** The branch name, or a short commit hash when HEAD is detached, or null. */
  branch: string | null;
  /** The worktree folder relative to the main repo, or null when this is not a worktree. */
  worktree: string | null;
  /** The main repository folder, or null when the cwd is not in a repo. */
  repoRoot: string | null;
}

const NONE: GitInfo = { branch: null, worktree: null, repoRoot: null };

/**
 * The branch from a HEAD file: "ref: refs/heads/feat/threads" is "feat/threads"
 * (branch names contain slashes), a bare commit hash is its first 7 characters
 * (a detached HEAD), anything else is null.
 */
export function parseHead(text: string): string | null {
  if (typeof text !== 'string') return null;
  const line = text.trim();
  if (!line) return null;
  const ref = line.match(/^ref:\s*refs\/heads\/(.+)$/);
  if (ref) {
    const branch = ref[1].trim();
    return branch || null;
  }
  if (/^[0-9a-f]{40}$|^[0-9a-f]{64}$/i.test(line)) return line.slice(0, 7);
  return null;
}

/** The path out of a worktree's .git file: "gitdir: <path>". Null when it is not one. */
export function parseGitFile(text: string): string | null {
  if (typeof text !== 'string') return null;
  const match = text.trim().match(/^gitdir:\s*(.+)$/m);
  if (!match) return null;
  const target = match[1].trim();
  return target || null;
}

/** The folder holding a .git entry, walking up from cwd. Null when there is none. */
function findGitEntry(cwd: string, fsLike: GitFs): { dir: string; gitPath: string } | null {
  let dir: string;
  try {
    dir = path.resolve(cwd);
  } catch {
    return null;
  }
  for (;;) {
    const gitPath = path.join(dir, '.git');
    try {
      if (fsLike.existsSync(gitPath)) return { dir, gitPath };
    } catch { /* unreadable folder: keep walking up */ }
    const parent = path.dirname(dir);
    if (!parent || parent === dir) return null;
    dir = parent;
  }
}

/** Read a file, or null when it is missing or unreadable. */
function readText(file: string, fsLike: GitFs): string | null {
  try {
    return fsLike.readFileSync(file, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * The main repo folder for a worktree gitdir of the shape
 * <mainRepo>/.git/worktrees/<name>, or null when the path is not that shape.
 */
function repoRootFromGitdir(gitdir: string): string | null {
  const parts = gitdir.split(/[\\/]+/);
  for (let i = parts.length - 1; i >= 1; i--) {
    if (parts[i - 1] === '.git' && parts[i] === 'worktrees') {
      const root = parts.slice(0, i - 1).join(path.sep);
      return root || null;
    }
  }
  return null;
}

/**
 * The branch, worktree folder and repo root for a working directory. All three are
 * null when the cwd is not inside a repository, and any one of them is null when the
 * file it comes from is missing or unreadable.
 */
export function gitInfo(cwd: string, fsLike: GitFs = nodeFs as unknown as GitFs): GitInfo {
  if (typeof cwd !== 'string' || !cwd) return NONE;
  const found = findGitEntry(cwd, fsLike);
  if (!found) return NONE;

  let isDir = false;
  try {
    isDir = fsLike.statSync(found.gitPath).isDirectory();
  } catch {
    return NONE;
  }

  // An ordinary checkout: .git is a directory and HEAD sits in it.
  if (isDir) {
    const head = readText(path.join(found.gitPath, 'HEAD'), fsLike);
    return { branch: head === null ? null : parseHead(head), worktree: null, repoRoot: found.dir };
  }

  // A linked worktree: .git is a file pointing at <mainRepo>/.git/worktrees/<name>,
  // which is where this worktree's own HEAD lives.
  const gitFile = readText(found.gitPath, fsLike);
  const target = gitFile === null ? null : parseGitFile(gitFile);
  if (!target) return { branch: null, worktree: null, repoRoot: null };

  let gitdir: string;
  try {
    // The path may be absolute or relative to the folder holding the .git file, and
    // git writes it with forward slashes on Windows.
    gitdir = path.resolve(found.dir, target.replace(/\//g, path.sep));
  } catch {
    return { branch: null, worktree: null, repoRoot: null };
  }

  const repoRoot = repoRootFromGitdir(gitdir);
  let worktree = found.dir;
  if (repoRoot) {
    let rel: string;
    try {
      rel = path.relative(repoRoot, found.dir);
    } catch {
      rel = '';
    }
    // Only use the relative form when the worktree really sits under the main repo.
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) worktree = rel;
  }
  worktree = worktree.replace(/\//g, '\\');

  const head = readText(path.join(gitdir, 'HEAD'), fsLike);
  return { branch: head === null ? null : parseHead(head), worktree, repoRoot };
}

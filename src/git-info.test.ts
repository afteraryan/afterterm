// Unit tests for the git branch and worktree reader. Run directly on Node 24+
// (strips types):
//   node src/git-info.test.ts
// Exits 0 if all pass, 1 on any failure.
//
// Every case but the last runs against a fake file system, so the tests do not depend
// on the machine. Paths are built with node's path so the cases hold on Windows and
// on posix; the worktree string is always printed with backslashes, which is what the
// UI shows, so its expectation is the same on both.

import fs from 'node:fs';
import path from 'node:path';
import { gitInfo, parseGitFile, parseHead } from './git-info.ts';
import type { GitFs } from './git-info.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}
const show = (v: unknown) => JSON.stringify(v);

// A fake tree: files map a path to its text, dirs are a list of paths. Lookups are
// case-insensitive, like Windows. A file listed with a null text exists but throws on
// read, which is the unreadable case.
interface FakeTree {
  files?: Record<string, string | null>;
  dirs?: string[];
}
function fakeFs(tree: FakeTree): GitFs {
  const files = new Map<string, string | null>();
  for (const [p, text] of Object.entries(tree.files ?? {})) files.set(p.toLowerCase(), text);
  const dirs = new Set((tree.dirs ?? []).map(d => d.toLowerCase()));
  return {
    existsSync: (p) => files.has(p.toLowerCase()) || dirs.has(p.toLowerCase()),
    statSync: (p) => {
      const key = p.toLowerCase();
      if (!files.has(key) && !dirs.has(key)) throw new Error('ENOENT');
      return { isDirectory: () => dirs.has(key) };
    },
    readFileSync: (p) => {
      const text = files.get(p.toLowerCase());
      if (text === undefined || text === null) throw new Error('EACCES');
      return text;
    },
  };
}

// The drive or root the fake paths hang off, so the cases run on either platform.
const ROOT = path.resolve(path.sep + 'fake');
const j = (...parts: string[]) => path.join(ROOT, ...parts);

console.log('\ngit-info: parseHead\n');
{
  check('a branch ref gives the branch', parseHead('ref: refs/heads/main\n') === 'main');
  check('a branch with slashes keeps them', parseHead('ref: refs/heads/feat/threads\n') === 'feat/threads');
  check('CRLF is trimmed', parseHead('ref: refs/heads/main\r\n') === 'main');
  check('a detached HEAD gives the short hash',
    parseHead('9e1f3a2b4c5d6e7f8091a2b3c4d5e6f708192a3b\n') === '9e1f3a2');
  check('a tag ref is not a branch', parseHead('ref: refs/tags/v1.0.0\n') === null);
  check('empty text gives null', parseHead('   \n') === null);
  check('nonsense gives null', parseHead('not a head file') === null);
}

console.log('\ngit-info: parseGitFile\n');
{
  check('a gitdir line gives the path',
    parseGitFile('gitdir: D:/repo/.git/worktrees/wt\n') === 'D:/repo/.git/worktrees/wt');
  check('a relative gitdir line gives the path', parseGitFile('gitdir: ../../.git/worktrees/wt') === '../../.git/worktrees/wt');
  check('CRLF is trimmed', parseGitFile('gitdir: /a/b\r\n') === '/a/b');
  check('a file that is not a gitdir pointer gives null', parseGitFile('ref: refs/heads/main') === null);
}

console.log('\ngit-info: an ordinary checkout\n');
{
  const repo = j('repo');
  const deps = fakeFs({
    dirs: [repo, path.join(repo, '.git')],
    files: { [path.join(repo, '.git', 'HEAD')]: 'ref: refs/heads/main\n' },
  });
  const got = gitInfo(repo, deps);
  check('a repo on a branch reports the branch', got.branch === 'main', show(got));
  check('a repo on a branch has no worktree', got.worktree === null, show(got));
  check('a repo on a branch reports its root', got.repoRoot === repo, show(got));

  const sub = gitInfo(path.join(repo, 'src', 'renderer'), deps);
  check('a subfolder walks up to the repo', sub.branch === 'main' && sub.repoRoot === repo, show(sub));

  const detached = gitInfo(repo, fakeFs({
    dirs: [repo, path.join(repo, '.git')],
    files: { [path.join(repo, '.git', 'HEAD')]: '9e1f3a2b4c5d6e7f8091a2b3c4d5e6f708192a3b' },
  }));
  check('a detached HEAD reports the short hash', detached.branch === '9e1f3a2', show(detached));

  const unreadable = gitInfo(repo, fakeFs({
    dirs: [repo, path.join(repo, '.git')],
    files: { [path.join(repo, '.git', 'HEAD')]: null },
  }));
  check('an unreadable HEAD gives a null branch but keeps the root',
    unreadable.branch === null && unreadable.repoRoot === repo, show(unreadable));

  const noHead = gitInfo(repo, fakeFs({ dirs: [repo, path.join(repo, '.git')] }));
  check('a missing HEAD gives a null branch', noHead.branch === null, show(noHead));
}

console.log('\ngit-info: a linked worktree\n');
{
  const repo = j('repo');
  const wt = path.join(repo, '.claude', 'worktrees', 'phase-3-thread-identity');
  const gitdir = path.join(repo, '.git', 'worktrees', 'phase-3-thread-identity');
  const WANT_WORKTREE = ['.claude', 'worktrees', 'phase-3-thread-identity'].join('\\');

  const tree = (gitFileText: string): FakeTree => ({
    dirs: [repo, path.join(repo, '.git'), wt, gitdir],
    files: {
      [path.join(wt, '.git')]: gitFileText,
      [path.join(gitdir, 'HEAD')]: 'ref: refs/heads/phase-3-thread-identity\n',
      [path.join(repo, '.git', 'HEAD')]: 'ref: refs/heads/main\n',
    },
  });
  // The .git file is a file, so it must not also be listed as a directory.
  const withFile = (text: string) => {
    const t = tree(text);
    t.dirs = t.dirs!.filter(d => d !== path.join(wt, '.git'));
    return fakeFs(t);
  };

  const abs = gitInfo(wt, withFile(`gitdir: ${gitdir}\n`));
  check('an absolute gitdir gives the worktree branch',
    abs.branch === 'phase-3-thread-identity', show(abs));
  check('an absolute gitdir gives the worktree folder relative to the repo',
    abs.worktree === WANT_WORKTREE, show(abs));
  check('an absolute gitdir gives the main repo as the root', abs.repoRoot === repo, show(abs));

  const slashes = gitInfo(wt, withFile(`gitdir: ${gitdir.split(path.sep).join('/')}\n`));
  check('forward slashes in the gitdir are handled',
    slashes.branch === 'phase-3-thread-identity' && slashes.worktree === WANT_WORKTREE, show(slashes));

  const rel = gitInfo(wt, withFile('gitdir: ../../../.git/worktrees/phase-3-thread-identity\n'));
  check('a relative gitdir resolves against the folder holding the .git file',
    rel.branch === 'phase-3-thread-identity' && rel.repoRoot === repo, show(rel));

  const inside = gitInfo(path.join(wt, 'src', 'renderer'), withFile(`gitdir: ${gitdir}\n`));
  check('a subfolder of a worktree walks up to the worktree',
    inside.branch === 'phase-3-thread-identity' && inside.worktree === WANT_WORKTREE, show(inside));

  const crlf = gitInfo(wt, (() => {
    const t = tree(`gitdir: ${gitdir}\r\n`);
    t.dirs = t.dirs!.filter(d => d !== path.join(wt, '.git'));
    t.files![path.join(gitdir, 'HEAD')] = 'ref: refs/heads/phase-3-thread-identity\r\n';
    return fakeFs(t);
  })());
  check('CRLF in both files is handled',
    crlf.branch === 'phase-3-thread-identity' && crlf.worktree === WANT_WORKTREE, show(crlf));

  // A worktree parked outside the main repo keeps its full path as the label.
  const outside = path.join(ROOT, 'elsewhere', 'wt');
  const outsideInfo = gitInfo(outside, fakeFs({
    dirs: [repo, path.join(repo, '.git'), outside, gitdir],
    files: {
      [path.join(outside, '.git')]: `gitdir: ${gitdir}\n`,
      [path.join(gitdir, 'HEAD')]: 'ref: refs/heads/phase-3-thread-identity\n',
    },
  }));
  check('a worktree outside the main repo keeps its full path',
    outsideInfo.worktree === outside.replace(/\//g, '\\'), show(outsideInfo));

  const junk = gitInfo(wt, withFile('this is not a gitdir pointer\n'));
  check('a .git file that is not a gitdir pointer gives nulls',
    junk.branch === null && junk.worktree === null && junk.repoRoot === null, show(junk));
}

console.log('\ngit-info: no repository\n');
{
  const got = gitInfo(j('nowhere', 'at', 'all'), fakeFs({ dirs: [j('nowhere')] }));
  check('a folder with no .git anywhere gives all nulls',
    got.branch === null && got.worktree === null && got.repoRoot === null, show(got));
  const empty = gitInfo('', fakeFs({}));
  check('an empty cwd gives all nulls', empty.branch === null && empty.repoRoot === null, show(empty));
  const notAString = gitInfo(undefined as unknown as string, fakeFs({}));
  check('a missing cwd gives all nulls', notAString.repoRoot === null, show(notAString));
}

console.log('\ngit-info: the real repository (skipped when there is no .git above cwd)\n');
{
  const real = gitInfo(process.cwd(), fs as unknown as GitFs);
  if (real.repoRoot === null) {
    check('no repository found, real file system case skipped', true);
  } else {
    check('the real repository reports a branch', typeof real.branch === 'string' && real.branch.length > 0,
      show(real));
    check('the real repository root contains a .git entry',
      fs.existsSync(path.join(real.repoRoot, '.git')), show(real.repoRoot));
    if (real.worktree !== null) {
      check('a real worktree folder is printed with backslashes and no leading separator',
        !real.worktree.includes('/') && !real.worktree.startsWith('\\'), show(real.worktree));
    } else {
      check('an ordinary checkout reports no worktree', true);
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);

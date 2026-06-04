// release.js — cut a versioned afterterm release.  `npm run release`
//
// The release version is whatever is in package.json "version" — bump that FIRST
// (semver: new feature -> minor, bug fix -> patch, breaking change -> major; see
// docs/guide-02-releases.md). This script then:
//   1. refuses to re-release an already-tagged version,
//   2. builds the portable folder + a version-stamped installer
//      (out/afterterm-<version>-setup.exe) via make-shareable.ps1,
//   3. tags the release commit `v<version>`,
//   4. prints the push / GitHub-release commands.
//
// Extra args pass through to make-shareable, e.g. `npm run release -- -KeepLocales`.
const { execFileSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const version = require(path.join(root, 'package.json')).version;
const tag = `v${version}`;

const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit', cwd: root });
// No shell — args go straight to git, so nothing here can be shell-interpreted.
const git = (...args) => execFileSync('git', args, { cwd: root }).toString().trim();

console.log(`\n=== afterterm release ${tag} ===\n`);

// 1) Don't silently re-release a version — that's the #1 way to ship a stale build
//    under an old number. Force a conscious version bump instead.
if (git('tag', '-l').split(/\r?\n/).includes(tag)) {
  console.error(`Tag ${tag} already exists.\nBump "version" in package.json first (feature=minor, fix=patch), then re-run.`);
  process.exit(1);
}

// 2) A dirty tree means the build contains edits the tag won't capture — warn loudly.
if (git('status', '--porcelain')) {
  console.warn('WARNING: uncommitted changes present. The tag will point at the last commit,');
  console.warn('         not your working-tree edits. Commit first for a traceable release.\n');
}

// 3) Build portable folder + version-stamped installer.
console.log('Building portable app + installer (a few minutes)...\n');
run('pwsh', ['-File', path.join('scripts', 'make-shareable.ps1'), ...process.argv.slice(2)]);

// 4) Tag the exact commit this release was built from.
const sha = git('rev-parse', '--short', 'HEAD');
run('git', ['tag', '-a', tag, '-m', `afterterm ${version}`]);

const installer = `out/afterterm-${version}-setup.exe`;
console.log(`
Tagged ${tag} at ${sha}.

Artifacts:
  out/afterterm-win32-x64/       portable folder (the current build to run)
  ${installer}  versioned installer (the archival release artifact)

Next:
  git push origin ${tag}
  gh release create ${tag} ${installer} --title "afterterm ${version}" --notes-file <notes>
`);

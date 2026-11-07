// Writes a test feed for automatic updates (docs/features-updates.md): a JSON file
// in the shape of GitHub's releases/latest response, pointing at a local
// installer, for AFTERTERM_UPDATE_FEED. No public release is ever needed to test.
//
//   node scripts/agent-harness/update-feed.mjs --out <dir>
//        [--version 0.11.0]        the release offered (default 0.11.0)
//        [--installer <file>]      a real installer to offer; without it a file of
//                                  random bytes stands in (fine for a dev build,
//                                  which never runs Setup)
//        [--size-mb 30]            the stand-in's size (default 30)
//        [--base afterterm]        the asset prefix; afterterm-test for the sandbox build
//        [--bad-digest]            a digest that never matches, to see the refusal
//        [--notes <file.md>]       the release notes (default: a short sample)
//
// Prints the feed's path. Then: npm run harness -- ... --env AFTERTERM_UPDATE_FEED=<path>

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};
const out = opt('out');
if (!out) { console.error('update-feed: --out <dir> is required'); process.exit(1); }
const version = opt('version', '0.11.0');
const base = opt('base', 'afterterm');
const assetName = `${base}-${version}-setup.exe`;
fs.mkdirSync(out, { recursive: true });

let installer = opt('installer');
if (!installer) {
  installer = path.join(out, assetName);
  if (!fs.existsSync(installer)) {
    const mb = Number(opt('size-mb', '30'));
    fs.writeFileSync(installer, crypto.randomBytes(Math.max(1, Math.round(mb * 1048576))));
  }
}
installer = path.resolve(installer);
const hash = crypto.createHash('sha256').update(fs.readFileSync(installer)).digest('hex');
const notesFile = opt('notes');
const body = notesFile ? fs.readFileSync(notesFile, 'utf-8') : [
  '### Updating afterterm', '',
  '- **afterterm updates itself.** When a new version is out it tells you, downloads it while you work, and installs it when you say so.',
  '- **Threads come back after an update.** Every thread that was awake wakes again when afterterm opens.', '',
  '### Fixed', '',
  '- A sample fix, with [a link](https://github.com/afteraryan/afterterm/releases).',
].join('\r\n');

const feed = {
  tag_name: `v${version}`,
  name: `afterterm ${version}`,
  draft: false,
  prerelease: false,
  body,
  assets: [{
    name: assetName,
    size: fs.statSync(installer).size,
    digest: `sha256:${args.includes('--bad-digest') ? '0'.repeat(64) : hash}`,
    browser_download_url: installer,
  }],
};
const feedPath = path.join(out, args.includes('--bad-digest') ? 'feed-bad.json' : 'feed.json');
fs.writeFileSync(feedPath, JSON.stringify(feed, null, 2) + '\n');
console.log(feedPath);

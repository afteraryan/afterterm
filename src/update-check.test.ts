// Unit tests for update-check.ts. Run directly on Node 24+ (strips types):
//   node src/update-check.test.ts
// Exits 0 if all pass, 1 on any failure.

import {
  parseVersion, compareVersions, isNewer, assetNameFor, parseDigest, parseRelease,
  downloadSource, autoChecksOn, isSuppressed, LATER_MS, initialUpdateState,
  titleBarButtonShows, percent, megabytes, lastCheckedText, errorText,
  restartRows, restartStatus, asPendingUpdate, updateLanded, parseInline,
  parseNotes, samePath, installerVersion, staleDownloads, isMidTurn,
} from './update-check.ts';
import type { UpdateState, AwakeThread } from './update-check.ts';
import { isDeepStrictEqual } from 'node:util';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}
const show = (v: unknown) => JSON.stringify(v);
const eq = (a: unknown, b: unknown) => isDeepStrictEqual(a, b);

const HEX = 'ab'.repeat(32);
function release(over: Record<string, unknown> = {}, asset: Record<string, unknown> = {}) {
  return {
    tag_name: 'v0.11.0',
    body: '### Added\n- **Updates.** afterterm updates itself.',
    draft: false,
    prerelease: false,
    assets: [
      { name: 'afterterm-0.11.0-setup.exe', size: 74_868_326, digest: `sha256:${HEX}`, browser_download_url: 'https://github.com/afteraryan/afterterm/releases/download/v0.11.0/afterterm-0.11.0-setup.exe', ...asset },
    ],
    ...over,
  };
}

console.log('\nupdate-check: versions\n');
{
  check('plain version parses', eq(parseVersion('0.11.0'), [0, 11, 0]));
  check('a leading v is dropped', eq(parseVersion('v1.2.3'), [1, 2, 3]));
  check('a prerelease suffix is not a version', parseVersion('0.11.0-beta.1') === null);
  check('two parts is not a version', parseVersion('0.11') === null);
  check('a number is not a version', parseVersion(11 as unknown) === null);
  check('0.11.0 is newer than 0.10.0', compareVersions('0.11.0', '0.10.0') > 0);
  check('numbers compare as numbers, not text (0.10.0 > 0.9.0)', compareVersions('0.10.0', '0.9.0') > 0);
  check('1.0.0 is newer than 0.99.99', isNewer('1.0.0', '0.99.99'));
  check('the same version is not newer', !isNewer('0.10.0', '0.10.0'));
  check('an older version is not newer', !isNewer('0.9.1', '0.10.0'));
  check('garbage is never newer', !isNewer('latest', '0.10.0'));
}

console.log('\nupdate-check: the asset and its digest\n');
{
  check('asset name', assetNameFor('0.11.0') === 'afterterm-0.11.0-setup.exe');
  check('sandbox asset name', assetNameFor('0.11.0', 'afterterm-test') === 'afterterm-test-0.11.0-setup.exe');
  check('sha256 digest parses, lowercased', parseDigest(`sha256:${HEX.toUpperCase()}`) === HEX);
  check('sha512 is not accepted', parseDigest(`sha512:${HEX}${HEX}`) === null);
  check('a short hash is not accepted', parseDigest('sha256:abcd') === null);
  check('no digest is null', parseDigest(undefined) === null && parseDigest(null) === null);
}

console.log('\nupdate-check: parseRelease\n');
{
  const ok = parseRelease(release(), '0.10.0');
  check('a newer release with a digest is offered', ok.kind === 'update', show(ok));
  if (ok.kind === 'update') {
    check('version without the v', ok.release.version === '0.11.0');
    check('the sha256 is carried', ok.release.sha256 === HEX);
    check('the size is carried', ok.release.size === 74_868_326);
    check('the notes are the body', ok.release.notes.startsWith('### Added'));
  }
  check('same version: none', eq(parseRelease(release(), '0.11.0'), { kind: 'none', reason: 'not-newer' }));
  check('older than running: none', parseRelease(release({ tag_name: 'v0.9.0' }), '0.10.0').kind === 'none');
  check('no digest: not offered', eq(parseRelease(release({}, { digest: undefined }), '0.10.0'), { kind: 'none', reason: 'no-digest' }));
  check('a sha1 digest: not offered', parseRelease(release({}, { digest: 'sha1:abc' }), '0.10.0').kind === 'none');
  check('asset with another name: not offered', eq(parseRelease(release({}, { name: 'afterterm-setup.exe' }), '0.10.0'), { kind: 'none', reason: 'no-asset' }));
  check('no assets at all: not offered', parseRelease(release({ assets: [] }), '0.10.0').kind === 'none');
  check('a draft is not offered', parseRelease(release({ draft: true }), '0.10.0').kind === 'none');
  check('a prerelease is not offered', parseRelease(release({ prerelease: true }), '0.10.0').kind === 'none');
  check('a non-object is not a release', eq(parseRelease('nope', '0.10.0'), { kind: 'none', reason: 'not-a-release' }));
  check('an error body (rate limit) is not a release', parseRelease({ message: 'API rate limit exceeded' }, '0.10.0').kind === 'none');
  check('the sandbox ignores the real asset', parseRelease(release(), '0.10.0', 'afterterm-test').kind === 'none');
  const sb = parseRelease(release({}, { name: 'afterterm-test-0.11.0-setup.exe' }), '0.10.0', 'afterterm-test');
  check('the sandbox takes its own asset', sb.kind === 'update');
  const noSize = parseRelease(release({}, { size: 'big' }), '0.10.0');
  check('a bad size becomes 0, the update is still offered', noSize.kind === 'update' && noSize.release.size === 0);
}

console.log('\nupdate-check: old downloads\n');
{
  check('an installer file name gives its version', installerVersion('afterterm-0.11.0-setup.exe') === '0.11.0');
  check('an unfinished download too', installerVersion('afterterm-0.11.0-setup.exe.partial') === '0.11.0');
  check('the sandbox name with its base', installerVersion('afterterm-test-0.11.0-setup.exe', 'afterterm-test') === '0.11.0');
  check('another file is not an installer', installerVersion('notes.txt') === null);
  const names = ['afterterm-0.10.0-setup.exe', 'afterterm-0.11.0-setup.exe', 'afterterm-0.12.0-setup.exe',
    'afterterm-0.12.0-setup.exe.partial', 'mine.txt'];
  check('after updating to 0.11.0: the old and current installers and every partial go',
    eq(staleDownloads(names, '0.11.0'), ['afterterm-0.10.0-setup.exe', 'afterterm-0.11.0-setup.exe', 'afterterm-0.12.0-setup.exe.partial']),
    show(staleDownloads(names, '0.11.0')));
}

console.log('\nupdate-check: downloadSource\n');
{
  check('https is always allowed', eq(downloadSource('https://github.com/x.exe', false), { kind: 'https', url: 'https://github.com/x.exe' }));
  check('http is never allowed', downloadSource('http://github.com/x.exe', true) === null);
  check('a local path is refused without the test feed', downloadSource('D:\\x\\setup.exe', false) === null);
  check('a local path with the test feed', eq(downloadSource('D:\\x\\setup.exe', true), { kind: 'file', path: 'D:\\x\\setup.exe' }));
  check('a file URL with the test feed', eq(downloadSource('file:///D:/x/my%20setup.exe', true), { kind: 'file', path: 'D:\\x\\my setup.exe' }));
  check('a file URL without the test feed', downloadSource('file:///D:/x/setup.exe', false) === null);
  check('a relative path is refused', downloadSource('setup.exe', true) === null);
}

console.log('\nupdate-check: settings, Later and Skip\n');
{
  const NOW = 1_800_000_000_000;
  check('checks are on by default', autoChecksOn({}));
  check('checks off when disabled', !autoChecksOn({ updateChecks: 'disabled' }));
  check('nothing set: shown', !isSuppressed('0.11.0', {}, NOW));
  check('skipped version: hidden', isSuppressed('0.11.0', { updateSkippedVersion: '0.11.0' }, NOW));
  check('a newer version than the skipped one: shown', !isSuppressed('0.12.0', { updateSkippedVersion: '0.11.0' }, NOW));
  check('Later pressed a minute ago: hidden', isSuppressed('0.11.0', { updateLaterUntil: NOW - 60_000 + LATER_MS }, NOW));
  check('Later pressed a day ago: shown again', !isSuppressed('0.11.0', { updateLaterUntil: NOW - LATER_MS }, NOW));
  check('Later is 24 hours', LATER_MS === 86_400_000);
  check('a bad Later value is ignored', !isSuppressed('0.11.0', { updateLaterUntil: 'tomorrow' as unknown as number }, NOW));
}

console.log('\nupdate-check: the title bar button\n');
{
  const base: UpdateState = initialUpdateState('0.10.0');
  const rel = { version: '0.11.0', notes: '', size: 100 };
  check('idle: no button', !titleBarButtonShows(base));
  check('available: button', titleBarButtonShows({ ...base, phase: 'available', release: rel }));
  check('available but hidden by Later or Skip: no button', !titleBarButtonShows({ ...base, phase: 'available', release: rel, hidden: true }));
  check('downloading shows even when it was hidden', titleBarButtonShows({ ...base, phase: 'downloading', release: rel, hidden: true }));
  check('ready shows', titleBarButtonShows({ ...base, phase: 'ready', release: rel }));
  check('percent rounds down', percent(47.9, 100) === 47);
  check('percent with no total is 0', percent(10, 0) === 0);
  check('percent never passes 100', percent(120, 100) === 100);
  check('megabytes', megabytes(42_677_043, 74_868_326) === '40.7 of 71.4 MB', megabytes(42_677_043, 74_868_326));
}

console.log('\nupdate-check: texts\n');
{
  const now = new Date(2026, 9, 30, 15, 0).getTime();
  check('checked today', lastCheckedText(new Date(2026, 9, 30, 9, 12).getTime(), now) === 'Last checked today at 09:12.');
  check('checked yesterday', lastCheckedText(new Date(2026, 9, 29, 23, 5).getTime(), now) === 'Last checked yesterday at 23:05.');
  check('checked earlier', lastCheckedText(new Date(2026, 9, 20, 8, 0).getTime(), now) === 'Last checked on 20 October.');
  check('never checked', lastCheckedText(null, now) === 'Not checked yet.');
  check('checksum text', errorText('checksum') === "The download didn't match the release, so it was deleted.");
  check('network text', errorText('network') === 'The download stopped.');
  check('not installed text', errorText('not-installed') === 'Updates install only into an installed copy.');
  check('no error, no text', errorText(null) === null);
}

console.log('\nupdate-check: the restart window\n');
{
  const threads: AwakeThread[] = [
    { id: 't1', name: 'Checkout page redesign', kind: 'chat', resumes: true, midTurn: true },
    { id: 't2', name: 'Fix flaky payment tests', kind: 'chat', resumes: true, midTurn: false },
    { id: 't3', name: 'npm run dev', kind: 'shell', resumes: false, midTurn: false, rerunPort: 5173 },
    { id: 'g1', name: 'pwsh.exe', kind: 'shell', resumes: false, midTurn: false },
  ];
  const rows = restartRows(threads);
  check('a chat mid-turn stops mid-turn, in yellow', rows[0].text === 'Stops mid-turn' && rows[0].warn);
  check('a quiet chat resumes', rows[1].text === 'Resumes' && !rows[1].warn);
  check('a server runs again on its port', rows[2].text === 'Runs again on :5173');
  check('any other shell opens in its folder', rows[3].text === 'Opens in its folder');
  check('order is kept', rows.map(r => r.id).join() === 't1,t2,t3,g1');
  check('a chat with no session to resume opens in its folder',
    restartRows([{ id: 'x', name: 'x', kind: 'chat', resumes: false, midTurn: true }])[0].outcome === 'opens-in-folder');
  check('one chat mid-turn', eq(restartStatus(rows), { ok: false, text: '1 chat stops mid-turn' }));
  check('two chats mid-turn', restartStatus(restartRows([threads[0], { ...threads[0], id: 't9' }])).text === '2 chats stop mid-turn');
  check('nothing busy: safe', eq(restartStatus(rows.slice(1)), { ok: true, text: 'Safe to restart' }));
  check('nothing awake: safe', restartStatus([]).ok);
  check('the spinner is mid-turn', isMidTurn('working') && isMidTurn('compacting'));
  check('waiting on a permission prompt is mid-turn', isMidTurn('attention'));
  check('done, background and quiet are not', !isMidTurn('done') && !isMidTurn('background') && !isMidTurn(undefined));
}

console.log('\nupdate-check: after the restart\n');
{
  check('a pending update round-trips', eq(asPendingUpdate({ from: '0.10.0', to: '0.11.0', activeThreadId: 't1', screen: 'workspace' }),
    { from: '0.10.0', to: '0.11.0', activeThreadId: 't1', screen: 'workspace' }));
  check('a bad screen is dropped', asPendingUpdate({ from: '0.10.0', to: '0.11.0', screen: 'settings' })?.screen === undefined);
  check('no to: not a pending update', asPendingUpdate({ from: '0.10.0' }) === null);
  check('landed when running the new version', updateLanded({ from: '0.10.0', to: '0.11.0' }, '0.11.0'));
  check('not landed when the old version is still running (install failed)', !updateLanded({ from: '0.10.0', to: '0.11.0' }, '0.10.0'));
  check('nothing pending: not landed', !updateLanded(null, '0.11.0'));
}

console.log('\nupdate-check: release notes\n');
{
  check('plain text', eq(parseInline('hello'), [{ text: 'hello' }]));
  check('bold', eq(parseInline('a **b** c'), [{ text: 'a ' }, { text: 'b', bold: true }, { text: ' c' }]));
  check('link', eq(parseInline('see [the PR](https://github.com/x/pull/1).'),
    [{ text: 'see ' }, { text: 'the PR', href: 'https://github.com/x/pull/1' }, { text: '.' }]));
  check('a non-http link is plain text', eq(parseInline('[x](javascript:alert(1))'), [{ text: 'x' }, { text: ')' }]) || parseInline('[x](javascript:alert(1))').every(i => !i.href));
  check('backticks are dropped', eq(parseInline('run `npm test` now'), [{ text: 'run npm test now' }]));
  const md = [
    '### Added',
    '',
    '- **afterterm updates itself.** It tells you when a new version is out',
    '  and installs it when you say so.',
    '- Threads come back. See [design-05](https://github.com/afteraryan/afterterm/blob/main/docs/design-05-automatic-updates.md).',
    '',
    '![The notice](https://example.com/notice.png)',
    '',
    '### Fixed',
    '* A server\'s port pill stayed after it stopped.',
    '',
    'Thanks to everyone who tested.',
  ].join('\r\n');
  const blocks = parseNotes(md);
  check('five blocks (two headings, two lists, one paragraph)', blocks.length === 5, show(blocks.map(b => b.type)));
  check('first block is the heading', blocks[0].type === 'heading' && blocks[0].inlines[0].text === 'Added');
  const list = blocks[1];
  check('two bullets', list.type === 'list' && list.items.length === 2);
  check('a wrapped bullet is joined', list.type === 'list' && list.items[0].map(i => i.text).join('').endsWith('when a new version is out and installs it when you say so.'));
  check('bold inside a bullet', list.type === 'list' && list.items[0][0].bold === true);
  check('the image line is skipped', !show(blocks).includes('notice.png'));
  check('a star bullet counts', blocks[3].type === 'list');
  check('a plain paragraph', blocks[4].type === 'para');
  check('empty notes, no blocks', parseNotes('').length === 0);
  check('no HTML is ever produced', !show(parseNotes('<script>alert(1)</script>')).includes('"html"'));
}

console.log('\nupdate-check: the installed copy\n');
{
  check('same path ignores case and a trailing slash', samePath('C:\\Users\\A\\Programs\\afterterm\\', 'c:/users/a/programs/afterterm'));
  check('same path with accented letters', samePath('C:\\Users\\Jürgen\\AppData\\Local\\Programs\\afterterm', 'c:\\users\\jürgen\\appdata\\local\\programs\\afterterm\\'));
  check('a different folder is not the same path', !samePath('C:\\x\\afterterm', 'C:\\x\\afterterm-test'));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

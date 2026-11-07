// Unit tests for update-check.ts. Run directly on Node 24+ (strips types):
//   node src/update-check.test.ts
// Exits 0 if all pass, 1 on any failure.

import {
  parseVersion, compareVersions, isNewer, assetNameFor, parseDigest, parseRelease,
  downloadSource, autoChecksOn, isSuppressed, LATER_MS, initialUpdateState,
  titleBarButtonShows, percent, megabytes, lastCheckedText, errorText,
  restartRows, restartStatus, asPendingUpdate, updateLanded, parseInline,
  parseNotes, samePath, installFolder, installerVersion, staleDownloads, isMidTurn,
  hasBackgroundTask, shellBusy, releaseToDownload,
} from './update-check.ts';
import type { UpdateState, AwakeThread, ReleaseInfo } from './update-check.ts';
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

console.log('\nupdate-check: the restart window, mid-turn and background (Fixes 6 and 7)\n');
{
  check('the record says busy: mid-turn, with no notification at all (a chat with no hooks)', isMidTurn('busy', undefined));
  check('the record says waiting: mid-turn at once, before any hook title', isMidTurn('waiting', undefined));
  check('the record busy through a stall that cleared working', isMidTurn('busy', undefined) && isMidTurn('busy', 'done'));
  check('no record, the spinner: mid-turn', isMidTurn(undefined, 'working') && isMidTurn(undefined, 'compacting'));
  check('no record, waiting on a permission prompt: mid-turn', isMidTurn(undefined, 'attention'));
  check('a mid-turn notification counts even when the record says idle', isMidTurn('idle', 'working'));
  check('idle, shell and no record, with done, background or quiet: not mid-turn',
    !isMidTurn('idle', undefined) && !isMidTurn('shell', undefined) && !isMidTurn(undefined, 'done')
    && !isMidTurn(undefined, 'background') && !isMidTurn(undefined, undefined));
  check('the record says shell: a background task', hasBackgroundTask('shell', undefined) && hasBackgroundTask('shell', 'done'));
  check('no record, the background notification: a background task', hasBackgroundTask(undefined, 'background'));
  // The ⏳ badge stays until the thread is looked at, so with a record it is not trusted.
  check('the record says idle: no background task, even under a stale background badge',
    !hasBackgroundTask('idle', 'background'));
  check('the record says busy or waiting: not a background task, whatever the badge',
    !hasBackgroundTask('busy', 'background') && !hasBackgroundTask('waiting', 'background'));
  check('busy, idle, waiting and no record with no background title: none',
    !hasBackgroundTask('busy', undefined) && !hasBackgroundTask('idle', 'done') && !hasBackgroundTask('waiting', undefined)
    && !hasBackgroundTask(undefined, undefined));
}

console.log('\nupdate-check: the restart window, busy shells (Fix 8)\n');
{
  check('marks say not at the prompt: busy, whatever the process tree says',
    shellBusy(false, undefined) === 'busy' && shellBusy(false, false) === 'busy' && shellBusy(false, true) === 'busy');
  check('marks say at the prompt: at the prompt, even with a process below the shell',
    shellBusy(true, undefined) === 'at-prompt' && shellBusy(true, true) === 'at-prompt');
  check('no marks, a process below the shell: busy', shellBusy(undefined, true) === 'busy');
  check('no marks, nothing below the shell: unknown, never safe', shellBusy(undefined, false) === 'unknown');
  check('no marks, the process list too old to say: unknown', shellBusy(undefined, undefined) === 'unknown');
}

console.log('\nupdate-check: the restart window, rows (Fix 10)\n');
{
  const base: AwakeThread = {
    id: 'x', name: 'x', kind: 'shell', resumes: false, midTurn: false, background: false,
    claudeAlive: false, shellBusy: 'at-prompt',
  };
  const row = (over: Partial<AwakeThread>) => restartRows([{ ...base, ...over }])[0];
  const is = (r: ReturnType<typeof row>, text: string, warn: boolean, unknown = false) =>
    r.text === text && r.warn === warn && r.unknown === unknown;

  // The first table in plan-02, "What the restart window must say", row by row.
  const busyChat = row({ kind: 'chat', resumes: true, claudeAlive: true, midTurn: true });
  check('Claude alive and busy or waiting, with a session id: Stops mid-turn, warns',
    is(busyChat, 'Stops mid-turn', true) && busyChat.outcome === 'stops-mid-turn', show(busyChat));
  check('Claude alive and busy, no session id yet (a chat with no hooks): Stops mid-turn, warns',
    is(row({ claudeAlive: true, midTurn: true }), 'Stops mid-turn', true));
  const bg = row({ kind: 'chat', resumes: true, claudeAlive: true, background: true });
  check('Claude alive with a background task: Background task stops, warns',
    is(bg, 'Background task stops', true) && bg.outcome === 'background-stops', show(bg));
  const idle = row({ kind: 'chat', resumes: true, claudeAlive: true, shellBusy: 'busy' });
  check('Claude alive and idle, id usable: Resumes, no warning (the marks are not read while Claude is open)',
    is(idle, 'Resumes', false) && idle.outcome === 'resumes', show(idle));
  check('Claude alive and idle, no usable id yet: Opens in its folder, no warning',
    is(row({ claudeAlive: true, shellBusy: 'busy' }), 'Opens in its folder', false));
  check('No Claude, a session id, at its prompt: Resumes, no warning',
    is(row({ kind: 'chat', resumes: true }), 'Resumes', false));
  const exited = row({ kind: 'chat', resumes: true, shellBusy: 'busy' });
  check('No Claude, a session id, running a command: Command stops, warns',
    is(exited, 'Command stops', true) && exited.outcome === 'command-stops', show(exited));
  const server = row({ rerunPort: 5173 });
  check('No Claude, no id, a port and a re-runnable command: Runs again on :5173, no warning',
    is(server, 'Runs again on :5173', false) && server.outcome === 'runs-again', show(server));
  check('No Claude, no id, running any other command: Command stops, warns',
    is(row({ shellBusy: 'busy' }), 'Command stops', true));
  const quiet = row({});
  check('No Claude, no id, at its prompt: Opens in its folder, no warning',
    is(quiet, 'Opens in its folder', false) && quiet.outcome === 'opens-in-folder', show(quiet));
  const unknown = row({ shellBusy: 'unknown' });
  check('No Claude, no marks, no child process: Opens in its folder, no warning, counts as unknown',
    is(unknown, 'Opens in its folder', false, true), show(unknown));

  // Where the signals overlap.
  check('mid-turn wins over a background task',
    is(row({ claudeAlive: true, resumes: true, midTurn: true, background: true }), 'Stops mid-turn', true));
  check('a mid-turn notification with no record (a WSL chat on hooks) still stops mid-turn, not Command stops',
    is(row({ kind: 'chat', resumes: true, midTurn: true, shellBusy: 'busy' }), 'Stops mid-turn', true));
  check('a background notification with no record still reads Background task stops',
    is(row({ kind: 'chat', resumes: true, background: true, shellBusy: 'busy' }), 'Background task stops', true));
  check('a server whose shell is busy: Runs again, since the server is the running command',
    is(row({ rerunPort: 5173, shellBusy: 'busy' }), 'Runs again on :5173', false));
  check('a server with no marks and nothing below the shell: Runs again, not unknown',
    is(row({ rerunPort: 5173, shellBusy: 'unknown' }), 'Runs again on :5173', false, false));
  check('an exited chat with no marks and nothing below the shell: Resumes, counted as unknown',
    is(row({ kind: 'chat', resumes: true, shellBusy: 'unknown' }), 'Resumes', false, true));
  check('a live idle Claude never counts as unknown',
    !row({ claudeAlive: true, resumes: true, shellBusy: 'unknown' }).unknown);
  // The plan's row: a live Claude with no usable id opens in its folder, even with a
  // port in its tree (its last command is `claude`, not a server's).
  const claudePort = row({ claudeAlive: true, rerunPort: 3000 });
  check('a live idle Claude with no id and a port in its tree: Opens in its folder, not Runs again',
    is(claudePort, 'Opens in its folder', false) && claudePort.outcome === 'opens-in-folder', show(claudePort));

  const threads: AwakeThread[] = [
    { ...base, id: 't1', name: 'Checkout page redesign', kind: 'chat', resumes: true, claudeAlive: true, midTurn: true },
    { ...base, id: 't2', name: 'Fix flaky payment tests', kind: 'chat', resumes: true, claudeAlive: true },
    { ...base, id: 't3', name: 'npm run dev', rerunPort: 5173 },
    { ...base, id: 'g1', name: 'pwsh.exe' },
  ];
  const rows = restartRows(threads);
  check('order is kept', rows.map(r => r.id).join() === 't1,t2,t3,g1');
  check('kind and name are carried through', rows[0].kind === 'chat' && rows[3].kind === 'shell' && rows[0].name === 'Checkout page redesign');

  // The second table: the status line.
  check('nothing warns, nothing unknown: Safe to restart', eq(restartStatus(rows.slice(1)), { ok: true, text: 'Safe to restart' }));
  check('nothing awake: Safe to restart', eq(restartStatus([]), { ok: true, text: 'Safe to restart' }));
  check('only one chat stops mid-turn: 1 chat stops mid-turn', eq(restartStatus(rows), { ok: false, text: '1 chat stops mid-turn' }));
  check('only two chats stop mid-turn: 2 chats stop mid-turn',
    eq(restartStatus(restartRows([threads[0], { ...threads[0], id: 't9' }])), { ok: false, text: '2 chats stop mid-turn' }));
  check('a background task: 1 thread is busy',
    eq(restartStatus(restartRows([{ ...base, claudeAlive: true, background: true }])), { ok: false, text: '1 thread is busy' }));
  check('a shell running a command: 1 thread is busy',
    eq(restartStatus(restartRows([{ ...base, shellBusy: 'busy' }, threads[1]])), { ok: false, text: '1 thread is busy' }));
  check('a chat mid-turn and a busy shell: 2 threads are busy, every warning counted',
    eq(restartStatus(restartRows([threads[0], { ...base, id: 's', shellBusy: 'busy' }])), { ok: false, text: '2 threads are busy' }));
  check('three warnings of mixed kinds: 3 threads are busy',
    restartStatus(restartRows([threads[0], { ...base, id: 'b', claudeAlive: true, background: true }, { ...base, id: 's', shellBusy: 'busy' }]))?.text === '3 threads are busy');
  check('nothing warns but something is unknown: no status line',
    restartStatus(restartRows([threads[1], { ...base, id: 'u', shellBusy: 'unknown' }])) === null);
  check('a warning with something unknown still shows the warning',
    eq(restartStatus(restartRows([threads[0], { ...base, id: 'u', shellBusy: 'unknown' }])), { ok: false, text: '1 chat stops mid-turn' }));
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
  const P = 'C:\\Users\\a\\AppData\\Local\\Programs\\afterterm-test';
  check('the engine\'s InstallLocation wins', installFolder(P, '"D:\\other\\Uninstall x.exe" /currentuser') === P);
  check('without it, the uninstaller\'s folder (quoted, with spaces)',
    installFolder(undefined, `"${P}\\Uninstall afterterm-test.exe" /currentuser`) === P);
  check('an unquoted uninstaller path', installFolder('', 'C:\\Apps\\afterterm\\Uninstall.exe /S') === 'C:\\Apps\\afterterm');
  check('nothing usable: null', installFolder(null, null) === null && installFolder('  ', 'msiexec /x {GUID}') === null);
}

console.log('\nupdate-check: releaseToDownload (Update downloads the newest release)\n');
{
  const rel = (version: string): ReleaseInfo => ({
    version, notes: '', assetName: assetNameFor(version), size: 1, url: `https://example.test/${version}`, sha256: 'a'.repeat(64),
  });
  const shown = rel('0.11.2');
  check('a newer release out since the last check is the one downloaded',
    releaseToDownload(shown, { kind: 'update', release: rel('0.12.0') })?.version === '0.12.0');
  check('the same release: that one', releaseToDownload(shown, { kind: 'update', release: rel('0.11.2') })?.version === '0.11.2');
  check('the check failed (offline, rate limited): the release already shown', releaseToDownload(shown, null) === shown);
  check('the latest has no installer yet: the release already shown',
    releaseToDownload(shown, { kind: 'none', reason: 'no-asset' }) === shown);
  check('the latest has no digest: the release already shown',
    releaseToDownload(shown, { kind: 'none', reason: 'no-digest' }) === shown);
  check('nothing newer than this copy any more (the release was pulled): nothing to download',
    releaseToDownload(shown, { kind: 'none', reason: 'not-newer' }) === null);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

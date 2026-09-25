// Unit tests for the Files button's view: the label, the sections, the folder
// labels, the times, and when the Code row starts unfolded.
// Run directly on Node 24+ (strips types):
//   node src/renderer/filesView.test.ts
// Exits 0 if all pass, 1 on any failure.

import { filesButtonLabel, shortAgo, folderLabel, pastedLabel, filesListView, hasFilesButton } from './filesView.ts';
import type { ChangedFile } from '../session-files.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}
const show = (v: unknown) => JSON.stringify(v);

const NOW = new Date(2026, 8, 25, 17, 30, 0).getTime();
const MIN = 60_000;
const FOLDER = 'D:\\Pitara\\Work\\Tinkering\\afterterm';
const HOME = 'C:\\Users\\Aryan';

console.log('button label');
check('several files', filesButtonLabel(11) === '11 files');
check('one file', filesButtonLabel(1) === '1 file');
check('nothing changed: no button', filesButtonLabel(0) === null);
check('nonsense: no button', filesButtonLabel(NaN) === null && filesButtonLabel(-2) === null);

console.log('how long ago');
check('seconds read as now', shortAgo(NOW - 20_000, NOW) === 'now');
check('minutes', shortAgo(NOW - 2 * MIN, NOW) === '2m');
check('hours', shortAgo(NOW - 3 * 60 * MIN, NOW) === '3h');
check('days', shortAgo(NOW - 4 * 24 * 60 * MIN, NOW) === '4d');
check('weeks after two weeks', shortAgo(NOW - 21 * 24 * 60 * MIN, NOW) === '3w');
check('a clock skewed into the future reads now', shortAgo(NOW + 5000, NOW) === 'now');

console.log('folder labels');
check('inside the chat folder: relative with slashes', folderLabel(`${FOLDER}\\src\\renderer\\a.ts`, FOLDER, HOME) === 'src/renderer');
check('in the folder itself: project root', folderLabel(`${FOLDER}\\CHANGELOG.md`, FOLDER, HOME) === 'project root');
check('case and slashes of the chat folder do not matter', folderLabel(`${FOLDER}\\docs\\a.md`, 'd:/pitara/work/tinkering/afterterm/', HOME) === 'docs');
check('outside the folder, in home: ~', folderLabel('C:\\Users\\Aryan\\.claude\\plans\\p.md', FOLDER, HOME) === '~\\.claude\\plans');
check('outside everything: the full folder', folderLabel('E:\\other\\x.md', FOLDER, HOME) === 'E:\\other');
check('outside the chat folder, inside the project: relative to the project', folderLabel('D:\\p\\docs\\a.md', 'D:\\p\\app', HOME, 'D:\\p') === 'docs');
check('the chat folder wins over the project folder', folderLabel('D:\\p\\app\\src\\a.ts', 'D:\\p\\app', HOME, 'D:\\p') === 'src');
check('no chat folder known', folderLabel(`${FOLDER}\\docs\\a.md`, undefined, HOME) === `${FOLDER}\\docs`);
check('a sibling folder with the same prefix is outside', folderLabel('D:\\Pitara\\Work\\Tinkering\\afterterm-old\\a.md', FOLDER, HOME) === 'D:\\Pitara\\Work\\Tinkering\\afterterm-old');

console.log('pasted labels');
check('today: the clock time', pastedLabel(3, new Date(2026, 8, 25, 17, 17).getTime(), NOW) === '#3 \u00b7 17:17');
check('earlier: the date', pastedLabel(4, new Date(2026, 8, 24, 9, 5).getTime(), NOW) === '#4 \u00b7 24 Sep');
check('morning time zero-padded', pastedLabel(1, new Date(2026, 8, 25, 7, 5).getTime(), NOW) === '#1 \u00b7 07:05');

const file = (name: string, minsAgo: number, extra: Partial<ChangedFile> = {}): ChangedFile => ({
  path: `${FOLDER}\\${name}`,
  kind: /\.(md|mdx|txt)$/.test(name) ? 'doc' : 'code',
  created: false,
  at: NOW - minsAgo * MIN,
  source: 'tool',
  ...extra,
});

console.log('the list');
{
  const v = filesListView({
    changed: [
      file('bugs.md', 5),
      file('docs\\design-04.md', 2, { created: true }),
      file('src\\main.ts', 8),
      file('src\\claude-transcript.ts', 3),
    ],
    pasted: [
      { key: 'a', n: 3, at: NOW - 13 * MIN, mediaType: 'image/png', cwd: null },
      { key: 'b', n: 6, at: NOW - 10 * MIN, mediaType: 'image/png', cwd: null },
    ],
  }, FOLDER, HOME, NOW);
  check('count is documents and code only', v.count === 4);
  check('documents newest first', show(v.docs.map(d => d.name)) === show(['design-04.md', 'bugs.md']), show(v.docs.map(d => d.name)));
  check('code newest first', show(v.code.map(d => d.name)) === show(['claude-transcript.ts', 'main.ts']));
  check('New tag data', v.docs[0].created === true && v.docs[1].created === false);
  check('folder and time on a row', v.docs[0].folder === 'docs' && v.docs[0].ago === '2m');
  check('pasted newest first', show(v.pasted.map(p => p.n)) === show([6, 3]));
  check('pasted label', v.pasted[0].label.startsWith('#6 \u00b7 '));
  check('code starts folded when there are documents', v.codeStartsOpen === false);
  check('there is a button', hasFilesButton(v));
}
{
  const v = filesListView({ changed: [file('a.ts', 1), file('b.ts', 2)], pasted: [] }, FOLDER, HOME, NOW);
  check('only code: the Code row starts unfolded', v.codeStartsOpen === true);
  check('only code: no documents', v.docs.length === 0 && v.count === 2);
}
{
  const v = filesListView({ changed: [], pasted: [{ key: 'a', n: 1, at: NOW, mediaType: 'image/png', cwd: null }] }, FOLDER, HOME, NOW);
  check('only pasted images: nothing counted, so no button', v.count === 0 && !hasFilesButton(v));
  check('only pasted images: the Code row does not start open', v.codeStartsOpen === false);
}
{
  const v = filesListView(undefined, FOLDER, HOME, NOW);
  check('no data yet: empty view', v.count === 0 && v.docs.length === 0 && v.pasted.length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

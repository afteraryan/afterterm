// Unit tests for recognising and resolving file paths in terminal output
// (edited files, Phase 3).
// Run directly on Node 24+ (strips types):
//   node src/renderer/filePaths.test.ts
// Exits 0 if all pass, 1 on any failure.

import { looksLikePath, splitLineSuffix, findPathCandidates, isBareName, resolveCandidates, matchChangedName, continuation, openKind, elidedTail } from './filePaths.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}
const show = (v: unknown) => JSON.stringify(v);
const texts = (line: string) => findPathCandidates(line).map(c => c.text);

console.log('what looks like a path');
check('relative with a slash', looksLikePath('src/main.ts'));
check('backslashes', looksLikePath('src\\renderer\\app.tsx'));
check('drive path', looksLikePath('D:\\Pitara\\Work\\a.md'));
check('./ and ../', looksLikePath('./a') && looksLikePath('../b/c'));
check('~/', looksLikePath('~/notes.md'));
check('a name with an extension', looksLikePath('index.tsx') && looksLikePath('CHANGELOG.md'));
check('a folder path', looksLikePath('docs/edited-files'));
check('a URL is not (the web-links addon has those)', !looksLikePath('https://example.com/a.md') && !looksLikePath('www.example.com'));
check('a version number is not', !looksLikePath('0.8.1') && !looksLikePath('v0.8.1'));
check('a plain word is not', !looksLikePath('worktree') && !looksLikePath('edited-files-design'));
check('a fraction is not', !looksLikePath('1/2'));
check('a single character is not', !looksLikePath('a'));
check('a lone .md is not a name with an extension', !looksLikePath('.md'));

console.log(':line suffixes');
check('path:line', show(splitLineSuffix('src/a.ts:42')) === show({ text: 'src/a.ts', line: 42 }));
check('path:line:col', show(splitLineSuffix('src/a.ts:42:7')) === show({ text: 'src/a.ts', line: 42 }));
check('a drive colon is not a line', show(splitLineSuffix('C:\\a.ts')) === show({ text: 'C:\\a.ts' }));

console.log('Claude Code tool lines');
{
  const c = findPathCandidates('● Update(src/renderer/components/Header/index.tsx)');
  check('Update(...) gives its path', c.length === 1 && c[0].text === 'src/renderer/components/Header/index.tsx' && c[0].tool === 'Update', show(c));
  check('the range covers exactly the path', '● Update(src/renderer/components/Header/index.tsx)'.slice(c[0].start, c[0].end) === 'src/renderer/components/Header/index.tsx');
}
check('Write(...) with the older ⏺ glyph', show(texts('⏺ Write(docs/design-04-edited-files.md)')) === show(['docs/design-04-edited-files.md']));
check('a tool path with spaces stays whole', show(texts('● Write(D:\\Pitara\\Learning with AI\\notes.md)')) === show(['D:\\Pitara\\Learning with AI\\notes.md']));
check('Read(...) too', texts('● Read(package.json)')[0] === 'package.json');
check('a tool line cut by Claude Code with no closing bracket', texts('● Update(src/renderer/components/Header/Header.css')[0] === 'src/renderer/components/Header/Header.css');
check('a bare name in a tool line', texts('● Update(index.tsx)')[0] === 'index.tsx');

console.log('paths inside a Bash command');
{
  const t = texts('● Bash(cat >> docs/bugs.md <<\'EOF\' …)');
  check('the redirect target', t.includes('docs/bugs.md'), show(t));
  check('the heredoc word is not a path', !t.includes("'EOF'") && !t.includes('EOF'));
}
check('cp source and target', show(texts('● Bash(cp src/a.ts src/b.ts)')) === show(['src/a.ts', 'src/b.ts']));

console.log('paths in reply text');
check('after "in"', show(texts('  I updated the header in src/renderer/components/Header/index.tsx.')) === show(['src/renderer/components/Header/index.tsx']));
check('in former backticks, sentence punctuation dropped', show(texts('  See CHANGELOG.md, then docs/to-verify.md; done.')) === show(['CHANGELOG.md', 'docs/to-verify.md']));
check('with a line number', (() => { const c = findPathCandidates('  at src/main.ts:1234 there'); return c[0].text === 'src/main.ts' && c[0].line === 1234; })());
check('in parentheses', show(texts('  (see docs/a.md)')) === show(['docs/a.md']));
check('in quotes', show(texts('  wrote "notes/todo.txt" just now')) === show(['notes/todo.txt']));
check('a URL in the same line is left alone', show(texts('  from https://x.com/a.md into docs/a.md')) === show(['docs/a.md']));
check('an ordinary sentence has none', texts('  All tests pass and the build is clean.').length === 0);
check('a trailing ellipsis dot is dropped', texts('  editing README.md...')[0] === 'README.md');

console.log('bare names');
check('index.tsx is bare', isBareName('index.tsx'));
check('src/index.tsx is not', !isBareName('src/index.tsx'));
check('C:x is not', !isBareName('C:\\x'));

console.log('resolving');
const ctx = { threadFolder: 'D:\\p\\.claude\\worktrees\\wt', projectFolder: 'D:\\p', home: 'C:\\Users\\A' };
check('relative: the chat folder, then the project folder', show(resolveCandidates('docs/a.md', ctx)) === show(['D:\\p\\.claude\\worktrees\\wt\\docs\\a.md', 'D:\\p\\docs\\a.md']));
check('absolute as written', show(resolveCandidates('d:/x/y.md', ctx)) === show(['D:\\x\\y.md']));
check('~ is the home folder', show(resolveCandidates('~/.claude/CLAUDE.md', ctx)) === show(['C:\\Users\\A\\.claude\\CLAUDE.md']));
check('Git Bash /c/ path', show(resolveCandidates('/c/Users/A/x.md', ctx)) === show(['C:\\Users\\A\\x.md']));
check('a POSIX path is not a Windows file', resolveCandidates('/usr/bin/env', ctx).length === 0);
check('./ and ../', show(resolveCandidates('../wt2/a.md', ctx)) === show(['D:\\p\\.claude\\worktrees\\wt2\\a.md', 'D:\\wt2\\a.md']));
check('same folder twice gives one candidate', resolveCandidates('a.md', { threadFolder: 'D:\\p', projectFolder: 'd:\\p' }).length === 1);
check('no folders known: nothing to try', resolveCandidates('a.md', {}).length === 0);

console.log('bare names and tool lines matched to the chat\'s own edits');
{
  const changed = [
    { path: 'D:\\p\\src\\Header\\index.tsx', at: 10_000 },
    { path: 'D:\\p\\src\\Home\\index.tsx', at: 20_000 },
    { path: 'D:\\p\\docs\\a.md', at: 500 },
  ];
  const edits = [
    { path: 'D:\\p\\src\\Header\\index.tsx', at: 10_000 },
    { path: 'D:\\p\\src\\Home\\index.tsx', at: 20_000 },
  ];
  const newest = matchChangedName('index.tsx', changed, edits);
  check('no time: the newest of two same names', newest?.path === 'D:\\p\\src\\Home\\index.tsx', show(newest));
  check('and it says one other shares the name', newest?.others === 1);
  check('a line that appeared right after the first edit opens the first', matchChangedName('index.tsx', changed, edits, 12_000)?.path === 'D:\\p\\src\\Header\\index.tsx');
  check('a line after the second edit opens the second', matchChangedName('index.tsx', changed, edits, 21_000)?.path === 'D:\\p\\src\\Home\\index.tsx');
  check('a name the chat did not change links nowhere', matchChangedName('main.ts', changed, edits) === null);
  check('case does not matter', matchChangedName('A.MD', changed, edits)?.path === 'D:\\p\\docs\\a.md');
  check('a tail cut mid-folder-name matches nothing', matchChangedName('eader/index.tsx', changed, edits) === null);
  check('a partial path narrows it', matchChangedName('Header/index.tsx', changed, edits)?.path === 'D:\\p\\src\\Header\\index.tsx');
  check('a line long after every edit falls back to the newest', matchChangedName('index.tsx', changed, edits, 10_000_000)?.path === 'D:\\p\\src\\Home\\index.tsx');
}

console.log('a path split over two lines');
{
  const cols = 42;
  const l1 = '  I wrote it to docs/edited-files/testing-';
  const l1c = l1.slice(0, cols);
  const cand = findPathCandidates(l1c).pop()!;
  const j = continuation(cand, l1c, cols, '  and-handoff.md for you.');
  check('joined when it runs to the edge and the next line goes on', j?.text === 'docs/edited-files/testing-and-handoff.md', show({ cand, j }));
  check('the second part\'s range', j?.nextStart === 2 && j?.nextEnd === 2 + 'and-handoff.md'.length);
  check('not joined when it stops short of the edge', continuation({ end: 20, text: 'docs/a' }, 'x'.repeat(20), cols, 'b.md') === null);
  check('not joined when the next line starts with a space-separated word only if it is a token', continuation(cand, l1c, cols, '   ') === null);
}

{
  // Claude Code's tool-result block wraps five columns short of the edge (seen at 112 columns).
  const cols = 112;
  const l1 = '  ⎿  Wrote 1 line to docs\\very-long-folder-name-for-wrapping-tests\\another-long-subfolder-name\\final-docume';
  const cand = findPathCandidates(l1).pop()!;
  const j = continuation(cand, l1, cols, '     nt-with-a-long-name.md');
  check('a tool block wrapped short of the edge still joins', j?.text === 'docs\\very-long-folder-name-for-wrapping-tests\\another-long-subfolder-name\\final-document-with-a-long-name.md', show({ end: cand.end, j }));
}

console.log('paths Claude Code shortened with …');
check('the tail after the ellipsis', elidedTail('docs\\very-long\\another-long-subfolde…\\final.md') === 'final.md');
check('no ellipsis: null', elidedTail('docs\\a.md') === null);
check('an ellipsis at the end gives nothing to match', elidedTail('docs\\a…') === null);
check('the shortened tool line is found whole', texts('● Write(docs\\very-long-folder-name\\another-long-subfolde…\\final-document.md)')[0] === 'docs\\very-long-folder-name\\another-long-subfolde…\\final-document.md');

console.log('how it opens');
check('markdown in the editor', openKind('D:\\a.md', false) === 'editor');
check('code in the editor', openKind('D:\\a.ts', false) === 'editor');
check('an image in its app', openKind('D:\\shot.PNG', false) === 'default');
check('a folder in Explorer', openKind('D:\\docs', true) === 'explorer');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

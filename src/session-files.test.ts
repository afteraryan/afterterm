// Unit tests for the session files parser: classification, paths, edits from
// Claude's tools and subagents, pasted images and command windows.
// Run directly on Node 24+ (strips types):
//   node src/session-files.test.ts
// Exits 0 if all pass, 1 on any failure.

import {
  baseName, extensionOf, fileKind, normalizePath, pathKey, isInside, isAbsolutePath,
  newParseState, ingestLine, ingestText, sessionFilesView, mergeChanged,
  pastedTempPath, ownsTempFile, MAX_EDIT_EVENTS, isSafeForDefaultApp,
  cleanUrl, transcriptUrls, MAX_URLS,
  type ChangedFile,
} from './session-files.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}
const show = (v: unknown) => JSON.stringify(v);

const CWD = 'D:\\Pitara\\Work\\afterterm';
const T0 = Date.parse('2026-09-25T10:00:00.000Z');
const ts = (s: number) => new Date(T0 + s * 1000).toISOString();

// Line builders modelled on the shapes seen in real transcripts (build-notes.md).
const toolUse = (id: string, name: string, input: Record<string, unknown>, s: number, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'assistant', isSidechain: false, timestamp: ts(s), cwd: CWD, ...extra, message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
const toolResult = (id: string, s: number, toolUseResult: unknown = {}, isError = false, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'user', isSidechain: false, timestamp: ts(s), cwd: CWD, ...extra, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok', ...(isError ? { is_error: true } : {}) }] }, toolUseResult });
const paste = (uuid: string, s: number, n: number[], useIds = true) =>
  JSON.stringify({
    type: 'user', isSidechain: false, uuid, timestamp: ts(s), cwd: CWD,
    ...(useIds ? { imagePasteIds: n } : {}),
    message: { role: 'user', content: [
      { type: 'text', text: `look at this ${n.map(x => `[Image #${x}]`).join(' ')}` },
      ...n.map(() => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } })),
    ] },
  });

console.log('what may go to Windows\' default app');
// Everything Windows can run, plus code and config. None may ever go: the default
// app for these is the program that runs them, or no app at all.
for (const ext of [
  'exe', 'com', 'bat', 'cmd', 'scr', 'pif', 'msi', 'msp', 'msu', 'msix', 'appx', 'application', 'appref-ms', 'gadget', 'cpl', 'msc', 'dll', 'sys', 'lnk', 'url', 'website', 'hta', 'reg', 'inf', 'scf',
  'ps1', 'psm1', 'psd1', 'vbs', 'vbe', 'js', 'jse', 'mjs', 'cjs', 'wsf', 'wsh', 'ws', 'jar', 'jnlp', 'py', 'pyw', 'pyc', 'rb', 'pl', 'php', 'lua', 'sh', 'bash', 'ahk', 'au3', 'pwa',
  'ts', 'tsx', 'jsx', 'mts', 'css', 'json', 'yaml', 'yml', 'toml', 'xml', 'env', 'md', 'mdx', 'docm', 'xlsm', 'pptm', 'iso', 'img', 'vhd',
]) {
  check(`.${ext} never goes to the default app`, !isSafeForDefaultApp(`D:\\p\\file.${ext}`));
  check(`.${ext.toUpperCase()} neither`, !isSafeForDefaultApp(`D:\\p\\file.${ext.toUpperCase()}`));
}
for (const name of ['clip.mp4', 'CLIP.MP4', 'song.mp3', 'page.html', 'report.pdf', 'sheet.xlsx', 'shot.png', 'notes.txt', 'run.log', 'a.tar.gz']) {
  check(`${name} may`, isSafeForDefaultApp(`D:\\p\\${name}`));
}
check('only the real ending counts', !isSafeForDefaultApp('D:\\p\\clip.mp4.bat'));
check('a video named like a script is a video', isSafeForDefaultApp('D:\\p\\run.bat.mp4'));
check('an NTFS stream is not the type it is named as', !isSafeForDefaultApp('D:\\p\\setup.exe:x.mp4'));
check('a trailing dot is not the type', !isSafeForDefaultApp('D:\\p\\clip.mp4.'));
check('a trailing space is not the type', !isSafeForDefaultApp('D:\\p\\clip.mp4 '));
check('no ending at all', !isSafeForDefaultApp('D:\\p\\Dockerfile'));
check('a dotfile', !isSafeForDefaultApp('D:\\p\\.env'));
check('the folder\'s ending does not count', !isSafeForDefaultApp('D:\\clip.mp4\\run.bat'));

console.log('classification');
check('md is a document', fileKind('docs/a.md') === 'doc');
check('MDX upper case is a document', fileKind('C:\\x\\Page.MDX') === 'doc');
check('txt is a document', fileKind('notes.txt') === 'doc');
check('ts is code', fileKind('src/main.ts') === 'code');
check('html is code (design choice)', fileKind('index.html') === 'code');
check('pdf is code (design choice)', fileKind('a.pdf') === 'code');
check('png is an image', fileKind('shot.png') === 'image');
check('svg is an image', fileKind('icon.svg') === 'image');
check('no extension is code', fileKind('Makefile') === 'code');
check('.gitignore has no extension', extensionOf('.gitignore') === '' && fileKind('.gitignore') === 'code');
check('baseName on backslashes', baseName('C:\\a\\b\\c.md') === 'c.md');
check('baseName on slashes', baseName('a/b/c.md') === 'c.md');

console.log('paths');
check('absolute drive path', isAbsolutePath('C:\\x') && isAbsolutePath('c:/x'));
check('UNC path is absolute', isAbsolutePath('\\\\wsl$\\Ubuntu\\home'));
check('msys path is absolute', isAbsolutePath('/c/Users'));
check('relative is not absolute', !isAbsolutePath('src/a.ts') && !isAbsolutePath('./a'));
check('forward slashes become backslashes', normalizePath('D:/Pitara/Work/a.md') === 'D:\\Pitara\\Work\\a.md');
check('lower drive letter upper-cased', normalizePath('d:\\x\\y') === 'D:\\x\\y');
check('msys path converted', normalizePath('/d/Pitara/Work') === 'D:\\Pitara\\Work', normalizePath('/d/Pitara/Work'));
check('relative resolved against base', normalizePath('docs/a.md', CWD) === 'D:\\Pitara\\Work\\afterterm\\docs\\a.md');
check('dot and dot-dot segments resolved', normalizePath('.\\src\\..\\docs\\a.md', CWD) === 'D:\\Pitara\\Work\\afterterm\\docs\\a.md');
check('trailing separator dropped', normalizePath('D:\\x\\') === 'D:\\x');
check('drive root kept', normalizePath('C:\\') === 'C:\\');
check('UNC kept', normalizePath('\\\\server\\share\\a.md') === '\\\\server\\share\\a.md', normalizePath('\\\\server\\share\\a.md'));
check('key ignores case and separators', pathKey('D:/Pitara/A.md') === pathKey('d:\\pitara\\a.MD'));
check('inside: a file in the folder', isInside('D:\\Pitara\\Work\\afterterm\\docs\\a.md', CWD));
check('inside: the folder itself', isInside(CWD.toLowerCase(), CWD));
check('not inside: a sibling with the same prefix', !isInside('D:\\Pitara\\Work\\afterterm2\\a.md', CWD));
check('empty path is not inside anything', !isInside('', CWD));

console.log('edits from Claude\'s tools');
{
  const s = newParseState();
  ingestText(s, [
    toolUse('t1', 'Write', { file_path: 'D:\\Pitara\\Work\\afterterm\\docs\\design.md', content: 'x' }, 1),
    toolResult('t1', 2, { type: 'create', filePath: 'D:\\Pitara\\Work\\afterterm\\docs\\design.md' }),
    toolUse('t2', 'Edit', { file_path: 'D:\\Pitara\\Work\\afterterm\\src\\main.ts', old_string: 'a', new_string: 'b' }, 3),
    toolResult('t2', 4, { filePath: 'D:\\Pitara\\Work\\afterterm\\src\\main.ts' }),
    toolUse('t3', 'Edit', { file_path: 'd:/pitara/work/afterterm/docs/design.md' }, 5),
    toolResult('t3', 6, {}),
    toolUse('t4', 'MultiEdit', { file_path: 'src/relative.ts' }, 7),
    toolResult('t4', 8, {}),
    toolUse('t5', 'NotebookEdit', { notebook_path: 'D:\\n\\a.ipynb' }, 9),
    toolResult('t5', 10, {}),
    toolUse('t6', 'Edit', { file_path: 'D:\\Pitara\\Work\\afterterm\\failed.md' }, 11),
    toolResult('t6', 12, 'Error: string not found', true),
    toolUse('t7', 'Write', { file_path: 'D:\\Pitara\\Work\\afterterm\\shot.png' }, 13),
    toolResult('t7', 14, { type: 'create' }),
    toolUse('t8', 'Write', { file_path: 'D:\\Pitara\\Work\\afterterm\\pending.md' }, 15),
    toolUse('t9', 'Read', { file_path: 'D:\\Pitara\\Work\\afterterm\\read-only.md' }, 16),
    toolResult('t9', 17, {}),
  ].join('\n'));
  const v = sessionFilesView(s);
  const paths = v.changed.map(f => f.path);
  check('one row per path (case-insensitive dedupe)', paths.filter(p => p.toLowerCase().endsWith('design.md')).length === 1, show(paths));
  check('newest first', paths[0] === 'D:\\n\\a.ipynb', show(paths));
  const design = v.changed.find(f => f.path.toLowerCase().endsWith('design.md'))!;
  check('created flag survives a later Edit', design.created === true);
  check('newest time kept', design.at === T0 + 5000, String(design.at - T0));
  check('newest spelling kept', design.path === 'D:\\pitara\\work\\afterterm\\docs\\design.md' || design.path.endsWith('design.md'));
  check('document kind', design.kind === 'doc');
  check('an Edit does not mark created', v.changed.find(f => f.path.endsWith('main.ts'))!.created === false);
  check('relative path resolved against the entry cwd', paths.includes('D:\\Pitara\\Work\\afterterm\\src\\relative.ts'), show(paths));
  check('NotebookEdit read from notebook_path', paths.includes('D:\\n\\a.ipynb'));
  check('a failed edit is not listed', !paths.some(p => p.endsWith('failed.md')));
  check('an image Claude made is left out', !paths.some(p => p.endsWith('shot.png')));
  check('an edit still waiting for its result is not listed', !paths.some(p => p.endsWith('pending.md')));
  check('Read is not an edit', !paths.some(p => p.endsWith('read-only.md')));
  check('source is tool', v.changed.every(f => f.source === 'tool'));
  check('edit events keep every successful edit, image included', v.edits.length === 6, String(v.edits.length));
  check('the pending edit lands once its result arrives', (() => {
    ingestLine(s, toolResult('t8', 20, { type: 'create' }));
    return sessionFilesView(s).changed[0].path.endsWith('pending.md') && sessionFilesView(s).changed[0].created;
  })());
}

console.log('subagents');
{
  const s = newParseState();
  ingestText(s, [
    toolUse('a1', 'Write', { file_path: 'D:\\x\\report.md' }, 1, { isSidechain: true }),
    toolResult('a1', 2, { type: 'create' }, false, { isSidechain: true }),
  ].join('\n'), true);
  const v = sessionFilesView(s);
  check('a subagent document is listed', v.changed.length === 1 && v.changed[0].path === 'D:\\x\\report.md');
  check('marked as the subagent\'s', v.changed[0].source === 'subagent');
  check('a sidechain line in the main file counts as a subagent too', (() => {
    const s2 = newParseState();
    ingestText(s2, [toolUse('b1', 'Edit', { file_path: 'D:\\y.md' }, 1, { isSidechain: true }), toolResult('b1', 2, {}, false, { isSidechain: true })].join('\n'));
    return sessionFilesView(s2).changed[0]?.source === 'subagent';
  })());
  check('the chat\'s own edit outranks its subagent\'s for the same file', (() => {
    ingestText(s, [toolUse('a2', 'Edit', { file_path: 'D:\\x\\report.md' }, 3), toolResult('a2', 4, {})].join('\n'));
    return sessionFilesView(s).changed[0].source === 'tool';
  })());
}

console.log('pasted images');
{
  const s = newParseState();
  ingestText(s, [
    paste('u1', 10, [3]),
    paste('u2', 20, [4, 5]),
    paste('u3', 30, [6], false),
  ].join('\n'));
  const v = sessionFilesView(s);
  check('four images', v.pasted.length === 4, show(v.pasted));
  check('newest first', v.pasted[0].n === 6, show(v.pasted.map(p => p.n)));
  check('numbers from imagePasteIds', v.pasted.some(p => p.n === 4) && v.pasted.some(p => p.n === 5));
  check('numbers from the [Image #N] text when imagePasteIds is absent', v.pasted[0].n === 6);
  check('time from the entry', v.pasted[0].at === T0 + 30000);
  check('media type kept', v.pasted[0].mediaType === 'image/png');
  check('cwd kept for the temp copy', v.pasted[0].cwd === CWD);
  check('offset not exposed to the renderer', !('offset' in v.pasted[0]));
  check('a line read twice does not duplicate', (() => { ingestLine(s, paste('u1', 10, [3])); return sessionFilesView(s).pasted.length === 4; })());
  check('images do not count as changed files', v.changed.length === 0);
  check('a single paste counts once', sessionFilesView(s).pasted.every(p => p.times === 1));
  check('the same image pasted again (same number, same bytes) is listed once, counted twice', (() => {
    ingestLine(s, paste('u4', 40, [3]));
    const same = sessionFilesView(s).pasted.filter(p => p.n === 3);
    return same.length === 1 && same[0].times === 2;
  })());
  check('it takes the time of its latest paste, so it sorts first', (() => {
    const v2 = sessionFilesView(s).pasted;
    return v2[0].n === 3 && v2[0].at === T0 + 40000;
  })());
  check('a third paste counts three', (() => {
    ingestLine(s, paste('u4b', 45, [3]));
    return sessionFilesView(s).pasted.find(p => p.n === 3)?.times === 3;
  })());
  check('the counted image still owns the temp file (it is the newest #3)', (() => {
    const k = sessionFilesView(s).pasted.find(p => p.n === 3)!.key;
    return ownsTempFile(s.pasted, k);
  })());
  check('the same number with different bytes is a second image', (() => {
    ingestLine(s, paste('u5', 50, [3]).replace('iVBORw0KGgo=', 'iVBORw0KGgoAAAA='));
    return sessionFilesView(s).pasted.filter(p => p.n === 3).length === 2;
  })());
  const s2 = newParseState();
  ingestText(s2, [paste('side', 5, [1]).replace('"isSidechain":false', '"isSidechain":true')].join('\n'));
  check('an image inside a subagent is not a paste', sessionFilesView(s2).pasted.length === 0);
  const s3 = newParseState();
  const readImage = JSON.stringify({ type: 'user', timestamp: ts(1), message: { content: [{ type: 'tool_result', tool_use_id: 'r', content: [{ type: 'image', source: { type: 'base64', data: 'x' } }] }] } });
  ingestText(s3, readImage);
  check('an image a tool returned (a screenshot) is not a paste', sessionFilesView(s3).pasted.length === 0);
}

console.log('temp copies of pasted images');
check('temp path shape', pastedTempPath('C:\\T\\', 'D--x', 'sid', 3) === 'C:\\T\\claude\\D--x\\sid\\images\\3.png');
{
  const list = [{ key: 'a', n: 1, at: 10 }, { key: 'b', n: 1, at: 20 }, { key: 'c', n: 2, at: 5 }];
  check('the newest paste of a number owns the temp file', ownsTempFile(list, 'b'));
  check('an older paste of the same number does not', !ownsTempFile(list, 'a'));
  check('a unique number owns it', ownsTempFile(list, 'c'));
  check('an unknown key owns nothing', !ownsTempFile(list, 'zz'));
}

console.log('shell windows');
{
  const s = newParseState();
  ingestText(s, [
    toolUse('s1', 'Bash', { command: 'cat > docs/a.md <<EOF' }, 1),
    toolResult('s1', 4, { stdout: '' }),
    toolUse('s2', 'PowerShell', { command: 'Set-Content x.md hi' }, 10),
  ].join('\n'));
  check('two windows', s.windows.length === 2);
  check('a finished command has its end', s.windows[0].start === T0 + 1000 && s.windows[0].end === T0 + 4000);
  check('a running command is open-ended', s.windows[1].end === null);
  check('the window carries the command\'s cwd', s.windows[0].cwd === CWD);
  ingestLine(s, toolResult('s2', 12, {}));
  check('the result closes it', s.windows[1].end === T0 + 12000);
  check('commands are not changed files', sessionFilesView(s).changed.length === 0);
}

console.log('robustness');
{
  const s = newParseState();
  ingestText(s, ['', 'not json', '{"type":"assistant","message":{"content":"x"}}', '{"partial', '{"type":"tool_use"']);
  check('junk and partial lines are ignored', sessionFilesView(s).changed.length === 0);
  check('latest cwd from parsed lines', (() => { ingestLine(s, toolUse('c1', 'Bash', { command: 'ls' }, 1)); return s.latestCwd === CWD; })());
  const s2 = newParseState();
  const lines: string[] = [];
  for (let i = 0; i < MAX_EDIT_EVENTS + 10; i++) {
    lines.push(toolUse(`e${i}`, 'Edit', { file_path: `D:\\f${i % 3}.ts` }, i), toolResult(`e${i}`, i, {}));
  }
  ingestText(s2, lines.join('\n'));
  check('edit events are capped', s2.edits.length === MAX_EDIT_EVENTS);
  check('the list still has one row per path', sessionFilesView(s2).changed.length === 3);
}

console.log('files the chat read or sent (for links)');
{
  const s = newParseState();
  ingestText(s, [
    toolUse('r1', 'Read', { file_path: 'docs\\a.md' }, 1),
    toolUse('r2', 'SendUserFile', { files: ['docs/screenshots/03-operator-home.png', 'D:\\x\\report.pdf'], status: 'normal' }, 2),
    toolUse('r3', 'Write', { file_path: 'D:\\p\\made.png' }, 3),
    toolResult('r3', 4, { type: 'create' }),
  ].join('\n'));
  const v = sessionFilesView(s);
  check('a Read path is a ref, resolved against the cwd', v.refs.some(r => r.path === 'D:\\Pitara\\Work\\afterterm\\docs\\a.md'), show(v.refs));
  check('every file SendUserFile sent is a ref', v.refs.some(r => r.path.endsWith('03-operator-home.png')) && v.refs.some(r => r.path === 'D:\\x\\report.pdf'));
  check('refs are not changed files', v.changed.length === 0, show(v.changed));
  check('an image Claude wrote stays out of the list but is an edit event, so it links', v.edits.some(e => e.path === 'D:\\p\\made.png'));
  check('a Read with no path adds nothing', (() => { ingestLine(s, toolUse('r4', 'Read', {}, 5)); return sessionFilesView(s).refs.length === 3; })());
}

console.log('mergeChanged');
{
  const a: ChangedFile[] = [{ path: 'D:\\a.md', kind: 'doc', created: false, at: 10, source: 'tool' }];
  const b: ChangedFile[] = [
    { path: 'd:\\A.md', kind: 'doc', created: true, at: 20, source: 'command' },
    { path: 'D:\\b.ts', kind: 'code', created: true, at: 5, source: 'command' },
  ];
  const m = mergeChanged(a, b);
  check('one row per path across lists', m.length === 2, show(m));
  check('newest first', m[0].path.toLowerCase() === 'd:\\a.md' && m[1].path === 'D:\\b.ts');
  check('created from either', m[0].created === true);
  check('newest time', m[0].at === 20);
  check('tool outranks command', m[0].source === 'tool');
  check('view merges command files in', sessionFilesView(newParseState(), b).changed.length === 2);
}

console.log('excluded folders');
{
  const s = newParseState();
  ingestText(s, [
    toolUse('x1', 'Write', { file_path: 'C:\\Users\\A\\AppData\\Local\\Temp\\claude\\D--p\\sid\\scratchpad\\scan.py' }, 1),
    toolResult('x1', 2, { type: 'create' }),
    toolUse('x2', 'Write', { file_path: 'D:\\p\\docs\\a.md' }, 3),
    toolResult('x2', 4, { type: 'create' }),
  ].join('\n'));
  const tmpClaude = 'C:\\Users\\A\\AppData\\Local\\Temp\\claude';
  const v = sessionFilesView(s, [{ path: `${tmpClaude}\\x\\cmd.txt`, kind: 'doc', created: true, at: 9, source: 'command' }], [tmpClaude]);
  check('a scratchpad script under Claude\'s temp folder is left out', !v.changed.some(f => f.path.includes('scratchpad')), show(v.changed));
  check('a command-made file there is left out too', !v.changed.some(f => f.path.endsWith('cmd.txt')));
  check('the rest stays', v.changed.length === 1 && v.changed[0].path === 'D:\\p\\docs\\a.md');
  check('no exclusions: everything', sessionFilesView(s).changed.length === 2);
  check('the edit events keep it (a link to it still resolves)', v.edits.length === 2);
}

console.log('\nweb links in the transcript (AFT-61)');
{
  check('sentence full stop off', cleanUrl('https://a.b/c.') === 'https://a.b/c');
  check('a closing bracket it never opened off', cleanUrl('https://a.b/c)') === 'https://a.b/c');
  check('both, in either order', cleanUrl('https://a.b/c).') === 'https://a.b/c' && cleanUrl('https://a.b/c.)') === 'https://a.b/c');
  check('a bracket it opened stays', cleanUrl('https://w.org/A_(b)') === 'https://w.org/A_(b)');
  check('markdown bold and a backtick off', cleanUrl('https://a.b/c**') === 'https://a.b/c' && cleanUrl('https://a.b/c`') === 'https://a.b/c');
  check('a query is left alone', cleanUrl('https://a.b/c?x=1&y=2') === 'https://a.b/c?x=1&y=2');

  const U = 'https://example.com/authorize?response_type=code&client_id=https%3A%2F%2Fclaude.ai%2Foauth%2Fmetadata&code_challenge=kb6&code_challenge_method=S256&state=ONE';
  const U2 = U.replace('state=ONE', 'state=TWO');
  const s = newParseState();
  const line = (o: unknown) => JSON.stringify(o);
  ingestText(s, [
    line({ type: 'user', message: { role: 'user', content: `Open ${U}.` } }),
    line({ type: 'assistant', message: { content: [{ type: 'text', text: `[Sign in](${U})\nthen https://docs.example.org/guide` }] } }),
    line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: `echo "${U2}"` } }] } }),
    line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: `${U2}\nhttps://after.newline.example/x` }] } }),
    line({ type: 'progress', data: 'https://intranet and http://localhost:5173/app/x and https://localhostile/x' }),
  ].join('\n'));
  check('a prompt\'s link, without its full stop', s.urls.has(U));
  check('a markdown link\'s target, without the bracket', [...s.urls].every(u => !u.endsWith(')')));
  check('a reply\'s bare link', s.urls.has('https://docs.example.org/guide'));
  check('a tool call\'s and its output\'s link, not run into the escaped newline', s.urls.has(U2) && s.urls.has('https://after.newline.example/x'), show([...s.urls]));
  check('a link with no dotted host is not kept', !s.urls.has('https://intranet') && !s.urls.has('https://localhostile/x'), show([...s.urls]));
  check('a localhost link is kept (a dev server\'s)', s.urls.has('http://localhost:5173/app/x'));
  check('kept once each', [...s.urls].filter(u => u === U).length === 1);
  const got = transcriptUrls(s, 'https://example.com/authorize?response_type=code&cl');
  check('by prefix, the most recently written first', show(got) === show([U2, U]), show(got));
  check('nothing for a prefix it never saw', transcriptUrls(s, 'https://nowhere.example/').length === 0);
  ingestText(s, line({ type: 'user', message: { content: `again ${U}` } }));
  check('written again, it is the most recent', transcriptUrls(s, 'https://example.com/authorize')[0] === U);
  check('the limit holds', transcriptUrls(s, 'https://', 1).length === 1);

  const big = newParseState();
  for (let i = 0; i < MAX_URLS + 10; i++) ingestLine(big, line({ type: 'user', message: { content: `https://example.com/p${i}` } }));
  check('no more than MAX_URLS kept', big.urls.size === MAX_URLS);
  check('the oldest went first', !big.urls.has('https://example.com/p0') && big.urls.has(`https://example.com/p${MAX_URLS + 9}`));
  check('a shortened copy ending in "…" is never kept, as the character or as \\u2026', (() => {
    const t = newParseState();
    ingestLine(t, `{"type":"x","a":"see https://example.com/long/pa…","b":"https://example.com/other/sh\\u2026 and https://example.com/whole/one"}`);
    return t.urls.size === 1 && t.urls.has('https://example.com/whole/one');
  })());
  check('a link in a line the pre-check skips is still read', (() => {
    const t = newParseState();
    ingestLine(t, line({ type: 'system', content: 'see https://status.example.com/now' }));
    return t.urls.has('https://status.example.com/now');
  })());
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

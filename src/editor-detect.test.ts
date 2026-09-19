// Unit tests for editor detection: the four-step search order, shim resolution,
// de-duplication and the invalid editorPath case. Run directly on Node 24+
// (strips types):
//   node src/editor-detect.test.ts
// Exits 0 if all pass, 1 on any failure.

import { detectEditors, isKnownEditorExe } from './editor-detect.ts';
import type { DetectDeps } from './editor-detect.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}
const show = (v: unknown) => JSON.stringify(v);

const LOCAL = 'C:\\Users\\a\\AppData\\Local';
const PROGRAMS = 'C:\\Program Files';

// A fake filesystem: every entry is a path, mapped to 'file' or 'dir'. Lookups
// are case-insensitive, like Windows.
interface FakeWorld {
  files?: Record<string, string>;   // path -> text contents (all files)
  dirs?: string[];                  // directory paths
  whereCode?: string[];
  registry?: { displayName: string; installLocation?: string; displayIcon?: string }[];
  env?: Record<string, string | undefined>;
}

function deps(world: FakeWorld): DetectDeps {
  const files = new Map<string, string>();
  for (const [p, text] of Object.entries(world.files ?? {})) files.set(p.toLowerCase(), text);
  const dirs = new Set((world.dirs ?? []).map(d => d.toLowerCase()));
  return {
    env: world.env ?? { LOCALAPPDATA: LOCAL, ProgramFiles: PROGRAMS, USERPROFILE: 'C:\\Users\\a' },
    exists: (p) => files.has(p.toLowerCase()) || dirs.has(p.toLowerCase()),
    isFile: (p) => files.has(p.toLowerCase()),
    listDir: (p) => {
      const prefix = p.toLowerCase().replace(/\\+$/, '') + '\\';
      const names: string[] = [];
      for (const key of files.keys()) {
        if (key.startsWith(prefix) && !key.slice(prefix.length).includes('\\')) {
          names.push(key.slice(prefix.length));
        }
      }
      return names;
    },
    readText: (p) => files.get(p.toLowerCase()) ?? null,
    whereCode: () => world.whereCode ?? [],
    registryEditors: () => world.registry ?? [],
  };
}

const VSCODE_USER = `${LOCAL}\\Programs\\Microsoft VS Code\\Code.exe`;
const VSCODE_SYSTEM = `${PROGRAMS}\\Microsoft VS Code\\Code.exe`;
const INSIDERS_USER = `${LOCAL}\\Programs\\Microsoft VS Code Insiders\\Code - Insiders.exe`;
const CURSOR = `${LOCAL}\\Programs\\cursor\\Cursor.exe`;
const WINDSURF = `${LOCAL}\\Programs\\Windsurf\\Windsurf.exe`;

console.log('\neditor-detect: editorPath from prefs.json\n');
{
  const picked = 'D:\\Portable\\VSCode\\Code.exe';
  const result = detectEditors(picked, deps({
    files: { [picked]: '', [VSCODE_USER]: '' },
    whereCode: [`${LOCAL}\\Programs\\Microsoft VS Code\\bin\\code.cmd`],
  }));
  check('a prefs editorPath that is a file is the primary editor',
    result.editors[0]?.path === picked, show(result.editors[0]));
  check('the prefs editor carries source prefs', result.editors[0]?.source === 'prefs');
  check('the prefs editor keeps its product from the exe name', result.editors[0]?.product === 'vscode');
  check('detection still lists the editors found by the later steps',
    result.editors.length === 2 && result.editors[1].path === VSCODE_USER, show(result.editors));
  check('a valid prefs path is not reported invalid', result.invalidPrefsPath === false);
}

{
  const deleted = 'D:\\Portable\\VSCode\\Code.exe';
  const shim = `${LOCAL}\\Programs\\Microsoft VS Code\\bin\\code.cmd`;
  const result = detectEditors(deleted, deps({
    files: { [shim]: '', [VSCODE_USER]: '' },
    whereCode: [shim],
  }));
  check('a deleted prefs editorPath falls through to the PATH hit',
    result.editors[0]?.path === VSCODE_USER && result.editors[0]?.source === 'path', show(result.editors));
  check('a deleted prefs editorPath is not reported invalid', result.invalidPrefsPath === false);
}

{
  const folder = 'D:\\Portable\\VSCode';
  const result = detectEditors(folder, deps({
    dirs: [folder],
    files: { [`${folder}\\Code.exe`]: '' },
  }));
  check('a prefs folder holding Code.exe is accepted',
    result.editors[0]?.path === `${folder}\\Code.exe` && result.editors[0]?.source === 'prefs',
    show(result.editors));
  check('an accepted prefs folder is not reported invalid', result.invalidPrefsPath === false);
}

{
  const folder = 'D:\\Documents';
  const result = detectEditors(folder, deps({
    dirs: [folder],
    files: { [`${folder}\\notes.txt`]: '', [VSCODE_USER]: '' },
  }));
  check('a prefs folder with no known editor exe is reported invalid', result.invalidPrefsPath === true);
  check('the rest of the search still runs after an invalid prefs folder',
    result.editors.length === 1 && result.editors[0].path === VSCODE_USER, show(result.editors));
}

{
  const picked = 'D:\\Tools\\Zed\\zed.exe';
  const result = detectEditors(picked, deps({ files: { [picked]: '' } }));
  check('an unknown exe picked by hand has product other', result.editors[0]?.product === 'other');
  check('an unknown exe is named after its file', result.editors[0]?.name === 'zed', show(result.editors[0]));
}

console.log('\neditor-detect: the code command\n');
{
  const shim = `${LOCAL}\\Programs\\Microsoft VS Code\\bin\\code.cmd`;
  const result = detectEditors(undefined, deps({
    files: { [shim]: '@echo off\r\n"%~dp0..\\Code.exe" %*\r\n', [VSCODE_USER]: '' },
    whereCode: [shim],
  }));
  check('a code.cmd shim resolves to the exe one level up', result.editors[0]?.path === VSCODE_USER, show(result.editors));
  check('the resolved shim has product vscode', result.editors[0]?.product === 'vscode');
  check('the resolved shim has source path', result.editors[0]?.source === 'path');
}

{
  const shim = `${LOCAL}\\Programs\\cursor\\resources\\app\\bin\\code.cmd`;
  const result = detectEditors(undefined, deps({
    files: { [shim]: '', [CURSOR]: '' },
    whereCode: [shim],
  }));
  check('a Cursor shim three levels down resolves to Cursor.exe', result.editors[0]?.path === CURSOR, show(result.editors));
  check('a code command that opens Cursor is labelled Cursor',
    result.editors[0]?.product === 'cursor' && result.editors[0]?.name === 'Cursor', show(result.editors[0]));
}

{
  const alias = 'C:\\Users\\a\\AppData\\Local\\Microsoft\\WindowsApps\\code.exe';
  const result = detectEditors(undefined, deps({ whereCode: [alias] }));
  check('a Store app execution alias is used as it stands',
    result.editors.length === 1 && result.editors[0].path === alias, show(result.editors));
  check('the Store alias has product vscode', result.editors[0]?.product === 'vscode');
}

{
  const first = `${LOCAL}\\Programs\\cursor\\resources\\app\\bin\\code.cmd`;
  const second = `${LOCAL}\\Programs\\Microsoft VS Code\\bin\\code.cmd`;
  const result = detectEditors(undefined, deps({
    files: { [first]: '', [second]: '', [CURSOR]: '', [VSCODE_USER]: '' },
    whereCode: [first, second],
  }));
  check('with two code commands on PATH the first one is primary',
    result.editors[0]?.path === CURSOR, show(result.editors));
  check('the second code command is still listed',
    result.editors[1]?.path === VSCODE_USER, show(result.editors));
}

{
  const shim = 'D:\\odd\\layout\\shims\\code.cmd';
  const exe = 'D:\\odd\\layout\\Windsurf.exe';
  const result = detectEditors(undefined, deps({
    files: { [shim]: '@echo off\r\n"%~dp0..\\Windsurf.exe" %*\r\n', [exe]: '' },
    whereCode: [shim],
  }));
  check('a shim in an unusual layout is resolved by reading it',
    result.editors[0]?.path === exe && result.editors[0]?.product === 'windsurf', show(result.editors));
}

{
  const shim = 'D:\\broken\\bin\\code.cmd';
  const result = detectEditors(undefined, deps({ files: { [shim]: 'nothing useful here' }, whereCode: [shim] }));
  check('a shim that resolves to nothing is skipped', result.editors.length === 0, show(result.editors));
}

console.log('\neditor-detect: standard install folders\n');
{
  const result = detectEditors(undefined, deps({
    files: {
      [VSCODE_SYSTEM]: '', [INSIDERS_USER]: '', [CURSOR]: '', [WINDSURF]: '', [VSCODE_USER]: '',
    },
  }));
  const paths = result.editors.map(e => e.path);
  check('with no code on PATH the install folders are searched in the stated order',
    show(paths) === show([VSCODE_USER, VSCODE_SYSTEM, INSIDERS_USER, CURSOR, WINDSURF]), show(paths));
  check('install folder hits carry source install',
    result.editors.every(e => e.source === 'install'));
  check('the Insiders exe is identified as Insiders',
    result.editors[2]?.product === 'vscode-insiders' && result.editors[2]?.name === 'VS Code Insiders');
}

{
  const result = detectEditors(undefined, deps({
    files: { [CURSOR]: '' },
    env: { LOCALAPPDATA: LOCAL },
  }));
  check('a missing ProgramFiles variable does not stop the search',
    result.editors.length === 1 && result.editors[0].path === CURSOR, show(result.editors));
}

console.log('\neditor-detect: the uninstall registry\n');
{
  const custom = 'E:\\Apps\\VS Code\\Code.exe';
  const result = detectEditors(undefined, deps({
    files: { [custom]: '' },
    registry: [
      { displayName: 'Git', installLocation: 'C:\\Program Files\\Git' },
      { displayName: 'Microsoft Visual Studio Code (User)', installLocation: 'E:\\Apps\\VS Code' },
    ],
  }));
  check('the registry finds an install in a custom folder',
    result.editors.length === 1 && result.editors[0].path === custom, show(result.editors));
  check('a registry hit carries source registry', result.editors[0]?.source === 'registry');
}

{
  const custom = 'E:\\Apps\\VS Code Insiders\\Code - Insiders.exe';
  const result = detectEditors(undefined, deps({
    files: { [custom]: '' },
    registry: [{ displayName: 'Microsoft Visual Studio Code Insiders', displayIcon: `${custom},0` }],
  }));
  check('DisplayIcon is used when InstallLocation is missing, with the icon index stripped',
    result.editors[0]?.path === custom, show(result.editors));
  check('an Insiders registry entry is identified as Insiders',
    result.editors[0]?.product === 'vscode-insiders');
}

console.log('\neditor-detect: nothing found, and duplicates\n');
{
  const result = detectEditors(undefined, deps({}));
  check('nothing found gives an empty list', result.editors.length === 0, show(result.editors));
  check('nothing found is not an invalid prefs path', result.invalidPrefsPath === false);
}

{
  const shim = `${LOCAL}\\Programs\\Microsoft VS Code\\bin\\code.cmd`;
  const result = detectEditors(VSCODE_USER, deps({
    files: { [shim]: '', [VSCODE_USER]: '' },
    whereCode: [shim],
    registry: [{ displayName: 'Microsoft Visual Studio Code (User)', installLocation: `${LOCAL}\\Programs\\Microsoft VS Code` }],
  }));
  check('one editor found by all four steps is listed once',
    result.editors.length === 1, show(result.editors));
  check('the duplicate keeps the source of the step that found it first',
    result.editors[0]?.source === 'prefs');
}

{
  const result = detectEditors(undefined, deps({
    files: { [VSCODE_USER]: '' },
    whereCode: [VSCODE_USER.replace(/\\Code\.exe$/i, '\\bin\\code.cmd')],
  }));
  check('ids are stable and built from product and lower-cased path',
    result.editors[0]?.id === `vscode:${VSCODE_USER.toLowerCase()}`, result.editors[0]?.id);
}

console.log('\neditor-detect: isKnownEditorExe\n');
{
  check('Code.exe is a known editor exe', isKnownEditorExe('C:\\x\\Code.exe') === true);
  check('the check is case-insensitive', isKnownEditorExe('C:\\x\\cursor.EXE') === true);
  check('an unrelated exe is not a known editor exe', isKnownEditorExe('C:\\x\\notepad.exe') === false);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);

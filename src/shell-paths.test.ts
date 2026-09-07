// Unit tests for Windows / WSL / Git Bash path translation. Run directly on Node 24+
// (strips types):
//   node src/shell-paths.test.ts
// Exits 0 if all pass, 1 on any failure.
//
// Everything here is pure string work: no file system, no Electron. The cases are
// the contract between the renderer (parsing OSC 7 into Tab.cwd) and the main
// process (turning a saved cwd back into an argument for wsl.exe).

import {
  isWindowsDrivePath,
  isWslUncPath,
  linuxPathToWindows,
  osc7ToWindowsPath,
  parseOsc7,
  windowsPathToWsl,
  wslUncToLinux,
} from './shell-paths.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}
const show = (v: unknown) => JSON.stringify(v);

console.log('\nshell-paths: parseOsc7\n');
{
  check('a distro host with a home path parses',
    show(parseOsc7('file://Ubuntu/home/aryan')) === show({ host: 'Ubuntu', path: '/home/aryan' }),
    show(parseOsc7('file://Ubuntu/home/aryan')));

  check('a dotted distro name parses',
    show(parseOsc7('file://Ubuntu-22.04/home/x')) === show({ host: 'Ubuntu-22.04', path: '/home/x' }),
    show(parseOsc7('file://Ubuntu-22.04/home/x')));

  check('a real hostname in the host slot still parses (afterterm treats it as the distro)',
    show(parseOsc7('file://DESKTOP-A1/home/x')) === show({ host: 'DESKTOP-A1', path: '/home/x' }),
    show(parseOsc7('file://DESKTOP-A1/home/x')));

  check('an empty host (file:///path) parses',
    show(parseOsc7('file:///etc/hosts')) === show({ host: '', path: '/etc/hosts' }),
    show(parseOsc7('file:///etc/hosts')));

  check('a root path parses', show(parseOsc7('file://Ubuntu/')) === show({ host: 'Ubuntu', path: '/' }));

  check('a single-segment path parses (still an absolute path, leading slash present)',
    show(parseOsc7('file://Ubuntu/notabs')) === show({ host: 'Ubuntu', path: '/notabs' }),
    show(parseOsc7('file://Ubuntu/notabs')));

  check('a host with no path at all is rejected', parseOsc7('file://Ubuntu') === null);
  check('a host with no path and empty host is rejected', parseOsc7('file://') === null);

  check('a non-file scheme is rejected', parseOsc7('http://x/y') === null);
  check('an ftp scheme is rejected', parseOsc7('ftp://x/y') === null);
  check('a bare path with no scheme is rejected', parseOsc7('/home/aryan') === null);
  check('an empty string is rejected', parseOsc7('') === null);
  check('a non-string is rejected', parseOsc7(null as unknown as string) === null);
  check('a number is rejected', parseOsc7(42 as unknown as string) === null);

  check('a percent-encoded space decodes',
    show(parseOsc7('file://Ubuntu/home/a%20b')) === show({ host: 'Ubuntu', path: '/home/a b' }),
    show(parseOsc7('file://Ubuntu/home/a%20b')));

  check('a percent-encoded space in the middle of two segments decodes',
    show(parseOsc7('file://Ubuntu/home/a%20b/c%20d')) === show({ host: 'Ubuntu', path: '/home/a b/c d' }),
    show(parseOsc7('file://Ubuntu/home/a%20b/c%20d')));

  check('a malformed percent escape is left as is, not thrown on',
    show(parseOsc7('file://Ubuntu/home/a%zzb')) === show({ host: 'Ubuntu', path: '/home/a%zzb' }),
    show(parseOsc7('file://Ubuntu/home/a%zzb')));

  check('trailing whitespace is trimmed',
    show(parseOsc7('file://Ubuntu/home/x   ')) === show({ host: 'Ubuntu', path: '/home/x' }),
    show(parseOsc7('file://Ubuntu/home/x   ')));

  check('trailing whitespace is trimmed even with nothing else wrong',
    show(parseOsc7('file://Ubuntu/\t\n')) === show({ host: 'Ubuntu', path: '/' }));

  check('the scheme match is case-insensitive',
    show(parseOsc7('FILE://Ubuntu/home/x')) === show({ host: 'Ubuntu', path: '/home/x' }));

  check('a percent-encoded slash decodes into a literal slash, no extra validation on it',
    show(parseOsc7('file://Ubuntu/home/a%2Fb')) === show({ host: 'Ubuntu', path: '/home/a/b' }));

  check('digits in the host are accepted as-is',
    show(parseOsc7('file://Ubuntu2004/home/x')) === show({ host: 'Ubuntu2004', path: '/home/x' }));

  check('a deep path with several segments parses whole',
    show(parseOsc7('file://Ubuntu/a/b/c/d')) === show({ host: 'Ubuntu', path: '/a/b/c/d' }));

  check('leading whitespace is not stripped, only trailing',
    show(parseOsc7(' file://Ubuntu/home/x')) === show(null));

  check('a malformed escape at the very end is left as is',
    show(parseOsc7('file://Ubuntu/home/x%2')) === show({ host: 'Ubuntu', path: '/home/x%2' }));
}

console.log('\nshell-paths: linuxPathToWindows, /mnt drvfs form\n');
{
  check('/mnt/c/Users/x -> C:\\Users\\x',
    linuxPathToWindows('/mnt/c/Users/x', '') === 'C:\\Users\\x',
    show(linuxPathToWindows('/mnt/c/Users/x', '')));

  check('/mnt/c -> C:\\', linuxPathToWindows('/mnt/c', '') === 'C:\\', show(linuxPathToWindows('/mnt/c', '')));

  check('/mnt/c/ -> C:\\ (trailing slash alone normalises away)',
    linuxPathToWindows('/mnt/c/', '') === 'C:\\', show(linuxPathToWindows('/mnt/c/', '')));

  check('/mnt/C/ upper-case drive letter is upper-cased and works the same',
    linuxPathToWindows('/mnt/C/', '') === 'C:\\', show(linuxPathToWindows('/mnt/C/', '')));

  check('/mnt/d/a/b/c -> D:\\a\\b\\c, deep paths keep every segment',
    linuxPathToWindows('/mnt/d/a/b/c', '') === 'D:\\a\\b\\c', show(linuxPathToWindows('/mnt/d/a/b/c', '')));

  check('lower-case drive letters upper-case too',
    linuxPathToWindows('/mnt/z/x', '') === 'Z:\\x');

  check('/mnt/cc/x, a two-letter segment, is not a drive: falls through to a distro path',
    linuxPathToWindows('/mnt/cc/x', 'Ubuntu') === '\\\\wsl$\\Ubuntu\\mnt\\cc\\x',
    show(linuxPathToWindows('/mnt/cc/x', 'Ubuntu')));

  check('/mnt/cc/x with no distro is null, since it is not a drive path after all',
    linuxPathToWindows('/mnt/cc/x', '') === null);

  check('/mnt alone (no trailing slash, no drive) is a distro path',
    linuxPathToWindows('/mnt', 'Ubuntu') === '\\\\wsl$\\Ubuntu\\mnt',
    show(linuxPathToWindows('/mnt', 'Ubuntu')));

  check('/mnt/ alone is a distro path too',
    linuxPathToWindows('/mnt/', 'Ubuntu') === '\\\\wsl$\\Ubuntu\\mnt\\',
    show(linuxPathToWindows('/mnt/', 'Ubuntu')));
}

console.log('\nshell-paths: linuxPathToWindows, MSYS /<drive> form\n');
{
  check('/c/Users/x -> C:\\Users\\x',
    linuxPathToWindows('/c/Users/x', '') === 'C:\\Users\\x', show(linuxPathToWindows('/c/Users/x', '')));

  check('/c alone -> C:\\', linuxPathToWindows('/c', '') === 'C:\\', show(linuxPathToWindows('/c', '')));

  check('/c/ alone -> C:\\', linuxPathToWindows('/c/', '') === 'C:\\');

  check('/d/a/b -> D:\\a\\b', linuxPathToWindows('/d/a/b', '') === 'D:\\a\\b');

  check('/cc/x, a two-letter first segment, is not MSYS drive form: it is a distro path',
    linuxPathToWindows('/cc/x', 'Ubuntu') === '\\\\wsl$\\Ubuntu\\cc\\x',
    show(linuxPathToWindows('/cc/x', 'Ubuntu')));

  check('/cc/x with no distro is null',
    linuxPathToWindows('/cc/x', '') === null);
}

console.log('\nshell-paths: linuxPathToWindows, distro (UNC) form\n');
{
  check('/home/x -> \\\\wsl$\\Ubuntu\\home\\x',
    linuxPathToWindows('/home/x', 'Ubuntu') === '\\\\wsl$\\Ubuntu\\home\\x',
    show(linuxPathToWindows('/home/x', 'Ubuntu')));

  check('/ -> \\\\wsl$\\Ubuntu\\, the distro root',
    linuxPathToWindows('/', 'Ubuntu') === '\\\\wsl$\\Ubuntu\\', show(linuxPathToWindows('/', 'Ubuntu')));

  check('/home/a%20b, already decoded before this call, keeps its space',
    linuxPathToWindows('/home/a b', 'Ubuntu') === '\\\\wsl$\\Ubuntu\\home\\a b');

  check('a dotted distro name works',
    linuxPathToWindows('/home/x', 'Ubuntu-22.04') === '\\\\wsl$\\Ubuntu-22.04\\home\\x');

  check('a hostname-shaped distro name works, afterterm treats it as opaque',
    linuxPathToWindows('/home/x', 'DESKTOP-A1') === '\\\\wsl$\\DESKTOP-A1\\home\\x');

  check('a non-mount path with an empty distro is null (would be a UNC path with no distro)',
    linuxPathToWindows('/home/x', '') === null);

  check('a non-mount path with no distro argument at all is null',
    linuxPathToWindows('/home/x', undefined as unknown as string) === null);

  check('"." and ".." segments are passed through, not resolved',
    linuxPathToWindows('/home/./x/../y', 'Ubuntu') === '\\\\wsl$\\Ubuntu\\home\\.\\x\\..\\y',
    show(linuxPathToWindows('/home/./x/../y', 'Ubuntu')));
}

console.log('\nshell-paths: linuxPathToWindows, more drive-form edge cases\n');
{
  check('/mnt/1/x, a digit instead of a letter, is not a drive: falls through to a distro path',
    linuxPathToWindows('/mnt/1/x', 'Ubuntu') === '\\\\wsl$\\Ubuntu\\mnt\\1\\x',
    show(linuxPathToWindows('/mnt/1/x', 'Ubuntu')));

  check('/1/x, a digit first segment, is not MSYS drive form either',
    linuxPathToWindows('/1/x', 'Ubuntu') === '\\\\wsl$\\Ubuntu\\1\\x');

  check('an empty path string is null, it is not an absolute path',
    linuxPathToWindows('', 'Ubuntu') === null);

  check('an empty path string with no distro is null too',
    linuxPathToWindows('', '') === null);

  check('a path missing its leading slash is null, only absolute Linux paths translate',
    linuxPathToWindows('mnt/c/x', 'Ubuntu') === null, show(linuxPathToWindows('mnt/c/x', 'Ubuntu')));

  check('a relative-looking distro path is also null',
    linuxPathToWindows('home/x', 'Ubuntu') === null);
}

console.log('\nshell-paths: linuxPathToWindows, rejections\n');
{
  check('a backslash inside the path is rejected',
    linuxPathToWindows('/home/a\\b', 'Ubuntu') === null);
  check('a backslash inside an /mnt path is rejected too',
    linuxPathToWindows('/mnt/c/a\\b', '') === null);
  check('a NUL byte is rejected',
    linuxPathToWindows('/home/a\0b', 'Ubuntu') === null);
  check('a non-string path is rejected',
    linuxPathToWindows(null as unknown as string, 'Ubuntu') === null);
  check('a distro name containing a backslash is rejected',
    linuxPathToWindows('/home/x', 'Ubu\\ntu') === null);
  check('a distro name containing a NUL is rejected',
    linuxPathToWindows('/home/x', 'Ubu\0ntu') === null);
}

console.log('\nshell-paths: osc7ToWindowsPath\n');
{
  check('a distro home path becomes a WSL UNC path',
    osc7ToWindowsPath('file://Ubuntu/home/aryan') === '\\\\wsl$\\Ubuntu\\home\\aryan',
    show(osc7ToWindowsPath('file://Ubuntu/home/aryan')));

  check('spaces and percent-escapes survive the full pipeline',
    osc7ToWindowsPath('file://Ubuntu/home/a%20b') === '\\\\wsl$\\Ubuntu\\home\\a b',
    show(osc7ToWindowsPath('file://Ubuntu/home/a%20b')));

  check('the distro root round trips to a WSL UNC root',
    osc7ToWindowsPath('file://Ubuntu/') === '\\\\wsl$\\Ubuntu\\');

  check('a malformed payload gives null (parseOsc7 fails first)',
    osc7ToWindowsPath('http://x/y') === null);

  check('an empty host with a non-mount path gives null (no distro to build a UNC path with)',
    osc7ToWindowsPath('file:///home/x') === null,
    show(osc7ToWindowsPath('file:///home/x')));

  check('an empty host with an /mnt path still works, since that branch needs no distro',
    osc7ToWindowsPath('file:///mnt/c/Users/x') === 'C:\\Users\\x',
    show(osc7ToWindowsPath('file:///mnt/c/Users/x')));

  check('a host with no path gives null',
    osc7ToWindowsPath('file://Ubuntu') === null);
}

console.log('\nshell-paths: isWslUncPath\n');
{
  check('a \\\\wsl$\\ path with a distro and a subpath is true',
    isWslUncPath('\\\\wsl$\\Ubuntu\\home\\x') === true);
  check('a \\\\wsl$\\ path with just the distro is true',
    isWslUncPath('\\\\wsl$\\Ubuntu') === true);
  check('a \\\\wsl.localhost\\ path is true',
    isWslUncPath('\\\\wsl.localhost\\Ubuntu\\home\\x') === true);
  check('a \\\\wsl.localhost\\ path with just the distro is true',
    isWslUncPath('\\\\wsl.localhost\\Ubuntu') === true);
  check('the prefix match is case-insensitive',
    isWslUncPath('\\\\WSL$\\Ubuntu') === true && isWslUncPath('\\\\Wsl.Localhost\\Ubuntu') === true);

  check('a bare \\\\wsl$\\ prefix with nothing after it is false, there is no distro',
    isWslUncPath('\\\\wsl$\\') === false);
  check('a bare \\\\wsl.localhost\\ prefix with nothing after it is false',
    isWslUncPath('\\\\wsl.localhost\\') === false);
  check('\\\\wsl$ with no trailing backslash at all is false',
    isWslUncPath('\\\\wsl$') === false);

  check('an ordinary UNC share is false', isWslUncPath('\\\\server\\share') === false);
  check('a drive path is false', isWslUncPath('C:\\') === false);
  check('"wsl$" without leading backslashes is false, it is not a UNC path',
    isWslUncPath('wsl$\\Ubuntu\\home\\x') === false);
  check('a single leading backslash is false, UNC needs two',
    isWslUncPath('\\wsl$\\Ubuntu') === false);
  check('an empty string is false', isWslUncPath('') === false);
  check('a non-string is false', isWslUncPath(null as unknown as string) === false);
  check('"wsl.localhost" without leading slashes is false',
    isWslUncPath('wsl.localhost\\Ubuntu\\home\\x') === false);
  check('a dotted distro after wsl$ is still true', isWslUncPath('\\\\wsl$\\Ubuntu-22.04\\home\\x') === true);
}

console.log('\nshell-paths: wslUncToLinux\n');
{
  check('a home path parses',
    show(wslUncToLinux('\\\\wsl$\\Ubuntu\\home\\x')) === show({ distro: 'Ubuntu', path: '/home/x' }),
    show(wslUncToLinux('\\\\wsl$\\Ubuntu\\home\\x')));

  check('the bare distro (no subpath) is the distro root',
    show(wslUncToLinux('\\\\wsl$\\Ubuntu')) === show({ distro: 'Ubuntu', path: '/' }));

  check('wsl.localhost with a trailing slash on the root stays the root',
    show(wslUncToLinux('\\\\wsl.localhost\\Ubuntu\\')) === show({ distro: 'Ubuntu', path: '/' }),
    show(wslUncToLinux('\\\\wsl.localhost\\Ubuntu\\')));

  check('a trailing slash on a non-root path is dropped',
    show(wslUncToLinux('\\\\wsl$\\Ubuntu\\home\\x\\')) === show({ distro: 'Ubuntu', path: '/home/x' }),
    show(wslUncToLinux('\\\\wsl$\\Ubuntu\\home\\x\\')));

  check('a dotted distro name parses',
    show(wslUncToLinux('\\\\wsl$\\Ubuntu-22.04\\home\\x')) === show({ distro: 'Ubuntu-22.04', path: '/home/x' }));

  check('a hostname-shaped distro name parses',
    show(wslUncToLinux('\\\\wsl$\\DESKTOP-A1\\home\\x')) === show({ distro: 'DESKTOP-A1', path: '/home/x' }));

  check('a C:\\ path is not a WSL path', wslUncToLinux('C:\\Users\\x') === null);
  check('a plain UNC share with no distro segment concept is not a WSL path',
    wslUncToLinux('\\\\server\\share') === null);
  check('a bare prefix with no distro is null', wslUncToLinux('\\\\wsl$\\') === null);
  check('a non-string is null', wslUncToLinux(undefined as unknown as string) === null);
  check('an empty string is null', wslUncToLinux('') === null);
  check('wsl.localhost with a deep subpath parses',
    show(wslUncToLinux('\\\\wsl.localhost\\Ubuntu\\var\\log\\a.txt'))
      === show({ distro: 'Ubuntu', path: '/var/log/a.txt' }));
}

console.log('\nshell-paths: round trips through the distro (UNC) form\n');
{
  const cases: Array<[string, string]> = [
    ['/home/aryan', 'Ubuntu'],
    ['/', 'Ubuntu'],
    ['/etc/hosts', 'Ubuntu-22.04'],
    ['/home/a b', 'DESKTOP-A1'],
    ['/var/log', 'Ubuntu'],
  ];
  for (const [linuxPath, distro] of cases) {
    const win = linuxPathToWindows(linuxPath, distro);
    const back = win ? wslUncToLinux(win) : null;
    check(`round trip for ${show(linuxPath)} / ${distro}`,
      back !== null && back.distro === distro && back.path === linuxPath,
      show({ win, back }));
  }
}

console.log('\nshell-paths: windowsPathToWsl\n');
{
  check('C:\\Users\\x -> /mnt/c/Users/x', windowsPathToWsl('C:\\Users\\x') === '/mnt/c/Users/x');
  check('c:\\ (lower-case drive) -> /mnt/c', windowsPathToWsl('c:\\') === '/mnt/c');
  check('D:\\ -> /mnt/d', windowsPathToWsl('D:\\') === '/mnt/d');
  check('a deep path keeps every segment',
    windowsPathToWsl('C:\\a\\b\\c') === '/mnt/c/a/b/c', show(windowsPathToWsl('C:\\a\\b\\c')));
  check('a trailing backslash on a deep path drops cleanly',
    windowsPathToWsl('C:\\Users\\x\\') === '/mnt/c/Users/x');

  check('a UNC path is null', windowsPathToWsl('\\\\server\\share') === null);
  check('a relative path is null', windowsPathToWsl('Users\\x') === null);
  check('an empty string is null', windowsPathToWsl('') === null);
  check('a non-string is null', windowsPathToWsl(null as unknown as string) === null);
  check('a WSL UNC path is not a drive path, so it is null', windowsPathToWsl('\\\\wsl$\\Ubuntu\\home\\x') === null);
  check('a bare drive letter with no backslash is null', windowsPathToWsl('C:') === null);
}

console.log('\nshell-paths: isWindowsDrivePath\n');
{
  check('C:\\ is a drive path', isWindowsDrivePath('C:\\') === true);
  check('C:\\Users\\x is a drive path', isWindowsDrivePath('C:\\Users\\x') === true);
  check('a lower-case drive letter counts', isWindowsDrivePath('c:\\Users') === true);
  check('a forward-slash path is not a drive path', isWindowsDrivePath('C:/Users') === false);
  check('a UNC path is not a drive path', isWindowsDrivePath('\\\\server\\share') === false);
  check('a relative path is not a drive path', isWindowsDrivePath('Users\\x') === false);
  check('a bare drive letter with no backslash is not a drive path', isWindowsDrivePath('C:') === false);
  check('a WSL UNC path is not a drive path', isWindowsDrivePath('\\\\wsl$\\Ubuntu\\home\\x') === false);
  check('an empty string is not a drive path', isWindowsDrivePath('') === false);
  check('a non-string is not a drive path', isWindowsDrivePath(null as unknown as string) === false);
  check('a digit instead of a letter is not a drive path', isWindowsDrivePath('1:\\Users') === false);
  check('two letters before the colon is not a drive path', isWindowsDrivePath('CC:\\Users') === false);
  check('the match only cares about the prefix, trailing content is fine',
    isWindowsDrivePath('C:\\Users\\a\\b\\c.txt') === true);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);

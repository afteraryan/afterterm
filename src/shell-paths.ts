// Path translation between Windows, WSL and Git Bash (MSYS) path forms.
//
// Phase 6 adds shell integration for Git Bash and WSL. Git Bash reports its cwd as
// OSC 9;9 with a Windows path already (handled directly in Terminal/index.tsx), but
// WSL reports OSC 7 as "file://<distro>/<linux path>" (afterterm's WSL hook puts the
// distro name in the URL's host slot; other OSC 7 emitters put a real hostname there,
// but afterterm only ever talks to its own hook so that slot is always a distro).
// The renderer turns that into a Windows path for Tab.cwd (a \\wsl$\<distro>\... UNC
// path), and main turns a saved \\wsl$\... path back into a Linux path to spawn
// `wsl.exe --cd`.
//
// This module is pure: no node:path, no node:fs, no Buffer, no Electron. It is
// imported by both the Electron main process and the sandboxed renderer, and the
// renderer bundle cannot carry Node built-ins (see thread-tail.ts for the same rule).

/** The host and path parsed out of an OSC 7 payload. */
export interface Osc7Target {
  host: string;
  path: string;
}

/** Percent-decode, leaving the text untouched if the escape sequence is malformed. */
function percentDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Parse an OSC 7 payload, the text xterm hands the handler after "7;", e.g.
 * "file://Ubuntu/home/aryan". Accepts "file://host/path" and "file:///path" (an
 * empty host). The path is percent-decoded. Rejects anything that is not a file:
 * URL, or that has no path starting with "/" (a bare "file://Ubuntu" with nothing
 * after the host is rejected: there is no cwd to report). Trailing whitespace is
 * trimmed first, since some emitters pad the payload. Returns null when rejected.
 */
export function parseOsc7(payload: string): Osc7Target | null {
  if (typeof payload !== 'string') return null;
  const trimmed = payload.replace(/\s+$/, '');
  const m = /^file:\/\/([^/]*)(\/.*)?$/i.exec(trimmed);
  if (!m) return null;
  const host = m[1];
  const rawPath = m[2];
  if (!rawPath) return null;
  return { host, path: percentDecode(rawPath) };
}

/**
 * A Linux path turned into the Windows form afterterm stores in Tab.cwd.
 *
 * Drvfs mounts ("/mnt/c/...") and the MSYS form Git Bash uses ("/c/...", only when
 * the first path segment is exactly one letter) become an ordinary drive path, no
 * distro needed. Anything else is a real path inside the distro's filesystem and
 * becomes a "\\wsl$\<distro>\..." UNC path, which needs a non-empty distro name.
 *
 * Forward slashes become backslashes. "." and ".." segments are not resolved, they
 * are passed through literally: this function only reshapes separators, it does not
 * normalize the path. A path containing a backslash or a NUL is rejected outright
 * (real Linux paths never contain either), and so is a non-mount path when the
 * distro name is empty, since that would otherwise produce a UNC path with no
 * distro segment.
 */
export function linuxPathToWindows(path: string, distro: string): string | null {
  if (typeof path !== 'string') return null;
  if (path.includes('\\') || path.includes('\0')) return null;
  const safeDistro = typeof distro === 'string' ? distro : '';

  // "/mnt/<drive>[/rest]", the standard WSL drvfs mount.
  const mnt = /^\/mnt\/([A-Za-z])(\/.*)?$/.exec(path);
  if (mnt) return driveWindowsPath(mnt[1], mnt[2]);

  // "/<drive>[/rest]", the MSYS/Git Bash form. Only when the first segment is
  // exactly one letter, "/cc/x" is a real distro path, not a drive reference.
  const msys = /^\/([A-Za-z])(\/.*)?$/.exec(path);
  if (msys) return driveWindowsPath(msys[1], msys[2]);

  // Anything else needs to be an absolute Linux path and a distro to become a UNC
  // path. A relative path has no sensible UNC form, so it is rejected rather than
  // silently glued onto the distro name.
  if (!path.startsWith('/')) return null;
  if (!safeDistro || safeDistro.includes('\\') || safeDistro.includes('/') || safeDistro.includes('\0')) {
    return null;
  }
  const winPath = path.replace(/\//g, '\\');
  if (winPath === '\\') return `\\\\wsl$\\${safeDistro}\\`;
  return `\\\\wsl$\\${safeDistro}${winPath}`;
}

/** Shared by the /mnt/<drive> and MSYS /<drive> forms of linuxPathToWindows. */
function driveWindowsPath(letter: string, rest: string | undefined): string {
  const drive = letter.toUpperCase();
  if (!rest || rest === '/') return `${drive}:\\`;
  const tail = rest.slice(1).replace(/\//g, '\\');
  return `${drive}:\\${tail}`;
}

/** parseOsc7 then linuxPathToWindows with the host as the distro. Null on either failure. */
export function osc7ToWindowsPath(payload: string): string | null {
  const target = parseOsc7(payload);
  if (!target) return null;
  return linuxPathToWindows(target.path, target.host);
}

/**
 * True for a WSL UNC path: "\\wsl$\..." or "\\wsl.localhost\..." (either prefix,
 * case-insensitive), with at least a distro name after it. The bare prefix with
 * nothing following ("\\wsl$\" alone) is not enough, there has to be a distro.
 */
export function isWslUncPath(p: string): boolean {
  if (typeof p !== 'string') return false;
  return /^\\\\wsl(?:\$|\.localhost)\\[^\\]+/i.test(p);
}

/**
 * The reverse of linuxPathToWindows's distro branch: turn "\\wsl$\Ubuntu\home\x"
 * back into { distro: "Ubuntu", path: "/home/x" }. "\\wsl$\Ubuntu" with nothing
 * after the distro is the distro's root, "/". A trailing slash is dropped except
 * when the whole path is the root. Anything that is not a WSL UNC path (a drive
 * path, a plain UNC share, no distro segment) returns null.
 */
export function wslUncToLinux(p: string): { distro: string; path: string } | null {
  if (typeof p !== 'string') return null;
  const m = /^\\\\wsl(?:\$|\.localhost)\\([^\\]+)(\\.*)?$/i.exec(p);
  if (!m) return null;
  const distro = m[1];
  let rest = (m[2] ?? '').replace(/\\/g, '/');
  if (rest.length > 1 && rest.endsWith('/')) rest = rest.slice(0, -1);
  return { distro, path: rest === '' ? '/' : rest };
}

/**
 * A Windows drive path to its WSL form: "C:\Users\x" -> "/mnt/c/Users/x",
 * "D:\" -> "/mnt/d". Not used by the app yet, a helper for tests and future
 * `wsl.exe --cd` work. Null for anything that is not a drive path.
 */
export function windowsPathToWsl(p: string): string | null {
  if (!isWindowsDrivePath(p)) return null;
  const drive = p[0].toLowerCase();
  const rest = p.slice(3).replace(/\\+$/, '').replace(/\\/g, '/');
  return rest === '' ? `/mnt/${drive}` : `/mnt/${drive}/${rest}`;
}

/** "C:\" at the start of a string. The rule the renderer's OSC 9 handler already uses. */
export function isWindowsDrivePath(p: string): boolean {
  return typeof p === 'string' && /^[A-Za-z]:\\/.test(p);
}

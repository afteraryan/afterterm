// Files a chat changed with a shell command (edited files, Phase 2).
//
// Claude's own edit tools are in the transcript (session-files.ts), but most of
// the documents a chat writes come from commands: `cat > x.md`, `sed -i`, a
// Python script, `cp`. Nothing records those, so main watches the chat's folder
// while its terminal is awake and keeps every change it sees; this module decides
// which of them the chat made: a change counts only if it happened while one of
// that chat's own Bash or PowerShell tool calls was running (the tool call's time
// to its result's time), inside the folder that command ran in
// (docs/edited-files/design-04-edited-files.md, "Where the files come from").
//
// Two chats in one folder, both running a command at that moment, both get the
// file. A file changed by hand while no command of the chat was running is left
// out. Pure: no node imports.

import { fileKind, isInside, normalizePath, mergeChanged, type ChangedFile, type ShellWindow } from './session-files.ts';
export { isBulkCommand } from './session-files.ts';

/** One change the folder watch saw. */
export interface FsChange {
  /** Absolute, normalised. */
  path: string;
  /** When the watch saw it, ms since epoch. */
  at: number;
  /** The file's creation time, so "New" can be told from "changed". */
  birth: number;
}

/**
 * Folders whose contents are never the chat's work: dependencies, version control,
 * build output and caches (design: "ignores node_modules, .git, out, dist and
 * similar build folders"). Matched against every folder name in the path.
 */
export const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'out', 'dist', 'build', '.vite', '.next', '.nuxt', '.svelte-kit',
  '.turbo', '.parcel-cache', '.cache', 'coverage', '__pycache__', '.pytest_cache', '.mypy_cache',
  '.venv', 'venv', 'target', '.gradle', '.idea', '.dart_tool',
]);

/** Temporary files a tool writes and renames or deletes: sed's sedXXXXXX, editors' swap and backup files. */
function isTempName(name: string): boolean {
  return /^sed[A-Za-z0-9]{6}$/.test(name)
    || /^\.?#/.test(name)
    || /~$/.test(name)
    || /\.(tmp|temp|swp|swx|swo|crdownload|part)$/i.test(name)
    || /^\.~lock\./.test(name);
}

/**
 * True for a path the folder watch should drop: inside an ignored folder, inside
 * a `.claude\worktrees` checkout (another chat's worktree under this repo), or a
 * temporary file. `root` is the watched folder; only the part below it is checked.
 */
export function isIgnoredChange(path: string, root: string): boolean {
  const full = normalizePath(path);
  const base = normalizePath(root).replace(/\\$/, '');
  if (!isInside(full, base)) return true;
  const rel = full.slice(base.length).replace(/^\\/, '');
  if (!rel) return true;
  const parts = rel.split('\\');
  const name = parts[parts.length - 1];
  for (let i = 0; i < parts.length - 1; i++) {
    const seg = parts[i].toLowerCase();
    if (IGNORED_DIRS.has(seg)) return true;
    if (seg === '.claude' && parts[i + 1]?.toLowerCase() === 'worktrees') return true;
  }
  return isTempName(name);
}

/** A change seen a little before a tool call's recorded start, or a little after its result, still belongs to it. */
export const SLACK_BEFORE_MS = 500;
export const SLACK_AFTER_MS = 2000;

/**
 * The files the chat changed with its commands: every change inside the folder a
 * command ran in, while that command ran. `now` closes a command still running.
 * Images are left out, like images Claude made with its tools.
 */
export function attributeCommandChanges(changes: FsChange[], windows: ShellWindow[], now: number): ChangedFile[] {
  const usable = windows.filter(w => w.cwd && !w.bulk);
  if (usable.length === 0 || changes.length === 0) return [];
  const out: ChangedFile[] = [];
  for (const c of changes) {
    const kind = fileKind(c.path);
    if (kind === 'image') continue;
    const win = usable.find(w =>
      c.at >= w.start - SLACK_BEFORE_MS
      && c.at <= (w.end ?? now) + SLACK_AFTER_MS
      && isInside(c.path, w.cwd!));
    if (!win) continue;
    out.push({
      path: c.path,
      kind,
      created: c.birth >= win.start - SLACK_BEFORE_MS,
      at: c.at,
      source: 'command',
    });
  }
  return mergeChanged(out);
}

/** Keep a change list bounded: the newest `max`, and nothing older than `maxAgeMs`. */
export function pruneChanges(changes: FsChange[], now: number, max = 20000, maxAgeMs = 24 * 60 * 60 * 1000): FsChange[] {
  const fresh = changes.filter(c => now - c.at <= maxAgeMs);
  return fresh.length > max ? fresh.slice(fresh.length - max) : fresh;
}

/**
 * What is kept on disk per session, so command-made files survive a restart
 * (the watch only runs while the app does). Merged, newest first.
 */
export function mergeSaved(saved: unknown, fresh: ChangedFile[]): ChangedFile[] {
  const valid = Array.isArray(saved)
    ? (saved as unknown[]).filter((f): f is ChangedFile => {
      const x = f as ChangedFile;
      return !!x && typeof x.path === 'string' && (x.kind === 'doc' || x.kind === 'code')
        && typeof x.at === 'number' && typeof x.created === 'boolean';
    }).map(f => ({ ...f, source: 'command' as const }))
    : [];
  return mergeChanged(valid, fresh);
}

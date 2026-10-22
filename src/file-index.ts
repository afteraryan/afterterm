// Finding a file by its name inside a folder, for file links (edited files,
// 2026-09-26). An agent often names a file bare in its reply ("03-operator-home.png"),
// and when that is not a file the chat touched or one in its own folder, the last
// resort is to look for the name under the chat's folder. Main builds one index per
// folder (name to paths) and reuses it for a short while, so a hover never walks
// the disk more than once.
//
// The walk skips what the folder watch skips (command-files.ts: dependencies,
// version control, build output, another chat's worktree) and stops at a cap, so a
// huge folder costs a bounded amount. The file system is a parameter.

import { IGNORED_DIRS } from './command-files.ts';

export interface IndexFs {
  /** Entries of a folder with whether each is a folder, or [] when unreadable. */
  list(dir: string): Promise<{ name: string; dir: boolean }[]>;
}

export interface NameIndex {
  root: string;
  builtAt: number;
  /** Lower-case file name to every full path with that name. */
  byName: Map<string, string[]>;
  /** True when the walk stopped at the cap, so the index is partial. */
  truncated: boolean;
}

export const MAX_INDEX_ENTRIES = 60_000;
export const MAX_INDEX_DEPTH = 12;

function skipDir(name: string, parentIsDotClaude: boolean): boolean {
  const lower = name.toLowerCase();
  if (IGNORED_DIRS.has(lower)) return true;
  if (parentIsDotClaude && lower === 'worktrees') return true;
  return false;
}

/** Walks `root` breadth first (so shallow files are always in) and indexes every file by name. */
export async function buildNameIndex(root: string, fsLike: IndexFs, now = Date.now()): Promise<NameIndex> {
  const base = root.replace(/[\\/]+$/, '');
  const byName = new Map<string, string[]>();
  let count = 0;
  let truncated = false;
  let level: { dir: string; dotClaude: boolean }[] = [{ dir: base, dotClaude: false }];
  for (let depth = 0; depth <= MAX_INDEX_DEPTH && level.length > 0 && !truncated; depth++) {
    const next: { dir: string; dotClaude: boolean }[] = [];
    for (const { dir, dotClaude } of level) {
      const entries = await fsLike.list(dir);
      for (const e of entries) {
        if (++count > MAX_INDEX_ENTRIES) { truncated = true; break; }
        const full = `${dir}\\${e.name}`;
        if (e.dir) {
          if (!skipDir(e.name, dotClaude)) next.push({ dir: full, dotClaude: e.name.toLowerCase() === '.claude' });
          continue;
        }
        const key = e.name.toLowerCase();
        const list = byName.get(key);
        if (list) list.push(full); else byName.set(key, [full]);
      }
      if (truncated) break;
    }
    level = next;
  }
  return { root: base, builtAt: now, byName, truncated };
}

/** Every indexed path with this file name (case-insensitive). */
export function findByName(index: NameIndex, name: string): string[] {
  const key = String(name ?? '').replace(/^.*[\\/]/, '').toLowerCase();
  return key ? [...(index.byName.get(key) ?? [])] : [];
}

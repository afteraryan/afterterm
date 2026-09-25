// What the header's Files button and its list show, from a session's files
// (session-files.ts). Pure, no DOM, unit-tested in filesView.test.ts. The look is
// docs/mockups/edited-files-button.html; the rules are
// docs/edited-files/design-04-edited-files.md, decisions 1 and 2.

import type { ChangedFile, SessionFiles } from '../session-files.ts';
import { baseName, isInside, normalizePath } from '../session-files.ts';

export interface FileRow {
  path: string;
  name: string;
  /** The folder, relative to the chat's own folder ("docs", "project root"), or with ~ for the home folder. */
  folder: string;
  created: boolean;
  /** "2m", "3h", "4d". */
  ago: string;
  at: number;
  source: ChangedFile['source'];
}

export interface PastedRow {
  key: string;
  n: number;
  /** "#3 · 17:17", or "#3 · 24 Sep" when it was not pasted today. */
  label: string;
  at: number;
}

export interface FilesListView {
  /** Documents and code: what the button counts. Pasted images are not counted. */
  count: number;
  docs: FileRow[];
  code: FileRow[];
  pasted: PastedRow[];
  /** When the chat changed only code, the Code row starts unfolded. */
  codeStartsOpen: boolean;
}

/** "11 files", "1 file". Null when there is nothing to count: then there is no button. */
export function filesButtonLabel(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count === 1 ? '1 file' : `${count} files`;
}

/** How long ago, as the list's right-hand column reads it: "now", "2m", "3h", "4d", "5w". */
export function shortAgo(at: number, now: number): string {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return 'now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d}d`;
  return `${Math.floor(d / 7)}w`;
}

function parentOf(p: string): string {
  const i = p.lastIndexOf('\\');
  return i > 0 ? p.slice(0, i) : p;
}

/**
 * The folder a file sits in, as the list shows it: relative to the chat's own
 * folder with forward slashes ("src/renderer"), "project root" for the folder
 * itself; then the same relative to the project's folder, for a chat working in
 * a subfolder of it (the order the design resolves paths in); otherwise the full
 * folder, with the home folder as ~.
 */
export function folderLabel(file: string, threadFolder: string | undefined, home: string | undefined, projectFolder?: string): string {
  const parent = parentOf(normalizePath(file));
  for (const root of [threadFolder, projectFolder]) {
    if (!root || !isInside(parent, root)) continue;
    const base = normalizePath(root).replace(/\\$/, '');
    const rel = parent.slice(base.length).replace(/^\\/, '');
    return rel ? rel.replace(/\\/g, '/') : 'project root';
  }
  if (home && isInside(parent, home)) {
    const base = normalizePath(home).replace(/\\$/, '');
    return '~' + parent.slice(base.length);
  }
  return parent;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "#3 · 17:17" for a paste from today (local time), "#3 · 24 Sep" for an older one. */
export function pastedLabel(n: number, at: number, now: number): string {
  const d = new Date(at);
  const today = new Date(now);
  const sameDay = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  const when = sameDay
    ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    : `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return `#${n} · ${when}`;
}

function toRow(f: ChangedFile, threadFolder: string | undefined, home: string | undefined, now: number, projectFolder?: string): FileRow {
  return {
    path: f.path,
    name: baseName(f.path),
    folder: folderLabel(f.path, threadFolder, home, projectFolder),
    created: f.created,
    ago: shortAgo(f.at, now),
    at: f.at,
    source: f.source,
  };
}

/** The list, newest change first within each part (design decision 2). */
export function filesListView(
  files: Pick<SessionFiles, 'changed' | 'pasted'> | undefined,
  threadFolder: string | undefined,
  home: string | undefined,
  now: number,
  projectFolder?: string,
): FilesListView {
  const changed = [...(files?.changed ?? [])].sort((a, b) => b.at - a.at);
  const docs = changed.filter(f => f.kind === 'doc').map(f => toRow(f, threadFolder, home, now, projectFolder));
  const code = changed.filter(f => f.kind === 'code').map(f => toRow(f, threadFolder, home, now, projectFolder));
  const pasted = [...(files?.pasted ?? [])]
    .sort((a, b) => b.at - a.at || b.n - a.n)
    .map(p => ({ key: p.key, n: p.n, at: p.at, label: pastedLabel(p.n, p.at, now) }));
  return {
    count: docs.length + code.length,
    docs,
    code,
    pasted,
    codeStartsOpen: docs.length === 0 && code.length > 0,
  };
}

/** True when the list has anything to show at all (a chat with only pasted images still gets no button). */
export function hasFilesButton(view: FilesListView): boolean {
  return view.count > 0;
}

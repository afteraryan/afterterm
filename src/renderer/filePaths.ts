// File paths in the terminal output, made clickable like web links (edited files,
// Phase 3; docs/edited-files/design-04-edited-files.md, decision 4).
//
// Claude Code writes paths in its tool lines (`● Update(src/main.ts)`), inside
// commands (`Bash(cat > docs/a.md …)`) and in its replies, where it draws
// Markdown inline code in purple and drops the backticks, so afterterm only ever
// sees the text. Paths are recognised from the text itself, resolved against the
// chat's own folder, then the project's, and only underlined once main has said
// the file is really there (the terminal side does that check).
//
// Pure: no xterm, no DOM. The terminal feeds it one line at a time.

import { baseName, isAbsolutePath, normalizePath, pathKey, type ChangedFile, type EditEvent } from '../session-files.ts';

export interface PathCandidate {
  /** Where the text starts and ends in the line (end exclusive), string indices. */
  start: number;
  end: number;
  /** The path as written, with any :line[:col] suffix removed. */
  text: string;
  /** From a ":42" or ":42:7" suffix. */
  line?: number;
  /** Inside a Claude Code tool line such as Update(...) or Write(...). */
  tool?: string;
}

/** The tools whose line names one file: `● Update(path)`, `⏺ Write(path)`. */
const TOOL_LINE_RE = /(?:^|\s)[●⏺]?\s*(Update|Write|Edit|Create|Read|MultiEdit|NotebookEdit)\(([^()]+?)(?:\)|$)/;

/** A run of characters that can be part of a path. Spaces end it; quotes, backticks and brackets never belong to it. */
const TOKEN_RE = /[^\s"'`<>()[\]{}|,;*?]+/g;

const TRAILING_PUNCT = /[.,:;!?]+$/;
const LINE_SUFFIX = /:(\d+)(?::(\d+))?$/;
const EXTENSION = /[A-Za-z0-9_\-]\.[A-Za-z][A-Za-z0-9]{0,7}$/;

/** True for text that has the shape of a path (design: a / or \, a drive, ./, ../, ~/, or a name with an extension). */
export function looksLikePath(text: string): boolean {
  if (!text || text.length < 2 || text.length > 400) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return false; // a URL: the web-links addon's
  if (/^(www\.|mailto:)/i.test(text)) return false;
  if (/^[A-Za-z]:[\\/]/.test(text)) return true;
  if (/^(\.{1,2}|~)[\\/]/.test(text)) return true;
  // Any separator with a letter somewhere ("and/or" too): the disk check is what
  // keeps prose plain, since only a path that exists is underlined.
  if (/[\\/]/.test(text)) return /[A-Za-z]/.test(text) && text.split(/[\\/]/).some(Boolean);
  return EXTENSION.test(text);
}

/** Split "src/a.ts:42:7" into the path and its line. */
export function splitLineSuffix(text: string): { text: string; line?: number } {
  const m = LINE_SUFFIX.exec(text);
  if (!m) return { text };
  return { text: text.slice(0, m.index), line: Number(m[1]) };
}

function trimToken(raw: string, start: number): { text: string; start: number; end: number } {
  let text = raw;
  let s = start;
  const lead = /^[.,:;!?]+(?![\\/])/.exec(text);
  if (lead && !/^\.{1,2}[\\/]/.test(text)) { text = text.slice(lead[0].length); s += lead[0].length; }
  // Keep a :line suffix, drop sentence punctuation after it or after the name.
  const m = /^(.*?:\d+(?::\d+)?)[.,;!?]*$/.exec(text);
  if (m && LINE_SUFFIX.test(m[1])) text = m[1];
  else text = text.replace(TRAILING_PUNCT, '');
  return { text, start: s, end: s + text.length };
}

/** Every path-shaped piece of one terminal line, left to right. */
export function findPathCandidates(line: string): PathCandidate[] {
  const out: PathCandidate[] = [];
  const tool = TOOL_LINE_RE.exec(line);
  let toolRange: [number, number] | null = null;
  if (tool) {
    const inner = tool[2];
    const innerStart = tool.index + tool[0].indexOf('(') + 1;
    // Bash(...) is not in TOOL_LINE_RE: a command is prose to the recogniser below.
    const trimmed = inner.replace(/\s+$/, '').replace(/…$/, '');
    const lead = trimmed.length - trimmed.trimStart().length;
    const { text, line: ln } = splitLineSuffix(trimmed.trim());
    if (text) {
      out.push({ start: innerStart + lead, end: innerStart + lead + trimmed.trim().length, text, line: ln, tool: tool[1] });
      toolRange = [innerStart, innerStart + inner.length];
    }
  }
  for (const m of line.matchAll(TOKEN_RE)) {
    const start = m.index ?? 0;
    if (toolRange && start >= toolRange[0] && start < toolRange[1]) continue;
    const t = trimToken(m[0], start);
    const { text, line: ln } = splitLineSuffix(t.text);
    if (!looksLikePath(text)) continue;
    out.push({ start: t.start, end: t.end, text, line: ln });
  }
  return out;
}

export interface ResolveContext {
  threadFolder?: string;
  projectFolder?: string;
  home?: string;
}

/** True when the text names no folder at all, only a file: "index.tsx". */
export function isBareName(text: string): boolean {
  return !/[\\/]/.test(text) && !/^[A-Za-z]:/.test(text);
}

/**
 * The absolute paths a candidate could mean, in the order to try them: as
 * written when absolute, ~ as the home folder, otherwise inside the chat's own
 * folder then the project's (design decision 4, "Resolving it").
 */
export function resolveCandidates(text: string, ctx: ResolveContext): string[] {
  const t = text.trim();
  if (!t) return [];
  if (/^~[\\/]/.test(t)) return ctx.home ? [normalizePath(t.slice(2), ctx.home)] : [];
  if (isAbsolutePath(t)) return [normalizePath(t)];
  if (/^\//.test(t)) return []; // a POSIX path (WSL, a URL path): not a Windows file
  const out: string[] = [];
  for (const base of [ctx.threadFolder, ctx.projectFolder]) {
    if (!base) continue;
    const p = normalizePath(t, base);
    if (p && !out.some(o => o.toLowerCase() === p.toLowerCase())) out.push(p);
  }
  return out;
}

/** A tool line can reach the screen a moment before its entry is written to the transcript. */
export const LINE_BEFORE_EDIT_MS = 1000;
/** How long after an edit's recorded time its tool line may still appear on screen. */
export const LINE_AFTER_EDIT_MS = 60_000;

/**
 * The file a bare name (or a tool line) means among the files this chat changed.
 * Only files the chat changed are candidates (design: "A bare name links only when
 * it matches a file this chat changed"). With `lineTime`, the edit made just
 * before the line appeared wins, so two Update(...) lines naming two different
 * index.tsx files each open their own; without it, the newest change wins.
 * `others` is how many other changed files share the name, for the hover.
 */
export function matchChangedName(
  name: string,
  changed: Pick<ChangedFile, 'path' | 'at'>[],
  edits: EditEvent[],
  lineTime?: number,
): { path: string; others: number } | null {
  const want = baseName(name).toLowerCase();
  if (!want) return null;
  const tail = name.replace(/\//g, '\\').toLowerCase();
  // The written part must end the path on a folder boundary: "Header\index.tsx"
  // fits "...\Header\index.tsx", while "eader\index.tsx" (the second half of a
  // path broken over two lines) fits nothing.
  const fits = (p: string) => {
    const lower = p.toLowerCase();
    return baseName(p).toLowerCase() === want && (tail === want || lower.endsWith('\\' + tail));
  };
  const files = changed.filter(f => fits(f.path));
  const keys = new Set(files.map(f => pathKey(f.path)));
  if (lineTime !== undefined) {
    const before = edits
      .filter(e => fits(e.path) && e.at <= lineTime + LINE_BEFORE_EDIT_MS && lineTime - e.at <= LINE_AFTER_EDIT_MS)
      .sort((a, b) => b.at - a.at)[0];
    if (before) return { path: before.path, others: Math.max(0, keys.size - (keys.has(pathKey(before.path)) ? 1 : 0)) };
  }
  if (files.length === 0) return null;
  const newest = [...files].sort((a, b) => b.at - a.at)[0];
  return { path: newest.path, others: files.length - 1 };
}

/**
 * How far from the right edge a broken path may end. Claude Code wraps its reply
 * at the edge but its tool-result blocks about five columns short of it (measured
 * 2026-09-25 at 112 columns). A wrong join costs nothing: the joined path is only
 * used when it exists on disk, and the part on the first line is tried otherwise.
 */
export const EDGE_SLACK = 12;

/**
 * Claude Code breaks long lines itself, so a path can run to the right edge and go
 * on at the start of the next line (after its indent). When `candidate` ends near
 * the edge and the next line starts with a token that has no space in it, the
 * two may be one path: the joined text and where the second part sits.
 */
export function continuation(
  candidate: Pick<PathCandidate, 'end' | 'text'>,
  lineText: string,
  cols: number,
  nextLine: string,
): { text: string; nextStart: number; nextEnd: number } | null {
  if (candidate.end < cols - EDGE_SLACK) return null;
  if (lineText.slice(candidate.end).trim() !== '') return null;
  const m = /^(\s*)([^\s"'`<>()[\]{}|,;*?]+)/.exec(nextLine);
  if (!m) return null;
  const piece = m[2].replace(TRAILING_PUNCT, '');
  if (!piece) return null;
  const nextStart = m[1].length;
  return { text: candidate.text + piece, nextStart, nextEnd: nextStart + piece.length };
}

/**
 * Claude Code shortens a long path in a tool line with "…" in the middle
 * ("docs\very-long\another-subfolde…\final.md"). Such text cannot be resolved; the
 * part after the last "…" is what can be matched among the chat's own files.
 */
export function elidedTail(text: string): string | null {
  const i = text.lastIndexOf('…');
  if (i < 0) return null;
  const tail = text.slice(i + 1).replace(/^[\\/]+/, '');
  return tail || null;
}

/** How a found file opens: markdown and code in the editor, an image in its app, a folder in Explorer. */
export function openKind(path: string, isDir: boolean): 'editor' | 'default' | 'explorer' {
  if (isDir) return 'explorer';
  return /\.(png|jpe?g|gif|webp|bmp|ico|avif|svg)$/i.test(path) ? 'default' : 'editor';
}

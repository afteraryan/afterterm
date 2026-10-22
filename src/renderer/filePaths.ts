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
  // Sentence punctuation in front of a path goes, and so does an ellipsis ("...docs");
  // a single leading dot stays: it is part of the name (".temp/docs", ".claude",
  // "./a"). Stripping it made ".temp/docs/x.html" look for "temp\docs\x.html", so
  // nothing linked (Aryan, 2026-09-26).
  const lead = /^(?:[,:;!?]+|\.{3,})+/.exec(text);
  if (lead) { text = text.slice(lead[0].length); s += lead[0].length; }
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
  /**
   * The top of the git working tree the chat's folder is in (its worktree's own
   * folder). Claude moves between subfolders with `cd` while it works, but it
   * writes paths from the top of the worktree, so a path is tried from there too
   * (Aryan, 2026-09-30: a reply's paths did not link while Claude sat in a subfolder).
   */
  worktreeTop?: string;
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
 * folder, then the top of its worktree, then the project's (design decision 4,
 * "Resolving it"; the worktree's top since 2026-09-30).
 */
export function resolveCandidates(text: string, ctx: ResolveContext): string[] {
  const t = text.trim();
  if (!t) return [];
  if (/^~[\\/]/.test(t)) return ctx.home ? [normalizePath(t.slice(2), ctx.home)] : [];
  if (isAbsolutePath(t)) return [normalizePath(t)];
  if (/^\//.test(t)) return []; // a POSIX path (WSL, a URL path): not a Windows file
  const out: string[] = [];
  for (const base of [ctx.threadFolder, ctx.worktreeTop, ctx.projectFolder]) {
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

/** True when the text ends in a file extension ("shot.png", "src/a.ts"). */
export function hasExtension(text: string): boolean {
  return EXTENSION.test(String(text ?? ''));
}

/**
 * The file a name (or a tool line) means among the files this chat touched: the
 * ones it changed, wrote (images too), read or sent to the user. With `lineTime`,
 * the edit made just before the line appeared wins, so two Update(...) lines
 * naming two different index.tsx files each open their own; without it, the
 * newest touch wins. `others` is how many other files share the name, for the
 * hover. (Until 2026-09-26 only changed files counted, so a screenshot an agent
 * sent never linked; Aryan asked for every file name with an extension.)
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
  // The same file touched several times (edited, then read, then sent) is one file.
  return { path: newest.path, others: keys.size - 1 };
}

/**
 * Among files found on disk by name, the ones whose path ends with what was
 * written ("v4/burger.png" narrows "burger.png"), on a folder boundary.
 */
export function narrowByTail(text: string, paths: string[]): string[] {
  const tail = text.replace(/\//g, '\\').replace(/^\.[\\/]/, '').toLowerCase();
  const want = baseName(tail);
  return paths.filter(p => {
    const lower = p.toLowerCase();
    return baseName(lower) === want && (tail === want || lower.endsWith('\\' + tail));
  });
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

/** How many more words a path with spaces may run on for: "For Friends\Revy App\x" is two. */
export const SPACED_WORDS = 6;

const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
const count = (text: string, ch: string) => text.split(ch).length - 1;

/** Sentence punctuation, quotes and an unmatched closing bracket off the end of a joined path. */
function trimJoined(text: string): string {
  let t = text;
  for (;;) {
    const before = t;
    t = t.replace(/[.,:;!?"'`]+$/, '');
    const last = t[t.length - 1];
    if (last && CLOSERS[last] && count(t, last) > count(t, CLOSERS[last])) t = t.slice(0, -1);
    if (t === before) return t;
  }
}

/**
 * A path with spaces in it ("D:\Work\For Friends\Revy App\notes.md") comes out of
 * findPathCandidates cut at every space, and none of the pieces exists (Aryan,
 * 2026-09-30: no path into a project under "For Friends" ever linked). These are
 * the longer readings of a path that stops at a space: it joined with the next
 * words on `line`, one space apart, longest first. `from` is where the path so far
 * ends on this line and its whole text (which may have started on the line above).
 * Only a reading that exists on disk is used, so one running on into the sentence
 * ("D:\a\b and more") costs a few checks and links nothing. A path with an
 * extension or a trailing separator is already whole and is not extended, and a
 * bare word is not a path to begin with.
 */
export function spacedVariants(
  line: string,
  from: Pick<PathCandidate, 'end' | 'text' | 'tool' | 'line'>,
  maxWords = SPACED_WORDS,
): { text: string; end: number }[] {
  if (from.tool || from.line !== undefined) return [];
  if (isBareName(from.text) || /[\\/]$/.test(from.text) || hasExtension(from.text)) return [];
  const out: { text: string; end: number }[] = [];
  let pos = from.end;
  for (let k = 0; k < maxWords; k++) {
    // Exactly one space, then a word: a wider gap is a column, not a name.
    if (line[pos] !== ' ' || !line[pos + 1] || /\s/.test(line[pos + 1])) break;
    const word = /^\S+/.exec(line.slice(pos + 1))![0];
    if (/[<>"|?*]/.test(word)) break; // characters no Windows path has
    pos += 1 + word.length;
    const tail = trimJoined(line.slice(from.end, pos));
    const text = from.text + tail;
    if (text.length > 400) break;
    if (tail.trim()) out.push({ text, end: from.end + tail.length });
  }
  // Longest first; two words that trim to the same text are one reading.
  return out.reverse().filter((v, i, all) => all.findIndex(o => o.text === v.text) === i);
}

/**
 * Claude Code wraps a reply at spaces, so a path with spaces in it breaks at one of
 * them: "D:\Work\For Friends\Revy" ends one line and "App\notes.md" starts the
 * next, the space itself dropped, often far from the right edge. When the path so
 * far ends its line and the next line's first word would not have fitted after it
 * (which is why it wrapped), the two may be one path with a space between: the
 * joined text and where the second part sits. Like `continuation`, a wrong join
 * costs nothing, since only a path that exists is used.
 */
export function wrappedAtSpace(
  from: Pick<PathCandidate, 'end' | 'text' | 'tool' | 'line'>,
  lineText: string,
  cols: number,
  nextLine: string,
): { text: string; nextStart: number; nextEnd: number } | null {
  if (from.tool || from.line !== undefined) return null;
  if (isBareName(from.text) || /[\\/]$/.test(from.text) || hasExtension(from.text)) return null;
  if (lineText.slice(from.end).trim() !== '') return null;
  const m = /^(\s*)(\S+)/.exec(nextLine);
  if (!m || /[<>"|?*]/.test(m[2])) return null;
  if (from.end + 1 + m[2].length <= cols - EDGE_SLACK) return null; // it would have fitted: a real line break
  const piece = trimJoined(m[2]);
  if (!piece) return null;
  const nextStart = m[1].length;
  return { text: `${from.text} ${piece}`, nextStart, nextEnd: nextStart + piece.length };
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

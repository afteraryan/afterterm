// Web links that run over several rows of the terminal (AFT-61).
//
// Claude Code cuts a long link at the edge itself and moves the cursor to the next
// row, so xterm sees separate lines, and its web-links addon linked only the first
// row's part: a click opened half the address and the other rows nothing. A link
// is put back together one of two ways, in this order:
//
//   1. In a chat, from its transcript. Main hands over the chat's links that start
//      with what is on the link's first row; the one whose rest the rows below spell
//      out is the link, wherever it ends and at any width. Nothing is guessed.
//   2. From the column it was cut at. A link that runs to the exact column a row is
//      cut at goes on at the start of the next row. Claude Code cuts its replies at
//      full width, your own prompt one short and tool output five short; a shell
//      program is only trusted at full width. A complete link that happens to end
//      exactly there, followed by a long word, would be joined to that word; in a
//      chat the transcript is asked first, which rules that out.
//
// A row the terminal wrapped itself (xterm's isWrapped) always continues the one
// above, as it does for the addon.
//
// Pure: rows of text in, links out. Terminal/webLinks.ts reads the buffer and asks
// main for the transcript's links.

import { cleanUrl } from '../session-files.ts';

export interface Row {
  /** The row's characters, trailing spaces trimmed. */
  text: string;
  /** Cells the trimmed text covers (a wide character takes two). */
  width: number;
  /** The terminal wrapped onto this row from the one above (xterm's isWrapped). */
  wrapped: boolean;
}

/** The part of a link on one row: string indices into that row's text, end exclusive. */
export interface Segment {
  row: number;
  start: number;
  end: number;
}

export interface WebLink {
  url: string;
  segments: Segment[];
  how: 'transcript' | 'columns';
}

/** How many rows one link may run over (a 400 character link in a narrow pane). */
export const MAX_LINK_ROWS = 12;

/** The columns a row can be cut at: Claude Code's three in a chat, full width in a shell. */
export function cutWidths(cols: number, chat: boolean): number[] {
  return chat ? [cols, cols - 1, cols - 5] : [cols];
}

/** Characters that end a link in terminal text ("…" is Claude Code shortening a line). */
const STOP = /[\s"'`<>\\|{}^…]/;
/**
 * What may follow the end of a link on its row: nothing, a space, or punctuation
 * around it. Not "…": a link that stops there was shortened, and is matched as
 * shortened (below), never as complete.
 */
const AFTER_LINK = /[\s"'`<>\\|{}^).,:;!?\]*]/;

/** Each link start on a row ("http://" or "https://") and the run of link characters after it. */
export function linkStarts(text: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (const m of text.matchAll(/https?:\/\//gi)) {
    const start = m.index ?? 0;
    // One inside the previous run is part of that link (redirect_uri=https://...).
    if (out.length && start < out[out.length - 1].end) continue;
    let end = start + m[0].length;
    while (end < text.length && !STOP.test(text[end])) end++;
    out.push({ start, end });
  }
  return out;
}

/**
 * Where a link's next part starts on the row below. Claude Code indents what it
 * cuts, so in a chat the indent is skipped even on a row the terminal wrapped
 * (ConPTY sometimes lets Claude Code's indent flow on as a wrap). In a shell a
 * wrapped row continues exactly, so a space there is a real one and ends the link.
 */
function continuationStart(row: Row, chat: boolean): number {
  if (row.wrapped && !chat) return 0;
  return row.text.length - row.text.trimStart().length;
}

function isWebUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === 'http:' || u.protocol === 'https:') && (u.hostname.includes('.') || u.hostname === 'localhost');
  } catch {
    return false;
  }
}

/**
 * Follows `url` from `start` on `row` down the rows: each row holds the next part
 * of it up to the row's end, until one holds the rest. Claude Code shortens some
 * lines with "…" (a tool call's line), and a link shortened that way ends at the
 * "…". Null when the rows do not spell out this link.
 */
export function followUrl(
  rows: Row[], row: number, start: number, url: string, chat: boolean,
): { segments: Segment[]; elided: boolean; shown: number } | null {
  const segments: Segment[] = [];
  let used = 0;
  let r = row;
  let s = start;
  for (;;) {
    const text = rows[r].text;
    const here = text.slice(s);
    const rest = url.slice(used);
    if (here.startsWith(rest)) {
      // The link has to end here, not run on into more link characters.
      const after = text[s + rest.length];
      if (after !== undefined && !AFTER_LINK.test(after)) return null;
      segments.push({ row: r, start: s, end: s + rest.length });
      return { segments, elided: false, shown: url.length };
    }
    const dots = here.indexOf('…');
    if (dots > 0 && rest.startsWith(here.slice(0, dots))) {
      segments.push({ row: r, start: s, end: s + dots });
      return { segments, elided: true, shown: used + dots };
    }
    if (here.length === 0 || !rest.startsWith(here)) return null;
    segments.push({ row: r, start: s, end: text.length });
    used += here.length;
    r++;
    if (r >= rows.length || segments.length >= MAX_LINK_ROWS) return null;
    s = continuationStart(rows[r], chat);
  }
}

/**
 * The link among the transcript's `candidates` (most recent first) that the rows
 * spell out from `start`: the one shown longest wins, so of two links that share
 * a first row the rows below decide, and a link that ends on its first row stays
 * one row long however close to the edge it ends.
 */
export function linkFromTranscript(
  rows: Row[], row: number, start: number, candidates: string[], chat: boolean,
): WebLink | null {
  let best: { url: string; segments: Segment[]; shown: number; elided: boolean } | null = null;
  for (const url of candidates) {
    const got = followUrl(rows, row, start, url, chat);
    if (!got) continue;
    if (!best || got.shown > best.shown || (got.shown === best.shown && best.elided && !got.elided)) {
      best = { url, ...got };
    }
  }
  return best ? { url: best.url, segments: best.segments, how: 'transcript' } : null;
}

/**
 * The link from `start` to `end` on `row`, run on over every row it was cut at
 * (see the top of this file). Null unless it really runs over two rows or more:
 * a link on one row is the web-links addon's. A row whose part ends in
 * punctuation or a closing bracket ("(https://a.b/c)" at the edge) is where the
 * link ended, and one Claude Code shortened with "…" is not given out whole.
 */
export function linkFromColumns(
  rows: Row[], row: number, start: number, end: number, widths: number[], chat: boolean,
): WebLink | null {
  const segments: Segment[] = [{ row, start, end }];
  let text = rows[row].text.slice(start, end);
  let r = row;
  for (;;) {
    const last = segments[segments.length - 1];
    if (rows[r].text[last.end] === '…') return null;
    if (last.end !== rows[r].text.length || r + 1 >= rows.length || segments.length >= MAX_LINK_ROWS) break;
    if (cleanUrl(text) !== text) break;
    const next = rows[r + 1];
    if (!next.wrapped && !widths.includes(rows[r].width)) break;
    const s = continuationStart(next, chat);
    let e = s;
    while (e < next.text.length && !STOP.test(next.text[e])) e++;
    if (e === s) break;
    segments.push({ row: r + 1, start: s, end: e });
    text += next.text.slice(s, e);
    r++;
  }
  const url = cleanUrl(text);
  // What cleanUrl took off the end ("." or a closing bracket) comes off the last rows too.
  let extra = text.length - url.length;
  while (extra > 0 && segments.length) {
    const last = segments[segments.length - 1];
    const len = last.end - last.start;
    if (len <= extra) { segments.pop(); extra -= len; }
    else { last.end -= extra; extra = 0; }
  }
  if (segments.length < 2 || !isWebUrl(url)) return null;
  return { url, segments, how: 'columns' };
}

/** A link start's text without what only surrounds it: what the transcript is asked about. */
function prefixOf(rows: Row[], row: number, s: { start: number; end: number }): string {
  return cleanUrl(rows[row].text.slice(s.start, s.end));
}

const usable = (prefix: string) => /^https?:\/\/[^/?#\s]/i.test(prefix);

/** Every prefix `resolveLinks` will ask the transcript about, for rows 0 to `upTo`. */
export function linkPrefixes(rows: Row[], upTo: number): string[] {
  const out = new Set<string>();
  for (let r = 0; r <= upTo && r < rows.length; r++) {
    for (const s of linkStarts(rows[r].text)) {
      const p = prefixOf(rows, r, s);
      if (usable(p)) out.add(p);
    }
  }
  return [...out];
}

export interface ResolveOptions {
  cols: number;
  /** A Claude Code chat: its cut columns, its indents, and its transcript. */
  chat: boolean;
  /** The transcript's links for a prefix, most recent first; undefined when not asked. */
  transcript?: (prefix: string) => string[] | undefined;
}

/**
 * The links that start on rows 0 to `upTo` and run over more than one row, or
 * that the transcript knows. Rows are read top down, and a link's own later rows
 * are never read as starts of their own.
 */
export function resolveLinks(rows: Row[], upTo: number, opts: ResolveOptions): WebLink[] {
  const widths = cutWidths(opts.cols, opts.chat);
  const links: WebLink[] = [];
  const covered = new Map<number, number>();
  for (let r = 0; r <= upTo && r < rows.length; r++) {
    for (const s of linkStarts(rows[r].text)) {
      if (s.start < (covered.get(r) ?? -1)) continue;
      const prefix = prefixOf(rows, r, s);
      if (!usable(prefix)) continue;
      const candidates = opts.chat ? opts.transcript?.(prefix) : undefined;
      const link = (candidates?.length ? linkFromTranscript(rows, r, s.start, candidates, opts.chat) : null)
        ?? linkFromColumns(rows, r, s.start, s.end, widths, opts.chat);
      if (!link) continue;
      links.push(link);
      for (const seg of link.segments) covered.set(seg.row, Math.max(covered.get(seg.row) ?? -1, seg.end));
    }
  }
  return links;
}

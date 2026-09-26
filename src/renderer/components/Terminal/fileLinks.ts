// Clickable file paths in a terminal (edited files, Phase 3): an xterm link
// provider beside the web-links addon. Hovering a path underlines it and a click
// opens it, the way a URL behaves; nothing is drawn until main has said the path
// exists. Recognising, resolving and matching are pure (filePaths.ts); this file
// only reads the buffer, asks main, and hands xterm its links.
import type { IBufferLine, ILink, ILinkProvider, IMarker, Terminal } from '@xterm/xterm';
import type { ChangedFile, EditEvent } from '../../../session-files';
import {
  findPathCandidates, resolveCandidates, isBareName, matchChangedName, continuation, openKind, elidedTail, hasExtension, narrowByTail,
  type PathCandidate,
} from '../../filePaths';
import './fileLinks.css';

/** What a thread's links resolve against, read fresh on every hover. */
export interface FileLinkContext {
  threadFolder?: string;
  projectFolder?: string;
  home?: string;
  changed: Pick<ChangedFile, 'path' | 'at'>[];
  edits: EditEvent[];
  /** Files the chat read or sent to the user. */
  refs: EditEvent[];
}

export interface FileLinkTarget {
  path: string;
  line?: number;
  how: 'editor' | 'default' | 'explorer';
}

// ── existence, cached ───────────────────────────────────────────────────────

type Kind = 'file' | 'dir' | null;
const statCache = new Map<string, { kind: Kind; at: number }>();
// A path that exists stays known for a minute; one that does not is asked again
// after a few seconds, since Claude often prints a path just before writing it.
const FOUND_TTL = 60_000;
const MISSING_TTL = 4_000;

async function statMany(paths: string[]): Promise<Map<string, Kind>> {
  const now = Date.now();
  const out = new Map<string, Kind>();
  const ask: string[] = [];
  for (const p of paths) {
    const key = p.toLowerCase();
    const hit = statCache.get(key);
    if (hit && now - hit.at < (hit.kind ? FOUND_TTL : MISSING_TTL)) out.set(p, hit.kind);
    else if (!ask.includes(p)) ask.push(p);
  }
  if (ask.length) {
    let got: Record<string, Kind> = {};
    try { got = await window.afterterm.files.stat(ask); } catch { /* treat as missing */ }
    for (const p of ask) {
      const kind = got[p] ?? null;
      statCache.set(p.toLowerCase(), { kind, at: Date.now() });
      out.set(p, kind);
    }
  }
  return out;
}

// Names looked up on disk (main's files:find), per folder set, for a short while:
// a hover over the same reply asks again for every line it crosses.
const findCache = new Map<string, { paths: string[]; at: number }>();
const FIND_TTL = 20_000;

async function findMany(names: string[], roots: string[]): Promise<Map<string, string[]>> {
  const now = Date.now();
  const scope = roots.map(r => r.toLowerCase()).join('|');
  const out = new Map<string, string[]>();
  const ask: string[] = [];
  for (const name of names) {
    const hit = findCache.get(`${scope}::${name.toLowerCase()}`);
    if (hit && now - hit.at < FIND_TTL) out.set(name, hit.paths);
    else if (!ask.includes(name)) ask.push(name);
  }
  if (ask.length) {
    let got: Record<string, string[]> = {};
    try { got = await window.afterterm.files.find(ask, roots); } catch { /* nothing found */ }
    for (const name of ask) {
      const paths = got[name] ?? [];
      findCache.set(`${scope}::${name.toLowerCase()}`, { paths, at: Date.now() });
      out.set(name, paths);
    }
  }
  return out;
}

// ── one buffer line as text, with string index → cell column ───────────────

interface LineText {
  text: string;
  /** cells[i] is the 0-based column the i-th character of `text` starts in. */
  cells: number[];
  widths: number[];
}

function readLine(line: IBufferLine | undefined, cols: number): LineText {
  const out: LineText = { text: '', cells: [], widths: [] };
  if (!line) return out;
  for (let x = 0; x < cols; x++) {
    const cell = line.getCell(x);
    if (!cell) break;
    const w = cell.getWidth();
    if (w === 0) continue; // the second half of a wide character
    const chars = cell.getChars() || ' ';
    for (const ch of chars) {
      out.text += ch;
      out.cells.push(x);
      out.widths.push(w);
    }
  }
  out.text = out.text.replace(/\s+$/, '');
  return out;
}

function span(l: LineText, start: number, end: number, y: number) {
  const s = l.cells[start] ?? 0;
  const lastIdx = Math.max(start, end - 1);
  const e = (l.cells[lastIdx] ?? s) + (l.widths[lastIdx] ?? 1) - 1;
  return { start: { x: s + 1, y }, end: { x: e + 1, y } };
}

// ── when a tool line appeared, so each Update(...) opens its own edit ───────

const TOOL_LINE = /^\s*[●⏺]\s*(Update|Write|Edit|Create|MultiEdit|NotebookEdit)\(/;
const MAX_TOOL_MARKS = 400;
const SCAN_ROWS = 40;

/**
 * Stamps the time each Claude Code edit line was first drawn, with an xterm
 * marker so the stamp follows the line as it scrolls. Ink redraws its live area
 * in place, so a row whose text changes is stamped again.
 */
export function trackToolLines(term: Terminal) {
  const marks: { marker: IMarker; at: number; text: string }[] = [];
  let pending = false;

  const scan = () => {
    pending = false;
    try { scanRows(); } catch { /* the terminal was disposed while the scan waited */ }
  };

  const scanRows = () => {
    const buf = term.buffer.active;
    const cursorRow = buf.baseY + buf.cursorY;
    for (let row = Math.max(0, cursorRow - SCAN_ROWS); row <= cursorRow; row++) {
      const text = buf.getLine(row)?.translateToString(true) ?? '';
      if (!TOOL_LINE.test(text)) continue;
      const existing = marks.find(m => !m.marker.isDisposed && m.marker.line === row);
      if (existing) {
        if (existing.text !== text) { existing.text = text; existing.at = Date.now(); }
        continue;
      }
      const marker = term.registerMarker(row - cursorRow);
      if (!marker) continue;
      marks.push({ marker, at: Date.now(), text });
      while (marks.length > MAX_TOOL_MARKS) marks.shift()?.marker.dispose();
    }
  };

  const sub = term.onWriteParsed(() => {
    if (pending) return;
    pending = true;
    setTimeout(scan, 120);
  });

  return {
    /** When the tool line on this 0-based buffer row was drawn, if it is one. */
    timeAt(row: number): number | undefined {
      return marks.find(m => !m.marker.isDisposed && m.marker.line === row)?.at;
    },
    dispose() {
      sub.dispose();
      for (const m of marks) m.marker.dispose();
      marks.length = 0;
    },
  };
}

// ── the hover note for a name matched among the chat's files ────────────────

let tip: HTMLDivElement | null = null;
function showTip(event: MouseEvent, text: string) {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'file-link-tip';
    document.body.appendChild(tip);
  }
  tip.textContent = text;
  tip.style.left = `${Math.min(event.clientX + 12, window.innerWidth - 20)}px`;
  tip.style.top = `${event.clientY + 16}px`;
  tip.classList.add('show');
}
function hideTip() {
  tip?.classList.remove('show');
}

function shortPath(path: string, folder: string | undefined): string {
  if (folder) {
    const base = folder.replace(/[\\/]+$/, '');
    if (path.toLowerCase().startsWith(base.toLowerCase() + '\\')) return path.slice(base.length + 1);
  }
  return path;
}

// ── the provider ────────────────────────────────────────────────────────────

interface Pending {
  cand: PathCandidate;
  /** Text to resolve (the joined path for a split one). */
  text: string;
  range: ILink['range'];
  lineTime?: number;
}

export function createFileLinkProvider(
  term: Terminal,
  getContext: () => FileLinkContext | null,
  open: (target: FileLinkTarget) => void,
  toolTimes: { timeAt(row: number): number | undefined },
): ILinkProvider {
  return {
    provideLinks(y, callback) {
      const ctx = getContext();
      if (!ctx) { callback(undefined); return; }
      const buf = term.buffer.active;
      const cols = term.cols;
      const here = readLine(buf.getLine(y - 1), cols);
      const pending: Pending[] = [];
      const lineTime = toolTimes.timeAt(y - 1);

      // A path from the line above that runs over the edge into this one. Its
      // second half is not offered again as a path of its own.
      let coveredUpTo = -1;
      if (y > 1) {
        const above = readLine(buf.getLine(y - 2), cols);
        const last = findPathCandidates(above.text).pop();
        if (last) {
          const j = continuation(last, above.text, cols, here.text);
          if (j) {
            pending.push({
              cand: last,
              text: j.text,
              lineTime: toolTimes.timeAt(y - 2),
              range: { start: span(above, last.start, last.end, y - 1).start, end: span(here, j.nextStart, j.nextEnd, y).end },
            });
            coveredUpTo = j.nextEnd;
          }
        }
      }

      const next = y < buf.length ? readLine(buf.getLine(y), cols) : null;
      for (const cand of findPathCandidates(here.text)) {
        if (cand.start < coveredUpTo) continue;
        const j = next ? continuation(cand, here.text, cols, next.text) : null;
        if (j) {
          pending.push({
            cand, text: j.text, lineTime,
            range: { start: span(here, cand.start, cand.end, y).start, end: span(next!, j.nextStart, j.nextEnd, y + 1).end },
          });
        }
        pending.push({ cand, text: cand.text, lineTime, range: span(here, cand.start, cand.end, y) });
      }
      if (pending.length === 0) { callback(undefined); return; }

      // Every path each candidate could mean, checked on disk in one call. Since
      // 2026-09-26 every file name with an extension links (Aryan: an image an
      // agent sent could not be opened), found in this order: for a bare name,
      // the files this chat touched (changed, written, read or sent; newest), then
      // the chat's and the project's folders; for a path, those folders first.
      // What is still not found is looked up by name under those folders (disk).
      const touched = [...ctx.changed, ...ctx.edits, ...ctx.refs];
      const options = pending.map(p => {
        // A path Claude Code shortened with "…" is matched by what follows it.
        const elided = elidedTail(p.text);
        const lookup = elided ?? p.text;
        const bare = isBareName(lookup);
        const direct = elided ? [] : resolveCandidates(lookup, ctx);
        const named = matchChangedName(lookup, touched, ctx.edits, p.cand.tool ? p.lineTime : undefined);
        return { p, lookup, bare, direct, named };
      });
      const all = options.flatMap(o => [...o.direct, ...(o.named ? [o.named.path] : [])]);
      statMany(all).then(async found => {
        // The last resort, only for names with an extension nothing above found.
        const roots = [ctx.threadFolder, ctx.projectFolder].filter((r): r is string => !!r);
        const unfound = options.filter(o =>
          hasExtension(o.lookup)
          && !o.direct.some(d => found.get(d))
          && !(o.named && found.get(o.named.path)));
        const onDisk = unfound.length && roots.length ? await findMany(unfound.map(o => o.lookup), roots) : new Map<string, string[]>();
        const links: ILink[] = [];
        const taken: { start: number; end: number; y: number }[] = [];
        for (const { p, lookup, bare, direct, named } of options) {
          // The joined candidate was pushed before its partial; once it links,
          // the partial on the same cells is skipped.
          const startY = p.range.start.y;
          if (taken.some(t => t.y === startY && p.range.start.x >= t.start && p.range.start.x <= t.end)) continue;
          const byName = named && found.get(named.path) ? named : null;
          const inFolder = direct.find(d => found.get(d));
          let path: string | undefined;
          let note: string | undefined;
          // Which file a name opens, relative to the chat's folder when inside it.
          const say = (target: string, others: number, how: string) =>
            others > 0 ? `Opens ${shortPath(target, ctx.threadFolder)}, ${how} of ${others + 1} with this name` : `Opens ${shortPath(target, ctx.threadFolder)}`;
          if (byName && (bare || !inFolder)) {
            path = byName.path;
            note = say(path, byName.others, 'the newest');
          } else if (inFolder) {
            path = inFolder;
          } else {
            const hits = narrowByTail(lookup, onDisk.get(lookup) ?? []);
            if (hits.length) {
              path = hits[0];
              found.set(path, 'file');
              note = say(path, hits.length - 1, 'the nearest');
            }
          }
          if (!path) continue;
          const kind = found.get(path)!;
          const target: FileLinkTarget = { path, line: p.cand.line, how: openKind(path, kind === 'dir') };
          taken.push({ start: p.range.start.x, end: p.range.end.y === startY ? p.range.end.x : cols, y: startY });
          links.push({
            range: p.range,
            text: p.text,
            decorations: { underline: true, pointerCursor: true },
            activate: (event) => {
              if (event.button !== 0) return;
              hideTip();
              open(target);
            },
            hover: note ? (event) => showTip(event, note!) : undefined,
            leave: note ? () => hideTip() : undefined,
          });
        }
        callback(links.length ? links : undefined);
      }, () => callback(undefined));
    },
  };
}

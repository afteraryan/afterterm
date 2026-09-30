// Clickable file paths in a terminal (edited files, Phase 3): an xterm link
// provider beside the web-links addon. Hovering a path underlines it and a click
// opens it, the way a URL behaves; nothing is drawn until main has said the path
// exists. Recognising, resolving and matching are pure (filePaths.ts); this file
// only reads the buffer, asks main, and hands xterm its links.
import type { IBufferLine, ILink, ILinkProvider, IMarker, Terminal } from '@xterm/xterm';
import type { ChangedFile, EditEvent } from '../../../session-files';
import {
  findPathCandidates, resolveCandidates, isBareName, matchChangedName, continuation, openKind, elidedTail, hasExtension, narrowByTail,
  spacedVariants, wrappedAtSpace,
  type PathCandidate,
} from '../../filePaths';
import './fileLinks.css';

/** What a thread's links resolve against, read fresh on every hover. */
export interface FileLinkContext {
  threadFolder?: string;
  /** The top of the worktree the thread folder is in (see ResolveContext). */
  worktreeTop?: string;
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
/** main.ts's MAX_STAT_PATHS. */
const STAT_BATCH = 200;

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
    // Main answers at most STAT_BATCH paths a call; a row of paths with spaces
    // can ask for more, so larger asks go in several calls.
    let got: Record<string, Kind> = {};
    const batches: string[][] = [];
    for (let i = 0; i < ask.length; i += STAT_BATCH) batches.push(ask.slice(i, i + STAT_BATCH));
    try { got = Object.assign({}, ...await Promise.all(batches.map(b => window.afterterm.files.stat(b)))); } catch { /* treat as missing */ }
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

/** The path relative to the first of `folders` it is inside, or whole. */
function shortPath(path: string, folders: (string | undefined)[]): string {
  for (const folder of folders) {
    if (!folder) continue;
    const base = folder.replace(/[\\/]+$/, '');
    if (path.toLowerCase().startsWith(base.toLowerCase() + '\\')) return path.slice(base.length + 1);
  }
  return path;
}

// ── the provider ────────────────────────────────────────────────────────────

/** How many rows one path may run over: a long path with spaces in a narrow terminal. */
const MAX_PATH_ROWS = 4;

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
      const pending: Pending[] = [];
      // The rows around this one (1-based): a path that reaches this row may start
      // up to MAX_PATH_ROWS - 1 rows above it and run on below it.
      const top = Math.max(1, y - (MAX_PATH_ROWS - 1));
      const bottom = Math.min(buf.length, y + (MAX_PATH_ROWS - 1));
      const rows: LineText[] = [];
      for (let r = top; r <= bottom; r++) rows.push(readLine(buf.getLine(r - 1), cols));
      const at = (row: number) => rows[row - top];
      // How far into a row the second half of a path broken at the edge above
      // it reaches, so that half is not offered as a path of its own.
      const covered = new Map<number, number>();

      // Every reading of a path from `from` on `row`: rejoined across its spaces
      // (spacedVariants), longest first, then as it is. Each also goes on into
      // the row below when the path does, broken at the right edge (continuation)
      // or wrapped at one of its own spaces (wrappedAtSpace), for up to `rowsLeft`
      // rows; the longer readings come first. A reading whose text goes on below
      // with a separator ("...\For Friends" then "\Revy App\...") is only part of
      // a path and is never offered alone, or it would open the wrong folder.
      type Reading = { text: string; row: number; end: number };
      const readings = (row: number, from: Pick<PathCandidate, 'text' | 'end' | 'tool' | 'line'>, rowsLeft: number): Reading[] => {
        const out: Reading[] = [];
        const l = at(row);
        const below = row < bottom ? at(row + 1) : null;
        for (const r of [...spacedVariants(l.text, from), { text: from.text, end: from.end }]) {
          let partial = false;
          if (below && rowsLeft > 1) {
            const edge = continuation({ end: r.end, text: r.text }, l.text, cols, below.text);
            const wrapped = wrappedAtSpace({ ...from, end: r.end, text: r.text }, l.text, cols, below.text);
            for (const j of [edge, wrapped]) if (j) out.push(...readings(row + 1, { ...from, text: j.text, end: j.nextEnd }, rowsLeft - 1));
            if (edge) {
              covered.set(row + 1, Math.max(covered.get(row + 1) ?? -1, edge.nextEnd));
              partial = /^[\\/]/.test(edge.text.slice(r.text.length));
            }
          }
          if (!partial) out.push({ text: r.text, row, end: r.end });
        }
        return out;
      };

      // Paths that start on the rows above and reach this one first, then this
      // row's own. A reading pushed earlier wins the cells it covers once it links.
      for (let row = top; row <= y; row++) {
        const l = at(row);
        const time = toolTimes.timeAt(row - 1);
        for (const cand of findPathCandidates(l.text)) {
          if (cand.start < (covered.get(row) ?? -1)) continue;
          const start = span(l, cand.start, cand.end, row).start;
          for (const r of readings(row, cand, MAX_PATH_ROWS)) {
            if (r.row < y) continue; // ends above this row: that row's own hover offers it
            pending.push({ cand, text: r.text, lineTime: time, range: { start, end: span(at(r.row), 0, r.end, r.row).end } });
          }
        }
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
        // The last resort, only for names with an extension nothing above found:
        // a search by name under the chat's folder (nearest first), the whole of
        // its worktree (Claude may have moved into a subfolder since), then the
        // project's folder.
        const roots = [ctx.threadFolder, ctx.worktreeTop, ctx.projectFolder]
          .filter((r, i, all): r is string => !!r && all.findIndex(o => o?.toLowerCase() === r.toLowerCase()) === i);
        const unfound = options.filter(o =>
          hasExtension(o.lookup)
          && !o.direct.some(d => found.get(d))
          && !(o.named && found.get(o.named.path)));
        const onDisk = unfound.length && roots.length ? await findMany(unfound.map(o => o.lookup), roots) : new Map<string, string[]>();
        const links: ILink[] = [];
        const taken: ILink['range'][] = [];
        const within = (at: ILink['range']['start'], r: ILink['range']) =>
          (at.y > r.start.y || (at.y === r.start.y && at.x >= r.start.x))
          && (at.y < r.end.y || (at.y === r.end.y && at.x <= r.end.x));
        for (const { p, lookup, bare, direct, named } of options) {
          // A joined reading was pushed before its pieces; once it links, a
          // piece starting on its cells (on either line) is skipped.
          if (taken.some(r => within(p.range.start, r))) continue;
          const byName = named && found.get(named.path) ? named : null;
          const inFolder = direct.find(d => found.get(d));
          let path: string | undefined;
          let note: string | undefined;
          // Which file a name opens, relative to the chat's folder when inside it.
          const say = (target: string, others: number, how: string) =>
            others > 0 ? `Opens ${shortPath(target, [ctx.threadFolder, ctx.worktreeTop])}, ${how} of ${others + 1} with this name` : `Opens ${shortPath(target, [ctx.threadFolder, ctx.worktreeTop])}`;
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
          taken.push(p.range);
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

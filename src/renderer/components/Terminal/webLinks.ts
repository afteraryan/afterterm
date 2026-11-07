// Web links that run over several rows (AFT-61): an xterm link provider asked
// before the web-links addon, so a whole link wins over the addon's first-row part
// of it. The rules are pure (../../webLinks.ts); this file reads the buffer, asks
// main for a chat's links from its transcript, and hands xterm the links.
import type { ILink, ILinkProvider, Terminal } from '@xterm/xterm';
import { readLine, span, type LineText } from './fileLinks';
import { resolveLinks, linkPrefixes, MAX_LINK_ROWS, type Row } from '../../webLinks';

/** A chat's session, whose transcript knows its links. */
export interface WebLinkChat {
  sessionId: string;
  cwd: string;
}

// The transcript's answers for a few seconds: a hover over a long link asks about
// the same first row from every row it crosses. Short, because a link can be on
// screen a moment before its message reaches the transcript.
const answers = new Map<string, { urls: string[]; at: number }>();
const ANSWER_MS = 3000;
const MAX_ANSWERS = 500;

async function transcriptLinks(chat: WebLinkChat, prefixes: string[]): Promise<Map<string, string[]>> {
  const now = Date.now();
  const out = new Map<string, string[]>();
  const ask: string[] = [];
  for (const p of prefixes) {
    const hit = answers.get(`${chat.sessionId}\n${p}`);
    if (hit && now - hit.at < ANSWER_MS) out.set(p, hit.urls);
    else ask.push(p);
  }
  if (ask.length) {
    let got: Record<string, string[]> = {};
    try { got = await window.afterterm.sessionFiles.urls(chat.sessionId, chat.cwd, ask); } catch { /* the column rule still applies */ }
    for (const p of ask) {
      const urls = Array.isArray(got[p]) ? got[p] : [];
      answers.set(`${chat.sessionId}\n${p}`, { urls, at: Date.now() });
      out.set(p, urls);
    }
    while (answers.size > MAX_ANSWERS) answers.delete(answers.keys().next().value as string);
  }
  return out;
}

export function createWebLinkProvider(
  term: Terminal,
  getChat: () => WebLinkChat | null,
  open: (url: string) => void,
): ILinkProvider {
  return {
    provideLinks(y, callback) {
      const buf = term.buffer.active;
      const cols = term.cols;
      // The rows around this one (1-based): a link that reaches this row may start
      // up to MAX_LINK_ROWS - 1 rows above it and run on below it.
      const top = Math.max(1, y - (MAX_LINK_ROWS - 1));
      const bottom = Math.min(buf.length, y + (MAX_LINK_ROWS - 1));
      const lines: LineText[] = [];
      const rows: Row[] = [];
      for (let r = top; r <= bottom; r++) {
        const line = buf.getLine(r - 1);
        const l = readLine(line, cols);
        const last = l.text.length - 1;
        lines.push(l);
        rows.push({ text: l.text, width: last >= 0 ? l.cells[last] + l.widths[last] : 0, wrapped: !!line?.isWrapped });
      }
      const at = y - top;
      const chat = getChat();

      const finish = (known?: Map<string, string[]>) => {
        const links = resolveLinks(rows, at, {
          cols,
          chat: !!chat,
          transcript: known ? (p) => known.get(p) : undefined,
        });
        const out: ILink[] = [];
        for (const link of links) {
          const first = link.segments[0];
          const last = link.segments[link.segments.length - 1];
          if (top + first.row > y || top + last.row < y) continue;
          out.push({
            range: {
              start: span(lines[first.row], first.start, first.end, top + first.row).start,
              end: span(lines[last.row], last.start, last.end, top + last.row).end,
            },
            text: link.url,
            decorations: { underline: true, pointerCursor: true },
            activate: (event) => {
              if (event.button !== 0) return;
              open(link.url);
            },
          });
        }
        callback(out.length ? out : undefined);
      };

      const prefixes = linkPrefixes(rows, at);
      if (!chat || prefixes.length === 0) { finish(); return; }
      transcriptLinks(chat, prefixes).then(finish, () => finish());
    },
  };
}

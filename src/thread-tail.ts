// The scrollback tail a sleeping thread leaves behind.
//
// Windows ConPTY dies with its process, so a thread that goes to sleep (or a whole
// app that quits) loses its screen. What survives is a short tail of the last lines,
// written to <userData>/threads/<tabId>.txt, replayed dimmed above a "Woke just now"
// divider when the thread wakes. That is the entire point: waking should look like
// coming back to the same desk, not like opening a blank terminal.
//
// This module is pure (no Electron, no app state) so it can be unit-tested with plain
// Node, and so both the main process (writing/reading files) and the renderer (turning
// the tail back into escape sequences) share one definition of the format.

// No node:path import: the renderer bundles this module too (for renderTailForTerminal),
// and Vite warns on Node built-ins there. The join below is enough for a Windows-only app.

/** How many lines of tail we keep. Enough to see the last command and its output. */
export const TAIL_MAX_LINES = 200;

/** Hard byte ceiling, so one thread spewing very long lines cannot fill the disk. */
export const TAIL_MAX_BYTES = 64 * 1024;

/**
 * A tab id we are willing to turn into a file name. Tab ids look like "tab-12", and
 * they arrive from the renderer, so this is the guard that keeps "..", "a/b" and
 * friends from escaping the threads folder.
 */
export function isThreadId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

/** Where one thread's tail lives. Callers must have checked isThreadId first. */
export function tailFilePath(dir: string, id: string): string {
  return `${dir.replace(/[\\/]+$/, '')}\\${id}.txt`;
}

/** UTF-8 length of a string, without allocating a Buffer per call where avoidable. */
function byteLength(s: string): number {
  return Buffer.byteLength(s, 'utf-8');
}

/**
 * The lines actually worth saving: the last maxLines, trailing whitespace stripped
 * (a terminal pads rows with spaces), trailing empty lines dropped (the blank rows
 * below a prompt would otherwise be most of the tail), and then lines dropped from
 * the front until the whole thing fits in maxBytes. Dropping from the front is right:
 * the newest output is the part worth keeping.
 *
 * Never throws. Anything that is not an array of strings is coerced or skipped, since
 * this runs on data handed over IPC.
 */
export function trimTail(
  lines: string[],
  maxLines: number = TAIL_MAX_LINES,
  maxBytes: number = TAIL_MAX_BYTES,
): string[] {
  if (!Array.isArray(lines)) return [];
  const limitLines = Number.isFinite(maxLines) && maxLines > 0 ? Math.floor(maxLines) : TAIL_MAX_LINES;
  const limitBytes = Number.isFinite(maxBytes) && maxBytes > 0 ? Math.floor(maxBytes) : TAIL_MAX_BYTES;

  const cleaned: string[] = [];
  for (const line of lines.slice(-limitLines)) {
    if (typeof line === 'string') cleaned.push(line.replace(/\s+$/, ''));
    else if (line === null || line === undefined) cleaned.push('');
    else cleaned.push(String(line).replace(/\s+$/, ''));
  }

  while (cleaned.length > 0 && cleaned[cleaned.length - 1] === '') cleaned.pop();

  // Byte cap: count from the back, keep the newest lines that fit. The +1 is the
  // newline each line costs once serialized.
  let total = 0;
  let start = cleaned.length;
  for (let i = cleaned.length - 1; i >= 0; i--) {
    const cost = byteLength(cleaned[i]) + 1;
    if (total + cost > limitBytes) break;
    total += cost;
    start = i;
  }
  return cleaned.slice(start);
}

/**
 * The file body for a tail: one line each, with a final newline. An empty tail is an
 * empty file, not a lone newline, so the round trip through parseTail is exact.
 */
export function serializeTail(lines: string[]): string {
  if (!Array.isArray(lines) || lines.length === 0) return '';
  return lines.map(l => (typeof l === 'string' ? l : String(l ?? ''))).join('\n') + '\n';
}

/**
 * The lines back out of a file body. Handles CRLF (a Windows editor may have touched
 * the file), drops the empty element the final newline leaves, and strips a leading
 * BOM (PowerShell 5.1 writes one, and it would otherwise show up as a stray glyph on
 * the first replayed line).
 */
export function parseTail(text: string): string[] {
  if (typeof text !== 'string' || text === '') return [];
  const body = text.replace(/^\uFEFF/, '');
  if (body === '') return [];
  const lines = body.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Dim grey, one reset per line so a line the shell wrote cannot leak its colour on. */
const DIM = '\x1b[2;90m';
const RESET = '\x1b[0m';
const DASH = '─';

/**
 * The exact string the renderer writes into a fresh xterm when a thread wakes: the
 * saved tail in dim grey, then a divider naming when this happened, then a blank line
 * so the shell's own prompt lands under the divider rather than glued to it.
 *
 * The divider is padded to the terminal width so it reads as a rule, but the label is
 * never truncated: a narrow terminal gets a longer-than-cols line rather than
 * "Woke ju…". Minimum three dashes each side keeps it looking deliberate.
 */
export function renderTailForTerminal(
  lines: string[],
  dividerLabel = 'Woke just now',
  cols = 80,
): string {
  const label = typeof dividerLabel === 'string' ? dividerLabel : '';
  const width = Number.isFinite(cols) && cols > 0 ? Math.floor(cols) : 80;
  const MIN_DASHES = 3;

  // Total = left dashes + space + label + space + right dashes.
  const spare = width - (label.length + 2);
  const each = Math.max(MIN_DASHES, Math.floor(spare / 2));
  // Give the odd column to the right side so the divider hits `cols` exactly.
  const right = spare > MIN_DASHES * 2 ? spare - each : each;
  const divider = `${DASH.repeat(each)} ${label} ${DASH.repeat(right)}`;

  const body = (Array.isArray(lines) ? lines : [])
    .map(l => `${DIM}${typeof l === 'string' ? l : String(l ?? '')}${RESET}`);
  body.push(`${DIM}${divider}${RESET}`);
  return body.join('\r\n') + '\r\n\r\n';
}

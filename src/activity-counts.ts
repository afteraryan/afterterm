// Which transcript lines are messages the user sent to Claude (design-07, "The
// streak calendar"). The calendar on Home counts these per local day.
//
// A Claude Code transcript (~/.claude/projects/<dir>/<sessionId>.jsonl) has one JSON
// object per line. A message typed by the user is a `type: "user"` line, but so are
// many lines nobody typed: tool results, subagent (sidechain) turns, meta lines,
// "[Request interrupted by user]" markers, the wrappers Claude Code writes around a
// slash command or its output (<command-name>, <local-command-stdout>, ...), injected
// notices (<task-notification>, <system-reminder>) and compact summaries. Those are
// all left out.
//
// The text of a message is looked at only to recognise a wrapper or an interrupt;
// nothing here keeps, returns or logs it. Pure: no node imports.

export interface CountedTurn {
  /** The line's uuid, for deduplication (a resumed session copies earlier lines). */
  uuid: string;
  /** The local date of the line's timestamp, YYYY-MM-DD. */
  day: string;
}

/** YYYY-MM-DD of a moment, in the local time zone. */
export function localDayString(t: number | Date): string {
  const d = typeof t === 'number' ? new Date(t) : t;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// An opening tag at the very start: "<command-name>", "<local-command-stdout>",
// "<task-notification>", "<system-reminder>", "<bash-input>" and whatever Claude Code
// adds next. A person rarely starts a message with a bare lowercase tag.
const WRAPPER_RE = /^<[a-z][a-z0-9_-]*>/i;
const INTERRUPT_PREFIX = '[Request interrupted';

function isWrapperOrInterrupt(text: string): boolean {
  const t = text.trimStart();
  return WRAPPER_RE.test(t) || t.startsWith(INTERRUPT_PREFIX);
}

/**
 * The counted turn a parsed transcript line is, or null when it is not a message the
 * user sent. Never throws.
 */
export function countableTurn(line: unknown): CountedTurn | null {
  if (!line || typeof line !== 'object') return null;
  const o = line as Record<string, unknown>;
  if (o.type !== 'user') return null;
  if (o.isSidechain === true || o.isMeta === true) return null;
  if (o.isCompactSummary === true || o.isVisibleInTranscriptOnly === true) return null;
  // Newer transcripts say who started the turn; anything but a person (an SDK app,
  // say) is not a message the user typed. Older lines have no turnOrigin and count.
  if (typeof o.turnOrigin === 'string' && o.turnOrigin !== 'human') return null;
  if (typeof o.uuid !== 'string' || !o.uuid) return null;
  if (typeof o.timestamp !== 'string' && typeof o.timestamp !== 'number') return null;
  const t = new Date(o.timestamp as string | number).getTime();
  if (!Number.isFinite(t)) return null;

  const message = o.message as { content?: unknown } | undefined;
  const content = message?.content;
  if (typeof content === 'string') {
    if (!content.trim() || isWrapperOrInterrupt(content)) return null;
  } else if (Array.isArray(content)) {
    if (content.length === 0) return null;
    let firstText: string | null = null;
    for (const part of content) {
      const p = part as { type?: unknown; text?: unknown } | null;
      if (!p || typeof p !== 'object') continue;
      if (p.type === 'tool_result') return null;
      if (firstText === null && p.type === 'text' && typeof p.text === 'string') firstText = p.text;
    }
    if (firstText !== null && isWrapperOrInterrupt(firstText)) return null;
  } else {
    return null;
  }
  return { uuid: o.uuid, day: localDayString(t) };
}

// A cheap test on a line's raw bytes before it is parsed. Most bytes in a transcript
// are tool results and assistant turns, some lines megabytes long, so parsing every
// line would cost the backfill most of its time. Inside a JSON string a quote is
// always escaped, so `"type":"user"` with bare quotes can only be structure, never
// something someone typed. False only for lines countableTurn would refuse anyway.
const enc = new TextEncoder();
const USER_TYPE = enc.encode('"type":"user"');
const TOOL_RESULT = enc.encode('"type":"tool_result"');
const SIDECHAIN = enc.encode('"isSidechain":true');

function indexOfBytes(hay: Uint8Array, needle: Uint8Array): number {
  // Buffer.indexOf is native when available (main); a plain loop otherwise (tests).
  if (typeof (hay as { readUInt8?: unknown }).readUInt8 === 'function') {
    return (hay as unknown as { indexOf(v: Uint8Array): number }).indexOf(needle);
  }
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

export function mightCount(line: Uint8Array): boolean {
  if (indexOfBytes(line, USER_TYPE) < 0) return false;
  if (indexOfBytes(line, SIDECHAIN) >= 0) return false;
  if (indexOfBytes(line, TOOL_RESULT) >= 0) return false;
  return true;
}

/**
 * The compact key a uuid is remembered by: its last 12 hex digits (48 bits). The tail
 * is random in both v4 and v7 uuids (a v7's head is a timestamp). Something that is
 * not a hex uuid falls back to a 48-bit hash of the whole string.
 */
export function uuidKey(uuid: string): string {
  const hex = uuid.replace(/-/g, '').toLowerCase();
  if (/^[0-9a-f]{12,}$/.test(hex)) return hex.slice(-12);
  // FNV-1a over two lanes, 24 bits each.
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < uuid.length; i++) {
    const c = uuid.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
  }
  return ((a >>> 8) & 0xffffff).toString(16).padStart(6, '0') + ((b >>> 8) & 0xffffff).toString(16).padStart(6, '0');
}

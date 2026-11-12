// Reads Claude Code's /usage screen (AFT-85).
//
// Claude Code has no machine-readable way to ask for plan usage, so afterterm starts a
// hidden Claude Code, types /usage and reads the screen (usage-reader.ts). This module is the
// pure half: it turns the rows of that screen into numbers. No Electron, no node-pty, so it is
// unit-tested with plain Node (src/usage-screen.test.ts) against screens captured from a real
// Claude Code 2.1.322 on 2026-11-12.
//
// The screen has two parts that arrive at different times: the limits (about 4 seconds after
// launch) and, a few seconds later, the breakdown ("What's contributing to your usage?"), which
// says "Scanning local sessions…" until it is ready. Both are parsed from whatever is on screen,
// so the caller can show the limits first.

/** How long a reading is kept before opening the card reads again. */
export const USAGE_CACHE_MS = 60_000;

export type UsageLimit = {
  /** Stable key: 'session', 'week', or 'week-<model>' (for example 'week-fable'). */
  id: string;
  /** What the card shows: 'Current session', 'This week', 'This week, Fable'. */
  label: string;
  /** 0 to 100, how much is used. */
  percent: number;
  /** What the card shows: 'Resets at 3:20 AM' or 'Resets Nov 14, 11:30 PM'. */
  reset: string;
};

export type UsageTip = { percent: number; text: string };
export type UsageGroup = {
  title: 'Skills' | 'Subagents' | 'MCP servers';
  items: { name: string; percent: number }[];
};
export type UsageBreakdown = { tips: UsageTip[]; groups: UsageGroup[] };

export type ParsedUsage = {
  limits: UsageLimit[];
  /** Null until the breakdown has finished scanning (or when the screen has none). */
  breakdown: UsageBreakdown | null;
  /** True while the screen still says "Scanning local sessions". */
  scanning: boolean;
};

export type UsageStatus = 'idle' | 'loading' | 'ready' | 'error';
export type UsageError = 'not-installed' | 'unreadable' | 'timeout' | 'exited';

/** What main sends the renderer (the whole state, every time something changes). */
export type UsageState = {
  status: UsageStatus;
  /** The last numbers read (kept while a refresh runs). */
  usage: ParsedUsage | null;
  /** When `usage` was last completed (the breakdown included), or null. */
  updated: number | null;
  /** Set when status is 'error'. `usage` may still hold the last good numbers. */
  error: UsageError | null;
};

const GROUP_TITLES =['Skills', 'Subagents', 'MCP servers'] as const;

/** '3:20am' to '3:20 AM'. Anything else is returned as it came. */
function tidyTime(s: string): string {
  return s.replace(/(\d{1,2}:\d{2})\s*([ap])m\b/gi, (_m, t: string, ap: string) => `${t} ${ap.toUpperCase()}M`);
}

/**
 * 'Resets 3:20am (Asia/Kolkata)' becomes 'Resets at 3:20 AM'; 'Resets Nov 14, 11:30pm (Asia/Kolkata)'
 * becomes 'Resets Nov 14, 11:30 PM'. The time zone is the user's own, so it is dropped.
 */
export function formatReset(raw: string): string {
  const rest = raw.replace(/^Resets\s+/i, '').replace(/\s*\([^)]*\)\s*$/, '').trim();
  const tidy = tidyTime(rest);
  const timeOnly = /^\d{1,2}:\d{2}\s?[AP]M$/.test(tidy);
  return timeOnly ? `Resets at ${tidy}` : `Resets ${tidy}`;
}

function limitFor(title: string): { id: string; label: string } | null {
  if (/^Current session$/i.test(title)) return { id: 'session', label: 'Current session' };
  const week = /^Current week\s*\((.+)\)$/i.exec(title);
  if (!week) return null;
  const who = week[1].trim();
  if (/^all models$/i.test(who)) return { id: 'week', label: 'This week' };
  return { id: 'week-' + who.toLowerCase().replace(/[^a-z0-9]+/g, '-'), label: `This week, ${who}` };
}

/** A tip's text as the card shows it: no folder paths, commas where Claude Code puts a dot. */
function tidyTip(s: string): string {
  return s
    .replace(/[A-Za-z]:\\(?:[^\\\s·]+\\)*([^\\\s·]+)/g, '$1')
    .replace(/\s+·\s+/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseUsageScreen(rows: readonly string[]): ParsedUsage {
  const lines = rows.map((r) => r.replace(/\s+$/, ''));
  const out: ParsedUsage = { limits: [], breakdown: null, scanning: false };

  // limits: a title line, then a bar line ending '<n>% used', then a 'Resets ...' line
  for (let i = 0; i < lines.length; i++) {
    const key = limitFor(lines[i].trim());
    if (!key) continue;
    let percent: number | null = null;
    let reset: string | null = null;
    for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
      const t = lines[j].trim();
      if (!t) continue;
      const p = /(\d{1,3})%\s+used\s*$/.exec(t);
      if (p && percent === null) { percent = Math.min(100, Number(p[1])); continue; }
      if (/^Resets\s/i.test(t)) { reset = formatReset(t); break; }
    }
    if (percent !== null && reset !== null && !out.limits.some((l) => l.id === key.id)) {
      out.limits.push({ ...key, percent, reset });
    }
  }

  // breakdown
  const head = lines.findIndex((l) => /^What's contributing to your usage\?/i.test(l.trim()));
  if (head < 0) return out;
  const body = lines.slice(head + 1);
  if (body.some((l) => /Scanning local sessions/i.test(l))) { out.scanning = true; return out; }

  const tips: UsageTip[] = [];
  const groups: UsageGroup[] = [];
  let current: UsageGroup | null = null;
  let lastTip: UsageTip | null = null;
  let started = false;
  for (const raw of body) {
    const t = raw.trim();
    if (/^d to day\b/i.test(t) || /^Usage credits\b/i.test(t)) break;
    const group = GROUP_TITLES.find((g) => new RegExp(`^${g}\\s+% of usage$`, 'i').test(t));
    if (group) { current = { title: group, items: [] }; groups.push(current); lastTip = null; started = true; continue; }
    if (!t) { lastTip = null; continue; }
    if (current) {
      const row = /^(.+?)\s+(\d{1,3})%$/.exec(t);
      if (row) current.items.push({ name: row[1].trim(), percent: Number(row[2]) });
      continue;
    }
    const tip = /^(\d{1,3})%\s+(.+)$/.exec(t);
    if (tip) { lastTip = { percent: Number(tip[1]), text: tidyTip(tip[2]) }; tips.push(lastTip); started = true; continue; }
    // a tip that wrapped onto a second row: indented text with no percent
    if (lastTip && /^\s/.test(raw) && !/^Last\s/i.test(t)) { lastTip.text = tidyTip(lastTip.text + ' ' + t); }
  }
  if (started) out.breakdown = { tips, groups };
  return out;
}

export type ReaderStage = 'start' | 'typed' | 'running';

/**
 * What the hidden Claude Code needs next, decided from its screen alone (so it can be tested):
 *  - 'start': answer the one-time "do you trust this folder" question (the default is "No, exit", so
 *    move to "Yes" first and press Enter only once the screen shows Yes selected), then, at the normal
 *    prompt, type /usage;
 *  - 'typed': press Enter once the slash menu lists /usage;
 *  - 'running': nothing more to type.
 * `send` is the keys to type now (or null), `stage` the stage after.
 * The selection pointer is drawn as ❯ or as > depending on the terminal Claude Code thinks it is in.
 */
export function readerStep(stage: ReaderStage, screen: string): { send: string | null; stage: ReaderStage } {
  if (stage === 'start') {
    if (/Yes, I trust this folder/.test(screen) && /No, exit/.test(screen)) {
      return /[❯>]\s*Yes, I trust this folder/.test(screen) ? { send: '\r', stage } : { send: '\x1b[B', stage };
    }
    if (/Try "/.test(screen) && !/No, exit/.test(screen)) return { send: '/usage', stage: 'typed' };
    return { send: null, stage };
  }
  if (stage === 'typed') {
    return /\/usage\s{2,}\S/.test(screen) ? { send: '\r', stage: 'running' } : { send: null, stage };
  }
  return { send: null, stage };
}

/** True while a reading taken at `updated` is still good enough to show without reading again. */
export function usageIsFresh(updated: number | null, now: number): boolean {
  return updated !== null && now - updated >= 0 && now - updated < USAGE_CACHE_MS;
}

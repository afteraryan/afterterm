// The streak calendar's arithmetic (design-07, "The streak calendar"): the shade of a
// day, the current and longest streak, and the weeks the card shows. Pure: days are
// local dates as YYYY-MM-DD strings, and the date arithmetic runs in UTC on those
// strings so a daylight saving change can never skip or repeat a day.

const DAY_MS = 86_400_000;

function toUtc(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(t: number): string {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** The day `n` days after `day` (negative goes back). */
export function addDays(day: string, n: number): string {
  return fromUtc(toUtc(day) + n * DAY_MS);
}

/** 0 Sunday to 6 Saturday. */
export function weekday(day: string): number {
  return new Date(toUtc(day)).getUTCDay();
}

/**
 * The shade of a day with `n` messages: 0 none, 1 for 1 to 4, 2 for 5 to 14, 3 for
 * 15 to 39, 4 for 40 or more. Lenient at the start, so a new user sees green quickly.
 */
export function shade(n: number): 0 | 1 | 2 | 3 | 4 {
  if (!(n > 0)) return 0;
  if (n < 5) return 1;
  if (n < 15) return 2;
  if (n < 40) return 3;
  return 4;
}

export interface Streaks {
  /** Days in a row with a message, up to today (or up to yesterday, see below). */
  current: number;
  /** The longest run of days in a row with a message, ever (the current one included). */
  longest: number;
  /** The first day of the current streak, or null when it is 0. */
  currentStart: string | null;
}

/**
 * The current and longest streak.
 *
 * The rule for today: a streak is still alive until today is over. When today has
 * no message yet, the current streak is the run that ended yesterday, so it does not
 * read 0 every morning before the first message; it drops to 0 only once a whole day
 * has passed with none. When today has messages, today is part of it.
 */
export function streaks(days: Record<string, number>, today: string): Streaks {
  const active = (d: string) => (days[d] ?? 0) > 0;

  let current = 0;
  let currentStart: string | null = null;
  let cursor = active(today) ? today : addDays(today, -1);
  while (active(cursor)) {
    current++;
    currentStart = cursor;
    cursor = addDays(cursor, -1);
  }

  // Longest: walk the active days in order, counting runs of consecutive dates.
  // Days after today (a clock that moved back) are ignored.
  const sorted = Object.keys(days).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && active(d) && d <= today).sort();
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of sorted) {
    run = prev !== null && addDays(prev, 1) === d ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = d;
  }
  return { current, longest: Math.max(longest, current), currentStart };
}

export interface CalendarDay {
  day: string;
  /** After today: drawn as an empty, unlit square. */
  future: boolean;
}

/**
 * The weeks the card shows: `weeks` columns, each Sunday to Saturday, oldest first.
 * The last column is the current week, moved `offsetWeeks` back in time (the arrows
 * move four weeks at a time; 0 is the newest view, never negative).
 */
export function calendarWeeks(today: string, weeks = 22, offsetWeeks = 0): CalendarDay[][] {
  const offset = Math.max(0, Math.floor(offsetWeeks));
  const lastSunday = addDays(today, -weekday(today) - 7 * offset);
  const firstSunday = addDays(lastSunday, -7 * (weeks - 1));
  const out: CalendarDay[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col: CalendarDay[] = [];
    for (let i = 0; i < 7; i++) {
      const day = addDays(firstSunday, w * 7 + i);
      col.push({ day, future: day > today });
    }
    out.push(col);
  }
  return out;
}

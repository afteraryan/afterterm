// Claude Code's own record of a running session, read for each thread.
//
// Claude Code (2.1.319 when this was written) keeps one small file per running
// claude.exe at `<Claude folder>\sessions\<pid>.json`, holding the process's pid, the
// session id (it follows /clear), the folder Claude is in, a live status (busy, idle,
// waiting on a question or a permission prompt, shell when idle with a background
// task), a kind and the process's start time. The file goes on /exit; after a hard
// kill it stayed for under a minute. It is undocumented and may change (Aryan decided
// on 2026-11-07 to rely on it anyway, with the hooks as the fallback), so everything
// here degrades to "no record" rather than guessing. docs/plan-02-restart-window-and-hook-fixes.md,
// Fix 5, has the facts table this follows; the start time formats and the lists of
// statuses and kinds are from the 2.1.319 binary's own code.
//
// Why afterterm reads it: the hooks give a session id and a state only when they run,
// and a chat with no hooks (or a stalled turn, or the gap at a prompt) gave the restart
// window nothing to go on. The record is there whether hooks run or not.
//
// SECURITY: the records sit in the user's Claude folder, which other programs can
// write. Every value is validated before use, because the session id is later typed
// into a shell as `claude --resume <id>` and the folder becomes the shell's cwd: the id
// must be a canonical UUID and the folder an absolute path with no shell
// metacharacters. Beside each record Claude Code keeps `<pid>.<hash>.key` files that
// hold a token: only names that are a record's (isRecordFileName) are ever opened.
//
// This module is pure: no Electron and no node imports. The process list comes from
// the server watcher's cache (server-detect.ts), and the transcript and running checks
// are functions the caller passes in, so all of it runs under plain Node for the tests.

import { descendantPids } from './server-detect.ts';
import type { Proc } from './server-detect.ts';
import { isSessionId } from './claude-transcript.ts';

/** What Claude Code says it is doing. Anything else in the file reads as null. */
export type RecordStatus = 'busy' | 'idle' | 'waiting' | 'shell';
const STATUSES: readonly string[] = ['busy', 'idle', 'waiting', 'shell'];

/** One validated record. A field that failed its check is null, never a guess. */
export interface SessionRecord {
  /** The claude.exe process: the file's own number. */
  pid: number;
  /** A canonical UUID, or null when the file had none or it was not one. */
  sessionId: string | null;
  /** Claude's current folder, absolute and clean (CLAUDE_CWD_RE), or null. */
  cwd: string | null;
  /** busy, idle, waiting or shell; null for anything else (empty at startup). */
  status: RecordStatus | null;
  /** `interactive` for a normal session; the binary also writes bg, daemon and daemon-worker. */
  kind: string | null;
  /** The process start time token, as Claude Code wrote it: a string of digits, or null. */
  procStart: string | null;
}

/** What the reader in main sends for one thread on a tick. */
export interface RecordFeed {
  /** The claude.exe the thread was matched to, for logs; null when none. */
  pid: number | null;
  /**
   * Set only from an interactive record whose session has a transcript, so `claude
   * --resume` on it works and a background session never makes a thread a chat.
   */
  sessionId: string | null;
  /** The record's folder, sent with the id. */
  cwd: string | null;
  /** The live status, or null when the thread has no live Claude. */
  status: RecordStatus | null;
}

// An absolute Windows path with no character a shell would act on. The same rule the
// notify hook's file channel is held to in main.ts, which imports it from here.
export const CLAUDE_CWD_RE = /^[A-Za-z]:\\[^\r\n;&|`$<>"'*?\t]*$/;

// Claude Code's own reader caps a record at 256 KiB, so a bigger file is not one.
export const RECORD_MAX_BYTES = 256 * 1024;

// Windows pids are 32-bit; a bigger number in a file name is not a process.
const MAX_PID = 2_147_483_647;

/**
 * How far the record's start time may be from the process list's creation time and
 * still name the same process. Both are the kernel's creation time for the process:
 * the record's in 100 ns units (a FILETIME, or .NET ticks of CIM's CreationDate, which
 * is exact to the microsecond), the process list's truncated to the millisecond, so
 * they agree to within a millisecond. A reused pid belongs to a process started after
 * the old claude.exe ended, and a Claude session lives far longer than a second, so its
 * start time is seconds to hours away. One second absorbs the rounding with a wide
 * margin and still refuses every realistic reuse.
 */
export const PROC_START_TOLERANCE_MS = 1_000;

/**
 * How many reads in a row a record file may fail (caught mid-write) while its last
 * good record stands in for it. See holdLastGood.
 */
export const RECORD_READ_GRACE = 2;

/**
 * The pid a record's file name stands for, or null when the name is not a record's:
 * digits then `.json`, canonical ("0123.json" is not process 123, as Claude Code's own
 * reader also requires), and a multiple of 4. Windows gives every process an id that
 * is a multiple of 4, and asking Windows about any other number answers for the
 * multiple of 4 below it, so a stray file named for one would look like a live process.
 */
function recordPid(name: string): number | null {
  if (typeof name !== 'string') return null;
  const m = /^(\d+)\.json$/.exec(name);
  if (!m) return null;
  const pid = Number(m[1]);
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid > MAX_PID || String(pid) !== m[1]) return null;
  if (pid % 4 !== 0) return null;
  return pid;
}

/**
 * True for a record file's name and nothing else (see recordPid). The `<pid>.<hash>.key`
 * files beside the records hold a token and must never be opened.
 */
export function isRecordFileName(name: string): boolean {
  return recordPid(name) !== null;
}

function asProcStart(value: unknown): string | null {
  if (typeof value === 'string') return /^\d{1,20}$/.test(value) ? value : null;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return BigInt(value).toString();
  return null;
}

/**
 * Parse one record file. Null when the text is not a JSON object, is too big, the
 * file name is not a record's, or the `pid` inside names another process. Each field
 * is then checked on its own and is null when it fails, so a record with a bad folder
 * still reports its status but can never hand over its session id.
 */
export function parseSessionRecord(text: string, fileName: string): SessionRecord | null {
  if (typeof text !== 'string' || text.length > RECORD_MAX_BYTES) return null;
  const pid = recordPid(fileName);
  if (pid === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const r = parsed as Record<string, unknown>;

  // The file name is what Claude Code itself trusts; a pid inside that disagrees
  // means the file is not what it claims to be.
  if (r.pid !== undefined && r.pid !== pid) return null;

  const sessionId = isSessionId(r.sessionId) ? r.sessionId : null;
  const cwd = typeof r.cwd === 'string' && CLAUDE_CWD_RE.test(r.cwd) ? r.cwd : null;
  const status = typeof r.status === 'string' && STATUSES.includes(r.status) ? (r.status as RecordStatus) : null;
  const kind = typeof r.kind === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(r.kind) ? r.kind : null;
  // Claude Code writes one of two: procStartFt, a FILETIME from its native call, or,
  // when that is not available, procStart, the .NET ticks of PowerShell's
  // (Get-CimInstance Win32_Process).CreationDate. Should a record carry both, the
  // FILETIME is taken: it is UTC, so it has one reading.
  const procStart = asProcStart(r.procStartFt) ?? asProcStart(r.procStart);

  return { pid, sessionId, cwd, status, kind, procStart };
}

/** A record file's read on one tick: its name, and the record, or null when the read or the parse failed. */
export interface RecordRead {
  name: string;
  record: SessionRecord | null;
}

/** The last good record read from a file, and how many reads of it have failed since. */
export interface HeldRecord {
  record: SessionRecord;
  misses: number;
}

/**
 * The records to use this tick. A file caught mid-write fails to parse, and reading
 * that as "no record" would blip the thread's status to null for a tick, which the
 * restart window would read as "not mid-turn". So while a file is still listed and its
 * read fails, its last good record stands in, for up to `grace` failed reads in a row.
 * A file no longer listed is gone at once, and a dead pid is caught later by
 * pidLooksAlive and the running check. Returns the records and the map for next tick.
 */
export function holdLastGood(
  reads: RecordRead[],
  held: Map<string, HeldRecord>,
  grace: number = RECORD_READ_GRACE,
): { records: SessionRecord[]; held: Map<string, HeldRecord> } {
  const next = new Map<string, HeldRecord>();
  const records: SessionRecord[] = [];
  for (const { name, record } of reads ?? []) {
    if (record) {
      next.set(name, { record, misses: 0 });
      records.push(record);
      continue;
    }
    const last = held?.get(name);
    if (last && last.misses < grace) {
      next.set(name, { record: last.record, misses: last.misses + 1 });
      records.push(last.record);
    }
  }
  return { records, held: next };
}

// 100 ns intervals from each format's epoch to 1970-01-01.
const DOTNET_TICKS_AT_UNIX_EPOCH = 621_355_968_000_000_000n;
const FILETIME_AT_UNIX_EPOCH = 116_444_736_000_000_000n;
// Claude Code tells its two formats apart at this value: .NET ticks of any date after
// the year 951 are above it, FILETIMEs of any date before 2552 are below.
const TICKS_THRESHOLD = 300_000_000_000_000_000n;

/** Minutes to add to a local wall-clock time to get UTC at the given instant, as Date.getTimezoneOffset gives. */
export type TzOffset = (utcMs: number) => number;
const localTzOffset: TzOffset = utcMs => new Date(utcMs).getTimezoneOffset();

const HOUR_MS = 3_600_000;

function addOffset(wall: number, offsetMinutes: number): number {
  return Number.isFinite(offsetMinutes) ? wall + offsetMinutes * 60_000 : wall;
}

/**
 * The start time a token can mean, in ms since 1970 UTC. Empty when the token is
 * missing or in a shape this does not know, which the caller treats as no opinion.
 *
 * A FILETIME is UTC and has one reading. .NET ticks come from CIM's CreationDate,
 * which is local time, so they are a wall clock and need the offset in force at that
 * instant, which a wall clock alone does not always settle:
 *   - The offset is first taken at the wall-clock value read as UTC, then looked up
 *     again at the instant that gives. The two differ for a Claude started within one
 *     offset of a daylight saving change, and the second is right.
 *   - In the hour an autumn change repeats, one wall-clock time is two instants, and
 *     both lookups can land on the summer offset while the Claude started in the
 *     second pass. So the offsets in force an hour before and an hour after the first
 *     instant are offered as readings too.
 * The plain UTC reading is offered last. A reused pid could pass only by starting one
 * of those exact offsets, to the second, from the old process.
 */
export function procStartReadings(token: string | null, tzOffset: TzOffset = localTzOffset): number[] {
  if (typeof token !== 'string' || !/^\d{1,20}$/.test(token)) return [];
  const n = BigInt(token);
  if (n > TICKS_THRESHOLD) {
    const wall = Number((n - DOTNET_TICKS_AT_UNIX_EPOCH) / 10_000n);
    const first = addOffset(wall, tzOffset(wall));
    const second = addOffset(wall, tzOffset(first));
    const before = addOffset(wall, tzOffset(first - HOUR_MS));
    const after = addOffset(wall, tzOffset(first + HOUR_MS));
    return [...new Set([second, first, before, after, wall])];
  }
  if (n >= FILETIME_AT_UNIX_EPOCH) return [Number((n - FILETIME_AT_UNIX_EPOCH) / 10_000n)];
  return [];
}

/**
 * True when the record's pid is in the process list and, when both sides know a start
 * time, the two agree within PROC_START_TOLERANCE_MS. A record left behind by a hard
 * kill names a pid that is gone, or one Windows has given to another process; either
 * way it is not this session any more. Whether the pid is still running now is the
 * caller's separate check, since the list can be a minute old.
 */
export function pidLooksAlive(record: SessionRecord, procs: Proc[], tzOffset?: TzOffset): boolean {
  if (!record || !Array.isArray(procs)) return false;
  const proc = procs.find(p => p.pid === record.pid);
  if (!proc) return false;
  if (proc.created === null) return true;
  const readings = procStartReadings(record.procStart, tzOffset);
  if (readings.length === 0) return true;
  const created = proc.created;
  return readings.some(ms => Math.abs(ms - created) <= PROC_START_TOLERANCE_MS);
}

/** How many parent links from `pid` up to `rootPid`, inside `tree`; Infinity when the chain breaks. */
function depthBelow(parentOf: Map<number, number>, tree: Set<number>, pid: number, rootPid: number): number {
  let depth = 0;
  let current = pid;
  while (current !== rootPid) {
    const parent = parentOf.get(current);
    if (parent === undefined || !tree.has(parent) || depth > tree.size) return Infinity;
    current = parent;
    depth++;
  }
  return depth;
}

/**
 * Each thread's Claude: of the records whose pid is in the thread's process tree, an
 * `interactive` one first, then the one nearest the shell by parent links (a Claude
 * can start other Claudes, and the outer one is the chat), then the lowest pid so the
 * choice is stable. `accept`, when given, is asked in that order and only about these
 * candidates, and the first it accepts is taken; that is how the caller's running
 * check reaches only afterterm's own threads. Threads with no record are absent. The
 * procs are the list with the MSYS parents applied, so a Git Bash tree is whole.
 */
export function matchRecordsToThreads(
  records: SessionRecord[],
  shellPids: Map<string, number>,
  procs: Proc[],
  accept?: (record: SessionRecord) => boolean,
): Map<string, SessionRecord> {
  const out = new Map<string, SessionRecord>();
  if (!Array.isArray(records) || records.length === 0) return out;
  const parentOf = new Map<number, number>();
  for (const p of procs ?? []) if (!parentOf.has(p.pid)) parentOf.set(p.pid, p.ppid);

  for (const [tabId, shellPid] of shellPids) {
    const tree = descendantPids(procs, shellPid);
    const ranked = records
      .filter(r => tree.has(r.pid))
      .map(r => ({ r, kind: r.kind === 'interactive' ? 0 : 1, depth: depthBelow(parentOf, tree, r.pid, shellPid) }))
      .sort((a, b) => a.kind - b.kind || a.depth - b.depth || a.r.pid - b.r.pid);
    for (const { r } of ranked) {
      if (accept && !accept(r)) continue;
      out.set(tabId, r);
      break;
    }
  }
  return out;
}

/**
 * What to send for one thread. No record: status null, and no id (the caller keeps
 * the last one it had, Decision 3). A record: its status always. Its session id only
 * when the record is interactive, the id and folder are valid and the transcript
 * exists: a record is written before the first prompt, a spare session never writes
 * a transcript, and `claude --resume` on such an id fails; and a bg or daemon session
 * found in the tree must never make a thread a chat for good. A transcript check that
 * throws counts as no transcript.
 */
export function recordFeed(
  record: SessionRecord | null | undefined,
  transcriptExists: (sessionId: string, cwd: string) => boolean,
): RecordFeed {
  if (!record) return { pid: null, sessionId: null, cwd: null, status: null };
  let adopt = false;
  if (record.kind === 'interactive' && record.sessionId && record.cwd) {
    try { adopt = transcriptExists(record.sessionId, record.cwd) === true; } catch { adopt = false; }
  }
  return { pid: record.pid, sessionId: adopt ? record.sessionId : null, cwd: record.cwd, status: record.status };
}

/**
 * The feeds for a tick: records whose start time agrees with the list are matched to
 * threads, the running check confirms only the candidates in afterterm's own trees,
 * and every thread with a live shell gets its feed (the empty one when it has no
 * Claude).
 */
export function threadFeeds(input: {
  records: SessionRecord[];
  shellPids: Map<string, number>;
  procs: Proc[];
  transcriptExists: (sessionId: string, cwd: string) => boolean;
  isRunning?: (pid: number) => boolean;
  tzOffset?: TzOffset;
}): Map<string, RecordFeed> {
  const { records, shellPids, procs, transcriptExists, isRunning, tzOffset } = input;
  const listed = (records ?? []).filter(r => pidLooksAlive(r, procs, tzOffset));
  const matches = matchRecordsToThreads(listed, shellPids, procs, isRunning ? r => isRunning(r.pid) : undefined);
  const out = new Map<string, RecordFeed>();
  for (const tabId of shellPids.keys()) out.set(tabId, recordFeed(matches.get(tabId), transcriptExists));
  return out;
}

/**
 * Pids of records that are running but not in the process list: a claude.exe started
 * after the list was taken.
 */
export function unlistedRunningPids(
  records: SessionRecord[],
  procs: Proc[],
  isRunning: (pid: number) => boolean,
): number[] {
  const listed = new Set<number>();
  for (const p of procs ?? []) listed.add(p.pid);
  return (records ?? []).filter(r => !listed.has(r.pid) && isRunning(r.pid)).map(r => r.pid);
}

/**
 * Pids for which the process list looks out of date, so a fresh list is worth asking
 * for: a running process the list has not seen (unlistedRunningPids), and a running
 * pid the list knows as a process whose start time disagrees with the record (that
 * process has ended and a new Claude got the same pid). The old process may have sat
 * anywhere, in a thread's tree (an /exit and a new `claude` in the same shell) or
 * outside every tree (a new Claude in a thread took the pid some other program had),
 * so where the list puts the pid is no guide. isRunning is asked about those pids
 * alone, which are few, and listRefreshPlan asks about each one once.
 */
export function staleListPids(
  records: SessionRecord[],
  procs: Proc[],
  isRunning: (pid: number) => boolean,
  tzOffset?: TzOffset,
): number[] {
  const out = new Set<number>(unlistedRunningPids(records, procs, isRunning));
  const listed = new Set<number>();
  for (const p of procs ?? []) listed.add(p.pid);
  for (const r of records ?? []) {
    if (!listed.has(r.pid) || pidLooksAlive(r, procs, tzOffset)) continue;
    if (isRunning(r.pid)) out.add(r.pid);
  }
  return [...out].sort((a, b) => a - b);
}

/** A pid a fresh process list was asked for: when, and whether asking has stopped. */
export interface ListAsk {
  at: number;
  gaveUp: boolean;
}

// A pid asked about this long ago with no list read since (the read keeps failing) is
// not asked about again.
export const LIST_ASK_GIVE_UP_MS = 60_000;

/**
 * Which stale pids to ask a fresh process list for now, remembering each one asked.
 * A pid is asked about once. When the list has been read since it was asked
 * (`listReadAt`, the start of the last read) and the pid is still stale, a fresh list
 * does not help it (a stray file, or a record a dead Claude left on a pid Windows gave
 * to another process), so asking stops; the server watcher's own read, at most a
 * minute apart, still catches a real change. A pid that is no longer stale is
 * forgotten, so it can be asked about again later. `waiting` is true while a pid asked
 * about has not had its read yet, so a caller that must have the fresh list can wait
 * for the next read. `canAsk` false (the rate limit) asks nothing new.
 */
export function listRefreshPlan(
  stale: number[],
  asked: Map<number, ListAsk>,
  listReadAt: number,
  now: number,
  canAsk: boolean,
): { ask: number[]; waiting: boolean; asked: Map<number, ListAsk> } {
  const next = new Map<number, ListAsk>();
  const ask: number[] = [];
  let waiting = false;
  for (const pid of stale ?? []) {
    const prev = asked?.get(pid);
    if (prev) {
      if (prev.gaveUp || listReadAt > prev.at || now - prev.at > LIST_ASK_GIVE_UP_MS) {
        next.set(pid, { at: prev.at, gaveUp: true });
      } else {
        next.set(pid, prev);
        waiting = true;
      }
      continue;
    }
    if (canAsk) {
      next.set(pid, { at: now, gaveUp: false });
      ask.push(pid);
    }
  }
  return { ask, waiting, asked: next };
}

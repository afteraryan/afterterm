// Claude Code's own record of a running session, read for each thread.
//
// Claude Code (2.1.319 when this was written) keeps one small file per running
// claude.exe at `<Claude folder>\sessions\<pid>.json`, holding the process's pid, the
// session id (it follows /clear), the folder Claude is in, a live status (busy, idle,
// waiting on a question or a permission prompt, shell when idle with a background
// task) and the process's start time. The file goes on /exit; after a hard kill it
// stayed for under a minute. It is undocumented and may change (Aryan decided on
// 2026-11-07 to rely on it anyway, with the hooks as the fallback), so everything here
// degrades to "no record" rather than guessing. docs/plan-02-restart-window-and-hook-fixes.md,
// Fix 5, has the facts table this follows.
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
// hold a token: only names matching `^\d+\.json$` are ever opened.
//
// This module is pure: no Electron and no node imports. The process list comes from
// the server watcher's cache (server-detect.ts) and the transcript check is a
// function the caller passes in, so all of it runs under plain Node for the tests.

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
  /** `interactive` for a normal session; other kinds seen in the binary are bg, daemon, daemon-worker. */
  kind: string | null;
  /** The process start time token, as Claude Code wrote it: a string of digits, or null. */
  procStart: string | null;
}

/** What the reader in main sends for one thread on a tick. */
export interface RecordFeed {
  /** The claude.exe the thread was matched to, for logs; null when none. */
  pid: number | null;
  /** Set only when the record's session has a transcript, so `claude --resume` on it works. */
  sessionId: string | null;
  /** The record's folder, sent with the id. */
  cwd: string | null;
  /** The live status, or null when the thread has no live Claude. */
  status: RecordStatus | null;
}

// An absolute Windows path with no character a shell would act on. The same rule the
// notify hook's file channel is held to in main.ts, which imports it from here.
export const CLAUDE_CWD_RE = /^[A-Za-z]:\\[^\r\n;&|`$<>"'*?\t]*$/;

// Claude Code's own reader caps a record at 256 KiB (seen in its binary), so a bigger
// file is not one.
export const RECORD_MAX_BYTES = 256 * 1024;

// Windows pids are 32-bit; a bigger number in a file name is not a process.
const MAX_PID = 2_147_483_647;

/**
 * How far the record's start time may be from the process list's creation time and
 * still name the same process. Both are the same kernel timestamp read two ways
 * (Claude Code's own read, at 100 ns, and the CIM process list's, truncated to the
 * millisecond), so they agree to within a millisecond. A reused pid belongs to a
 * process started after the old claude.exe ended, and a Claude session lives far
 * longer than a second, so its start time is seconds to hours away. One second
 * absorbs the rounding with a wide margin and still refuses every realistic reuse.
 */
export const PROC_START_TOLERANCE_MS = 1_000;

/**
 * True for a record file's name and nothing else: digits, then `.json`. The
 * `<pid>.<hash>.key` files beside the records hold a token and must never be opened.
 */
export function isRecordFileName(name: string): boolean {
  return typeof name === 'string' && /^\d+\.json$/.test(name);
}

function asProcStart(value: unknown): string | null {
  if (typeof value === 'string') return /^\d{1,20}$/.test(value) ? value : null;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return BigInt(value).toString();
  return null;
}

/**
 * Parse one record file. Null when the text is not a JSON object, is too big, the
 * file name is not a canonical pid, or the `pid` inside names another process. Each
 * field is then checked on its own and is null when it fails, so a record with a
 * bad folder still reports its status but can never hand over its session id.
 */
export function parseSessionRecord(text: string, fileName: string): SessionRecord | null {
  if (typeof text !== 'string' || text.length > RECORD_MAX_BYTES) return null;
  if (!isRecordFileName(fileName)) return null;
  const digits = fileName.slice(0, -'.json'.length);
  const pid = Number(digits);
  // Canonical only ("0123.json" is not process 123), as Claude Code's own reader requires.
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid > MAX_PID || String(pid) !== digits) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^﻿/, ''));
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
  // Claude Code writes procStartFt (a Windows FILETIME) when it can read the start time
  // natively and procStart (.NET ticks from PowerShell) when it cannot, and reads them
  // in that order itself. Seen in strings of the 2.1.x binary, not in a live record.
  const procStart = asProcStart(r.procStartFt) ?? asProcStart(r.procStart);

  return { pid, sessionId, cwd, status, kind, procStart };
}

// 100 ns intervals from each format's epoch to 1970-01-01.
const DOTNET_TICKS_AT_UNIX_EPOCH = 621_355_968_000_000_000n;
const FILETIME_AT_UNIX_EPOCH = 116_444_736_000_000_000n;
// Claude Code tells its two formats apart at this value: .NET ticks of any date after
// the year 951 are above it, FILETIMEs of any date before 2552 are below.
const TICKS_THRESHOLD = 300_000_000_000_000_000n;

/** Minutes to add to a local wall-clock time to get UTC, as Date.getTimezoneOffset gives. */
export type TzOffset = (wallMs: number) => number;
const localTzOffset: TzOffset = wallMs => new Date(wallMs).getTimezoneOffset();

/**
 * The start time a token can mean, in ms since 1970 UTC. Empty when the token is
 * missing or in a shape this does not know, which the caller treats as no opinion.
 *
 * A FILETIME is UTC and has one reading. .NET ticks come from PowerShell's
 * `CreationDate.Ticks`, and CIM gives CreationDate as local time, so the ticks are a
 * local wall clock; that is believed, not verified, so the UTC reading is offered as
 * well. Accepting both cannot let a reused pid through unless its process started a
 * whole time zone offset, to the second, from the old one.
 */
export function procStartReadings(token: string | null, tzOffset: TzOffset = localTzOffset): number[] {
  if (typeof token !== 'string' || !/^\d{1,20}$/.test(token)) return [];
  const n = BigInt(token);
  if (n > TICKS_THRESHOLD) {
    const wall = Number((n - DOTNET_TICKS_AT_UNIX_EPOCH) / 10_000n);
    const offset = tzOffset(wall);
    const local = Number.isFinite(offset) ? wall + offset * 60_000 : wall;
    return local === wall ? [wall] : [local, wall];
  }
  if (n >= FILETIME_AT_UNIX_EPOCH) return [Number((n - FILETIME_AT_UNIX_EPOCH) / 10_000n)];
  return [];
}

/**
 * True when the record's pid is a running process in the list and, when both sides
 * know a start time, the two agree within PROC_START_TOLERANCE_MS. A record left
 * behind by a hard kill names a pid that is gone, or one Windows has given to
 * another process; either way it is not this session any more.
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
 * Each thread's Claude: of the records whose pid is in the thread's process tree,
 * an `interactive` one first, then the one nearest the shell by parent links (a
 * Claude can start other Claudes, and the outer one is the chat), then the lowest
 * pid so the choice is stable. Threads with no record in their tree are absent.
 * Records should already have passed pidLooksAlive; the procs are the list with the
 * MSYS parents applied, so a Git Bash tree is whole.
 */
export function matchRecordsToThreads(
  records: SessionRecord[],
  shellPids: Map<string, number>,
  procs: Proc[],
): Map<string, SessionRecord> {
  const out = new Map<string, SessionRecord>();
  if (!Array.isArray(records) || records.length === 0) return out;
  const parentOf = new Map<number, number>();
  for (const p of procs ?? []) if (!parentOf.has(p.pid)) parentOf.set(p.pid, p.ppid);

  for (const [tabId, shellPid] of shellPids) {
    const tree = descendantPids(procs, shellPid);
    let best: SessionRecord | null = null;
    let bestKey: [number, number, number] | null = null;
    for (const record of records) {
      if (!tree.has(record.pid)) continue;
      const key: [number, number, number] = [
        record.kind === 'interactive' ? 0 : 1,
        depthBelow(parentOf, tree, record.pid, shellPid),
        record.pid,
      ];
      if (!bestKey || key[0] < bestKey[0]
        || (key[0] === bestKey[0] && (key[1] < bestKey[1] || (key[1] === bestKey[1] && key[2] < bestKey[2])))) {
        best = record;
        bestKey = key;
      }
    }
    if (best) out.set(tabId, best);
  }
  return out;
}

/**
 * What to send for one thread. No record: status null, and no id (the caller keeps
 * the last one it had, Decision 3). A record: its status always; its session id only
 * when the id and folder are valid and the transcript exists, because a record is
 * written before the first prompt, and a spare session never writes a transcript at
 * all, and `claude --resume` on such an id fails. A transcript check that throws
 * counts as no transcript.
 */
export function recordFeed(
  record: SessionRecord | null | undefined,
  transcriptExists: (sessionId: string, cwd: string) => boolean,
): RecordFeed {
  if (!record) return { pid: null, sessionId: null, cwd: null, status: null };
  let adopt = false;
  if (record.sessionId && record.cwd) {
    try { adopt = transcriptExists(record.sessionId, record.cwd) === true; } catch { adopt = false; }
  }
  return { pid: record.pid, sessionId: adopt ? record.sessionId : null, cwd: record.cwd, status: record.status };
}

/**
 * The whole decision for a tick: drop records whose process is gone or reused, match
 * the rest to threads, and give every thread with a live shell its feed (threads with
 * no Claude get the empty feed). `isRunning` is an optional extra check of the pid
 * against the live system, for a process list that may be a minute old.
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
  // The list check first: it is in memory, the running check asks the system.
  const live = (records ?? []).filter(r =>
    pidLooksAlive(r, procs, tzOffset) && (!isRunning || isRunning(r.pid)));
  const matches = matchRecordsToThreads(live, shellPids, procs);
  const out = new Map<string, RecordFeed>();
  for (const tabId of shellPids.keys()) out.set(tabId, recordFeed(matches.get(tabId), transcriptExists));
  return out;
}

/**
 * Pids of records that are running but not in the process list: a claude.exe started
 * after the list was taken. The caller refreshes the list when this is not empty.
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

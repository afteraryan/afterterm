// Incremental reading of a session's transcript for the Files button.
//
// A chat's JSONL only ever grows, and a long one is tens of megabytes, so the store
// remembers, per session, how far it has read (a byte offset per file: the session
// file and each subagent file) and feeds only the new complete lines to
// session-files.ts. The first read of a big file is done in chunks with a yield
// between them, so the main process keeps serving PTY output while it reads.
//
// The file system is a parameter (the real one in main.ts, a temp folder in the
// tests); nothing here writes anywhere.

import {
  newParseState, ingestLine, sessionFilesView,
  type SessionParseState, type SessionFiles, type ChangedFile, type PastedImage,
} from './session-files.ts';

export interface StoreFs {
  /** Size of a file, or null when it does not exist. */
  size(path: string): Promise<number | null>;
  /** Up to `length` bytes from `position`. */
  read(path: string, position: number, length: number): Promise<Uint8Array>;
  /** Names in a folder, or [] when it does not exist. */
  list(path: string): Promise<string[]>;
}

export interface StoreDeps {
  fs: StoreFs;
  /** Where the session's transcript is, or null (findTranscript in claude-transcript.ts). */
  locate(sessionId: string, cwd: string): string | null;
  /** Called between chunks so a long first read never blocks the process. */
  yieldNow?: () => Promise<void>;
  /** Bytes per read. */
  chunkBytes?: number;
}

interface FileCursor {
  offset: number;
  carry: Uint8Array | null;
}

interface Entry {
  file: string;
  state: SessionParseState;
  cursors: Map<string, FileCursor>;
  busy: Promise<void>;
}

const NEWLINE = 0x0a;
const DEFAULT_CHUNK = 4 * 1024 * 1024;
/** Sessions kept parsed at once; the least recently read is dropped first. */
export const MAX_CACHED_SESSIONS = 40;

function concat(a: Uint8Array | null, b: Uint8Array): Uint8Array {
  if (!a || a.length === 0) return b;
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

const decoder = new TextDecoder('utf-8');
function decodeLine(bytes: Uint8Array): string {
  let end = bytes.length;
  if (end > 0 && bytes[end - 1] === 0x0d) end--;
  return decoder.decode(bytes.subarray(0, end)).replace(/^﻿/, '');
}

/** The subagent files beside a transcript: <dir>/<sessionId>/subagents/*.jsonl. */
export function subagentDir(transcript: string, sessionId: string): string {
  const dir = transcript.replace(/[\\/][^\\/]*$/, '');
  return `${dir}/${sessionId}/subagents`;
}

export function createSessionFilesStore(deps: StoreDeps) {
  const entries = new Map<string, Entry>();
  const chunk = deps.chunkBytes ?? DEFAULT_CHUNK;
  const pause = deps.yieldNow ?? (() => Promise.resolve());

  async function readNew(entry: Entry, file: string, subagent: boolean): Promise<void> {
    const size = await deps.fs.size(file);
    if (size === null) return;
    let cursor = entry.cursors.get(file);
    if (!cursor || size < cursor.offset) {
      // New, or rewritten shorter than we read: start over for this file. A shorter
      // main transcript means the session is not the one we parsed; reset it all.
      if (cursor && !subagent) entry.state = newParseState();
      cursor = { offset: 0, carry: null };
      entry.cursors.set(file, cursor);
    }
    while (cursor.offset < size) {
      const want = Math.min(chunk, size - cursor.offset);
      const bytes = await deps.fs.read(file, cursor.offset, want);
      if (bytes.length === 0) break;
      const carryLen = cursor.carry?.length ?? 0;
      const buf = concat(cursor.carry, bytes);
      const base = cursor.offset - carryLen;
      let start = 0;
      for (let i = 0; i < buf.length; i++) {
        if (buf[i] !== NEWLINE) continue;
        if (i > start) ingestLine(entry.state, decodeLine(buf.subarray(start, i)), base + start, subagent);
        start = i + 1;
      }
      cursor.carry = start < buf.length ? buf.slice(start) : null;
      cursor.offset += bytes.length;
      if (cursor.offset < size) await pause();
    }
  }

  async function refresh(entry: Entry, sessionId: string): Promise<void> {
    await readNew(entry, entry.file, false);
    const dir = subagentDir(entry.file, sessionId);
    for (const name of (await deps.fs.list(dir)).sort()) {
      if (!name.endsWith('.jsonl')) continue;
      await readNew(entry, `${dir}/${name}`, true);
    }
  }

  function touch(sessionId: string, entry: Entry): void {
    entries.delete(sessionId);
    entries.set(sessionId, entry);
    while (entries.size > MAX_CACHED_SESSIONS) {
      const oldest = entries.keys().next().value as string;
      entries.delete(oldest);
    }
  }

  /**
   * Bring one session up to date and return its parsed state, or null when it has
   * no transcript. Reads for the same session run one after another.
   */
  async function read(sessionId: string, cwd: string): Promise<{ file: string; state: SessionParseState } | null> {
    const file = deps.locate(sessionId, cwd);
    if (!file) return null;
    let entry = entries.get(sessionId);
    if (!entry || entry.file !== file) {
      entry = { file, state: newParseState(), cursors: new Map(), busy: Promise.resolve() };
    }
    touch(sessionId, entry);
    const e = entry;
    const run = e.busy.then(() => refresh(e, sessionId));
    e.busy = run.catch(() => {});
    try { await run; } catch { /* a read error leaves what was parsed so far */ }
    return { file: e.file, state: e.state };
  }

  /** The Files list for a session, with command-made files merged in. */
  async function list(
    sessionId: string,
    cwd: string,
    commandFiles?: (state: SessionParseState) => ChangedFile[],
    excludeFolders: string[] = [],
  ): Promise<SessionFiles | null> {
    const got = await read(sessionId, cwd);
    if (!got) return null;
    return sessionFilesView(got.state, commandFiles ? commandFiles(got.state) : [], excludeFolders);
  }

  /** The raw bytes of one pasted image, read back out of the transcript line that holds it. */
  async function pastedBytes(sessionId: string, cwd: string, key: string): Promise<{ image: PastedImage; data: Uint8Array } | null> {
    const got = await read(sessionId, cwd);
    if (!got) return null;
    const image = got.state.pasted.find(p => p.key === key);
    if (!image) return null;
    let buf: Uint8Array = new Uint8Array(0);
    let pos = image.offset;
    for (;;) {
      const bytes = await deps.fs.read(got.file, pos, chunk);
      if (bytes.length === 0) break;
      const nl = bytes.indexOf(NEWLINE);
      buf = concat(buf, nl >= 0 ? bytes.subarray(0, nl) : bytes);
      if (nl >= 0) break;
      pos += bytes.length;
    }
    try {
      const obj = JSON.parse(decodeLine(buf)) as { message?: { content?: { source?: { data?: unknown } }[] } };
      const data = obj.message?.content?.[image.index]?.source?.data;
      if (typeof data !== 'string') return null;
      return { image, data: base64ToBytes(data) };
    } catch {
      return null;
    }
  }

  return { read, list, pastedBytes, forget: (sessionId: string) => entries.delete(sessionId) };
}

export type SessionFilesStore = ReturnType<typeof createSessionFilesStore>;

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// The message counts behind the streak calendar (design-07, AFT-97):
// <userData>\activity.json, owned by the main process.
//
// Claude Code deletes old transcripts, so afterterm keeps its own count per day. The
// store reads every transcript under Claude Code's projects folder
// (<dir>/<sessionId>.jsonl, one level down; the <sessionId>/subagents files hold only
// sidechain turns, which never count, so they are not read) and counts the lines
// activity-counts.ts says are messages the user sent.
//
// How it reads:
//  - The first scan on a profile with no activity.json is the backfill: every
//    transcript still on disk, read whole. `backfilling` is true until it finishes.
//  - After that the same scan runs every 30 seconds (and on nudge(), which main calls
//    once a turn): a file whose size and mtime have not changed is skipped, and a
//    changed one is read from the saved offset. The offset only ever moves to the end
//    of the last complete line, so a line Claude Code is still writing is read again
//    whole next time. A file that shrank is read again from the start.
//  - Reads are 1 MB at a time, and the scan gives the event loop back every few
//    milliseconds (sliceMs), so the main thread never stalls on it.
//  - Every counted line is remembered by a 12 hex digit key of its uuid, kept per day
//    in the file, so a resumed session (which copies earlier lines into a new file),
//    a re-read after a shrink and a backfill interrupted by quitting can never count
//    a message twice. The count of a day is the number of keys it holds.
//
// Quitting mid-backfill: the saved file always holds offsets no further than what was
// counted, and its keys; the next launch sees `backfilled: false` and simply carries
// on scanning from those offsets. Anything read twice is dropped by its key.
//
// Writes go to activity.json.tmp and are renamed over activity.json. A file that does
// not parse is moved aside to activity.bad-<time>.json, never overwritten, and the
// store starts again with a backfill. No Electron here: the tests run it on a temp
// folder.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { countableTurn, mightCount, uuidKey } from './activity-counts.ts';

export const ACTIVITY_FILE = 'activity.json';
const KEY_LEN = 12;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** What has been read of one transcript: o offset, s size and m mtime when finished. */
interface FileRecord { o: number; s: number; m: number }

export interface ActivityFileData {
  version: 1;
  /** True once the first full scan (the backfill) has finished. */
  backfilled: boolean;
  /** Per transcript, by its path relative to the projects folder. */
  files: Record<string, FileRecord>;
  /** Per local day, the keys of the messages counted that day, concatenated. */
  seen: Record<string, string>;
}

export interface ActivitySnapshot {
  /** Messages the user sent to Claude, per local day (YYYY-MM-DD). Days with none are absent. */
  days: Record<string, number>;
  /** True until the first full read of the transcripts on disk has finished. */
  backfilling: boolean;
}

export interface ActivityStoreOptions {
  dataDir: string;
  /** Claude Code's projects folder, asked on every scan. */
  projectsDir: () => string;
  yieldNow?: () => Promise<void>;
  /** Longest stretch of work between two yields, in ms. */
  sliceMs?: number;
  chunkBytes?: number;
  saveDebounceMs?: number;
  /** Shortest gap between two change pushes while a scan runs. */
  emitEveryMs?: number;
  /** Files read at once. */
  parallel?: number;
  log?: (msg: string) => void;
}

export const POLL_MS = 30_000;
export const START_DELAY_MS = 5_000;
const NUDGE_DELAY_MS = 2_000;

function emptyData(): ActivityFileData {
  return { version: 1, backfilled: false, files: {}, seen: {} };
}

function isRecord(v: unknown): v is FileRecord {
  const r = v as FileRecord;
  return !!r && typeof r === 'object' && Number.isFinite(r.o) && r.o >= 0 && Number.isFinite(r.s) && Number.isFinite(r.m);
}

/** Validates a parsed activity.json; throws on a shape it cannot use. */
export function parseActivityFile(raw: unknown): ActivityFileData {
  const o = raw as Partial<ActivityFileData>;
  if (!o || typeof o !== 'object' || o.version !== 1) throw new Error('not an activity file');
  const out = emptyData();
  out.backfilled = o.backfilled === true;
  for (const [k, v] of Object.entries(o.files ?? {})) if (isRecord(v)) out.files[k] = { o: v.o, s: v.s, m: v.m };
  for (const [day, keys] of Object.entries(o.seen ?? {})) {
    if (DAY_RE.test(day) && typeof keys === 'string' && keys.length % KEY_LEN === 0 && /^[0-9a-f]*$/.test(keys)) {
      out.seen[day] = keys;
    }
  }
  return out;
}

export function loadActivityFile(file: string): { data: ActivityFileData; existed: boolean; note: string | null } {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { data: emptyData(), existed: false, note: null };
    return { data: emptyData(), existed: false, note: `could not read ${file}: ${(e as Error).message}` };
  }
  try {
    return { data: parseActivityFile(JSON.parse(raw.replace(/^﻿/, ''))), existed: true, note: null };
  } catch {
    const aside = path.join(path.dirname(file), `activity.bad-${Date.now()}.json`);
    try { fs.renameSync(file, aside); } catch { /* left in place; the next save writes beside it */ }
    return { data: emptyData(), existed: false, note: `activity.json did not parse; moved to ${aside}` };
  }
}

export function writeActivityFile(file: string, data: ActivityFileData): void {
  const tmp = file + '.tmp';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
  fs.renameSync(tmp, file);
}

const now = () => performance.now();

export class ActivityStore {
  readonly file: string;
  readonly loadNote: string | null;
  private data: ActivityFileData;
  private keys = new Set<string>();
  private counts = new Map<string, number>();
  private listeners = new Set<(s: ActivitySnapshot) => void>();
  private opts: Required<Omit<ActivityStoreOptions, 'log'>> & { log: (m: string) => void };

  private running: Promise<void> | null = null;
  private rerun = false;
  private stopped = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private nudgeTimer: ReturnType<typeof setTimeout> | null = null;
  private dirtySave = false;
  private dirtyEmit = false;
  private lastEmit = 0;
  private sliceStart = 0;

  constructor(opts: ActivityStoreOptions) {
    this.opts = {
      yieldNow: () => new Promise<void>((r) => setImmediate(r)),
      sliceMs: 8,
      chunkBytes: 1024 * 1024,
      saveDebounceMs: 2_000,
      emitEveryMs: 1_000,
      parallel: 6,
      log: () => {},
      ...opts,
    } as ActivityStore['opts'];
    this.file = path.join(opts.dataDir, ACTIVITY_FILE);
    const { data, note } = loadActivityFile(this.file);
    this.data = data;
    this.loadNote = note;
    for (const [day, keys] of Object.entries(data.seen)) {
      let n = 0;
      for (let i = 0; i < keys.length; i += KEY_LEN) {
        const k = keys.slice(i, i + KEY_LEN);
        if (!this.keys.has(k)) { this.keys.add(k); n++; }
      }
      if (n > 0) this.counts.set(day, n);
    }
  }

  get(): ActivitySnapshot {
    const days: Record<string, number> = {};
    for (const [d, n] of [...this.counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) days[d] = n;
    return { days, backfilling: !this.data.backfilled };
  }

  onChange(fn: (s: ActivitySnapshot) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** The first scan after `delayMs`, then one every `pollMs`. */
  start(delayMs = START_DELAY_MS, pollMs = POLL_MS): void {
    if (this.startTimer || this.pollTimer) return;
    this.stopped = false;
    this.startTimer = setTimeout(() => {
      this.startTimer = null;
      void this.scan();
      this.pollTimer = setInterval(() => { void this.scan(); }, pollMs);
    }, delayMs);
  }

  /** Something probably changed (a turn ended): scan soon rather than at the next poll. */
  nudge(): void {
    if (this.stopped || this.nudgeTimer) return;
    this.nudgeTimer = setTimeout(() => { this.nudgeTimer = null; void this.scan(); }, NUDGE_DELAY_MS);
  }

  stop(): void {
    this.stopped = true;
    for (const t of [this.startTimer, this.nudgeTimer]) if (t) clearTimeout(t);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.startTimer = this.nudgeTimer = this.pollTimer = null;
  }

  /** Write a pending change now, for quit. */
  flush(): void {
    if (this.dirtySave) this.saveNow();
  }

  saveNow(): void {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    this.dirtySave = false;
    try {
      writeActivityFile(this.file, this.data);
    } catch (e) {
      this.opts.log(`could not save ${this.file}: ${(e as Error).message}`);
    }
  }

  /** One scan of the projects folder; a call during a scan runs one more after it. */
  scan(): Promise<void> {
    if (this.running) { this.rerun = true; return this.running; }
    this.running = (async () => {
      do {
        this.rerun = false;
        try { await this.scanOnce(); } catch (e) { this.opts.log(`scan failed: ${(e as Error).message}`); }
      } while (this.rerun && !this.stopped);
    })().finally(() => { this.running = null; });
    return this.running;
  }

  private scheduleSave(): void {
    this.dirtySave = true;
    if (this.saveTimer || this.stopped) return;
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.saveNow(); }, this.opts.saveDebounceMs);
  }

  private emit(force = false): void {
    if (!force && (!this.dirtyEmit || now() - this.lastEmit < this.opts.emitEveryMs)) return;
    this.dirtyEmit = false;
    this.lastEmit = now();
    const snap = this.get();
    for (const fn of this.listeners) { try { fn(snap); } catch { /* a listener's error is its own */ } }
  }

  private async breathe(): Promise<void> {
    if (now() - this.sliceStart < this.opts.sliceMs) return;
    await this.opts.yieldNow();
    this.sliceStart = now();
  }

  private ingest(line: Buffer): void {
    if (!mightCount(line)) return;
    let obj: unknown;
    try {
      obj = JSON.parse(line.toString('utf8').replace(/^﻿/, ''));
    } catch {
      return;
    }
    const turn = countableTurn(obj);
    if (!turn) return;
    const k = uuidKey(turn.uuid);
    if (this.keys.has(k)) return;
    this.keys.add(k);
    this.data.seen[turn.day] = (this.data.seen[turn.day] ?? '') + k;
    this.counts.set(turn.day, (this.counts.get(turn.day) ?? 0) + 1);
    this.dirtyEmit = true;
    this.dirtySave = true;
  }

  private async scanOnce(): Promise<void> {
    const root = this.opts.projectsDir();
    const t0 = now();
    this.sliceStart = now();
    if (!this.data.backfilled) this.opts.log(`backfill started (${this.keys.size} messages already counted)`);
    let dirs: fs.Dirent[];
    try {
      dirs = await fsp.readdir(root, { withFileTypes: true });
    } catch (e) {
      // No projects folder: Claude Code has never run here, so there is nothing to
      // fill. Any other error leaves the backfill to the next scan.
      if ((e as NodeJS.ErrnoException).code === 'ENOENT' && !this.data.backfilled) {
        this.data.backfilled = true;
        this.scheduleSave();
        this.emit(true);
      }
      return;
    }

    const present = new Set<string>();
    const listedDirs = new Set<string>();
    const rootDirs = new Set<string>();
    const todo: { rel: string; abs: string }[] = [];
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      rootDirs.add(d.name);
      let names: fs.Dirent[];
      try {
        names = await fsp.readdir(path.join(root, d.name), { withFileTypes: true });
      } catch {
        continue;
      }
      listedDirs.add(d.name);
      for (const f of names) {
        if (!f.isFile() || !f.name.endsWith('.jsonl')) continue;
        const rel = `${d.name}/${f.name}`;
        present.add(rel);
        todo.push({ rel, abs: path.join(root, d.name, f.name) });
      }
      await this.breathe();
    }

    // A few files at a time: in Electron's main process every file operation is a
    // round trip through the event loop, and on a backfill of thousands of small files
    // that wait, not the reading, is most of the time. The counting itself stays
    // synchronous per line, so the workers never interleave inside one line.
    let bytes = 0;
    let next = 0;
    const worker = async () => {
      while (next < todo.length && !this.stopped) {
        const { rel, abs } = todo[next++];
        try {
          const got = await this.readFile(rel, abs);
          bytes += got;
        } catch (e) {
          this.opts.log(`could not read ${rel}: ${(e as Error).message}`);
        }
        this.emit();
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.opts.parallel, todo.length) }, worker));
    if (this.stopped) return;

    // Forget files that are gone (Claude Code deletes old transcripts); their
    // messages stay counted through their keys.
    for (const rel of Object.keys(this.data.files)) {
      if (present.has(rel)) continue;
      const dir = rel.slice(0, rel.indexOf('/'));
      if (listedDirs.has(dir) || !rootDirs.has(dir)) { delete this.data.files[rel]; this.dirtySave = true; }
    }

    const wasBackfill = !this.data.backfilled;
    if (wasBackfill && !this.stopped) {
      this.data.backfilled = true;
      this.dirtyEmit = true;
      this.opts.log(`backfill finished: ${todo.length} files, ${(bytes / 1048576).toFixed(1)} MB in ${Math.round(now() - t0)} ms, ${this.keys.size} messages`);
    }
    if (this.dirtySave) this.scheduleSave();
    if (this.dirtyEmit) this.emit(true);
  }

  /** Reads what is new in one transcript. Returns the bytes read. */
  private async readFile(rel: string, abs: string): Promise<number> {
    const st = await fsp.stat(abs);
    const prev = this.data.files[rel];
    if (prev && prev.s === st.size && prev.m === st.mtimeMs) return 0;
    let offset = prev && st.size >= prev.o ? prev.o : 0;
    const end = st.size;
    if (offset >= end) {
      this.data.files[rel] = { o: offset, s: st.size, m: st.mtimeMs };
      this.scheduleSave();
      return 0;
    }
    const fh = await fsp.open(abs, 'r');
    let read = 0;
    try {
      const carry: Buffer[] = [];
      let pos = offset;
      while (pos < end) {
        if (this.stopped) return read;
        const want = Math.min(this.opts.chunkBytes, end - pos);
        const buf = Buffer.allocUnsafe(want);
        const { bytesRead } = await fh.read(buf, 0, want, pos);
        if (bytesRead === 0) break;
        read += bytesRead;
        const data = buf.subarray(0, bytesRead);
        let start = 0;
        let nl = data.indexOf(0x0a, start);
        while (nl >= 0) {
          let line = data.subarray(start, nl);
          if (carry.length) { line = Buffer.concat([...carry, line]); carry.length = 0; }
          this.ingest(line);
          start = nl + 1;
          offset = pos + start;
          nl = data.indexOf(0x0a, start);
          if (now() - this.sliceStart >= this.opts.sliceMs) {
            // In progress: no size or mtime yet, so a save now never marks it finished.
            this.data.files[rel] = { o: offset, s: -1, m: -1 };
            this.scheduleSave();
            await this.breathe();
            if (this.stopped) return read;
          }
        }
        if (start < data.length) carry.push(data.subarray(start));
        pos += bytesRead;
        this.data.files[rel] = { o: offset, s: -1, m: -1 };
        this.scheduleSave();
        await this.breathe();
      }
    } finally {
      await fh.close().catch(() => {});
    }
    this.data.files[rel] = { o: offset, s: st.size, m: st.mtimeMs };
    this.scheduleSave();
    return read;
  }
}

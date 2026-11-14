// The loops store (design-07): <userData>\loops.json, owned by the main process,
// which is the only writer. The renderer and the `afterterm loops` command both
// change loops by asking main, so two writers can never race.
//
// No Electron here (a folder in, a store out), so the tests run it on a temp
// folder.
//
// Rules:
//  - Writes go to loops.json.tmp and are renamed over loops.json, so a crash
//    mid-write leaves the old file whole.
//  - A loops.json that exists but does not parse is never overwritten: it is
//    moved aside to loops.bad-<time>.json and the store starts empty, so nothing
//    a person could still recover is lost.
//  - Saves are debounced (150 ms) and flushed on quit.
//  - Deleted loops older than 30 days are purged when the store loads.

import fs from 'node:fs';
import path from 'node:path';
import {
  archiveLoop, closeLoop, createLoop, deleteLoop, editLoop, emptyLoopsFile, parseLoopsFile, pingLoop,
  purgeDeleted, reopenLoop, restoreLoop,
  type Actor, type Loop, type LoopEdit, type LoopsFile, type NewLoop,
} from './loops.ts';

export const LOOPS_FILE = 'loops.json';
const SAVE_DEBOUNCE_MS = 150;

// One change, as both the UI and the command line send it.
export type LoopAction =
  | { op: 'new'; loop: NewLoop }
  | { op: 'update'; id: string; edit: LoopEdit }
  | { op: 'ping'; id: string }
  | { op: 'close'; id: string; withSubLoops?: boolean; note?: string }
  | { op: 'reopen'; id: string }
  | { op: 'archive'; id: string }
  | { op: 'unarchive'; id: string }
  | { op: 'delete'; id: string }
  | { op: 'restore'; id: string };

export interface ActionResult {
  loop: Loop;
  changed: Loop[];
  pinged?: boolean;
}

export class LoopsStore {
  readonly file: string;
  private data: LoopsFile;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(loops: Loop[]) => void>();
  readonly loadNote: string | null;

  constructor(dir: string, now = Date.now()) {
    this.file = path.join(dir, LOOPS_FILE);
    const { data, note } = loadLoopsFile(this.file);
    this.data = data;
    this.loadNote = note;
    if (purgeDeleted(this.data, now) > 0) this.scheduleSave();
  }

  list(): Loop[] {
    return this.data.loops.map((l) => ({ ...l, chat: l.chat ? { ...l.chat } : null }));
  }

  get(id: string): Loop | undefined {
    return this.list().find((l) => l.id === id);
  }

  onChange(fn: (loops: Loop[]) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // Applies one change. Throws LoopError on a refused change (nothing is
  // written then).
  apply(action: LoopAction, actor: Actor, now = Date.now()): ActionResult {
    const d = this.data;
    let result: ActionResult;
    switch (action.op) {
      case 'new': { const l = createLoop(d, action.loop, now, actor); result = { loop: l, changed: [l] }; break; }
      case 'update': { const l = editLoop(d, action.id, action.edit, now, actor); result = { loop: l, changed: [l] }; break; }
      case 'ping': { const r = pingLoop(d, action.id, now, actor); result = { loop: r.loop, changed: [r.loop], pinged: r.pinged }; break; }
      case 'close': {
        const changed = closeLoop(d, action.id, now, actor, { withSubLoops: action.withSubLoops, note: action.note });
        result = { loop: d.loops.find((l) => l.id === action.id)!, changed };
        break;
      }
      case 'reopen': { const l = reopenLoop(d, action.id, now, actor); result = { loop: l, changed: [l] }; break; }
      case 'archive': { const l = archiveLoop(d, action.id, now, actor, true); result = { loop: l, changed: [l] }; break; }
      case 'unarchive': { const l = archiveLoop(d, action.id, now, actor, false); result = { loop: l, changed: [l] }; break; }
      case 'delete': { const changed = deleteLoop(d, action.id, now, actor); result = { loop: changed[0], changed }; break; }
      case 'restore': { const l = restoreLoop(d, action.id); result = { loop: l, changed: [l] }; break; }
      default: throw new Error('unknown op');
    }
    this.scheduleSave();
    const snapshot = this.list();
    for (const fn of this.listeners) { try { fn(snapshot); } catch { /* a listener's error is its own */ } }
    return { ...result, loop: { ...result.loop } };
  }

  private scheduleSave() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.saveNow(); }, SAVE_DEBOUNCE_MS);
  }

  saveNow() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    writeLoopsFile(this.file, this.data);
  }

  // Flush a pending save, for quit.
  flush() {
    if (this.timer) this.saveNow();
  }
}

export function loadLoopsFile(file: string): { data: LoopsFile; note: string | null } {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { data: emptyLoopsFile(), note: null };
    return { data: emptyLoopsFile(), note: `could not read ${file}: ${(e as Error).message}` };
  }
  try {
    return { data: parseLoopsFile(JSON.parse(raw.replace(/^﻿/, ''))), note: null };
  } catch {
    const aside = path.join(path.dirname(file), `loops.bad-${Date.now()}.json`);
    try { fs.renameSync(file, aside); } catch { /* left in place; the next save still writes beside it */ }
    return { data: emptyLoopsFile(), note: `loops.json did not parse; moved to ${aside}` };
  }
}

export function writeLoopsFile(file: string, data: LoopsFile) {
  const tmp = file + '.tmp';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1), 'utf8');
  fs.renameSync(tmp, file);
}

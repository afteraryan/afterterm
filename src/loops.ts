// Loops (design-07): the pieces of work started in every project, and the rules
// that decide how they look. Pure: no file system, no Electron, no clock of its
// own (every rule takes `now`), so the main process, the renderer and the tests
// all share it.
//
// A loop is stored with status 'open' or 'closed' only. Rotting is never stored:
// it is worked out from the loop's activity each time it is shown, so any
// activity makes a rotting loop open again without anyone writing it back.
//
// One level of nesting: a loop may have sub-loops, a sub-loop never has its own.
// A sub-loop always has its parent's project.

export type LoopLabel = 'feature' | 'bug' | 'idea';
export type LoopStoredStatus = 'open' | 'closed';
export type LoopStatus = 'open' | 'closed' | 'rotting';

export const LOOP_LABELS: readonly LoopLabel[] = ['feature', 'bug', 'idea'];
export const ROT_DAYS = 5;
export const DELETE_KEEP_DAYS = 30;
export const PING_GAP_MS = 24 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

// The one chat a loop remembers (design-07): the chat that created it, replaced
// whenever an agent edits the loop from another chat. Aryan's edits in the UI
// never change it.
export interface LoopChat {
  threadId?: string;          // afterterm's thread id (Tab.id), when the chat was in afterterm
  sessionId?: string;         // Claude Code's session id, for resuming a closed chat
  cwd?: string;               // the folder the chat was in when it last touched the loop
}

export interface Loop {
  id: string;                 // a short number as text, "1", "2" ... (typed by agents)
  title: string;
  project: string | null;     // afterterm project (Group) id; null is General
  label: LoopLabel;
  status: LoopStoredStatus;
  description: string;
  note: string;               // status note: where it was left
  noteAt?: number;
  chat: LoopChat | null;
  parent: string | null;      // a sub-loop's parent id
  createdAt: number;
  activityAt: number;         // last ping, note or edit (closing excepted, see below)
  pingAt?: number;
  closedAt?: number;
  archivedAt?: number;
  deletedAt?: number;
}

export interface LoopsFile {
  version: 1;
  nextId: number;
  loops: Loop[];
}

export function emptyLoopsFile(): LoopsFile {
  return { version: 1, nextId: 1, loops: [] };
}

// Who made a change. An agent comes with its chat (from the terminal it ran in);
// the UI is Aryan.
export type Actor = { kind: 'user' } | { kind: 'agent'; chat: LoopChat | null };

// ---------- reading a file safely ----------

function str(v: unknown, max = 4000): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
}
function asChat(v: unknown): LoopChat | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const chat: LoopChat = {};
  if (typeof o.threadId === 'string' && o.threadId) chat.threadId = o.threadId.slice(0, 200);
  if (typeof o.sessionId === 'string' && o.sessionId) chat.sessionId = o.sessionId.slice(0, 200);
  if (typeof o.cwd === 'string' && o.cwd) chat.cwd = o.cwd.slice(0, 1000);
  return chat.threadId || chat.sessionId || chat.cwd ? chat : null;
}

// Any JSON in, a valid LoopsFile out. Loops with no id or title are dropped; a
// sub-loop whose parent is gone, or whose parent is itself a sub-loop, becomes a
// top-level loop; a sub-loop takes its parent's project.
export function parseLoopsFile(raw: unknown): LoopsFile {
  const out = emptyLoopsFile();
  if (!raw || typeof raw !== 'object') return out;
  const o = raw as Record<string, unknown>;
  const list = Array.isArray(o.loops) ? o.loops : [];
  const seen = new Set<string>();
  let maxId = 0;
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const id = typeof r.id === 'string' ? r.id : typeof r.id === 'number' ? String(r.id) : '';
    const title = str(r.title, 300).trim();
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    const n = Number(id);
    if (Number.isInteger(n) && n > maxId) maxId = n;
    const createdAt = num(r.createdAt) ?? 0;
    const loop: Loop = {
      id,
      title,
      project: typeof r.project === 'string' && r.project ? r.project : null,
      label: LOOP_LABELS.includes(r.label as LoopLabel) ? (r.label as LoopLabel) : 'feature',
      status: r.status === 'closed' ? 'closed' : 'open',
      description: str(r.description),
      note: str(r.note),
      chat: asChat(r.chat),
      parent: typeof r.parent === 'string' && r.parent ? r.parent : null,
      createdAt,
      activityAt: num(r.activityAt) ?? createdAt,
    };
    for (const k of ['noteAt', 'pingAt', 'closedAt', 'archivedAt', 'deletedAt'] as const) {
      const v = num(r[k]);
      if (v !== undefined) loop[k] = v;
    }
    out.loops.push(loop);
  }
  const byId = new Map(out.loops.map((l) => [l.id, l]));
  for (const l of out.loops) {
    if (!l.parent) continue;
    const p = byId.get(l.parent);
    if (!p || p.parent || p.id === l.id) { l.parent = null; continue; }
    l.project = p.project;
  }
  const next = num(o.nextId);
  out.nextId = Math.max(next ?? 1, maxId + 1);
  return out;
}

// ---------- rotting ----------

// Local calendar date of a time, as a day number (days since 1970-01-01 in
// local time). Two times on the same local date give the same number.
export function localDay(t: number): number {
  const d = new Date(t);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
}

// A loop's activity including its sub-loops' (a sub-loop's activity counts for
// its parent). Deleted sub-loops do not count; archived ones still do, since the
// work happened.
export function effectiveActivity(loop: Loop, all: readonly Loop[]): number {
  let t = loop.activityAt;
  if (!loop.parent) {
    for (const s of all) {
      if (s.parent === loop.id && !s.deletedAt && s.activityAt > t) t = s.activityAt;
    }
  }
  return t;
}

// Open, closed or rotting. A loop rots when 5 calendar days have passed since
// its last activity (a loop last touched on Monday rots on Saturday). Ideas and
// closed loops never rot.
export function loopStatus(loop: Loop, all: readonly Loop[], now: number): LoopStatus {
  if (loop.status === 'closed') return 'closed';
  if (loop.label === 'idea') return 'open';
  const days = localDay(now) - localDay(effectiveActivity(loop, all));
  return days >= ROT_DAYS ? 'rotting' : 'open';
}

// ---------- what is shown ----------

export function isListed(loop: Loop): boolean {
  return !loop.deletedAt && !loop.archivedAt;
}

export function subLoopsOf(id: string, all: readonly Loop[]): Loop[] {
  return all.filter((l) => l.parent === id && !l.deletedAt);
}

// Most recent activity first. Ties go to the newer loop.
export function byActivity(all: readonly Loop[]): (a: Loop, b: Loop) => number {
  return (a, b) => effectiveActivity(b, all) - effectiveActivity(a, all) || b.createdAt - a.createdAt || Number(b.id) - Number(a.id);
}

// Top-level loops in the lists (not archived, not deleted), most recent first.
export function orderedTopLoops(all: readonly Loop[]): Loop[] {
  return all.filter((l) => !l.parent && isListed(l)).sort(byActivity(all));
}

// Sub-loops in a parent, most recent first; archived ones are left out like
// top-level ones.
export function orderedSubLoops(id: string, all: readonly Loop[]): Loop[] {
  return all.filter((l) => l.parent === id && isListed(l)).sort(byActivity(all));
}

export interface LoopCounts {
  open: number;
  rotting: number;
  closed: number;
  remaining: number;          // open plus rotting, never closed
  total: number;
}

// The counts on the count card and the workspace card: top-level loops in the
// lists only (sub-loops are counted by their "1/5", not here).
export function loopCounts(all: readonly Loop[], now: number): LoopCounts {
  const c: LoopCounts = { open: 0, rotting: 0, closed: 0, remaining: 0, total: 0 };
  for (const l of orderedTopLoops(all)) c[loopStatus(l, all, now)]++;
  c.remaining = c.open + c.rotting;
  c.total = c.remaining + c.closed;
  return c;
}

// "1/5": closed sub-loops of all sub-loops in the list. Null with none.
export function subLoopFraction(id: string, all: readonly Loop[]): { closed: number; total: number } | null {
  const subs = orderedSubLoops(id, all);
  if (!subs.length) return null;
  return { closed: subs.filter((s) => s.status === 'closed').length, total: subs.length };
}

// The workspace card: the 5 most recent top-level loops, open or closed, never
// rotting.
export function recentForCard(all: readonly Loop[], now: number, n = 5): Loop[] {
  return orderedTopLoops(all).filter((l) => loopStatus(l, all, now) !== 'rotting').slice(0, n);
}

// The parent-close rule: a parent with open sub-loops cannot just close. The UI
// asks first; the CLI refuses without --with-sub-loops. Returns the open
// sub-loops that would be closed with it.
export function openSubLoops(id: string, all: readonly Loop[]): Loop[] {
  return orderedSubLoops(id, all).filter((s) => s.status === 'open');
}

// A deleted loop is kept 30 days, then gone for good.
export function isPurgeable(loop: Loop, now: number): boolean {
  return loop.deletedAt !== undefined && now - loop.deletedAt >= DELETE_KEEP_DAYS * DAY_MS;
}

// An agent pings only when its last ping was more than a day ago. The CLI keeps
// the rule so an eager agent cannot shuffle the list: a ping inside the day is
// accepted and changes nothing.
export function pingIsDue(loop: Loop, now: number): boolean {
  return loop.pingAt === undefined || now - loop.pingAt > PING_GAP_MS;
}

// ---------- changes ----------

export interface LoopEdit {
  title?: string;
  description?: string;
  note?: string;
  label?: LoopLabel;
  project?: string | null;
  parent?: string | null;
}

export class LoopError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

function find(file: LoopsFile, id: string, opts: { deleted?: boolean } = {}): Loop {
  const l = file.loops.find((x) => x.id === id);
  if (!l || (l.deletedAt !== undefined && !opts.deleted)) throw new LoopError('not-found', `No loop ${id}`);
  return l;
}

// Every change by an agent from a chat makes that chat the remembered one. A
// change by Aryan never does.
function remember(loop: Loop, actor: Actor) {
  if (actor.kind === 'agent' && actor.chat) loop.chat = { ...actor.chat };
}

function touch(loop: Loop, now: number, actor: Actor) {
  loop.activityAt = now;
  remember(loop, actor);
}

function validParent(file: LoopsFile, id: string | null, self?: Loop): Loop | null {
  if (!id) return null;
  const p = find(file, id);
  if (p.parent) throw new LoopError('bad-parent', `Loop ${id} is a sub-loop; sub-loops cannot have their own`);
  if (self) {
    if (p.id === self.id) throw new LoopError('bad-parent', 'A loop cannot be its own parent');
    if (file.loops.some((l) => l.parent === self.id && !l.deletedAt)) {
      throw new LoopError('bad-parent', `Loop ${self.id} has sub-loops, so it cannot become one`);
    }
  }
  return p;
}

export interface NewLoop {
  title: string;
  label?: LoopLabel;
  project?: string | null;
  description?: string;
  note?: string;
  parent?: string | null;
}

export function createLoop(file: LoopsFile, input: NewLoop, now: number, actor: Actor): Loop {
  const title = (input.title ?? '').trim();
  if (!title) throw new LoopError('bad-input', 'A loop needs a title');
  const parent = validParent(file, input.parent ?? null);
  const loop: Loop = {
    id: String(file.nextId++),
    title: title.slice(0, 300),
    project: parent ? parent.project : input.project ?? null,
    label: input.label ?? 'feature',
    status: 'open',
    description: (input.description ?? '').slice(0, 4000),
    note: (input.note ?? '').slice(0, 4000),
    chat: null,
    parent: parent ? parent.id : null,
    createdAt: now,
    activityAt: now,
  };
  if (loop.note) loop.noteAt = now;
  remember(loop, actor);
  file.loops.push(loop);
  return loop;
}

export function editLoop(file: LoopsFile, id: string, edit: LoopEdit, now: number, actor: Actor): Loop {
  const loop = find(file, id);
  if (edit.title !== undefined) {
    const t = edit.title.trim();
    if (!t) throw new LoopError('bad-input', 'A loop needs a title');
    loop.title = t.slice(0, 300);
  }
  if (edit.description !== undefined) loop.description = edit.description.slice(0, 4000);
  if (edit.note !== undefined) { loop.note = edit.note.slice(0, 4000); loop.noteAt = now; }
  if (edit.label !== undefined) {
    if (!LOOP_LABELS.includes(edit.label)) throw new LoopError('bad-input', `Label is one of ${LOOP_LABELS.join(', ')}`);
    loop.label = edit.label;
  }
  if (edit.parent !== undefined) {
    const p = validParent(file, edit.parent, loop);
    loop.parent = p ? p.id : null;
    if (p) loop.project = p.project;
  }
  if (edit.project !== undefined) {
    if (loop.parent && edit.parent === undefined) throw new LoopError('bad-input', 'A sub-loop always has its parent\'s project');
    if (!loop.parent) {
      loop.project = edit.project;
      for (const s of file.loops) if (s.parent === loop.id) s.project = edit.project;
    }
  }
  touch(loop, now, actor);
  return loop;
}

export function pingLoop(file: LoopsFile, id: string, now: number, actor: Actor): { loop: Loop; pinged: boolean } {
  const loop = find(file, id);
  remember(loop, actor);
  if (!pingIsDue(loop, now)) return { loop, pinged: false };
  loop.pingAt = now;
  loop.activityAt = now;
  return { loop, pinged: true };
}

// Closing keeps the loop's place in the list (design-07: "a closed loop keeps
// its place ... until more recent loops pass it"), so it records closedAt and
// leaves activityAt alone. A note given with it still counts as activity.
export function closeLoop(file: LoopsFile, id: string, now: number, actor: Actor, opts: { withSubLoops?: boolean; note?: string } = {}): Loop[] {
  const loop = find(file, id);
  const open = loop.parent ? [] : openSubLoops(loop.id, file.loops);
  if (open.length && !opts.withSubLoops) {
    throw new LoopError('open-sub-loops', `Loop ${id} has ${open.length} open sub-loop${open.length === 1 ? '' : 's'}: ${open.map((s) => s.id).join(', ')}`);
  }
  const closed: Loop[] = [];
  for (const l of [...open, loop]) {
    if (l.status !== 'closed') { l.status = 'closed'; l.closedAt = now; closed.push(l); }
    remember(l, actor);
  }
  if (opts.note !== undefined) { loop.note = opts.note.slice(0, 4000); loop.noteAt = now; loop.activityAt = now; }
  return closed;
}

// Reopening is activity: the loop is being worked on again. Reopening a closed
// sub-loop of a closed parent reopens the parent too, so no open sub-loop ever
// hides under a closed parent.
export function reopenLoop(file: LoopsFile, id: string, now: number, actor: Actor): Loop {
  const loop = find(file, id);
  loop.status = 'open';
  delete loop.closedAt;
  touch(loop, now, actor);
  if (loop.parent) {
    const p = find(file, loop.parent);
    if (p.status === 'closed') { p.status = 'open'; delete p.closedAt; }
  }
  return loop;
}

// Archive and restore move a loop (with its sub-loops) out of every list and
// back. Neither is activity.
export function archiveLoop(file: LoopsFile, id: string, now: number, actor: Actor, archived = true): Loop {
  const loop = find(file, id);
  for (const l of [loop, ...file.loops.filter((s) => s.parent === loop.id)]) {
    if (archived) l.archivedAt = l.archivedAt ?? now; else delete l.archivedAt;
  }
  remember(loop, actor);
  return loop;
}

// Delete keeps the loop (and its sub-loops) for 30 days. Restore brings them
// back.
export function deleteLoop(file: LoopsFile, id: string, now: number, actor: Actor): Loop[] {
  const loop = find(file, id);
  const gone = [loop, ...file.loops.filter((s) => s.parent === loop.id && !s.deletedAt)];
  for (const l of gone) l.deletedAt = now;
  remember(loop, actor);
  return gone;
}

export function restoreLoop(file: LoopsFile, id: string, deletedAt?: number): Loop {
  const loop = find(file, id, { deleted: true });
  const when = deletedAt ?? loop.deletedAt;
  if (loop.parent) {
    const p = file.loops.find((l) => l.id === loop.parent);
    if (p?.deletedAt) throw new LoopError('bad-parent', `Restore loop ${p.id} first`);
  }
  for (const l of [loop, ...file.loops.filter((s) => s.parent === loop.id && s.deletedAt === when)]) delete l.deletedAt;
  return loop;
}

export function purgeDeleted(file: LoopsFile, now: number): number {
  const before = file.loops.length;
  file.loops = file.loops.filter((l) => !isPurgeable(l, now));
  return before - file.loops.length;
}

// ---------- time on a row ----------

// "now", "5m", "3h", "2d", "3w", "4mo" since the last activity.
export function ageText(t: number, now: number): string {
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return 'now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d}d`;
  if (d < 60) return `${Math.floor(d / 7)}w`;
  return `${Math.floor(d / 30)}mo`;
}

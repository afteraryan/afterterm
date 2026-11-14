// `afterterm loops`: the command agents use to start, update and close loops
// (design-07). The command itself (assets/cli/afterterm-cli.js) is a thin client:
// it sends its arguments, its folder and the chat it runs in to main over the
// loops pipe, and prints what comes back. Everything else is here, pure, so the
// tests run it without a pipe: parsing, the project a loop goes in, the chat it
// remembers, and every line of output.
//
// Output is short on purpose: an agent reads it, so one line per loop and one
// line per change. `--json` gives the records instead.

import {
  ageText, loopCounts, loopStatus, LOOP_LABELS, LoopError, openSubLoops, orderedSubLoops, orderedTopLoops,
  subLoopFraction,
  type Actor, type Loop, type LoopChat, type LoopEdit, type LoopLabel,
} from './loops.ts';
import type { ActionResult, LoopAction } from './loops-store.ts';

// What the renderer tells main about projects and threads, so the command can
// name projects and know which project its thread is in.
export interface LoopsContext {
  projects: { id: string; name: string; folder?: string }[];
  threads: { id: string; project: string | null; sessionId?: string; cwd?: string }[];
}

// Where the command ran: afterterm's thread id (AFTERTERM_TAB_ID), Claude Code's
// session id (CLAUDE_CODE_SESSION_ID, set for the commands Claude Code runs) and
// the folder.
export interface CallerEnv {
  thread?: string;
  session?: string;
  cwd: string;
}

export interface LoopsBackend {
  list(): Loop[];
  apply(action: LoopAction, actor: Actor, now?: number): ActionResult;
}

export interface CliReply {
  code: number;
  out: string;
  err: string;
}

const ok = (out: string): CliReply => ({ code: 0, out: out.endsWith('\n') ? out : out + '\n', err: '' });
const fail = (err: string, code = 1): CliReply => ({ code, out: '', err: err.endsWith('\n') ? err : err + '\n' });

export const HELP = `afterterm loops: the pieces of work started in every project

  afterterm loops list [--all] [--closed] [--project <name>] [--json]
  afterterm loops show <id> [--json]
  afterterm loops new "<title>" [--label feature|bug|idea] [--desc "<what it is for>"]
                       [--note "<where it was left>"] [--parent <id>] [--project <name>]
  afterterm loops update <id> [--note ...] [--desc ...] [--title ...] [--label ...]
                       [--project <name>] [--parent <id>|none]
  afterterm loops ping <id>          I am working on this (counts once a day)
  afterterm loops close <id> [--note ...] [--with-sub-loops]
  afterterm loops reopen <id>
  afterterm loops archive <id>       out of every list (unarchive <id> brings it back)
  afterterm loops delete <id>        kept 30 days (restore <id> brings it back)

list shows this thread's project unless --all or --project. The project of a new
loop is this thread's project unless --project. "general" is no project.
`;

// ---------- arguments ----------

const BOOLEAN_FLAGS = new Set(['json', 'all', 'closed', 'with-sub-loops', 'help', 'archived']);

export interface ParsedArgs {
  pos: string[];
  flags: Record<string, string | true>;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const pos: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { pos.push(...argv.slice(i + 1)); break; }
    if (a.startsWith('--') && a.length > 2) {
      const eq = a.indexOf('=');
      const name = (eq > 0 ? a.slice(2, eq) : a.slice(2)).toLowerCase();
      if (eq > 0) { flags[name] = a.slice(eq + 1); continue; }
      if (BOOLEAN_FLAGS.has(name)) { flags[name] = true; continue; }
      const next = argv[i + 1];
      if (next === undefined) { flags[name] = true; continue; }
      flags[name] = next;
      i++;
      continue;
    }
    if (a === '-h') { flags.help = true; continue; }
    pos.push(a);
  }
  return { pos, flags };
}

// ---------- projects ----------

function normFolder(p: string): string {
  return p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

// The project whose folder holds `cwd`, the deepest one when folders nest.
export function projectForFolder(ctx: LoopsContext, cwd: string): string | null {
  const c = normFolder(cwd);
  let best: { id: string; len: number } | null = null;
  for (const p of ctx.projects) {
    if (!p.folder) continue;
    const f = normFolder(p.folder);
    if (!f) continue;
    if ((c === f || c.startsWith(f + '\\')) && (!best || f.length > best.len)) best = { id: p.id, len: f.length };
  }
  return best ? best.id : null;
}

// The project the caller is in: its thread's project, else the project whose
// folder holds its folder, else General.
export function callerProject(ctx: LoopsContext, env: CallerEnv): string | null {
  const t = env.thread ? ctx.threads.find((x) => x.id === env.thread) : undefined;
  if (t) return t.project;
  return projectForFolder(ctx, env.cwd);
}

// --project's value: an id, a name (case does not matter), or "general".
export function resolveProject(ctx: LoopsContext, value: string): { id: string | null } | { error: string } {
  const v = value.trim();
  if (!v || v.toLowerCase() === 'general' || v.toLowerCase() === 'none') return { id: null };
  const byId = ctx.projects.find((p) => p.id === v);
  if (byId) return { id: byId.id };
  const byName = ctx.projects.filter((p) => p.name.toLowerCase() === v.toLowerCase());
  if (byName.length === 1) return { id: byName[0].id };
  if (byName.length > 1) return { error: `More than one project is named "${v}"; use its id: ${byName.map((p) => p.id).join(', ')}` };
  return { error: `No project "${v}". Projects: ${ctx.projects.map((p) => p.name).join(', ') || '(none)'}, general` };
}

export function projectName(ctx: LoopsContext, id: string | null): string {
  if (!id) return 'General';
  return ctx.projects.find((p) => p.id === id)?.name ?? 'General';
}

// The chat a change made through the command is remembered as.
export function callerChat(ctx: LoopsContext, env: CallerEnv): LoopChat | null {
  const t = env.thread ? ctx.threads.find((x) => x.id === env.thread) : undefined;
  const chat: LoopChat = {};
  if (env.thread) chat.threadId = env.thread;
  const session = env.session || t?.sessionId;
  if (session) chat.sessionId = session;
  const cwd = t?.cwd || env.cwd;
  if (cwd) chat.cwd = cwd;
  return chat.threadId || chat.sessionId || chat.cwd ? chat : null;
}

// ---------- output ----------

function oneLine(s: string, max = 90): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 3) + '...' : t;
}

function statusWord(l: Loop, all: readonly Loop[], now: number): string {
  return loopStatus(l, all, now).padEnd(7);
}

function loopLine(l: Loop, all: readonly Loop[], ctx: LoopsContext, now: number, indent = ''): string {
  const frac = subLoopFraction(l.id, all);
  const parts = [
    `${indent}#${l.id}`.padEnd(indent ? 7 : 5),
    statusWord(l, all, now),
    l.label.padEnd(7),
    oneLine(l.title, 70) + (frac ? ` (${frac.closed}/${frac.total})` : ''),
  ];
  if (!indent) parts.push(`[${projectName(ctx, l.project)}]`);
  parts.push(ageText(l.activityAt, now));
  return parts.join('  ');
}

export function loopRecord(l: Loop, all: readonly Loop[], ctx: LoopsContext, now: number) {
  return {
    id: l.id,
    title: l.title,
    status: loopStatus(l, all, now),
    label: l.label,
    project: l.project,
    projectName: projectName(ctx, l.project),
    parent: l.parent,
    description: l.description,
    note: l.note,
    chat: l.chat,
    createdAt: new Date(l.createdAt).toISOString(),
    activityAt: new Date(l.activityAt).toISOString(),
    closedAt: l.closedAt ? new Date(l.closedAt).toISOString() : null,
    archived: !!l.archivedAt,
    subLoops: l.parent ? undefined : orderedSubLoops(l.id, all).map((s) => s.id),
  };
}

function showText(l: Loop, all: readonly Loop[], ctx: LoopsContext, now: number): string {
  const lines = [`#${l.id} ${l.title}`];
  lines.push(`status: ${loopStatus(l, all, now)}${l.archivedAt ? ' (archived)' : ''}, label: ${l.label}, project: ${projectName(ctx, l.project)}, last activity ${ageText(l.activityAt, now) === 'now' ? 'now' : ageText(l.activityAt, now) + ' ago'}`);
  if (l.parent) {
    const p = all.find((x) => x.id === l.parent);
    lines.push(`sub-loop of #${l.parent}${p ? ' ' + p.title : ''}`);
  }
  if (l.description) lines.push(`description: ${l.description}`);
  if (l.note) lines.push(`status note: ${l.note}`);
  const subs = l.parent ? [] : orderedSubLoops(l.id, all);
  if (subs.length) {
    const f = subLoopFraction(l.id, all)!;
    lines.push(`sub-loops (${f.closed}/${f.total} closed):`);
    for (const s of subs) lines.push(loopLine(s, all, ctx, now, '  '));
  }
  return lines.join('\n');
}

// ---------- the commands ----------

function needId(pos: string[]): string | CliReply {
  const raw = pos[1];
  if (!raw) return fail(`Which loop? Give its id, for example: afterterm loops ${pos[0]} 12`);
  return raw.replace(/^#/, '');
}

function editFromFlags(ctx: LoopsContext, flags: ParsedArgs['flags']): LoopEdit | CliReply {
  const edit: LoopEdit = {};
  const text = (k: string) => (typeof flags[k] === 'string' ? (flags[k] as string) : undefined);
  if (text('title') !== undefined) edit.title = text('title');
  if (text('desc') !== undefined) edit.description = text('desc');
  if (text('description') !== undefined) edit.description = text('description');
  if (text('note') !== undefined) edit.note = text('note');
  if (text('label') !== undefined) {
    const label = text('label')!.toLowerCase() as LoopLabel;
    if (!LOOP_LABELS.includes(label)) return fail(`--label is one of ${LOOP_LABELS.join(', ')}`);
    edit.label = label;
  }
  if (text('project') !== undefined) {
    const r = resolveProject(ctx, text('project')!);
    if ('error' in r) return fail(r.error);
    edit.project = r.id;
  }
  if (text('parent') !== undefined) {
    const p = text('parent')!.replace(/^#/, '');
    edit.parent = p === 'none' || p === '' ? null : p;
  }
  for (const k of ['title', 'desc', 'description', 'note', 'label', 'project', 'parent']) {
    if (flags[k] === true) return fail(`--${k} needs a value`);
  }
  return edit;
}

export function runLoopsCommand(backend: LoopsBackend, ctx: LoopsContext, env: CallerEnv, argv: readonly string[], now = Date.now()): CliReply {
  // `afterterm loops ...` and `afterterm ...` both work.
  const args = argv[0] === 'loops' ? argv.slice(1) : argv.slice();
  const { pos, flags } = parseArgs(args);
  const cmd = (pos[0] ?? '').toLowerCase();
  if (!cmd || cmd === 'help' || flags.help) return ok(HELP);
  const json = flags.json === true;
  const actor: Actor = { kind: 'agent', chat: callerChat(ctx, env) };

  const act = (action: LoopAction): ActionResult | CliReply => {
    try {
      return backend.apply(action, actor, now);
    } catch (e) {
      if (e instanceof LoopError) {
        if (e.code === 'open-sub-loops') {
          return fail(`${e.message}. Ask the user before closing a loop with open sub-loops; with their say, add --with-sub-loops.`, 3);
        }
        return fail(e.message, e.code === 'not-found' ? 4 : 2);
      }
      throw e;
    }
  };
  const done = (r: ActionResult, line: string): CliReply => {
    if (json) return ok(JSON.stringify(loopRecord(r.loop, backend.list(), ctx, now)));
    return ok(line);
  };

  switch (cmd) {
    case 'list': case 'ls': {
      const all = backend.list();
      let project: string | null | undefined;
      if (typeof flags.project === 'string') {
        const r = resolveProject(ctx, flags.project);
        if ('error' in r) return fail(r.error);
        project = r.id;
      } else if (!flags.all) {
        project = callerProject(ctx, env);
      }
      const showArchived = flags.archived === true;
      let top = showArchived
        ? all.filter((l) => !l.parent && l.archivedAt && !l.deletedAt)
        : orderedTopLoops(all);
      if (project !== undefined) top = top.filter((l) => l.project === project);
      if (!flags.closed && !showArchived) top = top.filter((l) => l.status !== 'closed');
      if (json) return ok(JSON.stringify(top.map((l) => loopRecord(l, all, ctx, now))));
      const where = project === undefined ? 'every project' : projectName(ctx, project);
      if (!top.length) return ok(`No ${flags.closed ? '' : 'open '}loops in ${where}.`);
      const lines = [`Loops in ${where}${flags.closed ? '' : ' (open and rotting)'}:`];
      for (const l of top) {
        lines.push(loopLine(l, all, ctx, now));
        for (const s of orderedSubLoops(l.id, all)) {
          if (!flags.closed && s.status === 'closed') continue;
          lines.push(loopLine(s, all, ctx, now, '  '));
        }
      }
      return ok(lines.join('\n'));
    }
    case 'show': case 'get': {
      const id = needId(pos);
      if (typeof id !== 'string') return id;
      const all = backend.list();
      const l = all.find((x) => x.id === id && !x.deletedAt);
      if (!l) return fail(`No loop ${id}`, 4);
      if (json) return ok(JSON.stringify(loopRecord(l, all, ctx, now)));
      return ok(showText(l, all, ctx, now));
    }
    case 'new': case 'start': case 'add': {
      const title = pos.slice(1).join(' ').trim() || (typeof flags.title === 'string' ? flags.title : '');
      if (!title) return fail('A loop needs a title: afterterm loops new "Fix the rail order" --label bug');
      const edit = editFromFlags(ctx, flags);
      if ('code' in edit) return edit;
      const project = edit.project !== undefined ? edit.project : callerProject(ctx, env);
      const r = act({ op: 'new', loop: { title, label: edit.label, project, description: edit.description, note: edit.note, parent: edit.parent ?? null } });
      if ('code' in r) return r;
      const where = r.loop.parent ? `sub-loop of #${r.loop.parent}` : projectName(ctx, r.loop.project);
      return done(r, `Started loop #${r.loop.id}: ${r.loop.title} (${r.loop.label}, ${where})`);
    }
    case 'update': case 'edit': case 'note': {
      const id = needId(pos);
      if (typeof id !== 'string') return id;
      const edit = editFromFlags(ctx, flags);
      if ('code' in edit) return edit;
      // `afterterm loops note 12 "text"` is a shorthand for --note.
      if (cmd === 'note' && edit.note === undefined && pos.length > 2) edit.note = pos.slice(2).join(' ');
      if (!Object.keys(edit).length) return fail('Nothing to change. Give --note, --desc, --title, --label, --project or --parent.');
      const r = act({ op: 'update', id, edit });
      if ('code' in r) return r;
      return done(r, `Updated loop #${r.loop.id}: ${r.loop.title}`);
    }
    case 'ping': {
      const id = needId(pos);
      if (typeof id !== 'string') return id;
      const r = act({ op: 'ping', id });
      if ('code' in r) return r;
      return done(r, r.pinged ? `Pinged loop #${r.loop.id}: ${r.loop.title}` : `Loop #${r.loop.id} was pinged less than a day ago; nothing changed`);
    }
    case 'close': case 'done': {
      const id = needId(pos);
      if (typeof id !== 'string') return id;
      const note = typeof flags.note === 'string' ? flags.note : undefined;
      const r = act({ op: 'close', id, withSubLoops: flags['with-sub-loops'] === true, note });
      if ('code' in r) return r;
      const others = r.changed.filter((l) => l.id !== r.loop.id).map((l) => '#' + l.id);
      return done(r, `Closed loop #${r.loop.id}: ${r.loop.title}${others.length ? ` (and sub-loops ${others.join(', ')})` : ''}`);
    }
    case 'reopen': {
      const id = needId(pos);
      if (typeof id !== 'string') return id;
      const r = act({ op: 'reopen', id });
      if ('code' in r) return r;
      return done(r, `Reopened loop #${r.loop.id}: ${r.loop.title}`);
    }
    case 'archive': case 'unarchive': case 'delete': case 'restore': {
      const id = needId(pos);
      if (typeof id !== 'string') return id;
      const r = act({ op: cmd, id } as LoopAction);
      if ('code' in r) return r;
      const word = { archive: 'Archived', unarchive: 'Unarchived', delete: 'Deleted (kept 30 days)', restore: 'Restored' }[cmd];
      return done(r, `${word} loop #${r.loop.id}: ${r.loop.title}`);
    }
    default:
      return fail(`Unknown command "${pos[0]}". Run: afterterm loops help`);
  }
}

// ---------- the chat-start text ----------

// What the SessionStart hook adds to a new or resumed chat (design-07): the open
// loops of the chat's folder, and for a resumed chat the loop it was on with its
// status note. Short: at most 8 loops, each on one line.
export const BRIEF_MAX_LOOPS = 8;

export function chatStartBrief(all: readonly Loop[], ctx: LoopsContext, env: CallerEnv, now: number): string {
  const project = callerProject(ctx, env);
  const top = orderedTopLoops(all).filter((l) => l.status !== 'closed' && l.project === project);
  const mine = env.session
    ? all
        .filter((l) => !l.deletedAt && !l.archivedAt && l.chat?.sessionId === env.session)
        .sort((a, b) => b.activityAt - a.activityAt)[0]
    : undefined;
  const lines: string[] = [];
  const where = projectName(ctx, project);
  if (mine) {
    lines.push(`This chat was working on loop #${mine.id}: ${oneLine(mine.title, 80)} (${loopStatus(mine, all, now)}).`);
    if (mine.note) lines.push(`Its status note: ${oneLine(mine.note, 240)}`);
  }
  if (top.length) {
    lines.push(`Open loops in ${where} (afterterm loops), most recent first:`);
    for (const l of top.slice(0, BRIEF_MAX_LOOPS)) {
      const subs = openSubLoops(l.id, all).length;
      const note = l.note ? `: ${oneLine(l.note, 80)}` : '';
      lines.push(`- #${l.id} ${oneLine(l.title, 70)} [${l.label}, ${loopStatus(l, all, now)}${subs ? `, ${subs} open sub-loop${subs === 1 ? '' : 's'}` : ''}]${note}`);
    }
    if (top.length > BRIEF_MAX_LOOPS) lines.push(`- and ${top.length - BRIEF_MAX_LOOPS} more: afterterm loops list`);
  } else {
    lines.push(`No open loops in ${where}.`);
  }
  lines.push('Before starting a loop, check this list for one that already covers the work; update or ping it instead. See the afterterm-loops skill.');
  return lines.join('\n');
}

// Counts for a one-line summary (used by `afterterm loops` with no project).
export function countsLine(all: readonly Loop[], now: number): string {
  const c = loopCounts(all, now);
  return `${c.remaining} remaining (${c.open} open, ${c.rotting} rotting), ${c.closed} closed`;
}

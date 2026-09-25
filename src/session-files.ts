// The files a Claude Code chat changed, read from its session transcript.
//
// A session's JSONL (~/.claude/projects/<dir>/<sessionId>.jsonl, and its
// subagents' files under <sessionId>/subagents/) records every tool call with a
// timestamp. afterterm reads three things out of it for the header's Files button
// (docs/edited-files/design-04-edited-files.md):
//
//   1. every file changed with Claude's own edit tools (Edit, Write, MultiEdit,
//      NotebookEdit), with whether a Write created it
//   2. every image pasted into the chat ([Image #N], stored inline as base64)
//   3. the time windows in which the chat's shell commands (Bash, PowerShell) were
//      running, which Phase 2 uses to attribute files changed by those commands
//
// The transcript grows to tens of megabytes, so it is read incrementally: main feeds
// new lines to ingestLine as they are appended, and the state here keeps only the
// small lists. Lines that cannot matter are skipped with a substring check before
// JSON.parse, which is what keeps a first read of a 60 MB file fast.
//
// Pure: no Electron, no node imports. The renderer imports the types and fileKind.

export type FileKind = 'doc' | 'code' | 'image';

/** Documents are only these (design decision 2); everything else is code or an image. */
export const DOC_EXTENSIONS = ['.md', '.mdx', '.txt'];
/** Images Claude made are left out of the list for now (design, "Left for later"). */
export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif'];

/** The file's name after the last separator. */
export function baseName(p: string): string {
  const s = String(p ?? '').replace(/[\\/]+$/, '');
  const i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'));
  return i >= 0 ? s.slice(i + 1) : s;
}

/** The lower-case extension with its dot, or '' when there is none. A leading dot (".gitignore") is not an extension. */
export function extensionOf(p: string): string {
  const name = baseName(p);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return '';
  return name.slice(dot).toLowerCase();
}

/** Classified by extension only (design, "Where the files come from"). */
export function fileKind(p: string): FileKind {
  const ext = extensionOf(p);
  if (DOC_EXTENSIONS.includes(ext)) return 'doc';
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
  return 'code';
}

// ── paths ──────────────────────────────────────────────────────────────────

/** True for "C:\x", "C:/x", "\\server\share" and a Git Bash "/c/x". */
export function isAbsolutePath(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p) || /^\\\\/.test(p) || /^\/[A-Za-z](\/|$)/.test(p);
}

/**
 * One spelling for a Windows path: backslashes, an upper-case drive letter, no
 * "." or ".." segments, no trailing separator. A Git Bash "/c/Users" becomes
 * "C:\Users". Relative input is resolved against `base` when one is given.
 */
export function normalizePath(p: string, base?: string | null): string {
  let s = String(p ?? '').trim();
  if (!s) return '';
  const msys = /^\/([A-Za-z])(\/.*)?$/.exec(s);
  if (msys) s = `${msys[1]}:${msys[2] ?? '\\'}`;
  if (!isAbsolutePath(s) && base) s = `${String(base).replace(/[\\/]+$/, '')}\\${s}`;
  s = s.replace(/\//g, '\\');
  const unc = s.startsWith('\\\\');
  const parts = s.split('\\').filter((seg, i) => seg !== '' || (unc && i < 2));
  const out: string[] = [];
  for (const seg of parts) {
    if (seg === '.') continue;
    if (seg === '..') {
      if (out.length > 1) out.pop();
      continue;
    }
    out.push(seg);
  }
  let joined = unc ? `\\\\${out.filter(Boolean).join('\\')}` : out.join('\\');
  if (/^[a-z]:/.test(joined)) joined = joined[0].toUpperCase() + joined.slice(1);
  if (/^[A-Za-z]:$/.test(joined)) joined += '\\';
  return joined;
}

/** The comparison key for a path: normalised and lower-cased (Windows paths ignore case). */
export function pathKey(p: string, base?: string | null): string {
  return normalizePath(p, base).toLowerCase();
}

/** True when `p` is `folder` itself or inside it. Both are compared as keys. */
export function isInside(p: string, folder: string): boolean {
  const a = pathKey(p);
  const f = pathKey(folder).replace(/\\$/, '');
  if (!a || !f) return false;
  return a === f || a.startsWith(f + '\\');
}

// ── the parsed state ───────────────────────────────────────────────────────

export type ChangeSource = 'tool' | 'subagent' | 'command';

/** One file the chat changed, newest change kept. */
export interface ChangedFile {
  /** Absolute, normalised (backslashes, upper-case drive). */
  path: string;
  kind: 'doc' | 'code';
  /** True when a change by this chat created the file (a Write whose result says "create"). */
  created: boolean;
  /** When it last changed, ms since epoch. */
  at: number;
  source: ChangeSource;
}

/** One image pasted into the chat. */
export interface PastedImage {
  /** Unique within the session: the entry's uuid and the image's index in it. */
  key: string;
  /** The N of "[Image #N]". */
  n: number;
  at: number;
  mediaType: string;
  /** Length of the base64 data, used to spot one paste logged twice. */
  size: number;
  /** The folder the chat was in when it was pasted; Claude Code's temp copy is keyed by it. */
  cwd: string | null;
  /** Main only: where the line holding the base64 starts in the transcript, to decode it on demand. */
  offset: number;
  index: number;
}

/** One edit tool call, kept in order for matching an Update(...) line to its own edit (Phase 3). */
export interface EditEvent {
  path: string;
  at: number;
}

/**
 * Commands that rewrite a whole checkout rather than write the chat's work: a
 * `git checkout` would otherwise list every file it touched (Phase 2's folder
 * watch). Checked on the command's first git invocation; `git restore x` or
 * `git mv` still count.
 */
const BULK_GIT = new Set(['checkout', 'switch', 'pull', 'merge', 'rebase', 'reset', 'stash', 'clone', 'worktree', 'cherry-pick', 'am', 'fetch']);

export function isBulkCommand(command: string): boolean {
  const m = /(?:^|[;&|]\s*|\bcd\s+\S+\s*&&\s*)git(?:\s+-C\s+\S+)?\s+([a-z-]+)/.exec(String(command ?? '').trim());
  return !!m && BULK_GIT.has(m[1]);
}

/** A shell command's run, from its tool call to its result. end is null while it runs. */
export interface ShellWindow {
  start: number;
  end: number | null;
  cwd: string | null;
  /** A command that rewrites a checkout (isBulkCommand): its changes are not the chat's work. */
  bulk?: boolean;
}

interface PendingEdit {
  path: string;
  at: number;
  source: ChangeSource;
}

export interface SessionParseState {
  pendingEdits: Map<string, PendingEdit>;
  pendingShells: Map<string, ShellWindow>;
  files: Map<string, ChangedFile>;
  edits: EditEvent[];
  pasted: PastedImage[];
  windows: ShellWindow[];
  latestCwd: string | null;
}

export function newParseState(): SessionParseState {
  return {
    pendingEdits: new Map(),
    pendingShells: new Map(),
    files: new Map(),
    edits: [],
    pasted: [],
    windows: [],
    latestCwd: null,
  };
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
const TOOL_NAME_RE = /"name"\s*:\s*"(Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell)"/;
/** Enough edit events for Phase 3's time matching without growing forever. */
export const MAX_EDIT_EVENTS = 5000;
export const MAX_WINDOWS = 20000;

function timeOf(obj: Record<string, unknown>): number | null {
  const t = typeof obj.timestamp === 'string' ? Date.parse(obj.timestamp) : NaN;
  return Number.isFinite(t) ? t : null;
}

/** Cheap pre-checks, so the lines that cannot matter are never JSON-parsed. */
function lineMayMatter(line: string, state: SessionParseState): boolean {
  if (line.includes('"tool_use"') && TOOL_NAME_RE.test(line)) return true;
  if ((state.pendingEdits.size > 0 || state.pendingShells.size > 0) && line.includes('"tool_use_id"')) {
    for (const id of state.pendingEdits.keys()) if (line.includes(id)) return true;
    for (const id of state.pendingShells.keys()) if (line.includes(id)) return true;
  }
  if (line.includes('"type":"image"') && (line.includes('imagePasteIds') || line.includes('[Image #'))) return true;
  return false;
}

function recordEdit(state: SessionParseState, edit: PendingEdit, created: boolean): void {
  const kind = fileKind(edit.path);
  state.edits.push({ path: edit.path, at: edit.at });
  if (state.edits.length > MAX_EDIT_EVENTS) state.edits.splice(0, state.edits.length - MAX_EDIT_EVENTS);
  if (kind === 'image') return; // images Claude made: left out for now
  const key = edit.path.toLowerCase();
  const prev = state.files.get(key);
  state.files.set(key, {
    path: edit.path,
    kind,
    created: created || !!prev?.created,
    at: Math.max(edit.at, prev?.at ?? 0),
    // A tool edit by the chat itself outranks one its subagent made, for the record.
    source: prev?.source === 'tool' || edit.source === 'tool' ? 'tool' : edit.source,
  });
}

/** The [Image #N] numbers written in a user message's text parts, in order. */
function imageNumbersInText(content: unknown[]): number[] {
  const out: number[] = [];
  for (const part of content) {
    const p = part as { type?: unknown; text?: unknown };
    if (p?.type !== 'text' || typeof p.text !== 'string') continue;
    for (const m of p.text.matchAll(/\[Image #(\d+)\]/g)) out.push(Number(m[1]));
  }
  return out;
}

/**
 * Feed one transcript line. `offset` is where the line starts in its file (only
 * kept for pasted images); `subagent` marks a line from a subagent's own file.
 * Never throws; a line that does not parse is ignored, which is also what a
 * partial last line does until the rest of it has been written.
 */
export function ingestLine(state: SessionParseState, line: string, offset = 0, subagent = false): void {
  if (!line || !lineMayMatter(line, state)) return;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return;
  }
  if (!obj || typeof obj !== 'object') return;
  const at = timeOf(obj);
  const cwd = typeof obj.cwd === 'string' && obj.cwd ? obj.cwd : null;
  if (cwd && !subagent && obj.isSidechain !== true) state.latestCwd = cwd;
  const side = subagent || obj.isSidechain === true;
  const message = obj.message as { content?: unknown } | undefined;
  const content = Array.isArray(message?.content) ? (message!.content as unknown[]) : null;
  if (!content) return;

  if (obj.type === 'assistant' && at !== null) {
    for (const part of content) {
      const p = part as { type?: unknown; id?: unknown; name?: unknown; input?: Record<string, unknown> };
      if (p?.type !== 'tool_use' || typeof p.id !== 'string' || typeof p.name !== 'string') continue;
      if (EDIT_TOOLS.has(p.name)) {
        const raw = p.name === 'NotebookEdit' ? p.input?.notebook_path : p.input?.file_path;
        if (typeof raw !== 'string' || !raw.trim()) continue;
        const path = normalizePath(raw, cwd);
        if (!path) continue;
        state.pendingEdits.set(p.id, { path, at, source: side ? 'subagent' : 'tool' });
      } else if (SHELL_TOOLS.has(p.name)) {
        const command = typeof p.input?.command === 'string' ? p.input.command : '';
        const win: ShellWindow = { start: at, end: null, cwd, bulk: isBulkCommand(command) };
        state.pendingShells.set(p.id, win);
        state.windows.push(win);
        if (state.windows.length > MAX_WINDOWS) state.windows.splice(0, state.windows.length - MAX_WINDOWS);
      }
    }
    return;
  }

  if (obj.type !== 'user') return;

  // Tool results: an edit counts once it succeeded; a command's window closes.
  for (const part of content) {
    const p = part as { type?: unknown; tool_use_id?: unknown; is_error?: unknown };
    if (p?.type !== 'tool_result' || typeof p.tool_use_id !== 'string') continue;
    const edit = state.pendingEdits.get(p.tool_use_id);
    if (edit) {
      state.pendingEdits.delete(p.tool_use_id);
      if (p.is_error === true) continue;
      const result = obj.toolUseResult as { type?: unknown } | undefined;
      recordEdit(state, edit, !!result && typeof result === 'object' && result.type === 'create');
      continue;
    }
    const win = state.pendingShells.get(p.tool_use_id);
    if (win) {
      state.pendingShells.delete(p.tool_use_id);
      win.end = at ?? win.start;
    }
  }

  // Pasted images: only what a person pasted into the chat itself.
  if (side || at === null) return;
  const images = content
    .map((part, index) => ({ part: part as { type?: unknown; source?: { type?: unknown; media_type?: unknown; data?: unknown } }, index }))
    .filter(({ part }) => part?.type === 'image' && part.source?.type === 'base64');
  if (images.length === 0) return;
  const ids = Array.isArray(obj.imagePasteIds) && obj.imagePasteIds.every(n => typeof n === 'number')
    ? (obj.imagePasteIds as number[])
    : imageNumbersInText(content);
  const uuid = typeof obj.uuid === 'string' ? obj.uuid : `@${offset}`;
  images.forEach(({ part, index }, i) => {
    const key = `${uuid}:${index}`;
    if (state.pasted.some(img => img.key === key)) return;
    // Claude Code sometimes logs one paste twice (two entries, same [Image #N], the
    // same bytes): the same number with the same data size is the same image.
    const size = typeof part.source?.data === 'string' ? part.source.data.length : 0;
    const n = ids[i] ?? i + 1;
    if (size > 0 && state.pasted.some(img => img.n === n && img.size === size)) return;
    state.pasted.push({
      key,
      n,
      at,
      size,
      mediaType: typeof part.source?.media_type === 'string' ? part.source.media_type : 'image/png',
      cwd,
      offset,
      index,
    });
  });
}

/**
 * Ingest a whole chunk of text (tests, small files). Lines are split on "\n";
 * offsets are character offsets, which equal byte offsets only for ASCII, so main
 * uses ingestLine with real byte offsets instead.
 */
export function ingestText(state: SessionParseState, text: string, subagent = false): void {
  let offset = 0;
  for (const line of String(text ?? '').split('\n')) {
    ingestLine(state, line.replace(/\r$/, ''), offset, subagent);
    offset += line.length + 1;
  }
}

// ── the view the renderer gets ─────────────────────────────────────────────

/** What the Files button and the file links read, per session. */
export interface SessionFiles {
  /** False when no transcript was found for the session. */
  exists: boolean;
  /** Documents and code, newest change first. */
  changed: ChangedFile[];
  /** Pasted images, newest first, without the main-only offset. */
  pasted: Omit<PastedImage, 'offset' | 'index' | 'size'>[];
  /** Every edit tool call in order, for matching an Update(...) line by time. */
  edits: EditEvent[];
}

export const EMPTY_SESSION_FILES: SessionFiles = { exists: false, changed: [], pasted: [], edits: [] };

/**
 * One list from Claude's own edits and, from Phase 2, the files its commands
 * changed: one row per path, the newest time, "created" if either says so.
 */
export function mergeChanged(...lists: ChangedFile[][]): ChangedFile[] {
  const byKey = new Map<string, ChangedFile>();
  for (const list of lists) {
    for (const f of list) {
      const key = f.path.toLowerCase();
      const prev = byKey.get(key);
      if (!prev) { byKey.set(key, { ...f }); continue; }
      byKey.set(key, {
        path: f.at >= prev.at ? f.path : prev.path,
        kind: prev.kind,
        created: prev.created || f.created,
        at: Math.max(prev.at, f.at),
        source: prev.source === 'tool' || f.source === 'tool' ? 'tool' : prev.source === 'subagent' || f.source === 'subagent' ? 'subagent' : 'command',
      });
    }
  }
  return [...byKey.values()].sort((a, b) => b.at - a.at);
}

/**
 * `excludeFolders` drops files under those folders from the list (main passes
 * Claude Code's own temp folder, %TEMP%\claude, whose scratchpad scripts are the
 * chat's working files, not its work: decided 2026-09-25, docs/edited-files/phases.md).
 */
export function sessionFilesView(state: SessionParseState, commandFiles: ChangedFile[] = [], excludeFolders: string[] = []): SessionFiles {
  const keep = (f: ChangedFile) => !excludeFolders.some(folder => folder && isInside(f.path, folder));
  return {
    exists: true,
    changed: mergeChanged([...state.files.values()].filter(keep), commandFiles.filter(keep)),
    pasted: [...state.pasted]
      .sort((a, b) => b.at - a.at || b.n - a.n)
      .map(({ key, n, at, mediaType, cwd }) => ({ key, n, at, mediaType, cwd })),
    edits: [...state.edits],
  };
}

/**
 * Where Claude Code keeps its own copy of a pasted image:
 * %TEMP%\claude\<project dir of the cwd>\<sessionId>\images\<N>.png (seen on this
 * machine, undocumented, and Windows may clear it). Only the newest paste of a
 * given N can be that file: a later paste with the same number overwrote it.
 */
export function pastedTempPath(tempDir: string, projectDir: string, sessionId: string, n: number): string {
  return `${String(tempDir).replace(/[\\/]+$/, '')}\\claude\\${projectDir}\\${sessionId}\\images\\${n}.png`;
}

/** True when this paste is the newest one carrying its number, so the temp file is its own. */
export function ownsTempFile(pasted: Pick<PastedImage, 'key' | 'n' | 'at'>[], key: string): boolean {
  const me = pasted.find(p => p.key === key);
  if (!me) return false;
  return !pasted.some(p => p.key !== key && p.n === me.n && p.at > me.at);
}

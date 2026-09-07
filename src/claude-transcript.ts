// Reading a Claude Code session transcript.
//
// Claude Code writes one JSONL file per session at
//   ~/.claude/projects/<projectDirName(cwd)>/<sessionId>.jsonl
// with one JSON object per line. afterterm reads two things out of it, per thread:
//
//   1. the first real user prompt, used as the thread name until Claude sets a title
//   2. the model of the latest assistant turn, shown on the header's second line
//
// The file grows without bound (megabytes on a long session), so nothing here ever
// reads it whole: the first prompt is near the top and the current model is near the
// bottom, so we read a head chunk and a tail chunk and ignore the partial line at the
// cut. Lines that do not parse are skipped, which is exactly what a partial line does.
//
// This module is pure: no Electron, no static node imports, so the renderer can import
// modelDisplayName and the types from it. The file system is a parameter.

/** The subset of node's fs that readTranscriptMeta uses. */
export interface TranscriptFs {
  openSync(path: string, flags: string): number;
  fstatSync(fd: number): { size: number };
  readSync(fd: number, buffer: Uint8Array, offset: number, length: number, position: number): number;
  closeSync(fd: number): void;
}

export interface ClaudeSessionMeta {
  /** The first real user prompt, trimmed to one line of at most 120 characters, or null. */
  firstPrompt: string | null;
  /** The model id of the latest assistant turn (may carry a "[1m]" suffix), or null. */
  model: string | null;
  /** False when the transcript could not be opened or read at all. */
  exists: boolean;
}

/** Same shape as CLAUDE_UUID_RE in main.ts: a canonical UUID and nothing else. */
const SESSION_ID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** True when the string is a canonical session UUID, safe to build a path from. */
export function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID_RE.test(value);
}

/**
 * The folder name Claude Code gives a cwd under ~/.claude/projects: every character
 * that is not a letter or a digit becomes "-". So "D:\Pitara\Work" is
 * "D--Pitara-Work" and a space becomes a dash of its own.
 */
export function projectDirName(cwd: string): string {
  return String(cwd ?? '').replace(/[^A-Za-z0-9]/g, '-');
}

/** The transcript path for a session, joined with "/" (Windows accepts it too). */
export function transcriptPath(projectsDir: string, cwd: string, sessionId: string): string {
  const base = String(projectsDir ?? '').replace(/[\\/]+$/, '');
  return `${base}/${projectDirName(cwd)}/${sessionId}.jsonl`;
}

const MAX_PROMPT_CHARS = 120;

/** Trim, keep the first line, collapse runs of whitespace, cut to 120 characters. */
function tidyPrompt(text: string): string {
  const firstLine = text.trim().split(/\r?\n/, 1)[0] ?? '';
  const collapsed = firstLine.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= MAX_PROMPT_CHARS) return collapsed;
  return collapsed.slice(0, MAX_PROMPT_CHARS).replace(/\s+$/, '') + '…';
}

/**
 * A user line's content is either a plain string (a typed prompt) or an array of
 * parts. An array whose first part is a text part is still a prompt; an array of
 * tool_result parts is the transcript of a tool call, not something the user typed.
 */
function userText(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const first = content[0] as { type?: unknown; text?: unknown } | undefined;
    if (first && first.type === 'text' && typeof first.text === 'string') return first.text;
  }
  return null;
}

/**
 * Prompts afterterm must not show as a thread name: slash commands, and anything
 * wrapped in an XML-ish tag (command output, system reminders, pasted attachments).
 * A prompt that starts with "<" is skipped whole, which is cheap and never wrong in
 * the way a partial unwrap would be.
 */
function isNoisePrompt(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (t.startsWith('<')) return true;
  if (/^\/\w/.test(t)) return true;
  return false;
}

/**
 * The first real user prompt in the head of a transcript, or null. Sidechain lines
 * (subagent conversations), meta lines and tool results are skipped, as is a partial
 * line at either end (it fails to parse).
 */
export function firstPrompt(text: string): string | null {
  for (const line of String(text ?? '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!obj || obj.type !== 'user') continue;
    if (obj.isSidechain === true || obj.isMeta === true) continue;
    const message = obj.message as { content?: unknown } | undefined;
    const raw = userText(message?.content);
    if (raw === null || isNoisePrompt(raw)) continue;
    const tidy = tidyPrompt(raw);
    if (tidy) return tidy;
  }
  return null;
}

/** Strip a trailing context-size suffix such as "[1m]" from a model id. */
function baseModelId(id: string): string {
  return id.replace(/\[[^\]]*\]$/, '');
}

/**
 * The model to display, read from the tail of a transcript, or null.
 *
 * Two sources disagree in a useful way. An assistant line carries the model of that
 * turn but never the context-size suffix; a model attachment (written at session start
 * and after some /model switches) carries the full id including "[1m]". So the
 * assistant line decides which model, and the attachment only adds the suffix back
 * when the two are the same model.
 */
export function latestModel(text: string): string | null {
  let assistantModel: string | null = null;
  let attachmentModelId: string | null = null;

  for (const line of String(text ?? '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!obj || obj.isSidechain === true) continue;
    if (obj.type === 'assistant') {
      const message = obj.message as { model?: unknown } | undefined;
      const model = message?.model;
      if (typeof model === 'string' && model && model !== '<synthetic>') assistantModel = model;
    } else if (obj.type === 'attachment') {
      const attachment = obj.attachment as { type?: unknown; identity?: { modelId?: unknown } } | undefined;
      if (attachment?.type === 'model' && typeof attachment.identity?.modelId === 'string') {
        attachmentModelId = attachment.identity.modelId;
      }
    }
  }

  if (assistantModel) {
    if (attachmentModelId && baseModelId(attachmentModelId) === assistantModel) return attachmentModelId;
    return assistantModel;
  }
  return attachmentModelId;
}

const MODEL_FAMILIES = new Set(['opus', 'sonnet', 'haiku', 'fable']);

/**
 * A model id as a person reads it: "claude-opus-5" is "Opus 5", "claude-opus-5[1m]"
 * is "Opus 5 · 1M", "claude-fable-5-1" is "Fable 5.1". An id that does not fit the
 * shape is returned unchanged rather than mangled.
 */
export function modelDisplayName(id: string): string {
  if (typeof id !== 'string' || !id) return id;

  let work = id.trim();
  let suffix = '';
  const bracket = work.match(/\[([^\]]*)\]$/);
  if (bracket) {
    if (bracket[1].toLowerCase() === '1m') {
      suffix = ' \u00b7 1M';
      work = work.slice(0, bracket.index);
    } else {
      return id;
    }
  }

  work = work.replace(/^claude-/i, '');
  work = work.replace(/-\d{8}$/, '');

  const parts = work.split('-').filter(Boolean);
  if (parts.length === 0) return id;
  const family = parts[0].toLowerCase();
  if (!MODEL_FAMILIES.has(family)) return id;
  const version = parts.slice(1);
  if (!version.every(p => /^\d+$/.test(p))) return id;

  const name = family.charAt(0).toUpperCase() + family.slice(1);
  return (version.length ? `${name} ${version.join('.')}` : name) + suffix;
}

const CHUNK_BYTES = 256 * 1024;
const NOT_FOUND: ClaudeSessionMeta = { firstPrompt: null, model: null, exists: false };

function decode(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
}

/**
 * Read the first prompt and the current model out of one session transcript. Never
 * throws: a missing, unreadable or invalid input gives { null, null, false }.
 *
 * Only the first and last 256 KB are read, so cost does not grow with the session.
 * The sessionId is validated first, so nothing a hook file claims can build a path
 * outside the projects folder.
 */
export function readTranscriptMeta(
  projectsDir: string,
  cwd: string,
  sessionId: string,
  fsLike: TranscriptFs,
): ClaudeSessionMeta {
  if (!fsLike || typeof projectsDir !== 'string' || !projectsDir) return NOT_FOUND;
  if (typeof cwd !== 'string' || !cwd) return NOT_FOUND;
  if (!isSessionId(sessionId)) return NOT_FOUND;

  const file = transcriptPath(projectsDir, cwd, sessionId);
  let fd: number | null = null;
  try {
    fd = fsLike.openSync(file, 'r');
    const size = fsLike.fstatSync(fd).size;
    let head: string;
    let tail: string;
    if (size <= CHUNK_BYTES * 2) {
      const buf = new Uint8Array(size);
      const read = size > 0 ? fsLike.readSync(fd, buf, 0, size, 0) : 0;
      head = decode(buf.subarray(0, read));
      tail = head;
    } else {
      const headBuf = new Uint8Array(CHUNK_BYTES);
      const headRead = fsLike.readSync(fd, headBuf, 0, CHUNK_BYTES, 0);
      head = decode(headBuf.subarray(0, headRead));
      const tailBuf = new Uint8Array(CHUNK_BYTES);
      const tailRead = fsLike.readSync(fd, tailBuf, 0, CHUNK_BYTES, size - CHUNK_BYTES);
      tail = decode(tailBuf.subarray(0, tailRead));
    }
    return { firstPrompt: firstPrompt(head), model: latestModel(tail), exists: true };
  } catch {
    return NOT_FOUND;
  } finally {
    if (fd !== null) {
      try { fsLike.closeSync(fd); } catch { /* already gone */ }
    }
  }
}

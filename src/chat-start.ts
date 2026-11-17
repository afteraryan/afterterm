// `afterterm chat start` (AFT-126): an agent asks for a Claude Code chat in a project,
// and Aryan clicks Start in afterterm before anything opens.
//
// The rules, decided with Aryan on 2026-11-17 (the board on AFT-126):
// - The agent names the model; there is no default. Effort is optional.
// - The prompt comes over the pipe as text (stdin of the command). No file is written
//   by afterterm, and afterterm keeps it in memory only until the chat has it.
// - Nothing opens until Aryan clicks Start; a request nobody answers goes after 10 min.
// - The chat opens in the project's folder with `claude --session-id <id> --model <m>
//   [--effort <e>]`, so nothing in Claude Code's settings is touched. The prompt is
//   then typed into Claude's input as a bracketed paste and Enter, as Aryan would, so
//   it is his first message in the chat.
//
// Pure: no Electron, no node imports beyond types. main.ts and chat-starter.ts use it.

import { parseArgs, resolveProject, type CallerEnv, type CliReply, type LoopsContext } from './loops-cli.ts';

export const REQUEST_TTL_MS = 10 * 60 * 1000;
export const MAX_PROMPT_CHARS = 100_000;
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = typeof EFFORTS[number];
// The models offered in the Start window; the agent may name any model id Claude Code takes.
export const MODEL_CHOICES = ['haiku', 'sonnet', 'opus', 'fable'] as const;
// A model is typed into a shell, so it is held to letters, digits, dot, dash and
// underscore (an alias like opus, or a full id like claude-opus-5-5).
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const CHAT_HELP = `afterterm chat start: open a Claude Code chat in a project, after Aryan clicks Start

  afterterm chat start --project <name> --model <model> [--effort <level>] < prompt
  afterterm chat start --project <name> --model <model> --prompt "<text>"

The prompt is read from stdin (a heredoc or a pipe), or from --prompt. Never write it
to a file. --model is required: haiku, sonnet, opus, fable or a full model id.
--effort is low, medium, high, xhigh or max. Leave it out unless Aryan named one:
the request bar starts each model on its own effort and he can change it there.

Aryan sees the request in a bar at the bottom of afterterm and clicks Start or Decline. The command waits
for that (up to 10 minutes), then for the chat to get the prompt, and prints the
chat's name. Exit 0 started, 3 declined, 4 nobody answered, 1 failed.
Only ask for a chat when Aryan asked you to.
`;

// The effort each model starts on in the request bar when the agent named none
// (Aryan, 2026-11-17). Start always passes the effort the bar shows.
const START_EFFORT: Record<string, Effort> = { haiku: 'high', sonnet: 'medium', opus: 'medium', fable: 'medium' };
export function startEffort(model: string): Effort {
  const m = model.toLowerCase();
  for (const k of Object.keys(START_EFFORT)) if (m === k || m.includes(k)) return START_EFFORT[k];
  return 'medium';
}

export function isEffort(v: unknown): v is Effort {
  return typeof v === 'string' && (EFFORTS as readonly string[]).includes(v);
}
export function isModel(v: unknown): v is string {
  return typeof v === 'string' && MODEL_RE.test(v);
}

export interface ChatRequest {
  id: string;
  sessionId: string;
  projectId: string;
  projectName: string;
  folder: string;
  model: string;
  effort: Effort | null;
  prompt: string;
  /** The thread that asked, for the Start window; null when not known. */
  fromThread: string | null;
  createdAt: number;
}

// Takes out what must never reach Claude's input: every control character but tab
// and newline. ESC matters most: an ESC [201~ inside the text would end the paste
// early and the rest would be typed as keys.
export function cleanPrompt(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, '').trim();
}

/**
 * The request a `chat start` command makes, checked. `argv` is what follows
 * `afterterm`, so it starts with "chat". `stdin` is the text the command read, if any.
 */
export function chatRequestFrom(
  ctx: LoopsContext,
  env: CallerEnv,
  argv: readonly string[],
  stdin: string | undefined,
  ids: { id: string; sessionId: string },
  now: number,
): { request: ChatRequest } | { reply: CliReply } {
  const fail = (msg: string, code = 2): { reply: CliReply } => ({ reply: { code, out: '', err: msg.endsWith('\n') ? msg : msg + '\n' } });
  const args = argv[0] === 'chat' ? argv.slice(1) : argv.slice();
  const { pos, flags } = parseArgs(args);
  if (flags.help || pos[0] === 'help' || pos.length === 0) return { reply: { code: 0, out: CHAT_HELP, err: '' } };
  if (pos[0] !== 'start') return fail(`Unknown command "chat ${pos[0]}". Run: afterterm chat help`);
  const str = (k: string) => (typeof flags[k] === 'string' ? (flags[k] as string).trim() : '');

  const projectArg = str('project');
  if (!projectArg) return fail('Give --project <name>: the project the chat opens in.');
  const r = resolveProject(ctx, projectArg);
  if ('error' in r) return fail(r.error);
  if (!r.id) return fail('A chat needs a project with a folder; "general" has none.');
  const project = ctx.projects.find((p) => p.id === r.id);
  if (!project?.folder) return fail(`The project "${project?.name ?? projectArg}" has no folder.`);

  const model = str('model');
  if (!model) return fail('Give --model: haiku, sonnet, opus, fable or a full model id. There is no default.');
  if (!isModel(model)) return fail(`"${model}" is not a model name.`);
  const effortArg = str('effort');
  if (effortArg && !isEffort(effortArg)) return fail(`--effort is one of ${EFFORTS.join(', ')}.`);

  const raw = typeof flags.prompt === 'string' ? flags.prompt : stdin ?? '';
  const prompt = cleanPrompt(raw);
  if (!prompt) return fail('Give the prompt on stdin (a heredoc or a pipe) or with --prompt. Never in a file.');
  if (prompt.length > MAX_PROMPT_CHARS) return fail(`The prompt is ${prompt.length} characters; the most is ${MAX_PROMPT_CHARS}.`);
  if (!UUID_RE.test(ids.sessionId)) return fail('afterterm could not make a session id.', 1);

  return {
    request: {
      id: ids.id,
      sessionId: ids.sessionId,
      projectId: project.id,
      projectName: project.name,
      folder: project.folder,
      model,
      effort: effortArg ? (effortArg as Effort) : null,
      prompt,
      fromThread: env.thread ?? null,
      createdAt: now,
    },
  };
}

/** The line typed into the new thread's shell. Every part is checked again here. */
export function claudeCommand(sessionId: string, model: string, effort: Effort | null): string | null {
  if (!UUID_RE.test(sessionId) || !isModel(model)) return null;
  if (effort !== null && !isEffort(effort)) return null;
  return `claude --session-id ${sessionId} --model ${model}${effort ? ` --effort ${effort}` : ''}`;
}

/** The prompt as Claude Code's input receives a paste: bracketed, newlines as CR. */
export function pasteText(prompt: string): string {
  return '\x1b[200~' + cleanPrompt(prompt).replace(/\n/g, '\r') + '\x1b[201~';
}

export type ChatOutcome =
  | { kind: 'started'; name: string; projectName: string; model: string; effort: Effort | null }
  | { kind: 'declined' }
  | { kind: 'expired' }
  | { kind: 'failed'; reason: string };

export function outcomeReply(o: ChatOutcome): CliReply {
  switch (o.kind) {
    case 'started':
      return { code: 0, out: `Started a chat in ${o.projectName} (${o.model}${o.effort ? `, ${o.effort} effort` : ''}): ${o.name}\n`, err: '' };
    case 'declined':
      return { code: 3, out: '', err: 'Aryan declined. No chat was started.\n' };
    case 'expired':
      return { code: 4, out: '', err: 'Nobody answered in 10 minutes. No chat was started.\n' };
    case 'failed':
      return { code: 1, out: '', err: `The chat did not get the prompt: ${o.reason}\n` };
  }
}

// What the Start window shows and may change. The prompt rides along for display only.
export interface ChatRequestView {
  id: string;
  projectId: string;
  projectName: string;
  model: string;
  effort: Effort | null;
  prompt: string;
  fromThread: string | null;
  /** When it goes if Aryan does not answer; null while it waits behind another (AFT-135). */
  expiresAt: number | null;
}

export function requestView(r: ChatRequest, frontSince: number | null): ChatRequestView {
  return {
    id: r.id, projectId: r.projectId, projectName: r.projectName, model: r.model,
    effort: r.effort, prompt: r.prompt, fromThread: r.fromThread,
    expiresAt: frontSince === null ? null : frontSince + REQUEST_TTL_MS,
  };
}

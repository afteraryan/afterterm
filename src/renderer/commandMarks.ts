// OSC 133 prompt marks turned into "the last command entered at the prompt".
//
// Why this exists: Phase 5 needs to know the command line a user typed at a
// shell prompt, both to capture cwd-adjacent server commands ("npm start") and
// to re-run it on wake (sleepWake.ts, wakePlan). cmd.exe's injected PROMPT
// (main.ts) is extended to emit OSC 133;A before the prompt and OSC 133;B
// after it, the de facto "shell integration" sequence xterm-compatible
// terminals already parse (VS Code, iTerm2, WezTerm). Terminal/index.tsx
// registers an OSC 133 handler and calls into this module on every mark, plus
// on every Enter keypress; this module holds the resulting state machine and
// the pure text-cleaning rule, so it can be unit-tested without xterm or a PTY.
//
// The design deliberately keeps the terminal layer thin: this module never
// touches the xterm buffer itself (no DOM, no xterm import), it only takes
// plain `{ row, col }` cursor positions the caller already has and a
// `readFrom` callback the caller supplies to pull text out of the buffer. That
// keeps this pure and importable from plain Node
// (`node src/renderer/commandMarks.test.ts`).
//
// The state machine: A marks the start of a fresh prompt (nothing typed yet).
// B marks the prompt has finished rendering and the cursor is now sitting
// right after it, ready for input; that cursor position is remembered as
// `promptEnd`, the anchor Enter reads from. C and D mark that the shell itself
// says a command started or finished; either one means we are no longer
// "at a fresh, untouched prompt", the same as if Enter had already fired
// (guards against, e.g., a shell that emits C/D without ever seeing an Enter
// from this side, so a stale promptEnd cannot cause the next Enter to read a
// nonsense range).

export type Mark = 'A' | 'B' | 'C' | 'D';

/**
 * Turn what xterm hands an OSC 133 handler ("A", "B", "C", "D;0", ...) into
 * the mark it names, or null for anything else (a future mark this app does
 * not know, garbage, an empty string).
 */
export function parseOsc133(payload: string): Mark | null {
  const first = payload.charAt(0);
  return first === 'A' || first === 'B' || first === 'C' || first === 'D' ? first : null;
}

export interface CommandMarkState {
  /** True only in the window between a B mark and the next Enter/C/D. */
  atPrompt: boolean;
  /** Where the prompt ended (buffer row, absolute; column), set by B. */
  promptEnd: { row: number; col: number } | null;
}

export function initialCommandMarkState(): CommandMarkState {
  return { atPrompt: false, promptEnd: null };
}

/**
 * Apply one OSC 133 mark. `cursor` is the terminal's current cursor position
 * (row already normalised to the absolute buffer row, i.e. baseY + cursorY:
 * the terminal layer computes that, this module only stores what it is given).
 *
 * A (prompt start): a fresh prompt is being drawn, nothing has finished
 * rendering yet, so atPrompt clears and any stale promptEnd from a previous
 * prompt is dropped.
 * B (prompt end): the prompt is fully drawn and the cursor sits right after
 * it, ready for typed input; atPrompt turns on and promptEnd is stamped.
 * C (command start) / D (command finished): the shell is telling us input has
 * been handed off (a command is running or just ran), so this is no longer a
 * bare, untouched prompt; atPrompt clears the same as it does after Enter.
 */
export function onMark(state: CommandMarkState, mark: Mark, cursor: { row: number; col: number }): CommandMarkState {
  switch (mark) {
    case 'A':
      return { atPrompt: false, promptEnd: null };
    case 'B':
      return { atPrompt: true, promptEnd: { ...cursor } };
    case 'C':
    case 'D':
      return { ...state, atPrompt: false };
  }
}

/**
 * Apply an Enter keypress. `readFrom` is supplied by the caller (the terminal
 * layer, which owns the xterm buffer): given the remembered prompt-end
 * position, it returns the buffer text from there up to the current cursor,
 * with wrapped lines already joined into one string.
 *
 * Outside a captured prompt (never saw a B mark, or a C/D/Enter already
 * consumed it), there is nothing to read: the state is returned unchanged and
 * command is null. At a captured prompt, the read text is cleaned
 * (cleanCommand) and atPrompt is turned off (a second Enter right after,
 * unless a new B mark reopens it, reads nothing rather than the same command
 * again — see the "Enter twice" test).
 */
export function onEnter(
  state: CommandMarkState,
  readFrom: (from: { row: number; col: number }) => string,
): { state: CommandMarkState; command: string | null } {
  if (!state.atPrompt || !state.promptEnd) {
    return { state, command: null };
  }
  const raw = readFrom(state.promptEnd);
  return { state: { ...state, atPrompt: false }, command: cleanCommand(raw) };
}

// Strip control characters (anything below 0x20, plus DEL/0x7f) rather than
// collapsing whitespace runs: the command is kept as typed, spaces and all,
// apart from trimming both ends, so "npm  run   dev" is not silently rewritten
// into something that would not actually run the same way. Order matters:
// trim, then strip control characters, then trim again (stripping can uncover
// trailing whitespace that was hiding behind a trailing control character),
// then cap at 500 characters, matching the same limit wakePlan applies before
// re-running a command, so a captured command already fits it before it ever
// needs validating again. A command that is only control characters once
// stripped ("\x1b\x1b") ends up empty and is reported as no command at all,
// not an empty string.
const CONTROL_CHARS_RE = /[\x00-\x1f\x7f]/g;
const COMMAND_MAX_LENGTH = 500;

export function cleanCommand(text: string): string | null {
  const stripped = text.trim().replace(CONTROL_CHARS_RE, '').trim();
  if (stripped.length === 0) return null;
  return stripped.slice(0, COMMAND_MAX_LENGTH);
}

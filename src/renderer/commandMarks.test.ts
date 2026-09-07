// Unit tests for commandMarks.ts. Run directly on Node 24+ (strips types):
//   node src/renderer/commandMarks.test.ts
// Exits 0 if all pass, 1 on any failure.

import {
  parseOsc133, initialCommandMarkState, onMark, onEnter, onInput, cleanCommand,
} from './commandMarks.ts';
import type { Mark, CommandMarkState } from './commandMarks.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}
const show = (v: unknown) => JSON.stringify(v);

console.log('\ncommandMarks: parseOsc133\n');
{
  check('A parses to A', parseOsc133('A') === 'A');
  check('B parses to B', parseOsc133('B') === 'B');
  check('C parses to C', parseOsc133('C') === 'C');
  check('D parses to D', parseOsc133('D') === 'D');
  check('D;0 parses to D (only the first character matters)', parseOsc133('D;0') === 'D');
  check('B;k=i parses to B', parseOsc133('B;k=i') === 'B');
  check('garbage parses to null', parseOsc133('nope') === null);
  check('an empty string parses to null', parseOsc133('') === null);
  check('a lowercase a parses to null (case sensitive)', parseOsc133('a') === null);
  check('a digit parses to null', parseOsc133('1') === null);
}

console.log('\ncommandMarks: initialCommandMarkState\n');
{
  const s = initialCommandMarkState();
  check('starts not at a prompt', s.atPrompt === false);
  check('starts with no promptEnd', s.promptEnd === null);
  check('starts with nothing typed', s.typed === '');
}

console.log('\ncommandMarks: onMark transitions\n');
{
  const start = initialCommandMarkState();

  const afterA = onMark(start, 'A', { row: 10, col: 0 });
  check('A clears atPrompt', afterA.atPrompt === false);
  check('A clears promptEnd', afterA.promptEnd === null);

  const afterB = onMark(afterA, 'B', { row: 10, col: 4 });
  check('B sets atPrompt', afterB.atPrompt === true);
  check('B stamps promptEnd at the given cursor', afterB.promptEnd !== null
    && afterB.promptEnd.row === 10 && afterB.promptEnd.col === 4, show(afterB));

  const afterC = onMark(afterB, 'C', { row: 10, col: 12 });
  check('C clears atPrompt', afterC.atPrompt === false);
  check('C leaves promptEnd as it was (not cleared, just no longer "fresh")',
    afterC.promptEnd !== null && afterC.promptEnd.row === 10 && afterC.promptEnd.col === 4, show(afterC));

  const afterD = onMark(afterB, 'D', { row: 12, col: 0 });
  check('D clears atPrompt', afterD.atPrompt === false);
  check('D leaves promptEnd as it was',
    afterD.promptEnd !== null && afterD.promptEnd.row === 10 && afterD.promptEnd.col === 4);
}
{
  // A stale prompt (a previous B) is fully cleared by the next A, so a command
  // typed at a prompt from a stale promptEnd can never leak into a new one.
  const b = onMark(initialCommandMarkState(), 'B', { row: 5, col: 4 });
  const a2 = onMark(b, 'A', { row: 6, col: 0 });
  check('a second A clears a stale promptEnd from a previous B', a2.promptEnd === null && a2.atPrompt === false);
}
{
  // onMark does not mutate its input.
  const start = initialCommandMarkState();
  const before = { ...start };
  onMark(start, 'B', { row: 1, col: 1 });
  check('onMark does not mutate its input state', show(start) === show(before));
}

console.log('\ncommandMarks: onEnter outside the prompt\n');
{
  const notAtPrompt: CommandMarkState = { atPrompt: false, promptEnd: null, typed: '' };
  let called = false;
  const result = onEnter(notAtPrompt, () => { called = true; return 'should never be read'; });
  check('readFrom is never called when not at a prompt', called === false);
  check('command is null when not at a prompt', result.command === null);
  check('state is returned unchanged', result.state === notAtPrompt);
}
{
  // atPrompt true but promptEnd somehow null (should not happen via onMark,
  // but onEnter must not crash or read garbage if it ever does).
  const weird: CommandMarkState = { atPrompt: true, promptEnd: null, typed: '' };
  let called = false;
  const result = onEnter(weird, () => { called = true; return 'x'; });
  check('readFrom is never called when promptEnd is missing', called === false);
  check('command is null when promptEnd is missing', result.command === null);
}

console.log('\ncommandMarks: onEnter at the prompt\n');
{
  const atPrompt: CommandMarkState = { atPrompt: true, promptEnd: { row: 10, col: 4 }, typed: '' };
  let readArg: { row: number; col: number } | null = null;
  const result = onEnter(atPrompt, (from) => { readArg = from; return 'npm start  '; });
  check('readFrom is called with the remembered promptEnd', readArg !== null && (readArg as any).row === 10 && (readArg as any).col === 4);
  check('the command is cleaned (trailing whitespace trimmed)', result.command === 'npm start');
  check('atPrompt turns off after Enter', result.state.atPrompt === false);
  check('promptEnd is left in place (harmless once atPrompt is false; a new B overwrites it)',
    result.state.promptEnd !== null && result.state.promptEnd.row === 10);
}
{
  // An empty read (Enter with nothing typed) yields no command, not "".
  const atPrompt: CommandMarkState = { atPrompt: true, promptEnd: { row: 3, col: 0 }, typed: '' };
  const result = onEnter(atPrompt, () => '');
  check('an empty read yields command null', result.command === null);
  check('atPrompt still turns off', result.state.atPrompt === false);
}
{
  // A read containing control characters (e.g. a stray bell) is cleaned
  // before being reported.
  const atPrompt: CommandMarkState = { atPrompt: true, promptEnd: { row: 3, col: 0 }, typed: '' };
  const result = onEnter(atPrompt, () => 'np\x07m start');
  check('a bell character in the middle of a read is stripped', result.command === 'npm start', show(result));
}
{
  // The 500-character cap applies through onEnter too (it goes through cleanCommand).
  const atPrompt: CommandMarkState = { atPrompt: true, promptEnd: { row: 3, col: 0 }, typed: '' };
  const long = 'x'.repeat(600);
  const result = onEnter(atPrompt, () => long);
  check('a long read is capped at 500 characters', result.command?.length === 500, show(result.command?.length));
}
{
  // Enter twice in a row: the second Enter is not at the prompt any more
  // (onEnter turned atPrompt off after the first), so it reads nothing, even
  // though promptEnd is technically still sitting there from the first B.
  let state: CommandMarkState = { atPrompt: true, promptEnd: { row: 1, col: 0 }, typed: '' };
  const first = onEnter(state, () => 'npm start');
  state = first.state;
  let calledSecondTime = false;
  const second = onEnter(state, () => { calledSecondTime = true; return 'ignored'; });
  check('the first Enter returns the typed command', first.command === 'npm start');
  check('the second Enter in a row is not at the prompt', state.atPrompt === false);
  check('the second Enter reads nothing', second.command === null);
  check('readFrom is never called on the second Enter', calledSecondTime === false);
}

console.log('\ncommandMarks: onInput\n');
{
  const atPrompt: CommandMarkState = { atPrompt: true, promptEnd: { row: 1, col: 4 }, typed: '' };

  let s = onInput(atPrompt, 'n');
  s = onInput(s, 'pm');
  s = onInput(s, ' start');
  check('printable characters accumulate across chunks', s.typed === 'npm start', show(s.typed));

  const backspaced = onInput(s, '\x7f');
  check('DEL drops the last character', backspaced.typed === 'npm star', show(backspaced.typed));
  const backspaced2 = onInput(s, '\b');
  check('backspace (0x08) drops the last character too', backspaced2.typed === 'npm star', show(backspaced2.typed));
  check('backspace on empty typed text is harmless',
    onInput(atPrompt, '\x7f').typed === '', show(onInput(atPrompt, '\x7f').typed));

  check('an arrow key sequence is ignored', onInput(s, '\x1b[A').typed === 'npm start', show(onInput(s, '\x1b[A').typed));
  check('Home/End sequences are ignored', onInput(s, '\x1b[H\x1b[F').typed === 'npm start');
  check('Delete (ESC [ 3 ~) is ignored', onInput(s, '\x1b[3~').typed === 'npm start');
  check('SS3 arrows (ESC O A) are ignored, the letter does not leak in',
    onInput(s, '\x1bOA').typed === 'npm start', show(onInput(s, '\x1bOA').typed));
  check('a bare Esc is ignored', onInput(s, '\x1b').typed === 'npm start');
  check('Ctrl+C and other control characters are ignored', onInput(s, '\x03\x01').typed === 'npm start');

  // xterm emits these on tab switch when the terminal blurs and refocuses.
  check('the focus-out report (ESC [ O) is ignored',
    onInput(s, '\x1b[O').typed === 'npm start', show(onInput(s, '\x1b[O').typed));
  check('the focus-in report (ESC [ I) is ignored',
    onInput(s, '\x1b[I').typed === 'npm start', show(onInput(s, '\x1b[I').typed));

  // A bracketed paste: the markers are ordinary CSI sequences, so the body
  // between them is appended by the plain printable rule.
  const pasted = onInput(atPrompt, '\x1b[200~node server.js 48766\x1b[201~');
  check('a bracketed paste is appended as typed text',
    pasted.typed === 'node server.js 48766', show(pasted.typed));
  const typedThenPasted = onInput(onInput(atPrompt, 'node '), '\x1b[200~server.js\x1b[201~');
  check('a paste after typing appends to what was typed', typedThenPasted.typed === 'node server.js', show(typedThenPasted.typed));

  const notAtPrompt: CommandMarkState = { atPrompt: false, promptEnd: null, typed: '' };
  const ignored = onInput(notAtPrompt, 'npm start');
  check('onInput outside the prompt is a no-op', ignored === notAtPrompt && ignored.typed === '');

  const before = { ...atPrompt };
  onInput(atPrompt, 'x');
  check('onInput does not mutate its input state', show(atPrompt) === show(before));
}
{
  // A and B both start a fresh line, so both drop whatever was typed before.
  const typedSomething = onInput({ atPrompt: true, promptEnd: { row: 1, col: 4 }, typed: '' }, 'npm start');
  check('A resets typed', onMark(typedSomething, 'A', { row: 2, col: 0 }).typed === '');
  check('B resets typed', onMark(typedSomething, 'B', { row: 2, col: 4 }).typed === '');
}

console.log('\ncommandMarks: onEnter, typed text versus the buffer\n');
{
  // The bug seen in the harness on 2026-09-07: a `start /b` background server
  // printed its ready line on the prompt line, right after the B mark, while the
  // user was typing the next command. The buffer read holds both; the typed text
  // holds only the command, and the buffer ends with exactly it.
  const state: CommandMarkState = {
    atPrompt: true, promptEnd: { row: 4, col: 20 }, typed: 'node server.js 48766',
  };
  const result = onEnter(state, () => 'tiny-server ready on http://localhost:48767node server.js 48766');
  check('stray output printed on the prompt line is dropped in favour of the typed text',
    result.command === 'node server.js 48766', show(result.command));
  check('Enter resets typed', result.state.typed === '', show(result.state.typed));
}
{
  // Tab completion: the shell finished the word, so the buffer does not end with
  // what was typed and the buffer is the only correct answer.
  const state: CommandMarkState = { atPrompt: true, promptEnd: { row: 1, col: 4 }, typed: 'npm st' };
  const result = onEnter(state, () => 'npm start');
  check('tab completion keeps the buffer', result.command === 'npm start', show(result.command));
}
{
  // History recall (the up arrow) types nothing at all, yet the buffer holds the
  // whole recalled command.
  const state: CommandMarkState = { atPrompt: true, promptEnd: { row: 1, col: 4 }, typed: '' };
  const result = onEnter(state, () => 'npm start');
  check('history recall (nothing typed) keeps the buffer', result.command === 'npm start', show(result.command));
}
{
  // An edit made in the middle with the arrow keys: the buffer does not end with
  // the typed sequence, so the buffer wins.
  const state: CommandMarkState = { atPrompt: true, promptEnd: { row: 1, col: 4 }, typed: 'npm startdev' };
  const result = onEnter(state, () => 'npm run dev');
  check('a command edited in the middle keeps the buffer', result.command === 'npm run dev', show(result.command));
}
{
  // The ordinary case: nothing else printed, so the two agree and the buffer path
  // is taken (it is not longer than the typed text).
  const state: CommandMarkState = { atPrompt: true, promptEnd: { row: 1, col: 4 }, typed: 'npm start' };
  const result = onEnter(state, () => 'npm start');
  check('a buffer equal to the typed text is used as is', result.command === 'npm start', show(result.command));
}
{
  const state: CommandMarkState = { atPrompt: true, promptEnd: { row: 1, col: 4 }, typed: 'npm start  ' };
  const result = onEnter(state, () => 'noise npm start  ');
  check('trailing spaces in the typed text are trimmed before comparing and reporting',
    result.command === 'npm start', show(result.command));
}
{
  // A buffer shorter than the typed text cannot end with it (and would be a
  // nonsense read anyway), so the buffer wins.
  const state: CommandMarkState = { atPrompt: true, promptEnd: { row: 1, col: 4 }, typed: 'npm start' };
  const result = onEnter(state, () => 'npm');
  check('a buffer shorter than the typed text keeps the buffer', result.command === 'npm', show(result.command));
}
{
  // Nothing typed and nothing in the buffer stays "no command", the typed rule
  // never invents one.
  const state: CommandMarkState = { atPrompt: true, promptEnd: { row: 1, col: 4 }, typed: 'npm start' };
  const result = onEnter(state, () => '');
  check('an empty buffer read is still no command, even with typed text', result.command === null, show(result.command));
}

console.log('\ncommandMarks: cleanCommand\n');
{
  check('trims both ends', cleanCommand('  npm start  ') === 'npm start');
  check('keeps internal whitespace exactly as typed (no collapsing)', cleanCommand('npm  run   dev') === 'npm  run   dev');
  check('an empty string is null', cleanCommand('') === null);
  check('a whitespace-only string is null', cleanCommand('   ') === null);
  check('control characters are stripped', cleanCommand('np\x07m\x01 start') === 'npm start');
  check('a string of only control characters is null', cleanCommand('\x1b\x1b\x07') === null);
  check('CR/LF are stripped (no multi-line smuggling)', cleanCommand('npm start\r\nrm -rf /') === 'npm startrm -rf /');
  check('DEL (0x7f) is stripped', cleanCommand('npm start\x7f') === 'npm start');
  check('exactly 500 characters is kept whole', cleanCommand('x'.repeat(500)).length === 500);
  check('501 characters is capped to 500', cleanCommand('x'.repeat(501)).length === 500);
  check('a normal short command is returned as is', cleanCommand('npm start') === 'npm start');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);

// Unit tests for commandMarks.ts. Run directly on Node 24+ (strips types):
//   node src/renderer/commandMarks.test.ts
// Exits 0 if all pass, 1 on any failure.

import {
  parseOsc133, initialCommandMarkState, onMark, onEnter, cleanCommand,
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
  const notAtPrompt: CommandMarkState = { atPrompt: false, promptEnd: null };
  let called = false;
  const result = onEnter(notAtPrompt, () => { called = true; return 'should never be read'; });
  check('readFrom is never called when not at a prompt', called === false);
  check('command is null when not at a prompt', result.command === null);
  check('state is returned unchanged', result.state === notAtPrompt);
}
{
  // atPrompt true but promptEnd somehow null (should not happen via onMark,
  // but onEnter must not crash or read garbage if it ever does).
  const weird: CommandMarkState = { atPrompt: true, promptEnd: null };
  let called = false;
  const result = onEnter(weird, () => { called = true; return 'x'; });
  check('readFrom is never called when promptEnd is missing', called === false);
  check('command is null when promptEnd is missing', result.command === null);
}

console.log('\ncommandMarks: onEnter at the prompt\n');
{
  const atPrompt: CommandMarkState = { atPrompt: true, promptEnd: { row: 10, col: 4 } };
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
  const atPrompt: CommandMarkState = { atPrompt: true, promptEnd: { row: 3, col: 0 } };
  const result = onEnter(atPrompt, () => '');
  check('an empty read yields command null', result.command === null);
  check('atPrompt still turns off', result.state.atPrompt === false);
}
{
  // A read containing control characters (e.g. a stray bell) is cleaned
  // before being reported.
  const atPrompt: CommandMarkState = { atPrompt: true, promptEnd: { row: 3, col: 0 } };
  const result = onEnter(atPrompt, () => 'np\x07m start');
  check('a bell character in the middle of a read is stripped', result.command === 'npm start', show(result));
}
{
  // The 500-character cap applies through onEnter too (it goes through cleanCommand).
  const atPrompt: CommandMarkState = { atPrompt: true, promptEnd: { row: 3, col: 0 } };
  const long = 'x'.repeat(600);
  const result = onEnter(atPrompt, () => long);
  check('a long read is capped at 500 characters', result.command?.length === 500, show(result.command?.length));
}
{
  // Enter twice in a row: the second Enter is not at the prompt any more
  // (onEnter turned atPrompt off after the first), so it reads nothing, even
  // though promptEnd is technically still sitting there from the first B.
  let state: CommandMarkState = { atPrompt: true, promptEnd: { row: 1, col: 0 } };
  const first = onEnter(state, () => 'npm start');
  state = first.state;
  let calledSecondTime = false;
  const second = onEnter(state, () => { calledSecondTime = true; return 'ignored'; });
  check('the first Enter returns the typed command', first.command === 'npm start');
  check('the second Enter in a row is not at the prompt', state.atPrompt === false);
  check('the second Enter reads nothing', second.command === null);
  check('readFrom is never called on the second Enter', calledSecondTime === false);
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

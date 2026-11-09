// A stand-in for an Ink app (Claude Code's TUI is built on Ink), used to test
// whether a terminal resize makes a program's block appear twice in afterterm.
// No dependencies: run it with `node ink-like.mjs` in a cmd thread.
//
// What it copies from Ink (ink/src/log-update.ts and ink/src/ink.tsx):
// - The program wraps its own text to the terminal's width (process.stdout.columns)
//   and ends every row with a newline, so it never relies on the terminal's autowrap.
// - It owns the block at the bottom of the screen. To redraw, it erases the rows it
//   believes it wrote (ansi-escapes eraseLines: erase line, cursor up, repeated) and
//   writes the block again. The count is the number of newlines it wrote last time,
//   at the old width.
// - It redraws when the terminal reports a new size (process.stdout 'resize'). On
//   Windows Node only raises it while stdin is being read in raw mode (libuv sees the
//   console's buffer-size input record), which is also how Ink reads its keys, so the
//   script reads stdin raw too. Ctrl+C or q ends it.
// - With `--tall`, when the block is taller than the screen it does what Ink does on
//   Windows in that case: ansi-escapes clearTerminal, which on Windows is only
//   ESC[2J ESC[0f (no ESC[3J, so the scrollback is not cleared), then everything it
//   has ever printed (Ink's fullStaticOutput) and the block.
//
// Every redraw is numbered ("render #N at COLSxROWS"), so a copy left behind in the
// scrollback can be told apart from the live one.

const ESC = '\x1b[';
const tall = process.argv.includes('--tall');

const PARAGRAPHS = [
  '- Each role could see and do only what it should, including read-only access for the Client Admin and both REVY roles.',
  '- Choosing a day that already has a reading opens that reading.',
  '- A disabled plant blocks new readings.',
  '1. A supervisor who sends a reading back cannot say why. The operator only sees "fix it". I would add an optional reason.',
  '2. In the operator\'s list, a sent-back reading looks like any other draft. The "sent back" note also disappears from its history once resubmitted.',
  '3. When a supervisor corrects a value, the operator\'s original value is lost with no record. I would keep a list of corrections on the reading.',
  '4. The long text boxes stop at 200 characters with no sign of a limit. I would raise it to 1000 and show a counter.',
];

function wrap(text, width) {
  const out = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && (line + ' ' + word).length > width) { out.push(line); line = '  ' + word; }
    else line = line ? line + ' ' + word : word;
  }
  if (line) out.push(line);
  return out;
}

const STATIC = 'STATIC header: printed once, before the block. The block below is redrawn on every resize.\n';
let renders = 0;
let previousLineCount = 0;

function eraseLines(count) {
  let s = '';
  for (let i = 0; i < count; i++) s += ESC + '2K' + (i < count - 1 ? ESC + '1A' : '');
  if (count) s += ESC + 'G';
  return s;
}

function block() {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  renders += 1;
  const lines = [`=== render #${renders} at ${cols}x${rows} ===`];
  const width = Math.max(20, cols - 2);
  for (const p of PARAGRAPHS) lines.push(...wrap(p, width));
  if (tall) for (let i = 1; i <= rows; i++) lines.push(`filler row ${i} of render #${renders}`);
  lines.push(`=== end of render #${renders} ===`);
  return lines.join('\n') + '\n';
}

function render() {
  const output = block();
  const rows = process.stdout.rows || 24;
  const height = output.split('\n').length - 1;
  if (tall && height >= rows) {
    // Ink, outputHeight >= stdout.rows: clearTerminal + fullStaticOutput + output.
    process.stdout.write(ESC + '2J' + ESC + '0f' + STATIC + output);
  } else {
    process.stdout.write(eraseLines(previousLineCount) + output);
  }
  previousLineCount = output.split('\n').length;
}

process.stdout.write(STATIC);
render();
process.stdout.on('resize', render);
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on('data', (d) => {
  const key = d.toString();
  if (key === '\x03' || key === 'q') { process.stdout.write('\n'); process.exit(0); }
});

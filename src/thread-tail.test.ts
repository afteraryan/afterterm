// Unit tests for the scrollback tail format. Run directly on Node 24+ (strips types):
//   node src/thread-tail.test.ts
// Exits 0 if all pass, 1 on any failure.
//
// Everything here is pure string work, so there is no file system and no Electron:
// the cases are the format contract between the main process (which writes the file)
// and the renderer (which replays it into a fresh xterm).

import path from 'node:path';
import {
  TAIL_MAX_BYTES,
  TAIL_MAX_LINES,
  isThreadId,
  parseTail,
  renderTailForTerminal,
  serializeTail,
  tailFilePath,
  trimTail,
} from './thread-tail.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}
const show = (v: unknown) => JSON.stringify(v);

const DIM = '\x1b[2;90m';
const RESET = '\x1b[0m';

console.log('\nthread-tail: constants and paths\n');
{
  check('the line cap is 200', TAIL_MAX_LINES === 200, show(TAIL_MAX_LINES));
  check('the byte cap is 64 KB', TAIL_MAX_BYTES === 64 * 1024, show(TAIL_MAX_BYTES));
  check('a tail file is <dir>/<id>.txt',
    tailFilePath(path.join('C:', 'data', 'threads'), 'tab-12')
      === path.join('C:', 'data', 'threads', 'tab-12.txt'),
    tailFilePath('x', 'tab-12'));
}

console.log('\nthread-tail: isThreadId\n');
{
  check('a normal tab id is accepted', isThreadId('tab-12'));
  check('underscores and digits are accepted', isThreadId('tab_12_A'));
  check('64 characters are accepted', isThreadId('a'.repeat(64)));
  check('65 characters are rejected', !isThreadId('a'.repeat(65)));
  check('an empty string is rejected', !isThreadId(''));
  check('".." is rejected', !isThreadId('..'));
  check('a forward slash is rejected', !isThreadId('a/b'));
  check('a backslash is rejected', !isThreadId('a\\b'));
  check('a dot in the name is rejected', !isThreadId('tab.12'));
  check('a number is rejected', !isThreadId(12));
  check('null is rejected', !isThreadId(null));
  check('undefined is rejected', !isThreadId(undefined));
  check('an object is rejected', !isThreadId({ toString: () => 'tab-1' }));
}

console.log('\nthread-tail: trimTail\n');
{
  const many = Array.from({ length: 500 }, (_, i) => `line ${i}`);
  const kept = trimTail(many);
  check('only the last 200 lines are kept', kept.length === 200, show(kept.length));
  check('the last line survives', kept[kept.length - 1] === 'line 499', show(kept[kept.length - 1]));
  check('the first kept line is the 200th from the end', kept[0] === 'line 300', show(kept[0]));

  const smallCap = trimTail(many, 5);
  check('a custom line cap is honoured',
    smallCap.length === 5 && smallCap[0] === 'line 495', show(smallCap));

  check('trailing whitespace is stripped',
    trimTail(['a   ', 'b\t'])[0] === 'a' && trimTail(['a   ', 'b\t'])[1] === 'b',
    show(trimTail(['a   ', 'b\t'])));

  const withBlanks = trimTail(['one', 'two', '', '   ', '']);
  check('trailing empty lines are dropped',
    withBlanks.length === 2 && withBlanks[1] === 'two', show(withBlanks));

  const innerBlank = trimTail(['one', '', 'two']);
  check('a blank line in the middle is kept',
    innerBlank.length === 3 && innerBlank[1] === '', show(innerBlank));

  check('an all-blank tail becomes empty', trimTail(['', '  ', '\t']).length === 0);
  check('an empty array stays empty', trimTail([]).length === 0);

  // Byte cap: 10 lines of 100 bytes, capped at 250 bytes, keeps the newest two
  // (101 bytes each once the newline is counted).
  const fat = Array.from({ length: 10 }, (_, i) => String(i) + 'x'.repeat(99));
  const capped = trimTail(fat, 100, 250);
  check('the byte cap drops lines from the front',
    capped.length === 2 && capped[1] === fat[9], show(capped.map(l => l.slice(0, 3))));
  check('the kept bytes are within the cap',
    Buffer.byteLength(serializeTail(capped), 'utf-8') <= 250,
    show(Buffer.byteLength(serializeTail(capped), 'utf-8')));

  check('multi-byte characters count as their UTF-8 size',
    trimTail(['é'.repeat(50), 'ok'], 100, 10).join('|') === 'ok',
    show(trimTail(['é'.repeat(50), 'ok'], 100, 10)));
  check('a single line larger than the cap yields nothing',
    trimTail(['x'.repeat(100)], 100, 10).length === 0);

  check('a non-array gives an empty tail',
    trimTail(null as unknown as string[]).length === 0);
  check('non-string entries are coerced, not thrown on',
    trimTail([1, null, 'ok'] as unknown as string[]).join('|') === '1||ok',
    show(trimTail([1, null, 'ok'] as unknown as string[])));
}

console.log('\nthread-tail: serialize and parse\n');
{
  const lines = ['$ npm test', '12 passed, 0 failed', '', 'C:\\repo>'];
  const text = serializeTail(lines);
  check('the body ends in a newline', text.endsWith('\n'), show(text.slice(-3)));
  check('the round trip is exact',
    JSON.stringify(parseTail(text)) === JSON.stringify(lines), show(parseTail(text)));

  check('an empty tail round trips to empty',
    parseTail(serializeTail([])).length === 0, show(parseTail(serializeTail([]))));

  check('CRLF in the file is handled',
    JSON.stringify(parseTail('a\r\nb\r\n')) === JSON.stringify(['a', 'b']),
    show(parseTail('a\r\nb\r\n')));

  check('a leading BOM is stripped',
    JSON.stringify(parseTail('\uFEFFa\nb\n')) === JSON.stringify(['a', 'b']),
    show(parseTail('\uFEFFa\nb\n')));

  check('a BOM-only file gives no lines', parseTail('\uFEFF').length === 0);
  check('an empty file gives no lines', parseTail('').length === 0);
  check('a non-string gives no lines', parseTail(null as unknown as string).length === 0);
  check('a file with no final newline keeps its last line',
    JSON.stringify(parseTail('a\nb')) === JSON.stringify(['a', 'b']), show(parseTail('a\nb')));
}

console.log('\nthread-tail: renderTailForTerminal\n');
{
  const out = renderTailForTerminal(['one', 'two'], 'Woke just now', 80);
  check('the output ends with a blank line under the divider',
    out.endsWith('\r\n\r\n'), show(out.slice(-8)));

  const rows = out.slice(0, -4).split('\r\n');
  check('two content lines plus a divider', rows.length === 3, show(rows.length));
  check('the first content line is wrapped in dim grey',
    rows[0] === `${DIM}one${RESET}`, show(rows[0]));
  check('the second content line is wrapped in dim grey',
    rows[1] === `${DIM}two${RESET}`, show(rows[1]));
  check('the divider carries the label', rows[2].includes('Woke just now'), show(rows[2]));
  check('the divider is dim grey too',
    rows[2].startsWith(DIM) && rows[2].endsWith(RESET), show(rows[2]));

  const divider = rows[2].slice(DIM.length, rows[2].length - RESET.length);
  check('the divider is exactly cols wide', divider.length === 80, show(divider.length));
  check('the divider is made of box-drawing dashes',
    divider.startsWith('───') && divider.endsWith('───'), show(divider.slice(0, 5)));

  const wide = renderTailForTerminal([], 'Woke just now', 120);
  const wideDivider = wide.slice(DIM.length, wide.indexOf(RESET));
  check('a wider terminal gives a wider divider', wideDivider.length === 120, show(wideDivider.length));

  check('an empty tail renders only the divider block',
    wide.split('\r\n').filter(r => r.length > 0).length === 1, show(wide.split('\r\n').length));
  check('an empty tail still ends with the blank line', wide.endsWith('\r\n\r\n'));

  // A narrow terminal must not eat the label; it overflows instead.
  const narrow = renderTailForTerminal([], 'Woke just now', 10);
  check('a narrow terminal keeps the whole label', narrow.includes('Woke just now'), show(narrow));
  const narrowDivider = narrow.slice(DIM.length, narrow.indexOf(RESET));
  check('a narrow divider keeps three dashes each side',
    narrowDivider.startsWith('─── ') && narrowDivider.endsWith(' ───'), show(narrowDivider));

  const custom = renderTailForTerminal(['x'], 'Asleep since Tuesday', 80);
  check('a custom label is used', custom.includes('Asleep since Tuesday'), show(custom));

  check('the defaults are the wake case',
    renderTailForTerminal([]).includes('Woke just now'), show(renderTailForTerminal([])));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);

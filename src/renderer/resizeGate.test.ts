// Unit tests for resizeGate.ts. Run directly on Node 24+ (strips types):
//   node src/renderer/resizeGate.test.ts
// Exits 0 if all pass, 1 on any failure.

import { initialResizeGate, sameSize, onTerminalResize, onHoldChange, spawnSize, isMeasured, ptySizeFrom } from './resizeGate.ts';
import type { ResizeGate, PtySize } from './resizeGate.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}
const show = (v: unknown) => JSON.stringify(v);
const size = (cols: number, rows: number): PtySize => ({ cols, rows });

console.log('\nresizeGate: sameSize\n');
{
  check('equal sizes are the same', sameSize(size(80, 24), size(80, 24)));
  check('a different width is not', !sameSize(size(80, 24), size(81, 24)));
  check('a different height is not', !sameSize(size(80, 24), size(80, 25)));
  check('nothing is never the same as a size', !sameSize(null, size(80, 24)) && !sameSize(size(80, 24), null));
}

console.log('\nresizeGate: a resize to the size the PTY already has is not sent\n');
{
  const g = initialResizeGate(size(112, 42));
  const r = onTerminalResize(g, size(112, 42));
  check('the spawn size is not sent again', r.send === null, show(r));
  const r2 = onTerminalResize(r.gate, size(145, 42));
  check('a new width is sent', sameSize(r2.send, size(145, 42)), show(r2));
  check('and becomes the PTY size', sameSize(r2.gate.sent, size(145, 42)), show(r2.gate));
  const r3 = onTerminalResize(r2.gate, size(145, 42));
  check('the same size twice in a row is sent once', r3.send === null, show(r3));
  const r4 = onTerminalResize(r3.gate, size(145, 30));
  check('a new height alone is sent', sameSize(r4.send, size(145, 30)), show(r4));
}

console.log('\nresizeGate: a gate made before its PTY size is known sends the first size\n');
{
  const g = initialResizeGate(null);
  const r = onTerminalResize(g, size(80, 24));
  check('the first size is sent', sameSize(r.send, size(80, 24)), show(r));
}

console.log('\nresizeGate: a window edge drag sends one resize, at its end\n');
{
  let g: ResizeGate = initialResizeGate(size(112, 42));
  let sends = 0;
  const step = (r: { gate: ResizeGate; send: PtySize | null }) => { g = r.gate; if (r.send) sends++; return r; };
  step(onHoldChange(g, true));
  check('starting the drag sends nothing', sends === 0);
  for (const cols of [106, 101, 95, 89, 83, 77]) step(onTerminalResize(g, size(cols, 42)));
  check('six sizes during the drag send nothing', sends === 0, show(g));
  check('the newest one is kept', sameSize(g.pending, size(77, 42)), show(g));
  check('the PTY still has its old size', sameSize(g.sent, size(112, 42)), show(g));
  const end = step(onHoldChange(g, false));
  check('ending the drag sends the newest size once', sends === 1 && sameSize(end.send, size(77, 42)), show(end));
  check('and it becomes the PTY size', sameSize(g.sent, size(77, 42)) && !g.held && g.pending === null, show(g));
}

console.log('\nresizeGate: a drag that ends where it started sends nothing\n');
{
  let g: ResizeGate = initialResizeGate(size(112, 42));
  g = onHoldChange(g, true).gate;
  g = onTerminalResize(g, size(100, 42)).gate;
  g = onTerminalResize(g, size(112, 42)).gate;
  const end = onHoldChange(g, false);
  check('back to the PTY size: nothing sent', end.send === null, show(end));
  check('the gate is open again', !end.gate.held && end.gate.pending === null, show(end.gate));
}

console.log('\nresizeGate: a drag with no size change sends nothing\n');
{
  let g: ResizeGate = initialResizeGate(size(112, 42));
  g = onHoldChange(g, true).gate;
  const end = onHoldChange(g, false);
  check('nothing pending: nothing sent', end.send === null, show(end));
}

console.log('\nresizeGate: a gate made during a drag waits for its end\n');
{
  let g: ResizeGate = initialResizeGate(size(80, 24), true);
  const r = onTerminalResize(g, size(112, 42));
  check('held from the start: nothing sent', r.send === null, show(r));
  g = r.gate;
  const end = onHoldChange(g, false);
  check('sent at the end', sameSize(end.send, size(112, 42)), show(end));
}

console.log('\nresizeGate: sizes are copied, not shared\n');
{
  const s = size(90, 30);
  const r = onTerminalResize(initialResizeGate(null), s);
  s.cols = 10;
  check('changing the caller object later does not change the gate', r.gate.sent?.cols === 90, show(r.gate));
}

console.log('\nresizeGate: spawnSize\n');
{
  const current = size(80, 24);
  check('a measured size wins', sameSize(spawnSize(size(112, 42), size(145, 42), current), size(112, 42)));
  check('no measurement: the hint', sameSize(spawnSize(undefined, size(145, 42), current), size(145, 42)));
  check('no measurement, no hint: the current size', sameSize(spawnSize(undefined, undefined, current), size(80, 24)));
  check('a zero measurement (hidden container) is no measurement', sameSize(spawnSize(size(0, 0), size(145, 42), current), size(145, 42)));
  check('a zero hint is no hint', sameSize(spawnSize(undefined, size(0, 42), current), size(80, 24)));
  check('NaN from a hidden container is no measurement',
    sameSize(spawnSize(size(NaN, NaN), size(145, 42), current), size(145, 42)));
  check('NaN with no hint: the current size', sameSize(spawnSize(size(NaN, NaN), undefined, current), size(80, 24)));
}

console.log('\nresizeGate: isMeasured (what FitAddon answers for a hidden terminal)\n');
{
  check('a real size is measured', isMeasured(size(112, 42)));
  check('undefined (no cell size yet) is not', !isMeasured(undefined));
  check('null is not', !isMeasured(null));
  check('NaN columns and rows (container width "auto") are not', !isMeasured(size(NaN, NaN)));
  check('NaN rows alone are not', !isMeasured(size(112, NaN)));
  check('zero columns are not', !isMeasured(size(0, 42)));
  check('Infinity is not', !isMeasured(size(Infinity, 42)));
  check('missing fields are not', !isMeasured({}));
  check('an attach answer without a size is not', !isMeasured({ cols: undefined, rows: undefined }));
}

console.log('\nresizeGate: ptySizeFrom (the gate starts from what main spawned)\n');
{
  check('main\'s answer wins', sameSize(ptySizeFrom(size(120, 40), size(112, 42)), size(120, 40)));
  check('no size in the answer: the size asked for', sameSize(ptySizeFrom({}, size(112, 42)), size(112, 42)));
  check('no answer at all: the size asked for', sameSize(ptySizeFrom(undefined, size(112, 42)), size(112, 42)));
  // Asked for more than main allows (over 2000 columns): main spawns at 80x24 and says
  // so. Seeded from the answer, the gate sends the terminal's size; seeded from what was
  // asked, it would drop that size for good as "the size the PTY already has".
  const asked = size(2500, 50);
  const g = initialResizeGate(ptySizeFrom(size(80, 24), asked));
  check('an out-of-range ask seeds the gate with main\'s 80x24', sameSize(g.sent, size(80, 24)), show(g));
  const r = onTerminalResize(g, asked);
  check('so the terminal\'s real size is still sent', sameSize(r.send, asked), show(r));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

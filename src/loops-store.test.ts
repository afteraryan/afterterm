// Unit tests for the loops store's file handling. Run directly on Node 24+:
//   node src/loops-store.test.ts
// Uses a temp folder; never touches userData.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LoopsStore, loadLoopsFile } from './loops-store.ts';
import { DAY_MS, LoopError } from './loops.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loops-store-'));
const user = { kind: 'user' } as const;
const agent = { kind: 'agent', chat: { threadId: 't9', sessionId: 'sess' } } as const;

console.log('\nloops-store\n');
{
  const s = new LoopsStore(dir);
  check('a missing file starts empty', s.list().length === 0 && s.loadNote === null);
  let heard = 0;
  s.onChange(() => heard++);
  const r = s.apply({ op: 'new', loop: { title: 'First', label: 'bug', project: 'g1' } }, agent);
  check('new gives id 1', r.loop.id === '1');
  check('listeners hear a change', heard === 1);
  s.apply({ op: 'new', loop: { title: 'Sub', parent: '1' } }, agent);
  let refused = false;
  try { s.apply({ op: 'close', id: '1' }, agent); } catch (e) { refused = e instanceof LoopError && e.code === 'open-sub-loops'; }
  check('the parent-close rule reaches the store', refused);
  check('a refused change is not heard', heard === 2);
  s.saveNow();
  const again = new LoopsStore(dir);
  check('saved and read back', again.list().length === 2 && again.get('1')?.label === 'bug' && again.get('1')?.chat?.sessionId === 'sess');
  check('the next id survives', again.apply({ op: 'new', loop: { title: 'Third' } }, user).loop.id === '3');
  again.saveNow();
  check('no tmp file left behind', !fs.existsSync(path.join(dir, 'loops.json.tmp')));
}

console.log('\nloops-store: a broken file is kept\n');
{
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'loops-bad-'));
  fs.writeFileSync(path.join(d2, 'loops.json'), '{ not json');
  const r = loadLoopsFile(path.join(d2, 'loops.json'));
  check('starts empty', r.data.loops.length === 0);
  check('says why', !!r.note && r.note.includes('did not parse'));
  const aside = fs.readdirSync(d2).filter((f) => f.startsWith('loops.bad-'));
  check('the broken file is moved aside, not overwritten', aside.length === 1 && fs.readFileSync(path.join(d2, aside[0]), 'utf8') === '{ not json');
  fs.rmSync(d2, { recursive: true, force: true });
}

console.log('\nloops-store: purge on load\n');
{
  const d3 = fs.mkdtempSync(path.join(os.tmpdir(), 'loops-purge-'));
  const t0 = Date.now() - 40 * DAY_MS;
  const s = new LoopsStore(d3, t0);
  s.apply({ op: 'new', loop: { title: 'old' } }, user, t0);
  s.apply({ op: 'new', loop: { title: 'keep' } }, user, t0);
  s.apply({ op: 'delete', id: '1' }, user, t0);
  s.saveNow();
  const later = new LoopsStore(d3);
  check('a loop deleted 40 days ago is gone on load', later.list().map((l) => l.title).join() === 'keep');
  later.flush();
  fs.rmSync(d3, { recursive: true, force: true });
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

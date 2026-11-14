// Unit tests for the activity store (design-07, AFT-97): the backfill, reading only
// what was appended, deduplication, quitting mid-backfill and the file rules. Run
// directly on Node 24+:
//   node src/activity-store.test.ts
// Uses temp folders and synthetic transcripts; never touches userData or ~/.claude.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ActivityStore, ACTIVITY_FILE, loadActivityFile } from './activity-store.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-store-'));
let n = 0;
function uuid(i: number) { return `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`; }
/** A typed user line on a local day at noon. */
function typed(i: number, day: string, hour = 12) {
  const [y, m, d] = day.split('-').map(Number);
  return JSON.stringify({
    parentUuid: null, isSidechain: false, type: 'user', message: { role: 'user', content: `msg ${i}` },
    uuid: uuid(i), timestamp: new Date(y, m - 1, d, hour).toISOString(), userType: 'external',
  });
}
const noise = [
  JSON.stringify({ type: 'assistant', uuid: 'a1', timestamp: new Date().toISOString(), message: { content: [{ type: 'text', text: 'x' }] } }),
  JSON.stringify({ type: 'user', isSidechain: false, uuid: uuid(900), timestamp: new Date(2026, 10, 1).toISOString(), message: { content: [{ type: 'tool_result', content: 'ok' }] } }),
  JSON.stringify({ type: 'user', isSidechain: true, uuid: uuid(901), timestamp: new Date(2026, 10, 1).toISOString(), message: { content: 'sub' } }),
  JSON.stringify({ type: 'user', isMeta: true, uuid: uuid(902), timestamp: new Date(2026, 10, 1).toISOString(), message: { content: 'meta' } }),
  'not json at all',
];

function setup(): { data: string; projects: string } {
  const root = path.join(tmp, `case-${++n}`);
  const projects = path.join(root, 'projects');
  fs.mkdirSync(path.join(projects, 'D--a'), { recursive: true });
  fs.mkdirSync(path.join(projects, 'D--b'), { recursive: true });
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  return { data: path.join(root, 'data'), projects };
}
const store = (c: { data: string; projects: string }, extra = {}) =>
  new ActivityStore({ dataDir: c.data, projectsDir: () => c.projects, saveDebounceMs: 5, emitEveryMs: 0, ...extra });
const write = (file: string, lines: string[], ending = '\n') => fs.writeFileSync(file, lines.join('\n') + ending);
const append = (file: string, text: string) => fs.appendFileSync(file, text);
const total = (s: ActivityStore) => Object.values(s.get().days).reduce((a, b) => a + b, 0);

console.log('\nactivity-store: the backfill\n');
{
  const c = setup();
  write(path.join(c.projects, 'D--a', 's1.jsonl'), [typed(1, '2026-11-01'), ...noise, typed(2, '2026-11-01'), typed(3, '2026-11-02')]);
  // A resumed session copies the earlier lines into a new file.
  write(path.join(c.projects, 'D--b', 's2.jsonl'), [typed(1, '2026-11-01'), typed(2, '2026-11-01'), typed(4, '2026-11-03')]);
  // Subagent files hold only sidechain turns and are not read; a typed-looking line
  // here proves it.
  fs.mkdirSync(path.join(c.projects, 'D--a', 's1', 'subagents'), { recursive: true });
  write(path.join(c.projects, 'D--a', 's1', 'subagents', 'agent-x.jsonl'), [typed(50, '2026-11-01')]);
  fs.writeFileSync(path.join(c.projects, 'stray.jsonl'), typed(51, '2026-11-01') + '\n');

  const s = store(c);
  check('a profile with no activity.json is backfilling', s.get().backfilling === true);
  const heard: boolean[] = [];
  s.onChange((snap) => heard.push(snap.backfilling));
  await s.scan();
  const d = s.get().days;
  check('per-day counts', d['2026-11-01'] === 2 && d['2026-11-02'] === 1 && d['2026-11-03'] === 1, JSON.stringify(d));
  check('the resumed copy is not counted twice', total(s) === 4, String(total(s)));
  check('backfilling is false after the first scan', s.get().backfilling === false);
  check('the last push says it finished', heard.length > 0 && heard[heard.length - 1] === false, JSON.stringify(heard));
  s.flush();
  const saved = loadActivityFile(path.join(c.data, ACTIVITY_FILE));
  check('the file is saved and says backfilled', saved.existed && saved.data.backfilled);
  check('keys are kept per day, 12 hex digits each', saved.data.seen['2026-11-01'].length === 24 && /^[0-9a-f]+$/.test(saved.data.seen['2026-11-01']));
  check('no text is stored', !fs.readFileSync(path.join(c.data, ACTIVITY_FILE), 'utf8').includes('msg '));

  const again = store(c);
  check('a restart reads the counts back', total(again) === 4 && again.get().backfilling === false);
  await again.scan();
  check('a restart scan adds nothing', total(again) === 4, String(total(again)));
}

console.log('\nactivity-store: appended lines\n');
{
  const c = setup();
  const f = path.join(c.projects, 'D--a', 's1.jsonl');
  write(f, [typed(1, '2026-11-01')]);
  const s = store(c);
  await s.scan();
  check('one message to start', total(s) === 1);

  // Half a line: Claude Code is still writing it.
  const line = typed(2, '2026-11-02');
  append(f, line.slice(0, 40));
  await s.scan();
  check('a partial last line is not counted yet', total(s) === 1);
  append(f, line.slice(40) + '\n');
  await s.scan();
  check('the completed line is counted', total(s) === 2 && s.get().days['2026-11-02'] === 1, JSON.stringify(s.get().days));

  append(f, [typed(3, '2026-11-02'), ...noise].join('\n') + '\n');
  await s.scan();
  check('only the appended bytes count', total(s) === 3);

  // A new session file appears.
  write(path.join(c.projects, 'D--b', 's9.jsonl'), [typed(10, '2026-11-05')]);
  await s.scan();
  check('a new file is read', total(s) === 4);

  // The file is rewritten shorter (same session, different content): read from 0,
  // the old message stays counted, the new one is added.
  write(f, [typed(1, '2026-11-01'), typed(20, '2026-11-06')]);
  await s.scan();
  check('a file that shrank is read again, deduplicated', total(s) === 5 && s.get().days['2026-11-06'] === 1, JSON.stringify(s.get().days));

  // A transcript deleted by Claude Code: its messages stay counted.
  fs.rmSync(path.join(c.projects, 'D--b'), { recursive: true });
  await s.scan();
  s.flush();
  check('a deleted transcript keeps its counts', total(s) === 5);
  check('and its file record is dropped', !Object.keys(loadActivityFile(path.join(c.data, ACTIVITY_FILE)).data.files).some((k) => k.startsWith('D--b/')));
}

console.log('\nactivity-store: quitting mid-backfill\n');
{
  const c = setup();
  const lines: string[] = [];
  for (let i = 1; i <= 400; i++) lines.push(typed(i, `2026-10-${String(1 + (i % 28)).padStart(2, '0')}`), noise[0]);
  write(path.join(c.projects, 'D--a', 'big.jsonl'), lines);
  write(path.join(c.projects, 'D--b', 'other.jsonl'), [typed(1000, '2026-11-01')]);

  // Small chunks and a yield that stops the store part-way, as will-quit does.
  let yields = 0;
  let s!: ActivityStore;
  s = store(c, {
    chunkBytes: 4096,
    sliceMs: 0,
    yieldNow: async () => { if (++yields === 6) { s.stop(); s.flush(); } },
  });
  await s.scan();
  const partial = total(s);
  check('stopped part-way through', partial > 0 && partial < 401, String(partial));
  const saved = loadActivityFile(path.join(c.data, ACTIVITY_FILE));
  check('the saved file is still backfilling', saved.existed && saved.data.backfilled === false);
  const rec = saved.data.files['D--a/big.jsonl'];
  check('the half-read file is saved without size and mtime', rec && rec.s === -1 && rec.o > 0, JSON.stringify(rec));

  const next = store(c);
  check('the next launch carries on backfilling', next.get().backfilling === true && total(next) === partial);
  await next.scan();
  check('it finishes with every message once', total(next) === 401 && next.get().backfilling === false, String(total(next)));

  // Even with the offsets lost, the keys stop a double count.
  next.flush();
  const file = path.join(c.data, ACTIVITY_FILE);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  raw.files = {};
  fs.writeFileSync(file, JSON.stringify(raw));
  const fresh = store(c);
  await fresh.scan();
  check('offsets lost: everything read again, nothing counted twice', total(fresh) === 401, String(total(fresh)));
}

console.log('\nactivity-store: files and folders\n');
{
  const c = setup();
  fs.rmSync(c.projects, { recursive: true });
  const s = store(c);
  await s.scan();
  check('no projects folder: nothing to fill, backfill done', s.get().backfilling === false && total(s) === 0);

  const c2 = setup();
  fs.writeFileSync(path.join(c2.data, ACTIVITY_FILE), '{ this is not json');
  write(path.join(c2.projects, 'D--a', 's.jsonl'), [typed(1, '2026-11-01')]);
  const b = store(c2);
  check('a broken file is noted', typeof b.loadNote === 'string' && b.loadNote.includes('moved'));
  const aside = fs.readdirSync(c2.data).filter((f) => f.startsWith('activity.bad-'));
  check('and moved aside, not overwritten', aside.length === 1 && fs.readFileSync(path.join(c2.data, aside[0]), 'utf8') === '{ this is not json');
  await b.scan();
  check('and the store backfills again', total(b) === 1 && b.get().backfilling === false);

  const c3 = setup();
  write(path.join(c3.projects, 'D--a', 'bom.jsonl'), ['﻿' + typed(1, '2026-11-01'), typed(2, '2026-11-01')], '\r\n');
  const crlf = store(c3);
  await crlf.scan();
  check('a BOM and CRLF line endings are fine', total(crlf) === 2, String(total(crlf)));

  const c4 = setup();
  fs.writeFileSync(path.join(c4.data, ACTIVITY_FILE), JSON.stringify({ version: 1, backfilled: true, files: { 'x/y.jsonl': { o: 'bad' } }, seen: { '2026-11-01': 'abc', 'nope': '000000000001', '2026-11-02': '0000000000010000000000020000000000010' } }));
  const v = store(c4);
  check('bad entries are dropped on load', Object.keys(v.get().days).length === 0 && v.loadNote === null, JSON.stringify(v.get().days));

  const c5 = setup();
  write(path.join(c5.projects, 'D--a', 'a.jsonl'), [typed(1, '2026-11-01')]);
  const tm = store(c5);
  tm.start(10, 50);
  await new Promise((r) => setTimeout(r, 80));
  append(path.join(c5.projects, 'D--a', 'a.jsonl'), typed(2, '2026-11-01') + '\n');
  await new Promise((r) => setTimeout(r, 200));
  tm.stop();
  check('start() scans after its delay and polls', total(tm) === 2, String(total(tm)));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

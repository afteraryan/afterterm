// Unit tests for the incremental transcript store behind the Files button: reading
// only what was appended, lines split across chunk boundaries, multi-byte text,
// subagent files, and decoding a pasted image back out of the transcript.
// Run directly on Node 24+ (strips types):
//   node src/session-files-store.test.ts
// Exits 0 if all pass, 1 on any failure.
//
// Fixtures go into a throwaway folder under the OS temp dir, deleted at the end.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSessionFilesStore, subagentDir, type StoreFs } from './session-files-store.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}
const show = (v: unknown) => JSON.stringify(v);

const SID = '3b6838d6-02c1-4677-b7e6-cd713c0298a3';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'afterterm-sfstore-'));
const transcript = path.join(root, `${SID}.jsonl`);
const T0 = Date.parse('2026-09-25T10:00:00.000Z');
const ts = (s: number) => new Date(T0 + s * 1000).toISOString();

const write = (id: string, file: string, s: number, extra: Record<string, unknown> = {}) => [
  JSON.stringify({ type: 'assistant', timestamp: ts(s), cwd: 'D:\\p', ...extra, message: { content: [{ type: 'tool_use', id, name: 'Write', input: { file_path: file } }] } }),
  JSON.stringify({ type: 'user', timestamp: ts(s + 1), cwd: 'D:\\p', ...extra, message: { content: [{ type: 'tool_result', tool_use_id: id }] }, toolUseResult: { type: 'create' } }),
].join('\n') + '\n';

// A real 1x1 PNG, so the decode test compares actual bytes.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const pasteLine = (uuid: string, s: number, n: number) => JSON.stringify({
  type: 'user', uuid, timestamp: ts(s), cwd: 'D:\\p', imagePasteIds: [n],
  message: { content: [{ type: 'text', text: `é unicode before [Image #${n}]` }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_B64 } }] },
}) + '\n';

let reads = 0;
let bytesRead = 0;
const realFs: StoreFs = {
  size: async (p) => { try { return fs.statSync(p).size; } catch { return null; } },
  read: async (p, position, length) => {
    reads++;
    const fd = fs.openSync(p, 'r');
    try {
      const buf = Buffer.alloc(length);
      const n = fs.readSync(fd, buf, 0, length, position);
      bytesRead += n;
      return new Uint8Array(buf.buffer, buf.byteOffset, n);
    } finally { fs.closeSync(fd); }
  },
  list: async (p) => { try { return fs.readdirSync(p); } catch { return []; } },
};

let yields = 0;
// A tiny chunk size, so every line crosses a chunk boundary somewhere.
const store = createSessionFilesStore({
  fs: realFs,
  locate: (sid) => (sid === SID ? transcript : null),
  chunkBytes: 37,
  yieldNow: async () => { yields++; },
});

try {
  console.log('first read');
  fs.writeFileSync(transcript, write('t1', 'D:\\p\\docs\\a.md', 1) + pasteLine('u1', 3, 2));
  let v = await store.list(SID, 'D:\\p');
  check('the written document is listed', v?.changed.length === 1 && v.changed[0].path === 'D:\\p\\docs\\a.md', show(v?.changed));
  check('created', v?.changed[0].created === true);
  check('the paste is read across chunk boundaries and non-ASCII text', v?.pasted.length === 1 && v.pasted[0].n === 2, show(v?.pasted));
  check('a big read yields between chunks', yields > 5, String(yields));

  console.log('appending');
  const firstSize = fs.statSync(transcript).size;
  bytesRead = 0;
  fs.appendFileSync(transcript, write('t2', 'D:\\p\\src\\b.ts', 10));
  v = await store.list(SID, 'D:\\p');
  check('the appended edit shows up', v?.changed[0].path === 'D:\\p\\src\\b.ts', show(v?.changed));
  check('only the new bytes were read', bytesRead === fs.statSync(transcript).size - firstSize, `${bytesRead} vs ${fs.statSync(transcript).size - firstSize}`);
  check('nothing duplicated', v?.changed.length === 2 && v.pasted.length === 1);

  console.log('a half-written last line');
  const full = write('t3', 'D:\\p\\docs\\c.md', 20);
  fs.appendFileSync(transcript, full.slice(0, full.length - 40));
  v = await store.list(SID, 'D:\\p');
  check('not listed while its result line is half written', !v?.changed.some(f => f.path.endsWith('c.md')));
  fs.appendFileSync(transcript, full.slice(full.length - 40));
  v = await store.list(SID, 'D:\\p');
  check('listed once the line is complete', v?.changed[0].path === 'D:\\p\\docs\\c.md', show(v?.changed.map(f => f.path)));

  console.log('subagents');
  const sub = subagentDir(transcript, SID);
  check('subagent dir shape', sub.replace(/\\/g, '/').endsWith(`/${SID}/subagents`));
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, 'agent-a1.jsonl'), write('s1', 'D:\\p\\notes\\sub.md', 30, { isSidechain: true }));
  fs.writeFileSync(path.join(sub, 'agent-a1.meta.json'), '{}');
  v = await store.list(SID, 'D:\\p');
  const subRow = v?.changed.find(f => f.path.endsWith('sub.md'));
  check('a subagent\'s document is listed', !!subRow, show(v?.changed));
  check('marked as the subagent\'s', subRow?.source === 'subagent');

  console.log('pasted image bytes');
  const key = v!.pasted[0].key;
  const got = await store.pastedBytes(SID, 'D:\\p', key);
  const expected = Buffer.from(PNG_B64, 'base64');
  check('decoded bytes match the pasted PNG', !!got && Buffer.from(got.data).equals(expected), got ? String(got.data.length) : 'null');
  check('an unknown key gives null', (await store.pastedBytes(SID, 'D:\\p', 'nope:0')) === null);

  console.log('missing and concurrent');
  check('an unknown session gives null', (await store.list('00000000-0000-0000-0000-000000000000', 'D:\\p')) === null);
  fs.appendFileSync(transcript, write('t4', 'D:\\p\\z.md', 40));
  const [x, y] = await Promise.all([store.list(SID, 'D:\\p'), store.list(SID, 'D:\\p')]);
  check('two reads at once do not double-count', x?.changed.length === y?.changed.length && x?.changed.filter(f => f.path.endsWith('z.md')).length === 1);

  console.log('a rewritten, shorter file starts over');
  fs.writeFileSync(transcript, write('r1', 'D:\\p\\only.md', 50));
  v = await store.list(SID, 'D:\\p');
  check('old rows gone, new row there', v?.changed.some(f => f.path.endsWith('only.md')) === true && !v.changed.some(f => f.path.endsWith('a.md')), show(v?.changed.map(f => f.path)));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

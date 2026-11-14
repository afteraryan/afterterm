// Synthetic Claude Code transcripts for testing the streak calendar's counts
// (design-07, AFT-97). Every uuid, session id and message here is made up ("msg 12");
// nothing is copied from a real transcript. Point the dev build at the folder with
// --env AFTERTERM_CLAUDE_PROJECTS_DIR=<out>.
//
//   node scripts/agent-harness/activity-fixtures.mjs small --out <dir>
//       Six weeks of sessions up to today, with every kind of line that must NOT count
//       (tool results, sidechain, meta, interrupts, command wrappers, task notices,
//       compact summaries, SDK turns, assistant lines) and a resumed session that copies
//       earlier lines. Writes <dir>/expected.json beside the projects folder:
//       { total, days: { "YYYY-MM-DD": n } }.
//   node scripts/agent-harness/activity-fixtures.mjs large --out <dir> [--files 2000] [--mb 500]
//       A big folder for timing the backfill: --files transcripts of about --mb in all,
//       mostly long tool results, a few typed messages each. Also writes expected.json.
//   node scripts/agent-harness/activity-fixtures.mjs append --out <dir> [--count 1]
//       Appends typed messages dated now to the small set's live session file, and
//       updates expected.json.
//
// The transcripts go in <dir>/projects; expected.json in <dir>.

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const mode = args[0];
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const out = opt('out');
if (!mode || !out) {
  console.error('usage: activity-fixtures.mjs small|large|append --out <dir> [--files N] [--mb N] [--count N]');
  process.exit(2);
}
const projects = path.join(out, 'projects');
const expectedFile = path.join(out, 'expected.json');

let uuidCounter = 0;
const hex = (n, w) => n.toString(16).padStart(w, '0');
/** A made-up v4-shaped uuid; `seed` keeps runs (small, large, append) apart. */
const newUuid = (seed) => `${hex(seed, 8)}-0000-4000-8000-${hex(++uuidCounter, 12)}`;
const sessionId = (n) => `5e55a0e0-0000-4000-8000-${hex(n, 12)}`;

function dayString(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function at(daysBack, hour, minute = 0) {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate() - daysBack, hour, minute, 0);
}

const common = (sid, uuid, ts) => ({
  parentUuid: null, isSidechain: false, userType: 'external', entrypoint: 'cli', cwd: 'C:\\fixture\\project',
  sessionId: sid, version: '9.9.9', gitBranch: 'main', uuid, timestamp: ts.toISOString(),
});
const typed = (sid, uuid, ts, i) => JSON.stringify({
  ...common(sid, uuid, ts), type: 'user', promptSource: 'typed', turnOrigin: 'human',
  message: { role: 'user', content: `msg ${i}` },
});
// Lines that are type "user" (or not) but must never count.
function noise(sid, seed, ts, pad = 0) {
  const u = () => newUuid(seed);
  const filler = pad > 0 ? 'x'.repeat(pad) : 'ok';
  const c = (extra) => JSON.stringify({ ...common(sid, u(), ts), ...extra });
  return [
    c({ type: 'assistant', message: { role: 'assistant', model: 'claude-fixture-1', content: [{ type: 'text', text: 'reply' }] } }),
    c({ type: 'user', toolUseResult: { stdout: filler }, message: { role: 'user', content: [{ tool_use_id: 'toolu_x', type: 'tool_result', content: filler }] } }),
    c({ type: 'user', isSidechain: true, message: { role: 'user', content: 'sidechain msg' } }),
    c({ type: 'user', isMeta: true, message: { role: 'user', content: 'meta msg' } }),
    c({ type: 'user', message: { role: 'user', content: '[Request interrupted by user]' } }),
    c({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] } }),
    c({ type: 'user', message: { role: 'user', content: '<command-name>/model</command-name>\n<command-message>model</command-message>' } }),
    c({ type: 'user', message: { role: 'user', content: '<local-command-stdout>done</local-command-stdout>' } }),
    c({ type: 'user', isMeta: true, message: { role: 'user', content: '<local-command-caveat>caveat</local-command-caveat>' } }),
    c({ type: 'user', message: { role: 'user', content: '<command-message>x</command-message>' } }),
    c({ type: 'user', turnOrigin: 'task_notification', message: { role: 'user', content: '<task-notification>done</task-notification>' } }),
    c({ type: 'user', isCompactSummary: true, isVisibleInTranscriptOnly: true, message: { role: 'user', content: 'summary' } }),
    c({ type: 'user', turnOrigin: 'sdk', message: { role: 'user', content: 'from an sdk' } }),
    c({ type: 'user', message: { role: 'user', content: 'no timestamp' }, timestamp: undefined }),
    c({ type: 'system', subtype: 'info' }),
  ];
}

function readExpected() {
  try { return JSON.parse(fs.readFileSync(expectedFile, 'utf8')); } catch { return { total: 0, days: {} }; }
}
function writeExpected(exp) {
  exp.total = Object.values(exp.days).reduce((a, b) => a + b, 0);
  exp.days = Object.fromEntries(Object.entries(exp.days).sort());
  fs.writeFileSync(expectedFile, JSON.stringify(exp, null, 1));
  console.log(`expected: ${exp.total} messages over ${Object.keys(exp.days).length} days -> ${expectedFile}`);
}
const bump = (exp, day, n = 1) => { exp.days[day] = (exp.days[day] ?? 0) + n; };

if (mode === 'small') {
  fs.mkdirSync(out, { recursive: true });
  if (fs.existsSync(projects)) fs.rmSync(projects, { recursive: true });
  const exp = { total: 0, days: {} };
  const seed = 0x51;
  let msg = 0, sess = 0;
  const copied = []; // lines a resumed session copies
  for (let back = 41; back >= 0; back--) {
    const perDay = [0, 3, 7, 0, 1, 18, 4, 0, 42, 2, 9, 0, 15, 5][back % 14];
    if (perDay === 0) continue;
    const dir = path.join(projects, `C--fixture-project-${back % 3}`);
    fs.mkdirSync(dir, { recursive: true });
    const sid = sessionId(++sess);
    const lines = [];
    for (let i = 0; i < perDay; i++) {
      const ts = at(back, 9 + (i % 12), i % 60);
      const u = newUuid(seed);
      const line = typed(sid, u, ts, ++msg);
      lines.push(line, ...noise(sid, seed, ts));
      if (back < 10 && i < 2) copied.push(line);
      bump(exp, dayString(ts));
    }
    fs.writeFileSync(path.join(dir, `${sid}.jsonl`), lines.join('\n') + '\n');
    // Its subagent: sidechain only, never counted.
    const sub = path.join(dir, sid, 'subagents');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, 'agent-a1.jsonl'), noise(sid, seed, at(back, 10)).slice(2, 3).join('\n') + '\n');
  }
  // A resumed session: the copied lines again (same uuids, not counted twice), then
  // two new typed messages today. This is also the "live" file `append` writes to.
  const live = path.join(projects, 'C--fixture-project-live');
  fs.mkdirSync(live, { recursive: true });
  const sid = sessionId(++sess);
  const lines = [...copied];
  for (let i = 0; i < 2; i++) {
    const ts = at(0, 0, 30 + i);
    lines.push(typed(sid, newUuid(seed), ts, ++msg));
    bump(exp, dayString(ts));
  }
  fs.writeFileSync(path.join(live, `${sid}.jsonl`), lines.join('\n') + '\n');
  // Not JSON at all, and an empty file.
  fs.writeFileSync(path.join(live, 'broken.jsonl'), 'not json\n{"type":"user"\n');
  fs.writeFileSync(path.join(live, 'empty.jsonl'), '');
  fs.writeFileSync(path.join(out, 'live-file.txt'), path.join(live, `${sid}.jsonl`));
  writeExpected(exp);
  console.log(`small fixture: ${sess} sessions in ${projects}`);
} else if (mode === 'append') {
  const live = fs.readFileSync(path.join(out, 'live-file.txt'), 'utf8').trim();
  const count = Number(opt('count', '1'));
  const exp = readExpected();
  const sid = path.basename(live, '.jsonl');
  uuidCounter = Date.now() % 0xffffffff;
  const lines = [];
  for (let i = 0; i < count; i++) {
    const ts = new Date();
    lines.push(typed(sid, newUuid(0xa9), ts, 9000 + i), ...noise(sid, 0xa9, ts));
    bump(exp, dayString(ts));
  }
  fs.appendFileSync(live, lines.join('\n') + '\n');
  writeExpected(exp);
} else if (mode === 'large') {
  const files = Number(opt('files', '2000'));
  const mb = Number(opt('mb', '500'));
  fs.mkdirSync(out, { recursive: true });
  if (fs.existsSync(projects)) fs.rmSync(projects, { recursive: true });
  const exp = { total: 0, days: {} };
  const perFile = Math.floor((mb * 1024 * 1024) / files);
  const seed = 0x1a;
  let msg = 0;
  const t0 = Date.now();
  for (let f = 0; f < files; f++) {
    const dir = path.join(projects, `C--fixture-large-${f % 100}`);
    fs.mkdirSync(dir, { recursive: true });
    const sid = sessionId(0x100000 + f);
    const back = f % 150;
    const typedCount = 1 + (f % 6);
    const parts = [];
    let size = 0;
    let i = 0;
    while (size < perFile) {
      const ts = at(back, 8 + (i % 14), i % 60);
      let chunk;
      if (i < typedCount) {
        chunk = [typed(sid, newUuid(seed), ts, ++msg), ...noise(sid, seed, ts, 4000)].join('\n') + '\n';
        bump(exp, dayString(ts));
      } else {
        // Mostly long tool results and assistant lines, like a real session.
        chunk = noise(sid, seed, ts, 30000).slice(0, 2).join('\n') + '\n';
      }
      parts.push(chunk);
      size += chunk.length;
      i++;
    }
    // Every few files, one very long line (a big pasted log) as a typed message.
    if (f % 97 === 0) {
      const ts = at(back, 23);
      parts.push(JSON.stringify({ ...common(sid, newUuid(seed), ts), type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'msg big' }, { type: 'image', source: { type: 'base64', data: 'A'.repeat(3 * 1024 * 1024) } }] } }) + '\n');
      bump(exp, dayString(ts));
    }
    fs.writeFileSync(path.join(dir, `${sid}.jsonl`), parts.join(''));
  }
  writeExpected(exp);
  let bytes = 0;
  for (const d of fs.readdirSync(projects)) for (const f of fs.readdirSync(path.join(projects, d))) bytes += fs.statSync(path.join(projects, d, f)).size;
  console.log(`large fixture: ${files} files, ${(bytes / 1048576).toFixed(0)} MB in ${projects} (${Date.now() - t0} ms)`);
} else {
  console.error(`unknown mode ${mode}`);
  process.exit(2);
}

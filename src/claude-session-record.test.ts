// Unit tests for reading Claude Code's own session record. Run directly on Node 24+
// (strips types):
//   node src/claude-session-record.test.ts
// Exits 0 if all pass, 1 on any failure.
//
// Everything here is pure, so the cases are record texts and process lists built in
// memory. Nothing reads the real Claude folder. The record shapes follow the facts
// table in docs/plan-02-restart-window-and-hook-fixes.md (Fix 5); the start time
// formats follow strings in the Claude Code binary and are not checked against a
// live record.

import {
  CLAUDE_CWD_RE,
  PROC_START_TOLERANCE_MS,
  RECORD_MAX_BYTES,
  isRecordFileName,
  matchRecordsToThreads,
  parseSessionRecord,
  pidLooksAlive,
  procStartReadings,
  recordFeed,
  threadFeeds,
  unlistedRunningPids,
} from './claude-session-record.ts';
import type { SessionRecord } from './claude-session-record.ts';
import { applyMsysParents } from './server-detect.ts';
import type { Proc } from './server-detect.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}
const show = (v: unknown) => JSON.stringify(v, (_k, x) => (x instanceof Map ? [...x] : x));

const ID_A = '3d71b0f2-26cb-4ad3-8371-6504ab2e37e2';
const ID_B = '9a0c4e55-1f2b-4c3d-8e9f-0a1b2c3d4e5f';
const ID_C = 'c0ffee00-1234-4abc-9def-001122334455';

// One instant, and the same instant in each start time format.
const START_MS = Date.UTC(2026, 10, 7, 10, 0, 0, 123);
const FILETIME = (ms: number, extra = 0n) => (BigInt(ms) * 10_000n + 116_444_736_000_000_000n + extra).toString();
const TICKS = (wallMs: number) => (BigInt(wallMs) * 10_000n + 621_355_968_000_000_000n).toString();
// India: local is UTC+5:30, so getTimezoneOffset says -330.
const IST = () => -330;
const UTC = () => 0;

function recordText(fields: Record<string, unknown>): string {
  return JSON.stringify(fields);
}
function rec(pid: number, over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    pid, sessionId: ID_A, cwd: 'D:\\Work\\app', status: 'idle', kind: 'interactive',
    procStart: FILETIME(START_MS), ...over,
  };
}

console.log('\nclaude-session-record: isRecordFileName\n');
{
  check('a record name is accepted', isRecordFileName('41236.json'));
  check('the key file beside it is refused',
    !isRecordFileName('41236.0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.key'));
  check('a key file mid-write is refused',
    !isRecordFileName('41236.0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.key.tmp.ab12'));
  check('a record mid-write is refused', !isRecordFileName('41236.json.tmp.9f'));
  check('a name that is not a number is refused', !isRecordFileName('session.json'));
  check('an upper-case extension is refused', !isRecordFileName('41236.JSON'));
  check('a bare extension is refused', !isRecordFileName('.json'));
  check('a path is refused', !isRecordFileName('sub\\41236.json') && !isRecordFileName('sub/41236.json'));
}

console.log('\nclaude-session-record: parseSessionRecord\n');
{
  const full = parseSessionRecord(recordText({
    pid: 41236, sessionId: ID_A, cwd: 'D:\\Pitara\\Work\\Tinkering\\afterterm', status: 'busy',
    kind: 'interactive', procStart: '639000000000000000', startedAt: 1_762_500_000_000, entrypoint: 'cli',
  }), '41236.json');
  check('a full record parses', full !== null && full.pid === 41236 && full.sessionId === ID_A
    && full.cwd === 'D:\\Pitara\\Work\\Tinkering\\afterterm' && full.status === 'busy'
    && full.kind === 'interactive' && full.procStart === '639000000000000000', show(full));

  for (const s of ['busy', 'idle', 'waiting', 'shell']) {
    check(`status "${s}" is kept`, parseSessionRecord(recordText({ pid: 7, status: s }), '7.json')?.status === s);
  }
  check('an empty status (Claude starting up) is null',
    parseSessionRecord(recordText({ pid: 7, sessionId: ID_A, cwd: 'C:\\x', status: '' }), '7.json')?.status === null);
  check('an unknown status is null',
    parseSessionRecord(recordText({ pid: 7, status: 'thinking' }), '7.json')?.status === null);

  check('bad JSON is refused', parseSessionRecord('{"pid": 7, "sessionId": ', '7.json') === null);
  check('an empty file is refused', parseSessionRecord('', '7.json') === null);
  check('a JSON array is refused', parseSessionRecord('[1,2]', '7.json') === null);
  check('a JSON string is refused', parseSessionRecord('"7"', '7.json') === null);
  check('a pid that disagrees with the file name is refused',
    parseSessionRecord(recordText({ pid: 8, sessionId: ID_A, cwd: 'C:\\x' }), '7.json') === null);
  check('a pid written as a string is refused',
    parseSessionRecord(recordText({ pid: '7', sessionId: ID_A, cwd: 'C:\\x' }), '7.json') === null);
  check('a file name with a leading zero is refused',
    parseSessionRecord(recordText({ pid: 7 }), '07.json') === null);
  check('pid 0 is refused', parseSessionRecord(recordText({}), '0.json') === null);
  check('a pid past 32 bits is refused', parseSessionRecord(recordText({}), '99999999999.json') === null);
  check('a key file name is refused even with record text in it',
    parseSessionRecord(recordText({ pid: 7, sessionId: ID_A }), '7.abc.key') === null);
  check('a record over the size cap is refused',
    parseSessionRecord(recordText({ pid: 7, pad: 'x'.repeat(RECORD_MAX_BYTES) }), '7.json') === null);
  check('a leading byte order mark is fine',
    parseSessionRecord('\uFEFF' + recordText({ pid: 7, sessionId: ID_A }), '7.json')?.sessionId === ID_A);
  check('a record with no pid inside takes the file name',
    parseSessionRecord(recordText({ sessionId: ID_A }), '7.json')?.pid === 7);

  const missing = parseSessionRecord(recordText({ pid: 7 }), '7.json');
  check('a record missing every other field parses with every field null',
    missing !== null && missing.sessionId === null && missing.cwd === null && missing.status === null
    && missing.kind === null && missing.procStart === null, show(missing));

  const badId = parseSessionRecord(recordText({ pid: 7, sessionId: 'abc; rm -rf ~', cwd: 'C:\\x', status: 'busy' }), '7.json');
  check('a sessionId that is not a UUID is null', badId?.sessionId === null, show(badId));
  check('and the status still comes through', badId?.status === 'busy');
  const braced = parseSessionRecord(recordText({ pid: 7, sessionId: `{${ID_A}}` }), '7.json');
  check('a braced UUID is not canonical', braced?.sessionId === null);
  const numericId = parseSessionRecord(recordText({ pid: 7, sessionId: 42 }), '7.json');
  check('a numeric sessionId is null', numericId?.sessionId === null);

  for (const bad of ['D:\\Work & play', 'D:\\a|b', 'D:\\$env', 'D:\\x`y', "D:\\Aryan's", 'D:\\a"b', 'D:\\a>b', 'D:\\a\nb']) {
    const r = parseSessionRecord(recordText({ pid: 7, sessionId: ID_A, cwd: bad, status: 'idle' }), '7.json');
    check(`a cwd with a shell metacharacter is null: ${JSON.stringify(bad)}`, r?.cwd === null && r?.status === 'idle', show(r));
  }
  for (const bad of ['relative\\path', '\\\\server\\share', '/c/Users', 'C:/Users']) {
    check(`a cwd that is not an absolute Windows path is null: ${bad}`,
      parseSessionRecord(recordText({ pid: 7, cwd: bad }), '7.json')?.cwd === null);
  }
  check('CLAUDE_CWD_RE takes a plain absolute path', CLAUDE_CWD_RE.test('C:\\Users\\Aryan\\Work (copy)\\app-1'));

  const both = parseSessionRecord(recordText({ pid: 7, procStart: '639000000000000000', procStartFt: '134000000000000000' }), '7.json');
  check('procStartFt is preferred over procStart, as Claude Code reads them', both?.procStart === '134000000000000000');
  check('procStart alone is used', parseSessionRecord(recordText({ pid: 7, procStart: '639000000000000000' }), '7.json')?.procStart === '639000000000000000');
  check('a procStart that is not digits is null',
    parseSessionRecord(recordText({ pid: 7, procStart: 'Sat Nov  7 10:00:00 2026' }), '7.json')?.procStart === null);
  check('a numeric procStart is read as its digits',
    parseSessionRecord(recordText({ pid: 7, procStart: 1234567 }), '7.json')?.procStart === '1234567');
  check('a kind that is not a plain word is null',
    parseSessionRecord(recordText({ pid: 7, kind: 'interactive; echo' }), '7.json')?.kind === null);
  check('the other kinds are kept', parseSessionRecord(recordText({ pid: 7, kind: 'daemon-worker' }), '7.json')?.kind === 'daemon-worker');
}

console.log('\nclaude-session-record: procStartReadings\n');
{
  check('a FILETIME reads as one exact UTC time', show(procStartReadings(FILETIME(START_MS))) === show([START_MS]));
  check('a FILETIME with sub-millisecond digits rounds down',
    show(procStartReadings(FILETIME(START_MS, 9_999n))) === show([START_MS]));

  const istWall = START_MS + 330 * 60_000;
  const ist = procStartReadings(TICKS(istWall), IST);
  check('.NET ticks of a local time read back to UTC first', ist[0] === START_MS, show(ist));
  check('and the same ticks read as UTC are offered too', ist.length === 2 && ist[1] === istWall, show(ist));
  check('ticks in a UTC zone have one reading', show(procStartReadings(TICKS(START_MS), UTC)) === show([START_MS]));

  check('null has no reading', procStartReadings(null).length === 0);
  check('letters have no reading', procStartReadings('12ab').length === 0);
  check('a number below either epoch has no reading', procStartReadings('12345').length === 0);
}

console.log('\nclaude-session-record: pidLooksAlive\n');
{
  const procs: Proc[] = [
    { pid: 100, ppid: 4, created: START_MS - 60_000 },
    { pid: 200, ppid: 100, created: START_MS },
  ];
  check('a live pid with the same start time is alive', pidLooksAlive(rec(200), procs));
  check('a dead pid (not in the list) is not', !pidLooksAlive(rec(999), procs));

  // A hard kill left the record behind, and Windows gave pid 200 to a process that
  // started half an hour later.
  const reused: Proc[] = [{ pid: 200, ppid: 100, created: START_MS + 30 * 60_000 }];
  check('a reused pid (start times disagree) is not alive', !pidLooksAlive(rec(200), reused));

  const truncated: Proc[] = [{ pid: 200, ppid: 100, created: START_MS + PROC_START_TOLERANCE_MS - 1 }];
  check('a start time within the tolerance is alive', pidLooksAlive(rec(200), truncated));
  const outside: Proc[] = [{ pid: 200, ppid: 100, created: START_MS + PROC_START_TOLERANCE_MS + 5 }];
  check('a start time just past the tolerance is not', !pidLooksAlive(rec(200), outside));

  check('a list with no creation time for the pid trusts the pid',
    pidLooksAlive(rec(200), [{ pid: 200, ppid: 100, created: null }]));
  check('a record with no start time trusts the pid', pidLooksAlive(rec(200, { procStart: null }), reused));
  check('a start time in an unknown shape trusts the pid', pidLooksAlive(rec(200, { procStart: '12345' }), reused));

  const istWall = START_MS + 330 * 60_000;
  check('.NET ticks of local time match the list', pidLooksAlive(rec(200, { procStart: TICKS(istWall) }), procs, IST));
  check('.NET ticks of UTC match the list too', pidLooksAlive(rec(200, { procStart: TICKS(START_MS) }), procs, IST));
  check('.NET ticks of another time do not',
    !pidLooksAlive(rec(200, { procStart: TICKS(istWall + 3_600_000) }), procs, IST));
}

console.log('\nclaude-session-record: matchRecordsToThreads\n');
{
  // Two threads. Thread one: cmd 100, its claude 200, which runs a node 300 that
  // started another claude 400 (a Claude starting a Claude). Thread two: pwsh 110
  // and its own claude 210. Claude 500 belongs to some other app.
  const procs: Proc[] = [
    { pid: 100, ppid: 1, created: 1000 },
    { pid: 200, ppid: 100, created: 2000 },
    { pid: 300, ppid: 200, created: 3000 },
    { pid: 400, ppid: 300, created: 4000 },
    { pid: 110, ppid: 1, created: 1100 },
    { pid: 210, ppid: 110, created: 2100 },
    { pid: 500, ppid: 9, created: 5000 },
    { pid: 120, ppid: 1, created: 1200 },
  ];
  const shells = new Map([['tab-1', 100], ['tab-2', 110], ['tab-3', 120]]);
  const records = [
    rec(400, { sessionId: ID_C }),
    rec(200, { sessionId: ID_A }),
    rec(210, { sessionId: ID_B }),
    rec(500, { sessionId: ID_C }),
  ];
  const got = matchRecordsToThreads(records, shells, procs);
  check('the nested Claude loses to the one nearest the shell', got.get('tab-1')?.pid === 200, show(got));
  check('the second thread gets its own Claude', got.get('tab-2')?.pid === 210, show(got));
  check('a thread with no Claude has no entry', !got.has('tab-3'));
  check('a Claude outside every thread is matched to none', ![...got.values()].some(r => r.pid === 500));

  const outerNotInteractive = matchRecordsToThreads(
    [rec(200, { kind: 'bg' }), rec(400, { kind: 'interactive' })], shells, procs);
  check('an interactive record wins over a nearer one of another kind',
    outerNotInteractive.get('tab-1')?.pid === 400, show(outerNotInteractive));
  const noneInteractive = matchRecordsToThreads(
    [rec(200, { kind: null }), rec(400, { kind: 'bg' })], shells, procs);
  check('with no interactive record the nearest is taken', noneInteractive.get('tab-1')?.pid === 200);

  check('no records gives an empty map', matchRecordsToThreads([], shells, procs).size === 0);

  // Git Bash: claude.exe was exec'd through an MSYS stub that exited, so its Windows
  // parent (7777) is gone. MSYS's own table links it back to the bash.
  const gitBash: Proc[] = [
    { pid: 130, ppid: 1, created: 1300 },
    { pid: 230, ppid: 7777, created: 2300 },
  ];
  const msys = [{ pid: 10, ppid: 1, winpid: 130 }, { pid: 11, ppid: 10, winpid: 230 }];
  const bashShells = new Map([['tab-git', 130]]);
  check('a Git Bash tree without the MSYS bridge finds nothing',
    !matchRecordsToThreads([rec(230)], bashShells, gitBash).has('tab-git'));
  check('with the bridge applied the Claude is found',
    matchRecordsToThreads([rec(230)], bashShells, applyMsysParents(gitBash, msys)).get('tab-git')?.pid === 230);
}

console.log('\nclaude-session-record: recordFeed\n');
{
  const yes = () => true;
  const no = () => false;
  check('no record: no id, no folder, status null',
    show(recordFeed(undefined, yes)) === show({ pid: null, sessionId: null, cwd: null, status: null }));
  check('a record whose transcript exists hands over its id',
    show(recordFeed(rec(200, { status: 'busy' }), yes)) === show({ pid: 200, sessionId: ID_A, cwd: 'D:\\Work\\app', status: 'busy' }));
  const before = recordFeed(rec(200, { status: 'idle' }), no);
  check('a record with no transcript yet hands over no id', before.sessionId === null, show(before));
  check('but its status is still sent', before.status === 'idle');

  let asked = 0;
  const counting = () => { asked++; return true; };
  const badCwd = recordFeed(rec(200, { cwd: null, status: 'waiting' }), counting);
  check('a record whose folder failed validation hands over no id', badCwd.sessionId === null && badCwd.status === 'waiting');
  check('and the transcript is not even looked for', asked === 0);
  check('a record with no id hands over none', recordFeed(rec(200, { sessionId: null }), yes).sessionId === null);
  check('a transcript check that throws counts as no transcript',
    recordFeed(rec(200), () => { throw new Error('EACCES'); }).sessionId === null);
  let seen: [string, string] | null = null;
  recordFeed(rec(200), (id, cwd) => { seen = [id, cwd]; return true; });
  check('the transcript is looked up by the record id and folder', show(seen) === show([ID_A, 'D:\\Work\\app']));
}

console.log('\nclaude-session-record: threadFeeds\n');
{
  const procs: Proc[] = [
    { pid: 100, ppid: 1, created: START_MS - 60_000 },
    { pid: 200, ppid: 100, created: START_MS },
    { pid: 110, ppid: 1, created: START_MS - 60_000 },
    { pid: 210, ppid: 110, created: START_MS + 3_600_000 },
    { pid: 120, ppid: 1, created: START_MS - 60_000 },
    { pid: 220, ppid: 120, created: START_MS },
    { pid: 130, ppid: 1, created: START_MS - 60_000 },
  ];
  const shells = new Map([['busy', 100], ['reused', 110], ['killed', 120], ['plain', 130]]);
  const feeds = threadFeeds({
    records: [
      rec(200, { status: 'busy' }),
      // A record from a claude.exe that was hard killed: pid 210 now belongs to a
      // process an hour younger.
      rec(210, { status: 'busy', sessionId: ID_B }),
      // Killed a moment ago: the minute-old list still has it, the system does not.
      rec(220, { status: 'waiting', sessionId: ID_C }),
    ],
    shellPids: shells,
    procs,
    transcriptExists: () => true,
    isRunning: pid => pid !== 220,
  });
  check('a live Claude feeds its id and status', show(feeds.get('busy')) === show({ pid: 200, sessionId: ID_A, cwd: 'D:\\Work\\app', status: 'busy' }));
  check('a record on a reused pid is ignored', show(feeds.get('reused')) === show({ pid: null, sessionId: null, cwd: null, status: null }), show(feeds.get('reused')));
  check('a record whose process just died is ignored', feeds.get('killed')?.status === null && feeds.get('killed')?.sessionId === null);
  check('a thread with no Claude gets the empty feed', show(feeds.get('plain')) === show({ pid: null, sessionId: null, cwd: null, status: null }));
  check('every thread with a shell gets a feed', feeds.size === 4);
  check('no threads, no feeds', threadFeeds({ records: [rec(200)], shellPids: new Map(), procs, transcriptExists: () => true }).size === 0);
}

console.log('\nclaude-session-record: unlistedRunningPids\n');
{
  const procs: Proc[] = [{ pid: 200, ppid: 100, created: 1 }];
  const records = [rec(200), rec(300), rec(400)];
  check('a running pid the list has not seen is reported, a dead one is not',
    show(unlistedRunningPids(records, procs, pid => pid === 300)) === show([300]));
  check('nothing to report when every record is listed', unlistedRunningPids([rec(200)], procs, () => true).length === 0);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);

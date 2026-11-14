// Unit tests for which transcript lines count as messages (design-07, AFT-97). Run
// directly on Node 24+:
//   node src/activity-counts.test.ts
// Exits 0 if all pass, 1 on any failure. Every line here is synthetic.

import { countableTurn, localDayString, mightCount, uuidKey } from './activity-counts.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}

const U = '11111111-2222-4333-8444-555555555555';
// 2026-11-10 14:00 local time, as an ISO string in UTC (how Claude Code writes it).
const TS = new Date(2026, 10, 10, 14, 0, 0).toISOString();
const base = (extra: Record<string, unknown> = {}, content: unknown = 'msg 1') => ({
  parentUuid: null, isSidechain: false, type: 'user', message: { role: 'user', content },
  uuid: U, timestamp: TS, userType: 'external', sessionId: 's', ...extra,
});

console.log('\nactivity: what counts\n');
{
  const t = countableTurn(base());
  check('a typed string message counts', t !== null && t.uuid === U && t.day === '2026-11-10', JSON.stringify(t));
  check('an array message with text counts', countableTurn(base({}, [{ type: 'text', text: 'msg 2' }])) !== null);
  check('text with a pasted image counts', countableTurn(base({}, [{ type: 'text', text: 'see' }, { type: 'image', source: {} }])) !== null);
  check('an image alone counts', countableTurn(base({}, [{ type: 'image', source: {} }])) !== null);
  check('a queued prompt counts', countableTurn(base({ promptSource: 'queued', turnOrigin: 'human' })) !== null);
  check('a line with no turnOrigin (older Claude Code) counts', countableTurn(base()) !== null);
  check('a slash prompt typed as text counts', countableTurn(base({}, '/clear the cache')) !== null);
  check('a numeric timestamp works', countableTurn(base({ timestamp: new Date(2026, 0, 2, 9).getTime() }))?.day === '2026-01-02');
}

console.log('\nactivity: what does not count\n');
{
  const no = (name: string, line: unknown) => check(name, countableTurn(line) === null);
  no('an assistant line', { ...base(), type: 'assistant' });
  no('a tool result', base({ toolUseResult: {} }, [{ tool_use_id: 'x', type: 'tool_result', content: 'ok' }]));
  no('a tool result after a text part', base({}, [{ type: 'text', text: 'a' }, { type: 'tool_result', content: 'b' }]));
  no('a sidechain (subagent) line', base({ isSidechain: true }));
  no('a meta line', base({ isMeta: true }));
  no('a compact summary', base({ isCompactSummary: true, isVisibleInTranscriptOnly: true }));
  no('a transcript-only line', base({ isVisibleInTranscriptOnly: true }));
  no('an SDK turn', base({ turnOrigin: 'sdk' }));
  no('a task notification turn', base({ turnOrigin: 'task_notification' }));
  no('an interrupt (string)', base({}, '[Request interrupted by user]'));
  no('an interrupt (array)', base({}, [{ type: 'text', text: '[Request interrupted by user for tool use]' }]));
  no('<command-name> wrapper', base({}, '<command-name>/model</command-name>\n<command-message>model</command-message>'));
  no('<command-message> wrapper', base({}, '<command-message>x</command-message>'));
  no('<local-command-stdout> wrapper', base({}, '<local-command-stdout>done</local-command-stdout>'));
  no('<local-command-caveat> wrapper', base({}, '<local-command-caveat>Caveat</local-command-caveat>'));
  no('<task-notification> wrapper', base({}, '<task-notification>x</task-notification>'));
  no('<bash-input> wrapper', base({}, [{ type: 'text', text: '  <bash-input>ls</bash-input>' }]));
  no('an empty string', base({}, '   '));
  no('an empty array', base({}, []));
  no('no content', base({ message: { role: 'user' } }));
  no('no uuid', base({ uuid: undefined }));
  no('no timestamp', base({ timestamp: undefined }));
  no('a bad timestamp', base({ timestamp: 'yesterday-ish' }));
  no('null', null);
  no('a string', 'user');
}

console.log('\nactivity: the byte pre-check\n');
{
  const enc = new TextEncoder();
  const bytes = (o: unknown) => Buffer.from(enc.encode(JSON.stringify(o)));
  check('a typed line passes', mightCount(bytes(base())));
  check('a tool result is refused', !mightCount(bytes(base({}, [{ type: 'tool_result', content: 'x' }]))));
  check('a sidechain line is refused', !mightCount(bytes(base({ isSidechain: true }))));
  check('an assistant line is refused', !mightCount(bytes({ type: 'assistant', message: {} })));
  check('a typed message that quotes "type":"tool_result" still passes',
    mightCount(bytes(base({}, 'why does "type":"tool_result" show up?'))));
  check('works on a plain Uint8Array too', mightCount(enc.encode(JSON.stringify(base()))) && !mightCount(enc.encode('{"type":"assistant"}')));
  // Every line the pre-check refuses is one countableTurn refuses too.
  const samples = [base({ isSidechain: true }), base({}, [{ type: 'tool_result' }]), { type: 'assistant' }, { type: 'system' }];
  check('never refuses a line that would count', samples.every((s) => mightCount(bytes(s)) || countableTurn(s) === null));
}

console.log('\nactivity: uuid keys and days\n');
{
  check('key is the last 12 hex digits', uuidKey(U) === '555555555555');
  check('key is lower case', uuidKey('AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE') === 'eeeeeeeeeeee');
  const k = uuidKey('not-a-uuid');
  check('a non-uuid gets a 12 hex digit hash', /^[0-9a-f]{12}$/.test(k), k);
  check('the hash is stable', uuidKey('not-a-uuid') === k);
  check('different non-uuids differ', uuidKey('not-a-uuid-2') !== k);
  check('local day near midnight', localDayString(new Date(2026, 10, 10, 23, 59, 59)) === '2026-11-10');
  check('local day just after midnight', localDayString(new Date(2026, 10, 11, 0, 0, 1).getTime()) === '2026-11-11');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

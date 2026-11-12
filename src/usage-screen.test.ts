// Unit tests for the /usage screen parser. Run directly on Node 24+ (strips types):
//   node src/usage-screen.test.ts
// Exits 0 if all pass, 1 on any failure.
//
// The fixtures are rows of the screen of a real Claude Code 2.1.322 (Max plan), captured on
// 2026-11-12 through a pseudo-terminal, so the parser is tested against what Claude Code draws.

import { formatReset, parseUsageScreen, readerStep } from './usage-screen.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}
const show = (v: unknown) => JSON.stringify(v);

const TOP = [
  '▐▛███▛█   Claude Code v2.1.322',
  '❯ /usage',
  '──────────────────────────────────────────────────────────────────────────────',
  '  Settings  Status   Config   Usage   Stats',
  '',
  '  Session',
  '',
  '  Total cost:            $0.0000',
  '  Total duration (API):  0s',
  '',
  '  Current session',
  '  ███                                                6% used',
  '  Resets 3:19am (Asia/Kolkata)',
  '',
  '  Current week (all models)',
  '  █████████████████████████████████████████▌         83% used',
  '  Resets Nov 14, 11:29pm (Asia/Kolkata)',
  '',
  '  Current week (Fable)',
  '  █████████████████████████████████████████████▌     91% used',
  '  Resets Nov 14, 11:29pm (Asia/Kolkata)',
  '',
  "  What's contributing to your usage?",
  '  Approximate · sessions on this machine only',
  '',
];
const SCANNING = [...TOP, '  Scanning local sessions…', '', '  Usage credits', '  Usage credits are off · /usage-credits to turn them on', '', '  Esc to cancel'];
const DONE = [
  ...TOP,
  '  Last 24h · shares overlap',
  '',
  '  76%  Start fresh when you switch tasks · run /clear',
  '  41%  Give simple subagents a cheaper model',
  '  25%  Trim D:\\Pitara\\Work\\Tinkering\\afterterm\\CLAUDE.md · 18k tokens per request',
  '  12%  Run /skill-creator on a cheaper model',
  '  10%  Ask mcp__claude_ai_Wispr_Flow__get_meeting for less · up to 17k tokens, 3',
  '       times',
  '',
  '  Skills                  % of usage',
  '  /skill-creator                 12%',
  '  /bug-record                     4%',
  '  /artifact-capabilities          3%',
  '',
  '  Subagents               % of usage',
  '  general-purpose                 1%',
  '  claude-code-guide               1%',
  '',
  '  MCP servers             % of usage',
  '  claude-in-chrome                5%',
  '  plugin:productivity:linear      3%',
  '  claude.ai Wispr Flow            1%',
  '',
  '  d to day · w to week',
  '',
  '  Usage credits',
  '  Usage credits are off · /usage-credits to turn them on',
];

console.log('\nusage-screen: reset text\n');
{
  check('a time alone gets "at" and an upper-case AM', formatReset('Resets 3:20am (Asia/Kolkata)') === 'Resets at 3:20 AM', formatReset('Resets 3:20am (Asia/Kolkata)'));
  check('a date and time keeps the date', formatReset('Resets Nov 14, 11:30pm (Asia/Kolkata)') === 'Resets Nov 14, 11:30 PM', formatReset('Resets Nov 14, 11:30pm (Asia/Kolkata)'));
  check('no time zone is fine', formatReset('Resets 9:05pm') === 'Resets at 9:05 PM');
  check('text it does not know is kept', formatReset('Resets soon') === 'Resets soon', formatReset('Resets soon'));
}

console.log('\nusage-screen: limits\n');
{
  const p = parseUsageScreen(SCANNING);
  check('three limits are read', p.limits.length === 3, show(p.limits));
  check('session', show(p.limits[0]) === show({ id: 'session', label: 'Current session', percent: 6, reset: 'Resets at 3:19 AM' }), show(p.limits[0]));
  check('week, all models', show(p.limits[1]) === show({ id: 'week', label: 'This week', percent: 83, reset: 'Resets Nov 14, 11:29 PM' }), show(p.limits[1]));
  check('week, Fable', show(p.limits[2]) === show({ id: 'week-fable', label: 'This week, Fable', percent: 91, reset: 'Resets Nov 14, 11:29 PM' }), show(p.limits[2]));
  check('the session total block is not mistaken for a limit', !p.limits.some((l) => l.label === 'Session'));
}

console.log('\nusage-screen: the breakdown while it scans\n');
{
  const p = parseUsageScreen(SCANNING);
  check('scanning is true', p.scanning === true);
  check('there is no breakdown yet', p.breakdown === null);
  check('the limits are still there', p.limits.length === 3);
}

console.log('\nusage-screen: the breakdown when ready\n');
{
  const p = parseUsageScreen(DONE);
  check('scanning is false', p.scanning === false);
  check('there is a breakdown', p.breakdown !== null);
  const tips = p.breakdown?.tips ?? [];
  check('five tips', tips.length === 5, String(tips.length));
  check('the first tip', show(tips[0]) === show({ percent: 76, text: 'Start fresh when you switch tasks, run /clear' }), show(tips[0]));
  check('a folder path shrinks to the file name', tips[2]?.text === 'Trim CLAUDE.md, 18k tokens per request', tips[2]?.text);
  check('a tip that wrapped onto two rows is joined', tips[4]?.text === 'Ask mcp__claude_ai_Wispr_Flow__get_meeting for less, up to 17k tokens, 3 times', tips[4]?.text);
  const g = p.breakdown?.groups ?? [];
  check('three groups in order', show(g.map((x) => x.title)) === show(['Skills', 'Subagents', 'MCP servers']), show(g.map((x) => x.title)));
  check('skills', show(g[0]?.items) === show([{ name: '/skill-creator', percent: 12 }, { name: '/bug-record', percent: 4 }, { name: '/artifact-capabilities', percent: 3 }]), show(g[0]?.items));
  check('subagents', g[1]?.items.length === 2 && g[1].items[0].name === 'general-purpose', show(g[1]?.items));
  check('mcp servers keep names with colons and dots', g[2]?.items[1]?.name === 'plugin:productivity:linear' && g[2]?.items[2]?.name === 'claude.ai Wispr Flow', show(g[2]?.items));
  check('the usage credits line is not read as a row', !g.some((x) => x.items.some((i) => /credit/i.test(i.name))));
}

console.log('\nusage-screen: odd screens\n');
{
  const empty = parseUsageScreen([]);
  check('an empty screen gives nothing', empty.limits.length === 0 && empty.breakdown === null && empty.scanning === false);
  const prompt = parseUsageScreen(['❯ Try "how does <filepath> work?"', '  ⏵⏵ auto mode on']);
  check('the normal prompt gives nothing', prompt.limits.length === 0);
  const half = parseUsageScreen(['  Current session', '  ███   6% used']);
  check('a limit with no reset row yet is not returned', half.limits.length === 0, show(half.limits));
  const noFable = parseUsageScreen(TOP.filter((_l, i) => i < 17).concat(['']));
  check('a plan without a Fable line gives two limits', noFable.limits.length === 2 && !noFable.limits.some((l) => l.id === 'week-fable'), show(noFable.limits.map((l) => l.id)));
  const opus = parseUsageScreen(['  Current week (Opus)', '  ████  40% used', '  Resets Nov 14, 11:29pm (Asia/Kolkata)']);
  check('another model gets its own row', opus.limits[0]?.id === 'week-opus' && opus.limits[0].label === 'This week, Opus', show(opus.limits));
  const over = parseUsageScreen(['  Current session', '  ███  120% used', '  Resets 3:19am (Asia/Kolkata)']);
  check('a percent over 100 is capped', over.limits[0]?.percent === 100, show(over.limits));
  const dup = parseUsageScreen([...TOP, ...TOP]);
  check('a row drawn twice is read once', dup.limits.length === 3, String(dup.limits.length));
}

console.log('\nusage-screen: what the hidden Claude Code is told to type\n');
{
  const trust = (pointerOn: 'yes' | 'no', glyph: string) => [
    ' Accessing workspace:', ' C:\\somewhere\\usage-reader', ' Quick safety check: Is this a project you created or one you trust?',
    ' Security guide', '',
    pointerOn === 'no' ? ` ${glyph} No, exit` : '   No, exit',
    pointerOn === 'yes' ? ` ${glyph} Yes, I trust this folder` : '   Yes, I trust this folder',
    ' Enter to confirm · Esc to cancel',
  ].join('\n');
  const prompt = ['▐▛███▛█   Claude Code v2.1.322', '❯ Try "how does <filepath> work?"', '  ⏵⏵ auto mode on'].join('\n');
  const menu = ['❯ /usage', '  ❯ /usage                            Show session cost, plan usage, and activity stats', '    /usage-credits                    Configure usage credits'].join('\n');

  check('the trust question with No selected moves down first', show(readerStep('start', trust('no', '❯'))) === show({ send: '\x1b[B', stage: 'start' }));
  check('with the > pointer, No selected moves down too', show(readerStep('start', trust('no', '>'))) === show({ send: '\x1b[B', stage: 'start' }));
  check('Yes selected (the ❯ pointer) presses Enter', show(readerStep('start', trust('yes', '❯'))) === show({ send: '\r', stage: 'start' }));
  check('Yes selected (the > pointer) presses Enter, which stuck the first app run', show(readerStep('start', trust('yes', '>'))) === show({ send: '\r', stage: 'start' }));
  check('nothing is typed while the screen is still blank', show(readerStep('start', '')) === show({ send: null, stage: 'start' }));
  check('the normal prompt gets /usage typed', show(readerStep('start', prompt)) === show({ send: '/usage', stage: 'typed' }));
  check('the prompt is not used while the trust question is still up', readerStep('start', prompt + '\n' + trust('no', '❯')).send === '\x1b[B');
  check('Enter is pressed only once the slash menu lists /usage', show(readerStep('typed', menu)) === show({ send: '\r', stage: 'running' }));
  check('no Enter while only the typed text is there', show(readerStep('typed', '❯ /usage')) === show({ send: null, stage: 'typed' }));
  check('once running, nothing more is typed', show(readerStep('running', menu)) === show({ send: null, stage: 'running' }));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

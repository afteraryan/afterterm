// Unit tests for chatTitle (Claude's own leading glyphs vs. the notify hook's).
// Run directly on Node 24+ (strips types):
//   node src/renderer/chatTitle.test.ts
// Exits 0 if all pass, 1 on any failure.

import { CLAUDE_TITLE_GLYPH, claudeSummaryTitle, HOOK_TITLE_GLYPH, isHookTitle } from './chatTitle.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}
const show = (v: unknown) => JSON.stringify(v);

console.log('\nchatTitle: claudeSummaryTitle, idle glyph\n');
{
  check('idle glyph strips to the summary', claudeSummaryTitle('\u2733 Fix the spinner') === 'Fix the spinner');
}

console.log('\nchatTitle: claudeSummaryTitle, current busy cycle (U+25D0 to U+25D3)\n');
{
  check('\\u25D0 (first frame)', claudeSummaryTitle('\u25D0 Afterterm Phase 3 thread identity orchestration') === 'Afterterm Phase 3 thread identity orchestration');
  check('\\u25D1', claudeSummaryTitle('\u25D1 Fix the spinner') === 'Fix the spinner');
  check('\\u25D2', claudeSummaryTitle('\u25D2 Fix the spinner') === 'Fix the spinner');
  check('\\u25D3 (last frame)', claudeSummaryTitle('\u25D3 Fix the spinner') === 'Fix the spinner');
}

console.log('\nchatTitle: claudeSummaryTitle, older busy cycle (dingbat stars, U+2722 to U+273F) and the middle dot\n');
{
  check('\\u2722 (first of the older cycle)', claudeSummaryTitle('\u2722 Fix the spinner') === 'Fix the spinner');
  check('\\u2733 (also an older-cycle frame, same glyph as idle)', claudeSummaryTitle('\u2733 Fix the spinner') === 'Fix the spinner');
  check('\\u2736', claudeSummaryTitle('\u2736 Fix the spinner') === 'Fix the spinner');
  check('\\u273B', claudeSummaryTitle('\u273B Fix the spinner') === 'Fix the spinner');
  check('\\u273D', claudeSummaryTitle('\u273D Fix the spinner') === 'Fix the spinner');
  check('\\u273F (last of the older cycle)', claudeSummaryTitle('\u273F Fix the spinner') === 'Fix the spinner');
  check('middle dot \\u00B7', claudeSummaryTitle('\u00B7 Fix the spinner') === 'Fix the spinner');
}

console.log('\nchatTitle: claudeSummaryTitle rejects hook titles and shell titles\n');
{
  check('a working hook title is not a Claude summary', claudeSummaryTitle('\u25B6 afterterm - working') === null);
  check('a done hook title is not a Claude summary', claudeSummaryTitle('\u2705 afterterm - done') === null);
  check('an attention hook title is not a Claude summary', claudeSummaryTitle('\u26A0 afterterm - needs permission') === null);
  check('a background hook title is not a Claude summary', claudeSummaryTitle('\u23F3 afterterm - bg (2 running)') === null);
  check('a compacting hook title is not a Claude summary', claudeSummaryTitle('\u2699 afterterm - compacting') === null);
  check('the bare SessionStart hook title is not a Claude summary', claudeSummaryTitle('afterterm') === null);
  check('a plain shell title is not a Claude summary', claudeSummaryTitle('cmd.exe') === null);
  check('a full path shell title is not a Claude summary', claudeSummaryTitle('C:\\Windows\\system32\\cmd.exe') === null);
  check('a folder-name shell title is not a Claude summary', claudeSummaryTitle('afterterm') === null);
}

console.log('\nchatTitle: claudeSummaryTitle edge cases\n');
{
  check('empty string is not a Claude summary', claudeSummaryTitle('') === null);
  check('a glyph alone (no summary yet) returns null', claudeSummaryTitle('\u2733') === null);
  check('a glyph followed only by whitespace returns null', claudeSummaryTitle('\u2733   ') === null);
  check('CRLF between the glyph and the summary is stripped',
    claudeSummaryTitle('\u2733\r\nFix the spinner') === 'Fix the spinner', show(claudeSummaryTitle('\u2733\r\nFix the spinner')));
  check('extra spaces between the glyph and the summary are stripped',
    claudeSummaryTitle('\u2733     Fix the spinner') === 'Fix the spinner');
  check('trailing whitespace on the summary is trimmed',
    claudeSummaryTitle('\u2733 Fix the spinner   ') === 'Fix the spinner');
}

console.log('\nchatTitle: CLAUDE_TITLE_GLYPH regex directly\n');
{
  check('matches the idle glyph', CLAUDE_TITLE_GLYPH.test('\u2733 x'));
  check('matches a busy-cycle glyph', CLAUDE_TITLE_GLYPH.test('\u25D2 x'));
  check('does not match a hook glyph', !CLAUDE_TITLE_GLYPH.test('\u25B6 x'));
  check('does not match a shell title', !CLAUDE_TITLE_GLYPH.test('cmd.exe'));
}

console.log('\nchatTitle: HOOK_TITLE_GLYPH and isHookTitle\n');
{
  check('working', isHookTitle('\u25B6 afterterm - working') === true);
  check('done', isHookTitle('\u2705 afterterm - done') === true);
  check('needs permission', isHookTitle('\u26A0 afterterm - needs permission') === true);
  check('background', isHookTitle('\u23F3 afterterm - bg (2 running)') === true);
  check('compacting', isHookTitle('\u2699 afterterm - compacting') === true);
  check('CRLF and extra spaces after the glyph still count',
    isHookTitle('\u25B6\r\n\r\n  afterterm - working') === true);
  check('a Claude summary glyph is not a hook title', isHookTitle('\u2733 Fix the spinner') === false);
  check('a shell title is not a hook title', isHookTitle('cmd.exe') === false);
  check('the bare SessionStart title (no glyph at all) is not a hook title', isHookTitle('afterterm') === false);
  check('empty string is not a hook title', isHookTitle('') === false);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);

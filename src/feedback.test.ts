// Unit tests for feedback.ts. Run directly on Node 24+ (strips types):
//   node src/feedback.test.ts
// Exits 0 if all pass, 1 on any failure.

import { feedbackUrl, FEEDBACK_URL } from './feedback.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}

{
  console.log('\nfeedbackUrl');
  const u = new URL(feedbackUrl('0.18.1'));
  check('it is the repo\'s new-issue page', `${u.origin}${u.pathname}` === FEEDBACK_URL, FEEDBACK_URL);
  check('it is https on github.com', u.protocol === 'https:' && u.hostname === 'github.com');
  const body = u.searchParams.get('body') ?? '';
  check('the body carries the version', body.includes('afterterm version: 0.18.1'), body);
  check('the body asks what happened', body.startsWith('What happened'));
  check('the title is left for the person', !u.searchParams.has('title'));
  check('the URL is far under the 2000 character limit', feedbackUrl('0.18.1').length < 600);
}

{
  console.log('\nfeedbackUrl with a version that is not plain text');
  const u = new URL(feedbackUrl('1.0&title=x\n# hi'));
  const body = u.searchParams.get('body') ?? '';
  check('the version is left out', !body.includes('afterterm version'), body);
  check('no extra query value is smuggled in', !u.searchParams.has('title'));
  check('an empty version is left out too', !(new URL(feedbackUrl('')).searchParams.get('body') ?? '').includes('afterterm version'));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

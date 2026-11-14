// Send feedback (AFT-76): the new-issue page on GitHub, opened in the person's
// browser with their afterterm version already in the text. Pure, so it is
// unit-tested (feedback.test.ts) and the renderer can import it. The person needs
// a GitHub account to submit it, the same as the installer's report link.
import { REPO_URL } from './update-check.ts';

export const FEEDBACK_URL = `${REPO_URL}/issues/new`;

// The version goes into the body, not the title, so the person writes the title.
// A version that is not plain text (it is always digits and dots) is left out
// rather than put into a URL.
export function feedbackUrl(version: string): string {
  const v = /^[0-9A-Za-z.+-]{1,40}$/.test(version) ? version : '';
  const body = [
    'What happened, or what would you like afterterm to do?',
    '',
    '',
    '',
    v ? `afterterm version: ${v}` : '',
  ].join('\n');
  return `${FEEDBACK_URL}?body=${encodeURIComponent(body)}`;
}

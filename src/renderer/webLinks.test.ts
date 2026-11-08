// Unit tests for web links that run over several rows (AFT-61). The rows are laid
// out the way Claude Code 2.1.319 was measured to cut them in the dev build at 112
// columns: replies at full width with a 2 space indent, your own prompt one short,
// tool output five short with a 5 space indent.
// Run directly on Node 24+ (strips types):
//   node src/renderer/webLinks.test.ts
// Exits 0 if all pass, 1 on any failure.

import {
  linkStarts, followUrl, linkFromTranscript, linkFromColumns, linkPrefixes, resolveLinks, cutWidths, MAX_LINK_ROWS,
  type Row, type WebLink,
} from './webLinks.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}
const show = (v: unknown) => JSON.stringify(v);

const COLS = 112;
const U = 'https://example.com/authorize?response_type=code&client_id=https%3A%2F%2Fclaude.ai%2Foauth%2Fmetadata&code_challenge=kb6w0yJFQwSx4a3M4RqjDlPFj3wdmcun8vAMbqcgwsAAAA&code_challenge_method=S256&state=TESTSTATE0123456789';

const row = (text: string, wrapped = false): Row => ({ text: text.replace(/\s+$/, ''), width: text.replace(/\s+$/, '').length, wrapped });

/** Text cut the way Claude Code cuts it: `width` per row, later rows indented by `indent`. */
function cut(text: string, width: number, indent: number): Row[] {
  const out: Row[] = [row(text.slice(0, width))];
  for (let i = width; i < text.length; i += width - indent) out.push(row(' '.repeat(indent) + text.slice(i, i + width - indent)));
  return out;
}
/** The whole text a link's segments cover, joined. */
const shownText = (rows: Row[], link: WebLink) => link.segments.map(s => rows[s.row].text.slice(s.start, s.end)).join('');

console.log('where a link starts on a row');
check('one link', show(linkStarts('see https://a.b/c now')) === show([{ start: 4, end: 17 }]));
check('two links', linkStarts('https://a.b/c and http://d.e/f').length === 2);
check('a link inside another one\'s run is part of it', linkStarts('https://a.b/?redirect_uri=https://c.d/e').length === 1);
check('ends at a quote', linkStarts('echo "https://a.b/c"')[0].end === 'echo "https://a.b/c'.length);
check('ends at "…"', linkStarts('Bash(echo "https://a.b/c…)')[0].end === 'Bash(echo "https://a.b/c'.length);
check('the cut columns: three in a chat, one in a shell', show(cutWidths(112, true)) === show([112, 111, 107]) && show(cutWidths(112, false)) === show([112]));

console.log('\nthe cut column, in a chat');
{
  const rows = cut(`● ${U}`, COLS, 2);
  check('the measured layout: the first row is full width', rows[0].width === 112 && rows[0].text.endsWith('&code_cha'));
  const link = linkFromColumns(rows, 0, 2, rows[0].text.length, cutWidths(COLS, true), true);
  check('a reply\'s bare link opens whole', link?.url === U, link?.url);
  check('over its two rows, the indent left out', link?.segments.length === 2 && link.segments[1].start === 2);
}
{
  const rows = cut(`  Sign in to Test (${U})`, COLS, 2);
  const s = linkStarts(rows[0].text)[0];
  const link = linkFromColumns(rows, 0, s.start, s.end, cutWidths(COLS, true), true);
  check('a named link\'s "(link)": the bracket is not part of it', link?.url === U, link?.url);
  const lastSeg = link?.segments[link.segments.length - 1];
  check('its last row stops before the bracket', !!lastSeg && rows[lastSeg.row].text[lastSeg.end] === ')', show(link?.segments));
}
{
  const rows = cut(`  ⎿  ${U}`, COLS - 5, 5);
  check('tool output is cut five short', rows[0].width === 107);
  const link = linkFromColumns(rows, 0, 5, rows[0].text.length, cutWidths(COLS, true), true);
  check('a link in tool output opens whole, over three rows', link?.url === U && link.segments.length === 3, show(link));
}
{
  const rows = cut(`> ${U}`, COLS - 1, 2);
  const link = linkFromColumns(rows, 0, 2, rows[0].text.length, cutWidths(COLS, true), true);
  check('your own prompt is cut one short and opens whole', rows[0].width === 111 && link?.url === U);
}
{
  // ConPTY sometimes lets Claude Code's indent flow on as a wrap ("&state  =TEST...").
  const rows = cut(`● ${U}`, COLS, 2);
  rows[1].wrapped = true;
  check('a wrapped row with Claude Code\'s indent still joins in a chat', linkFromColumns(rows, 0, 2, rows[0].text.length, cutWidths(COLS, true), true)?.url === U);
}
{
  const rows = [row(`● ${U}`.slice(0, 100)), row('  ' + `● ${U}`.slice(100))];
  check('cut short of every cut column: not joined', linkFromColumns(rows, 0, 2, 100, cutWidths(COLS, true), true) === null);
}
{
  const end = '  see (https://example.com/abc)';
  const rows = [row(end.padStart(COLS, 'x').slice(-COLS)), row('  Next paragraph')];
  const s = linkStarts(rows[0].text)[0];
  check('the test row ends in the bracket at full width', rows[0].width === COLS && rows[0].text.endsWith('abc)'));
  check('a link closed by a bracket at the edge is not joined', linkFromColumns(rows, 0, s.start, s.end, cutWidths(COLS, true), true) === null);
}
{
  const rows = [row(`● Bash(echo "${U}`.slice(0, COLS)), row('      ' + U.slice(COLS - 13, COLS - 13 + 40) + '…)')];
  check('a line Claude Code shortened with "…" is not given out as whole', linkFromColumns(rows, 0, 13, COLS, cutWidths(COLS, true), true) === null);
}

console.log('\nthe cut column, in a shell');
{
  const text = `SOFTMARK ${U} for details`;
  const rows = [row(text.slice(0, COLS)), row(text.slice(COLS, 2 * COLS), true), row(text.slice(2 * COLS), true)];
  const s = linkStarts(rows[0].text)[0];
  check('a link the terminal wrapped opens whole', linkFromColumns(rows, 0, s.start, s.end, cutWidths(COLS, false), false)?.url === U);
}
{
  const rows = cut(U, COLS, 0);
  check('a program that cuts at full width: joined', linkFromColumns(rows, 0, 0, COLS, cutWidths(COLS, false), false)?.url === U);
}
{
  const rows = cut(`  ${U}`, 100, 2);
  check('a program that cut at 100 in a 112 column terminal: not joined', linkFromColumns(rows, 0, 2, 100, cutWidths(COLS, false), false) === null);
}
{
  const rows = cut(`  ⎿  ${U}`, COLS - 5, 5);
  check('five short is a chat\'s, not a shell\'s', linkFromColumns(rows, 0, 5, rows[0].text.length, cutWidths(COLS, false), false) === null);
}
{
  const first = 'x'.repeat(COLS - 20) + ' https://a.b/cdefghijk';
  const rows = [row(first.slice(0, COLS)), row(' more words', true)];
  const s = linkStarts(rows[0].text)[0];
  check('a wrapped row that starts with a space: the link ended at the edge', linkFromColumns(rows, 0, s.start, s.end, cutWidths(COLS, false), false) === null);
}

console.log('\nthe limitation of the column rule, and the transcript that removes it');
{
  const short = 'https://example.com/some/page/on/the/site/here';
  const first = '  see ' + short;
  const rows = [row(first.padStart(COLS, '.').slice(-COLS)), row('  documentation for details')];
  const s = linkStarts(rows[0].text)[0];
  const byColumns = linkFromColumns(rows, 0, s.start, s.end, cutWidths(COLS, true), true);
  check('a complete link ending exactly at the edge is joined to the next word by the column rule', byColumns?.url === short + 'documentation', byColumns?.url);
  const byTranscript = resolveLinks(rows, 0, { cols: COLS, chat: true, transcript: () => [short] });
  check('with the transcript it stays one row, the link itself', byTranscript.length === 1 && byTranscript[0].url === short && byTranscript[0].segments.length === 1, show(byTranscript));
}

console.log('\nthe transcript');
{
  const rows = cut(`● ${U}`, COLS, 2);
  const got = followUrl(rows, 0, 2, U, true);
  check('follows a link down its rows', got?.segments.length === 2 && !got.elided, show(got));
  check('the rows spell out exactly the link', !!got && got.segments.map(s => rows[s.row].text.slice(s.start, s.end)).join('') === U);
  check('a different link is not spelled out', followUrl(rows, 0, 2, U.replace('S256', 'plain'), true) === null);
}
{
  const other = U.replace('TESTSTATE0123456789', 'OTHERSTATE999');
  const rows = cut(`● ${other}`, COLS, 2);
  const link = linkFromTranscript(rows, 0, 2, [U, other], true);
  check('two links with the same first row: the rows below decide', link?.url === other, link?.url);
}
{
  const longer = 'https://a.example.com/path/one/two';
  const rows = [row(`  see ${longer} now`)];
  const link = linkFromTranscript(rows, 0, 6, ['https://a.example.com/path/one', longer], true);
  check('a shorter link that runs on into more link characters is not the one shown', link?.url === longer, link?.url);
}
{
  const rows = [row(`● Bash(echo "${U}`.slice(0, COLS)), row('      ' + U.slice(COLS - 13, COLS - 13 + 40) + '…)')];
  const link = linkFromTranscript(rows, 0, 13, [U], true);
  check('a link Claude Code shortened with "…" opens whole from the transcript', link?.url === U, show(link));
  check('underlined up to the "…"', !!link && rows[1].text[link.segments[1].end] === '…');
}
{
  // Seen in a real chat: the screen's shortened Bash line, and a shortened copy of the link
  // that ends exactly where the screen's does. The real link must win.
  const rows = [row(`● Bash(echo "${U}`.slice(0, COLS)), row('      ' + U.slice(COLS - 13, COLS - 13 + 40) + '…)')];
  const shortCopy = U.slice(0, COLS - 13 + 40);
  check('a link that stops just before "…" is not complete', followUrl(rows, 0, 13, shortCopy, true) === null);
  check('so the real link wins over a shortened copy', linkFromTranscript(rows, 0, 13, [shortCopy, U], true)?.url === U);
}
{
  const rows = [row('  (https://a.example.com/x) and more')];
  const link = linkFromTranscript(rows, 0, 3, ['https://a.example.com/x'], true);
  check('a link that ends before a bracket on its row', link?.segments[0].end === 3 + 'https://a.example.com/x'.length);
}

console.log('\nall the links on the rows');
{
  const rows = [...cut(`● ${U}`, COLS, 2), row(''), row('  plain https://b.example.org/x')];
  const asked = linkPrefixes(rows, rows.length - 1);
  check('the prefixes asked about: one per link start', asked.length === 2 && asked[0] === rows[0].text.slice(2), show(asked));
  const links = resolveLinks(rows, rows.length - 1, { cols: COLS, chat: true, transcript: () => [] });
  check('nothing in the transcript: the column rule; a one-row link is the addon\'s', links.length === 1 && links[0].url === U && links[0].how === 'columns', show(links));
  const withT = resolveLinks(rows, rows.length - 1, { cols: COLS, chat: true, transcript: p => (U.startsWith(p) ? [U] : ['https://b.example.org/x']) });
  check('from the transcript, both, the one-row one too', withT.length === 2 && withT[0].how === 'transcript' && withT[1].url === 'https://b.example.org/x', show(withT));
}
{
  const inner = 'https://example.com/a?' + 'x'.repeat(COLS - 30) + '&redirect_uri=https://other.example/cb&z=1';
  const rows = cut(`● ${inner}`, COLS, 2);
  check('the test link puts a second "https://" on its second row', rows[1].text.includes('https://other.example'));
  const links = resolveLinks(rows, rows.length - 1, { cols: COLS, chat: false });
  check('a link\'s own later rows are not read as starts', links.length === 1 && links[0].url === inner, show(links.map(l => l.url)));
}
{
  const long = 'https://example.com/' + 'a'.repeat(30 * MAX_LINK_ROWS);
  const rows = cut(long, 30, 0);
  const link = linkFromColumns(rows, 0, 0, 30, cutWidths(30, false), false);
  check('no more than MAX_LINK_ROWS rows', !!link && link.segments.length === MAX_LINK_ROWS);
}
{
  const rows = cut(`● ${U}`, COLS, 2);
  const links = resolveLinks(rows, 1, { cols: COLS, chat: true, transcript: () => [U] });
  check('asked from the second row, the link is still found from its start above', links.length === 1 && shownText(rows, links[0]) === U);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

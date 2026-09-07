// Unit tests for the Claude Code transcript reader: the projects folder name, the
// first prompt, the latest model, the display name and the chunked file read.
// Run directly on Node 24+ (strips types):
//   node src/claude-transcript.test.ts
// Exits 0 if all pass, 1 on any failure.
//
// These tests never touch the real ~/.claude. The file cases write fixtures into a
// throwaway folder under the OS temp dir and delete it at the end.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  firstPrompt,
  isSessionId,
  latestModel,
  latestModelAttachment,
  modelDisplayName,
  projectDirName,
  readTranscriptMeta,
  transcriptPath,
} from './claude-transcript.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}
const show = (v: unknown) => JSON.stringify(v);

const SESSION = '3b6838d6-02c1-4677-b7e6-cd713c0298a3';

// Line builders, so the tests read as transcript shapes rather than JSON soup.
const userLine = (content: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'user', isSidechain: false, ...extra, message: { role: 'user', content } });
const assistantLine = (model: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'assistant', isSidechain: false, ...extra, message: { role: 'assistant', model } });
const modelAttachment = (modelId: string) =>
  JSON.stringify({ type: 'attachment', isSidechain: false, attachment: { type: 'model', identity: { modelId, marketingName: modelId } } });

console.log('\nclaude-transcript: projectDirName\n');
{
  check('a plain repo path becomes dashes',
    projectDirName('D:\\Pitara\\Work\\Tinkering\\afterterm') === 'D--Pitara-Work-Tinkering-afterterm',
    projectDirName('D:\\Pitara\\Work\\Tinkering\\afterterm'));
  check('a worktree path keeps the dot folder as an extra dash',
    projectDirName('D:\\Pitara\\Work\\Tinkering\\afterterm\\.claude\\worktrees\\phase-2-home-and-projects')
      === 'D--Pitara-Work-Tinkering-afterterm--claude-worktrees-phase-2-home-and-projects',
    projectDirName('D:\\Pitara\\Work\\Tinkering\\afterterm\\.claude\\worktrees\\phase-2-home-and-projects'));
  check('spaces and dashes each become one dash',
    projectDirName('D:\\Pitara\\Learning\\Learning with AI\\Code - Netflix Recommendation System')
      === 'D--Pitara-Learning-Learning-with-AI-Code---Netflix-Recommendation-System',
    projectDirName('D:\\Pitara\\Learning\\Learning with AI\\Code - Netflix Recommendation System'));
  check('the transcript path joins the folder and the session id',
    transcriptPath('C:\\p', 'D:\\a', SESSION) === `C:\\p/D--a/${SESSION}.jsonl`,
    transcriptPath('C:\\p', 'D:\\a', SESSION));
}

console.log('\nclaude-transcript: isSessionId\n');
{
  check('a canonical UUID is a session id', isSessionId(SESSION) === true);
  check('a path fragment is not a session id', isSessionId('..\\..\\etc') === false);
  check('a non-string is not a session id', isSessionId(42) === false);
}

console.log('\nclaude-transcript: firstPrompt\n');
{
  const text = [userLine('Build the thing'), assistantLine('claude-opus-5')].join('\n') + '\n';
  check('a string content is the prompt', firstPrompt(text) === 'Build the thing', show(firstPrompt(text)));
}
{
  const text = userLine([{ type: 'text', text: 'Array form prompt' }]) + '\n';
  check('an array whose first part is text is the prompt',
    firstPrompt(text) === 'Array form prompt', show(firstPrompt(text)));
}
{
  const text = [
    userLine([{ tool_use_id: 'toolu_1', type: 'tool_result', content: 'b0f1d65 docs: something' }]),
    userLine('The real prompt'),
  ].join('\n') + '\n';
  check('a tool_result user line is skipped', firstPrompt(text) === 'The real prompt', show(firstPrompt(text)));
}
{
  const text = [
    userLine('Subagent instructions', { isSidechain: true }),
    userLine('The real prompt'),
  ].join('\n') + '\n';
  check('a sidechain user line is skipped', firstPrompt(text) === 'The real prompt', show(firstPrompt(text)));
}
{
  const text = [userLine('Meta line', { isMeta: true }), userLine('The real prompt')].join('\n') + '\n';
  check('an isMeta user line is skipped', firstPrompt(text) === 'The real prompt', show(firstPrompt(text)));
}
{
  const text = [userLine('/clear'), userLine('The real prompt')].join('\n') + '\n';
  check('a slash command is skipped', firstPrompt(text) === 'The real prompt', show(firstPrompt(text)));
}
{
  const text = [
    userLine('<command-name>/compact</command-name>'),
    userLine('<system-reminder>be careful</system-reminder>'),
    userLine('The real prompt'),
  ].join('\n') + '\n';
  check('an XML wrapped content is skipped', firstPrompt(text) === 'The real prompt', show(firstPrompt(text)));
}
{
  const text = [assistantLine('claude-opus-5'), userLine('Kept prompt'), '{"type":"user","isSid'].join('\n');
  check('a partial trailing line is ignored', firstPrompt(text) === 'Kept prompt', show(firstPrompt(text)));
}
{
  const text = userLine('  Line one   with    gaps\nline two ignored  ') + '\n';
  check('whitespace collapses and only the first line is kept',
    firstPrompt(text) === 'Line one with gaps', show(firstPrompt(text)));
}
{
  const long = 'x'.repeat(200);
  const got = firstPrompt(userLine(long) + '\n');
  check('a long prompt is cut to 120 characters plus an ellipsis',
    got === 'x'.repeat(120) + '…', `${got?.length} chars`);
  const short = 'y'.repeat(120);
  check('a prompt of exactly 120 characters is not cut',
    firstPrompt(userLine(short) + '\n') === short);
}
{
  check('an empty file has no prompt', firstPrompt('') === null);
  check('a file with only assistant lines has no prompt',
    firstPrompt(assistantLine('claude-opus-5') + '\n') === null);
  check('a user line with empty content has no prompt', firstPrompt(userLine('   ') + '\n') === null);
}

console.log('\nclaude-transcript: latestModel\n');
{
  const text = [
    modelAttachment('claude-opus-5[1m]'),
    assistantLine('claude-opus-5'),
    assistantLine('claude-opus-5'),
  ].join('\n') + '\n';
  check('a matching attachment gives the context suffix back',
    latestModel(text) === 'claude-opus-5[1m]', show(latestModel(text)));
}
{
  const text = [
    modelAttachment('claude-opus-5[1m]'),
    assistantLine('claude-opus-5'),
    assistantLine('claude-sonnet-5'),
  ].join('\n') + '\n';
  check('after a /model switch the assistant model wins without a suffix',
    latestModel(text) === 'claude-sonnet-5', show(latestModel(text)));
}
{
  const text = [assistantLine('claude-opus-5'), assistantLine('<synthetic>')].join('\n') + '\n';
  check('a synthetic assistant model is skipped',
    latestModel(text) === 'claude-opus-5', show(latestModel(text)));
}
{
  const text = [assistantLine('claude-opus-5'), assistantLine('claude-haiku-4-5', { isSidechain: true })].join('\n') + '\n';
  check('a sidechain assistant model is skipped',
    latestModel(text) === 'claude-opus-5', show(latestModel(text)));
}
{
  const text = ['del","message":{"model":"claude-haiku-4-5"}}', assistantLine('claude-fable-5-1')].join('\n') + '\n';
  check('a partial leading line is ignored',
    latestModel(text) === 'claude-fable-5-1', show(latestModel(text)));
}
{
  check('an attachment alone gives the model', latestModel(modelAttachment('claude-opus-5[1m]') + '\n') === 'claude-opus-5[1m]');
  check('no assistant and no attachment gives null', latestModel(userLine('hi') + '\n') === null);
  check('an empty tail gives null', latestModel('') === null);
}
{
  const head = [modelAttachment('claude-opus-5[1m]'), userLine('hi')].join('\n') + '\n';
  check('the head attachment is found on its own',
    latestModelAttachment(head) === 'claude-opus-5[1m]', show(latestModelAttachment(head)));
  check('a chunk with no attachment gives null',
    latestModelAttachment(assistantLine('claude-opus-5') + '\n') === null);
  const tail = assistantLine('claude-opus-5') + '\n';
  check('a fallback attachment from the head restores the suffix',
    latestModel(tail, 'claude-opus-5[1m]') === 'claude-opus-5[1m]', show(latestModel(tail, 'claude-opus-5[1m]')));
  check('a fallback attachment for another model is ignored',
    latestModel(tail, 'claude-haiku-4-5[1m]') === 'claude-opus-5', show(latestModel(tail, 'claude-haiku-4-5[1m]')));
  const tailWithAttachment = [modelAttachment('claude-opus-5'), assistantLine('claude-opus-5')].join('\n') + '\n';
  check('the tail attachment wins over the head one',
    latestModel(tailWithAttachment, 'claude-opus-5[1m]') === 'claude-opus-5',
    show(latestModel(tailWithAttachment, 'claude-opus-5[1m]')));
}

console.log('\nclaude-transcript: modelDisplayName\n');
{
  const cases: [string, string][] = [
    ['claude-opus-5', 'Opus 5'],
    ['claude-opus-5[1m]', 'Opus 5 \u00b7 1M'],
    ['claude-sonnet-5', 'Sonnet 5'],
    ['claude-fable-5-1', 'Fable 5.1'],
    ['claude-fable-5', 'Fable 5'],
    ['claude-haiku-4-5-20251001', 'Haiku 4.5'],
    ['sonnet', 'Sonnet'],
    ['opus', 'Opus'],
    ['haiku', 'Haiku'],
    ['OPUS', 'Opus'],
    ['my-model', 'my-model'],
    ['', ''],
  ];
  for (const [id, want] of cases) {
    const got = modelDisplayName(id);
    check(`${show(id)} displays as ${show(want)}`, got === want, show(got));
  }
}

console.log('\nclaude-transcript: readTranscriptMeta\n');
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'afterterm-transcript-'));
  const projects = path.join(root, 'projects');
  const cwd = 'D:\\Pitara\\Work\\Tinkering\\afterterm';
  const dir = path.join(projects, projectDirName(cwd));
  fs.mkdirSync(dir, { recursive: true });

  // A small file: head and tail are the same read.
  const small = [
    modelAttachment('claude-opus-5[1m]'),
    userLine('Small file prompt'),
    assistantLine('claude-opus-5'),
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(dir, `${SESSION}.jsonl`), '\uFEFF' + small, 'utf-8');
  const meta = readTranscriptMeta(projects, cwd, SESSION, fs);
  check('a small file gives the prompt', meta.firstPrompt === 'Small file prompt', show(meta.firstPrompt));
  check('a small file gives the model', meta.model === 'claude-opus-5[1m]', show(meta.model));
  check('a small file exists', meta.exists === true);

  // A file above 512 KB: the prompt only in the head, the model only in the tail,
  // and half a megabyte of filler in the middle that is never read.
  const BIG = 'ee0e0e0e-0000-4000-8000-000000000001';
  const filler = JSON.stringify({ type: 'attachment', attachment: { type: 'environment' }, pad: 'p'.repeat(400) });
  const lines = [userLine('Head only prompt')];
  for (let i = 0; i < 3000; i++) lines.push(filler);
  lines.push(assistantLine('claude-fable-5-1'));
  const bigText = lines.join('\n') + '\n';
  fs.writeFileSync(path.join(dir, `${BIG}.jsonl`), bigText, 'utf-8');
  check('the fixture really is above 512 KB', fs.statSync(path.join(dir, `${BIG}.jsonl`)).size > 512 * 1024,
    String(fs.statSync(path.join(dir, `${BIG}.jsonl`)).size));
  const bigMeta = readTranscriptMeta(projects, cwd, BIG, fs);
  check('a big file gives the prompt from the head',
    bigMeta.firstPrompt === 'Head only prompt', show(bigMeta.firstPrompt));
  check('a big file gives the model from the tail',
    bigMeta.model === 'claude-fable-5-1', show(bigMeta.model));

  // The same shape, but with the session-start model attachment in the head: it is
  // the only place "[1m]" is written, and on a long session it never reaches the
  // tail window, so the suffix has to come from the head read.
  const BIG_1M = 'ee0e0e0e-0000-4000-8000-000000000002';
  const lines1m = [modelAttachment('claude-opus-5[1m]'), userLine('Long opus session')];
  for (let i = 0; i < 3000; i++) lines1m.push(filler);
  lines1m.push(assistantLine('claude-opus-5'));
  fs.writeFileSync(path.join(dir, `${BIG_1M}.jsonl`), lines1m.join('\n') + '\n', 'utf-8');
  const meta1m = readTranscriptMeta(projects, cwd, BIG_1M, fs);
  check('a big file takes the context suffix from the head attachment',
    meta1m.model === 'claude-opus-5[1m]', show(meta1m.model));

  // A head attachment for a different family than the tail's assistant model says
  // nothing about the current turn, so it must not put a suffix on it.
  const BIG_SWITCH = 'ee0e0e0e-0000-4000-8000-000000000003';
  const linesSwitch = [modelAttachment('claude-opus-5[1m]'), userLine('Switched mid session')];
  for (let i = 0; i < 3000; i++) linesSwitch.push(filler);
  linesSwitch.push(assistantLine('claude-sonnet-5'));
  fs.writeFileSync(path.join(dir, `${BIG_SWITCH}.jsonl`), linesSwitch.join('\n') + '\n', 'utf-8');
  const metaSwitch = readTranscriptMeta(projects, cwd, BIG_SWITCH, fs);
  check('a head attachment for another model leaves the assistant model unchanged',
    metaSwitch.model === 'claude-sonnet-5', show(metaSwitch.model));

  const missing = readTranscriptMeta(projects, cwd, 'ffffffff-0000-4000-8000-000000000002', fs);
  check('a missing file gives the not found result',
    missing.exists === false && missing.firstPrompt === null && missing.model === null, show(missing));

  const badId = readTranscriptMeta(projects, cwd, 'not-a-uuid', fs);
  check('an invalid session id gives the not found result without a read',
    badId.exists === false, show(badId));

  const badCwd = readTranscriptMeta(projects, '', SESSION, fs);
  check('an empty cwd gives the not found result', badCwd.exists === false, show(badCwd));

  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);

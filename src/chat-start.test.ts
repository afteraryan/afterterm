// Tests for `afterterm chat start` (AFT-126): the request rules (chat-start.ts) and
// the life of a request in main with a fake clock (chat-starter.ts). Run on Node 24+:
//   node src/chat-start.test.ts

import { CHAT_HELP, REQUEST_TTL_MS, startEffort, chatRequestFrom, claudeCommand, cleanPrompt, outcomeReply, pasteText, type ChatOutcome, type ChatRequest } from './chat-start.ts';
import { ChatStarter, DELIVER_TIMEOUT_MS, ENTER_DELAY_MS, OPEN_TIMEOUT_MS, QUIET_MS, READY_TIMEOUT_MS, type StarterDeps } from './chat-starter.ts';
import type { LoopsContext } from './loops-cli.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}

const SID = '11111111-2222-4333-8444-555555555555';
const ids = { id: 'req1', sessionId: SID };
const ctx: LoopsContext = {
  projects: [
    { id: 'p1', name: 'afterterm', folder: 'D:\\code\\afterterm' },
    { id: 'p2', name: 'NoFolder' },
  ],
  threads: [{ id: 't9', project: 'p1' }],
};
const env = { thread: 't9', cwd: 'D:\\code\\afterterm' };
const ask = (argv: string[], stdin?: string) => chatRequestFrom(ctx, env, argv, stdin, ids, 1000);

console.log('chatRequestFrom');
{
  const r = ask(['chat', 'start', '--project', 'afterterm', '--model', 'opus', '--effort', 'high'], 'Fix the rail\n');
  check('a full request is made', 'request' in r);
  if ('request' in r) {
    check('project and folder', r.request.projectId === 'p1' && r.request.folder === 'D:\\code\\afterterm');
    check('model and effort', r.request.model === 'opus' && r.request.effort === 'high');
    check('prompt from stdin, trimmed', r.request.prompt === 'Fix the rail');
    check('the thread that asked', r.request.fromThread === 't9');
  }
  const noModel = ask(['chat', 'start', '--project', 'afterterm'], 'x');
  check('no model is refused (no default)', 'reply' in noModel && /--model/.test(noModel.reply.err));
  const badModel = ask(['chat', 'start', '--project', 'afterterm', '--model', 'opus; rm -rf'], 'x');
  check('a model with shell characters is refused', 'reply' in badModel && badModel.reply.code === 2);
  const badEffort = ask(['chat', 'start', '--project', 'afterterm', '--model', 'opus', '--effort', 'huge'], 'x');
  check('an unknown effort is refused', 'reply' in badEffort && /effort/.test(badEffort.reply.err));
  const noPrompt = ask(['chat', 'start', '--project', 'afterterm', '--model', 'opus'], undefined);
  check('no prompt is refused', 'reply' in noPrompt && /stdin/.test(noPrompt.reply.err));
  const flagPrompt = ask(['chat', 'start', '--project', 'afterterm', '--model', 'sonnet', '--prompt', 'Hello there'], undefined);
  check('--prompt works', 'request' in flagPrompt && flagPrompt.request.prompt === 'Hello there' && flagPrompt.request.effort === null);
  const general = ask(['chat', 'start', '--project', 'general', '--model', 'opus'], 'x');
  check('general has no folder: refused', 'reply' in general && /folder/.test(general.reply.err));
  const noFolder = ask(['chat', 'start', '--project', 'NoFolder', '--model', 'opus'], 'x');
  check('a project with no folder is refused', 'reply' in noFolder && /no folder/.test(noFolder.reply.err));
  const unknown = ask(['chat', 'start', '--project', 'nope', '--model', 'opus'], 'x');
  check('an unknown project is refused', 'reply' in unknown && /No project/.test(unknown.reply.err));
  const help = ask(['chat', 'help']);
  check('help prints the usage', 'reply' in help && help.reply.code === 0 && help.reply.out === CHAT_HELP);
  const long = ask(['chat', 'start', '--project', 'afterterm', '--model', 'opus'], 'a'.repeat(100_001));
  check('a prompt over 100,000 characters is refused', 'reply' in long && /most/.test(long.reply.err));
}

console.log('the command line and the paste');
{
  check('command with effort', claudeCommand(SID, 'opus', 'max') === `claude --session-id ${SID} --model opus --effort max`);
  check('command without effort', claudeCommand(SID, 'claude-opus-5-5', null) === `claude --session-id ${SID} --model claude-opus-5-5`);
  check('a bad session id makes no command', claudeCommand('not-a-uuid', 'opus', null) === null);
  check('a bad model makes no command', claudeCommand(SID, 'op us', null) === null);
  check('ESC is taken out of a prompt', !cleanPrompt('a\x1b[201~b').includes('\x1b'));
  check('newlines are kept', cleanPrompt('a\r\nb') === 'a\nb');
  const paste = pasteText('line one\nline two\x1b[201~ evil');
  check('the paste is bracketed once', paste.startsWith('\x1b[200~') && paste.endsWith('\x1b[201~') && paste.split('\x1b[201~').length === 2);
  check('newlines are CR inside the paste', paste.includes('line one\rline two'));
}

console.log('startEffort');
{
  check('haiku starts on high', startEffort('haiku') === 'high');
  check('sonnet, opus and fable start on medium', startEffort('sonnet') === 'medium' && startEffort('opus') === 'medium' && startEffort('fable') === 'medium');
  check('a full model id finds its family', startEffort('claude-haiku-5-5') === 'high' && startEffort('claude-opus-5-5') === 'medium');
  check('an unknown model starts on medium', startEffort('something-else') === 'medium');
}

console.log('outcomeReply');
{
  check('started is exit 0 with the name', outcomeReply({ kind: 'started', name: 'Fix the rail', projectName: 'afterterm', model: 'opus', effort: null }).out.includes('Fix the rail'));
  check('declined is exit 3', outcomeReply({ kind: 'declined' }).code === 3);
  check('expired is exit 4', outcomeReply({ kind: 'expired' }).code === 4);
  check('failed is exit 1', outcomeReply({ kind: 'failed', reason: 'x' }).code === 1);
}

// ---------- the starter, with a fake clock ----------

function harness() {
  let now = 0;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 1;
  const shown: string[] = [];
  const closed: string[] = [];
  const written: string[] = [];
  const state = { status: null as string | null, lastOutput: null as number | null, user: false, hasPty: true };
  const deps: StarterDeps = {
    now: () => now,
    setTimer: (fn, ms) => { const id = nextId++; timers.push({ at: now + ms, fn, id }); return id; },
    clearTimer: (h) => { timers = timers.filter(t => t.id !== h); },
    show: (v) => shown.push(v.id),
    close: (id) => closed.push(id),
    recordStatus: () => state.status,
    lastOutputAt: () => (state.hasPty ? state.lastOutput : null),
    write: (_tab, data) => { if (!state.hasPty) return false; written.push(data); return true; },
    hasUserMessage: () => state.user,
    threadName: async () => 'New chat',
    log: () => {},
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (!t || t.at > end) break;
      timers.shift();
      now = t.at;
      t.fn();
    }
    now = end;
  };
  return { deps, advance, shown, closed, written, state, starter: new ChatStarter(deps), get now() { return now; } };
}
const request = (): ChatRequest => ({
  id: 'r1', sessionId: SID, projectId: 'p1', projectName: 'afterterm', folder: 'D:\\code\\afterterm',
  model: 'opus', effort: null, prompt: 'Fix the rail', fromThread: 't9', createdAt: 0,
});
const flush = () => new Promise((r) => setTimeout(r, 0));

console.log('ChatStarter');
await (async () => {
  const h = harness();
  let out: ChatOutcome | null = null;
  void h.starter.ask(request()).then((o) => { out = o; });
  check('the window is shown', h.shown[0] === 'r1');
  h.starter.decline('r1');
  await flush();
  check('decline ends it', (out as ChatOutcome | null)?.kind === 'declined' && h.closed[0] === 'r1');
})();

await (async () => {
  const h = harness();
  let out: ChatOutcome | null = null;
  void h.starter.ask(request()).then((o) => { out = o; });
  h.advance(REQUEST_TTL_MS - 1);
  check('not expired a moment before 10 minutes', out === null);
  h.advance(1);
  await flush();
  check('expired at 10 minutes', (out as ChatOutcome | null)?.kind === 'expired');
  check('a request that ended cannot be approved', h.starter.approve('r1', 'opus', null) === null);
})();

await (async () => {
  const h = harness();
  let out: ChatOutcome | null = null;
  void h.starter.ask(request()).then((o) => { out = o; });
  check('an invalid model choice is refused', h.starter.approve('r1', 'bad model', null) === null);
  const a = h.starter.approve('r1', 'sonnet', 'low');
  check('approve gives the line with Aryan\'s choices', a?.command === `claude --session-id ${SID} --model sonnet --effort low`);
  h.advance(1000);
  await flush();
  check('an approved request is still running', out === null);
  h.starter.opened('r1', 'tab1');
  h.state.lastOutput = h.now;
  h.advance(5000);
  check('nothing is typed before Claude Code says idle', h.written.length === 0);
  h.state.status = 'idle';
  h.state.lastOutput = h.now;
  h.advance(QUIET_MS - 300);
  check('nothing is typed while the screen is still moving', h.written.length === 0);
  h.advance(1000);
  check('the paste is typed once idle and quiet', h.written.length >= 1 && h.written[0].includes('Fix the rail'));
  h.advance(ENTER_DELAY_MS);
  check('then Enter', h.written[1] === '\r');
  h.state.user = true;
  h.advance(600);
  await flush();
  check('started once the transcript holds the message', (out as ChatOutcome | null)?.kind === 'started' && (out as { name?: string } | null)?.name === 'New chat');
})();

await (async () => {
  const h = harness();
  let out: ChatOutcome | null = null;
  void h.starter.ask(request()).then((o) => { out = o; });
  h.starter.approve('r1', 'opus', null);
  h.advance(OPEN_TIMEOUT_MS + 1);
  await flush();
  check('fails when the thread is never made', (out as ChatOutcome | null)?.kind === 'failed');
})();

await (async () => {
  const h = harness();
  let out: ChatOutcome | null = null;
  void h.starter.ask(request()).then((o) => { out = o; });
  h.starter.approve('r1', 'opus', null);
  h.starter.opened('r1', 'tab1');
  h.state.lastOutput = 0;
  h.advance(READY_TIMEOUT_MS + 1000);
  await flush();
  check('fails when Claude Code never becomes ready', (out as ChatOutcome | null)?.kind === 'failed' && h.written.length === 0);
})();

await (async () => {
  const h = harness();
  let out: ChatOutcome | null = null;
  void h.starter.ask(request()).then((o) => { out = o; });
  h.starter.approve('r1', 'opus', null);
  h.starter.opened('r1', 'tab1');
  h.state.status = 'idle';
  h.state.lastOutput = 0;
  h.advance(2000);
  h.advance(DELIVER_TIMEOUT_MS + 1000);
  await flush();
  check('fails when the message never reaches the transcript', (out as ChatOutcome | null)?.kind === 'failed');
})();

await (async () => {
  const h = harness();
  let out: ChatOutcome | null = null;
  void h.starter.ask(request()).then((o) => { out = o; });
  h.starter.approve('r1', 'opus', null);
  h.starter.opened('r1', 'tab1');
  h.state.hasPty = false;
  h.advance(11_000);
  await flush();
  check('fails when the thread was closed before it was ready', (out as ChatOutcome | null)?.kind === 'failed');
})();

await (async () => {
  const h = harness();
  void h.starter.ask(request());
  check('a waiting request is listed for a reloaded window', h.starter.waiting().length === 1);
  h.starter.approve('r1', 'opus', null);
  check('an approved one is not', h.starter.waiting().length === 0);
})();

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

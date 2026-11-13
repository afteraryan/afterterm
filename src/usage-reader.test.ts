// Unit tests for the usage reader's bookkeeping (AFT-88). Run directly on Node 24+ (strips types):
//   node src/usage-reader.test.ts
// Exits 0 if all pass, 1 on any failure.
//
// A real read needs a real Claude Code, so it is not tested here. What is tested is what happens when
// Claude Code cannot be started: the reader must report it, and the next read must try again. (Until
// AFT-88 a failed start left the reader believing a run was still going, and every later read did nothing.)

import os from 'node:os';
import path from 'node:path';
import { cleanEnv, createUsageReader } from './usage-reader.ts';
import type { UsageState } from './usage-screen.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const scratch = path.join(os.tmpdir(), 'afterterm-usage-reader-test');

async function main() {
  console.log('\nusage-reader: the environment the hidden Claude Code gets\n');
  {
    const env = cleanEnv({ PATH: 'C:\\bin', HOME: 'C:\\h', AFTERTERM: '1', CLAUDECODE: '1', CLAUDE_CODE_CHILD_SESSION: 'x', CLAUDE_CODE_ENTRYPOINT: 'cli', MY_OWN: 'keep' });
    check('afterterm\'s own marker is removed', !('AFTERTERM' in env));
    check('the marker that says "inside Claude Code" is removed', !('CLAUDECODE' in env));
    check('every CLAUDE_CODE_ variable is removed', !Object.keys(env).some((k) => k.startsWith('CLAUDE_CODE_')));
    check('everything else is kept', env.PATH === 'C:\\bin' && env.HOME === 'C:\\h' && env.MY_OWN === 'keep');
    check('an unset variable is not carried over', !('GONE' in cleanEnv({ GONE: undefined })));
  }

  console.log('\nusage-reader: Claude Code that cannot be started\n');
  {
    const seen: UsageState[] = [];
    const reader = createUsageReader({
      cwd: scratch,
      findClaudePath: () => path.join(scratch, 'does', 'not', 'exist', 'claude.exe'),
      onChange: (s) => seen.push(s),
    });
    reader.read();
    await wait(300);
    check('the first read reports that Claude Code was not found', reader.state().status === 'error' && reader.state().error === 'not-installed', JSON.stringify(reader.state()));
    const before = seen.length;
    reader.read();
    await wait(300);
    check('a second read tries again (it is not stuck)', seen.length > before, `onChange calls: ${before} then ${seen.length}`);
    check('and reports the same error again', reader.state().status === 'error' && reader.state().error === 'not-installed');
    const mid = seen.length;
    reader.read();
    await wait(300);
    check('a third read still tries again', seen.length > mid);
    check('the second try went through loading first', seen.slice(before).some((s) => s.status === 'loading'));
  }

  console.log('\nusage-reader: no Claude Code installed at all\n');
  {
    let calls = 0;
    const reader = createUsageReader({ cwd: scratch, findClaudePath: () => { calls++; return null; }, onChange: () => {} });
    reader.read();
    check('no executable found reports not-installed at once', reader.state().status === 'error' && reader.state().error === 'not-installed');
    reader.read();
    check('and the next read looks again, in case it was installed meanwhile', calls === 2, `looked ${calls} times`);
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

main();

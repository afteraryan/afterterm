// Unit tests for what the usage card shows. Run directly on Node 24+ (strips types):
//   node src/renderer/usageView.test.ts
// Exits 0 if all pass, 1 on any failure.

import { BIG_NUMBER, breakdownPhase, failText, isBigNumber, isReading, limitTone, limitsPhase } from './usageView.ts';
import type { UsageState } from '../usage-screen.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}

const limits = [{ id: 'session', label: 'Current session', percent: 4, reset: 'Resets at 3:20 AM' }];
const state = (p: Partial<UsageState>): UsageState => ({ status: 'idle', usage: null, updated: null, error: null, ...p });
const withUsage = (breakdown: boolean, scanning = false) => ({ limits, breakdown: breakdown ? { tips: [], groups: [] } : null, scanning });

console.log('\nusageView: bar tones and big numbers\n');
{
  check('4% is blue', limitTone(4) === 'ok');
  check('74% is still blue', limitTone(74) === 'ok');
  check('75% turns yellow', limitTone(75) === 'warn');
  check('89% is yellow', limitTone(89) === 'warn');
  check('90% turns red', limitTone(90) === 'crit');
  check('the big-number line is 50', BIG_NUMBER === 50);
  check('49 is not big', isBigNumber(49) === false);
  check('50 is big', isBigNumber(50) === true);
  check('76 is big', isBigNumber(76) === true);
}

console.log('\nusageView: the limits phase\n');
{
  check('no state yet is a skeleton', limitsPhase(null) === 'skeleton');
  check('loading with no numbers is a skeleton', limitsPhase(state({ status: 'loading' })) === 'skeleton');
  check('limits on screen are ready, even while still loading', limitsPhase(state({ status: 'loading', usage: withUsage(false) })) === 'ready');
  check('a finished read is ready', limitsPhase(state({ status: 'ready', usage: withUsage(true) })) === 'ready');
  check('an error with no numbers has failed', limitsPhase(state({ status: 'error', error: 'timeout' })) === 'failed');
  check('an error that keeps the last numbers stays ready', limitsPhase(state({ status: 'error', error: 'timeout', usage: withUsage(true) })) === 'ready');
}

console.log('\nusageView: the breakdown phase\n');
{
  check('no state yet is a skeleton', breakdownPhase(null) === 'skeleton');
  check('loading with limits but no breakdown is a skeleton', breakdownPhase(state({ status: 'loading', usage: withUsage(false, true) })) === 'skeleton');
  check('a breakdown is ready', breakdownPhase(state({ status: 'loading', usage: withUsage(true) })) === 'ready');
  check('a refresh keeps the old breakdown', breakdownPhase(state({ status: 'loading', updated: 1, usage: withUsage(true) })) === 'ready');
  check('a finished read with none is none', breakdownPhase(state({ status: 'ready', usage: withUsage(false) })) === 'none');
  check('a finished read still scanning is a skeleton', breakdownPhase(state({ status: 'ready', usage: withUsage(false, true) })) === 'skeleton');
}

console.log('\nusageView: reading and failing\n');
{
  check('loading is reading', isReading(state({ status: 'loading' })) === true);
  check('ready is not reading', isReading(state({ status: 'ready' })) === false);
  check('no state is not reading', isReading(null) === false);
  check('not installed says so', failText('not-installed') === 'Claude Code was not found');
  check('anything else is one plain line', failText('timeout') === "Couldn't read usage" && failText(null) === "Couldn't read usage");
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

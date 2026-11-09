// Unit tests for notify-hold.ts. Run directly on Node 24+ (strips types):
//   node src/notify-hold.test.ts
// Exits 0 if all pass, 1 on any failure.

import {
  HOLD_POLL_MS, NOTIFY_STATES, holdsToasts, parseProbeLine, stateWord, initialHold, holdStep,
} from './notify-hold.ts';
import type { HoldEvent, HoldStep, NotifyState, OverlayHold } from './notify-hold.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}
const show = (v: unknown) => JSON.stringify(v);

// The actions a step asks for, as a short list, for readable checks.
function actions(s: HoldStep): string {
  return (['hide', 'show', 'probe', 'poll', 'stopPoll'] as const).filter(k => s[k]).join(',');
}

// Plays events from a starting hold and returns every step.
function play(start: OverlayHold, events: HoldEvent[]): HoldStep[] {
  const steps: HoldStep[] = [];
  let hold = start;
  for (const e of events) {
    const s = holdStep(hold, e);
    steps.push(s);
    hold = s.next;
  }
  return steps;
}
const push: HoldEvent = { type: 'push' };
const emptied: HoldEvent = { type: 'emptied' };
const poll: HoldEvent = { type: 'poll' };
const answer = (state: NotifyState): HoldEvent => ({ type: 'answer', state });

console.log('\nnotify-hold: which states hold the toasts\n');
{
  check('busy (a full-screen app in front) holds', holdsToasts('busy'));
  check('Direct3D full screen holds', holdsToasts('fullscreen'));
  check('presentation mode holds', holdsToasts('presentation'));
  check('accepts notifications shows', !holdsToasts('accepts'));
  check('unknown (a failed probe) shows', !holdsToasts('unknown'));
  check('not present (locked, screen saver) shows', !holdsToasts('not-present'));
  check('quiet time shows', !holdsToasts('quiet-time'));
  check('a Store app in front shows', !holdsToasts('app'));
  check('a foreground window covering its monitor holds', holdsToasts('window-fullscreen'));
  check('exactly four states hold', NOTIFY_STATES.filter(holdsToasts).length === 4);
  check('the poll is every 3 seconds', HOLD_POLL_MS === 3000);
}

console.log('\nnotify-hold: reading the helper\'s answer\n');
{
  check('quns=1 is not-present', parseProbeLine('quns=1') === 'not-present');
  check('quns=2 is busy', parseProbeLine('quns=2') === 'busy');
  check('quns=3 is fullscreen', parseProbeLine('quns=3') === 'fullscreen');
  check('quns=4 is presentation', parseProbeLine('quns=4') === 'presentation');
  check('quns=5 is accepts', parseProbeLine('quns=5') === 'accepts');
  check('quns=6 is quiet-time', parseProbeLine('quns=6') === 'quiet-time');
  check('quns=7 is app', parseProbeLine('quns=7') === 'app');
  check('a carriage return and spaces are fine', parseProbeLine('  quns=2\r') === 'busy');
  check('a value Windows may add later is unknown', parseProbeLine('quns=8') === 'unknown');
  check('quns=0 is unknown', parseProbeLine('quns=0') === 'unknown');
  check('a failed call (hr=) is unknown', parseProbeLine('hr=-2147467259') === 'unknown');
  check('"error" is unknown', parseProbeLine('error') === 'unknown');
  check('an empty line is unknown', parseProbeLine('') === 'unknown');
  check('a byte order mark in front still reads (PowerShell 5.1 can write one)', parseProbeLine('\uFEFFquns=2') === 'busy');
  check('text around the value is unknown', parseProbeLine('quns=2 extra') === 'unknown');
  check('a negative number is unknown', parseProbeLine('quns=-2') === 'unknown');
}

console.log('\nnotify-hold: the foreground window signal\n');
{
  check('accepts and fg=0 is accepts', parseProbeLine('quns=5 fg=0') === 'accepts');
  check('accepts and fg=1 holds as window-fullscreen', parseProbeLine('quns=5 fg=1') === 'window-fullscreen');
  check('busy and fg=1 names Windows\' reason', parseProbeLine('quns=2 fg=1') === 'busy');
  check('presentation and fg=0 is presentation', parseProbeLine('quns=4 fg=0') === 'presentation');
  check('Direct3D full screen and fg=1 is fullscreen', parseProbeLine('quns=3 fg=1') === 'fullscreen');
  check('a Store app and fg=1 holds as window-fullscreen', parseProbeLine('quns=7 fg=1') === 'window-fullscreen');
  check('not present (locked) and fg=1 holds as window-fullscreen', parseProbeLine('quns=1 fg=1') === 'window-fullscreen');
  check('Windows\' call failed, fg=1: held', parseProbeLine('quns=err fg=1') === 'window-fullscreen');
  check('Windows\' call failed, fg=0: unknown, shows', parseProbeLine('quns=err fg=0') === 'unknown');
  check('both failed: unknown', parseProbeLine('quns=err fg=err') === 'unknown');
  check('the foreground check failed: Windows\' answer stands', parseProbeLine('quns=5 fg=err') === 'accepts');
  check('the foreground check failed with busy: busy', parseProbeLine('quns=2 fg=err') === 'busy');
  check('the order does not matter', parseProbeLine('fg=1 quns=5') === 'window-fullscreen');
  check('a carriage return after the pair is fine', parseProbeLine('quns=5 fg=1\r') === 'window-fullscreen');
  check('fg=1 alone holds', parseProbeLine('fg=1') === 'window-fullscreen');
  check('fg=2 is not 1, so it does not hold', parseProbeLine('quns=5 fg=2') === 'accepts');
  check('an unknown token makes the whole line unknown', parseProbeLine('quns=5 fg=1 x=1') === 'unknown');
  check('window-fullscreen is an override word too', stateWord('window-fullscreen') === 'window-fullscreen');
}

console.log('\nnotify-hold: afterterm\'s own window in front (its own full screen)\n');
{
  check('busy with afterterm in front does not hold', parseProbeLine('quns=2 fg=own') === 'afterterm-in-front');
  check('Direct3D full screen with afterterm in front does not hold', parseProbeLine('quns=3 fg=own') === 'afterterm-in-front');
  check('afterterm-in-front shows', !holdsToasts('afterterm-in-front'));
  check('presentation mode still holds with afterterm in front', parseProbeLine('quns=4 fg=own') === 'presentation');
  check('accepts with afterterm in front is accepts', parseProbeLine('quns=5 fg=own') === 'accepts');
  check('Windows failed with afterterm in front: unknown, shows', parseProbeLine('quns=err fg=own') === 'unknown');
  check('fg=own alone is unknown, shows', parseProbeLine('fg=own') === 'unknown');
  check('the order does not matter with fg=own', parseProbeLine('fg=own quns=2') === 'afterterm-in-front');
  check('afterterm-in-front is an override word too', stateWord('afterterm-in-front') === 'afterterm-in-front');
}

console.log('\nnotify-hold: the override words\n');
{
  check('busy', stateWord('busy') === 'busy');
  check('fullscreen', stateWord('fullscreen') === 'fullscreen');
  check('presentation', stateWord('presentation') === 'presentation');
  check('accepts', stateWord('accepts') === 'accepts');
  check('unknown', stateWord('unknown') === 'unknown');
  check('case and spaces do not matter (a file with a newline)', stateWord('  BUSY\r\n') === 'busy');
  check('a path is not a word', stateWord('C:\\temp\\state.txt') === null);
  check('an empty value is not a word', stateWord('') === null);
  check('undefined is not a word', stateWord(undefined) === null);
  check('null is not a word', stateWord(null) === null);
  check('a misspelling is not a word', stateWord('full-screen') === null);
}

console.log('\nnotify-hold: a toast with nothing in front shows at once\n');
{
  const s = play(initialHold(), [push, answer('accepts')]);
  check('the push asks Windows', actions(s[0]) === 'probe', actions(s[0]));
  check('the push marks a probe running', s[0].next.probing === true && s[0].next.toasts === true);
  check('the push does not show before the answer', s[0].show === false);
  check('the answer shows and raises, then polls', actions(s[1]) === 'show,poll', actions(s[1]));
  check('nothing is held after it', s[1].next.held === false && s[1].next.probing === false && s[1].next.pushPending === false, show(s[1].next));
}

console.log('\nnotify-hold: a failed probe shows the toast\n');
{
  const s = play(initialHold(), [push, answer('unknown')]);
  check('unknown shows', s[1].show === true && s[1].next.held === false, show(s[1]));
}

console.log('\nnotify-hold: a toast while a full-screen app is in front waits\n');
{
  for (const state of ['busy', 'fullscreen', 'presentation', 'window-fullscreen'] as const) {
    const s = play(initialHold(), [push, answer(state)]);
    check(`${state}: not shown`, s[1].show === false, actions(s[1]));
    check(`${state}: held`, s[1].next.held === true, show(s[1].next));
    check(`${state}: polls again`, s[1].poll === true);
  }
  // The full cycle: held, still held, then the app goes.
  const s = play(initialHold(), [push, answer('busy'), poll, answer('busy'), poll, answer('accepts')]);
  check('the timer asks again', actions(s[2]) === 'probe', actions(s[2]));
  check('still busy: still hidden, no second hide', actions(s[3]) === 'poll', actions(s[3]));
  check('still busy: still held', s[3].next.held === true);
  check('the app gone: shown and raised', s[5].show === true, actions(s[5]));
  check('the app gone: no longer held', s[5].next.held === false);
  check('the app gone: keeps polling while the toast is up', s[5].poll === true);
}

console.log('\nnotify-hold: a toast already on screen when a full-screen app comes in front\n');
{
  const s = play(initialHold(), [push, answer('accepts'), poll, answer('busy'), poll, answer('accepts')]);
  check('the poll after showing asks again', actions(s[2]) === 'probe', actions(s[2]));
  check('busy: the overlay is hidden', s[3].hide === true && s[3].show === false, actions(s[3]));
  check('busy: held', s[3].next.held === true);
  check('back: shown and raised again', s[5].show === true && s[5].next.held === false, actions(s[5]));
}

console.log('\nnotify-hold: polling a toast on screen does not raise it again\n');
{
  const s = play(initialHold(), [push, answer('accepts'), poll, answer('accepts'), poll, answer('app')]);
  check('a quiet poll only polls again', actions(s[3]) === 'poll', actions(s[3]));
  check('a Store app in front changes nothing', actions(s[5]) === 'poll', actions(s[5]));
}

console.log('\nnotify-hold: a second toast while one is up raises again\n');
{
  const s = play(initialHold(), [push, answer('accepts'), push, answer('accepts')]);
  check('the second push asks', actions(s[2]) === 'probe', actions(s[2]));
  check('its answer shows and raises', s[3].show === true, actions(s[3]));
}

console.log('\nnotify-hold: a push while a probe is running\n');
{
  const s = play(initialHold(), [push, push, answer('accepts')]);
  check('does not start a second probe', actions(s[1]) === '', actions(s[1]));
  check('the running probe answers for both', s[2].show === true, actions(s[2]));

  const p = play(initialHold(), [push, answer('accepts'), poll, push, answer('accepts')]);
  check('a push during a poll\'s probe waits for it', actions(p[3]) === '', actions(p[3]));
  check('and that answer raises for the new toast', p[4].show === true, actions(p[4]));
}

console.log('\nnotify-hold: a push while held stays held\n');
{
  const s = play(initialHold(), [push, answer('busy'), push, answer('busy'), poll, answer('accepts')]);
  check('the push asks at once', actions(s[2]) === 'probe', actions(s[2]));
  check('still busy: still hidden, no second hide', actions(s[3]) === 'poll', actions(s[3]));
  check('the end of the hold shows it', s[5].show === true, actions(s[5]));
}

console.log('\nnotify-hold: the toasts going while held\n');
{
  const s = play(initialHold(), [push, answer('busy'), emptied, poll]);
  check('emptied stops the timer', actions(s[2]) === 'stopPoll', actions(s[2]));
  check('emptied ends the hold', s[2].next.held === false && s[2].next.toasts === false, show(s[2].next));
  check('a stray timer asks nothing', actions(s[3]) === '', actions(s[3]));

  const r = play(initialHold(), [push, emptied, answer('accepts')]);
  check('an answer after the toasts went shows nothing', actions(r[2]) === '', actions(r[2]));
  check('and leaves nothing pending', r[2].next.pushPending === false && r[2].next.probing === false, show(r[2].next));

  const h = play(initialHold(), [push, emptied, answer('busy')]);
  check('nor does a hold answer after they went', actions(h[2]) === '' && h[2].next.held === false, actions(h[2]));
}

console.log('\nnotify-hold: a toast after an empty spell starts again\n');
{
  const s = play(initialHold(), [push, answer('busy'), emptied, push, answer('accepts')]);
  check('the new push asks', actions(s[3]) === 'probe', actions(s[3]));
  check('and shows', s[4].show === true, actions(s[4]));
}

console.log('\nnotify-hold: a poll with no toasts does nothing\n');
{
  const s = holdStep(initialHold(), poll);
  check('no probe', actions(s) === '', actions(s));
  check('the same values', show(s.next) === show(initialHold()));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);

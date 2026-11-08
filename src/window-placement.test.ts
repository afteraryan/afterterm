// Unit tests for window-placement.ts. Run directly on Node 24+ (strips types):
//   node src/window-placement.test.ts
// Exits 0 if all pass, 1 on any failure.

import {
  SETTLE_MS, TITLE_BAR_PX, asRect, sameHome, homeFromPrefs, homeToPrefs, findHomeDisplay,
  reachable, placeOn, startupPlacement, isWindowsMove, pruneEvents, moveBack, displayMatching,
  countsAsDisplayChange, landsOn,
} from './window-placement.ts';
import type { DisplayInfo, WindowHome, Rect } from './window-placement.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}
const show = (v: unknown) => JSON.stringify(v);

// Aryan's layout, in Electron's coordinates: the laptop panel is the primary at
// 125% (1536x864 DIP) and the monitor sits to its right at 100%.
const laptop: DisplayInfo = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1536, height: 864 },
  workArea: { x: 0, y: 0, width: 1536, height: 816 },
};
const monitor: DisplayInfo = {
  id: 2,
  bounds: { x: 1536, y: -216, width: 1920, height: 1080 },
  workArea: { x: 1536, y: -216, width: 1920, height: 1032 },
};
const both = [laptop, monitor];
const onMonitor: Rect = { x: 1856, y: -90, width: 1280, height: 780 };
const home: WindowHome = { bounds: onMonitor, displayId: 2, displayBounds: monitor.bounds, maximized: false };

console.log('\nwindow-placement: reading and writing the home in prefs.json\n');
{
  check('a rectangle is read', show(asRect({ x: 1, y: 2, width: 3, height: 4 })) === show({ x: 1, y: 2, width: 3, height: 4 }));
  check('fractions are rounded', show(asRect({ x: 1.4, y: 2.6, width: 3.5, height: 4 })) === show({ x: 1, y: 3, width: 4, height: 4 }));
  check('a missing field is not a rectangle', asRect({ x: 1, y: 2, width: 3 }) === null);
  check('a string is not a number', asRect({ x: '1', y: 2, width: 3, height: 4 }) === null);
  check('NaN is not a number', asRect({ x: NaN, y: 2, width: 3, height: 4 }) === null);
  check('a zero width is not a window', asRect({ x: 0, y: 0, width: 0, height: 4 }) === null);
  check('null is not a rectangle', asRect(null) === null);

  const prefs = homeToPrefs(home);
  check('written under the four keys', show(Object.keys(prefs).sort()) === show(['windowBounds', 'windowDisplayBounds', 'windowDisplayId', 'windowMaximized']));
  const back = homeFromPrefs({ ...prefs, lastOpenedAt: 5 });
  check('read back the same', back !== null && sameHome(back, home), show(back));
  check('no keys: no home', homeFromPrefs({}) === null);
  check('no display bounds: no home', homeFromPrefs({ windowBounds: onMonitor, windowDisplayId: 2 }) === null);
  check('a display id that is not a number: no home', homeFromPrefs({ ...prefs, windowDisplayId: '2' }) === null);
  check('maximized only when true', homeFromPrefs({ ...prefs, windowMaximized: 'yes' })?.maximized === false);
  check('maximized read', homeFromPrefs({ ...prefs, windowMaximized: true })?.maximized === true);
}

console.log('\nwindow-placement: finding the home display\n');
{
  check('by its id', findHomeDisplay(home, both)?.id === 2);
  check('not there', findHomeDisplay(home, [laptop]) === null);
  const renumbered = { ...monitor, id: 7 };
  check('the same monitor with a new id is found by its bounds', findHomeDisplay(home, [laptop, renumbered])?.id === 7);
  const moved = { ...monitor, id: 7, bounds: { ...monitor.bounds, x: -1920 } };
  check('a new id and a new place is not the same monitor', findHomeDisplay(home, [laptop, moved]) === null);

  // Chromium's id is a hash of the output's device name, so a driver or dock
  // change can swap the two ids (review 1 of PR 92, probe 1).
  const swapped = [{ ...laptop, id: 2 }, { ...monitor, id: 1 }];
  const sw = findHomeDisplay(home, swapped);
  check('ids swapped: the monitor is found by its bounds, not the laptop by the id', sw !== null && show(sw.bounds) === show(monitor.bounds), show(sw));
  const swp = startupPlacement(home, swapped);
  check('ids swapped: the window opens on the monitor, where it was', swp !== null && swp.displayId === 1 && show(swp.bounds) === show(onMonitor), show(swp));
  const swb = moveBack({ home, windowDisplayId: 2, displays: swapped, userMovePending: false, minimized: false });
  check('ids swapped, the window on the laptop: it goes back to the monitor', swb.action === 'move' && swb.displayId === 1 && show(swb.bounds) === show(onMonitor), show(swb));
  const twoMonitors = [{ ...monitor, id: 3, bounds: { ...monitor.bounds, x: 5000 } }, { ...monitor, id: 2 }];
  check('id and bounds together win over the id or the bounds alone', findHomeDisplay(home, twoMonitors)?.id === 2);
  const rescaledSameId = { ...monitor, bounds: { ...monitor.bounds, width: 1280, height: 720 } };
  check('the same id with new bounds (rescaled) is still found by its id', findHomeDisplay(home, [laptop, rescaledSameId])?.id === 2);
}

console.log('\nwindow-placement: a window that can be reached\n');
{
  const wa = monitor.workArea;
  check('fully inside', reachable(onMonitor, wa));
  check('title bar above the top', !reachable({ ...onMonitor, y: wa.y - 1 }, wa));
  check('title bar at the very bottom', reachable({ ...onMonitor, y: wa.y + wa.height - TITLE_BAR_PX }, wa));
  check('title bar below the bottom', !reachable({ ...onMonitor, y: wa.y + wa.height - TITLE_BAR_PX + 1 }, wa));
  check('hanging off the right edge with 120 px showing', reachable({ ...onMonitor, x: wa.x + wa.width - 120 }, wa));
  check('hanging off the right edge with 119 px showing', !reachable({ ...onMonitor, x: wa.x + wa.width - 119 }, wa));
  check('hanging off the left edge with 200 px showing', reachable({ ...onMonitor, x: wa.x - onMonitor.width + 200 }, wa));
  check('on another display entirely', !reachable(onMonitor, laptop.workArea));
}

console.log('\nwindow-placement: the home on the display as it is now\n');
{
  check('same display, same place', show(placeOn(home, monitor)) === show(onMonitor));
  const left = { ...monitor, bounds: { ...monitor.bounds, x: -1920 }, workArea: { ...monitor.workArea, x: -1920 } };
  const p = placeOn(home, left);
  check('the display moved to the left: the window moves with it', p.x === onMonitor.x - 1536 - 1920 && p.y === onMonitor.y, show(p));
  const small = { ...monitor, workArea: { ...monitor.workArea, width: 1000, height: 600 } };
  const s = placeOn(home, small);
  check('a smaller work area: no larger than it', s.width === 1000 && s.height === 600, show(s));
}

console.log('\nwindow-placement: where the window opens\n');
{
  const p = startupPlacement(home, both);
  check('on its home display', p !== null && p.displayId === 2 && show(p.bounds) === show(onMonitor), show(p));
  check('not maximized', p?.maximized === false);
  check('maximized when it was', startupPlacement({ ...home, maximized: true }, both)?.maximized === true);
  check('nothing remembered: Electron decides', startupPlacement(null, both) === null);
  check('the home display is not connected: Electron decides', startupPlacement(home, [laptop]) === null);
  check('the monitor came back with a new id: still found', startupPlacement(home, [laptop, { ...monitor, id: 9 }])?.displayId === 9);
  // Review 1 of PR 92, probe 3: a home whose top was a few pixels above the work
  // area used to open centred on the primary (and lose its home); now it is moved
  // down into the work area.
  const high = { ...home, bounds: { ...onMonitor, y: monitor.workArea.y - 6 } };
  const hp = startupPlacement(high, both);
  check('a top 6 px above the work area: opens on the monitor at its top edge', hp !== null && hp.displayId === 2 && hp.bounds.y === monitor.workArea.y && hp.bounds.x === onMonitor.x, show(hp));
  const offTop = { ...home, bounds: { ...onMonitor, y: monitor.workArea.y - 50 } };
  const op = startupPlacement(offTop, both);
  check('a top 50 px above: also moved down, still on the monitor', op !== null && op.bounds.y === monitor.workArea.y, show(op));

  // Probe 2: the monitor went from 100% to 150% (1280x720 DIP), same id and origin.
  const scaled: DisplayInfo = { id: 2, bounds: { x: 1536, y: -216, width: 1280, height: 720 }, workArea: { x: 1536, y: -216, width: 1280, height: 688 } };
  const sp = startupPlacement(home, [laptop, scaled]);
  const inside = (r: Rect, wa: Rect) => r.x >= wa.x && r.y >= wa.y && r.x + r.width <= wa.x + wa.width && r.y + r.height <= wa.y + wa.height;
  check('a rescaled monitor: the window is wholly inside its work area', sp !== null && inside(sp.bounds, scaled.workArea), show(sp));
  check('a rescaled monitor: as large as the work area allows', sp !== null && sp.bounds.width === 1280 && sp.bounds.height === 688, show(sp));
  check('a rescaled monitor: on the monitor', sp?.displayId === 2);
  const narrow: DisplayInfo = { id: 2, bounds: monitor.bounds, workArea: { ...monitor.workArea, width: 1500 } };
  const np = startupPlacement(home, [laptop, narrow]);
  check('a narrower work area: moved left to fit, size kept', np !== null && np.bounds.width === 1280 && np.bounds.x + np.bounds.width === narrow.workArea.x + narrow.workArea.width, show(np));
}

console.log('\nwindow-placement: whose move was it\n');
{
  check('no display or power change: the user\'s', !isWindowsMove(10_000, 10_000, []));
  check('1 s after a display was removed: Windows\'', isWindowsMove(11_000, 11_000, [10_000]));
  check(`${SETTLE_MS} ms after: still Windows'`, isWindowsMove(10_000 + SETTLE_MS, 10_000 + SETTLE_MS, [10_000]));
  check(`${SETTLE_MS + 1} ms after: the user's`, !isWindowsMove(10_001 + SETTLE_MS, 10_001 + SETTLE_MS, [10_000]));
  check('a display change 1 s after the move: Windows\'', isWindowsMove(10_000, 10_000, [11_000]));
  check('a change during a long drag: Windows\'', isWindowsMove(0, 20_000, [10_000]));
  check('a change long before: the user\'s', !isWindowsMove(70_000, 70_000, [10_000]));
  const kept = pruneEvents([1_000, 50_000, 100_000], 100_000);
  check('changes older than a minute are dropped', show(kept) === show([50_000, 100_000]), show(kept));
}

console.log('\nwindow-placement: the lid closes and opens (AFT-15)\n');
{
  // Sleep at t=0; on wake the monitor is gone for a moment: Electron hears the
  // display removed at t=1000 and Windows moves the window to the laptop at t=1010.
  const events = [0, 1_000];
  check('Windows\' move to the laptop is not the user\'s', isWindowsMove(1_010, 1_010, events));
  // So the home stays on the monitor. The monitor is back at t=8000.
  const atAdded = moveBack({ home, windowDisplayId: 1, displays: both, userMovePending: false, minimized: false });
  check('the window goes back to the monitor', atAdded.action === 'move' && atAdded.displayId === 2, show(atAdded));
  check('to exactly where it was', atAdded.action === 'move' && show(atAdded.bounds) === show(onMonitor), show(atAdded));
  check('not maximized', atAdded.action === 'move' && atAdded.maximize === false);
  const maxed = moveBack({ home: { ...home, maximized: true }, windowDisplayId: 1, displays: both, userMovePending: false, minimized: false });
  check('a maximized window is maximized again there', maxed.action === 'move' && maxed.maximize === true, show(maxed));

  // Woken but the monitor is not back yet (only the laptop): nothing to do.
  const notYet = moveBack({ home, windowDisplayId: 1, displays: [laptop], userMovePending: false, minimized: false });
  check('the monitor is not back yet: stays', notYet.action === 'stay' && notYet.reason === 'its display is not there', show(notYet));

  // The monitor comes back renumbered.
  const renum = moveBack({ home, windowDisplayId: 1, displays: [laptop, { ...monitor, id: 5 }], userMovePending: false, minimized: false });
  check('the monitor comes back with a new id: still goes back', renum.action === 'move' && renum.displayId === 5, show(renum));
}

console.log('\nwindow-placement: when the window stays where it is\n');
{
  const base = { home, windowDisplayId: 2, displays: both, userMovePending: false, minimized: false };
  const already = moveBack(base);
  check('already on its display', already.action === 'stay' && already.reason === 'already on its display', show(already));
  const none = moveBack({ ...base, home: null, windowDisplayId: 1 });
  check('no home remembered', none.action === 'stay' && none.reason === 'no home remembered', show(none));
  const moving = moveBack({ ...base, windowDisplayId: 1, userMovePending: true });
  check('the user is dragging it right now', moving.action === 'stay' && moving.reason === 'the user is moving the window', show(moving));
  const minimized = moveBack({ ...base, windowDisplayId: 1, minimized: true });
  check('minimized: waits for the restore', minimized.action === 'stay' && minimized.reason === 'minimized', show(minimized));

  // The user moved the window to the laptop by hand, long after any display
  // change: that move is the user's, so the laptop becomes the home.
  check('a move by hand with no display change near it is the user\'s', !isWindowsMove(30_000, 31_500, [0, 1_000, 8_000]));
  const laptopHome: WindowHome = { bounds: { x: 100, y: 50, width: 1280, height: 700 }, displayId: 1, displayBounds: laptop.bounds, maximized: false };
  const stays = moveBack({ ...base, home: laptopHome, windowDisplayId: 1 });
  check('the monitor comes back later: the window stays on the laptop', stays.action === 'stay' && stays.reason === 'already on its display', show(stays));

  const offDisplay = { ...home, bounds: { ...onMonitor, y: -400 } };
  const off = moveBack({ ...base, home: offDisplay, windowDisplayId: 1 });
  check('a place above the display: goes back, moved inside it', off.action === 'move' && off.bounds.y === monitor.workArea.y, show(off));
}

console.log('\nwindow-placement: a lock or an unlock is not a display change (review 1 of PR 92)\n');
{
  check('a display added counts', countsAsDisplayChange('display-added'));
  check('a display removed counts', countsAsDisplayChange('display-removed'));
  check('a display changed counts', countsAsDisplayChange('display-metrics-changed'));
  check('sleep counts', countsAsDisplayChange('suspend'));
  check('wake counts', countsAsDisplayChange('resume'));
  check('a lock does not count', !countsAsDisplayChange('lock-screen'));
  check('an unlock does not count', !countsAsDisplayChange('unlock-screen'));

  // Probe 4: Aryan unlocks at T with the window on the monitor and drags it to
  // the laptop between T+3 s and T+4 s. Only display changes are noted, so the
  // unlock is not among them and the drag is his.
  const T = 100_000;
  const noted = [{ event: 'unlock-screen', at: T }].filter(e => countsAsDisplayChange(e.event)).map(e => e.at);
  check("a drag 3 to 4 s after an unlock is the user's", !isWindowsMove(T + 3000, T + 4000, noted), show(noted));
  // So the laptop became the home, and the check 6 s after the unlock leaves it there.
  const laptopHome: WindowHome = { bounds: { x: 100, y: 50, width: 1280, height: 700 }, displayId: 1, displayBounds: laptop.bounds, maximized: false };
  const after = moveBack({ home: laptopHome, windowDisplayId: 1, displays: both, userMovePending: false, minimized: false });
  check('the check after the unlock does not undo it', after.action === 'stay' && after.reason === 'already on its display', show(after));
  // A wake still counts: the same drag 3 s after a resume is Windows'.
  const woke = [{ event: 'resume', at: T }].filter(e => countsAsDisplayChange(e.event)).map(e => e.at);
  check("the same drag 3 s after a wake is Windows'", isWindowsMove(T + 3000, T + 4000, woke));
}

console.log('\nwindow-placement: the display a window is on\n');
{
  check('the window on the monitor', displayMatching(onMonitor, both)?.id === 2);
  check('mostly on the laptop', displayMatching({ x: 900, y: 100, width: 1000, height: 600 }, both)?.id === 1);
  check('on no display', displayMatching({ x: 9000, y: 9000, width: 10, height: 10 }, both) === null);

  // The harness guard: a move back is made only when it lands on the harness display.
  check('a place on the monitor lands on the monitor', landsOn(onMonitor, both, 2));
  check('a place on the laptop does not land on the monitor', !landsOn({ x: 100, y: 50, width: 1280, height: 700 }, both, 2));
  check('a place on no display lands nowhere', !landsOn({ x: 10_000, y: 0, width: 1280, height: 780 }, both, 2));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);

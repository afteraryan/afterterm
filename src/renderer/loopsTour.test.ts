// Unit tests for loopsTour.ts (the tour's steps, examples and placement). Run on Node 24+:
//   node src/renderer/loopsTour.test.ts

import { createLoop, emptyLoopsFile, loopCounts, loopStatus, orderedSubLoops, DAY_MS, type Actor } from '../loops.ts';
import {
  TOUR_STEPS, TOUR_LENGTH, tourScene, switchesView, ringOffset, RING_LENGTH,
  usesExampleLoops, usesExampleDays, exampleLoops, exampleDays, exampleGroups, isExampleId,
  loopWithSubs, rottingLoop, placeCard, ringBox, overlaps, CARD_WIDTH, LOOPS_CARD, type Box,
} from './loopsTour.ts';
import { streaks } from './streakView.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const NOW = new Date(2026, 10, 14, 12, 0, 0).getTime();

console.log('the steps');
check('eight steps', TOUR_LENGTH === 8);
check('step 6 has no heading and shows the keys', TOUR_STEPS[5].title === '' && TOUR_STEPS[5].keys === true);
check('only step 6 is in the workspace', TOUR_STEPS.every((s, i) => (s.view === 'workspace') === (i === 5)));
check('the calendar step is green, the last is split', TOUR_STEPS[6].theme === 'green' && TOUR_STEPS[7].theme === 'mix');
check('only the last step is last', TOUR_STEPS.every((s, i) => !!s.last === (i === 7)));
check('the first and last steps have no ring', TOUR_STEPS[0].target === null && TOUR_STEPS[7].target === null);
check('no heading has an em dash', TOUR_STEPS.every((s) => !s.title.includes('\u2014')));
check('every step but the keys step has a picture', TOUR_STEPS.every((s, i) => (s.art === null) === (i === 5)));

console.log('tourScene');
check('step 1: no examples yet', !tourScene(0).examples);
check('steps 2 to 8: examples', [1, 2, 3, 4, 5, 6, 7].every((n) => tourScene(n).examples));
check('the example calendar from step 7 only', [0, 1, 2, 3, 4, 5].every((n) => !tourScene(n).exampleDays) && tourScene(6).exampleDays && tourScene(7).exampleDays);
check('the sub-loops open on steps 5 and 6 only', [0, 1, 2, 3, 6, 7].every((n) => !tourScene(n).openSubs) && tourScene(4).openSubs && tourScene(5).openSubs);
check('the loops card is open on step 6 only', [0, 1, 2, 3, 4, 6, 7].every((n) => !tourScene(n).cardOpen) && tourScene(5).cardOpen);
check('step 6 is the workspace, the rest Home', tourScene(5).view === 'workspace' && tourScene(6).view === 'home');
check('Back gives the same scene as going forward', eq(tourScene(3), tourScene(3)));
check('out of range is clamped', eq(tourScene(-1).view, 'home') && eq(tourScene(99), tourScene(7)));

console.log('switchesView');
check('the first step counts as a switch (fade in)', switchesView(null, 0));
check('Home to Home slides', !switchesView(3, 4));
check('step 5 to 6 switches', switchesView(4, 5));
check('step 6 to 7 switches', switchesView(5, 6));
check('Back from 7 to 6 switches', switchesView(6, 5));

console.log('the progress ring');
check('empty before the first step fills an eighth', Math.abs(ringOffset(0) - RING_LENGTH * 7 / 8) < 1e-9);
check('full on the last step', Math.abs(ringOffset(7)) < 1e-9);
check('fills a little more with every step', [1, 2, 3, 4, 5, 6, 7].every((n) => ringOffset(n) < ringOffset(n - 1)));

console.log('examples or their own');
const agent: Actor = { kind: 'agent', chat: null };
const file = emptyLoopsFile();
const own = createLoop(file, { title: 'Mine', project: null, label: 'feature' }, NOW - DAY_MS, agent);
check('no loops: examples', usesExampleLoops([]));
check('a loop of their own: theirs', !usesExampleLoops([own]));
check('only deleted loops: examples', usesExampleLoops([{ ...own, deletedAt: NOW }]));
check('no days: example calendar', usesExampleDays({}));
check('only zero days: example calendar', usesExampleDays({ '2026-11-01': 0 }));
check('one day with a message: their own', !usesExampleDays({ '2026-11-01': 1 }));

console.log('the example loops');
const ex1 = exampleLoops(NOW, 1), ex2 = exampleLoops(NOW, 2);
check('every id is an example id', ex1.every((l) => isExampleId(l.id)));
check('every project is an example project', ex1.every((l) => l.project === null || exampleGroups().some((g) => g.id === l.project)));
check('five top-level loops', ex1.filter((l) => !l.parent).length === 5);
check('the first has three sub-loops, one closed', orderedSubLoops('example-a', ex1).length === 3 && ex1.filter((l) => l.parent && l.status === 'closed').length === 1);
const st = (ex: typeof ex1, id: string) => loopStatus(ex.find((l) => l.id === 'example-' + id)!, ex, NOW);
check('"Export to PDF" is open before the rotting step', st(ex1, 'd') === 'open');
check('"Export to PDF" is rotting from the rotting step', st(ex2, 'd') === 'rotting');
check('the idea never rots', st(ex2, 'e') === 'open');
check('"Price page redesign" is closed', st(ex1, 'c') === 'closed');
const c2 = loopCounts(ex2, NOW);
check('counts on the rotting step: 4 remaining, 1 rotting, 1 closed', c2.remaining === 4 && c2.rotting === 1 && c2.closed === 1, JSON.stringify(c2));
check('the sub-loops step finds the first example', loopWithSubs(ex2) === 'example-a');
check('the rotting step finds "Export to PDF"', rottingLoop(ex2, NOW) === 'example-d');
check('own loops with no sub-loops: none to open', loopWithSubs([own]) === null);
check('own loops with none rotting: none to ring', rottingLoop([own], NOW) === null);

console.log('the example calendar');
const days = exampleDays('2026-11-14');
const s = streaks(days, '2026-11-14');
check('a six-day streak up to today', s.current === 6, String(s.current));
check('a longest streak at least as long', s.longest >= 6);
check('nothing in the first six of the 22 weeks (they start Sunday 7 June)', Object.keys(days).every((d) => d >= '2026-07-19'));
check('nothing after today', Object.keys(days).every((d) => d <= '2026-11-14'));
check('the same every time', eq(days, exampleDays('2026-11-14')));
check('some of every shade', [3, 9, 24, 52].every((n) => Object.values(days).includes(n)));

console.log('where the card and the ring go');
// The 1920 by 1032 window less the 32px title bar and the 76px rail.
const area: Box = { x: 76, y: 32, w: 1844, h: 1000 };
const ring = ringBox({ x: 1400, y: 200, w: 472, h: 300 }, area);
check('the ring sits 6px outside its target', ring.x === 1394 && ring.y === 194 && ring.w === 484 && ring.h === 312);
const longList = ringBox({ x: 1400, y: 400, w: 472, h: 900 }, area);
check('a long target\'s ring stops 12px above the bottom (plus its 6px)', longList.y + longList.h === area.y + area.h - 12 + 6);
for (const [name, t, h] of [
  ['the list', { x: 1408, y: 380, w: 472, h: 640 }, 520],
  ['a row', { x: 1408, y: 600, w: 472, h: 31 }, 420],
  ['the calendar', { x: 1408, y: 90, w: 472, h: 190 }, 470],
  ['a row near the bottom', { x: 1408, y: 990, w: 472, h: 31 }, 420],
  ['a target at the left edge', { x: 90, y: 300, w: 300, h: 100 }, 420],
] as [string, Box, number][]) {
  const p = placeCard(t, area, h);
  const card = { x: p.x, y: p.y, w: CARD_WIDTH, h };
  check(`${name}: the card never covers the ring`, !overlaps(card, ringBox(t, area)));
  check(`${name}: the card stays in the window`, p.x >= area.x && p.x + CARD_WIDTH <= area.x + area.w && p.y >= area.y && p.y + h <= area.y + area.h, JSON.stringify(p));
  check(`${name}: has a pointer`, p.arrow !== null && p.arrow.top >= 16 && p.arrow.top <= h - 28);
}
const left = placeCard({ x: 90, y: 300, w: 300, h: 100 }, area, 420);
check('no room on the left: the card goes right, pointing left', left.arrow?.side === 'left' && left.x === 90 + 300 + 24);
const mid = placeCard(null, area, 400);
check('no target: in the middle, no pointer', mid.arrow === null && mid.x === area.x + area.w / 2 - CARD_WIDTH / 2 && mid.y === area.y + 300);
const pane: Box = { x: 340, y: 32, w: 1580, h: 1000 };
const button: Box = { x: 1800, y: 46, w: 48, h: 30 };
const k = placeCard(button, area, 160, { loopsCard: pane });
check('the keys step: left of the loops card, from its fixed place', k.x === pane.x + pane.w - LOOPS_CARD.right - LOOPS_CARD.width - 24 - CARD_WIDTH && k.y === pane.y + LOOPS_CARD.top);
check('the keys step: never covers the loops button', !overlaps({ x: k.x, y: k.y, w: CARD_WIDTH, h: 160 }, ringBox(button, area)));
check('the keys step: never covers the loops card', k.x + CARD_WIDTH <= pane.x + pane.w - LOOPS_CARD.right - LOOPS_CARD.width);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

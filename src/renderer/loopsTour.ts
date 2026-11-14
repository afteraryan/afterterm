// The loops tour (AFT-103, mock docs/mockups/loops-tour.html): its eight steps,
// what each step does to the screen, the example loops and calendar shown to
// someone who has none, and where the card and the ring go. Pure: no DOM, no
// clock of its own, so the tests can check every step.
//
// The examples only ever exist in the renderer. They are never sent to main, so
// they never reach loops.json or activity.json.
import { loopStatus, orderedTopLoops, orderedSubLoops, type Loop } from '../loops.ts';
import type { Group } from './components/TabBar/types';

export type TourView = 'home' | 'workspace';
// What the ring goes round: the Progress list, one rotting row, the opened loop's
// sub-loops, the workspace header's loops button, the calendar card. null: no ring,
// the card in the middle.
export type TourTarget = 'list' | 'rot-row' | 'subs' | 'loops-button' | 'calendar' | null;
export type TourArt = 'kinds' | 'auto' | 'rot' | 'list' | 'subs' | 'calendar' | 'done' | null;
export type TourTheme = 'blue' | 'green' | 'mix';

export interface TourStep {
  title: string;         // empty: no heading (the keys step)
  keys?: boolean;        // "Click [loops button] or press Ctrl + Shift + L"
  target: TourTarget;
  art: TourArt;
  view: TourView;
  theme: TourTheme;
  last?: boolean;
}

export const TOUR_STEPS: readonly TourStep[] = [
  { title: 'A loop is a piece of work you started', target: null, art: 'kinds', view: 'home', theme: 'blue' },
  { title: 'Claude tracks your loops for you, as it works', target: 'list', art: 'auto', view: 'home', theme: 'blue' },
  { title: 'A loop nobody touches for long starts rotting', target: 'rot-row', art: 'rot', view: 'home', theme: 'blue' },
  { title: 'You can open a loop’s chat straight from the list', target: 'list', art: 'list', view: 'home', theme: 'blue' },
  { title: 'A big loop can hold smaller sub-loops', target: 'subs', art: 'subs', view: 'home', theme: 'blue' },
  { title: '', keys: true, target: 'loops-button', art: null, view: 'workspace', theme: 'blue' },
  { title: 'The calendar shows how much you’ve been working with Claude', target: 'calendar', art: 'calendar', view: 'home', theme: 'green' },
  { title: 'Enjoy being more productive', target: null, art: 'done', view: 'home', theme: 'mix', last: true },
];

export const TOUR_LENGTH = TOUR_STEPS.length;

// What a step does to the app, from a clean start, so Back and any jump give the
// same screen: which view, whether the example loops show (from step 2), whether
// the example calendar shows (from step 7), which loop is opened in place, and
// whether the workspace's loops card is open.
export interface TourScene {
  view: TourView;
  examples: boolean;
  exampleDays: boolean;
  openSubs: boolean;
  cardOpen: boolean;
}

export function tourScene(step: number): TourScene {
  const s = TOUR_STEPS[Math.max(0, Math.min(TOUR_LENGTH - 1, step))];
  return {
    view: s.view,
    examples: step >= 1,
    exampleDays: step >= 6,
    openSubs: step === 4 || step === 5,
    cardOpen: step === 5,
  };
}

// A change of view between two steps: the card and the ring fade, jump and fade
// in, rather than sliding across.
export function switchesView(from: number | null, to: number): boolean {
  if (from === null) return true;
  return TOUR_STEPS[from]?.view !== TOUR_STEPS[to]?.view;
}

// The progress ring in the card's corner: the share of the circle filled at a step
// (1 of 8 is an eighth, the last step the whole ring).
export const RING_LENGTH = 62.83; // 2 pi r, r = 10
export function ringOffset(step: number): number {
  return RING_LENGTH * (1 - (step + 1) / TOUR_LENGTH);
}

// ---------- the examples ----------

// Someone with any loop of their own sees their own; someone with none sees the
// examples. A loop deleted but kept for its 30 days does not count.
export function usesExampleLoops(loops: readonly Loop[]): boolean {
  return !loops.some((l) => !l.deletedAt);
}

// The same for the calendar: any day with a message means it is theirs.
export function usesExampleDays(days: Record<string, number>): boolean {
  return !Object.values(days).some((n) => n > 0);
}

export const EXAMPLE_PREFIX = 'example-';
export function isExampleId(id: string): boolean {
  return id.startsWith(EXAMPLE_PREFIX);
}

const DAY = 24 * 60 * 60 * 1000;

// The example projects the example loops name, in the mock's colours.
export function exampleGroups(): Group[] {
  const g = (id: string, label: string, color: string): Group => ({
    id: EXAMPLE_PREFIX + id, label, color: color as Group['color'], collapsed: false, pinned: false, archived: false, lastActiveAt: 0, history: [],
  });
  return [g('my-app', 'my-app', '#5b8def'), g('website', 'website', '#3fc46f'), g('notes', 'notes', '#e8b931')];
}

// The mock's five example loops. "Export to PDF" was last touched 4 days ago until
// the rotting step, then 3 weeks ago, so it turns amber on that step (rotting is
// worked out from activity, as for a real loop). "Notes to PDF app" has three
// sub-loops, one closed.
export function exampleLoops(now: number, step: number): Loop[] {
  const P = EXAMPLE_PREFIX;
  const loop = (id: string, title: string, label: Loop['label'], project: string | null, ago: number, extra: Partial<Loop> = {}): Loop => ({
    id: P + id, title, label, project: project ? P + project : null, status: 'open', description: '', note: '', chat: null,
    parent: null, createdAt: now - ago - DAY, activityAt: now - ago, ...extra,
  });
  return [
    loop('a', 'Notes to PDF app', 'feature', 'my-app', 2 * DAY, {
      description: 'A small app that turns my notes into a PDF.', note: 'Picking notes works, PDF layout next.',
    }),
    loop('a1', 'Pick the notes', 'feature', 'my-app', 2 * DAY + 60_000, { parent: P + 'a', status: 'closed', closedAt: now - 2 * DAY }),
    loop('a2', 'Lay out the PDF', 'feature', 'my-app', 2 * DAY + 120_000, { parent: P + 'a' }),
    loop('a3', 'Save to a folder', 'idea', 'my-app', 3 * DAY, { parent: P + 'a' }),
    loop('b', 'Login button does nothing', 'bug', 'my-app', 0),
    loop('c', 'Price page redesign', 'feature', 'website', DAY, { status: 'closed', closedAt: now - DAY }),
    loop('d', 'Export to PDF', 'feature', 'notes', step >= 2 ? 21 * DAY : 4 * DAY),
    loop('e', 'Weekly summary email', 'idea', 'notes', 9 * DAY),
  ];
}

// The example calendar: 22 weeks of made-up days, the first six weeks empty, a
// six-day streak up to today. Seeded, so every run draws the same squares.
export function exampleDays(today: string): Record<string, number> {
  const [y, m, d] = today.split('-').map(Number);
  const end = new Date(y, m - 1, d);
  const key = (t: Date) => `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  const LEVEL_COUNT = [0, 3, 9, 24, 52];
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const out: Record<string, number> = {};
  const total = 22 * 7 - 6 * 7;
  for (let i = 0; i < total; i++) {
    const t = new Date(end.getFullYear(), end.getMonth(), end.getDate() - i);
    const v = rnd();
    let lvl = v < 0.25 ? 0 : v < 0.5 ? 1 : v < 0.75 ? 2 : v < 0.93 ? 3 : 4;
    if (i < 6 && lvl === 0) lvl = 2;   // the current streak: today and the five days before
    if (i === 6) lvl = 0;              // ends here
    if (lvl) out[key(t)] = LEVEL_COUNT[lvl];
  }
  return out;
}

// ---------- which of someone's own loops a step points at ----------

// The sub-loops step opens the first listed loop that has sub-loops.
export function loopWithSubs(loops: readonly Loop[]): string | null {
  return orderedTopLoops(loops).find((l) => orderedSubLoops(l.id, loops).length > 0)?.id ?? null;
}

// The rotting step rings the first rotting loop; with none, the whole list.
export function rottingLoop(loops: readonly Loop[], now: number): string | null {
  return orderedTopLoops(loops).find((l) => loopStatus(l, loops, now) === 'rotting')?.id ?? null;
}

// ---------- where the card and the ring go ----------

export interface Box { x: number; y: number; w: number; h: number }
export interface CardPlace { x: number; y: number; arrow: null | { side: 'left' | 'right'; top: number } }

export const CARD_WIDTH = 420;
export const RING_PAD = 6;       // the ring's outer edge, outside its target
export const CARD_GAP = 24;      // between the card and its target (the ring sits in the first 6px)
export const EDGE = 16;          // the least space between the card and the area's edge
// The workspace's loops card (LoopsCard.css): fixed 64px from the top and 24px from
// the right of the main pane, 320px wide.
export const LOOPS_CARD = { top: 64, right: 24, width: 320 };

// The ring's box: its target grown by RING_PAD on every side, cut 12px above the
// area's bottom so a long list's ring stays on screen.
export function ringBox(target: Box, area: Box): Box {
  const h = Math.min(target.h, area.y + area.h - target.y - 12);
  return { x: target.x - RING_PAD, y: target.y - RING_PAD, w: target.w + RING_PAD * 2, h: h + RING_PAD * 2 };
}

// The card beside its target with a pointer, never over it, always inside the area:
// to the target's left when there is room, else to its right. With no target, in
// the middle. For the loops button the card goes to the left of the loops card,
// worked out from the loops card's fixed place so it never waits for the card to
// open and never moves while it does (`pane` is the main pane's box).
export function placeCard(target: Box | null, area: Box, cardH: number, opts: { loopsCard?: Box | null } = {}): CardPlace {
  const W = CARD_WIDTH;
  const clampY = (y: number) => Math.max(area.y + EDGE, Math.min(y, area.y + area.h - cardH - 24));
  if (!target) {
    return { x: area.x + area.w / 2 - W / 2, y: clampY(area.y + area.h / 2 - cardH / 2), arrow: null };
  }
  if (opts.loopsCard) {
    const pane = opts.loopsCard;
    const x = Math.max(area.x + EDGE, pane.x + pane.w - LOOPS_CARD.right - LOOPS_CARD.width - CARD_GAP - W);
    return { x, y: clampY(pane.y + LOOPS_CARD.top), arrow: { side: 'right', top: 40 } };
  }
  const mid = target.y + Math.min(target.h, 200) / 2;
  const y = clampY(mid - cardH / 2);
  const arrowTop = Math.max(16, Math.min(cardH - 28, mid - y - 8));
  const leftX = target.x - CARD_GAP - W;
  if (leftX >= area.x + EDGE) return { x: leftX, y, arrow: { side: 'right', top: arrowTop } };
  const rightX = Math.min(target.x + target.w + CARD_GAP, area.x + area.w - W - EDGE);
  return { x: rightX, y, arrow: { side: 'left', top: arrowTop } };
}

export function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

// Today as the calendar names days (YYYY-MM-DD, local time).
export function todayKey(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

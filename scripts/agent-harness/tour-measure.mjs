// Measures the loops tour's step on screen in a running harness build (AFT-103),
// from computed styles and layout boxes, against the mock's values
// (docs/mockups/loops-tour.html): the ring is a 3px outline 6px outside its
// target, the card never covers the ring or its target, the card stays inside the
// window, the card's own values. One line per check, PASS or FAIL.
//
//   node scripts/agent-harness/tour-measure.mjs --data-dir <dir>
//
// Run it once the step has settled (about a second after Next).
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dd = process.argv.indexOf('--data-dir');
const dataDir = dd > 0 ? process.argv[dd + 1] : null;
if (!dataDir) { console.error('usage: tour-measure.mjs --data-dir <dir>'); process.exit(2); }

const page = `(() => {
  const q = (s) => document.querySelector(s);
  const layer = q('[data-tour]');
  if (!layer) return JSON.stringify({ error: 'the tour is not showing' });
  const step = +layer.dataset.tourStep;
  const card = q('[data-tour-card]'), ring = q('[data-tour-ring]');
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom }; };
  const near = (a, b, t = 0.6) => Math.abs(a - b) <= t;
  const round = (v) => Math.round(v * 10) / 10;
  const out = [];
  const add = (name, ok, got) => out.push([name, !!ok, got]);
  // The step's target, by the same rules as the tour: its own loops' ids are read
  // from the ring's place, so this finds the element the ring is round.
  const sel = { 2: ['.prog-col .prog-list'], 3: ['.prog-col .lp-row[data-status="rotting"]', '.prog-col .prog-list'], 4: ['.prog-col .prog-list'],
    5: ['.prog-col .lp-subs', '.prog-col .prog-list'], 6: ['.terminal-area [data-loops-button]'], 7: ['.prog-col [data-calendar]'] }[step] || [];
  const cs = getComputedStyle(card), c = box(card);
  add('card width 420', near(c.w, 420), round(c.w));
  add('card radius 18px', cs.borderTopLeftRadius === '18px', cs.borderTopLeftRadius);
  add('card padding 20px', cs.paddingTop === '20px' && cs.paddingLeft === '20px', cs.padding);
  const bg = cs.backgroundImage !== 'none' ? cs.backgroundImage : cs.backgroundColor;
  const wantBg = step === 7 ? 'rgb(44, 154, 98)' : step === 8 ? 'linear-gradient(135deg, rgb(45, 102, 242) 0px, rgb(45, 102, 242) 75%, rgb(44, 154, 98) 75%, rgb(44, 154, 98) 100%)' : 'rgb(45, 102, 242)';
  add('card colour', bg === wantBg, bg);
  add('card shown', cs.opacity === '1', cs.opacity);
  add('card inside the window', c.x >= 0 && c.r <= innerWidth && c.y >= 32 && c.b <= innerHeight, [round(c.x), round(c.y), round(c.r), round(c.b)].join(','));
  add('a NEW tag', !!card.querySelector('.tour-new') && card.querySelector('.tour-new').textContent === 'New', card.querySelector('.tour-new')?.textContent);
  add('no sub-line', step === 6 ? card.querySelectorAll('p').length === 1 && !card.querySelector('h2') : card.querySelectorAll('p').length === 0, card.querySelectorAll('p').length + ' p');
  const shown = card.cloneNode(true); shown.querySelector('.tour-sr')?.remove();
  add('no "1 of 8" text shown (only for screen readers)', !/of 8/.test(shown.textContent) && /of 8/.test(card.querySelector('.tour-sr').textContent), shown.textContent.includes('of 8'));
  const fill = card.querySelector('.tour-pring .fill');
  const off = parseFloat(getComputedStyle(fill).strokeDashoffset);
  add('progress ring filled ' + step + '/8', near(off, 62.83 * (1 - step / 8), 0.05), round(off));
  add('Back only after step 1', !!card.querySelector('[data-tour-act=back]') === step > 1, !!card.querySelector('[data-tour-act=back]'));
  add('Skip on every step but the last', !!card.querySelector('[data-tour-act=skip]') === step < 8, !!card.querySelector('[data-tour-act=skip]'));
  add('Next, or Done on the last', card.querySelector('[data-tour-act=next]').textContent === (step === 8 ? 'Done' : 'Next'), card.querySelector('[data-tour-act=next]').textContent);
  const rcs = getComputedStyle(ring);
  if (!sel.length) {
    add('no ring', rcs.opacity === '0', rcs.opacity);
    const area = box(q('.app-main'));
    add('card in the middle', near(c.x + c.w / 2, area.x + area.w / 2, 1), round(c.x + c.w / 2) + ' vs ' + round(area.x + area.w / 2));
  } else {
    const all = sel.map((s) => [...document.querySelectorAll(s)].filter((e) => e.getBoundingClientRect().width > 0)).flat();
    const r = box(ring);
    // The target is the candidate the ring sits round (6px out on the left and top).
    const t = all.map(box).find((b) => near(r.x, b.x - 6, 1) && near(r.y, b.y - 6, 1));
    add('ring shown', rcs.opacity === '1', rcs.opacity);
    add('ring border 3px', rcs.borderTopWidth === '3px' && rcs.borderLeftWidth === '3px', rcs.borderTopWidth);
    add('ring colour', rcs.borderTopColor === (step === 7 ? 'rgb(44, 154, 98)' : 'rgb(45, 102, 242)'), rcs.borderTopColor);
    if (!t) { add('ring round its target', false, 'no ' + sel.join(' or ') + ' 6px inside the ring at ' + [round(r.x), round(r.y)]); }
    else {
      const cut = t.b > innerHeight - 12;
      add('ring 6px outside the target, left', near(t.x - r.x, 6), round(t.x - r.x));
      add('ring 6px outside the target, top', near(t.y - r.y, 6), round(t.y - r.y));
      add('ring 6px outside the target, right', near(r.r - t.r, 6), round(r.r - t.r));
      add(cut ? 'ring cut 12px above the window bottom' : 'ring 6px outside the target, bottom', cut ? near(r.b, innerHeight - 6, 1) : near(r.b - t.b, 6), cut ? round(innerHeight - r.b) : round(r.b - t.b));
      const hit = (a, b) => a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b;
      add('card does not cover the ring', !hit(c, r), [round(c.x), round(c.r)].join('..') + ' vs ' + [round(r.x), round(r.r)].join('..'));
      add('card does not cover the target', !hit(c, t), '');
      const arrow = card.querySelector('.tour-arrow');
      add('card has a pointer', !arrow.hidden && getComputedStyle(arrow).display !== 'none', !arrow.hidden);
      if (step === 6) {
        const pane = box(q('.terminal-area'));
        add('placed from the loops card: x', near(c.x, pane.r - 24 - 320 - 24 - 420, 1), round(c.x) + ' vs ' + round(pane.r - 24 - 320 - 24 - 420));
        add('placed from the loops card: y', near(c.y, pane.y + 64, 1), round(c.y - pane.y));
        const lc = q('[data-loops-card]');
        add('loops card open', !!lc, !!lc);
        if (lc) add('card does not cover the loops card', c.r <= box(lc).x + 0.5, round(c.r) + ' vs ' + round(box(lc).x));
      }
    }
  }
  return JSON.stringify({ step, out });
})()`;

const raw = execFileSync(process.execPath, [path.join(here, 'drive.mjs'), 'eval', page, '--data-dir', dataDir], { encoding: 'utf8' });
let res = JSON.parse(raw.trim());
if (typeof res === 'string') res = JSON.parse(res);
if (res.error) { console.error(res.error); process.exit(1); }
let pass = 0, fail = 0;
console.log(`Step ${res.step}`);
for (const [name, ok, got] of res.out) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (measured ${JSON.stringify(got)})`}`);
  ok ? pass++ : fail++;
}
console.log(`${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

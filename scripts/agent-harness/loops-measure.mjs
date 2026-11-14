// Measures the loops UI in a running harness build against design-07's
// "Frontend spec: exact values", from computed styles and layout boxes (what
// DevTools shows), and prints one line per value: PASS or FAIL, spec and actual.
//
//   node scripts/agent-harness/loops-measure.mjs home --data-dir <dir>
//   node scripts/agent-harness/loops-measure.mjs card --data-dir <dir>
//
// home: Home must be showing, Progress open, with at least one loop opened that
// has sub-loops, and the filter open (the script opens what it needs).
// card: the workspace with the loops card open.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const what = process.argv[2];
const dd = process.argv.indexOf('--data-dir');
const dataDir = dd > 0 ? process.argv[dd + 1] : null;
if (!['home', 'card'].includes(what) || !dataDir) { console.error('usage: loops-measure.mjs home|card --data-dir <dir>'); process.exit(2); }

// Runs in the page. Each check: [name, selector, property, expected, tolerance?].
// property: a computed style name, or 'w'/'h' for the layout box, or 'gapTo:<sel>'.
const page = (kind) => `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const q = (s) => document.querySelector(s);
  if (${JSON.stringify(kind)} === 'home') {
    if (!q('.prog-col')) return JSON.stringify({ error: 'Home with Progress open is not showing' });
    const parent = [...document.querySelectorAll('.prog-list .lp-row:not(.sub)')].find(r => r.querySelector('.lp-frac'));
    if (parent && !parent.classList.contains('open-row')) { parent.click(); await sleep(450); }
    const sub = q('.prog-list .lp-row.sub'); if (sub && !sub.classList.contains('open-row')) { sub.click(); await sleep(450); }
    if (!q('.pg-finline.open')) { q('[data-act=toggle-filters]').click(); await sleep(450); }
  } else {
    if (!q('.lc-card')) return JSON.stringify({ error: 'the loops card is not open' });
    const parent = [...document.querySelectorAll('.lc-card .lp-row:not(.sub)')].find(r => r.querySelector('.lp-frac'));
    if (parent && !parent.classList.contains('open-row')) { parent.click(); await sleep(450); }
  }
  const checks = ${kind === 'home' ? `[
    ['Progress column width', '.prog-col', 'w', 472],
    ['gap from projects to Progress', '.home-lay', 'column-gap', '40px'],
    ['page padding', '.home-lay', 'padding-left', '40px'],
    ['Progress heading', '.pg-lbl', 'font-size', '10px'],
    ['calendar card width', '.pg-act', 'w', 472],
    ['calendar card padding', '.pg-act', 'padding', '9px 10px 8px'],
    ['calendar card radius', '.pg-act', 'border-radius', '10px'],
    ['calendar card gap', '.pg-act', 'row-gap', '6px'],
    ['streak heading', '.pg-act-h > b', 'font-size', '13.6px'],
    ['streak heading weight', '.pg-act-h > b', 'font-weight', '500'],
    ['Longest', '.pg-long', 'font-size', '9.2px'],
    ['square', '.pg-hm .pg-cell', 'w', 16],
    ['square height', '.pg-hm .pg-cell', 'h', 16],
    ['square gap', '.pg-hm', 'column-gap', '3.2px'],
    ['square radius', '.pg-hm .pg-cell', 'border-radius', '3.2px'],
    ['month label', '.pg-mo', 'font-size', '8.8px'],
    ['day label', '.pg-dl', 'font-size', '9.2px'],
    ['legend', '.pg-legend', 'font-size', '8.8px'],
    ['arrow', '.pg-nav', 'w', 16],
    ['count card width', '.pg-count', 'w', 472],
    ['count card padding', '.pg-count', 'padding', '9px 10px'],
    ['count card radius', '.pg-count', 'border-radius', '10px'],
    ['remaining number', '.pg-big b', 'font-size', '19.2px'],
    ['remaining word', '.pg-big span', 'font-size', '10.4px'],
    ['open/rotting/closed button', '.pg-split button', 'h', 18.4],
    ['open/rotting/closed text', '.pg-split button', 'font-size', '10px'],
    ['rotting circle', '.pg-rot-n', 'h', 13.6],
    ['rotting circle colour', '.pg-rot-n', 'background-color', 'rgb(232, 162, 58)'],
    ['bar', '.pg-track', 'h', 4],
    ['filter icon button', '[data-act=toggle-filters]', 'w', 22],
    ['segment', '.pg-fseg button', 'h', 19],
    ['segment text', '.pg-fseg button', 'font-size', '11.5px'],
    ['project dropdown', '.pg-fdrop', 'h', 22],
    ['row height', '.prog-list .lp-row:not(.sub):not(.open-row)', 'h', 31],
    ['row title', '.prog-list .lp-row:not(.sub) .lp-t1', 'font-size', '12.5px'],
    ['row padding', '.prog-list .lp-row', 'padding', '0px 8px'],
    ['row radius', '.prog-list .lp-row:not(.open-row)', 'border-radius', '8px'],
    ['row gap', '.prog-list .lp-row', 'column-gap', '8px'],
    ['open status circle', '.prog-list .lp-st-open', 'w', 11],
    ['filled status circle', '.prog-list .lp-st-closed, .prog-list .lp-st-rot', 'w', 12],
    ['label icon', '.prog-list .lp-row:not(.sub) .lp-kind svg', 'w', 12],
    ['1/5', '.prog-list .lp-frac', 'font-size', '11px'],
    ['project name', '.prog-list .lp-pname', 'font-size', '11.5px'],
    ['time', '.prog-list .lp-when', 'font-size', '11.5px'],
    ['sub-loop row', '.prog-list .lp-row.sub:not(.open-row)', 'h', 26],
    ['sub-loop title', '.prog-list .lp-row.sub .lp-t1', 'font-size', '12px'],
    ['sub-loop indent', '.prog-list .lp-subs', 'margin-left', '21px'],
    ['opened row colour', '.prog-list .lp-row.open-row', 'background-color', 'rgb(51, 51, 51)'],
    ['opened row radius', '.prog-list .lp-row.open-row', 'border-radius', '8px 8px 0px 0px'],
    ['box colour', '.prog-list .lp-det', 'background-color', 'rgb(51, 51, 51)'],
    ['box radius', '.prog-list .lp-det', 'border-radius', '0px 0px 8px 8px'],
    ['box padding', '.prog-list .lp-det', 'padding', '2px 8px 7px'],
    ['box full width', '.prog-list .lp-det', 'sameWidth:.prog-list .lp-row:not(.sub)', true],
    ['description', '.prog-list .lp-desc', 'font-size', '12px'],
    ['status note', '.prog-list .lp-stn', 'font-size', '11.5px'],
    ['status note colour', '.prog-list .lp-stn', 'color', 'rgb(142, 142, 142)'],
    ['note clock', '.prog-list .lp-stn svg', 'w', 11],
    ['description line height (1.45)', '.prog-list .lp-desc', 'line-height', '17.4px'],
    ['status note line height (1.45)', '.prog-list .lp-stn', 'line-height', '16.675px'],
    ['current streak outline not cut', '.pg-hmclip', 'outlineRoom', true],
    ['between description and note', '.prog-list .lp-dtx', 'row-gap', '6px'],
    ['date', '.home-date', 'font-size', '23.4px'],
    ['pinned card height', '.home .cd', 'min-height', '83px'],
    ['pinned card padding', '.home .cd', 'padding', '14px'],
    ['pinned card radius', '.home .cd', 'border-radius', '14px'],
    ['pinned card name', '.home .cd .n', 'font-size', '12.6px'],
    ['pinned card time', '.home .cd .f', 'font-size', '11.7px'],
    ['pinned card gap', '.home .cards', 'column-gap', '11px'],
    ['project row name', '.home .pr .n', 'font-size', '12.6px'],
    ['project row padding', '.home .pr', 'padding', '9px 11px'],
    ['project row time', '.home .pr .t', 'font-size', '11.7px'],
    ['section label', '.home .lbl', 'font-size', '12px'],
    ['search box width', '.psearch', 'w', 171],
    ['search box height', '.psearch', 'h', 23],
    ['search box radius', '.psearch', 'border-radius', '6px'],
    ['search text', '.psearch input', 'font-size', '11.7px'],
    ['the page itself does not scroll', '.screen-home', 'noScroll', true],
  ]` : `[
    ['card width', '.lc-card', 'w', 320],
    ['card from the top of the main pane', '.lc-card', 'topFrom:.app-main', 64],
    ['card from the right edge', '.lc-card', 'rightFrom:.app-main', 24],
    ['card radius', '.lc-card', 'border-radius', '14px'],
    ['card border', '.lc-card', 'border-top', '1px solid rgb(51, 51, 51)'],
    ['card shadow', '.lc-card', 'box-shadow', 'rgb(0, 0, 0) 0px 12px 32px 0px'],
    ['card colour', '.lc-card', 'background-color', 'rgb(38, 38, 38)'],
    ['heading padding', '.lc-head', 'padding', '10px 10px 8px 14px'],
    ['Loops', '.lc-title', 'font-size', '13px'],
    ['Loops weight', '.lc-title', 'font-weight', '500'],
    ['rotting button height', '.lc-rot', 'h', 24],
    ['rotting button padding', '.lc-rot', 'padding', '0px 9px'],
    ['rotting button radius', '.lc-rot', 'border-radius', '7px'],
    ['rotting button text', '.lc-rot', 'font-size', '12px'],
    ['rotting button colour', '.lc-rot', 'background-color', 'rgb(232, 162, 58)'],
    ['rotting button ink', '.lc-rot', 'color', 'rgb(20, 20, 20)'],
    ['row title wraps', '.lc-card .lp-row .lp-t1', 'white-space', 'normal'],
    ['row title line height', '.lc-card .lp-row:not(.sub) .lp-t1', 'line-height', '16.875px'],
    ['row title padding', '.lc-card .lp-row .lp-t1', 'padding-top', '6px'],
    ['row height (one line)', '.lc-card .lp-row:not(.sub):not(.open-row)', 'minH', 31],
    ['row hover colour token', '.lc-card', 'hover2', true],
    ['foot border', '.lc-foot', 'border-top', '1px solid rgb(51, 51, 51)'],
    ['foot padding', '.lc-foot', 'padding', '10px 10px 10px 14px'],
    ['remaining text', '.lc-barbox', 'font-size', '12px'],
    ['bar', '.lc-track', 'h', 5],
    ['All button height', '.lc-all', 'h', 22],
    ['All button padding', '.lc-all', 'padding', '0px 9px'],
    ['All button radius', '.lc-all', 'border-radius', '6px'],
    ['All button text', '.lc-all', 'font-size', '11.5px'],
    ['All button weight', '.lc-all', 'font-weight', '500'],
    ['header button height', '[data-loops-button]', 'h', 30],
    ['header button count', '[data-loops-button] .lc-cnt', 'font-size', '12px'],
    ['opened row colour', '.lc-card .lp-row.open-row', 'background-color', 'rgb(51, 51, 51)'],
    ['box padding', '.lc-card .lp-det', 'padding', '2px 8px 7px'],
    ['box full width', '.lc-card .lp-det', 'sameWidth:.lc-card .lp-row:not(.sub)', true],
  ]`};
  const out = [];
  for (const [name, sel, prop, want] of checks) {
    const el = q(sel);
    if (!el) { out.push([name, sel, prop, want, '(missing)', false]); continue; }
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    let got, ok;
    if (prop === 'w' || prop === 'h') { got = Math.round((prop === 'w' ? r.width : r.height) * 10) / 10; ok = Math.abs(got - want) <= 0.6; }
    else if (prop === 'minH') { got = Math.round(r.height * 10) / 10; ok = got >= want - 0.6; }
    else if (prop === 'outlineRoom') { const cells = [...el.querySelectorAll('.pg-cell.cur')]; const cr = el.getBoundingClientRect(); got = cells.every(c => { const b = c.getBoundingClientRect(); return b.left - 2 >= cr.left && b.right + 2 <= cr.right && b.top - 2 >= cr.top && b.bottom + 2 <= cr.bottom; }); ok = got === want; }
    else if (prop === 'noScroll') { got = el.scrollHeight <= el.clientHeight; ok = got === want; }
    else if (prop === 'hover2') { got = getComputedStyle(document.documentElement).getPropertyValue('--hover2').trim(); ok = got === '#383838'; }
    else if (prop.startsWith('sameWidth:')) { const o = q(prop.slice(10)); got = o ? Math.round(r.width) + ' vs ' + Math.round(o.getBoundingClientRect().width) : 'none'; ok = !!o && Math.abs(r.width - o.getBoundingClientRect().width) < 1; }
    else if (prop.startsWith('topFrom:')) { const o = q(prop.slice(8)); got = o ? Math.round(r.top - o.getBoundingClientRect().top) : 'none'; ok = got === want; }
    else if (prop.startsWith('rightFrom:')) { const o = q(prop.slice(10)); got = o ? Math.round(o.getBoundingClientRect().right - r.right) : 'none'; ok = got === want; }
    else { got = cs.getPropertyValue(prop); ok = got === want; }
    out.push([name, sel, prop, want, got, ok]);
  }
  return JSON.stringify(out);
})()`;

const raw = execFileSync(process.execPath, [path.join(here, 'drive.mjs'), 'eval', page(what), '--data-dir', dataDir], { encoding: 'utf8' });
let rows = JSON.parse(raw.trim());
if (typeof rows === 'string') rows = JSON.parse(rows);
if (!Array.isArray(rows)) { console.error(JSON.stringify(rows)); process.exit(1); }
let pass = 0, fail = 0;
for (const [name, , prop, want, got, ok] of rows) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: spec ${JSON.stringify(want)}, measured ${JSON.stringify(got)}${ok ? '' : `  (${prop})`}`);
  ok ? pass++ : fail++;
}
console.log(`\n${pass} match, ${fail} differ`);
process.exit(fail ? 1 : 0);

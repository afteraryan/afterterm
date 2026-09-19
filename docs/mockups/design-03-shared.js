// Shared data, icons and renderers for the design-03 variant sheets
// (sidebar-*-variants.html). One realistic data set (eight live projects, three
// pinned, threads in every state) and the row markup of afterterm-next.html, so
// each sheet only has to describe what its variants change.
//
// A sheet calls initVariants({ title, variants: [{ id, name, closes, note,
// render(frame, opts) }], options: [{ key, label, default }] }). The sheet chrome
// (variant buttons, the note, option checkboxes) is drawn above a 1280x760 frame;
// the chosen variant's render() fills the frame.

/* ── Icons (the app's set, plus a bell-off glyph for Mark as unread) ────── */
const ICONS = `
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <symbol id="i-home" viewBox="0 0 24 24"><path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></symbol>
  <symbol id="i-term" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m7 9 3 3-3 3M12 15h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></symbol>
  <symbol id="i-panel" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 4v16" stroke="currentColor" stroke-width="1.8"/></symbol>
  <symbol id="i-pin" viewBox="0 0 24 24"><path d="M15 3h-6l1 2v5.5L7 13v2h4v6h2v-6h4v-2l-3-2.5V5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></symbol>
  <symbol id="i-pin-on" viewBox="0 0 24 24"><path d="M15 3h-6l1 2v5.5L7 13v2h4v6h2v-6h4v-2l-3-2.5V5z" fill="currentColor"/></symbol>
  <symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m16 16 4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></symbol>
  <symbol id="i-more" viewBox="0 0 24 24"><circle cx="6" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="18" cy="12" r="1.6" fill="currentColor"/></symbol>
  <symbol id="i-chev-r" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></symbol>
  <symbol id="i-chev-d" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></symbol>
  <symbol id="i-chev-up-down" viewBox="0 0 24 24"><path d="m7 9 5-5 5 5M7 15l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></symbol>
  <symbol id="i-collapse-all" viewBox="0 0 24 24"><path d="m7 10 5-5 5 5M7 14l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></symbol>
  <symbol id="i-expand-all" viewBox="0 0 24 24"><path d="m7 4 5 5 5-5M7 20l5-5 5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></symbol>
  <symbol id="i-check" viewBox="0 0 24 24"><path d="m5.5 12.5 4 4 9-9" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></symbol>
  <symbol id="i-bell" viewBox="0 0 24 24"><path d="M12 3a6 6 0 0 0-6 6v3.6L4.4 15.5A1 1 0 0 0 5.2 17h13.6a1 1 0 0 0 .8-1.5L18 12.6V9a6 6 0 0 0-6-6z" fill="currentColor"/><path d="M9.5 19a2.5 2.5 0 0 0 5 0z" fill="currentColor"/></symbol>
  <symbol id="i-play" viewBox="0 0 24 24"><path d="M8.5 5.9c0-1.1 1.2-1.8 2.1-1.2l8.4 5.9c.9.6.9 1.9 0 2.5l-8.4 5.9c-.9.6-2.1 0-2.1-1.2z" fill="currentColor"/></symbol>
  <symbol id="i-moon" viewBox="0 0 24 24"><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7z" fill="currentColor"/></symbol>
  <symbol id="i-dot" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" fill="currentColor"/></symbol>
  <symbol id="i-model" viewBox="0 0 24 24"><path d="M12 3.5c.6 3.8 2.7 5.9 6.5 6.5-3.8.6-5.9 2.7-6.5 6.5-.6-3.8-2.7-5.9-6.5-6.5 3.8-.6 5.9-2.7 6.5-6.5zM18.5 14.5c.3 1.7 1.2 2.6 2.9 2.9-1.7.3-2.6 1.2-2.9 2.9-.3-1.7-1.2-2.6-2.9-2.9 1.7-.3 2.6-1.2 2.9-2.9z" fill="currentColor"/></symbol>
  <symbol id="i-x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></symbol>
  <symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></symbol>
  <symbol id="i-folder" viewBox="0 0 24 24"><path d="M2.5 7A2 2 0 0 1 4.5 5h4.6l2 2h8.4a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2z" fill="currentColor"/><path d="M2.5 9.5h19" stroke="rgba(0,0,0,.28)" stroke-width="1.2"/></symbol>
  <symbol id="i-folder-open" viewBox="0 0 24 24"><path d="M2.5 7A2 2 0 0 1 4.5 5h4.6l2 2h7.4a2 2 0 0 1 2 2v1.5H6.6a2 2 0 0 0-1.9 1.4L2.5 17z" fill="currentColor" fill-opacity=".72"/><path d="M2.6 18.2 5 11.9a1.5 1.5 0 0 1 1.4-1H22l-2.7 7.1a2 2 0 0 1-1.9 1.3H4.3a1.8 1.8 0 0 1-1.7-2.1z" fill="currentColor"/></symbol>
  <symbol id="i-page" viewBox="0 0 24 24"><path d="M2.5 7A2 2 0 0 1 4.5 5h4.6l2 2h8.4a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="m10.6 10.35 2.9 2.9-2.9 2.9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></symbol>
  <symbol id="i-chat" viewBox="0 0 24 24"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V17H6.5A2.5 2.5 0 0 1 4 14.5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></symbol>
  <symbol id="i-shell" viewBox="0 0 24 24"><path d="m5 7 5 5-5 5M12 17h7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></symbol>
  <symbol id="i-branch" viewBox="0 0 24 24"><circle cx="6" cy="5" r="2.2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="6" cy="19" r="2.2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="18" cy="8" r="2.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6 7.2v9.6M18 10.2c0 3.3-3 4.3-6 4.8-2.6.4-6 1-6 1.8" fill="none" stroke="currentColor" stroke-width="1.6"/></symbol>
  <symbol id="i-min" viewBox="0 0 24 24"><path d="M5 12h14" stroke="currentColor" stroke-width="1.4"/></symbol>
  <symbol id="i-max" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4"/></symbol>
</svg>`;

const COLORS = { teal: '#2dd4bf', blue: '#60a5fa', purple: '#a78bfa', orange: '#fb923c', red: '#f87171', green: '#4ade80', pink: '#f472b6', yellow: '#facc15' };

/* ── Data: eight live projects (three pinned), threads in every state ──── */
// lastActive is minutes ago. pinned order is the saved (dragged) order.
const PROJECTS = [
  { id: 'afterterm', name: 'afterterm', color: 'teal', pinned: true, lastActive: 12, folder: 'D:\\Pitara\\Work\\Tinkering\\afterterm' },
  { id: 'aftertales', name: 'aftertales', color: 'purple', pinned: true, lastActive: 3, folder: 'D:\\Pitara\\Work\\aftertales' },
  { id: 'answer-machine', name: 'answer-machine', color: 'orange', pinned: true, lastActive: 2 * 24 * 60, folder: 'D:\\Pitara\\Work\\Tinkering\\answer-machine' },
  { id: 'afterthought', name: 'afterthought', color: 'blue', pinned: false, lastActive: 5, folder: 'D:\\Pitara\\Work\\Tinkering\\afterthought' },
  { id: 'website-desk', name: 'website-afteraryan-desk', color: 'yellow', pinned: false, lastActive: 6 * 24 * 60, folder: 'D:\\Pitara\\Work\\website-afteraryan-desk' },
  { id: 'canvas-agent', name: 'canvas-agent', color: 'pink', pinned: false, lastActive: 21 * 24 * 60, folder: 'D:\\Pitara\\Work\\Tinkering\\canvas-agent' },
  { id: 'transcript', name: 'transcript-fetcher-clone', color: 'green', pinned: false, lastActive: 30 * 24 * 60, folder: 'D:\\Pitara\\Work\\Tinkering\\transcript-fetcher-clone' },
  { id: 'ghar', name: 'Ghar', color: 'red', pinned: false, lastActive: 60 * 24 * 60, folder: 'D:\\Pitara\\Personal\\Ghar' },
];

// state: needs-you | working | done | running | quiet | asleep | unread
// unread is a chat the user marked (design-03); it renders with the bell too.
const THREADS = [
  { id: 't1', p: 'afterterm', kind: 'chat', name: 'Reimagine the sidebar around threads', state: 'working', model: 'Opus 5 · 1M', branch: 'design-03-sidebar-and-attention', ago: 'now' },
  { id: 't2', p: 'afterterm', kind: 'server', name: 'npm start', state: 'running', port: 5173, branch: 'main', ago: '2h' },
  { id: 't3', p: 'afterterm', kind: 'chat', name: 'Fix spinner sticking after compaction', state: 'done', model: 'Opus 5', branch: 'fix/spinner-compaction', ago: '1h' },
  { id: 't4', p: 'afterterm', kind: 'shell', name: 'afterterm', state: 'quiet', branch: 'main', ago: '20m' },
  { id: 't5', p: 'afterterm', kind: 'chat', name: 'Persist the Projects shelf state', state: 'asleep', model: 'Opus 5', ago: '2d' },
  { id: 't13', p: 'afterterm', kind: 'chat', name: 'Titlebar branding and version badge', state: 'asleep', model: 'Sonnet 5', ago: '4d' },
  { id: 't14', p: 'afterterm', kind: 'shell', name: 'pwsh', state: 'asleep', ago: '5d' },
  { id: 't6', p: 'aftertales', kind: 'chat', name: 'Map view vs grid for browsing tales', state: 'needs-you', model: 'Opus 5 · 1M', branch: 'main', ago: '3m' },
  { id: 't7', p: 'aftertales', kind: 'server', name: 'npm run dev', state: 'running', port: 3000, branch: 'main', ago: '40m' },
  { id: 't8', p: 'aftertales', kind: 'chat', name: 'Write the about page copy', state: 'unread', model: 'Sonnet 5', branch: 'main', ago: '3h' },
  { id: 't9', p: 'aftertales', kind: 'chat', name: 'Import the 189 tales from the CSV', state: 'asleep', model: 'Opus 5', ago: '1d' },
  { id: 't10', p: 'answer-machine', kind: 'chat', name: 'Add retry to the fetch layer', state: 'needs-you', model: 'Opus 5', branch: 'main', ago: '8m' },
  { id: 't11', p: 'answer-machine', kind: 'chat', name: 'Cache answers per question hash', state: 'asleep', model: 'Opus 5', ago: '2d' },
  { id: 't12', p: 'afterthought', kind: 'chat', name: 'Tag pages by topic', state: 'working', model: 'Opus 5', branch: 'main', ago: 'now' },
  { id: 't15', p: 'afterthought', kind: 'shell', name: 'afterthought', state: 'quiet', branch: 'main', ago: '5m' },
  { id: 't16', p: 'website-desk', kind: 'chat', name: 'Move the hero image to the right', state: 'asleep', model: 'Sonnet 5', ago: '6d' },
  { id: 't17', p: 'canvas-agent', kind: 'chat', name: 'Draw the agent loop as a diagram', state: 'asleep', model: 'Opus 5', ago: '3w' },
  { id: 't18', p: 'canvas-agent', kind: 'shell', name: 'canvas-agent', state: 'asleep', ago: '3w' },
  { id: 't19', p: 'ghar', kind: 'chat', name: 'Monthly budget sheet formulas', state: 'asleep', model: 'Opus 5', ago: '2mo' },
  { id: 'g1', p: null, kind: 'shell', name: '~', state: 'quiet', ago: '1h' },
];

const LIMIT = 5;
const P = id => PROJECTS.find(p => p.id === id);
const T = id => THREADS.find(t => t.id === id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const svg = (id, size = 16) => `<svg width="${size}" height="${size}"><use href="#${id}"/></svg>`;

// Per-sheet state, kept on window so a variant re-render keeps the selection.
const S = window.__d3 = window.__d3 || {
  selected: 't4',
  collapsed: {},        // project id -> true when its thread list is folded away
  expanded: {},         // list key -> true when past the five-row fold
  needsYouCleared: {},  // t id -> true once "answered" in this sheet
};

/* ── Small pieces ──────────────────────────────────────────────────────── */
function folder(p, open, size = 18) {
  return `<span class="fo" style="color:${COLORS[p.color]}">${svg(open ? 'i-folder-open' : 'i-folder', size)}</span>`;
}
function kindIcon(t, size = 15) {
  return `<span class="ki">${svg(t.kind === 'chat' ? 'i-chat' : 'i-shell', size)}</span>`;
}
function stateIcon(t) {
  switch (t.state) {
    case 'needs-you': return `<span class="si need" data-tip="Needs you">${svg('i-bell', 14)}</span>`;
    case 'unread': return `<span class="si need" data-tip="Marked unread">${svg('i-bell', 14)}</span>`;
    case 'working': return `<span class="spin" data-tip="Working"></span>`;
    case 'done': return `<span class="si ok" data-tip="Done">${svg('i-check', 14)}</span>`;
    case 'running': return `<span class="si run" data-tip="Running on :${t.port}">${svg('i-play', 13)}</span>`;
    case 'asleep': return `<span class="si sleep" data-tip="Asleep">${svg('i-moon', 13)}</span>`;
    default: return '';
  }
}
function stateWord(t) {
  return { 'needs-you': 'Needs you', unread: 'Unread', working: 'Working', done: 'Done', running: `Running on :${t.port}`, asleep: `Asleep · ${t.ago}`, quiet: '' }[t.state];
}
function sig(kind, n) {
  if (!n) return '';
  const ic = kind === 'need' ? svg('i-bell', 14) : svg('i-play', 13);
  return `<span class="sig ${kind}"><span class="si ${kind}">${ic}</span>${n}</span>`;
}

// Counts per project. needsYou includes marked-unread chats (design-03's
// recommendation: one bell); working is mid-turn chats only; running is servers.
function counts(pid) {
  const ts = THREADS.filter(t => t.p === pid);
  return {
    needsYou: ts.filter(t => t.state === 'needs-you' || t.state === 'unread').length,
    done: ts.filter(t => t.state === 'done').length,
    working: ts.filter(t => t.state === 'working').length,
    running: ts.filter(t => t.state === 'running').length,
  };
}
const projectThreads = pid => THREADS.filter(t => t.p === pid);
const awake = pid => projectThreads(pid).filter(t => t.state !== 'asleep');

/* ── Rows ──────────────────────────────────────────────────────────────── */
// opts.flat: a row outside its project (the filter's flat list) shows the
// project's folder and name before the thread name.
function threadRow(t, opts = {}) {
  const sel = t.id === S.selected;
  const breathe = !sel && (t.state === 'needs-you' || t.state === 'unread') ? 'breathe-need' : (!sel && t.state === 'done' ? 'breathe-done' : '');
  const cls = ['th', t.p ? '' : 'gen', opts.flat ? 'flat' : '', sel ? 'sel' : '', t.state === 'asleep' ? 'sleep' : '', breathe].filter(Boolean).join(' ');
  const pf = opts.flat && t.p ? `<span class="pf">${folder(P(t.p), false, 13)}${esc(P(t.p).name)}</span>` : '';
  return `<div class="${cls}" data-th="${t.id}">${kindIcon(t)}${pf}<span class="n">${esc(t.name)}</span>${t.state === 'running' ? `<span class="prt">:${t.port}</span>` : ''}${stateIcon(t)}<button class="xb" data-tip="Close" tabindex="-1">${svg('i-x', 14)}</button></div>`;
}

function threadList(pid, opts = {}) {
  const ts = opts.threads || projectThreads(pid);
  const key = pid || 'general';
  const idx = ts.findIndex(t => t.id === S.selected);
  const open = !!S.expanded[key] || idx >= LIMIT;
  const shown = open ? ts : ts.slice(0, LIMIT);
  return shown.map(t => threadRow(t, opts)).join('') +
    (ts.length > LIMIT ? `<button class="thmore" data-more="${key}">${open ? 'Show less' : `Show ${ts.length - LIMIT} more`}</button>` : '');
}

// A project row plus its thread list. opts: { pinned, pinmark, extraTail }
function projectBlock(p, opts = {}) {
  const ts = projectThreads(p.id);
  const c = counts(p.id);
  const closed = !!S.collapsed[p.id];
  const pinmark = opts.pinmark ? `<span class="pinmark">${svg('i-pin-on', 13)}</span>` : '';
  const pinBtn = opts.pinned ? '' : `<button class="ib" data-tip="Pin" tabindex="-1">${svg('i-pin', 14)}</button>`;
  const row = `<div class="pj ${opts.pinned ? '' : 'dim'}" data-pj="${p.id}">${folder(p, !closed)}<span class="n">${esc(p.name)}</span>${closed && ts.length ? `<span class="c">${ts.length}</span>` : ''}${sig('need', c.needsYou)}${sig('run', c.working + c.running)}${pinmark}${opts.extraTail || ''}<button class="ib" data-tip="New thread in ${esc(p.name)}" tabindex="-1">${svg('i-plus', 14)}</button><button class="ib" data-tip="Open project page" tabindex="-1">${svg('i-page', 14)}</button>${pinBtn}</div>`;
  const list = ts.length ? `<div class="tlw${closed ? ' closed' : ''}"><div class="tli">${threadList(p.id)}</div></div>` : '';
  return `<div class="pjw">${row}${list}</div>`;
}

function sectionLabel(text, extra = '') {
  return `<div class="lbl lblrow"><span>${text}</span>${extra}</div>`;
}

// Today's sidebar body (General, Pinned, Projects), for the variants that keep
// it and add to it.
function pinnedList() { return PROJECTS.filter(p => p.pinned); }
function unpinnedList(sortByActivity = true) {
  const l = PROJECTS.filter(p => !p.pinned);
  return sortByActivity ? [...l].sort((a, b) => a.lastActive - b.lastActive) : l;
}
function generalList() { return THREADS.filter(t => !t.p); }

function defaultSections(opts = {}) {
  const gen = generalList();
  return `${gen.length ? `<div class="sec"><div class="lbl">General</div>${threadList(null)}</div>` : ''}
    <div class="sec"><div class="lbl">Pinned</div>${pinnedList().map(p => projectBlock(p, { pinned: true })).join('')}</div>
    <div class="sec">${sectionLabel('Projects', `<button class="ib" data-tip="New project">${svg('i-plus', 14)}</button>`)}${unpinnedList(opts.sort !== false).map(p => projectBlock(p, {})).join('')}</div>`;
}

/* ── The panel, the rails, the main pane, the title bar ────────────────── */
function brandRow(opts = {}) {
  return `<div class="brand">${opts.noNav ? '' : `<button class="ic" data-tip="Home">${svg('i-home', 18)}</button><button class="ic" aria-selected="true" data-tip="Workspace">${svg('i-term', 18)}</button>`}<span class="sp"></span>${opts.extra || ''}<button class="ic" data-tip="Close sidebar" data-toggle-panel>${svg('i-panel', 18)}</button></div>`;
}
function searchRow() {
  return `<button class="srow"><span class="g">${svg('i-search', 16)}</span>Search<span class="k">Ctrl Shift P</span></button>`;
}
function newThreadRow() {
  return `<button class="srow"><span class="g">${svg('i-plus', 16)}</span>New thread<span class="k">Ctrl Shift T</span></button>`;
}
// The panel: brand row, then whatever `top` holds (search, new thread, a
// filter), then the scrolling body.
function panel(body, opts = {}) {
  return `<aside class="side${opts.hidden ? ' hidden' : ''}">${brandRow(opts.brand || {})}${opts.top ?? (searchRow() + newThreadRow())}<div class="scroll">${body}</div></aside>`;
}

// Today's rail (shown instead of the panel when collapsed).
function oldRail() {
  return `<div class="rail show"><button class="ic" data-tip="Open sidebar" data-toggle-panel>${svg('i-panel', 18)}</button><button class="ic" data-tip="Home">${svg('i-home', 18)}</button><button class="ic" aria-selected="true" data-tip="Workspace">${svg('i-term', 18)}</button><button class="ic" data-tip="Search">${svg('i-search', 18)}</button><button class="ic" data-tip="New thread">${svg('i-plus', 18)}</button></div>`;
}

// A project tile for the always-on rail. Badge: amber count of needs-you (and
// unread); a small spinner at the corner when a thread is working. Style
// 'letter' is the project's initial on its colour; 'folder' is the coloured
// folder icon itself.
function tile(p, opts = {}) {
  const c = counts(p.id);
  const cur = opts.current ? ' cur' : '';
  const badge = c.needsYou ? `<span class="bd">${c.needsYou}</span>` : (c.done && opts.countDone ? `<span class="bd grey">${c.done}</span>` : '');
  const wk = c.working ? `<span class="wk"><span class="spin"></span></span>` : '';
  const tipParts = [];
  if (c.needsYou) tipParts.push(`${c.needsYou} need${c.needsYou === 1 ? 's' : ''} you`);
  if (c.working) tipParts.push(`${c.working} working`);
  if (c.done) tipParts.push(`${c.done} done`);
  const tip = `${esc(p.name)}${tipParts.length ? ' · ' + tipParts.join(' · ') : ''}`;
  const inner = opts.style === 'folder' ? svg('i-folder', 20) : esc(p.name[0].toUpperCase());
  return `<button class="tile${cur}${opts.style === 'folder' ? ' folder' : ''}${opts.leaving ? ' leaving' : ''}" style="--tc:${COLORS[p.color]}" data-tile="${p.id}" data-tip="${tip}">${inner}${badge}${wk}</button>`;
}

// The always-on rail: Home and Workspace at the top, tiles, then the bottom
// controls. opts.panelHidden adds Search and New thread at the bottom.
function newRail(tilesHtml, opts = {}) {
  const bottom = opts.panelHidden
    ? `<button class="ic" data-tip="Search">${svg('i-search', 18)}</button><button class="ic" data-tip="New thread">${svg('i-plus', 18)}</button><button class="ic" data-tip="Open sidebar" data-toggle-panel>${svg('i-panel', 18)}</button>`
    : '';
  return `<div class="rail2"><button class="ic" data-tip="Home"${opts.onHome ? ' aria-selected="true"' : ''}>${svg('i-home', 18)}</button><button class="ic" data-tip="Workspace"${opts.onHome ? '' : ' aria-selected="true"'}>${svg('i-term', 18)}</button><span class="sep"></span><div class="tiles">${tilesHtml}</div><span class="grow"></span>${bottom}</div>`;
}

const LINES = {
  t4: [['p', 'D:\\Pitara\\Work\\Tinkering\\afterterm> '], ['', 'git status'], ['', 'On branch main'], ['', 'nothing to commit, working tree clean'], ['', ''], ['p', 'D:\\Pitara\\Work\\Tinkering\\afterterm> '], ['cur', '']],
  t6: [['p', '> '], ['', 'Prototype a map view for the 189 tales next to the existing grid and tell me which one is easier to browse.'], ['', ''], ['b', '● Read src/pages/browse.tsx'], ['b', '● Write src/pages/browse-map.tsx'], ['', ''], ['y', 'Permission needed'], ['y', '  Bash: npm install leaflet react-leaflet'], ['d', '  Allow once · Allow always · Deny']],
  t10: [['p', '> '], ['', 'Add retry with backoff to the fetch layer.'], ['', ''], ['b', '● Read src/fetch.ts'], ['', ''], ['y', 'Which retry policy should I use?'], ['d', '  1. Three tries, 250 ms then 1 s then 4 s'], ['d', '  2. Five tries, exponential from 100 ms'], ['d', '  3. Let me specify']],
  t1: [['p', '> '], ['', 'Reimagine the sidebar around threads.'], ['', ''], ['b', '● Read src/renderer/components/SidePanel/index.tsx'], ['b', '● Edit src/renderer/threadView.ts'], ['', ''], ['y', '⠸ Rewriting the sidebar sections… (14s)']],
  t3: [['p', '> '], ['', 'The working spinner stays on after compaction ends.'], ['', ''], ['b', '● Edit src/renderer/spinnerState.ts'], ['g', '  ✔ 20 passed'], ['', ''], ['g', 'Done. Two files changed, one test added.']],
  t2: [['d', '$ npm start'], ['', ''], ['m', '  VITE v5.4.8  ready in 412 ms'], ['', ''], ['', '  ➜  Local:   http://localhost:5173/']],
  t8: [['p', '> '], ['', 'Write the about page copy in the same voice as the home page.'], ['', ''], ['g', 'Done. Draft in src/pages/about.md, 240 words.']],
  t15: [['p', 'D:\\Pitara\\Work\\Tinkering\\afterthought> '], ['', 'git log --oneline -3'], ['', '9c1f0a2 tag pages by topic (wip)'], ['', '4b77e10 add the topic index'], ['', '1d0c9ee first pass at the reader'], ['', ''], ['p', 'D:\\Pitara\\Work\\Tinkering\\afterthought> '], ['cur', '']],
  t12: [['p', '> '], ['', 'Tag every page by topic.'], ['', ''], ['b', '● Read content/'], ['y', '⠸ Reading 84 pages… (22s)']],
};
function mainPane() {
  const t = T(S.selected);
  const p = t.p ? P(t.p) : null;
  const lines = (LINES[t.id] || [['d', '(no capture for this thread in the mock)'], ['p', '> '], ['cur', '']])
    .map(([c, s]) => c === 'cur' ? '<div class="ln"><span class="cursor"></span></div>' : `<div class="ln"><span class="${c}">${esc(s)}</span></div>`).join('');
  const chip = t.state === 'quiet' ? '' : `<span class="chip">${stateIcon(t)}${stateWord(t)}</span>`;
  return `<div class="main"><div class="mh"><div class="t"><div class="n">${kindIcon(t, 16)}<span>${esc(t.name)}</span></div><div class="m"><span>${p ? folder(p, true, 15) + esc(p.name) : svg('i-term', 14) + 'General'}</span>${t.model ? `<span>${svg('i-model', 14)}${esc(t.model)}</span>` : ''}${t.branch ? `<span>${svg('i-branch', 14)}${esc(t.branch)}</span>` : ''}</div></div><div class="acts">${chip}<button class="ic" data-tip="More">${svg('i-more', 18)}</button></div></div><div class="term">${lines}</div></div>`;
}

function titleBar() {
  return `<div class="titlebar"><span class="tname">afterterm</span><span class="ver">0.9.0</span><span class="sp"></span><div class="caption"><span class="cb">${svg('i-min', 14)}</span><span class="cb">${svg('i-max', 12)}</span><span class="cb">${svg('i-x', 14)}</span></div></div>`;
}

// A simplified Home for the "rail on every screen" toggle.
function homeScreen(opts = {}) {
  const tot = PROJECTS.reduce((a, p) => { const c = counts(p.id); a.n += c.needsYou; a.w += c.working + c.running; return a; }, { n: 0, w: 0 });
  const cards = pinnedList().map(p => { const c = counts(p.id); return `<div class="cd"><div class="hd">${folder(p, false, 20)}<span class="n">${esc(p.name)}</span></div><div class="f">${sig('need', c.needsYou)}${sig('run', c.working + c.running)}<span class="ago">${agoText(p.lastActive)}</span></div></div>`; }).join('');
  const rows = unpinnedList().slice(0, 4).map(p => `<div class="pr">${folder(p, false, 18)}<span class="n">${esc(p.name)}</span><span class="t">${agoText(p.lastActive)}</span></div>`).join('');
  const nav = opts.railNav ? '' : `<div class="brand" style="padding-left:14px"><button class="ic" aria-selected="true" data-tip="Home">${svg('i-home', 18)}</button><button class="ic" data-tip="Workspace">${svg('i-term', 18)}</button></div>`;
  return `<div class="home-wrap">${nav}<div class="home" style="${opts.railNav ? 'padding-top:28px' : ''}"><div><h1>Saturday, 19 September</h1><div class="tot">${sig('need', tot.n)}${sig('run', tot.w)}</div></div><div><div class="lbl">Pinned</div><div class="cards">${cards}</div></div><div><div class="lbl">Projects</div>${rows}<button class="pr" style="color:var(--text3);font-size:13px">Show 1 more</button></div></div></div>`;
}
function agoText(min) {
  if (min < 60) return `${min}m`;
  if (min < 24 * 60) return `${Math.round(min / 60)}h`;
  if (min < 7 * 24 * 60) return `${Math.round(min / 1440)}d`;
  if (min < 30 * 24 * 60) return `${Math.round(min / 10080)}w`;
  return `${Math.round(min / 43200)}mo`;
}

/* ── The sheet: variant buttons, note, options, frame ──────────────────── */
function initVariants(cfg) {
  document.body.insertAdjacentHTML('afterbegin', ICONS);
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  const hash = location.hash.replace('#', '');
  let current = cfg.variants.find(v => v.id === hash) ? hash : cfg.variants[0].id;
  const opts = {};
  (cfg.options || []).forEach(o => { opts[o.key] = o.default; });

  const draw = () => {
    const v = cfg.variants.find(x => x.id === current);
    sheet.innerHTML = `<div class="vbar"><h1>${esc(cfg.title)}</h1><div class="row">${cfg.variants.map(x => `<button class="vb" data-v="${x.id}" aria-selected="${x.id === current}">${esc(x.name)}</button>`).join('')}</div>
      <div class="note"><b>${esc(v.name)}.</b> ${v.note}${v.closes ? `<ul>${v.closes.map(c => `<li>${c}</li>`).join('')}</ul>` : ''}</div>
      ${cfg.options ? `<div class="opts">${cfg.options.filter(o => !o.only || o.only.includes(current)).map(o => `<label><input type="checkbox" data-opt="${o.key}" ${opts[o.key] ? 'checked' : ''}>${esc(o.label)}</label>`).join('')}<span style="margin-left:auto">Click rows, tiles and project names: the mock reacts.</span></div>` : ''}</div>
      <div class="frame" id="frame"></div><div class="tip" id="tip"></div><div class="menu" id="menu"></div>`;
    const frame = sheet.querySelector('#frame');
    v.render(frame, opts);
    sheet.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { current = b.dataset.v; location.hash = current; draw(); });
    sheet.querySelectorAll('[data-opt]').forEach(i => i.onchange = () => { opts[i.dataset.opt] = i.checked; draw(); });
    bindCommon(frame, () => draw());
  };
  document.body.appendChild(sheet);
  draw();
  window.__redraw = draw;
}

// Clicks every sheet shares: select a thread, fold a project, show more, the
// panel toggle, tooltips. A sheet can add its own handlers after render.
function bindCommon(frame, redraw) {
  frame.querySelectorAll('[data-th]').forEach(r => r.onclick = e => {
    if (e.target.closest('.xb')) return;
    S.selected = r.dataset.th;
    redraw();
  });
  frame.querySelectorAll('[data-pj]').forEach(r => r.onclick = e => {
    if (e.target.closest('button')) return;
    const id = r.dataset.pj;
    S.collapsed[id] = !S.collapsed[id];
    redraw();
  });
  frame.querySelectorAll('[data-more]').forEach(b => b.onclick = () => { S.expanded[b.dataset.more] = !S.expanded[b.dataset.more]; redraw(); });
  frame.querySelectorAll('[data-tile]').forEach(b => b.onclick = () => {
    const ts = projectThreads(b.dataset.tile);
    const pick = ts.find(t => t.state === 'needs-you' || t.state === 'unread') || ts.find(t => t.state === 'done') || ts.find(t => t.state !== 'asleep') || ts[0];
    if (pick) S.selected = pick.id;
    S.collapsed[b.dataset.tile] = false;
    redraw();
  });
  const tip = document.getElementById('tip');
  frame.querySelectorAll('[data-tip]').forEach(el => {
    el.addEventListener('mouseenter', () => {
      tip.textContent = el.dataset.tip;
      const r = el.getBoundingClientRect();
      tip.style.left = Math.min(r.left + r.width / 2, window.innerWidth - 160) + 'px';
      tip.style.top = (r.bottom + 6) + 'px';
      tip.style.transform = 'translateX(-50%)';
      tip.classList.add('show');
    });
    el.addEventListener('mouseleave', () => tip.classList.remove('show'));
  });
}

function showMenu(x, y, items) {
  const m = document.getElementById('menu');
  m.innerHTML = items.map(i => i === '-' ? '<div class="sepr"></div>' : `<button class="mi ${i.danger ? 'danger' : ''}" data-mi>${esc(i.label)}</button>`).join('');
  m.style.left = Math.min(x, window.innerWidth - 220) + 'px';
  m.style.top = y + 'px';
  m.classList.add('show');
  m.querySelectorAll('[data-mi]').forEach((b, i) => {
    const it = items.filter(x => x !== '-')[i];
    b.onclick = () => { m.classList.remove('show'); it.onSelect && it.onSelect(); };
  });
  const off = e => { if (!m.contains(e.target)) { m.classList.remove('show'); document.removeEventListener('mousedown', off); } };
  setTimeout(() => document.addEventListener('mousedown', off), 0);
}

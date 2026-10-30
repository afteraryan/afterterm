// Shared questions, data and renderer for the automatic-updates mockup pages
// (update-*.html). Each page calls initPage('<key>') with one of the question
// keys below. The picture is one clickable copy of afterterm 0.10.0 with a
// newer version waiting: every page shows its own question's answers, and for
// every other question it uses the answer already picked (or the first one),
// so the flow stays whole from the notice to afterterm opening again.

/* ── The questions ─────────────────────────────────────────────────────── */
const QUESTIONS = [
  {
    key: 'where', file: 'update-1-where.html',
    question: 'When a new version of afterterm is out, where should it tell you?',
    short: 'In the title bar, on Home, or in a card in the corner.',
    variants: [
      { id: 'titlebar', name: 'In the title bar', note: 'A small "Update available" button appears beside the version number. Nothing opens by itself: click it when you want to see the update.', look: 'Top left of the window, beside v0.10.0.' },
      { id: 'home', name: 'On Home', note: 'A card at the top of Home says a new version is out. On other screens a green dot on the Home button is the only sign.', look: 'The card under the date. Click the terminal button on the rail to see the dot on Home.' },
      { id: 'corner', name: 'A card in the corner', note: 'A card shows in the bottom right corner on every screen. The x closes it, the same as Later.', look: 'Bottom right of the window.' },
    ],
  },
  {
    key: 'whatsnew', file: 'update-2-whats-new.html',
    question: 'How should you read what changed in the new version?',
    short: 'Open it inside the notice, in a window over the app, or on GitHub.',
    variants: [
      { id: 'fold', name: 'It opens inside the notice', note: 'What\'s new unfolds under the notice\'s title, with Update, Later and Skip still underneath.', look: 'Click What\'s new in the notice.' },
      { id: 'dialog', name: 'In a window over the app', note: 'What\'s new opens a window in the middle of afterterm with the full notes, and the same three buttons at its bottom.', look: 'Click What\'s new in the notice.' },
      { id: 'browser', name: 'On GitHub, in your browser', note: 'What\'s new opens the release page on GitHub. afterterm shows nothing of its own.', look: 'Click What\'s new on GitHub in the notice.' },
    ],
  },
  {
    key: 'later', file: 'update-3-later.html',
    question: 'After you press Later, when should afterterm remind you?',
    short: 'Next time it starts, a day later, or only when you look for it.',
    variants: [
      { id: 'launch', name: 'Next time afterterm starts', note: 'The notice goes away until you close afterterm and open it again.', look: 'Press Later, then "Close and open afterterm" under the picture.' },
      { id: 'day', name: 'A day later', note: 'The notice goes away for 24 hours, even if afterterm stays open all that time.', look: 'Press Later, then "A day later" under the picture.' },
      { id: 'dot', name: 'Only when I look for it', note: 'The notice goes away and does not come back for this version. A green dot stays on the version number; click it to see the notice again.', look: 'Press Later, then look at v0.10.0 at the top left.' },
    ],
  },
  {
    key: 'confirm', file: 'update-4-before-restart.html',
    question: 'You press "Restart to update". What should afterterm say before it closes?',
    short: 'Always ask, ask only when something is busy, or list every thread.',
    variants: [
      { id: 'always', name: 'Always ask, in a few words', note: 'A short question every time, busy or not: afterterm closes, installs and opens again, and your awake threads come back.', look: 'Press Restart to update. Switch between "A chat is mid-turn" and "Nothing is busy" under the picture.' },
      { id: 'busy', name: 'Ask only when something is busy', note: 'The notice already says afterterm will close and reopen, so when nothing is busy it restarts straight away. It asks only when a chat is mid-turn.', look: 'Press Restart to update. Switch between "A chat is mid-turn" and "Nothing is busy" under the picture.' },
      { id: 'list', name: 'Ask, and list every thread', note: 'The question shows every time, busy or not, and lists every awake thread and what happens to it.', look: 'Press Restart to update. Switch between "A chat is mid-turn" and "Nothing is busy" under the picture.' },
    ],
  },
  {
    key: 'install', file: 'update-5-while-installing.html',
    question: 'Between afterterm closing and opening again, what should you see?',
    short: 'A small window with progress, or nothing at all.',
    variants: [
      { id: 'window', name: 'A small window with progress', note: 'A small afterterm window shows the install going, then closes when afterterm opens. It takes a few seconds.', look: 'Press Restart to update, then Restart now if asked.' },
      { id: 'nothing', name: 'Nothing', note: 'afterterm disappears and comes back by itself a few seconds later. Nothing shows in between.', look: 'Press Restart to update, then Restart now if asked.' },
    ],
  },
  {
    key: 'after', file: 'update-6-after-restart.html',
    question: 'When afterterm opens again after the update, what should you see?',
    short: 'The thread you were on with a short note, Home with a card, or just the thread.',
    variants: [
      { id: 'note', name: 'Where I was, with a short note', note: 'afterterm opens on the thread you were on. A note at the bottom says it was updated and goes away after a few seconds.', look: 'Press "Show afterterm opening again" under the picture.' },
      { id: 'homecard', name: 'Home, with a card', note: 'afterterm opens on Home, as it does on every start. A card at the top says it was updated, with What\'s new, until you close it.', look: 'Press "Show afterterm opening again" under the picture.' },
      { id: 'quiet', name: 'Where I was, nothing else', note: 'afterterm opens on the thread you were on. Only the version number at the top left changes.', look: 'Press "Show afterterm opening again", then look at the top left.' },
    ],
  },
  {
    key: 'settings', file: 'update-7-turn-off.html',
    question: 'Where should you turn update checks off, or check for an update yourself?',
    short: 'A menu on the version number, or an About window.',
    variants: [
      { id: 'menu', name: 'A menu on the version number', note: 'Click v0.10.0 at the top left. A small menu has "Check for updates" and a switch that turns the automatic checks off.', look: 'Click v0.10.0 at the top left.' },
      { id: 'about', name: 'An About window', note: 'Click v0.10.0 at the top left. A window shows the version, a Check for updates button, the switch, and links to What\'s new and GitHub.', look: 'Click v0.10.0 at the top left.' },
    ],
  },
];

// Things a page sets up and the buttons it puts under the picture.
const PAGE_SETUP = {
  where: { up: 'available' },
  whatsnew: { up: 'available', open: true },
  later: { up: 'available', open: true },
  confirm: { up: 'ready' },
  install: { up: 'ready' },
  after: { up: 'ready' },
  settings: { up: 'none' },
};
const PAGE_CONTROLS = {
  later: [
    { label: 'Close and open afterterm', run: () => { if (M.laterUntil === 'launch') reappear(); else if (M.hidden) flash('afterterm opened again. The notice stays away.'); } },
    { label: 'A day later', run: () => { if (M.laterUntil === 'day') reappear(); else if (M.hidden) flash('A day passed. The notice stays away.'); } },
  ],
  confirm: [
    { label: 'A chat is mid-turn', on: () => M.busy, run: () => { M.busy = true; M.threads.t1.state = 'working'; } },
    { label: 'Nothing is busy', on: () => !M.busy, run: () => { M.busy = false; M.threads.t1.state = 'quiet'; } },
  ],
  after: [
    { label: 'Show afterterm opening again', run: () => reopen() },
  ],
};

/* ── Picks, remembered on this computer ────────────────────────────────── */
const PICKS_KEY = 'afterterm-update-mockup-picks';
function loadPicks() { try { return JSON.parse(localStorage.getItem(PICKS_KEY) || '{}'); } catch { return {}; } }
function savePick(key, id) { const p = loadPicks(); p[key] = id; try { localStorage.setItem(PICKS_KEY, JSON.stringify(p)); } catch {} }
function clearPicks() { try { localStorage.removeItem(PICKS_KEY); } catch {} }

let PAGE = null;      // the question this page asks
let SHOWN = null;     // the answer being shown on this page
function opt(key) {
  if (PAGE && key === PAGE.key) return SHOWN;
  const p = loadPicks()[key];
  const q = QUESTIONS.find(x => x.key === key);
  return q.variants.some(v => v.id === p) ? p : q.variants[0].id;
}

/* ── Icons ─────────────────────────────────────────────────────────────── */
const ICONS = `
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <symbol id="i-panel" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 4v16" stroke="currentColor" stroke-width="1.8"/></symbol>
  <symbol id="i-home" viewBox="0 0 24 24"><path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></symbol>
  <symbol id="i-term" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m7 9 3 3-3 3M12 15h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></symbol>
  <symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m16 16 4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></symbol>
  <symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></symbol>
  <symbol id="i-chat" viewBox="0 0 24 24"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V17H6.5A2.5 2.5 0 0 1 4 14.5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></symbol>
  <symbol id="i-shell" viewBox="0 0 24 24"><path d="m5 7 5 5-5 5M12 17h7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></symbol>
  <symbol id="i-bell" viewBox="0 0 24 24"><path d="M12 3a6 6 0 0 0-6 6v3.6L4.4 15.5A1 1 0 0 0 5.2 17h13.6a1 1 0 0 0 .8-1.5L18 12.6V9a6 6 0 0 0-6-6z" fill="currentColor"/><path d="M9.5 19a2.5 2.5 0 0 0 5 0z" fill="currentColor"/></symbol>
  <symbol id="i-play" viewBox="0 0 24 24"><path d="M8.5 5.9c0-1.1 1.2-1.8 2.1-1.2l8.4 5.9c.9.6.9 1.9 0 2.5l-8.4 5.9c-.9.6-2.1 0-2.1-1.2z" fill="currentColor"/></symbol>
  <symbol id="i-moon" viewBox="0 0 24 24"><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7z" fill="currentColor"/></symbol>
  <symbol id="i-x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></symbol>
  <symbol id="i-chev-d" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></symbol>
  <symbol id="i-chev-r" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></symbol>
  <symbol id="i-down" viewBox="0 0 24 24"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></symbol>
  <symbol id="i-restart" viewBox="0 0 24 24"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></symbol>
  <symbol id="i-check" viewBox="0 0 24 24"><path d="m5.5 12.5 4 4 9-9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></symbol>
  <symbol id="i-ext" viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></symbol>
  <symbol id="i-dots" viewBox="0 0 24 24"><circle cx="6" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="18" cy="12" r="1.6" fill="currentColor"/></symbol>
  <symbol id="i-branch" viewBox="0 0 24 24"><circle cx="6" cy="5" r="2.2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="6" cy="19" r="2.2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="18" cy="8" r="2.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6 7.2v9.6M18 10.2c0 3.3-3 4.3-6 4.8-2.6.4-6 1-6 1.8" fill="none" stroke="currentColor" stroke-width="1.6"/></symbol>
  <symbol id="i-model" viewBox="0 0 24 24"><path d="M12 3.5c.6 3.8 2.7 5.9 6.5 6.5-3.8.6-5.9 2.7-6.5 6.5-.6-3.8-2.7-5.9-6.5-6.5 3.8-.6 5.9-2.7 6.5-6.5z" fill="currentColor"/></symbol>
  <symbol id="i-rocket" viewBox="0 0 24 24"><path d="M14.5 4.5c2.6-1.2 4.6-1 5-1 0 .4.2 2.4-1 5l-6.6 6.6-4-4z" fill="currentColor"/><path d="M7.9 11.1 5 11l-2 2 4 1zM12.9 16.1l.1 2.9-2 2-1-4zM6.5 15.5c-1.5.5-2.5 2-2.8 4.3 2.3-.3 3.8-1.3 4.3-2.8z" fill="currentColor"/></symbol>
  <symbol id="i-robot" viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="12" rx="3.5" fill="currentColor"/><path d="M12 4.5V8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="4" r="1.6" fill="currentColor"/><circle cx="9" cy="13.5" r="1.6" fill="#111"/><circle cx="15" cy="13.5" r="1.6" fill="#111"/></symbol>
  <symbol id="i-book" viewBox="0 0 24 24"><path d="M3 5.5c2.5-1 5.5-1 8 .5v13c-2.5-1.5-5.5-1.5-8-.5zM21 5.5c-2.5-1-5.5-1-8 .5v13c2.5-1.5 5.5-1.5 8-.5z" fill="currentColor"/></symbol>
  <symbol id="i-bulb" viewBox="0 0 24 24"><path d="M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z" fill="currentColor"/><rect x="9" y="17.5" width="6" height="3" rx="1.2" fill="currentColor"/></symbol>
  <symbol id="i-pencil" viewBox="0 0 24 24"><path d="M15.5 4.5 19.5 8.5 9 19H5v-4z" fill="currentColor"/></symbol>
  <symbol id="i-house" viewBox="0 0 24 24"><path d="M12 3.5 21 11h-2.5v9h-5v-5.5h-3V20h-5v-9H3z" fill="currentColor"/></symbol>
  <symbol id="i-vscode" viewBox="0 0 24 24"><path d="M17 3 9 10.5 4.5 7 3 8v8l1.5 1L9 13.5 17 21l4-2V5zM5 14.3V9.7L7.4 12zm12 1.4L12.4 12 17 8.3z" fill="#2f9be8"/></symbol>
  <symbol id="i-min" viewBox="0 0 24 24"><path d="M5 12h14" stroke="currentColor" stroke-width="1.3"/></symbol>
  <symbol id="i-max" viewBox="0 0 24 24"><rect x="5.5" y="5.5" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3"/></symbol>
</svg>`;
const svg = (id, size = 16) => `<svg width="${size}" height="${size}"><use href="#${id}"/></svg>`;
const LOGO = (s = 64) => `<svg width="${s}" height="${s}" viewBox="0 0 64 64"><rect x="1" y="1" width="62" height="62" rx="14" fill="#141414" stroke="#3a3a3a"/><circle cx="22" cy="17" r="3" fill="#2dd4bf"/><circle cx="32" cy="17" r="3" fill="#fb923c"/><circle cx="42" cy="17" r="3" fill="#a78bfa"/><path d="m17 27 16 9-16 9" fill="none" stroke="#ececec" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M42 33v12" stroke="#ececec" stroke-width="4" stroke-linecap="round"/></svg>`;

const COLORS = { blue: '#60a5fa', green: '#4ade80', purple: '#a78bfa', orange: '#fb923c', pink: '#f472b6', yellow: '#facc15' };
const PROJECTS = {
  storefront: { name: 'storefront', icon: 'i-rocket', color: 'blue' },
  api: { name: 'api-server', icon: 'i-robot', color: 'green' },
  docs: { name: 'docs-site', icon: 'i-book', color: 'purple' },
  mobile: { name: 'mobile-app', icon: 'i-bulb', color: 'orange' },
  blog: { name: 'blog', icon: 'i-pencil', color: 'pink' },
  lab: { name: 'home-lab', icon: 'i-house', color: 'yellow' },
};
const pIcon = (id, size = 16) => `<span style="color:${COLORS[PROJECTS[id].color]}">${svg(PROJECTS[id].icon, size)}</span>`;

const NEW = '0.11.0';
const SIZE_MB = 71.4;
const NOTES = `
<h4>Updating afterterm</h4>
<ul>
  <li><b>afterterm updates itself.</b> When a new version is out it tells you, downloads it while you work, and installs it when you say so.</li>
  <li><b>Threads come back after a restart.</b> Every thread that was awake when afterterm closed wakes again when it opens: chats resume their Claude Code session, servers run their command again.</li>
  <li><b>Turn update checks off</b> from the version number at the top left.</li>
</ul>
<h4>Sidebar</h4>
<ul>
  <li>Projects in Recent move up only when you type in one of their threads.</li>
  <li>The Other projects drawer has a search box.</li>
</ul>
<h4>Fixed</h4>
<ul>
  <li>The New project dialog showed its shell list taller than the window on small screens.</li>
  <li>A server thread's port pill stayed after the server stopped.</li>
</ul>`;

/* ── The state of the picture ──────────────────────────────────────────── */
let M;
function freshThreads() {
  return {
    g1: { p: null, kind: 'shell', name: 'pwsh.exe', state: 'quiet' },
    t1: { p: 'storefront', kind: 'chat', name: 'Checkout page redesign', state: 'working' },
    t2: { p: 'storefront', kind: 'chat', name: 'Fix flaky payment tests', state: 'need' },
    t3: { p: 'storefront', kind: 'server', name: 'npm run dev', state: 'running', port: 5173 },
    t4: { p: 'api', kind: 'chat', name: 'Rate limiting for public API', state: 'asleep' },
    t5: { p: 'api', kind: 'shell', name: 'pwsh.exe', state: 'asleep' },
  };
}
function reset() {
  stopTimers();
  const setup = PAGE_SETUP[PAGE.key] || {};
  M = {
    screen: opt('where') === 'home' && PAGE.key !== 'settings' ? 'home' : 'workspace',
    up: setup.up || 'available',  // none | checking | available | downloading | ready | installing
    open: !!setup.open,            // the title bar notice is open
    folded: false,                 // What's new open inside the notice
    progress: 0,
    install: 0,
    dialog: null,                  // whatsnew | confirm | about
    menu: false,                   // the version menu
    toast: null,
    hidden: false,                 // after Later or Skip
    laterUntil: null,              // launch | day | dot
    skipped: false,
    autoCheck: true,
    version: '0.10.0',
    busy: true,                    // a chat is mid-reply
    waking: false,
    updatedCard: false,
    threads: freshThreads(),
    checkMsg: '',
  };
  if (opt('where') === 'corner') M.open = true;
}

let timers = [];
function stopTimers() { timers.forEach(t => { clearInterval(t); clearTimeout(t); }); timers = []; }
function later(ms, fn) { timers.push(setTimeout(() => { fn(); render(); }, ms)); }
function flash(text, ms = 3600) {
  M.toast = { text };
  const mine = M.toast;
  later(ms, () => { if (M.toast === mine) M.toast = null; });
}

/* ── Actions ───────────────────────────────────────────────────────────── */
function startDownload() {
  M.up = 'downloading'; M.progress = 0; M.folded = false; M.dialog = null;
  if (opt('where') === 'titlebar') M.open = false;
  const t = setInterval(() => {
    M.progress = Math.min(1, M.progress + 0.022 + Math.random() * 0.012);
    if (M.progress >= 1) { clearInterval(t); M.up = 'ready'; if (opt('where') === 'corner') M.open = true; render(); return; }
    paintProgress();
  }, 110);
  timers.push(t);
}
function cancelDownload() { stopTimers(); M.up = 'available'; M.progress = 0; }
function pressLater() {
  M.hidden = true; M.open = false; M.dialog = null; M.folded = false;
  M.laterUntil = opt('later');
}
function reappear() { M.hidden = false; M.laterUntil = null; if (opt('where') !== 'home') M.open = opt('where') === 'corner' || M.open; }
function pressSkip() {
  M.hidden = true; M.skipped = true; M.open = false; M.dialog = null;
  flash(`Skipped ${NEW}. afterterm tells you again when a newer version is out.`);
}
function pressRestart() {
  const c = opt('confirm');
  if (c === 'busy' && !M.busy) { M.dialog = null; doRestart(); return; }
  M.dialog = 'confirm'; M.open = false;
}
function doRestart() {
  stopTimers();
  M.dialog = null; M.menu = false; M.open = false; M.toast = null;
  M.prevScreen = M.screen;
  M.screen = 'desktop'; M.up = 'installing'; M.install = 0;
  const t = setInterval(() => {
    M.install = Math.min(1, M.install + 0.045);
    if (M.install >= 1) { clearInterval(t); later(250, reopen); }
    paintProgress();
  }, 120);
  timers.push(t);
}
function reopen() {
  stopTimers();
  const after = opt('after');
  const was = M.screen === 'desktop' ? (M.prevScreen || 'workspace') : M.screen;
  M.dialog = null; M.menu = false; M.open = false; M.hidden = false;
  M.screen = after === 'homecard' ? 'home' : was;
  M.version = NEW; M.up = 'none'; M.progress = 0;
  M.threads = freshThreads();
  // Waking: every thread that was awake starts again; a chat resumes its session.
  M.waking = true;
  later(2600, () => {
    M.waking = false;
    M.threads.t1.state = 'quiet'; M.threads.t2.state = 'quiet';
  });
  if (after === 'note') { M.toast = { text: `Updated to ${NEW}`, whatsnew: true }; const mine = M.toast; later(6000, () => { if (M.toast === mine) M.toast = null; }); }
  if (after === 'homecard') M.updatedCard = true;
}
function checkNow() {
  M.menu = false;
  M.up = 'checking'; M.checkMsg = ''; M.manual = true;
  later(1100, () => {
    M.up = 'available'; M.hidden = false; M.skipped = false;
    if (M.dialog === 'about') { M.checkMsg = `afterterm ${NEW} is available.`; }
    else if (opt('where') !== 'home') M.open = true;
    else { M.screen = 'home'; }
  });
}
function openWhatsNew() {
  const w = opt('whatsnew');
  if (w === 'fold') M.folded = !M.folded;
  else if (w === 'dialog') { M.dialog = 'whatsnew'; M.open = false; }
  else flash(`Opened the afterterm ${NEW} release page on GitHub in your browser.`);
}
function toggleVersion() {
  if (opt('later') === 'dot' && M.hidden && !M.skipped && PAGE.key !== 'settings') {
    M.hidden = false; M.laterUntil = null;
    if (opt('where') === 'home') M.screen = 'home'; else M.open = true;
    return;
  }
  if (PAGE.key !== 'settings' && !loadPicks().settings) return; // no settings answer yet: the badge stays plain
  if (opt('settings') === 'menu') M.menu = !M.menu;
  else { M.dialog = 'about'; M.checkMsg = ''; }
}

const ACT = {
  update: startDownload,
  cancel: cancelDownload,
  later: pressLater,
  skip: pressSkip,
  restart: pressRestart,
  'restart-now': doRestart,
  'dlg-close': () => { M.dialog = null; },
  whatsnew: openWhatsNew,
  'pill': () => { if (M.up === 'ready') pressRestart(); else M.open = !M.open; },
  'corner-x': pressLater,
  version: toggleVersion,
  'auto-toggle': () => { M.autoCheck = !M.autoCheck; },
  check: checkNow,
  'go-home': () => { M.screen = 'home'; },
  'go-work': () => { M.screen = 'workspace'; },
  'toast-whatsnew': () => { M.toast = null; if (opt('whatsnew') === 'browser') flash(`Opened the afterterm ${NEW} release page on GitHub in your browser.`); else M.dialog = 'whatsnew-after'; },
  'card-close': () => { M.updatedCard = false; },
  'card-fold': () => { M.cardFold = !M.cardFold; },
};

/* ── Pieces ────────────────────────────────────────────────────────────── */
let prevKeys = new Set(), curKeys = new Set();
const enter = key => { curKeys.add(key); return prevKeys.has(key) ? '' : ' enter'; };
const mb = p => (p * SIZE_MB).toFixed(1);
const visible = () => !M.hidden && (M.autoCheck || M.manual) && ['available', 'downloading', 'ready'].includes(M.up);

function whatsNewControl() {
  const w = opt('whatsnew');
  if (w === 'browser') return `<button class="wn" data-act="whatsnew">What's new on GitHub ${svg('i-ext', 13)}</button>`;
  if (w === 'dialog') return `<button class="wn" data-act="whatsnew">What's new ${svg('i-chev-r', 14)}</button>`;
  return `<button class="wn" data-act="whatsnew">What's new ${svg(M.folded ? 'i-chev-d' : 'i-chev-r', 14)}</button>${M.folded ? `<div class="notes fold">${NOTES}</div>` : ''}`;
}
function noticeBody(withX) {
  const x = withX ? `<button class="nx" data-act="corner-x" title="Later">${svg('i-x', 15)}</button>` : '';
  if (M.up === 'downloading') {
    return `<div class="notice">
      <div class="nh"><span class="nicon">${svg('i-down', 18)}</span><div><div class="nt">Downloading afterterm ${NEW}</div><div class="ns">You can keep working while it downloads.</div></div>${x}</div>
      <div><div class="bar"><i data-prog="bar" style="width:${M.progress * 100}%"></i></div><div class="barline"><span data-prog="mb">${mb(M.progress)} of ${SIZE_MB} MB</span><span data-prog="pct">${Math.round(M.progress * 100)}%</span></div></div>
      <div class="nb"><button class="b q s" data-act="cancel">Cancel</button></div></div>`;
  }
  if (M.up === 'ready') {
    const say = opt('confirm') === 'busy'
      ? `<div class="np">afterterm closes, installs the update and opens again in a few seconds. Threads that are awake now wake again.</div>`
      : `<div class="np">Restart afterterm to finish.</div>`;
    return `<div class="notice">
      <div class="nh"><span class="nicon">${svg('i-restart', 18)}</span><div><div class="nt">afterterm ${NEW} is ready to install</div><div class="ns">Downloaded and checked.</div></div>${x}</div>
      ${say}
      <div class="nb"><button class="b p s" data-act="restart">Restart to update</button><button class="b q s" data-act="later">Later</button></div></div>`;
  }
  return `<div class="notice">
    <div class="nh"><span class="nicon">${svg('i-down', 18)}</span><div><div class="nt">afterterm ${NEW} is available</div><div class="ns">You have ${M.version}.</div></div>${x}</div>
    ${whatsNewControl()}
    <div class="nb"><button class="b p s" data-act="update">Update</button><button class="b q s" data-act="later">Later</button><button class="b q s" data-act="skip">Skip this version</button></div></div>`;
}

function updateButton() {
  if (opt('where') !== 'titlebar' || !visible()) return '';
  if (M.up === 'downloading') return `<button class="upbtn dl" data-act="pill"><span class="mbar"><i data-prog="mini" style="width:${M.progress * 100}%"></i></span><span data-prog="pillpct">Downloading ${Math.round(M.progress * 100)}%</span></button>`;
  if (M.up === 'ready') return `<button class="upbtn ready" data-act="pill">${svg('i-restart', 12)}Restart to update</button>`;
  return `<button class="upbtn${enter('upbtn')}" data-act="pill"><span class="gd"></span>Update available</button>`;
}
function titleBar() {
  const dot = opt('later') === 'dot' && M.hidden && !M.skipped && M.laterUntil === 'dot';
  const clickable = dot || PAGE.key === 'settings' || loadPicks().settings;
  const ver = clickable
    ? `<button class="ver" data-act="version">v${M.version}${dot ? '<span class="vdot"></span>' : ''}</button>`
    : `<span class="ver">v${M.version}</span>`;
  return `<div class="titlebar"><span class="tname">afterterm</span>${ver}${updateButton()}<span class="sp"></span>
    <span class="caption"><span class="cb">${svg('i-min', 14)}</span><span class="cb">${svg('i-max', 13)}</span><span class="cb">${svg('i-x', 14)}</span></span></div>`;
}

function rail() {
  const homeDot = opt('where') === 'home' && visible() && M.screen !== 'home';
  const waking = M.waking;
  return `<div class="rail">
    <span class="ic">${svg('i-panel', 17)}</span>
    <div class="navpill">
      <button class="ic${M.screen === 'home' ? ' on' : ''}" data-act="go-home">${svg('i-home', 17)}${homeDot ? '<span class="hdot"></span>' : ''}</button>
      <button class="ic${M.screen === 'workspace' ? ' on' : ''}" data-act="go-work">${svg('i-term', 17)}</button>
    </div>
    <span class="rsep"></span>
    <div class="tilerow"><span class="tile" style="background:rgba(96,165,250,.14)">${pIcon('storefront', 18)}</span>${waking ? '<span class="bd work">3</span>' : (M.threads.t2.state === 'need' ? '<span class="bd">1</span>' : '')}</div>
  </div>`;
}

function stateIcon(t) {
  if (M.waking && t.state !== 'asleep') return `<span class="spin" title="Waking"></span>`;
  switch (t.state) {
    case 'working': return `<span class="spin"></span>`;
    case 'need': return `<span class="si need">${svg('i-bell', 13)}</span>`;
    case 'running': return `<span class="port">:${t.port}</span><span class="si run">${svg('i-play', 12)}</span>`;
    case 'asleep': return `<span class="si sleep">${svg('i-moon', 12)}</span>`;
    default: return '';
  }
}
function threadRow(id, sel) {
  const t = M.threads[id];
  const cls = ['th', t.p ? '' : 'gen', sel ? 'sel' : '', t.state === 'need' && !M.waking ? 'need' : ''].join(' ');
  return `<div class="${cls}"><span class="ki">${svg(t.kind === 'chat' ? 'i-chat' : 'i-shell', 14)}</span><span class="n">${t.name}</span>${stateIcon(t)}</div>`;
}
function panel() {
  return `<div class="panel">
    <div class="srch">${svg('i-search', 16)}Search<span class="k">Ctrl Shift P</span></div>
    <div class="srow">${svg('i-plus', 16)}New thread<span class="k">Ctrl Shift T</span></div>
    <div class="plist">
      <div class="plbl">General</div>${threadRow('g1')}
      <div class="plbl" style="margin-top:8px">Pinned</div>
      <div class="pj">${pIcon('storefront')}<span class="n">storefront</span>${M.threads.t2.state === 'need' && !M.waking ? `<span class="cnt"><span class="si need">${svg('i-bell', 12)}</span>1</span>` : ''}</div>
      ${threadRow('t1', true)}${threadRow('t2')}${threadRow('t3')}
      <div class="pj">${pIcon('api')}<span class="n">api-server</span></div>
      ${threadRow('t4')}${threadRow('t5')}
      <div class="plbl" style="margin-top:8px">Recent</div>
      <div class="pj">${pIcon('docs')}<span class="n">docs-site</span></div>
      <div class="pj">${pIcon('mobile')}<span class="n">mobile-app</span></div>
    </div>
    <div class="othr">${svg('i-chev-d', 14)}Other projects<span style="margin-left:auto;color:var(--text3);font-size:12px">2</span></div>
  </div>`;
}
function termText() {
  if (M.waking) return `<span class="dim">claude --resume 6f1c2a9e-checkout</span>\n\n<span class="dim">Resuming the conversation...</span>`;
  if (M.version === NEW) return `<span class="dim">claude --resume 6f1c2a9e-checkout</span>\n\n<span class="acc">●</span> Resumed. The summary column is in place; the last step was the test run.\n\n> <span class="dim">_</span>`;
  return `<span class="acc">●</span> I'll start with the current layout of the checkout page.

<span class="acc">●</span> Read(src/pages/checkout/CheckoutPage.tsx)
  <span class="dim">└ Read 214 lines</span>

<span class="acc">●</span> The summary sits below the form, so on a long form it scrolls out of view.
  I'll move it into a second column that sticks to the top on wide screens.

<span class="acc">●</span> Update(src/pages/checkout/CheckoutPage.tsx)
  <span class="dim">└ Updated with 38 additions and 12 removals</span>

<span class="acc">●</span> Bash(npm test -- checkout)
  <span class="ok">PASS</span>  src/pages/checkout/CheckoutPage.tsx (14 tests)

${M.threads.t1.state === 'working' ? '<span class="acc">✻</span> <span class="dim">Writing the phone layout...</span>' : '<span class="acc">●</span> Done. The order summary now stays in view.\n\n> <span class="dim">_</span>'}`;
}
function mainPane() {
  const t1 = M.threads.t1;
  const chip = M.waking ? `<span class="chip"><span class="spin"></span>Waking</span>`
    : t1.state === 'working' ? `<span class="chip"><span class="spin"></span>Working</span>` : '';
  return `<div class="main">
    <div class="hdr"><div class="t">
      <div class="t1"><span style="color:var(--text3)">${svg('i-chat', 16)}</span>Checkout page redesign</div>
      <div class="t2"><span>${pIcon('storefront', 13)}storefront</span><span>${svg('i-model', 12)}Opus 5.5</span><span>${svg('i-branch', 13)}checkout-redesign</span></div>
    </div>${chip}<span class="ic">${svg('i-vscode', 18)}</span><span class="ic">${svg('i-dots', 18)}</span></div>
    <div class="term">${termText()}</div>
    ${cornerCard()}
  </div>`;
}
function homeScreen() {
  const notice = opt('where') === 'home' && visible() ? `<div class="homecard${enter('homecard')}">${noticeBody(false)}</div>` : '';
  const updated = M.updatedCard ? `<div class="homecard${enter('updcard')}"><div class="notice">
      <div class="nh"><span class="nicon">${svg('i-check', 18)}</span><div><div class="nt">afterterm was updated to ${NEW}</div><div class="ns">Your threads that were awake are waking again.</div></div><button class="nx" data-act="card-close" title="Close">${svg('i-x', 15)}</button></div>
      <button class="wn" data-act="card-fold">What's new ${svg(M.cardFold ? 'i-chev-d' : 'i-chev-r', 14)}</button>${M.cardFold ? `<div class="notes fold">${NOTES}</div>` : ''}
    </div></div>` : '';
  return `<div class="main"><div class="home"><div class="col">
    <h1>Friday, 30 October</h1>
    <div class="pills"><span class="pill"><span class="si need">${svg('i-bell', 12)}</span>1</span></div>
    ${updated}${notice}
    <div class="lbl">Pinned</div>
    <div class="cards">
      <div class="card"><div class="ct">${pIcon('storefront')}storefront</div><div class="cb"><span class="pill" style="padding:2px 9px 2px 7px;border-radius:999px;background:var(--hover2);display:inline-flex;gap:5px;align-items:center"><span class="si need">${svg('i-bell', 12)}</span>1</span><span>now</span></div></div>
      <div class="card"><div class="ct">${pIcon('api')}api-server</div><div class="cb"><span></span><span>2h</span></div></div>
    </div>
    <div class="lbl">Projects</div>
    <div class="prow">${pIcon('docs')}docs-site<span class="ago">5h</span></div>
    <div class="prow">${pIcon('mobile')}mobile-app<span class="ago">1d</span></div>
    <div class="prow">${pIcon('blog')}blog<span class="ago">2d</span></div>
    <div class="prow">${pIcon('lab')}home-lab<span class="ago">1w</span></div>
  </div></div>${cornerCard()}</div>`;
}
function cornerCard() {
  if (opt('where') !== 'corner' || !visible() || !M.open) return '';
  return `<div class="corner${enter('corner')}">${noticeBody(true)}</div>`;
}
function titlePop() {
  if (opt('where') !== 'titlebar' || !visible() || !M.open) return '';
  return `<div class="pop${enter('pop')}">${noticeBody(false)}</div>`;
}

function awakeList() {
  const rows = [
    ['chat', 'Checkout page redesign', M.busy ? ['Stops mid-turn', 'warn'] : ['Resumes', '']],
    ['chat', 'Fix flaky payment tests', ['Resumes', '']],
    ['shell', 'npm run dev', ['Runs again on :5173', '']],
    ['shell', 'pwsh.exe', ['Opens in its folder', '']],
  ];
  return `<div class="tlist">${rows.map(([k, n, [w, c]]) => `<div class="tr"><span class="ki">${svg(k === 'chat' ? 'i-chat' : 'i-shell', 14)}</span><span class="n">${n}</span><span class="w ${c}">${w}</span></div>`).join('')}</div>`;
}
function restartFoot(no, yes) {
  const stat = M.busy
    ? `<span class="dstat warn">${svg('i-bell', 12)}1 chat stops mid-turn</span>`
    : `<span class="dstat ok">${svg('i-check', 13)}Nothing is mid-turn</span>`;
  return `<div class="dfoot">${stat}<span class="sp"></span><button class="b q s" data-act="dlg-close">${no}</button><button class="b p s" data-act="restart-now">${yes}</button></div>`;
}
function dialog() {
  if (!M.dialog) return '';
  let body = '';
  if (M.dialog === 'whatsnew' || M.dialog === 'whatsnew-after') {
    const btns = M.dialog === 'whatsnew' && M.up === 'available'
      ? `<button class="b q s" data-act="skip">Skip this version</button><button class="b q s" data-act="later">Later</button><button class="b p s" data-act="update">Update</button>`
      : `<button class="b p s" data-act="dlg-close">Close</button>`;
    body = `<h2>What's new in afterterm ${NEW}</h2><div class="notes">${NOTES}</div><div class="dbtns">${btns}</div>`;
  } else if (M.dialog === 'confirm') {
    const c = opt('confirm');
    if (c === 'busy') body = `<h2>Restart afterterm to update?</h2>${restartFoot('Wait', 'Restart anyway')}`;
    else if (c === 'list') body = `<h2>Restart afterterm to update?</h2>${awakeList()}${restartFoot('Not now', 'Restart now')}`;
    else body = `<h2>Restart afterterm to update?</h2>${restartFoot('Not now', 'Restart now')}`;
  } else if (M.dialog === 'about') {
    const checking = M.up === 'checking';
    const res = checking ? `<span class="spin"></span>Checking...` : (M.checkMsg || (M.version === NEW ? 'This is the newest version.' : 'Last checked today at 09:12.'));
    body = `<div class="about" style="display:flex;flex-direction:column;gap:14px">${LOGO(56)}<h2>afterterm</h2><div class="ver2">Version ${M.version}</div>
      <div class="arow"><span style="flex:1;display:flex;align-items:center;gap:8px">${res}</span><button class="b s" data-act="check">Check for updates</button></div>
      <button class="arow" data-act="auto-toggle"><span style="flex:1">Check for updates when afterterm starts and every few hours</span><span class="sw${M.autoCheck ? ' on' : ''}"></span></button>
      <div class="links"><a data-act="whatsnew-cur">What's new in ${M.version}</a><a>afterterm on GitHub</a></div>
      <div class="dbtns" style="align-self:stretch"><button class="b p s" data-act="dlg-close">Close</button></div></div>`;
  }
  return `<div class="scrim${enter('scrim')}" data-act="scrim"><div class="dlg${enter('dlg-' + M.dialog)}">${body}</div></div>`;
}
function versionMenu() {
  if (!M.menu) return '';
  const checking = M.up === 'checking';
  return `<div class="menu${enter('menu')}">
    <div class="mh">afterterm ${M.version}</div>
    <button class="mi" data-act="check">${checking ? '<span class="spin"></span>Checking...' : 'Check for updates'}</button>
    <div class="msep"></div>
    <button class="mi" data-act="auto-toggle">Check automatically<span class="sw${M.autoCheck ? ' on' : ''}"></span></button>
  </div>`;
}
function toast() {
  if (!M.toast) return '';
  return `<div class="atoast${enter('toast-' + M.toast.text)}"><span>${M.toast.text}</span>${M.toast.whatsnew ? `<button data-act="toast-whatsnew">What's new</button>` : ''}</div>`;
}
function desktop() {
  const win = opt('install') === 'window'
    ? `<div class="setupwin${enter('setupwin')}"><div class="sw-t">${LOGO(14)}afterterm Setup</div><div class="sw-b">${LOGO(64)}<div class="sw-h">Updating afterterm to ${NEW}</div><div class="bar"><i data-prog="ibar" style="width:${M.install * 100}%"></i></div><div class="pct" data-prog="ipct">${Math.round(M.install * 100)}%</div></div></div>`
    : `<div class="deskmsg">(nothing on screen while afterterm installs)</div>`;
  return `<div class="desk"><div class="dmid">${win}</div><div class="taskbar"><span class="tb"></span><span class="tb"></span>${opt('install') === 'window' ? `<span class="tb app">${LOGO(18)}</span>` : ''}<span class="tb"></span></div></div>`;
}

/* ── Render ────────────────────────────────────────────────────────────── */
let FRAME;
function render() {
  curKeys = new Set();
  if (M.screen === 'desktop') {
    FRAME.innerHTML = desktop() + toast();
  } else {
    const body = M.screen === 'home' ? homeScreen() : `<div class="surface">${panel()}${mainPane()}</div>`;
    FRAME.innerHTML = titleBar() + `<div class="work">${rail()}${body}</div>` + titlePop() + versionMenu() + dialog() + toast();
  }
  prevKeys = curKeys;
}
function paintProgress() {
  const set = (k, fn) => FRAME.querySelectorAll(`[data-prog="${k}"]`).forEach(fn);
  set('bar', el => el.style.width = `${M.progress * 100}%`);
  set('mini', el => el.style.width = `${M.progress * 100}%`);
  set('mb', el => el.textContent = `${mb(M.progress)} of ${SIZE_MB} MB`);
  set('pct', el => el.textContent = `${Math.round(M.progress * 100)}%`);
  set('pillpct', el => el.textContent = `Downloading ${Math.round(M.progress * 100)}%`);
  set('ibar', el => el.style.width = `${M.install * 100}%`);
  set('ipct', el => el.textContent = `${Math.round(M.install * 100)}%`);
}
function bindFrame() {
  FRAME.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    const act = el && el.dataset.act;
    if (act === 'scrim') { if (e.target === el && M.dialog !== 'confirm') M.dialog = null; render(); return; }
    if (act === 'whatsnew-cur') { M.dialog = null; flash(`Opened the afterterm ${M.version} release page on GitHub in your browser.`); render(); return; }
    if (act && ACT[act]) { ACT[act](el); render(); return; }
    // A click anywhere else closes the title bar notice and the version menu.
    let changed = false;
    if (M.menu && !e.target.closest('.menu')) { M.menu = false; changed = true; }
    if (opt('where') === 'titlebar' && M.open && !e.target.closest('.pop')) { M.open = false; changed = true; }
    if (changed) render();
  });
}
function fitFrame() {
  const box = document.querySelector('.fit');
  const s = Math.min(1, box.clientWidth / 1280);
  FRAME.style.transform = s < 1 ? `scale(${s})` : '';
  box.style.height = `${760 * s}px`;
}

/* ── The page around the picture ───────────────────────────────────────── */
function initPage(key) {
  document.body.insertAdjacentHTML('afterbegin', ICONS);
  PAGE = QUESTIONS.find(q => q.key === key);
  const idx = QUESTIONS.indexOf(PAGE);
  const picked = loadPicks()[key];
  SHOWN = PAGE.variants.some(v => v.id === picked) ? picked : PAGE.variants[0].id;
  document.title = `Updates, question ${idx + 1} of ${QUESTIONS.length}`;
  const prev = QUESTIONS[idx - 1], next = QUESTIONS[idx + 1];
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.innerHTML = `
    <div class="vbar">
      <div class="nav"><a href="update-index.html">All questions</a><span>Question ${idx + 1} of ${QUESTIONS.length}</span><span class="sp"></span>
        <a href="${prev ? prev.file : '#'}" class="${prev ? '' : 'dis'}">Back</a><a href="${next ? next.file : 'update-index.html'}">${next ? 'Next' : 'See my answers'}</a></div>
      <h1 class="q">${PAGE.question}</h1>
      <div class="row" id="vbs"></div>
      <div class="note" id="note"></div>
    </div>
    <div class="fit"><div class="frame" id="frame"></div></div>
    <div class="vbar"><div class="ctl" id="ctl"></div></div>`;
  document.body.appendChild(sheet);
  FRAME = document.getElementById('frame');
  bindFrame();

  const drawChrome = () => {
    const mine = loadPicks()[key];
    document.getElementById('vbs').innerHTML = PAGE.variants.map(v =>
      `<button class="vb" data-v="${v.id}" aria-selected="${v.id === SHOWN}">${v.name}${mine === v.id ? '<span class="mine">✓</span>' : ''}</button>`).join('');
    const v = PAGE.variants.find(x => x.id === SHOWN);
    document.getElementById('note').innerHTML = `<b>${v.name}.</b> ${v.note}<div class="look">${v.look}</div>
      <div class="pickrow">${mine === v.id ? `<span class="picked">This is your pick.</span>` : `<button class="pb" id="pick">This is my pick</button>`}
      ${next ? `<a class="pb ghost" href="${next.file}">Next question</a>` : `<a class="pb ghost" href="update-index.html">See my answers</a>`}</div>`;
    document.querySelectorAll('#vbs .vb').forEach(b => b.onclick = () => { SHOWN = b.dataset.v; drawChrome(); reset(); render(); });
    const pick = document.getElementById('pick');
    if (pick) pick.onclick = () => { savePick(key, SHOWN); drawChrome(); };
  };
  const ctl = document.getElementById('ctl');
  const controls = [{ label: 'Start again', run: () => reset() }, ...(PAGE_CONTROLS[key] || [])];
  const drawControls = () => {
    ctl.innerHTML = controls.map((c, i) => `<button class="pb ${c.on && c.on() ? '' : 'ghost'}" data-c="${i}">${c.label}</button>`).join('');
    ctl.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { controls[+b.dataset.c].run(); render(); drawControls(); });
  };

  drawChrome();
  reset();
  drawControls();
  render();
  fitFrame();
  window.addEventListener('resize', fitFrame);
}

function initIndex() {
  const picks = loadPicks();
  const list = document.getElementById('qlist');
  list.innerHTML = QUESTIONS.map((q, i) => {
    const p = q.variants.find(v => v.id === picks[q.key]);
    return `<a class="card${p ? ' done' : ''}" href="${q.file}"><b>${i + 1}. ${q.question}</b><span>${q.short}</span>${p ? `<span class="state">Your pick: ${p.name}</span>` : ''}</a>`;
  }).join('');
  const answered = QUESTIONS.filter(q => picks[q.key]).length;
  const text = QUESTIONS.map((q, i) => {
    const p = q.variants.find(v => v.id === picks[q.key]);
    return `${i + 1}. ${q.question}\n   ${p ? p.name : '(not answered)'}`;
  }).join('\n');
  const sum = document.getElementById('summary');
  sum.innerHTML = `<div class="sumhead"><b>${answered} of ${QUESTIONS.length} answered</b>
    <button class="pb" id="copy">Copy answers</button><button class="pb ghost" id="clear">Clear answers</button></div><pre>${text}</pre>`;
  document.getElementById('copy').onclick = () => {
    const selectText = () => { const r = document.createRange(); r.selectNodeContents(sum.querySelector('pre')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.getElementById('copy').textContent = 'Selected: press Ctrl+C'; };
    try { navigator.clipboard.writeText(text).then(() => { document.getElementById('copy').textContent = 'Copied'; }, selectText); } catch { selectText(); }
  };
  document.getElementById('clear').onclick = () => { clearPicks(); initIndex(); };
}

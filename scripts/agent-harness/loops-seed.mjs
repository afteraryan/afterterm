// Writes a session.json and a loops.json that recreate the loops mocks' data
// (docs/mockups/loops-home.html and loops-always-visible.html): the same projects
// and colours, the same loops, labels, notes and ages, so the dev build can be
// compared with the mocks side by side. Every chat id is made up.
//
//   node scripts/agent-harness/loops-seed.mjs --out <dir> [--now <ms>]
//
// Writes <dir>/session.json (pass to launch.mjs --session) and <dir>/loops.json
// (copy into the data dir before launch: launch.mjs --loops <file> does it).
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const out = opt('out');
if (!out) { console.error('--out <dir> is required'); process.exit(1); }
const NOW = Number(opt('now', Date.now()));
fs.mkdirSync(out, { recursive: true });

const PROJ = [
  ['job-hunt', '#f05a5a', 'bell'], ['Revy App', '#e8b931', undefined], ['afterterm', '#5b8def', 'robot'], ['minimi-windows', '#e46ab4', 'robot'],
  ['moctale', '#3fc46f', undefined], ['Lanterns', '#3fc46f', undefined], ['manus video', '#5b8def', 'film'], ['Tinkering', '#f05a5a', undefined],
  ['NextLeap PM', '#5b8def', undefined], ['Figma Claude Plugin', '#a78bfa', 'pen'],
];
const PINNED = new Set(['job-hunt', 'Revy App', 'afterterm', 'minimi-windows', 'moctale', 'Lanterns']);
const gid = (name) => 'g-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const AGO = { m: 60e3, h: 3600e3, d: 86400e3, w: 7 * 86400e3 };
const ago = (s) => { const m = /^(\d+)(mo|m|h|d|w)$/.exec(s); if (!m) return 0; return Number(m[1]) * (m[2] === 'mo' ? 30 * AGO.d : AGO[m[2]]); };
const uuid = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;

const groups = PROJ.map(([name, color, icon], i) => ({
  id: gid(name), label: name, color, collapsed: false, cwd: `C:\\demo\\${name.replace(/ /g, '-')}`,
  pinned: PINNED.has(name), archived: false, lastActiveAt: NOW - i * 3600e3, history: [], ...(icon ? { icon } : {}),
}));

// The card mock's chats, as threads: the active one awake, the others asleep, one
// closed into history, one nowhere (Open chat resumes it in a new thread).
const tabs = [
  { id: 'tab-1', title: 'Loops design', groupId: gid('afterterm'), shellId: 'cmd', cwd: 'C:\\', lastActiveAt: NOW, asleep: false },
  { id: 'tab-2', title: 'Fix model label', groupId: gid('afterterm'), shellId: 'cmd', cwd: 'C:\\', lastActiveAt: NOW - 40 * 60e3, asleep: true, sleptAt: NOW - 30 * 60e3 },
  { id: 'tab-3', title: 'Cover letters', groupId: gid('job-hunt'), shellId: 'cmd', cwd: 'C:\\', lastActiveAt: NOW - 53 * 60e3, asleep: true, sleptAt: NOW - 50 * 60e3 },
  { id: 'tab-4', title: 'package-7 snapshot calendar', groupId: gid('minimi-windows'), shellId: 'cmd', cwd: 'C:\\', lastActiveAt: NOW - 5 * 3600e3, asleep: true, sleptAt: NOW - 4 * 3600e3 },
];
groups.find((g) => g.label === 'moctale').history.push({ id: 'tab-9', title: 'Ratings sync', kind: 'chat', closedAt: NOW - 15 * 3600e3, sessionId: uuid(9), cwd: 'C:\\' });

// The Home mock's loops (with the card mock's descriptions and notes).
const DESC = {
  'Loops on Home': 'Show every loop, how far along it is and the streak, on Home.',
  'Design doc': 'Every decision about loops, in one place.', 'Loops card': 'The floating card of recent loops in the workspace.',
  'Home layout': 'Where loops sit on Home beside the projects.', 'afterterm loops CLI': 'The command agents use to start, update and close loops.',
  'Header shows the old model': 'The thread header keeps the model the chat started with.', 'Snapshot calendar on Windows': 'Port the Mac calendar snapshot to Windows.',
  'Calendar permissions': 'Ask for calendar access the Windows way.', 'Week view': 'Seven days side by side, with events.',
  'Cover letters for three roles': 'One tailored letter per open application.', 'Review sync drops ratings': 'Ratings vanish after syncing on a second device.',
  'Lantern construct effect': 'Objects that form out of green particles.', 'Live web version': 'The effect running in the browser in real time.',
  'Offline render': 'A frame-exact video with motion blur.', 'Plugin reads the selection': 'Send the selected Figma frames to Claude.',
  'Manus demo video cut': 'A two-minute demo of Manus for the launch.', 'Week plan template': 'A page per cohort week for NextLeap.',
  'Revy onboarding flow': 'The first five screens a new Revy user sees.', "Founder build installer": "An installer for the founders' test build.",
  'Shell integration for WSL': 'Folder and prompt marks for WSL shells.', 'Portfolio page refresh': 'A new portfolio page for applications.',
  'Tinkering scratch cleanup': 'Clear out old experiments in Tinkering.',
};
const CHAT = {
  'Loops on Home': { threadId: 'tab-1', sessionId: uuid(1) }, 'Header shows the old model': { threadId: 'tab-2', sessionId: uuid(2) },
  'Cover letters for three roles': { threadId: 'tab-3', sessionId: uuid(3) }, 'Snapshot calendar on Windows': { threadId: 'tab-4', sessionId: uuid(4) },
  'Review sync drops ratings': { threadId: 'tab-9', sessionId: uuid(9) }, 'Lantern construct effect': { threadId: 'tab-50', sessionId: uuid(50), cwd: 'C:\\' },
};
const L = [
  ['Loops on Home', 'afterterm', 'open', 'feature', '2m', 'Calendar at 22 weeks, rot at 5 days.', [
    ['Design doc', 'closed', 'feature', '1h', 'Decisions on AFT-82.'], ['Loops card', 'open', 'feature', '2m', 'Brought up to date with Home.'],
    ['Home layout', 'closed', 'feature', '30m', 'Progress layout picked.'], ['afterterm loops CLI', 'open', 'idea', '3h', 'Commands listed, nothing built.']]],
  ['Header shows the old model', 'afterterm', 'closed', 'bug', '40m', 'Merged in PR #98.'],
  ['Snapshot calendar on Windows', 'minimi-windows', 'open', 'feature', '5h', 'Layout done, events missing.', [
    ['Calendar permissions', 'closed', 'feature', '1d', 'Works on Windows 11.'], ['Week view', 'open', 'feature', '5h', 'Layout done, events missing.']]],
  ['Cover letters for three roles', 'job-hunt', 'open', 'feature', '53m', 'Two drafted, one left.'],
  ['Review sync drops ratings', 'moctale', 'open', 'bug', '16h', 'Happens after a second login.'],
  ['Lantern construct effect', 'Lanterns', 'open', 'feature', '2d', 'Live web version done, offline render next.', [
    ['Live web version', 'closed', 'feature', '2d', 'Runs at 60fps.'], ['Offline render', 'open', 'feature', '2d', 'Motion blur pass.']]],
  ['Plugin reads the selection', 'Figma Claude Plugin', 'open', 'idea', '21h', 'Send the selected frames as context.'],
  ['Manus demo video cut', 'manus video', 'closed', 'feature', '16h', 'Exported 1080p.'],
  ['Week plan template', 'NextLeap PM', 'open', 'idea', '21h', 'One page per cohort week.'],
  ['Revy onboarding flow', 'Revy App', 'open', 'feature', '3w', 'Screens 1 to 3 built.'],
  ['Founder build installer', 'minimi-windows', 'open', 'bug', '6d', 'Signing step fails on a clean PC.'],
  ['Shell integration for WSL', 'afterterm', 'open', 'feature', '9d', 'Needs a machine with WSL.'],
  ['Portfolio page refresh', 'job-hunt', 'open', 'feature', '12d', 'Started, then paused for applications.'],
  ['Tinkering scratch cleanup', 'Tinkering', 'closed', 'idea', '1d', 'Old experiments archived.'],
];
let next = 1;
const loops = [];
const make = (title, project, status, label, when, note, parent) => {
  const t = NOW - ago(when);
  const l = {
    id: String(next++), title, project, label, status, description: DESC[title] ?? '', note, noteAt: t,
    chat: CHAT[title] ?? null, parent, createdAt: t - 3600e3, activityAt: t,
  };
  if (status === 'closed') l.closedAt = t;
  loops.push(l);
  return l;
};
for (const [title, p, s, k, when, note, subs] of L) {
  const parent = make(title, gid(p), s, k, when, note, null);
  for (const [st, ss, sk, sw, sn] of subs ?? []) make(st, gid(p), ss, sk, sw, sn, parent.id);
}
fs.writeFileSync(path.join(out, 'session.json'), JSON.stringify({ version: 3, activeTabId: 'tab-1', groups, tabs }, null, 1));
fs.writeFileSync(path.join(out, 'loops.json'), JSON.stringify({ version: 1, nextId: next, loops }, null, 1));
console.log(`wrote ${groups.length} projects, ${tabs.length} threads, ${loops.length} loops to ${out}`);

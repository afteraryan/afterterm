// Automatic updates (docs/design-05-automatic-updates.md): the pure part. No
// Electron, no fs, no network, so every rule here is unit-tested in plain Node
// (node src/update-check.test.ts). updater.ts (main) does the timer, the fetch,
// the download and starting Setup; the renderer draws the title bar button, the
// notice, the restart window and the About window from UpdateState.
//
// Shared by both sides: main imports the release and show rules, the renderer
// imports the types, the restart window's rows and the release-notes parser.

// ─── Timing ───────────────────────────────────────────────────────────────────

export const FIRST_CHECK_DELAY_MS = 10_000;
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
// Later hides the title bar button for a day, even while afterterm stays open
// (Aryan, 2026-10-30, mockup question 3).
export const LATER_MS = 24 * 60 * 60 * 1000;

export const RELEASES_URL = 'https://api.github.com/repos/afteraryan/afterterm/releases/latest';
export const REPO_URL = 'https://github.com/afteraryan/afterterm';

// ─── Versions ─────────────────────────────────────────────────────────────────

// "0.11.0" or "v0.11.0" to [0, 11, 0]. Anything else (a prerelease suffix, two
// parts, a stray word) is not a version this updater offers, so it is null.
export function parseVersion(v: unknown): [number, number, number] | null {
  if (typeof v !== 'string') return null;
  const m = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

// Negative when a is older than b, 0 when equal, positive when newer. Two
// unparseable versions compare equal; an unparseable one is older than any
// real one, so it is never offered.
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

export function isNewer(candidate: string, current: string): boolean {
  return parseVersion(candidate) !== null && compareVersions(candidate, current) > 0;
}

// ─── The release ──────────────────────────────────────────────────────────────

export interface ReleaseInfo {
  version: string;
  notes: string;          // the release body, Markdown
  assetName: string;
  size: number;           // bytes, as GitHub reports it
  url: string;            // browser_download_url
  sha256: string;         // lowercase hex
}

// The installer a release must carry: afterterm-<version>-setup.exe, or
// afterterm-test-<version>-setup.exe for the sandbox build, so a sandbox copy
// never picks up (and runs) the real installer.
export function assetNameFor(version: string, base = 'afterterm'): string {
  return `${base}-${version}-setup.exe`;
}

// GitHub's asset digest is "sha256:<64 hex>". Any other algorithm, or a
// malformed value, is no digest at all: the installer is unsigned, so this hash
// is the only check there is, and without it the update is not offered.
export function parseDigest(digest: unknown): string | null {
  if (typeof digest !== 'string') return null;
  const m = /^sha256:([0-9a-fA-F]{64})$/.exec(digest.trim());
  return m ? m[1].toLowerCase() : null;
}

export type ReleaseVerdict =
  | { kind: 'update'; release: ReleaseInfo }
  | { kind: 'none'; reason: 'not-a-release' | 'not-newer' | 'no-asset' | 'no-digest' };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// GitHub's releases/latest response (or the test feed in the same shape) to
// what afterterm offers. Drafts and prereleases never come back from
// releases/latest, but a test feed could carry the flags, so they are refused too.
export function parseRelease(json: unknown, currentVersion: string, assetBase = 'afterterm'): ReleaseVerdict {
  if (!isRecord(json) || typeof json.tag_name !== 'string') return { kind: 'none', reason: 'not-a-release' };
  if (json.draft === true || json.prerelease === true) return { kind: 'none', reason: 'not-a-release' };
  const parsed = parseVersion(json.tag_name);
  if (!parsed) return { kind: 'none', reason: 'not-a-release' };
  const version = parsed.join('.');
  if (!isNewer(version, currentVersion)) return { kind: 'none', reason: 'not-newer' };
  const want = assetNameFor(version, assetBase);
  const assets = Array.isArray(json.assets) ? json.assets : [];
  const asset = assets.find(a => isRecord(a) && a.name === want) as Record<string, unknown> | undefined;
  if (!asset || typeof asset.browser_download_url !== 'string' || !asset.browser_download_url) {
    return { kind: 'none', reason: 'no-asset' };
  }
  const sha256 = parseDigest(asset.digest);
  if (!sha256) return { kind: 'none', reason: 'no-digest' };
  const size = typeof asset.size === 'number' && Number.isFinite(asset.size) && asset.size > 0 ? asset.size : 0;
  return {
    kind: 'update',
    release: {
      version,
      notes: typeof json.body === 'string' ? json.body : '',
      assetName: want,
      size,
      url: asset.browser_download_url,
      sha256,
    },
  };
}

// Where the installer comes from. A real check only ever downloads over https.
// The test feed (AFTERTERM_UPDATE_FEED) may also point at a local installer, as
// a file:/// URL or a plain path, so no fake public release is ever needed.
export type DownloadSource = { kind: 'https'; url: string } | { kind: 'file'; path: string };

export function downloadSource(url: string, allowLocal: boolean): DownloadSource | null {
  if (/^https:\/\//i.test(url)) return { kind: 'https', url };
  if (!allowLocal) return null;
  if (/^file:\/\//i.test(url)) {
    try {
      // file:///D:/x/y.exe to D:\x\y.exe
      const u = new URL(url);
      let p = decodeURIComponent(u.pathname);
      if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
      return { kind: 'file', path: p.replace(/\//g, '\\') };
    } catch {
      return null;
    }
  }
  if (/^[A-Za-z]:[\\/]/.test(url) || url.startsWith('\\\\')) return { kind: 'file', path: url };
  return null;
}

// The version in a downloaded installer's file name, or null for any other file.
export function installerVersion(fileName: string, base = 'afterterm'): string | null {
  const esc = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`^${esc}-(\\d+\\.\\d+\\.\\d+)-setup\\.exe(\\.partial)?$`, 'i').exec(fileName);
  return m ? m[1] : null;
}

// What the updates folder can lose on launch: every unfinished download, and
// every installer that is not newer than the running version (the one that just
// installed included). Files it does not recognise are left alone.
export function staleDownloads(names: string[], current: string, base = 'afterterm'): string[] {
  return names.filter(n => {
    const v = installerVersion(n, base);
    if (!v) return false;
    return n.toLowerCase().endsWith('.partial') || !isNewer(v, current);
  });
}

// ─── Whether to show it ───────────────────────────────────────────────────────

export interface UpdatePrefs {
  updateChecks?: 'enabled' | 'disabled';
  updateSkippedVersion?: string;
  updateLaterUntil?: number;
  updateLastChecked?: number;
}

export function autoChecksOn(prefs: UpdatePrefs): boolean {
  return prefs.updateChecks !== 'disabled';
}

// Whether a found version is held back from the title bar: skipped for good, or
// Later still running. The About window shows it either way.
export function isSuppressed(version: string, prefs: UpdatePrefs, now: number): boolean {
  if (prefs.updateSkippedVersion && prefs.updateSkippedVersion === version) return true;
  const until = prefs.updateLaterUntil;
  return typeof until === 'number' && Number.isFinite(until) && now < until;
}

// ─── The state main pushes to the renderer ────────────────────────────────────

export type UpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'ready';

// Why the last action did not go through, for the one short line the notice shows.
export type UpdateError =
  | 'checksum'        // the download did not match the release's sha256, and was deleted
  | 'network'         // the download stopped
  | 'not-installed'   // Restart to update in a copy that is not installed
  | 'setup'           // the installer did not start
  | 'check';          // a check by hand could not reach GitHub

export interface UpdateState {
  phase: UpdatePhase;
  current: string;
  // Whether this copy may check at all: an installed copy, or any copy with the
  // test feed set. null until the registry has been read.
  canCheck: boolean | null;
  auto: boolean;
  lastChecked: number | null;
  // The version found, while one is: its notes and size for the notice.
  release: { version: string; notes: string; size: number } | null;
  received: number;
  // Held back from the title bar by Later or Skip (only while 'available').
  hidden: boolean;
  // A check by hand found nothing newer.
  upToDate: boolean;
  error: UpdateError | null;
}

export function initialUpdateState(current: string): UpdateState {
  return {
    phase: 'idle', current, canCheck: null, auto: true, lastChecked: null,
    release: null, received: 0, hidden: false, upToDate: false, error: null,
  };
}

// Whether the title bar shows its button. Once the user chose Update (from the
// notice or the About window) Later and Skip no longer apply.
export function titleBarButtonShows(s: UpdateState): boolean {
  if (!s.release) return false;
  if (s.phase === 'downloading' || s.phase === 'ready') return true;
  return s.phase === 'available' && !s.hidden;
}

export function percent(received: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.max(0, Math.min(100, Math.floor((received / total) * 100)));
}

// "40.7 of 71.4 MB"
export function megabytes(received: number, total: number): string {
  const mb = (n: number) => (n / 1_048_576).toFixed(1);
  return `${mb(Math.min(received, total))} of ${mb(total)} MB`;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// The About window's quiet line: "Last checked today at 09:12."
export function lastCheckedText(at: number | null, now: number): string {
  if (at === null || !Number.isFinite(at)) return 'Not checked yet.';
  const d = new Date(at);
  const n = new Date(now);
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(n) - day(d)) / 86_400_000);
  if (days <= 0) return `Last checked today at ${time}.`;
  if (days === 1) return `Last checked yesterday at ${time}.`;
  return `Last checked on ${d.getDate()} ${MONTHS[d.getMonth()]}.`;
}

// The one short line under the notice's title when an action did not go through.
export function errorText(e: UpdateError | null): string | null {
  switch (e) {
    case 'checksum': return "The download didn't match the release, so it was deleted.";
    case 'network': return 'The download stopped.';
    case 'not-installed': return 'Updates install only into an installed copy.';
    case 'setup': return "The installer didn't start.";
    case 'check': return "Couldn't check for updates.";
    default: return null;
  }
}

// ─── The restart window ───────────────────────────────────────────────────────

// One awake thread, as the renderer knows it. `resumes` is whether waking it
// runs `claude --resume` (a chat with a usable session id); `rerunPort` is the
// port of a server whose last command runs again (wakePlan's runCommand).
export interface AwakeThread {
  id: string;
  name: string;
  kind: 'chat' | 'shell';
  resumes: boolean;
  midTurn: boolean;
  rerunPort?: number;
}

// Whether a chat is in the middle of a turn, from its notification state: the
// spinner (working, compacting), or waiting on a permission prompt (attention),
// whose pending tool call is lost on a restart the same way (Aryan, 2026-10-30).
export function isMidTurn(notification: string | undefined): boolean {
  return notification === 'working' || notification === 'compacting' || notification === 'attention';
}

export type RestartOutcome ='resumes' | 'stops-mid-turn' | 'runs-again' | 'opens-in-folder';

export interface RestartRow {
  id: string;
  name: string;
  kind: 'chat' | 'shell';
  outcome: RestartOutcome;
  text: string;
  warn: boolean;
}

export function restartRows(threads: AwakeThread[]): RestartRow[] {
  return threads.map(t => {
    let outcome: RestartOutcome;
    let text: string;
    if (t.kind === 'chat' && t.resumes) {
      outcome = t.midTurn ? 'stops-mid-turn' : 'resumes';
      text = t.midTurn ? 'Stops mid-turn' : 'Resumes';
    } else if (t.rerunPort !== undefined) {
      outcome = 'runs-again';
      text = `Runs again on :${t.rerunPort}`;
    } else {
      outcome = 'opens-in-folder';
      text = 'Opens in its folder';
    }
    return { id: t.id, name: t.name, kind: t.kind, outcome, text, warn: outcome === 'stops-mid-turn' };
  });
}

// The status line left of the buttons: "Safe to restart", or "1 chat stops
// mid-turn" / "2 chats stop mid-turn".
export function restartStatus(rows: RestartRow[]): { ok: boolean; text: string } {
  const n = rows.filter(r => r.outcome === 'stops-mid-turn').length;
  if (n === 0) return { ok: true, text: 'Safe to restart' };
  return { ok: false, text: n === 1 ? '1 chat stops mid-turn' : `${n} chats stop mid-turn` };
}

// ─── After the restart ────────────────────────────────────────────────────────

export interface PendingUpdate {
  from: string;
  to: string;
  notes?: string;
  activeThreadId?: string;
  screen?: 'home' | 'workspace' | 'project';
  projectId?: string;
}

export function asPendingUpdate(v: unknown): PendingUpdate | null {
  if (!isRecord(v) || typeof v.from !== 'string' || typeof v.to !== 'string') return null;
  const p: PendingUpdate = { from: v.from, to: v.to };
  if (typeof v.notes === 'string') p.notes = v.notes;
  if (typeof v.activeThreadId === 'string' && v.activeThreadId) p.activeThreadId = v.activeThreadId;
  if (v.screen === 'home' || v.screen === 'workspace' || v.screen === 'project') p.screen = v.screen;
  if (typeof v.projectId === 'string' && v.projectId) p.projectId = v.projectId;
  return p;
}

// On the launch after an update restart: the update went in when the running
// version is the one it was going to. Anything else (Setup failed, the user ran
// an older installer) clears the record and starts as usual.
export function updateLanded(pending: PendingUpdate | null, running: string): boolean {
  return !!pending && compareVersions(pending.to, running) === 0 && parseVersion(running) !== null;
}

// ─── Release notes ────────────────────────────────────────────────────────────

// The small part of Markdown a release body uses (it is written from
// CHANGELOG.md's section): headings, bullets, bold, links. Images are skipped,
// anything else is plain text. No HTML ever comes out of here: the renderer
// builds elements from these pieces.
export type Inline = { text: string; bold?: boolean; href?: string };
export type NoteBlock =
  | { type: 'heading'; inlines: Inline[] }
  | { type: 'list'; items: Inline[][] }
  | { type: 'para'; inlines: Inline[] };

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  const push = (text: string, extra: Omit<Inline, 'text'> = {}) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && !last.bold && !last.href && !extra.bold && !extra.href) last.text += text;
    else out.push({ text, ...extra });
  };
  // Inline code loses its backticks and stays as text.
  const s = src.replace(/`([^`]*)`/g, '$1');
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let at = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    push(s.slice(at, m.index));
    if (m[1] !== undefined) {
      push(m[1].replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1'), { bold: true });
    } else {
      const href = m[3];
      if (/^https?:\/\//i.test(href)) push(m[2], { href });
      else push(m[2]);
    }
    at = m.index + m[0].length;
  }
  push(s.slice(at));
  return out;
}

export function parseNotes(md: string): NoteBlock[] {
  const blocks: NoteBlock[] = [];
  let list: Inline[][] | null = null;
  let item: string | null = null;
  let para: string[] = [];
  const endItem = () => { if (list && item !== null) list.push(parseInline(item.trim())); item = null; };
  const endList = () => { endItem(); if (list && list.length) blocks.push({ type: 'list', items: list }); list = null; };
  const endPara = () => { if (para.length) blocks.push({ type: 'para', inlines: parseInline(para.join(' ').trim()) }); para = []; };

  for (const raw of md.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) { endList(); endPara(); continue; }
    if (/^!\[[^\]]*\]\([^)]*\)$/.test(trimmed)) continue; // an image line
    const h = /^#{1,6}\s+(.*)$/.exec(trimmed);
    if (h) { endList(); endPara(); blocks.push({ type: 'heading', inlines: parseInline(h[1].replace(/#+$/, '').trim()) }); continue; }
    const b = /^[-*+]\s+(.*)$/.exec(trimmed);
    if (b) {
      endPara();
      if (!list) list = [];
      endItem();
      item = b[1];
      continue;
    }
    // An indented line under a bullet continues it.
    if (item !== null && /^\s+/.test(line)) { item += ' ' + trimmed; continue; }
    endList();
    para.push(trimmed);
  }
  endList();
  endPara();
  return blocks;
}

// ─── Which copy is installed ──────────────────────────────────────────────────

// A copy is installed when its exe's folder is the InstallLocation of its own
// Settings > Apps entry (updater.ts reads that entry the way Setup does). The
// entry and process.execPath can differ in case and in a trailing slash.
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  return norm(a) === norm(b);
}

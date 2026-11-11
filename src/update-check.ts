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
  date: string | null;    // "2026-11-06", from published_at (releaseDate)
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
      date: releaseDate(json.published_at),
      assetName: want,
      size,
      url: asset.browser_download_url,
      sha256,
    },
  };
}

// Which release pressing Update downloads (Aryan, 2026-11-01). The button asks
// GitHub again first, so a version that came out after the last check is the one
// installed, never the one before it (0.11.1 went to 0.11.2 with 0.12.0 already
// out, because checks run only every 6 hours). `fresh` is that check's verdict,
// or null when it failed (offline, rate limited). Rules:
//   - a newer release: download it;
//   - the latest is not newer than this copy (the release shown was pulled):
//     nothing to download (null);
//   - the check failed, or the latest release is not installable yet (its
//     installer or digest missing, as while an upload is still going): download
//     the release already shown.
export function releaseToDownload(known: ReleaseInfo, fresh: ReleaseVerdict | null): ReleaseInfo | null {
  if (!fresh) return known;
  if (fresh.kind === 'update') return fresh.release;
  return fresh.reason === 'not-newer' ? null : known;
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
  // The version found, while one is: its notes and size for the notice, and the
  // notes of every release since this copy's version (notesSince), newest first,
  // that version's own included; `more` counts the older ones left out.
  release: { version: string; notes: string; size: number; since: ReleaseNote[]; more: number } | null;
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

// The window says "Safe to restart" only when afterterm knows every awake thread is
// idle (plan-02, Fix 10). Before it, anything the rows could not see read as safe: a
// chat with no hooks mid-reply, a stalled turn, a background task, a shell running a
// command (note-03, "The restart window: what it says against what is true").

// What a shell is doing, from the signals afterterm has for it (shellBusy below):
// running a command, sitting at its prompt, or no way to tell.
export type ShellBusy = 'busy' | 'at-prompt' | 'unknown';

// One awake thread, as the renderer knows it.
//   resumes:    waking it runs `claude --resume` (a valid session id, wakePlan).
//   midTurn:    a Claude in the middle of a turn (isMidTurn).
//   background: a Claude idle with a background task (hasBackgroundTask).
//   claudeAlive: Claude Code's session record says a Claude is running in the
//               thread (recordStatus is set).
//   shellBusy:  whether the shell is running a command (shellBusy). Read only when
//               no Claude is alive: while one is open the prompt marks say "not at
//               the prompt" the whole time.
//   rerunPort:  the port of a server whose last command runs again (wakePlan's
//               runCommand).
export interface AwakeThread {
  id: string;
  name: string;
  kind: 'chat' | 'shell';
  resumes: boolean;
  midTurn: boolean;
  background: boolean;
  claudeAlive: boolean;
  shellBusy: ShellBusy;
  rerunPort?: number;
}

// Whether a chat is in the middle of a turn. Claude Code's own record first (Fix 6):
// busy is working, waiting is on a question or a permission prompt, and it says so
// with or without hooks, through a stalled turn and at once at a prompt. The
// notification state is the fallback, for a Claude the record cannot see (WSL): the
// spinner (working, compacting), or waiting on a permission prompt (attention),
// whose pending tool call is lost on a restart the same way (Aryan, 2026-10-30).
export function isMidTurn(recordStatus: string | undefined, notification: string | undefined): boolean {
  if (recordStatus === 'busy' || recordStatus === 'waiting') return true;
  return notification === 'working' || notification === 'compacting' || notification === 'attention';
}

// Whether a chat ended its turn with a background task still running (Fix 7): the
// record's `shell` status, or the hook's background title, whatever the other says.
// The "or" stays on purpose. The hook's ⏳ also covers background agents and session
// crons (/loop, schedules), which the record was never seen to report as `shell`, so
// letting an idle record overrule it would call a restart safe while a background
// agent runs. The cost is a stale ⏳ warning after its task has ended, the lesser
// wrong.
// The ⏳ arrives two ways. `notification` is the state the thread shows, which a
// working, needs-you, done or compacting state outranks while it lasts (and which,
// until 2026-11-08, cleared the moment the thread was looked at). `backgroundTasks`
// (Tab.backgroundTasks, spinnerState.ts's backgroundAfterTitle) is the same title
// kept as a flag that viewing never clears, only the hook's ✅ (▶, ⚠ and ⚙ leave
// it), the thread's Claude going away (its record status goes from a value to none,
// as on /exit, spinnerState.ts's backgroundAfterRecord) or the thread going to sleep.
export function hasBackgroundTask(
  recordStatus: string | undefined,
  notification: string | undefined,
  backgroundTasks?: boolean,
): boolean {
  return recordStatus === 'shell' || notification === 'background' || backgroundTasks === true;
}

// Whether a shell is running a command (Fix 8). The prompt marks (OSC 133) are the
// main signal, because a child process misses a shell's built-ins (PowerShell's
// Start-Sleep runs inside the shell). `atPrompt` is undefined while the thread has
// produced no marks at all (integration opted out, or a shell that never emitted
// one); only then does `hasChildren`, whether the shell has a process below it, count,
// and only a yes: none, or a process list too old to say, is unknown, never safe.
export function shellBusy(atPrompt: boolean | undefined, hasChildren: boolean | undefined): ShellBusy {
  if (atPrompt === false) return 'busy';
  if (atPrompt === true) return 'at-prompt';
  return hasChildren === true ? 'busy' : 'unknown';
}

export type RestartOutcome =
  | 'resumes'
  | 'stops-mid-turn'
  | 'background-stops'
  | 'command-stops'
  | 'runs-again'
  | 'opens-in-folder';

export interface RestartRow {
  id: string;
  name: string;
  kind: 'chat' | 'shell';
  outcome: RestartOutcome;
  text: string;
  warn: boolean;
  // afterterm cannot tell whether the restart stops something in this thread (a
  // shell with no prompt marks and no process below it). Such a row does not warn,
  // but the window then says nothing rather than "Safe to restart".
  unknown: boolean;
}

// One row per awake thread, in order (the table in plan-02, "What the restart
// window must say"). Where signals overlap, the first rule that applies wins:
//   1. Mid-turn (record busy or waiting, or a mid-turn notification), with or
//      without a session id: "Stops mid-turn". A notification counts even with no
//      record, since a hook only fires from a live Claude.
//   2. A background task (record shell, or the background notification, whatever
//      the record says; hasBackgroundTask says why): "Background task stops".
//      Mid-turn wins over it: the turn is the bigger loss.
//   3. A live, idle Claude: "Resumes" with a usable session id, else "Opens in its
//      folder", even with a port in its tree (the plan's row): its last command is
//      `claude`, so running it again would start a fresh Claude, not a server. The
//      shell is not read: its marks say "not at the prompt" while Claude is open.
//   4. No live Claude, a session id (an exited chat stays a chat, Decision 3): the
//      shell running a command is "Command stops" (it still resumes afterwards),
//      at its prompt "Resumes", unknown "Resumes" and counted as unknown.
//   5. No Claude, no id, a server whose command runs again: "Runs again on :port",
//      even while the shell is busy, since the server is that running command and
//      running it again is what the wake is for.
//   6. No Claude, no id, the shell busy: "Command stops".
//   7. Otherwise "Opens in its folder", counted as unknown when the shell's state
//      is unknown.
function outcomeText(outcome: RestartOutcome, port: number | undefined): string {
  switch (outcome) {
    case 'stops-mid-turn': return 'Stops mid-turn';
    case 'background-stops': return 'Background task stops';
    case 'command-stops': return 'Command stops';
    case 'resumes': return 'Resumes';
    case 'runs-again': return `Runs again on :${port}`;
    case 'opens-in-folder': return 'Opens in its folder';
  }
}

export function restartRows(threads: AwakeThread[]): RestartRow[] {
  return threads.map(t => {
    let outcome: RestartOutcome;
    let unknown = false;
    if (t.midTurn) {
      outcome = 'stops-mid-turn';
    } else if (t.background) {
      outcome = 'background-stops';
    } else if (t.claudeAlive) {
      outcome = t.resumes ? 'resumes' : 'opens-in-folder';
    } else if (t.resumes) {
      outcome = t.shellBusy === 'busy' ? 'command-stops' : 'resumes';
      unknown = t.shellBusy === 'unknown';
    } else if (t.rerunPort !== undefined) {
      outcome = 'runs-again';
    } else if (t.shellBusy === 'busy') {
      outcome = 'command-stops';
    } else {
      outcome = 'opens-in-folder';
      unknown = t.shellBusy === 'unknown';
    }
    const warn = outcome === 'stops-mid-turn' || outcome === 'background-stops' || outcome === 'command-stops';
    return { id: t.id, name: t.name, kind: t.kind, outcome, text: outcomeText(outcome, t.rerunPort), warn, unknown };
  });
}

// The status line left of the buttons:
//   nothing warns and nothing is unknown: "Safe to restart";
//   only chats stopping mid-turn warn: "1 chat stops mid-turn" / "2 chats stop mid-turn";
//   any other warning: "1 thread is busy" / "2 threads are busy", counting every
//   row that warns;
//   nothing warns but something is unknown: null, no status line at all, because
//   afterterm does not know that the restart is safe.
export function restartStatus(rows: RestartRow[]): { ok: boolean; text: string } | null {
  const warns = rows.filter(r => r.warn);
  if (warns.length === 0) {
    return rows.some(r => r.unknown) ? null : { ok: true, text: 'Safe to restart' };
  }
  const n = warns.length;
  if (warns.every(r => r.outcome === 'stops-mid-turn')) {
    return { ok: false, text: n === 1 ? '1 chat stops mid-turn' : `${n} chats stop mid-turn` };
  }
  return { ok: false, text: n === 1 ? '1 thread is busy' : `${n} threads are busy` };
}

// ─── After the restart ────────────────────────────────────────────────────────

export interface PendingUpdate {
  from: string;
  to: string;
  notes?: string;
  // Every release's notes from `from` to `to` (notesSince), for What's new after
  // the restart; absent in a record written before AFT-56.
  since?: ReleaseNote[];
  more?: number;
  activeThreadId?: string;
  screen?: 'home' | 'workspace' | 'project';
  projectId?: string;
}

export function asPendingUpdate(v: unknown): PendingUpdate | null {
  if (!isRecord(v) || typeof v.from !== 'string' || typeof v.to !== 'string') return null;
  const p: PendingUpdate = { from: v.from, to: v.to };
  if (typeof v.notes === 'string') p.notes = v.notes;
  const since = asReleaseNotes(v.since);
  if (since.length) p.since = since;
  if (typeof v.more === 'number' && Number.isInteger(v.more) && v.more > 0) p.more = v.more;
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

// ─── Every release since this version (AFT-56) ────────────────────────────────

// What's new lists every release between the running version and the one on
// offer, newest first, each under its version (Aryan, 2026-11-11, option 1 of
// the mockup): someone on 0.12.1 offered 0.15.0 also reads 0.14.0's and 0.13.0's
// notes. GitHub's releases list gives the ones in between; the newest comes from
// the release on offer, so it is there even when the list could not be read.
export const RELEASE_LIST_URL = 'https://api.github.com/repos/afteraryan/afterterm/releases?per_page=50';
// At most this many releases are listed; the older rest are counted (`more`)
// and the list links to GitHub for them.
export const MAX_NOTE_RELEASES = 10;

export interface ReleaseNote {
  version: string;
  date: string | null;  // "2026-11-06"
  notes: string;        // the release body, Markdown
}

export interface NotesSince {
  releases: ReleaseNote[];
  more: number;
}

// GitHub's published_at ("2026-11-06T09:06:39Z") to its day, "2026-11-06".
export function releaseDate(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})T/.exec(v.trim());
  return m ? m[1] : null;
}

// "2026-11-06" to "6 Nov 2026", the date beside a version in What's new.
export function releaseDateText(date: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '');
  if (!m) return '';
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month.slice(0, 3)} ${m[1]}` : '';
}

// `list` is GitHub's releases list (or anything else, read as nothing). Kept:
// published releases newer than `current` and older than the one on offer, once
// each, newest first, after `offered` itself; drafts, prereleases and tags that
// are not versions are left out.
export function notesSince(list: unknown, current: string, offered: ReleaseNote, max = MAX_NOTE_RELEASES): NotesSince {
  const byVersion = new Map<string, ReleaseNote>();
  if (Array.isArray(list)) {
    for (const item of list) {
      if (!isRecord(item) || item.draft === true || item.prerelease === true) continue;
      const parsed = parseVersion(item.tag_name);
      if (!parsed) continue;
      const version = parsed.join('.');
      if (!isNewer(version, current) || compareVersions(version, offered.version) >= 0 || byVersion.has(version)) continue;
      byVersion.set(version, { version, date: releaseDate(item.published_at), notes: typeof item.body === 'string' ? item.body : '' });
    }
  }
  const all = [offered, ...[...byVersion.values()].sort((a, b) => compareVersions(b.version, a.version))];
  const keep = Math.max(1, max);
  return { releases: all.slice(0, keep), more: Math.max(0, all.length - keep) };
}

// The test feed (AFTERTERM_UPDATE_FEED) may hold GitHub's releases list instead of
// one release, to test What's new across versions. What releases/latest would
// answer from such a list: the newest published release with a version tag, or
// null when there is none.
export function newestInList(list: unknown): Record<string, unknown> | null {
  if (!Array.isArray(list)) return null;
  let best: Record<string, unknown> | null = null;
  for (const item of list) {
    if (!isRecord(item) || item.draft === true || item.prerelease === true || !parseVersion(item.tag_name)) continue;
    if (!best || compareVersions(item.tag_name as string, best.tag_name as string) > 0) best = item;
  }
  return best;
}

// Release notes read back from prefs.json (PendingUpdate.since): only well-formed
// entries, at most MAX_NOTE_RELEASES of them.
export function asReleaseNotes(v: unknown): ReleaseNote[] {
  if (!Array.isArray(v)) return [];
  const out: ReleaseNote[] = [];
  for (const item of v) {
    if (!isRecord(item) || typeof item.version !== 'string' || !parseVersion(item.version) || typeof item.notes !== 'string') continue;
    out.push({ version: item.version, date: typeof item.date === 'string' && releaseDateText(item.date) ? item.date : null, notes: item.notes });
    if (out.length >= MAX_NOTE_RELEASES) break;
  }
  return out;
}

// ─── Which copy is installed ──────────────────────────────────────────────────

// Where an install lives, from what the registry holds for it. electron-builder's
// engine writes InstallLocation to HKCU\Software\<key> (not to the Settings >
// Apps entry, HKCU\...\Uninstall\<key>, which has none; found in Phase 3); the
// Apps entry's UninstallString names the uninstaller inside the install folder,
// the fallback. Setup.cs (ExistingInstallFolder) follows the same order.
export function installFolder(installLocation: string | null | undefined, uninstallString: string | null | undefined): string | null {
  if (installLocation && installLocation.trim()) return installLocation.trim();
  const m = /^\s*"([^"]+\\)[^"\\]+"/.exec(uninstallString ?? '') ?? /^\s*([A-Za-z]:\\\S*\\)[^\\\s]+\.exe/i.exec(uninstallString ?? '');
  return m ? m[1].replace(/\\+$/, '') : null;
}

// A copy is installed when its exe's folder is its own install folder (above).
// The registry's path and process.execPath can differ in case and in a
// trailing slash.
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  return norm(a) === norm(b);
}

// prefs.json helpers for the main process.
//
// %APPDATA%\afterterm\prefs.json holds the app's small settings: the Claude hook
// opt-out (acted on by claude-hook-install.ts, which reads it through readPrefs
// below), the time the app was last opened, the hand-picked editorPath and the
// update choices.
//
// One rule everywhere: a prefs.json that is not valid JSON, or that could not be
// read, is treated as empty when reading and is never overwritten. Someone
// hand-edited it and made a typo; silently replacing it would throw away the rest
// of their settings.

import fs from 'fs';

export interface AftertermPrefs {
  claudeNotifications?: 'enabled' | 'disabled';
  claudeHookToastShown?: boolean;
  // How the Claude Code hook runs its script, 'file' unless the setup check found
  // that only 'command' works on this machine (claude-hook-install.ts).
  claudeHookMode?: 'file' | 'command';
  // Time the app was last opened, in ms since epoch. Written at every startup,
  // read one startup later so Home can say how long you were away.
  lastOpenedAt?: number;
  // Editor executable the user picked by hand. Wins over detection.
  editorPath?: string;
  // Per-shell opt-out for the OSC 133/9;9 prompt integration (Phase 6). A shell
  // missing here, or set to anything but 'off', keeps integration on.
  shellIntegration?: Partial<Record<'cmd' | 'pwsh' | 'powershell' | 'gitbash' | 'wsl', 'on' | 'off'>>;
  // Automatic updates (design-05, src/updater.ts). The About window's switch
  // turns the automatic checks off; Skip and Later hold one version back; the
  // last check time is shown in the About window; pendingUpdate is written just
  // before an update restart and read once on the next launch.
  updateChecks?: 'enabled' | 'disabled';
  updateSkippedVersion?: string;
  updateLaterUntil?: number;
  updateLastChecked?: number;
  pendingUpdate?: unknown;
  // The main window's home (window-placement.ts, AFT-15): its normal bounds, the
  // display it is on (id and bounds) and whether it is maximized, in Electron's
  // screen coordinates. Written when the user moves or resizes the window, read
  // at launch to open it there and when a display comes back.
  windowBounds?: { x: number; y: number; width: number; height: number };
  windowDisplayId?: number;
  windowDisplayBounds?: { x: number; y: number; width: number; height: number };
  windowMaximized?: boolean;
  [key: string]: unknown;
}

// The file's contents, plus whether it was readable at all. Only a missing file
// is usable as empty: it gets created on first write. A file that does not parse,
// or that could not be read (locked by another program, access denied, a folder in
// its place), gives usable=false, and writing is refused: what it holds is unknown,
// and a write would replace it. `reason` says why, for a log line.
export function readPrefs(prefsPath: string): { prefs: AftertermPrefs; usable: boolean; reason?: string } {
  let raw: string;
  try {
    raw = fs.readFileSync(prefsPath, 'utf-8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { prefs: {}, usable: true };
    return { prefs: {}, usable: false, reason: `could not be read (${code ?? String(err)})` };
  }
  try {
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { prefs: parsed as AftertermPrefs, usable: true };
    }
    return { prefs: {}, usable: false, reason: 'is not a JSON object' };
  } catch {
    return { prefs: {}, usable: false, reason: 'is not valid JSON' };
  }
}

// Merge a patch into prefs.json, keeping every other key. Returns false when the
// file was left alone because it does not parse or could not be read, or when the
// write failed. Either way one warning names the file, the reason and the keys that
// were not saved, so a dropped write (the editor pick, Skip or Later, the pending
// update note) shows in the log.
export function updatePrefs(prefsPath: string, patch: Partial<AftertermPrefs>): boolean {
  const { prefs, usable, reason } = readPrefs(prefsPath);
  const keys = Object.keys(patch).join(', ');
  if (!usable) {
    console.warn(`[prefs] ${prefsPath} ${reason}; left as it is, so ${keys} was not saved`);
    return false;
  }
  try {
    fs.writeFileSync(prefsPath, JSON.stringify({ ...prefs, ...patch }, null, 2) + '\n', 'utf-8');
    return true;
  } catch (err) {
    console.warn(`[prefs] ${prefsPath} could not be written (${(err as NodeJS.ErrnoException).code ?? String(err)}), so ${keys} was not saved`);
    return false;
  }
}

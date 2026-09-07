// prefs.json helpers for the main process.
//
// %APPDATA%\afterterm\prefs.json holds the app's small settings: the Claude hook
// opt-out (owned by claude-hook-install.ts, which keeps its own reader), the time
// the app was last opened, and the hand-picked editorPath.
//
// One rule everywhere: a prefs.json that is not valid JSON is treated as empty
// when reading and is never overwritten. Someone hand-edited it and made a typo;
// silently replacing it would throw away the rest of their settings.

import fs from 'fs';

export interface AftertermPrefs {
  claudeNotifications?: 'enabled' | 'disabled';
  claudeHookToastShown?: boolean;
  // Time the app was last opened, in ms since epoch. Written at every startup,
  // read one startup later so Home can say how long you were away.
  lastOpenedAt?: number;
  // Editor executable the user picked by hand. Wins over detection.
  editorPath?: string;
  [key: string]: unknown;
}

// The file's contents, plus whether it was readable at all. `usable` is false
// only when the file exists and does not parse, which is the one case where
// writing is refused. A missing file is usable: it gets created on first write.
export function readPrefs(prefsPath: string): { prefs: AftertermPrefs; usable: boolean } {
  let raw: string;
  try {
    raw = fs.readFileSync(prefsPath, 'utf-8');
  } catch {
    return { prefs: {}, usable: true };
  }
  try {
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { prefs: parsed as AftertermPrefs, usable: true };
    }
  } catch { /* falls through to the unusable result below */ }
  return { prefs: {}, usable: false };
}

// Merge a patch into prefs.json, keeping every other key. Returns false when the
// file was left alone because it does not parse, or when the write failed.
export function updatePrefs(prefsPath: string, patch: Partial<AftertermPrefs>): boolean {
  const { prefs, usable } = readPrefs(prefsPath);
  if (!usable) return false;
  try {
    fs.writeFileSync(prefsPath, JSON.stringify({ ...prefs, ...patch }, null, 2) + '\n', 'utf-8');
    return true;
  } catch {
    return false;
  }
}

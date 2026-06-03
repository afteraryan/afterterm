// claude-hook-install.ts
//
// Layer-1 of afterterm's notification system: reconcile afterterm's notifier
// hook into the user's Claude Code config on app startup. This is NOT a separate
// installer — main.ts calls reconcileClaudeHook() every launch. It is idempotent:
// once registered it does nothing, and it only ever ADDS its own entries
// (preserving the user's existing hooks) or REMOVES them when the user opts out.
//
// Why it can live permanently in ~/.claude/settings.json: the bundled
// afterterm-notify.ps1 exits immediately unless AFTERTERM=1, so the global
// registration is inert in the user's other terminals.
//
// This module imports only Node built-ins (no Electron) so it can be unit-tested
// directly. main.ts supplies the real paths.

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

export const HOOK_SCRIPT_NAME = 'afterterm-notify.ps1';

// The five Claude Code events afterterm decorates, with their matchers.
// Notification is scoped to permission_prompt (idle_prompt would be noise).
const HOOK_EVENTS: { event: string; matcher: string }[] = [
  { event: 'SessionStart', matcher: '' },
  { event: 'UserPromptSubmit', matcher: '' },
  { event: 'Notification', matcher: 'permission_prompt' },
  { event: 'Stop', matcher: '' },
  { event: 'PreCompact', matcher: '' },
];

export interface Prefs {
  claudeNotifications?: 'enabled' | 'disabled';
  claudeHookToastShown?: boolean;
}

export interface ReconcileResult {
  // registered  : we added entries this run (fresh install / user wiped settings)
  // already-current : entries already present, nothing to do
  // removed     : user opted out, we stripped our entries
  // disabled-noop : user opted out, nothing of ours was present
  // skipped     : preconditions not met (no ~/.claude, or unparseable settings)
  status: 'registered' | 'already-current' | 'removed' | 'disabled-noop' | 'skipped';
  changed: boolean; // settings.json was written
  showToast: boolean; // fire the one-time "notifications enabled" toast
  detail: string;
}

export interface ReconcileOpts {
  scriptSource: string; // path to the bundled afterterm-notify.ps1
  claudeDir: string; // ~/.claude
  prefsPath: string; // %APPDATA%/afterterm/prefs.json
  powershell?: string; // override the detected pwsh/powershell (tests)
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function writeJson(file: string, obj: unknown): void {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf-8');
}

// Prefer pwsh (UTF-8 stdout by default); fall back to Windows PowerShell, which
// is always present on Windows. The hook script forces UTF-8 either way.
function detectPowershell(): string {
  try {
    execFileSync('where.exe', ['pwsh'], { stdio: 'ignore' });
    return 'pwsh';
  } catch {
    return 'powershell';
  }
}

// A matcher-group is "ours" if any of its hooks invokes afterterm-notify.ps1.
// Matching on the script filename (not the full path) survives the user moving
// their home dir or afterterm re-copying to a slightly different absolute path.
function isAftertermGroup(group: unknown): boolean {
  const g = group as { hooks?: { args?: unknown[] }[] };
  if (!g || !Array.isArray(g.hooks)) return false;
  return g.hooks.some(
    (h) =>
      Array.isArray(h?.args) &&
      h.args.some(
        (a) => typeof a === 'string' && a.toLowerCase().endsWith(HOOK_SCRIPT_NAME.toLowerCase()),
      ),
  );
}

// Strip afterterm's entries from settings.json; leave every other hook intact.
// Returns true if anything was removed (settings.json then rewritten).
function removeAftertermEntries(settingsPath: string): boolean {
  const s = readJson<{ hooks?: Record<string, unknown[]> }>(settingsPath);
  if (!s || !s.hooks) return false;
  let removed = false;
  for (const event of Object.keys(s.hooks)) {
    const arr = s.hooks[event];
    if (!Array.isArray(arr)) continue;
    const kept = arr.filter((g) => !isAftertermGroup(g));
    if (kept.length !== arr.length) removed = true;
    if (kept.length === 0) delete s.hooks[event];
    else s.hooks[event] = kept;
  }
  if (removed) writeJson(settingsPath, s);
  return removed;
}

export function reconcileClaudeHook(opts: ReconcileOpts): ReconcileResult {
  const { scriptSource, claudeDir, prefsPath } = opts;
  const settingsPath = path.join(claudeDir, 'settings.json');
  const prefs = readJson<Prefs>(prefsPath) ?? {};
  const enabled = prefs.claudeNotifications !== 'disabled'; // default: enabled

  // ── Opt-out path ──────────────────────────────────────────────────────────
  if (!enabled) {
    const removed = removeAftertermEntries(settingsPath);
    return {
      status: removed ? 'removed' : 'disabled-noop',
      changed: removed,
      showToast: false,
      detail: removed ? 'user opted out — entries removed' : 'user opted out — nothing to remove',
    };
  }

  // Only act if Claude Code is actually set up. No ~/.claude → don't create junk.
  if (!fs.existsSync(claudeDir)) {
    return { status: 'skipped', changed: false, showToast: false, detail: 'no ~/.claude (Claude Code not installed)' };
  }

  // If settings.json exists but isn't valid JSON, never clobber it.
  if (fs.existsSync(settingsPath) && readJson<unknown>(settingsPath) === null) {
    return { status: 'skipped', changed: false, showToast: false, detail: 'settings.json is not valid JSON; left untouched' };
  }

  // ── Ensure the hook script is present and current (handles version bumps) ──
  const hooksDir = path.join(claudeDir, 'hooks');
  const scriptDest = path.join(hooksDir, HOOK_SCRIPT_NAME);
  fs.mkdirSync(hooksDir, { recursive: true });
  const srcContent = fs.readFileSync(scriptSource, 'utf-8');
  if (!fs.existsSync(scriptDest) || fs.readFileSync(scriptDest, 'utf-8') !== srcContent) {
    fs.writeFileSync(scriptDest, srcContent, 'utf-8');
  }

  // ── Merge the five hook entries (idempotent, additive) ─────────────────────
  const settings = (readJson<Record<string, unknown>>(settingsPath) ?? {}) as {
    hooks?: Record<string, unknown[]>;
  };
  settings.hooks = settings.hooks ?? {};
  const ps = opts.powershell ?? detectPowershell();

  let added = 0;
  for (const { event, matcher } of HOOK_EVENTS) {
    const arr = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : (settings.hooks[event] = []);
    if (arr.some(isAftertermGroup)) continue;
    arr.push({ matcher, hooks: [{ type: 'command', command: ps, args: ['-NoProfile', '-File', scriptDest] }] });
    added++;
  }

  const changed = added > 0;
  if (changed) writeJson(settingsPath, settings);

  // One-time toast: only the first time we ever register on this machine.
  const showToast = changed && !prefs.claudeHookToastShown;

  // Persist prefs: record that notifications are enabled + that the toast fired.
  const nextPrefs: Prefs = { ...prefs, claudeNotifications: 'enabled' };
  if (showToast) nextPrefs.claudeHookToastShown = true;
  if (JSON.stringify(nextPrefs) !== JSON.stringify(prefs)) writeJson(prefsPath, nextPrefs);

  return {
    status: changed ? 'registered' : 'already-current',
    changed,
    showToast,
    detail: changed ? `registered ${added} hook event(s) using ${ps}` : 'already registered',
  };
}

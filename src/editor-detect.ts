// Editor detection: find the editor afterterm's "Open in ..." button launches.
//
// Pure module. Every filesystem, environment, `where code` and registry read
// arrives through the injected DetectDeps, so the whole search order is unit
// testable on any platform (see editor-detect.test.ts). main.ts supplies the
// real, Windows-only implementations.
//
// The search order is the one in docs/design-02-projects-and-threads.md:
//   1. editorPath from prefs.json (a hand-picked path wins over everything)
//   2. what the `code` command actually resolves to (`where code`)
//   3. the standard per-user and system install folders
//   4. the Windows uninstall registry
// The first editor found overall is the primary. Results are de-duplicated by
// lower-cased path, so an editor that turns up twice is listed once, keeping the
// source of the earliest step that found it.

import { editorProductName, editorProductFromExe } from './editors.ts';
import type { EditorInfo, EditorProduct } from './editors.ts';

// The executables afterterm recognises by name. Order matters: it is the order a
// folder is searched in when editorPath points at one, so VS Code wins over a
// fork sitting in the same folder.
export const KNOWN_EDITOR_EXES = [
  'Code.exe',
  'Code - Insiders.exe',
  'Cursor.exe',
  'Windsurf.exe',
];

export interface DetectDeps {
  // Process environment: LOCALAPPDATA, ProgramFiles, USERPROFILE and friends.
  env: Record<string, string | undefined>;
  // True when the path exists at all, file or directory.
  exists(p: string): boolean;
  // True when the path exists and is a file.
  isFile(p: string): boolean;
  // Entry names inside a directory. Empty array on any error.
  listDir(p: string): string[];
  // File contents as text, null on any error. Used to read a code.cmd shim.
  readText(p: string): string | null;
  // Output lines of `where code`. Empty array when the command fails or `code`
  // is not on PATH.
  whereCode(): string[];
  // Uninstall registry entries, from HKCU and HKLM (including WOW6432Node).
  registryEditors(): { displayName: string; installLocation?: string; displayIcon?: string }[];
}

export interface DetectResult {
  // Primary editor first, then the rest in the order they were found. Empty when
  // nothing was found, which is what hides the button in the UI.
  editors: EditorInfo[];
  // True only when prefs.json carries an editorPath that exists but is not an
  // editor (a folder with no known exe in it). A deleted or unset editorPath is
  // not "invalid": it is simply not set, and detection carries on. The UI shows
  // the "Editor path not valid" toast for this flag alone.
  invalidPrefsPath: boolean;
}

// ── Path helpers ─────────────────────────────────────────────────────────────
// Written by hand against Windows separators rather than imported from node:path,
// so this module stays free of Node built-ins and behaves identically when the
// tests run on another platform.

function baseName(p: string): string {
  const cleaned = p.replace(/[\\/]+$/, '');
  const cut = Math.max(cleaned.lastIndexOf('\\'), cleaned.lastIndexOf('/'));
  return cut === -1 ? cleaned : cleaned.slice(cut + 1);
}

function dirName(p: string): string {
  const cleaned = p.replace(/[\\/]+$/, '');
  const cut = Math.max(cleaned.lastIndexOf('\\'), cleaned.lastIndexOf('/'));
  return cut === -1 ? '' : cleaned.slice(0, cut);
}

function join(dir: string, name: string): string {
  return `${dir.replace(/[\\/]+$/, '')}\\${name}`;
}

// Resolve a relative segment (as a shim writes it: `..\Code.exe`) against a
// directory, collapsing `.` and `..`.
function resolveFrom(dir: string, relative: string): string {
  const parts = dir.split(/[\\/]+/).filter(Boolean);
  for (const segment of relative.split(/[\\/]+/)) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') parts.pop();
    else parts.push(segment);
  }
  return parts.join('\\');
}

function isKnownExe(name: string): boolean {
  return KNOWN_EDITOR_EXES.some(known => known.toLowerCase() === name.toLowerCase());
}

// ── Collector ────────────────────────────────────────────────────────────────

class Found {
  readonly list: EditorInfo[] = [];
  private readonly seen = new Set<string>();

  add(exePath: string, source: EditorInfo['source'], forcedProduct?: EditorProduct): void {
    const key = exePath.toLowerCase();
    if (this.seen.has(key)) return;
    this.seen.add(key);
    const exe = baseName(exePath);
    const product = forcedProduct ?? editorProductFromExe(exe);
    this.list.push({
      id: `${product}:${key}`,
      name: editorProductName(product, exe),
      path: exePath,
      product,
      source,
    });
  }
}

// ── Step 1: editorPath from prefs.json ───────────────────────────────────────

function fromPrefs(prefsEditorPath: string | undefined, deps: DetectDeps, found: Found): boolean {
  const raw = (prefsEditorPath ?? '').trim();
  if (!raw) return false;
  // A file wins outright, whatever it is called. A hand-picked path is the user
  // saying "this is my editor", so an unknown exe is accepted as product 'other'
  // and named after its file.
  if (deps.isFile(raw)) {
    found.add(raw, 'prefs');
    return false;
  }
  // Not a file. A folder is accepted when it holds a known editor exe.
  if (deps.exists(raw)) {
    for (const exe of KNOWN_EDITOR_EXES) {
      const candidate = join(raw, exe);
      if (deps.isFile(candidate)) {
        found.add(candidate, 'prefs');
        return false;
      }
    }
    // Some other folder entirely: report it and carry on with the rest of the
    // search, so the user still gets a working button.
    return true;
  }
  // Nothing there any more (the editor was uninstalled, the drive is gone).
  // Treated as not set, exactly like an absent key.
  return false;
}

// ── Step 2: what `code` really is ────────────────────────────────────────────

// A `code.cmd` shim launches the exe from a folder above it: `<install>\bin` for
// VS Code and Windsurf, `<install>\resources\app\bin` for Cursor. Walk up to
// three levels looking for a known exe, then fall back to reading the shim.
function resolveShim(shimPath: string, deps: DetectDeps): string | null {
  let dir = dirName(shimPath);
  for (let level = 0; level < 3 && dir; level++) {
    dir = dirName(dir);
    if (!dir) break;
    for (const exe of KNOWN_EDITOR_EXES) {
      const candidate = join(dir, exe);
      if (deps.isFile(candidate)) return candidate;
    }
  }
  // The shim itself names the exe, usually as "%~dp0..\Code.exe". Read it as a
  // last resort so an unusual layout still resolves.
  const text = deps.readText(shimPath);
  if (text) {
    const match = /%~dp0([^"\r\n]*\.exe)/i.exec(text);
    if (match) {
      const candidate = resolveFrom(dirName(shimPath), match[1]);
      if (deps.isFile(candidate)) return candidate;
    }
  }
  return null;
}

function fromPath(deps: DetectDeps, found: Found): void {
  let lines: string[] = [];
  try {
    lines = deps.whereCode();
  } catch {
    lines = [];
  }
  for (const line of lines) {
    const entry = line.trim();
    if (!entry) continue;
    const name = baseName(entry).toLowerCase();
    if (name.endsWith('.cmd') || name.endsWith('.bat')) {
      const exe = resolveShim(entry, deps);
      if (exe) found.add(exe, 'path');
      continue;
    }
    if (!name.endsWith('.exe')) continue;
    // A bare code.exe on PATH is the Microsoft Store app execution alias under
    // WindowsApps. It launches VS Code, so it is used as it stands, with no
    // existence check: `where` only lists what it found, and the alias is a
    // reparse point that a plain stat can refuse to follow.
    found.add(entry, 'path');
  }
}

// ── Step 3: standard install folders ─────────────────────────────────────────

function fromInstallFolders(deps: DetectDeps, found: Found): void {
  const localAppData = deps.env.LOCALAPPDATA ?? '';
  const programFiles = deps.env.ProgramFiles ?? deps.env.PROGRAMFILES ?? '';
  const candidates: string[] = [];
  if (localAppData) {
    candidates.push(join(localAppData, 'Programs\\Microsoft VS Code\\Code.exe'));
  }
  if (programFiles) {
    candidates.push(join(programFiles, 'Microsoft VS Code\\Code.exe'));
  }
  if (localAppData) {
    candidates.push(join(localAppData, 'Programs\\Microsoft VS Code Insiders\\Code - Insiders.exe'));
  }
  if (programFiles) {
    candidates.push(join(programFiles, 'Microsoft VS Code Insiders\\Code - Insiders.exe'));
  }
  if (localAppData) {
    candidates.push(join(localAppData, 'Programs\\cursor\\Cursor.exe'));
    candidates.push(join(localAppData, 'Programs\\Windsurf\\Windsurf.exe'));
  }
  for (const candidate of candidates) {
    if (deps.isFile(candidate)) found.add(candidate, 'install');
  }
}

// ── Step 4: the Windows uninstall registry ───────────────────────────────────

const REGISTRY_NAME_PREFIX = 'microsoft visual studio code';

function fromRegistry(deps: DetectDeps, found: Found): void {
  let entries: { displayName: string; installLocation?: string; displayIcon?: string }[] = [];
  try {
    entries = deps.registryEditors();
  } catch {
    entries = [];
  }
  for (const entry of entries) {
    const displayName = (entry.displayName ?? '').trim();
    if (!displayName.toLowerCase().startsWith(REGISTRY_NAME_PREFIX)) continue;
    const exeName = /insiders/i.test(displayName) ? 'Code - Insiders.exe' : 'Code.exe';
    const location = (entry.installLocation ?? '').trim();
    if (location) {
      const candidate = join(location, exeName);
      if (deps.isFile(candidate)) {
        found.add(candidate, 'registry');
        continue;
      }
    }
    // DisplayIcon is a path, sometimes with an icon index after a comma.
    const icon = (entry.displayIcon ?? '').trim().replace(/^"|"$/g, '');
    if (!icon) continue;
    const iconPath = icon.replace(/,\s*-?\d+\s*$/, '').trim();
    if (iconPath && /\.exe$/i.test(iconPath) && deps.isFile(iconPath)) {
      found.add(iconPath, 'registry');
    }
  }
}

// ── The search ───────────────────────────────────────────────────────────────

export function detectEditors(prefsEditorPath: string | undefined, deps: DetectDeps): DetectResult {
  const found = new Found();
  let invalidPrefsPath = false;
  try {
    invalidPrefsPath = fromPrefs(prefsEditorPath, deps, found);
  } catch {
    invalidPrefsPath = false;
  }
  try { fromPath(deps, found); } catch { /* PATH lookup failed, keep going */ }
  try { fromInstallFolders(deps, found); } catch { /* folder probe failed, keep going */ }
  try { fromRegistry(deps, found); } catch { /* registry read failed, keep going */ }
  return { editors: found.list, invalidPrefsPath };
}

// True when the file the user picked in the editor chooser is one afterterm
// knows by name. A pick that is not is still accepted (product 'other'), so this
// is only used for logging and messages.
export function isKnownEditorExe(exePath: string): boolean {
  return isKnownExe(baseName(exePath));
}

// Automatic updates, the main-process side (docs/design-05-automatic-updates.md).
//
// Only an installed copy checks: packaged, and its exe's folder is the
// InstallLocation of its own Settings > Apps entry. A dev build, a build run
// from out\ and a harness run (AFTERTERM_USER_DATA_DIR) never do, unless
// AFTERTERM_UPDATE_FEED points at a test feed, and even then only an installed
// copy ever runs Setup.
//
// The rules (versions, the asset, the digest, Later and Skip) are pure and live
// in update-check.ts; this file is the timer, the fetch, the download with its
// sha256, starting Setup, and the IPC. State is pushed to the renderer as
// `update:state` on every change.

import { app, ipcMain, net } from 'electron';
import type { BrowserWindow } from 'electron';
import { execFile, spawn } from 'child_process';
import { once } from 'events';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  CHECK_INTERVAL_MS, FIRST_CHECK_DELAY_MS, LATER_MS, RELEASES_URL,
  asPendingUpdate, autoChecksOn, downloadSource, initialUpdateState, installFolder, isSuppressed,
  parseRelease, samePath, staleDownloads, updateLanded,
} from './update-check.ts';
import type { PendingUpdate, ReleaseInfo, UpdateError, UpdateState } from './update-check.ts';
import { readPrefs, updatePrefs } from './prefs.ts';

export interface UpdaterOptions {
  getWindow: () => BrowserWindow | null;
  prefsPath: () => string;
  // The Settings > Apps entry this copy belongs to, and its installer's file
  // name prefix: "afterterm" / "afterterm", or the sandbox build's
  // "afterterm (test)" / "afterterm-test".
  productName: string;
  assetBase: string;
  // Quit through the app's usual path (before-quit drains the PTYs).
  quit: () => void;
}

// What the renderer gets once, on the launch after an update restart.
export interface UpdateLaunch {
  to: string;
  notes: string;
  activeThreadId?: string;
  screen?: 'home' | 'workspace' | 'project';
  projectId?: string;
}

const PROGRESS_EVERY_MS = 100;

export function initUpdater(opts: UpdaterOptions): void {
  const current = app.getVersion();
  const feed = process.env.AFTERTERM_UPDATE_FEED || '';
  const slowMs = Number(process.env.AFTERTERM_UPDATE_SLOW_MS) || 0;
  const updatesDir = path.join(app.getPath('userData'), 'updates');
  const prefs = () => readPrefs(opts.prefsPath()).prefs;
  const savePrefs = (patch: Record<string, unknown>) => updatePrefs(opts.prefsPath(), patch);

  let state: UpdateState = {
    ...initialUpdateState(current),
    auto: autoChecksOn(prefs()),
    lastChecked: typeof prefs().updateLastChecked === 'number' ? prefs().updateLastChecked as number : null,
  };
  let release: ReleaseInfo | null = null;
  let installer: string | null = null;     // the verified installer, once downloaded
  let installed = false;                   // this copy is the installed one
  let downloading: AbortController | null = null;
  let laterTimer: ReturnType<typeof setTimeout> | null = null;

  const set = (patch: Partial<UpdateState>) => {
    state = { ...state, ...patch };
    const win = opts.getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('update:state', state);
  };

  // ── After an update restart ────────────────────────────────────────────────
  // Read once, cleared at once: a relaunch after this one starts as usual.
  const pending: PendingUpdate | null = asPendingUpdate(prefs().pendingUpdate);
  let launch: UpdateLaunch | null = null;
  if (pending) {
    if (updateLanded(pending, current)) {
      launch = { to: pending.to, notes: pending.notes ?? '', activeThreadId: pending.activeThreadId, screen: pending.screen, projectId: pending.projectId };
    }
    savePrefs({ pendingUpdate: undefined });
  }

  // ── Which copy this is ─────────────────────────────────────────────────────
  // The Settings > Apps entry is found by its name; the folder is in
  // HKCU\Software\<the entry's key>, where the engine writes InstallLocation, or
  // else beside the uninstaller (installFolder). Read through PowerShell rather
  // than reg.exe: reg.exe prints in the console code page, which would garble an
  // install path under an accented user name.
  const readInstallLocation = () => new Promise<string | null>(resolve => {
    const name = opts.productName.replace(/'/g, "''");
    const script = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; " +
      "$k = Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' -ErrorAction SilentlyContinue | " +
      `Where-Object { (Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue).DisplayName -eq '${name}' } | Select-Object -First 1; ` +
      "if ($k) { " +
      "'install=' + (Get-ItemProperty ('HKCU:\\Software\\' + $k.PSChildName) -ErrorAction SilentlyContinue).InstallLocation; " +
      "'uninstall=' + (Get-ItemProperty $k.PSPath).UninstallString }";
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 20_000, encoding: 'utf8' },
      (err, stdout) => {
        if (err) { resolve(null); return; }
        const line = (key: string) => stdout.split(/\r?\n/).find(l => l.startsWith(`${key}=`))?.slice(key.length + 1);
        resolve(installFolder(line('install'), line('uninstall')));
      });
  });

  const detectInstalled = async (): Promise<boolean> => {
    if (!app.isPackaged || process.env.AFTERTERM_USER_DATA_DIR) return false;
    const loc = await readInstallLocation();
    return !!loc && samePath(loc, path.dirname(process.execPath));
  };

  // ── The release ────────────────────────────────────────────────────────────
  const headers = { 'User-Agent': `afterterm/${current}`, Accept: 'application/vnd.github+json' };

  const fetchRelease = async (): Promise<unknown> => {
    if (feed) return JSON.parse((await fs.promises.readFile(feed, 'utf-8')).replace(/^﻿/, ''));
    const res = await net.fetch(RELEASES_URL, { headers });
    // 403 and 429 are GitHub's rate limit; like a network error, that is
    // "no update this time".
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };

  const hashFile = async (file: string): Promise<string> => {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk as Buffer);
    return hash.digest('hex');
  };

  const finalPath = (r: ReleaseInfo) => path.join(updatesDir, r.assetName);

  // An installer for this release already downloaded and still matching.
  const verifiedOnDisk = async (r: ReleaseInfo): Promise<boolean> => {
    try {
      if ((await hashFile(finalPath(r))) === r.sha256) return true;
      await fs.promises.rm(finalPath(r), { force: true });
    } catch { /* not there */ }
    return false;
  };

  const shown = (r: ReleaseInfo) => ({ version: r.version, notes: r.notes, size: r.size });

  const check = async (manual: boolean): Promise<void> => {
    if (state.phase === 'checking' || state.phase === 'downloading') return;
    if (!state.canCheck) return;
    const before = state.phase;
    // Only a check by hand shows Checking; a timed one stays out of sight, so the
    // title bar button never blinks off while it runs.
    if (manual) set({ phase: 'checking', upToDate: false, error: null });
    try {
      const verdict = parseRelease(await fetchRelease(), current, opts.assetBase);
      const now = Date.now();
      savePrefs({ updateLastChecked: now });
      if (verdict.kind === 'update') {
        const r = verdict.release;
        const same = release && release.version === r.version && release.sha256 === r.sha256;
        release = r;
        if (!same) installer = null;
        const ready = installer !== null || await verifiedOnDisk(r);
        if (ready) installer = finalPath(r);
        set({
          phase: ready ? 'ready' : 'available', release: shown(r), received: 0, lastChecked: now,
          hidden: isSuppressed(r.version, prefs(), now), upToDate: false, error: null,
        });
      } else {
        release = null;
        installer = null;
        set({ phase: 'idle', release: null, received: 0, lastChecked: now, upToDate: manual, hidden: false, error: null });
      }
    } catch {
      set({ phase: before, error: manual ? 'check' : state.error });
    }
  };

  // ── The download ───────────────────────────────────────────────────────────
  const download = async (): Promise<void> => {
    if (!release || state.phase === 'downloading' || state.phase === 'ready') return;
    const r = release;
    const src = downloadSource(r.url, !!feed);
    if (!src) { set({ error: 'network' }); return; }
    await fs.promises.mkdir(updatesDir, { recursive: true });
    const partial = `${finalPath(r)}.partial`;
    const ac = new AbortController();
    downloading = ac;
    set({ phase: 'downloading', received: 0, error: null, hidden: false });

    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(partial);
    let received = 0;
    let total = r.size;
    let sentAt = 0;
    const take = async (chunk: Uint8Array) => {
      if (ac.signal.aborted) throw new Error('cancelled');
      hash.update(chunk);
      if (!out.write(chunk)) await once(out, 'drain');
      received += chunk.length;
      const now = Date.now();
      if (now - sentAt >= PROGRESS_EVERY_MS) { sentAt = now; set({ received }); }
    };

    try {
      if (src.kind === 'https') {
        const res = await net.fetch(src.url, { signal: ac.signal, headers: { 'User-Agent': headers['User-Agent'] } });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        const length = Number(res.headers.get('content-length'));
        if (!total && length > 0) total = length;
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          await take(value);
        }
      } else {
        // The test feed's local installer. AFTERTERM_UPDATE_SLOW_MS spreads the
        // copy over that long, so a test can watch the progress.
        if (!total) total = (await fs.promises.stat(src.path)).size;
        for await (const chunk of fs.createReadStream(src.path, { highWaterMark: 1 << 20 })) {
          await take(chunk as Buffer);
          if (slowMs > 0 && total > 0) await new Promise(res => setTimeout(res, slowMs * (chunk as Buffer).length / total));
        }
      }
      out.end();
      await once(out, 'close');
      if (total !== r.size && state.release) set({ release: { ...state.release, size: total } });
      if (hash.digest('hex') !== r.sha256) {
        await fs.promises.rm(partial, { force: true });
        set({ phase: 'available', received: 0, error: 'checksum' });
        return;
      }
      await fs.promises.rm(finalPath(r), { force: true });
      await fs.promises.rename(partial, finalPath(r));
      installer = finalPath(r);
      set({ phase: 'ready', received: total, error: null });
    } catch {
      out.destroy();
      try { await fs.promises.rm(partial, { force: true }); } catch { /* best effort */ }
      // The release may have changed under a check meanwhile; only touch the
      // state when this download is still the one shown.
      if (release === r) set({ phase: 'available', received: 0, error: ac.signal.aborted ? null : 'network' });
    } finally {
      if (downloading === ac) downloading = null;
    }
  };

  // ── Restart to update ──────────────────────────────────────────────────────
  const restart = async (info: { activeThreadId?: string; screen?: string; projectId?: string }):
    Promise<{ ok: boolean; error?: UpdateError }> => {
    if (state.phase !== 'ready' || !release || !installer) return { ok: false };
    const fail = (error: UpdateError) => { set({ error }); return { ok: false, error }; };
    // The test feed makes checks run anywhere, but Setup only ever installs over
    // an installed copy.
    if (!installed) return fail('not-installed');
    // Checked again right before it runs: the file sat in a folder for a while.
    if ((await hashFile(installer).catch(() => '')) !== release.sha256) {
      await fs.promises.rm(installer, { force: true }).catch(() => {});
      installer = null;
      set({ phase: 'available', received: 0 });
      return fail('checksum');
    }
    const pendingUpdate = asPendingUpdate({ from: current, to: release.version, notes: release.notes, ...info });
    savePrefs({ pendingUpdate });
    try {
      // Started from the updates folder, never from the install folder: a
      // process whose current folder is the install folder stops the engine
      // from replacing it (CLAUDE.md, "Close afterterm before building").
      const child = spawn(installer, ['--update', '--wait-pid', String(process.pid)], {
        detached: true, stdio: 'ignore', cwd: updatesDir,
      });
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', () => resolve());
        child.once('error', reject);
      });
      child.unref();
    } catch {
      savePrefs({ pendingUpdate: undefined });
      return fail('setup');
    }
    // The renderer saves the awake threads on its way out (beforeunload), then
    // before-quit drains the PTYs; Setup waits for this process to be gone.
    setTimeout(() => opts.quit(), 0);
    return { ok: true };
  };

  // ── Later, Skip, the switch ────────────────────────────────────────────────
  const scheduleUnhide = () => {
    if (laterTimer) clearTimeout(laterTimer);
    const until = prefs().updateLaterUntil;
    if (typeof until !== 'number') return;
    laterTimer = setTimeout(() => {
      laterTimer = null;
      if (state.release) set({ hidden: isSuppressed(state.release.version, prefs(), Date.now()) });
    }, Math.max(1000, until - Date.now() + 1000));
  };

  const cleanDownloads = async () => {
    try {
      const names = await fs.promises.readdir(updatesDir);
      for (const n of staleDownloads(names, current, opts.assetBase)) {
        await fs.promises.rm(path.join(updatesDir, n), { force: true }).catch(() => {});
      }
    } catch { /* no folder yet */ }
  };

  // ── IPC ────────────────────────────────────────────────────────────────────
  ipcMain.handle('update:get', () => state);
  ipcMain.handle('update:take-launch', () => { const l = launch; launch = null; return l; });
  ipcMain.handle('update:check', () => check(true));
  ipcMain.handle('update:download', () => { void download(); });
  ipcMain.handle('update:cancel', () => { downloading?.abort(); });
  ipcMain.handle('update:later', () => {
    savePrefs({ updateLaterUntil: Date.now() + LATER_MS });
    set({ hidden: true });
    scheduleUnhide();
  });
  ipcMain.handle('update:skip', () => {
    if (!state.release) return;
    savePrefs({ updateSkippedVersion: state.release.version });
    set({ hidden: true });
  });
  ipcMain.handle('update:restart', (_e, info: unknown) => {
    const i = (info && typeof info === 'object' ? info : {}) as Record<string, unknown>;
    return restart({
      activeThreadId: typeof i.activeThreadId === 'string' ? i.activeThreadId : undefined,
      screen: typeof i.screen === 'string' ? i.screen : undefined,
      projectId: typeof i.projectId === 'string' ? i.projectId : undefined,
    });
  });
  ipcMain.handle('update:set-auto', (_e, on: unknown) => {
    savePrefs({ updateChecks: on ? 'enabled' : 'disabled' });
    set({ auto: !!on });
  });

  // ── Start ──────────────────────────────────────────────────────────────────
  // The registry read is asynchronous and the first check waits ~10 seconds, so
  // nothing here holds up the launch.
  void detectInstalled().then(isInstalled => {
    installed = isInstalled;
    set({ canCheck: installed || !!feed });
    if (process.env.AFTERTERM_HARNESS === '1') console.log(`[harness] update installed=${installed} feed=${feed ? 'yes' : 'no'}`);
    if (!state.canCheck) return;
    scheduleUnhide();
    const delay = Number(process.env.AFTERTERM_UPDATE_CHECK_DELAY_MS);
    const first = Number.isFinite(delay) && delay >= 0 && process.env.AFTERTERM_UPDATE_CHECK_DELAY_MS ? delay : FIRST_CHECK_DELAY_MS;
    const tick = () => { if (autoChecksOn(prefs())) void check(false); };
    setTimeout(() => {
      void cleanDownloads();
      tick();
      setInterval(tick, CHECK_INTERVAL_MS);
    }, first);
  });
}

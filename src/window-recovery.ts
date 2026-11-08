// Window recovery (AFT-33): the rules for getting afterterm's window back by itself
// when its page crashes, hangs or loses its graphics, without closing the app.
// Pure: no Electron, no DOM, so the rules run in plain Node
// (node src/window-recovery.test.ts). main.ts and Terminal/index.tsx act on them.
//
// Why the app has to do this itself: on 2026-10-02, with the PC low on memory, the
// window froze and then went blank while every shell and Claude session in it kept
// running. Closing the app would have stopped them all. Ending the GPU process by
// hand brought the window back without text, and a font size change per terminal
// brought each terminal's text back.

// How long the page may stay unresponsive (after Chromium has already called it
// hung) before main ends its renderer process and loads the page again. Long
// enough that a page busy for a few seconds is left alone, short enough that a
// frozen window comes back without anyone closing the app. No dialog: the point is
// that it comes back by itself.
export const HANG_GRACE_MS = 15_000;

// A page that crashes again as soon as it loads must not be reloaded in a tight
// loop: at most RELOAD_LIMIT reloads within RELOAD_WINDOW_MS. A reload refused for
// that waits until the oldest of them leaves the window and is tried then, so the
// window still comes back by itself once whatever crashed it has passed.
export const RELOAD_LIMIT = 3;
export const RELOAD_WINDOW_MS = 60_000;

// How long after a renderer process goes away main waits before loading the page
// again, so the old process is fully torn down first.
export const RELOAD_DELAY_MS = 1_000;

// Whether one more reload is allowed now, given when the earlier ones ran. Returns
// the times to keep (the ones still inside the window, plus now when allowed) and,
// when refused, how long until one is allowed again.
export function allowReload(
  times: readonly number[],
  now: number,
  limit = RELOAD_LIMIT,
  windowMs = RELOAD_WINDOW_MS,
): { allowed: boolean; times: number[]; retryInMs?: number } {
  const recent = times.filter(t => now - t < windowMs && t <= now);
  if (recent.length >= limit) {
    const oldest = Math.min(...recent);
    return { allowed: false, times: recent, retryInMs: oldest + windowMs - now };
  }
  return { allowed: true, times: [...recent, now] };
}

// What main does when a window's renderer process goes away
// (webContents 'render-process-gone'). A clean exit is the page closing on
// purpose (the app quitting), never a crash. Every other reason (crashed, killed,
// oom, abnormal-exit, launch-failed, integrity-failure, memory-eviction) reloads
// the page. Nothing reloads while the app is quitting.
export function afterRendererGone(reason: string, quitting: boolean): 'reload' | 'nothing' {
  if (quitting || reason === 'clean-exit') return 'nothing';
  return 'reload';
}

// What main does when one of the app's other processes goes away
// (app 'child-process-gone'). Chromium starts a new GPU process by itself; what
// it does not do is bring the terminals' text back, so the page is told to redraw
// its terminals. Every other process is only logged.
export function afterChildGone(type: string, reason: string): 'repaint' | 'log' {
  return type === 'GPU' && reason !== 'clean-exit' ? 'repaint' : 'log';
}

// What main does when a page asks for a thread's shell (pty:create). A shell main
// already holds is attached to, never spawned again. A page restoring a thread that
// was running before a reload asks for an attach only: when that shell has ended in
// the moment since main listed it, nothing is spawned ('gone'), so no shell starts
// with a resume or a command typed into it, and the thread goes to sleep.
export function ptyCreateAction(exists: boolean, attachOnly: boolean): 'attach' | 'spawn' | 'gone' {
  if (exists) return 'attach';
  return attachOnly ? 'gone' : 'spawn';
}

// A terminal draws with WebGL. When its WebGL context is lost and not given back
// (the GPU process died, the driver reset, memory ran out), the WebGL renderer is
// disposed and a fresh one loaded, which is what a font size change did by hand.
// After WEBGL_MAX_LOSSES losses in one terminal, it stays on xterm's DOM renderer,
// which needs no GPU: slower, but it always draws.
export const WEBGL_MAX_LOSSES = 3;

export function rendererAfterLoss(losses: number, maxLosses = WEBGL_MAX_LOSSES): 'webgl' | 'dom' {
  return losses < maxLosses ? 'webgl' : 'dom';
}

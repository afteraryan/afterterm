// Where the main window opens, and when it goes back to its display (AFT-15).
// Pure: no Electron. main.ts feeds it display lists, window bounds and times.
//
// When a display goes away (the laptop lid closes, a monitor sleeps or is
// unplugged) Windows moves the windows that were on it to another display, and it
// does not move them back when the display returns. So afterterm remembers where
// the user put its window, its "home": the normal (not maximized) bounds, the
// display, and whether it was maximized. It is kept in prefs.json, the window
// opens there, and when the home display comes back while the window sits on
// another one, the window goes back home.
//
// Whose move was it? Windows moves the window when the display set changes (a
// display added, removed or changed, the machine going to sleep or waking), so a
// move within SETTLE_MS of one of those is Windows' and does not change the home.
// A lock or an unlock changes no display, so it does not count: a move made just
// after unlocking is the user's. Any other move is the user's and becomes the new
// home, so a window the user moved by hand is never taken back.
//
// Every rectangle is in Electron's screen coordinates (DIP), the same ones
// BrowserWindow.getBounds and screen.getAllDisplays use.

export interface Rect { x: number; y: number; width: number; height: number }

export interface DisplayInfo { id: number; bounds: Rect; workArea: Rect }

export interface WindowHome {
  // The window's normal bounds: what it returns to when not maximized.
  bounds: Rect;
  displayId: number;
  // The display's bounds when the home was remembered. Finds the display again if
  // Windows gives it a new id, and moves the window with the display if the
  // display now sits somewhere else in the arrangement.
  displayBounds: Rect;
  maximized: boolean;
}

// A move that began within this long after a display change is Windows'. Main
// decides SAVE_DELAY_MS after the move ends, so a change up to that long after
// the move counts too; a later one is not seen.
export const SETTLE_MS = 5000;
// How long main waits after the last move before deciding whose it was, so that
// a display change that lands just after the move is seen.
export const SAVE_DELAY_MS = 2000;

// Which events change the display set (and so make a move near them Windows').
// Electron's names: screen's display-added, display-removed and
// display-metrics-changed, powerMonitor's suspend and resume. Not lock-screen or
// unlock-screen: no display changes then, and a monitor that drops off while the
// screen is locked sends display-removed anyway.
const DISPLAY_CHANGES = new Set(['display-added', 'display-removed', 'display-metrics-changed', 'suspend', 'resume']);
export function countsAsDisplayChange(event: string): boolean {
  return DISPLAY_CHANGES.has(event);
}
// How much of the window must be on a display for the window to count as
// reachable there: the top TITLE_BAR_PX rows (the title bar, to grab it by), at
// least MIN_VISIBLE_PX wide.
export const TITLE_BAR_PX = 32;
export const MIN_VISIBLE_PX = 120;
// Display and power change times older than this are dropped.
export const EVENT_KEEP_MS = 60_000;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function asRect(v: unknown): Rect | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (!isNum(r.x) || !isNum(r.y) || !isNum(r.width) || !isNum(r.height)) return null;
  if (r.width <= 0 || r.height <= 0) return null;
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
}

export function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export function sameHome(a: WindowHome, b: WindowHome): boolean {
  return a.displayId === b.displayId && a.maximized === b.maximized
    && sameRect(a.bounds, b.bounds) && sameRect(a.displayBounds, b.displayBounds);
}

// prefs.json keys: windowBounds, windowDisplayId, windowDisplayBounds, windowMaximized.
// Anything missing or malformed means no home (the window opens where Electron
// puts it, as before).
export function homeFromPrefs(prefs: Record<string, unknown>): WindowHome | null {
  const bounds = asRect(prefs.windowBounds);
  const displayBounds = asRect(prefs.windowDisplayBounds);
  const displayId = prefs.windowDisplayId;
  if (!bounds || !displayBounds || !isNum(displayId)) return null;
  return { bounds, displayId, displayBounds, maximized: prefs.windowMaximized === true };
}

export function homeToPrefs(home: WindowHome): {
  windowBounds: Rect; windowDisplayId: number; windowDisplayBounds: Rect; windowMaximized: boolean;
} {
  return {
    windowBounds: home.bounds,
    windowDisplayId: home.displayId,
    windowDisplayBounds: home.displayBounds,
    windowMaximized: home.maximized,
  };
}

// The home display among the displays present: the one with both the remembered
// id and the remembered bounds; else the one with the remembered bounds (the same
// monitor, given a new id, or two monitors whose ids were swapped, which happens
// since Chromium's id is a hash of the output's device name); else the one with
// the remembered id (the same monitor, moved in the arrangement or rescaled).
export function findHomeDisplay(home: WindowHome, displays: DisplayInfo[]): DisplayInfo | null {
  return displays.find(d => d.id === home.displayId && sameRect(d.bounds, home.displayBounds))
    ?? displays.find(d => sameRect(d.bounds, home.displayBounds))
    ?? displays.find(d => d.id === home.displayId)
    ?? null;
}

// The top TITLE_BAR_PX rows of the window are inside the work area, at least
// MIN_VISIBLE_PX of them across (or the whole width of a narrower window).
export function reachable(bounds: Rect, workArea: Rect): boolean {
  if (bounds.y < workArea.y || bounds.y + TITLE_BAR_PX > workArea.y + workArea.height) return false;
  const overlap = Math.min(bounds.x + bounds.width, workArea.x + workArea.width) - Math.max(bounds.x, workArea.x);
  return overlap >= Math.min(MIN_VISIBLE_PX, bounds.width);
}

// The home bounds on the display as it is now: moved with the display if the
// display moved in the arrangement, no larger than its work area, and moved
// inside it. So a present home display always gives a window that is wholly on
// screen, even after the display got smaller (a higher scale, a lower resolution)
// or when the home's top edge sat a few pixels above the work area.
export function placeOn(home: WindowHome, display: DisplayInfo): Rect {
  const wa = display.workArea;
  const dx = display.bounds.x - home.displayBounds.x;
  const dy = display.bounds.y - home.displayBounds.y;
  const width = Math.min(home.bounds.width, wa.width);
  const height = Math.min(home.bounds.height, wa.height);
  const within = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  return {
    x: within(home.bounds.x + dx, wa.x, wa.x + wa.width - width),
    y: within(home.bounds.y + dy, wa.y, wa.y + wa.height - height),
    width,
    height,
  };
}

// Where the window opens: its home, when the home display is present (placeOn
// then always gives a reachable place; reachable stays as a check). null means
// Electron's default placement.
export function startupPlacement(home: WindowHome | null, displays: DisplayInfo[]):
  { bounds: Rect; maximized: boolean; displayId: number } | null {
  if (!home) return null;
  const display = findHomeDisplay(home, displays);
  if (!display) return null;
  const bounds = placeOn(home, display);
  if (!reachable(bounds, display.workArea)) return null;
  return { bounds, maximized: home.maximized, displayId: display.id };
}

// Whether a move (its first and last bounds change) was Windows': some display
// change (countsAsDisplayChange) happened within SETTLE_MS before it started or
// after it ended. Main asks SAVE_DELAY_MS after the end, so in practice "after"
// means up to SAVE_DELAY_MS.
export function isWindowsMove(firstAt: number, lastAt: number, eventTimes: number[], settleMs = SETTLE_MS): boolean {
  return eventTimes.some(t => t >= firstAt - settleMs && t <= lastAt + settleMs);
}

export function pruneEvents(eventTimes: number[], now: number, keepMs = EVENT_KEEP_MS): number[] {
  return eventTimes.filter(t => now - t <= keepMs);
}

export interface MoveBackInput {
  home: WindowHome | null;
  // The display the window is on now (the one it overlaps most).
  windowDisplayId: number | null;
  displays: DisplayInfo[];
  // A move that has not been decided yet and is not Windows' so far: the user is
  // moving the window right now, so leave it alone.
  userMovePending: boolean;
  minimized: boolean;
}

export type MoveBack =
  | { action: 'move'; bounds: Rect; maximize: boolean; displayId: number }
  | { action: 'stay'; reason: string };

// Called when a display comes back, on wake and on unlock: put the window back on
// its home display if Windows moved it off. The user's own moves already changed
// the home, so a window the user moved stays where it is.
export function moveBack(input: MoveBackInput): MoveBack {
  const { home, windowDisplayId, displays, userMovePending, minimized } = input;
  if (!home) return { action: 'stay', reason: 'no home remembered' };
  if (userMovePending) return { action: 'stay', reason: 'the user is moving the window' };
  if (minimized) return { action: 'stay', reason: 'minimized' };
  const display = findHomeDisplay(home, displays);
  if (!display) return { action: 'stay', reason: 'its display is not there' };
  if (windowDisplayId === display.id) return { action: 'stay', reason: 'already on its display' };
  const bounds = placeOn(home, display);
  if (!reachable(bounds, display.workArea)) return { action: 'stay', reason: 'its place is off the display' };
  return { action: 'move', bounds, maximize: home.maximized, displayId: display.id };
}

// Whether a rectangle lands on the given display (the one it overlaps most).
// main's harness guard: a move back is made under the harness only when it
// lands on the harness's own display, so made-up display positions can never put
// the dev window on the monitor a person is using.
export function landsOn(bounds: Rect, displays: DisplayInfo[], displayId: number): boolean {
  return displayMatching(bounds, displays)?.id === displayId;
}

// The display a rectangle overlaps most, like Electron's screen.getDisplayMatching
// but over any list of displays (landsOn, and the tests). null when it overlaps none.
export function displayMatching(bounds: Rect, displays: DisplayInfo[]): DisplayInfo | null {
  let best: DisplayInfo | null = null;
  let bestArea = 0;
  for (const d of displays) {
    const w = Math.min(bounds.x + bounds.width, d.bounds.x + d.bounds.width) - Math.max(bounds.x, d.bounds.x);
    const h = Math.min(bounds.y + bounds.height, d.bounds.y + d.bounds.height) - Math.max(bounds.y, d.bounds.y);
    const area = w > 0 && h > 0 ? w * h : 0;
    if (area > bestArea) { best = d; bestArea = area; }
  }
  return best;
}

// When a toast in the notifier overlay goes away on its own (release 0.9.0,
// agreed with Aryan on 2026-09-29): the rail and the sidebar already show every
// thread's state, so a toast that stays while he is using afterterm only
// repeats them.
//
// The rule:
//   - While the main window is focused, a toast goes 5 seconds after it arrives.
//   - The pointer on any toast card pauses every toast, so the stack never moves
//     under the pointer.
//   - While the main window is not focused (another app in front, minimized) no
//     toast goes: it stays until afterterm is focused again, and from that moment
//     it gets its 5 seconds. Losing focus again before then pauses it again.
//   - Each time the clock starts again (focus back, pointer off the cards) every
//     toast gets a fresh 5 seconds; there is no time-left bookkeeping.
//
// Expiry only removes the toast from the overlay. The thread keeps its state in
// the main window, and clicking a toast or its x works as before.
//
// Pure and DOM-free, like jumpScroll.ts: NotifierApp keeps a ToastClock in state
// and runs one timer to nextDeadline.

export const TOAST_LIFETIME_MS = 5000;

export interface ToastClock {
  // Whether the main window has focus (main sends notifier:main-focus).
  focused: boolean;
  // The id of the toast card under the pointer, or null. Kept by id so a hovered
  // card that is dismissed does not leave the other toasts paused forever.
  hoveredId: string | null;
  // One entry per live toast id: when it goes (ms since epoch), or null while
  // the clock is stopped.
  deadlines: Record<string, number | null>;
}

export function initialToastClock(focused = false): ToastClock {
  return { focused, hoveredId: null, deadlines: {} };
}

// Whether toasts are counting down: the window is focused and the pointer is not
// on a live card.
export function clockRuns(clock: ToastClock): boolean {
  if (!clock.focused) return false;
  return clock.hoveredId === null || !(clock.hoveredId in clock.deadlines);
}

// Every deadline restarted: a fresh lifetime from now when the clock runs, null
// when it is stopped.
function restart(clock: ToastClock, now: number): ToastClock {
  const value = clockRuns(clock) ? now + TOAST_LIFETIME_MS : null;
  const deadlines: Record<string, number | null> = {};
  for (const id of Object.keys(clock.deadlines)) deadlines[id] = value;
  return { ...clock, deadlines };
}

// A change to focus, hover or the live ids: when it flips whether the clock
// runs, every toast restarts; otherwise the deadlines are kept.
function settle(before: ToastClock, after: ToastClock, now: number): ToastClock {
  return clockRuns(before) !== clockRuns(after) ? restart(after, now) : after;
}

// Match the clock to the toasts on screen: a new id starts its lifetime now
// (or waits, if the clock is stopped), a gone id is dropped. Returns the same
// object when nothing changed, so React can skip the render.
export function syncToasts(clock: ToastClock, ids: readonly string[], now: number): ToastClock {
  const live = new Set(ids);
  const known = Object.keys(clock.deadlines);
  const added = ids.filter(id => !(id in clock.deadlines));
  const removed = known.filter(id => !live.has(id));
  if (added.length === 0 && removed.length === 0) return clock;

  const deadlines: Record<string, number | null> = {};
  for (const id of known) if (live.has(id)) deadlines[id] = clock.deadlines[id];
  for (const id of added) deadlines[id] = null;
  const after: ToastClock = { ...clock, deadlines };
  // Dropping the hovered card can start the clock again for the rest.
  if (clockRuns(after) !== clockRuns(clock)) return restart(after, now);
  const value = clockRuns(after) ? now + TOAST_LIFETIME_MS : null;
  for (const id of added) deadlines[id] = value;
  return after;
}

export function setMainFocus(clock: ToastClock, focused: boolean, now: number): ToastClock {
  if (clock.focused === focused) return clock;
  return settle(clock, { ...clock, focused }, now);
}

export function setHoveredToast(clock: ToastClock, id: string | null, now: number): ToastClock {
  if (clock.hoveredId === id) return clock;
  return settle(clock, { ...clock, hoveredId: id }, now);
}

// The toasts whose time is up at `now`.
export function expiredToasts(clock: ToastClock, now: number): string[] {
  return Object.keys(clock.deadlines).filter(id => {
    const d = clock.deadlines[id];
    return d !== null && d <= now;
  });
}

// The soonest deadline, or null when no toast is counting down.
export function nextDeadline(clock: ToastClock): number | null {
  let soonest: number | null = null;
  for (const d of Object.values(clock.deadlines)) {
    if (d !== null && (soonest === null || d < soonest)) soonest = d;
  }
  return soonest;
}

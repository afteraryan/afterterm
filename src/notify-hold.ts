// Toasts wait while a full-screen app or a presentation is in front (AFT-72,
// decided by Aryan on 2026-11-09). Since AFT-41 the overlay is raised above every
// window each time it shows, so without this a toast would land on top of a game,
// a slide show or a full-screen video. Windows' own notifications stay quiet in
// exactly those cases, and afterterm follows the same signal:
// SHQueryUserNotificationState (shell32), asked from main through a PowerShell
// helper (notify-state-probe.ts). While it says busy, Direct3D full screen or
// presentation mode, the overlay stays hidden and the toasts wait in it; when the
// state ends they show and are raised as before. The rail and the sidebar are
// not touched: only the overlay waits.
//
// Pure and DOM-free: main keeps an OverlayHold and acts on each HoldStep.

// What SHQueryUserNotificationState answered, by name. 'unknown' is every
// failure: no answer, an error HRESULT, the helper not running, a bad line.
export type NotifyState =
  | 'not-present'   // QUNS_NOT_PRESENT (1): screen saver, locked, or a non-interactive desktop
  | 'busy'          // QUNS_BUSY (2): a full-screen app is in front (or presentation settings are on)
  | 'fullscreen'    // QUNS_RUNNING_D3D_FULL_SCREEN (3): a Direct3D app in exclusive full screen
  | 'presentation'  // QUNS_PRESENTATION_MODE (4): Windows' presentation mode
  | 'accepts'       // QUNS_ACCEPTS_NOTIFICATIONS (5): nothing in the way
  | 'quiet-time'    // QUNS_QUIET_TIME (6): the first hour after a new user signs in
  | 'app'           // QUNS_APP (7): a Store app in front
  | 'unknown';

export const NOTIFY_STATES: readonly NotifyState[] = [
  'not-present', 'busy', 'fullscreen', 'presentation', 'accepts', 'quiet-time', 'app', 'unknown',
];

const QUNS_STATES: Record<number, NotifyState> = {
  1: 'not-present',
  2: 'busy',
  3: 'fullscreen',
  4: 'presentation',
  5: 'accepts',
  6: 'quiet-time',
  7: 'app',
};

// How often main asks again while the overlay has toasts: a held toast shows at
// most this long after the full-screen app or presentation goes, and a toast on
// screen goes off it at most this long after one comes in front.
export const HOLD_POLL_MS = 3000;

// The three states Windows' own notifications stay quiet for. Everything else,
// 'unknown' included, shows: a probe that failed must never hide toasts.
export function holdsToasts(state: NotifyState): boolean {
  return state === 'busy' || state === 'fullscreen' || state === 'presentation';
}

// One line from the helper: "quns=<n>" on success, "hr=<n>" for a failed call,
// "error" when the call could not be made. Anything that is not a known
// "quns=" value is 'unknown'. Spaces, a carriage return and a byte order mark
// around it are allowed (JavaScript's \s covers all three).
export function parseProbeLine(line: string): NotifyState {
  const m = /^\s*quns=(\d+)\s*$/.exec(line);
  if (!m) return 'unknown';
  return QUNS_STATES[Number(m[1])] ?? 'unknown';
}

// A state named in words, for the dev build's AFTERTERM_NOTIFY_STATE override
// (the env value itself, or the text of the file it names). Case and the
// spaces around it do not matter. Null when the text is not a state's name.
export function stateWord(text: string | undefined | null): NotifyState | null {
  if (typeof text !== 'string') return null;
  const word = text.trim().toLowerCase();
  return (NOTIFY_STATES as readonly string[]).includes(word) ? word as NotifyState : null;
}

// What main knows about the overlay.
export interface OverlayHold {
  // The overlay's page has toasts: a push since its last notifier:hide.
  toasts: boolean;
  // The last answer said a full-screen app or a presentation is in front, so the
  // overlay is kept hidden with its toasts in it.
  held: boolean;
  // A probe is running; its answer comes as an 'answer' event.
  probing: boolean;
  // A toast was pushed and is waiting for an answer to be shown and raised
  // (every push raises the overlay, AFT-41).
  pushPending: boolean;
}

export function initialHold(): OverlayHold {
  return { toasts: false, held: false, probing: false, pushPending: false };
}

export type HoldEvent =
  | { type: 'push' }                            // a toast was sent to the overlay
  | { type: 'emptied' }                         // the overlay has no toasts left (notifier:hide)
  | { type: 'answer'; state: NotifyState }      // a probe finished
  | { type: 'poll' };                           // the HOLD_POLL_MS timer fired

// What main does after an event, in this order: hide, show (with the raise),
// then the timer and the probe.
export interface HoldStep {
  next: OverlayHold;
  // Hide the overlay: a full-screen app or a presentation came in front while a
  // toast was up (or before one could show).
  hide: boolean;
  // Show the overlay and raise it above every window: a toast was pushed, or a
  // hold ended.
  show: boolean;
  // Ask Windows now.
  probe: boolean;
  // Ask again in HOLD_POLL_MS (any timer already set is replaced).
  poll: boolean;
  // Cancel the timer: no toasts left.
  stopPoll: boolean;
}

function step(next: OverlayHold, actions: Partial<Omit<HoldStep, 'next'>> = {}): HoldStep {
  return { next, hide: false, show: false, probe: false, poll: false, stopPoll: false, ...actions };
}

export function holdStep(hold: OverlayHold, event: HoldEvent): HoldStep {
  switch (event.type) {
    case 'push': {
      // A probe already running answers for this toast too.
      if (hold.probing) return step({ ...hold, toasts: true, pushPending: true });
      return step({ ...hold, toasts: true, pushPending: true, probing: true }, { probe: true });
    }
    case 'emptied':
      // The renderer hid the overlay itself. A probe still running is let finish;
      // its answer is dropped, since there is nothing to show.
      return step({ ...hold, toasts: false, held: false, pushPending: false }, { stopPoll: true });
    case 'poll':
      if (!hold.toasts || hold.probing) return step(hold);
      return step({ ...hold, probing: true }, { probe: true });
    case 'answer': {
      const settled = { ...hold, probing: false };
      if (!settled.toasts) return step({ ...settled, held: false, pushPending: false });
      if (holdsToasts(event.state)) {
        // Hidden until the state ends; the next answer that shows raises it.
        return step({ ...settled, held: true, pushPending: false }, { hide: !hold.held, poll: true });
      }
      // Shown: raised for a new toast or the end of a hold. A toast already on
      // screen with nothing new is left where it is, so the polling never
      // reorders windows on its own.
      return step(
        { ...settled, held: false, pushPending: false },
        { show: hold.held || hold.pushPending, poll: true },
      );
    }
  }
}

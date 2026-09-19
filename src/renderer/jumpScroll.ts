// The jump-to-top / jump-to-bottom button's state machine (Phase 9): a small
// round button that appears over a scroller (the live terminal, or the asleep
// pane's saved tail) once the user has scrolled away from the end they are
// heading toward, and points the way they are going.
//
// Pure and DOM-free on purpose: the terminal side samples xterm's own
// buffer.active.viewportY (position) and buffer.active.baseY (max) on scroll,
// the asleep pane samples a div's scrollTop and scrollHeight - clientHeight,
// and both feed the same onScrollSample here. Keeping the rule in one place
// means "when does the button show" cannot drift between the two hosts.
//
// The rule, agreed with the product owner: the button points the way the
// user is scrolling and hides when that end is within reach.
//   - Scrolled up (position decreased): show 'top' once further than
//     threshold from the top, else hide.
//   - Scrolled down (position increased): show 'bottom' once further than
//     threshold from the bottom, else hide.
//   - Not moved (a resample with the same position, e.g. new output grew
//     max): keep whatever target was showing, but drop it once its own end
//     is now within threshold (covers new output arriving while already
//     following the bottom: position and max grow together, remaining stays
//     0, so the button never appears).
//   - Nothing to scroll (max <= 0): always hidden.

export type JumpTarget = 'top' | 'bottom' | null;

export interface JumpState {
  target: JumpTarget;
  // The last sampled position, clamped to 0..max, so the next sample can tell
  // which way the scroller moved.
  position: number;
}

// Buffer lines for the terminal scroller (xterm reports position in lines).
export const JUMP_THRESHOLD_LINES = 3;
// Pixels for the asleep pane's plain div scroller.
export const JUMP_THRESHOLD_PX = 48;

// How long a terminal jump takes, in milliseconds: a short base plus a little
// per line, capped so a 10,000-line scrollback still arrives well under half a
// second. The asleep pane uses the browser's own smooth scrolling instead.
export const JUMP_MIN_MS = 180;
export const JUMP_MAX_MS = 450;
export const JUMP_MS_PER_LINE = 2;

export function jumpDurationMs(distanceLines: number): number {
  const d = Math.abs(distanceLines);
  if (!Number.isFinite(d) || d === 0) return 0;
  return Math.min(JUMP_MAX_MS, JUMP_MIN_MS + d * JUMP_MS_PER_LINE);
}

// Where the viewport should be `elapsed` ms into a jump from `from` to `to`:
// ease-out cubic, so the scroll starts fast and settles, and always exactly
// `to` once the duration is up (or when there is no duration at all).
export function jumpLineAt(from: number, to: number, elapsed: number, durationMs: number): number {
  if (durationMs <= 0 || elapsed >= durationMs) return to;
  const p = Math.max(0, elapsed) / durationMs;
  const eased = 1 - Math.pow(1 - p, 3);
  return Math.round(from + (to - from) * eased);
}

// The one place both hosts ask whether a jump should animate at all. Guarded so
// the pure tests (plain Node, no window) can import this module.
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function initialJumpState(position = 0): JumpState {
  return { target: null, position };
}

export function onScrollSample(state: JumpState, position: number, max: number, threshold: number): JumpState {
  const upperBound = Math.max(max, 0);
  const clamped = Math.min(Math.max(position, 0), upperBound);

  if (max <= 0) return { target: null, position: clamped };

  if (clamped < state.position) {
    // Scrolled up: point at the top, unless the top is already within reach.
    const target: JumpTarget = clamped > threshold ? 'top' : null;
    return { target, position: clamped };
  }

  if (clamped > state.position) {
    // Scrolled down: point at the bottom, unless the bottom is already within reach.
    const remaining = max - clamped;
    const target: JumpTarget = remaining > threshold ? 'bottom' : null;
    return { target, position: clamped };
  }

  // Position did not move (e.g. new output grew max while position followed
  // it, or a resample with nothing new). Keep the current target, but drop it
  // once its own remaining distance has closed to within threshold.
  let target = state.target;
  if (target === 'top' && clamped <= threshold) target = null;
  if (target === 'bottom' && max - clamped <= threshold) target = null;
  return { target, position: clamped };
}

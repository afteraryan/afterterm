// What reaches a thread's PTY when its terminal changes size (AFT-11). Pure: no
// xterm, no DOM, importable from plain Node (node src/renderer/resizeGate.test.ts).
//
// Why it exists: every size change makes a full-screen program such as Claude Code
// redraw its screen, and a redraw after the terminal got narrower leaves the top of
// the old screen behind in the scrollback, so the same text shows twice (measured
// 2026-11-08, docs/screenshots/terminal-output-check/findings.md: one more copy per
// resize; plain output resized the same way leaves none). afterterm cannot stop the
// program redrawing, but it decides how many resizes the program gets. So a PTY is
// told only what it needs:
//   - never the size it already has (the PTY's size is known from its spawn on);
//   - while the window's edge is being dragged, nothing: the terminal itself still
//     follows the drag, and the PTY gets the final size once, when the drag ends.
//     Before this a slow drag sent one resize per pause (ten in one test drag),
//     and Claude Code left one more copy for each.

export interface PtySize {
  cols: number;
  rows: number;
}

export interface ResizeGate {
  // The size the PTY has now: what it was spawned at, then the last size sent.
  // null until the PTY exists.
  sent: PtySize | null;
  // A window edge drag is in progress: sizes are kept, not sent.
  held: boolean;
  // The newest size seen while held, sent when the hold ends.
  pending: PtySize | null;
}

export function initialResizeGate(spawned: PtySize | null, held = false): ResizeGate {
  return { sent: spawned, held, pending: null };
}

export function sameSize(a: PtySize | null, b: PtySize | null): boolean {
  return !!a && !!b && a.cols === b.cols && a.rows === b.rows;
}

// The terminal has a new size. Returns the size to send to the PTY, or null.
export function onTerminalResize(gate: ResizeGate, size: PtySize): { gate: ResizeGate; send: PtySize | null } {
  if (gate.held) return { gate: { ...gate, pending: { ...size } }, send: null };
  if (sameSize(gate.sent, size)) return { gate: { ...gate, pending: null }, send: null };
  return { gate: { ...gate, sent: { ...size }, pending: null }, send: { ...size } };
}

// A window edge drag starts (held) or ends (not held). Ending sends the newest
// size seen during the drag, unless the PTY already has it.
export function onHoldChange(gate: ResizeGate, held: boolean): { gate: ResizeGate; send: PtySize | null } {
  if (held) return { gate: { ...gate, held: true }, send: null };
  const pending = gate.pending;
  const released: ResizeGate = { ...gate, held: false, pending: null };
  if (!pending || sameSize(gate.sent, pending)) return { gate: released, send: null };
  return { gate: { ...released, sent: { ...pending } }, send: { ...pending } };
}

// The size to spawn a PTY at. A terminal on screen measures its own size (proposed).
// One that cannot be measured yet (made while it is off screen: woken from a menu,
// from the project page, or after an update restart) used to start at xterm's
// default 80x24 and be resized the first time it was shown, which made a chat
// redraw once more; it now starts at the size the last terminal shown alone with the
// same font size had (hint), and only falls back to its current size without one.
export function spawnSize(proposed: PtySize | undefined, hint: PtySize | undefined, current: PtySize): PtySize {
  if (proposed && proposed.cols > 0 && proposed.rows > 0) return { ...proposed };
  if (hint && hint.cols > 0 && hint.rows > 0) return { ...hint };
  return { ...current };
}

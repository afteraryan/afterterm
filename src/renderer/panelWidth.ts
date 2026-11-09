// The side panel's width (AFT-30): how wide it may be, what a drag makes of the
// pointer's position, and which saved width is believable. Pure module: no
// React, no DOM, runnable under plain Node for its tests
// (node src/renderer/panelWidth.test.ts).
//
// The panel is 264px wide until the person drags its edge (the default is also
// theme.css's --sidebar). The width they chose is saved in session.json's `ui`
// (sessionMigration.ts) and drawn through the same CSS variable, so the hidden
// panel's slide to zero width is untouched.

// What the panel is when nothing has been chosen, and what a double-click on
// its edge goes back to. Keep equal to --sidebar in theme.css.
export const PANEL_DEFAULT_WIDTH = 264;

// The narrowest the panel may be dragged: a project row with its counter pills
// and a thread row with its close button still fit.
export const PANEL_MIN_WIDTH = 180;

// The widest, as a share of the window: about half, so the terminal always keeps
// the other half.
export const PANEL_MAX_SHARE = 0.5;

// A saved width above this is not a width anyone dragged to (a hand edit, a bad
// write); it is dropped on load. A real saved width from a large window is far
// below it, and it is clamped to the window at draw time (clampPanelWidth), so a
// width saved on a big screen still reads sensibly on a small one.
export const PANEL_SAVED_MAX = 4000;

// The widest the panel may be in a window this wide. Never below the minimum,
// so a very narrow window cannot make the limits cross.
export function panelMaxWidth(windowWidth: number): number {
  return Math.max(PANEL_MIN_WIDTH, Math.floor(windowWidth * PANEL_MAX_SHARE));
}

// A width, rounded to a whole pixel and held between the minimum and the
// window's maximum.
export function clampPanelWidth(width: number, windowWidth: number): number {
  return Math.min(panelMaxWidth(windowWidth), Math.max(PANEL_MIN_WIDTH, Math.round(width)));
}

// Where a drag of the edge starts from: the width the panel is set to, not the
// width it is drawn at this instant. The two differ for 320 ms whenever the panel
// eases to a new width: sliding open from zero, a double-click reset, and a page
// that reloads (AFT-33), which draws the default width first and then eases to the
// restored one. A drag measured from a panel still easing open ended near the
// minimum, whatever the person dragged to. The drawn width is used only when the
// set one is not a usable width.
export function dragStartWidth(setWidth: number, drawnWidth: number): number {
  if (Number.isFinite(setWidth) && setWidth >= PANEL_MIN_WIDTH) return Math.round(setWidth);
  return Number.isFinite(drawnWidth) ? Math.round(drawnWidth) : PANEL_DEFAULT_WIDTH;
}

// The width while the edge is dragged: where the panel started plus how far the
// pointer has moved since it was pressed, held within the limits.
export function widthAfterDrag(startWidth: number, startX: number, x: number, windowWidth: number): number {
  return clampPanelWidth(startWidth + (x - startX), windowWidth);
}

// A width read back from session.json, or undefined when there is none to use.
// A wrongly typed or out-of-range value is dropped rather than clamped, the same
// rule as every other saved field: the panel then has its default width. A
// fraction is rounded to a whole pixel, so a hand-edited 300.4 reads as 300.
export function asPanelWidth(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  const w = Math.round(v);
  if (w < PANEL_MIN_WIDTH || w > PANEL_SAVED_MAX) return undefined;
  return w;
}

// What the panel contributes to session.json's `ui`: the hidden flag, and the
// width only once the person has chosen one. A width at the default (or one that
// is not a number at all) saves no key, so a reset leaves the file as it was
// before the panel could be resized. Any other width is held to the saved range
// first, the same one asPanelWidth accepts on load (not to the current window:
// the width the person chose is what is kept, whatever size the window is now),
// so what is written always reads back as written.
export function savedUi(panelHidden: boolean, panelWidth: number): { panelHidden: boolean; panelWidth?: number } {
  if (!Number.isFinite(panelWidth)) return { panelHidden };
  const width = Math.min(PANEL_SAVED_MAX, Math.max(PANEL_MIN_WIDTH, Math.round(panelWidth)));
  return width === PANEL_DEFAULT_WIDTH ? { panelHidden } : { panelHidden, panelWidth: width };
}

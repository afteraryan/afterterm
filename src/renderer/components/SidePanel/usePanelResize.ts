import { useState, useCallback } from 'react';
import type { RefObject, PointerEvent as ReactPointerEvent } from 'react';
import { PANEL_DEFAULT_WIDTH, widthAfterDrag } from '../../panelWidth';

// Resizing the panel by its right edge (AFT-30). The handle is a thin strip
// between the panel and the main pane (SidePanel/index.tsx draws it, SidePanel.css
// styles it); this hook is what a press on it does.
//
// It follows the split divider's rule (docs/features-split-groups.md): while the
// edge is held the width is written straight to the panel's CSS variable, with no
// React render per move, and the terminals do NOT refit, since every refit resizes
// a PTY and a hosted TUI repaints on each one. On release the width is committed
// once and the caller refits the terminals once. `document.body.panel-resizing`
// tells the terminal area's ResizeObserver to stand still meanwhile, and gives the
// whole window the resize cursor and no text selection (index.css).
//
// This is separate from the panel's own row drag (usePanelDrag.ts): that one starts
// on a thread or project row inside the list, this one on the strip outside the
// panel, so the two never see the same press.

export interface PanelResize {
  // True from the press on the edge until the release; the panel stops
  // transitioning its width then, so it follows the pointer exactly.
  resizing: boolean;
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  // Puts the panel back to its default width, animated.
  onDoubleClick: () => void;
}

interface Options {
  panelRef: RefObject<HTMLElement | null>;
  // Called with the new width: `settled` is true when a drag has just ended (the
  // terminals can refit now), false for a reset the panel is still animating to
  // (the terminal area's own ResizeObserver refits when that settles).
  onChange: (width: number, settled: boolean) => void;
}

export function usePanelResize({ panelRef, onChange }: Options): PanelResize {
  const [resizing, setResizing] = useState(false);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const panel = panelRef.current;
    if (!panel) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startWidth = Math.round(panel.getBoundingClientRect().width);
    let width = startWidth;
    handle.classList.add('active');
    document.body.classList.add('panel-resizing');
    setResizing(true);

    const move = (ev: PointerEvent) => {
      width = widthAfterDrag(startWidth, startX, ev.clientX, window.innerWidth);
      panel.style.setProperty('--sidebar', `${width}px`);
    };
    // Ends the drag once, however it ends: the release, a cancel, the pointer
    // capture being taken away (which fires after a normal release too), or the
    // window losing focus (Alt+Tab with the button held). The last one is what
    // makes sure body.panel-resizing, which pauses the terminals' refit, cannot
    // stay on if the browser sends none of the others. The width reached so far is
    // kept, as on a release.
    let ended = false;
    const up = () => {
      if (ended) return;
      ended = true;
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      handle.removeEventListener('lostpointercapture', up);
      window.removeEventListener('blur', up);
      handle.classList.remove('active');
      document.body.classList.remove('panel-resizing');
      setResizing(false);
      // A press and release without moving changes nothing and refits nothing.
      if (width !== startWidth) onChange(width, true);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
    handle.addEventListener('lostpointercapture', up);
    window.addEventListener('blur', up);
  }, [panelRef, onChange]);

  const onDoubleClick = useCallback(() => {
    onChange(PANEL_DEFAULT_WIDTH, false);
  }, [onChange]);

  return { resizing, onPointerDown, onDoubleClick };
}

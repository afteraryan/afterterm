// The jump-to-top / jump-to-bottom button (Phase 9): a small round button that
// floats at the centre of a scroller (the live terminal card, or the asleep
// pane) once jumpScroll.ts says the user has scrolled away from the end they
// are heading toward. Pure data-in, like AsleepPane: the host owns the
// scroller, samples its own position and max on scroll, and only hands this
// component the resulting target.
//
// Two things the host has to be told about, both from Aryan's first use on
// 2026-09-19. The button appears under the pointer mid-scroll (it sits where
// the wheel is used), and a wheel event over it would otherwise stop at the
// button and never reach the scroller, so every wheel event over it is handed
// back to the host through onWheel to apply to the scroller itself. And it
// comes and goes by scaling (no fade), which needs it to stay mounted while it
// shrinks away: the last non-null target is kept for the icon during the exit,
// and the shown state drives the CSS transition.
import React, { useRef } from 'react';
import { IconChevU, IconChevD } from '../Icons';
import type { JumpTarget } from '../../jumpScroll';
import './JumpButton.css';

export interface JumpButtonProps {
  target: JumpTarget;
  onJump: (target: 'top' | 'bottom') => void;
  // A wheel event that landed on the button; the host scrolls its scroller by it.
  onWheel: (deltaY: number, deltaX: number, deltaMode: number) => void;
}

export function JumpButton({ target, onJump, onWheel }: JumpButtonProps) {
  const lastRef = useRef<'top' | 'bottom'>('bottom');
  if (target !== null) lastRef.current = target;
  const shown = target !== null;
  const dir = target ?? lastRef.current;
  const label = dir === 'top' ? 'Go to top' : 'Go to bottom';

  return (
    <button
      type="button"
      className="jump-btn"
      data-jump={dir}
      data-shown={shown ? 'true' : 'false'}
      // No tooltip (Aryan, 2026-09-19): the arrow says it, and a hover overlay
      // over the very spot the wheel is used would only get in the way.
      aria-label={label}
      aria-hidden={!shown}
      tabIndex={shown ? 0 : -1}
      // The button lives over a scroller the user is actively reading; a
      // click on it must not steal focus away from the terminal or pane.
      onMouseDown={(e) => e.preventDefault()}
      onWheel={(e) => onWheel(e.deltaY, e.deltaX, e.deltaMode)}
      onClick={() => { if (shown) onJump(dir); }}
    >
      {dir === 'top' ? <IconChevU size={16} /> : <IconChevD size={16} />}
    </button>
  );
}

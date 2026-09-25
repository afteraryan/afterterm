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
//
// It also goes away on its own JUMP_IDLE_MS after the scrolling stops (Aryan,
// 2026-09-21). The host calls poke() on every scroll of the user's (through the
// ref, so a scroll never re-renders the host); the pointer moved onto the
// button holds it, and leaving it starts the wait again. The button appears at
// the scroller's centre, often right under a pointer that is only turning the
// wheel, so neither an enter nor a jittering move during the scroll holds it:
// a scroll always releases the hold, and a move holds only once the scrolling
// has paused (jumpHoldOnMove; found in the self-test). Hidden this way, the
// host's target is untouched, so the next scroll brings the button back.
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { IconChevU, IconChevD } from '../Icons';
import { JUMP_IDLE_MS, jumpHoldOnMove } from '../../jumpScroll';
import type { JumpTarget } from '../../jumpScroll';
import './JumpButton.css';

export interface JumpButtonHandle {
  // The user scrolled: show again if the wait had hidden it, and restart the wait.
  poke(): void;
}

export interface JumpButtonProps {
  target: JumpTarget;
  onJump: (target: 'top' | 'bottom') => void;
  // A wheel event that landed on the button; the host scrolls its scroller by it.
  onWheel: (deltaY: number, deltaX: number, deltaMode: number) => void;
}

export const JumpButton = forwardRef<JumpButtonHandle, JumpButtonProps>(function JumpButton({ target, onJump, onWheel }, ref) {
  const lastRef = useRef<'top' | 'bottom'>('bottom');
  if (target !== null) lastRef.current = target;

  const [idle, setIdle] = useState(false);
  const hoverRef = useRef(false);
  const lastScrollRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearWait = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };
  const startWait = useCallback(() => {
    clearWait();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (!hoverRef.current) setIdle(true);
    }, JUMP_IDLE_MS);
  }, []);
  useImperativeHandle(ref, () => ({
    poke: () => {
      lastScrollRef.current = performance.now();
      hoverRef.current = false;
      setIdle(false);
      startWait();
    },
  }), [startWait]);
  // Appearing or flipping direction is the user scrolling too; gone, no wait.
  useEffect(() => {
    lastScrollRef.current = performance.now();
    hoverRef.current = false;
    setIdle(false);
    if (target === null) clearWait();
    else startWait();
  }, [target, startWait]);
  useEffect(() => clearWait, []);

  const shown = target !== null && !idle;
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
      onMouseMove={() => {
        if (hoverRef.current || idle || !jumpHoldOnMove(performance.now(), lastScrollRef.current)) return;
        hoverRef.current = true;
        clearWait();
      }}
      onMouseLeave={() => { hoverRef.current = false; if (target !== null) startWait(); }}
      onWheel={(e) => onWheel(e.deltaY, e.deltaX, e.deltaMode)}
      onClick={() => { if (shown) onJump(dir); }}
    >
      {dir === 'top' ? <IconChevU size={16} /> : <IconChevD size={16} />}
    </button>
  );
});

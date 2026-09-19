// The jump-to-top / jump-to-bottom button (Phase 9): a small round button that
// floats at the bottom-right of a scroller (the live terminal card, or the
// asleep pane) once jumpScroll.ts says the user has scrolled away from the
// end they are heading toward. Pure data-in, like AsleepPane: the host owns
// the scroller, samples its own position and max on scroll, and only hands
// this component the resulting target.
import React from 'react';
import { IconChevU, IconChevD } from '../Icons';
import type { JumpTarget } from '../../jumpScroll';
import './JumpButton.css';

export interface JumpButtonProps {
  target: JumpTarget;
  onJump: (target: 'top' | 'bottom') => void;
}

export function JumpButton({ target, onJump }: JumpButtonProps) {
  if (target === null) return null;

  const label = target === 'top' ? 'Go to top' : 'Go to bottom';

  return (
    <button
      type="button"
      className="jump-btn"
      data-jump={target}
      data-tip={label}
      aria-label={label}
      // The button lives over a scroller the user is actively reading; a
      // click on it must not steal focus away from the terminal or pane.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onJump(target)}
    >
      {target === 'top' ? <IconChevU size={16} /> : <IconChevD size={16} />}
    </button>
  );
}

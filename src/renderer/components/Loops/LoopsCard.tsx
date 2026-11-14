// The loops card in the workspace (design-07, mock loops-always-visible.html): a
// floating card at the top right of the main pane with the 5 most recent loops
// (open or closed, never rotting), a solid amber "N rotting" button, and a foot
// with the remaining count over a bar and an All button. Opened and closed only by
// the header's loops button or Ctrl+Shift+L: an outside click or Esc never closes
// it. It flies out of that button and back into it (300 ms).
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Group } from '../TabBar/types';
import { loopCounts, recentForCard, type Loop } from '../../../loops';
import { LoopList } from './LoopList';
import { ClockIcon } from './LoopIcons';
import './LoopsCard.css';

export interface LoopsCardProps {
  open: boolean;
  loops: Loop[];
  groups: Group[];
  now: number;
  onRotting: () => void;
  onAll: () => void;
  onOpenChat: (loop: Loop) => void;
  onToast: (message: string, actionLabel?: string, onAction?: () => void) => void;
  // The loops tour shows example loops here with an "Example" tag (AFT-103).
  example?: boolean;
}

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// The header button the card flies into: the focused half's, else the first.
function headerButton(): DOMRect | null {
  const all = Array.from(document.querySelectorAll<HTMLElement>('[data-loops-button]')).filter((b) => b.getBoundingClientRect().width > 0);
  const focused = all.find((b) => b.closest('.term-col.fcol')) ?? all[0];
  return focused ? focused.getBoundingClientRect() : null;
}

function flightFrames(card: DOMRect, to: DOMRect): Keyframe[] {
  const dx = to.left + to.width / 2 - (card.left + card.width / 2);
  const dy = to.top + to.height / 2 - (card.top + card.height / 2);
  const small = `translate(${dx}px, ${dy}px) scale(${Math.max(to.width / card.width, 0.04)}, ${Math.max(to.height / card.height, 0.04)})`;
  return [{ transform: 'none', opacity: 1 }, { transform: small, opacity: 0.2 }];
}

export function LoopsCard({ open, loops, groups, now, onRotting, onAll, onOpenChat, onToast, example }: LoopsCardProps) {
  const [shown, setShown] = useState(open);
  const ref = useRef<HTMLDivElement>(null);
  const flying = useRef<Animation | null>(null);
  const opening = useRef(false);

  // Closing: fly into the button, then go.
  useEffect(() => {
    if (open) { if (!shown) { opening.current = true; setShown(true); } return; }
    if (!shown) return;
    const el = ref.current, to = headerButton();
    if (!el || !to || reduced()) { setShown(false); return; }
    flying.current?.cancel();
    const a = el.animate(flightFrames(el.getBoundingClientRect(), to), { duration: 300, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
    flying.current = a;
    a.onfinish = () => { flying.current = null; setShown(false); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Opening: out of the button.
  useLayoutEffect(() => {
    if (!shown || !opening.current) return;
    opening.current = false;
    const el = ref.current, to = headerButton();
    if (!el || !to || reduced()) return;
    flying.current?.cancel();
    const a = el.animate(flightFrames(el.getBoundingClientRect(), to).reverse(), { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' });
    flying.current = a;
    a.onfinish = () => { flying.current = null; };
  }, [shown]);

  if (!shown) return null;
  const counts = loopCounts(loops, now);
  const rows = recentForCard(loops, now);
  return (
    <div className={`lc-card${example ? ' ex' : ''}`} ref={ref} data-loops-card="">
      <div className="lc-head">
        <span className="lc-title">Loops{example && <span className="lc-example">Example</span>}</span>
        {counts.rotting > 0 && (
          <button type="button" className="lc-rot" data-act="rotting" onClick={onRotting}>
            <ClockIcon size={13} strokeWidth={1.6} />{counts.rotting} rotting
          </button>
        )}
      </div>
      <div className="lc-list">
        <LoopList loops={loops} rows={rows} groups={groups} now={now} variant="card" emptyText="No loops yet" onOpenChat={onOpenChat} onToast={onToast} />
      </div>
      <div className="lc-foot">
        <span className="lc-barbox">
          <span><b data-remaining={counts.remaining}>{counts.remaining}</b> remaining</span>
          <span className="lc-track"><i style={{ width: `${counts.total ? (counts.closed / counts.total) * 100 : 0}%` }} /></span>
        </span>
        <button type="button" className="lc-all" data-act="all" onClick={onAll}>All</button>
      </div>
    </div>
  );
}

import React, { useEffect, useRef } from 'react';

// The app's own tooltip, styled by the .tip rule in theme.css. Mounted once
// (by app.tsx) as a single fixed div. Any element anywhere in the tree can
// opt in by setting a data-tip attribute; this component finds it on
// mouseover, waits, then shows a pill centred under it.
//
// Deliberately no React state: a tooltip fires on every pointer move over
// the app, so this uses refs and direct DOM class/style writes instead of
// re-rendering.

const SHOW_DELAY_MS = 350;
const VIEWPORT_MARGIN_PX = 8;

export function Tooltip() {
  const elRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const targetRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const tip = elRef.current;
    if (!tip) return;

    const clearTimer = () => {
      if (timerRef.current !== undefined) {
        window.clearTimeout(timerRef.current);
        timerRef.current = undefined;
      }
    };

    const hide = () => {
      clearTimer();
      targetRef.current = null;
      tip.classList.remove('show');
    };

    const position = (target: HTMLElement) => {
      const text = target.getAttribute('data-tip');
      if (!text) return;
      tip.textContent = text;

      const rect = target.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const top = rect.bottom + 8;

      // Measure after the text is set so tip.offsetWidth reflects the new content.
      const half = tip.offsetWidth / 2;
      const minX = VIEWPORT_MARGIN_PX + half;
      const maxX = window.innerWidth - VIEWPORT_MARGIN_PX - half;
      const clampedX = Math.min(Math.max(centerX, minX), maxX);

      tip.style.left = `${clampedX}px`;
      tip.style.top = `${top}px`;
      tip.classList.add('show');
    };

    const onMouseOver = (e: MouseEvent) => {
      const target = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-tip]');
      if (!target || target === targetRef.current) return;

      clearTimer();
      hide();
      targetRef.current = target;
      timerRef.current = window.setTimeout(() => {
        if (targetRef.current === target) position(target);
      }, SHOW_DELAY_MS);
    };

    const onMouseOut = (e: MouseEvent) => {
      const related = e.relatedTarget as HTMLElement | null;
      if (targetRef.current && related && targetRef.current.contains(related)) return;
      hide();
    };

    document.addEventListener('mouseover', onMouseOver);
    document.addEventListener('mouseout', onMouseOut);
    document.addEventListener('click', hide);
    document.addEventListener('keydown', hide);

    return () => {
      clearTimer();
      document.removeEventListener('mouseover', onMouseOver);
      document.removeEventListener('mouseout', onMouseOut);
      document.removeEventListener('click', hide);
      document.removeEventListener('keydown', hide);
    };
  }, []);

  return <div ref={elRef} className="tip" role="tooltip" />;
}

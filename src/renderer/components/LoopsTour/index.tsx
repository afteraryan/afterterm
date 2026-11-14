// The loops tour (AFT-103, mock docs/mockups/loops-tour.html): one card beside the
// part of the screen it is about, with a ring round that part. The steps, the
// examples and the placement rules are pure in loopsTour.ts; app.tsx turns each
// step into the screen (the view, the examples, the opened loop, the loops card).
//
// Movement, from the mock: on the same view the card and the ring slide to their
// next place; across a change of view they fade, jump and fade in. The sub-loops
// step waits for the loop to finish opening before placing anything. Done swells
// the card and snaps it shut toward the Progress column; Skip ends quietly. Under
// reduced motion every move is a cut.
//
// Everything under the tour is blocked while it shows, so nothing can act on the
// example loops (they exist only in the renderer and never reach main).
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  TOUR_STEPS, TOUR_LENGTH, ringOffset, RING_LENGTH, switchesView, placeCard, ringBox, type Box, type TourStep,
} from '../../loopsTour';
import { LoopsIcon } from '../Loops/LoopIcons';
import { TourArt } from './TourArt';
import './LoopsTour.css';

export interface LoopsTourProps {
  step: number;
  setStep: (n: number) => void;
  remaining: number;              // the loops button's count, drawn in step 6
  subsLoopId: string | null;      // the loop the sub-loops step opens
  rotLoopId: string | null;       // the row the rotting step rings
  onEnd: (how: 'done' | 'skip') => void;
}

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const EASE = 'cubic-bezier(.2,.8,.2,1)';

function boxOf(el: Element | null): Box | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

// The element a step's ring goes round, found in the app's own DOM.
function targetElement(s: TourStep, subsLoopId: string | null, rotLoopId: string | null): Element | null {
  const q = (sel: string) => document.querySelector(sel);
  switch (s.target) {
    case 'list': return q('.prog-col .prog-list');
    case 'rot-row': return (rotLoopId && q(`.prog-col [data-loop="${CSS.escape(rotLoopId)}"]`)) || q('.prog-col .prog-list');
    case 'subs': return (subsLoopId && q(`.prog-col .lp-subs[data-part-of="${CSS.escape(subsLoopId)}"]`)) || q('.prog-col .prog-list');
    case 'calendar': return q('.prog-col [data-calendar]');
    case 'loops-button': {
      const all = Array.from(document.querySelectorAll('.terminal-area [data-loops-button]')).filter((b) => b.getBoundingClientRect().width > 0);
      return all.find((b) => b.closest('.term-col.fcol')) ?? all[0] ?? null;
    }
    default: return null;
  }
}

// Waits until the app shows a view (goScreen can hold a switch back while the
// panel slides shut), then calls back. Gives up after 1.5 s.
function whenScreen(view: 'home' | 'workspace', fn: () => void): () => void {
  let raf = 0;
  const start = performance.now();
  const tick = () => {
    const shown = document.querySelector('.app')?.getAttribute('data-screen');
    if (shown === view || performance.now() - start > 1500) { fn(); return; }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

// After Done: Home gives one small settle and "No loops yet" rises in, once the
// examples have gone (two frames, so React has drawn Home without them).
function settleHome() {
  if (reduced()) return;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.querySelector('.screen-home')?.animate(
      [{ transform: 'scale(.985)' }, { transform: 'scale(1.004)', offset: 0.6 }, { transform: 'none' }],
      { duration: 420, easing: EASE },
    );
    document.querySelector('.prog-col .prog-list > .lp-list > .lp-empty')?.animate(
      [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }],
      { duration: 360, delay: 120, easing: EASE, fill: 'backwards' },
    );
  }));
}

const CHEER_DOTS = ['#4ade80', '#ffffff', '#e8a23a', '#b9f6d0', '#ffffff', '#4ade80', '#e8a23a', '#ffffff', '#b9f6d0', '#4ade80'];
function Cheer() {
  return (
    <span className="tour-cheer" aria-hidden="true">
      {'\u{1F44D}'}
      {CHEER_DOTS.map((c, i) => {
        const a = (i / CHEER_DOTS.length) * Math.PI * 2, d = 58 + (i % 3) * 14;
        return <i key={i} style={{ background: c, ['--dx' as string]: `${Math.round(Math.cos(a) * d)}px`, ['--dy' as string]: `${Math.round(Math.sin(a) * d)}px` }} />;
      })}
    </span>
  );
}

export function LoopsTour({ step, setStep, remaining, subsLoopId, rotLoopId, onEnd }: LoopsTourProps) {
  const s = TOUR_STEPS[step];
  const cardRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLSpanElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const prev = useRef<number | null>(null);
  const timers = useRef<number[]>([]);
  const stopWait = useRef<(() => void) | null>(null);
  const ending = useRef(false);
  const [cheer, setCheer] = useState(false);

  const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); };
  const clearLater = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    stopWait.current?.();
    stopWait.current = null;
  };

  // Puts the ring on the step's target and the card beside it.
  const place = useCallback(() => {
    const card = cardRef.current, ring = ringRef.current, arrow = arrowRef.current;
    const area = boxOf(document.querySelector('.app-main'));
    if (!card || !ring || !arrow || !area) return;
    const st = TOUR_STEPS[step];
    const el = targetElement(st, subsLoopId, rotLoopId);
    // A row or the sub-loops can be below the fold of the Progress list.
    if (el && (st.target === 'rot-row' || st.target === 'subs')) el.scrollIntoView({ block: 'nearest' });
    const target = st.target ? boxOf(el) : null;
    const pane = st.target === 'loops-button' ? boxOf(document.querySelector('.terminal-area')) : null;
    const p = placeCard(target, area, card.offsetHeight, { loopsCard: pane });
    card.style.left = `${p.x}px`;
    card.style.top = `${p.y}px`;
    if (target) {
      const r = ringBox(target, area);
      ring.classList.remove('off');
      ring.style.left = `${r.x}px`; ring.style.top = `${r.y}px`; ring.style.width = `${r.w}px`; ring.style.height = `${r.h}px`;
    } else {
      ring.classList.add('off');
    }
    if (p.arrow) {
      arrow.hidden = false;
      arrow.style.top = `${p.arrow.top}px`;
      arrow.style.left = p.arrow.side === 'left' ? '-7px' : 'auto';
      arrow.style.right = p.arrow.side === 'right' ? '-7px' : 'auto';
    } else {
      arrow.hidden = true;
    }
  }, [step, subsLoopId, rotLoopId]);

  // Each step: fade out first across a change of view, wait for the screen to be
  // ready, place, show, and place once more after the card has its final size.
  useLayoutEffect(() => {
    const card = cardRef.current, ring = ringRef.current;
    if (!card || !ring) return;
    const switching = switchesView(prev.current, step);
    prev.current = step;
    clearLater();
    if (switching) { card.classList.add('jump', 'hidden'); ring.classList.add('jump', 'off'); }
    const show = () => {
      place();
      card.classList.remove('hidden');
      nextRef.current?.focus({ preventScroll: true });
      later(() => { place(); card.classList.remove('jump'); ring.classList.remove('jump'); }, 260);
    };
    if (switching) stopWait.current = whenScreen(s.view, () => { stopWait.current = null; later(show, 340); });
    else later(show, s.target === 'subs' ? 320 : 0);
    setCheer(false);
    if (s.last) later(() => setCheer(true), 420);
    return clearLater;
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onResize = () => place();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [place]);

  const skip = useCallback(() => {
    if (ending.current) return;
    ending.current = true;
    clearLater();
    cardRef.current?.classList.add('hidden');
    ringRef.current?.classList.add('off');
    if (reduced()) onEnd('skip');
    else window.setTimeout(() => onEnd('skip'), 200);
  }, [onEnd]); // eslint-disable-line react-hooks/exhaustive-deps

  // Done: the card swells for a beat, then snaps shut toward the Progress column;
  // the examples go and Home settles.
  const finish = useCallback(() => {
    if (ending.current) return;
    ending.current = true;
    clearLater();
    const card = cardRef.current;
    if (!card || reduced()) { onEnd('done'); return; }
    const cr = card.getBoundingClientRect();
    const pr = document.querySelector('.prog-col')?.getBoundingClientRect();
    const dx = pr ? pr.left + pr.width / 2 - (cr.left + cr.width / 2) : 0;
    const dy = pr ? pr.top + 120 - (cr.top + cr.height / 2) : 0;
    card.classList.add('jump');
    ringRef.current?.classList.add('off');
    const snap = card.animate([
      { transform: 'none', opacity: 1 },
      { transform: 'scale(1.06)', opacity: 1, offset: 0.28 },
      { transform: `translate(${dx}px, ${dy}px) scale(.08)`, opacity: 0 },
    ], { duration: 520, easing: 'cubic-bezier(.5,0,.2,1)', fill: 'forwards' });
    snap.onfinish = () => { onEnd('done'); settleHome(); };
  }, [onEnd]); // eslint-disable-line react-hooks/exhaustive-deps

  const next = useCallback(() => { if (s.last) finish(); else setStep(step + 1); }, [s, step, setStep, finish]);
  const back = useCallback(() => { if (step > 0) setStep(step - 1); }, [step, setStep]);

  // Arrow keys move, Esc is Skip. Taken before anything under the tour sees them.
  // The tour keeps the focus on its Next button (so Enter never reaches a Wake
  // button under it), but draws the focus outline only while it is driven by keys.
  useEffect(() => {
    const onPointer = () => cardRef.current?.classList.remove('kbd');
    const onKey = (e: KeyboardEvent) => {
      if (ending.current) return;
      if (e.key === 'Tab' || e.key === 'Enter' || e.key === ' ' || e.key.startsWith('Arrow')) cardRef.current?.classList.add('kbd');
      if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); back(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); skip(); }
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointer, true);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('pointerdown', onPointer, true); };
  }, [next, back, skip]);

  const theme = s.theme === 'blue' ? '' : ` theme-${s.theme}`;
  return (
    <div className="tour-layer" data-tour="loops" data-tour-step={step + 1}>
      <div className="tour-block" onMouseDown={(e) => e.preventDefault()} />
      <div className={`tour-ring off${s.theme === 'green' ? ' theme-green' : ''}`} ref={ringRef} data-tour-ring="" />
      <div className={`tour-card hidden${theme}`} ref={cardRef} role="dialog" aria-modal="true" aria-label={s.title || 'Loops button'} data-tour-card="">
        <span className="tour-arrow" ref={arrowRef} />
        {s.art && <TourArt key={step} kind={s.art} />}
        <span className="tour-new">New</span>
        {s.title && <h2 className={cheer ? 'with-cheer' : undefined}>{s.title}{cheer && <Cheer />}</h2>}
        {s.keys && (
          <p className="tour-keys">
            Click <span className="tour-kbtn"><LoopsIcon size={20} />{remaining}</span> or press
            <kbd>Ctrl</kbd><span className="plus">+</span><kbd>Shift</kbd><span className="plus">+</span><kbd>L</kbd>
          </p>
        )}
        <div className="tour-foot">
          <span className="tour-n">
            <svg className="tour-pring" width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
              <circle className="track" cx="13" cy="13" r="10" />
              <circle className="fill" cx="13" cy="13" r="10" style={{ strokeDasharray: RING_LENGTH, strokeDashoffset: ringOffset(step) }} />
            </svg>
            <span className="tour-sr">Step {step + 1} of {TOUR_LENGTH}</span>
          </span>
          {step > 0 && <button type="button" className="tour-back" data-tour-act="back" onClick={back}>Back</button>}
          {!s.last && <button type="button" className="tour-skip" data-tour-act="skip" onClick={skip}>Skip</button>}
          <button type="button" className="tour-next" data-tour-act="next" ref={nextRef} onClick={next}>{s.last ? 'Done' : 'Next'}</button>
        </div>
      </div>
    </div>
  );
}

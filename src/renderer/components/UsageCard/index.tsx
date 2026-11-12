// The usage card (AFT-85): a small card in the middle of the window, opened from the gauge at the
// bottom of the rail or with Ctrl+Shift+U. Nothing is read until it opens (main starts a hidden
// Claude Code, see src/usage-reader.ts). Two tabs: Limits (the bars, which arrive first) and
// Breakdown (what is using the limits, which arrives a few seconds later). Designed with Aryan on
// 2026-11-13 against docs/mockups/usage-card.html: no explanatory text anywhere, a skeleton on
// every read (a refresh included: main clears the old numbers when a read starts), and motion on the
// resize, the tab change and the values arriving.
//
// The card keeps its elements in place (no rebuild per update), so the height, the tab highlight and
// the bars can animate between states instead of jumping.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { UsageState } from '../../../usage-screen';
import { IconRestart, IconX } from '../Icons';
import { breakdownPhase, failText, isBigNumber, isReading, limitTone, limitsPhase } from '../../usageView';
import './UsageCard.css';

type TabId = 'limits' | 'breakdown';
const CLOSE_MS = 170;

/** The grey block shown in place of a value that has not arrived. */
function Sk({ w, h }: { w: number; h?: number }) {
  return <i className="u-sk" style={{ width: w, height: h }} />;
}

/** A bar that grows from empty when it first appears, then follows the value. */
function Bar({ percent, index }: { percent: number; index: number }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let b = 0;
    const a = requestAnimationFrame(() => { b = requestAnimationFrame(() => setOn(true)); });
    return () => { cancelAnimationFrame(a); cancelAnimationFrame(b); };
  }, []);
  return (
    <div className="u-trk">
      <div
        className={'u-fill ' + limitTone(percent)}
        style={{ width: on ? `${percent}%` : '0%', transitionDelay: `${index * 90}ms` }}
      />
    </div>
  );
}

function LimitsPane({ s }: { s: UsageState | null }) {
  const phase = limitsPhase(s);
  if (phase === 'failed') return <p className="u-fail">{failText(s?.error ?? null)}</p>;
  if (phase === 'skeleton') {
    return (
      <>
        {[0, 1, 2].map(i => (
          <div className="u-row" key={i}>
            <div><Sk w={110} /><span className="u-sub"><Sk w={96} h={9} /></span></div>
            <div className="u-trk" />
            <div className="u-pct"><Sk w={46} /></div>
          </div>
        ))}
      </>
    );
  }
  return (
    <>
      {s!.usage!.limits.map((l, i) => (
        <div className="u-row" key={l.id} data-limit={l.id}>
          <div>
            <span className="u-name">{l.label}</span>
            <span className="u-sub u-rv" style={{ animationDelay: `${i * 80}ms` }}>{l.reset}</span>
          </div>
          <Bar percent={l.percent} index={i} />
          <div className="u-pct u-rv" style={{ animationDelay: `${i * 80 + 60}ms` }}>{l.percent}% used</div>
        </div>
      ))}
    </>
  );
}

function BreakdownPane({ s }: { s: UsageState | null }) {
  const phase = breakdownPhase(s);
  if (phase === 'none') return null;
  if (phase === 'skeleton') {
    return (
      <div className="u-bd">
        <div className="u-hd"><Sk w={190} h={12} /></div>
        {[230, 200, 215, 180, 240].map((w, i) => (
          <div className="u-tp" key={i}><span className="u-n"><Sk w={30} /></span><span><Sk w={w} /></span></div>
        ))}
        <div className="u-lists">
          {[0, 1, 2].map(i => (
            <div key={i}>
              <div className="u-tt"><Sk w={70} /></div>
              {[100, 84, 92].map((w, j) => <div className="u-li" key={j}><Sk w={w} /><Sk w={22} /></div>)}
            </div>
          ))}
        </div>
      </div>
    );
  }
  const b = s!.usage!.breakdown!;
  return (
    <div className="u-bd">
      <div className="u-hd u-rv">Contributing to your usage</div>
      {b.tips.map((t, i) => (
        <div className="u-tp u-rv" key={i} style={{ animationDelay: `${60 + i * 55}ms` }}>
          <span className={'u-n' + (isBigNumber(t.percent) ? ' hi' : '')}>{t.percent}%</span>
          <span>{t.text}</span>
        </div>
      ))}
      {b.groups.length > 0 && (
        <div className="u-lists">
          {b.groups.map((g, j) => (
            <div className="u-rv" key={g.title} style={{ animationDelay: `${360 + j * 90}ms` }}>
              <div className="u-tt">{g.title}</div>
              {g.items.map(it => (
                <div className="u-li" key={it.name}>
                  <span>{it.name}</span>
                  <span className={'u-n' + (isBigNumber(it.percent) ? ' hi' : '')}>{it.percent}%</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function UsageCard({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<UsageState | null>(null);
  const [tab, setTab] = useState<TabId>('limits');
  const [closing, setClosing] = useState(false);
  const [height, setHeight] = useState<number | null>(null);
  const [still, setStill] = useState(true);
  const cardRef = useRef<HTMLDivElement>(null);
  const limitsRef = useRef<HTMLDivElement>(null);
  const breakdownRef = useRef<HTMLDivElement>(null);
  const segRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const closingRef = useRef(false);

  // Read on open and listen. The first call starts the hidden Claude Code (or answers from the
  // one-minute cache); main then pushes every change.
  useEffect(() => {
    const off = window.afterterm.usage.onUpdate(setS);
    void window.afterterm.usage.read(false).then(setS);
    return off;
  }, []);

  const requestClose = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    window.setTimeout(onClose, CLOSE_MS);
  };

  // Escape closes; so does the shortcut again (app.tsx sends this event while the card is open).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); requestClose(); } };
    const onToggle = () => requestClose();
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('usage:close', onToggle);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('usage:close', onToggle); };
  }, []);

  // Focus moves into the card so Escape works, and goes back to where it was on close.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    cardRef.current?.focus({ preventScroll: true });
    return () => { prev?.focus?.({ preventScroll: true }); };
  }, []);

  // The card's height follows the visible pane, including while its content changes (a skeleton
  // becoming rows), so the resize is one smooth motion. The first measurement is not animated.
  useLayoutEffect(() => {
    const measure = () => {
      const pane = tab === 'limits' ? limitsRef.current : breakdownRef.current;
      if (pane) setHeight(pane.offsetHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (limitsRef.current) ro.observe(limitsRef.current);
    if (breakdownRef.current) ro.observe(breakdownRef.current);
    return () => ro.disconnect();
  }, [tab]);
  useEffect(() => {
    if (height === null) return;
    const a = requestAnimationFrame(() => requestAnimationFrame(() => setStill(false)));
    return () => cancelAnimationFrame(a);
  }, [height === null]);

  // The tab highlight slides under the chosen tab.
  useLayoutEffect(() => {
    const seg = segRef.current, th = thumbRef.current;
    const btn = seg?.querySelector<HTMLElement>(`[data-tab="${tab}"]`);
    if (!seg || !th || !btn) return;
    th.style.width = `${btn.offsetWidth}px`;
    th.style.transform = `translateX(${btn.offsetLeft}px)`;
  }, [tab]);

  const reading = isReading(s);
  const refresh = () => { if (!reading) void window.afterterm.usage.read(true).then(setS); };

  return (
    <div className={'modal-overlay u-scrim' + (closing ? ' out' : '')} data-usage-card="" onMouseDown={requestClose}>
      <div
        ref={cardRef}
        className="u-card"
        role="dialog"
        aria-label="Usage"
        tabIndex={-1}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="u-head">
          <h2>Usage</h2>
          <div className="u-seg" role="tablist" ref={segRef}>
            <span className="u-th" ref={thumbRef} />
            <button role="tab" data-tab="limits" aria-selected={tab === 'limits'} className={tab === 'limits' ? 'on' : ''} onClick={() => setTab('limits')}>Limits</button>
            <button role="tab" data-tab="breakdown" aria-selected={tab === 'breakdown'} className={tab === 'breakdown' ? 'on' : ''} onClick={() => setTab('breakdown')}>Breakdown</button>
          </div>
          <button className={'u-ib' + (reading ? ' u-reading' : '')} data-tip="Refresh" aria-label="Refresh" data-usage-refresh="" onClick={refresh}>
            <IconRestart size={15} />
          </button>
          <button className="u-ib" data-tip="Close" aria-label="Close" data-usage-close="" onClick={requestClose}>
            <IconX size={15} />
          </button>
        </div>
        <div className={'u-body' + (still ? ' still' : '')} style={height === null ? undefined : { height }}>
          <div className={'u-pane limits' + (tab === 'limits' ? ' on' : '')} ref={limitsRef} data-pane="limits"><LimitsPane s={s} /></div>
          <div className={'u-pane breakdown' + (tab === 'breakdown' ? ' on' : '')} ref={breakdownRef} data-pane="breakdown"><BreakdownPane s={s} /></div>
        </div>
      </div>
    </div>
  );
}

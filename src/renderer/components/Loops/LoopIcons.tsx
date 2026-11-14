// The icons loops use (design-07, "Icons"), drawn from the mocks' own paths:
// the label icons (box, bug, bulb), the three status circles, the clocks, the
// loops icon (two overlapping circles), the filter and the Progress close icon.
import React from 'react';
import type { LoopLabel, LoopStatus } from '../../../loops';

const LABEL_PATHS: Record<LoopLabel, React.ReactNode> = {
  feature: <><path d="M2 4.5L7 2l5 2.5v5L7 12 2 9.5z" /><path d="M2 4.5L7 7l5-2.5M7 7v5" /></>,
  bug: <><rect x="4" y="4" width="6" height="8" rx="3" /><path d="M2 6h2M10 6h2M2 10h2M10 10h2M5 3l1 1M9 3L8 4" /></>,
  idea: <path d="M5 10.5h4M5.5 12.5h3M7 1.5a4 4 0 0 0-2.3 7.3c.3.2.3.5.3.7v1h4v-1c0-.2 0-.5.3-.7A4 4 0 0 0 7 1.5z" />,
};

export function LabelIcon({ label, size = 12 }: { label: LoopLabel; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {LABEL_PATHS[label]}
    </svg>
  );
}

export function StatusIcon({ status }: { status: LoopStatus }) {
  if (status === 'closed') {
    return (
      <span className="lp-st"><span className="lp-st-closed">
        <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M2 5.2l2 2L8 3" /></svg>
      </span></span>
    );
  }
  if (status === 'rotting') {
    return (
      <span className="lp-st"><span className="lp-st-rot">
        <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round"><path d="M5 2.4v2.8l1.7 1" /></svg>
      </span></span>
    );
  }
  return <span className="lp-st"><span className="lp-st-open" /></span>;
}

export function ClockIcon({ size = 11, strokeWidth = 1.5 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" aria-hidden="true">
      <circle cx="7" cy="7" r="5.5" /><path d="M7 4v3.2l2 1.3" />
    </svg>
  );
}

export function LoopsIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden="true">
      <circle cx="5.5" cy="8" r="3.5" /><circle cx="10.5" cy="8" r="3.5" />
    </svg>
  );
}

export function ChevronRight({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3.5 2l3 3-3 3" /></svg>
  );
}

export function ChevronLeft({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6.5 2l-3 3 3 3" /></svg>
  );
}

export function ChevronDown({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 3.5l3 3 3-3" /></svg>
  );
}

export function SmallX({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden="true"><path d="M2.5 2.5l5 5M7.5 2.5l-5 5" /></svg>
  );
}

export function FilterIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden="true"><path d="M2 3.5h10M4 7h6M6 10.5h2" /></svg>
  );
}

export function PanelCloseIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="2" /><path d="M10 3v10M6 6.5L7.5 8 6 9.5" />
    </svg>
  );
}

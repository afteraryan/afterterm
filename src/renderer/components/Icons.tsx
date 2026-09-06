// Icon set for the projects-and-threads redesign. Every path is copied verbatim
// from docs/mockups/afterterm-next.html (the symbol sheet), docs/mockups/state-icons.html
// (sheet A, "solid glyphs", final) and docs/mockups/toasts.html (hourglass, compacting, x).
// Each icon is a plain inline SVG using currentColor so it inherits the caller's color.
import React from 'react';
import { GroupColor, GROUP_COLORS } from './TabBar/types';

export interface IconProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

function svgProps({ size = 16, className, style }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    'aria-hidden': true as const,
    className,
    style,
  };
}

export function IconHome(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

export function IconTerm(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <rect x="3" y="5" width="18" height="14" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="m7 9 3 3-3 3M12 15h5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconPanel(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <rect x="3" y="4" width="18" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9 4v16" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export function IconPin(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M15 3h-6l1 2v5.5L7 13v2h4v6h2v-6h4v-2l-3-2.5V5z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

export function IconPinOn(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M15 3h-6l1 2v5.5L7 13v2h4v6h2v-6h4v-2l-3-2.5V5z" fill="currentColor" />
    </svg>
  );
}

export function IconArrow(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M7 17 17 7M9 7h8v8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="m16 16 4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function IconMore(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <circle cx="6" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <circle cx="18" cy="12" r="1.6" fill="currentColor" />
    </svg>
  );
}

export function IconMenu(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function IconChevR(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconChevL(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="m15 6-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconChevD(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="m5.5 12.5 4 4 9-9" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconBell(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M12 3a6 6 0 0 0-6 6v3.6L4.4 15.5A1 1 0 0 0 5.2 17h13.6a1 1 0 0 0 .8-1.5L18 12.6V9a6 6 0 0 0-6-6z" fill="currentColor" />
      <path d="M9.5 19a2.5 2.5 0 0 0 5 0z" fill="currentColor" />
    </svg>
  );
}

export function IconPlay(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M8.5 5.9c0-1.1 1.2-1.8 2.1-1.2l8.4 5.9c.9.6.9 1.9 0 2.5l-8.4 5.9c-.9.6-2.1 0-2.1-1.2z" fill="currentColor" />
    </svg>
  );
}

export function IconMoon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7z" fill="currentColor" />
    </svg>
  );
}

export function IconModel(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M12 3.5c.6 3.8 2.7 5.9 6.5 6.5-3.8.6-5.9 2.7-6.5 6.5-.6-3.8-2.7-5.9-6.5-6.5 3.8-.6 5.9-2.7 6.5-6.5zM18.5 14.5c.3 1.7 1.2 2.6 2.9 2.9-1.7.3-2.6 1.2-2.9 2.9-.3-1.7-1.2-2.6-2.9-2.9 1.7-.3 2.6-1.2 2.9-2.9z" fill="currentColor" />
    </svg>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function IconFolder(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M2.5 7A2 2 0 0 1 4.5 5h4.6l2 2h8.4a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2z" fill="currentColor" />
      <path d="M2.5 9.5h19" stroke="rgba(0,0,0,.28)" strokeWidth="1.2" />
    </svg>
  );
}

export function IconFolderOpen(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M2.5 7A2 2 0 0 1 4.5 5h4.6l2 2h7.4a2 2 0 0 1 2 2v1.5H6.6a2 2 0 0 0-1.9 1.4L2.5 17z" fill="currentColor" fillOpacity=".72" />
      <path d="M2.6 18.2 5 11.9a1.5 1.5 0 0 1 1.4-1H22l-2.7 7.1a2 2 0 0 1-1.9 1.3H4.3a1.8 1.8 0 0 1-1.7-2.1z" fill="currentColor" />
    </svg>
  );
}

export function IconPage(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M2.5 7A2 2 0 0 1 4.5 5h4.6l2 2h8.4a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="m10.6 10.35 2.9 2.9-2.9 2.9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconChat(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V17H6.5A2.5 2.5 0 0 1 4 14.5z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

export function IconShell(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="m5 7 5 5-5 5M12 17h7" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconBranch(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <circle cx="6" cy="5" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="6" cy="19" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="18" cy="8" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M6 7.2v9.6M18 10.2c0 3.3-3 4.3-6 4.8-2.6.4-6 1-6 1.8" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function IconWorktree(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M9 11.5v5M9 11.5c0 2.5 2.5 2.5 5.5 2.5M14.5 12v4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="9" cy="11.5" r="1.1" fill="currentColor" />
      <circle cx="14.5" cy="12" r="1.1" fill="currentColor" />
    </svg>
  );
}

export function IconX(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

export function IconHourglass(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M6.5 3.5h11v2.2c0 1.6-.7 3.1-1.9 4.1L13.4 12l2.2 2.2a5.5 5.5 0 0 1 1.9 4.1v2.2h-11v-2.2c0-1.6.7-3.1 1.9-4.1L10.6 12 8.4 9.8A5.5 5.5 0 0 1 6.5 5.7z" fill="currentColor" />
    </svg>
  );
}

// The compacting icon: three lines pressing into one, with a chevron-down underneath.
// This is symbol "c2" in docs/mockups/toasts.html, not the "compact" symbol.
export function IconCompact(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <rect x="4" y="3.5" width="16" height="3.2" rx="1.6" fill="currentColor" fillOpacity=".45" />
      <rect x="4" y="8.4" width="16" height="3.2" rx="1.6" fill="currentColor" fillOpacity=".7" />
      <rect x="4" y="13.3" width="16" height="3.2" rx="1.6" fill="currentColor" />
      <path d="m9 19.5 3 2.5 3-2.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Composed icon widgets ──────────────────────────────────────────────────

export interface FolderIconProps {
  color?: GroupColor;
  open?: boolean;
  size?: number;
}

// A project's folder glyph, coloured by its group colour, or var(--text3) for
// projectless (General) rows.
export function FolderIcon({ color, open, size = 18 }: FolderIconProps) {
  const tint = color ? GROUP_COLORS[color].border : 'var(--text3)';
  return (
    <span className="fo" style={{ color: tint }}>
      {open ? <IconFolderOpen size={size} /> : <IconFolder size={size} />}
    </span>
  );
}

export interface SpinnerProps {
  size?: number;
}

// The theme's spinning-ring indicator (class .spin, keyframes rot, from theme.css).
export function Spinner({ size = 10 }: SpinnerProps) {
  return <span className="spin" style={{ width: size, height: size }} />;
}

// The thread state and kind unions live in threadView.ts (pure, unit-tested);
// re-exported here so components can import icons and types from one place.
export type { ThreadState, ThreadKind } from '../threadView';
import type { ThreadState, ThreadKind } from '../threadView';

export interface StateIconProps {
  state: ThreadState;
  size?: number;
}

// The single icon that drives the header chip, the right end of every thread
// row, the project page lists and the project counters. Sheet A ("solid
// glyphs") in docs/mockups/state-icons.html is final.
export function StateIcon({ state, size = 15 }: StateIconProps) {
  switch (state) {
    case 'needs-you':
      return (
        <span className="si need" data-state={state}>
          <IconBell size={size} />
        </span>
      );
    case 'working':
    case 'compacting':
    case 'background':
      // Working, compacting and background all read as "something is
      // happening but there is nothing to act on": the same grey spinner.
      return (
        <span data-state={state}>
          <Spinner size={size} />
        </span>
      );
    case 'running':
      return (
        <span className="si run" data-state={state}>
          <IconPlay size={size - 1} />
        </span>
      );
    case 'done':
      return (
        <span className="si ok" data-state={state}>
          <IconCheck size={size} />
        </span>
      );
    case 'asleep':
      return (
        <span className="si sleep" data-state={state}>
          <IconMoon size={size} />
        </span>
      );
    case 'quiet':
      return null;
  }
}

export interface KindIconProps {
  kind: ThreadKind;
  size?: number;
}

// The chat-bubble or shell-prompt glyph shown before a thread's name.
export function KindIcon({ kind, size = 15 }: KindIconProps) {
  return (
    <span className="ki">
      {kind === 'chat' ? <IconChat size={size} /> : <IconShell size={size} />}
    </span>
  );
}

// "Updated to 0.11.0", the short note after an update restart
// (docs/design-05-automatic-updates.md, mockup question 6): the in-app toast's
// pill at the bottom centre, a What's new button, and a small round x on the
// pill's top-right corner, outside the pill. It goes by itself after a few
// seconds; the pointer on it holds it.
import React, { useEffect, useRef, useState } from 'react';
import { IconX } from '../Icons';
import './UpdatedPill.css';

const SHOW_MS = 6000;

export interface UpdatedPillProps {
  version: string;
  // Absent when the release had no notes to show.
  onWhatsNew?: () => void;
  onDone: () => void;
}

export function UpdatedPill({ version, onWhatsNew, onDone }: UpdatedPillProps) {
  const [hovered, setHovered] = useState(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (hovered) return;
    const t = setTimeout(() => onDoneRef.current(), SHOW_MS);
    return () => clearTimeout(t);
  }, [hovered]);

  return (
    <div
      className="up-pill"
      role="status"
      data-updated-pill=""
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span>Updated to {version}</span>
      {onWhatsNew && <button type="button" onClick={() => { onWhatsNew(); onDone(); }}>What's new</button>}
      <button type="button" className="tx" aria-label="Close" data-tip="Close" onClick={onDone}><IconX size={14} /></button>
    </div>
  );
}

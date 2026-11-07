// The window the update pieces open over the app (docs/design-05-automatic-updates.md):
// the restart window, the About window and What's new all sit in this frame. It
// uses the app's modal-overlay (so the harness's `screen` command reports a
// dialog) and the mockup's .dlg card, and it closes the way the mockup does:
// the card fades and sinks out over 170ms, then the caller unmounts it.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { UpdateNotes } from '../UpdateNotes';
import './UpdateDialog.css';

const CLOSE_MS = 170;

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export interface UpdateDialogProps {
  onClose: () => void;
  // The restart window asks a question, so a click beside it does not answer it.
  closeOnScrim?: boolean;
  className?: string;
  label: string;
  children: (close: () => void) => React.ReactNode;
}

export function UpdateDialog({ onClose, closeOnScrim = true, className, label, children }: UpdateDialogProps) {
  const [closing, setClosing] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = useCallback(() => {
    if (timer.current) return;
    if (reducedMotion()) { onCloseRef.current(); return; }
    setClosing(true);
    timer.current = setTimeout(() => onCloseRef.current(), CLOSE_MS);
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [close]);

  return (
    <div
      className={`modal-overlay up-scrim${closing ? ' out' : ''}`}
      onMouseDown={e => { if (closeOnScrim && e.target === e.currentTarget) close(); }}
    >
      <div className={`up-dlg${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true" aria-label={label}>
        {children(close)}
      </div>
    </div>
  );
}

// "What's new in afterterm 0.11.0": the notes in a window over the app, opened
// from the "Updated to" pill after an update restart.
export function WhatsNewDialog({ version, notes, onClose }: { version: string; notes: string; onClose: () => void }) {
  return (
    <UpdateDialog onClose={onClose} label={`What's new in afterterm ${version}`} className="up-whatsnew">
      {close => (
        <>
          <h2>What's new in afterterm {version}</h2>
          <div className="up-dlg-notes"><UpdateNotes markdown={notes} /></div>
          <div className="up-dbtns"><button className="b p s" autoFocus onClick={close}>Close</button></div>
        </>
      )}
    </UpdateDialog>
  );
}

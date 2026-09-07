// A small yes/no confirmation dialog, generic enough for any "are you sure"
// moment. Phase 5's first caller is closing a thread that owns a listening
// port (threadView.needsCloseConfirm / closeConfirmText), but nothing here
// knows about servers: the caller supplies every string.
//
// Markup mirrors GroupModal's overlay and card (modal-overlay / modal-card) so
// the harness's `screen` command, which already looks for that overlay class
// to report `dialog: true`, finds this one too without any changes there.
import React, { useEffect, useRef } from 'react';
import './ConfirmDialog.css';

export interface ConfirmDialogProps {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title, body, confirmLabel, cancelLabel, danger, onConfirm, onCancel,
}: ConfirmDialogProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  // Enter confirms, Escape cancels, as long as focus is somewhere inside the
  // card (the same "don't steal a keystroke meant for something else" rule
  // GroupModal and AsleepPane already follow).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!cardRef.current?.contains(document.activeElement)) return;
      if (e.key === 'Enter') { e.preventDefault(); onConfirm(); }
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onConfirm, onCancel]);

  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div
        ref={cardRef}
        className="modal-card confirm-card"
        data-confirm-dialog
        role="dialog"
        aria-modal="true"
        onMouseDown={e => e.stopPropagation()}
      >
        <h2 className="modal-title">{title}</h2>
        <p className="confirm-body">{body}</p>
        <div className="confirm-actions">
          <button type="button" className="b q" data-cancel onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? 'b danger' : 'b p'}
            data-confirm
            autoFocus
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

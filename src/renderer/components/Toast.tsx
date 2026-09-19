// The in-app transient pill at the bottom centre of the window (mock .toast):
// "Pinned aftertales", "Archived spotify-taskbar-player", and so on. This is
// NOT the always-on-top overlay notifier (NotifierApp.tsx) that surfaces
// Claude Code hook events across every app; it only ever shows while
// afterterm itself has focus, for a small local action the user just took.
//
// The caller owns whether a toast is mounted at all (there is no internal
// "hidden" state): render <Toast/> when there is something to say, and let
// onDone tell the caller to stop rendering it, on the auto-hide timer or on
// the action button.
import React, { useEffect, useRef } from 'react';
import './Toast.css';

export interface ToastProps {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDone: () => void;
}

const AUTO_HIDE_MS = 2200;
const AUTO_HIDE_WITH_ACTION_MS = 6000;

export function Toast({ message, actionLabel, onAction, onDone }: ToastProps) {
  // Read the latest onDone from a ref rather than the effect's closure, so the
  // timer isn't restarted just because the caller passed a fresh function
  // identity on a re-render with the same message.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const delay = actionLabel ? AUTO_HIDE_WITH_ACTION_MS : AUTO_HIDE_MS;
    const timer = window.setTimeout(() => onDoneRef.current(), delay);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message, actionLabel]);

  return (
    <div className="app-toast" role="status">
      <span className="app-toast-msg">{message}</span>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={() => { onAction(); onDone(); }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

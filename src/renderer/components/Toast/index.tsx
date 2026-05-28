import React, { useEffect } from 'react';
import { TabNotification } from '../TabBar/types';
import './Toast.css';

export interface ToastItem {
  id: string;
  tabId: string;
  type: TabNotification;
  projectName: string;
  message: string;
}

const TOAST_META: Record<TabNotification, { icon: string; color: string; duration: number }> = {
  done:       { icon: '✅', color: '#46b464', duration: 4000 },
  attention:  { icon: '⚠',  color: '#d28c32', duration: 0 },
  background: { icon: '⏳', color: '#d28c32', duration: 5000 },
  compacting: { icon: '⚙',  color: '#666',    duration: 4000 },
};

interface SingleToastProps {
  toast: ToastItem;
  onDismiss: (id: string) => void;
  onClickTab: (tabId: string) => void;
}

function SingleToast({ toast, onDismiss, onClickTab }: SingleToastProps) {
  const meta = TOAST_META[toast.type];

  useEffect(() => {
    if (!meta.duration) return;
    const t = setTimeout(() => onDismiss(toast.id), meta.duration);
    return () => clearTimeout(t);
  }, [toast.id, meta.duration, onDismiss]);

  return (
    <div
      className="toast-item"
      style={{ '--toast-color': meta.color } as React.CSSProperties}
      onClick={() => { onClickTab(toast.tabId); onDismiss(toast.id); }}
    >
      <span className="toast-icon">{meta.icon}</span>
      <div className="toast-body">
        <span className="toast-project">{toast.projectName}</span>
        <span className="toast-message">{toast.message}</span>
      </div>
      <button
        className="toast-close"
        onClick={e => { e.stopPropagation(); onDismiss(toast.id); }}
      >
        ×
      </button>
    </div>
  );
}

interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
  onClickTab: (tabId: string) => void;
}

export function ToastContainer({ toasts, onDismiss, onClickTab }: ToastContainerProps) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <SingleToast key={t.id} toast={t} onDismiss={onDismiss} onClickTab={onClickTab} />
      ))}
    </div>
  );
}

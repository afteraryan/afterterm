import React, { useState, useEffect, useCallback } from 'react';
import './NotifierApp.css';

export type NotifType = 'done' | 'attention' | 'background' | 'compacting';

export interface NotifierToast {
  id: string;
  tabId: string;
  type: NotifType;
  primaryLabel: string;
  secondaryLabel?: string;
  message: string;
}

const TYPE_META: Record<NotifType, { icon: string; color: string }> = {
  done:       { icon: '✅', color: '#46b464' },
  attention:  { icon: '⚠',  color: '#d28c32' },
  background: { icon: '⏳', color: '#d28c32' },
  compacting: { icon: '⚙',  color: '#888'    },
};

interface ToastCardProps {
  toast: NotifierToast;
  onDismiss: (id: string) => void;
}

function ToastCard({ toast, onDismiss }: ToastCardProps) {
  const meta = TYPE_META[toast.type];

  const handleClick = () => {
    window.afterterm.notifier.clickTab(toast.tabId);
    onDismiss(toast.id);
  };

  return (
    <div
      className="notif-card"
      style={{ '--notif-color': meta.color } as React.CSSProperties}
      onClick={handleClick}
    >
      <span className="notif-icon">{meta.icon}</span>
      <div className="notif-body">
        <span className="notif-primary">{toast.primaryLabel}</span>
        <span className="notif-sub">
          {toast.secondaryLabel ? `${toast.secondaryLabel} · ${toast.message}` : toast.message}
        </span>
      </div>
      <button
        className="notif-dismiss"
        onClick={e => { e.stopPropagation(); onDismiss(toast.id); }}
        title="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

export function NotifierApp() {
  const [toasts, setToasts] = useState<NotifierToast[]>([]);

  // Force transparent background — index.css sets body to #141414
  // Clear title so Windows 11 snap tooltip doesn't show "afterterm"
  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    document.title = '';
  }, []);

  useEffect(() => {
    window.afterterm.notifier.onPush((toast) => {
      setToasts(prev => {
        const without = prev.filter(t => t.tabId !== toast.tabId);
        return [...without, toast];
      });
    });
    window.afterterm.notifier.onDismissTab((tabId) => {
      setToasts(prev => prev.filter(t => t.tabId !== tabId));
    });
  }, []);

  // Hide window entirely when no toasts — prevents WM_NCACTIVATE white bar artifact
  // Show is triggered from main (showInactive) when a toast is pushed
  useEffect(() => {
    if (toasts.length === 0) {
      window.afterterm.notifier.hide();
    } else {
      window.afterterm.notifier.setIgnoreMouse(false);
    }
  }, [toasts.length]);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <div className="notifier-root">
      {toasts.map(t => (
        <ToastCard key={t.id} toast={t} onDismiss={dismiss} />
      ))}
    </div>
  );
}

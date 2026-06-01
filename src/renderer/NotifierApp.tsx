import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  const rootRef = useRef<HTMLDivElement>(null);
  const ignoringRef = useRef(true);

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

  // Report the toast stack's exact pixel height to main so the window can size
  // itself to fit. ResizeObserver catches every change — toasts added/removed,
  // text reflow, async font load — keeping the window flush with its content.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const report = () => window.afterterm.notifier.resize(el.getBoundingClientRect().height);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Hide the window when there are no toasts (nothing to show, nothing for DWM to
  // paint a bar over). Showing is triggered from main (showInactive) on push.
  useEffect(() => {
    if (toasts.length === 0) window.afterterm.notifier.hide();
  }, [toasts.length]);

  // Per-region click-through: the window starts mouse-transparent (forward:true),
  // so we still receive move events. Flip interactivity on only while the cursor
  // is over an actual toast card — everywhere else, clicks pass to the app behind.
  useEffect(() => {
    const setIgnore = (ignore: boolean) => {
      if (ignoringRef.current === ignore) return;
      ignoringRef.current = ignore;
      window.afterterm.notifier.setIgnoreMouse(ignore);
    };
    const onMove = (e: MouseEvent) => {
      const overCard = !!(e.target as HTMLElement | null)?.closest?.('.notif-card');
      setIgnore(!overCard);
    };
    const onLeave = () => setIgnore(true);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseleave', onLeave);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <div className="notifier-root" ref={rootRef}>
      {toasts.map(t => (
        <ToastCard key={t.id} toast={t} onDismiss={dismiss} />
      ))}
    </div>
  );
}

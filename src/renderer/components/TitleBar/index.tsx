// The window's title bar strip (Phase 1.1): a 32px row across the full width,
// darker than every surface below it, holding "afterterm" and the version
// badge on the left. The OS draws the caption buttons on the right through
// titleBarOverlay (see main.ts createWindow). It sits above every screen and
// nothing else ever shares its row, so nothing can collide with those
// buttons. It is the window's only drag region. See "Workspace" -> "Title
// bar" in docs/design-02-projects-and-threads.md and docs/phases-01-projects-and-threads.md Phase 1.1.
//
// Automatic updates (docs/design-05-automatic-updates.md, mockup question 1):
// the version badge is a button that opens the About window, and beside it an
// "Update available" button opens the notice under it. While the installer
// downloads the button shows a small bar and the percentage; once it is ready
// it turns into a white "Restart to update" that opens the restart window.
// Nothing here opens by itself, except the notice when Restart to update could
// not go ahead (the reason is one short line in it).
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './TitleBar.css';
import { titleBarButtonShows, percent, megabytes, errorText } from '../../../update-check';
import type { UpdateState } from '../../../update-check';
import { IconChevD, IconChevR, IconDownload, IconRestart } from '../Icons';
import { UpdateNotes, hasNotes } from '../UpdateNotes';

export interface TitleBarProps {
  update: UpdateState;
  onOpenAbout: () => void;
  onRestart: () => void;
}

export function TitleBar({ update, onOpenAbout, onRestart }: TitleBarProps) {
  const [open, setOpen] = useState(false);
  const [folded, setFolded] = useState(false);
  const [left, setLeft] = useState(150);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const shows = titleBarButtonShows(update);

  useEffect(() => { if (!shows) setOpen(false); }, [shows]);
  useEffect(() => { if (!open) setFolded(false); }, [open]);

  // Restart to update that could not go ahead says why in the notice.
  useEffect(() => {
    if (update.error === 'not-installed' || update.error === 'setup') setOpen(true);
  }, [update.error]);

  useLayoutEffect(() => {
    if (open && btnRef.current) setLeft(Math.max(8, btnRef.current.getBoundingClientRect().left - 2));
  }, [open]);

  // A click anywhere else closes the notice, and so does Escape.
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', down);
    window.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); window.removeEventListener('keydown', key); };
  }, [open]);

  const r = update.release;
  const pct = r ? percent(update.received, r.size) : 0;

  let button: React.ReactNode = null;
  if (shows && r) {
    if (update.phase === 'downloading') {
      button = (
        <button ref={btnRef} className="up-btn dl" data-update-button="downloading" onClick={() => setOpen(o => !o)}>
          <span className="mbar"><i style={{ width: `${pct}%` }} /></span>
          Downloading {pct}%
        </button>
      );
    } else if (update.phase === 'ready') {
      button = (
        <button ref={btnRef} className="up-btn ready" data-update-button="ready" onClick={() => { setOpen(false); onRestart(); }}>
          <IconRestart size={12} />Restart to update
        </button>
      );
    } else {
      button = (
        <button ref={btnRef} className="up-btn" data-update-button="available" onClick={() => setOpen(o => !o)}>
          <span className="gd" />Update available
        </button>
      );
    }
  }

  const err = errorText(update.error);
  let notice: React.ReactNode = null;
  if (open && r) {
    if (update.phase === 'downloading') {
      notice = (
        <div className="up-notice">
          <div className="nh">
            <span className="nicon"><IconDownload size={18} /></span>
            <div><div className="ntt">Downloading afterterm {r.version}</div><div className="nsub">You can keep working while it downloads.</div></div>
          </div>
          <div>
            <div className="up-bar"><i style={{ width: `${pct}%` }} /></div>
            <div className="up-barline"><span>{megabytes(update.received, r.size)}</span><span>{pct}%</span></div>
          </div>
          <div className="nb"><button className="b q s" onClick={() => window.afterterm.update.cancel()}>Cancel</button></div>
        </div>
      );
    } else if (update.phase === 'ready') {
      notice = (
        <div className="up-notice">
          <div className="nh">
            <span className="nicon"><IconRestart size={18} /></span>
            <div><div className="ntt">afterterm {r.version} is ready to install</div><div className="nsub">Downloaded and checked.</div></div>
          </div>
          {err ? <div className="up-err">{err}</div> : <div className="np">Restart afterterm to finish.</div>}
          <div className="nb">
            <button className="b p s" onClick={() => { setOpen(false); onRestart(); }}>Restart to update</button>
            <button className="b q s" onClick={() => setOpen(false)}>Later</button>
          </div>
        </div>
      );
    } else {
      const retry = update.error === 'checksum' || update.error === 'network';
      notice = (
        <div className="up-notice">
          <div className="nh">
            <span className="nicon"><IconDownload size={18} /></span>
            <div><div className="ntt">afterterm {r.version} is available</div><div className="nsub">You have {update.current}.</div></div>
          </div>
          {err && <div className="up-err">{err}</div>}
          {hasNotes(r.notes) && (
            <>
              <button className="up-wn" data-whats-new="" onClick={() => setFolded(f => !f)}>
                What's new {folded ? <IconChevD size={14} /> : <IconChevR size={14} />}
              </button>
              {folded && <UpdateNotes markdown={r.notes} fold />}
            </>
          )}
          <div className="nb">
            <button className="b p s" onClick={() => { setOpen(false); window.afterterm.update.download(); }}>{retry ? 'Try again' : 'Update'}</button>
            <button className="b q s" onClick={() => { setOpen(false); window.afterterm.update.later(); }}>Later</button>
            <button className="b q s" onClick={() => { setOpen(false); window.afterterm.update.skip(); }}>Skip this version</button>
          </div>
        </div>
      );
    }
  }

  return (
    <div className="titlebar">
      <span className="tname">afterterm</span>
      <button className="ver" data-version-button="" onClick={onOpenAbout}>v{window.afterterm.appVersion}</button>
      {button}
      {notice && createPortal(
        <div ref={popRef} className="up-pop" data-update-notice="" style={{ left }}>{notice}</div>,
        document.body,
      )}
    </div>
  );
}

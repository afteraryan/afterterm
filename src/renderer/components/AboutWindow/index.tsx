// The About window, opened by clicking the version in the title bar
// (docs/design-05-automatic-updates.md, mockup question 7): the logo, the name,
// the version, one update row, the automatic-checks switch and one link.
//
// The update row keeps one height in every state (one line, text on the left,
// buttons on the right), so the window never changes size when an update is
// found. What's new slides a notes panel open under the row and shut again
// (grid-template-rows 0fr to 1fr); the row's text fades in when its state
// changes; Close fades and sinks the window out (UpdateDialog).
import React, { useEffect, useState } from 'react';
import { REPO_URL, errorText, lastCheckedText, percent } from '../../../update-check';
import type { UpdateState } from '../../../update-check';
import { AppLogo, IconChevD } from '../Icons';
import { UpdateDialog } from '../UpdateDialog';
import { UpdateNotes, hasNotes } from '../UpdateNotes';
import './AboutWindow.css';

export interface AboutWindowProps {
  update: UpdateState;
  onClose: () => void;
  onRestart: () => void;
}

export function AboutWindow({ update, onClose, onRestart }: AboutWindowProps) {
  const [notesOpen, setNotesOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);

  const r = update.release;
  const has = !!r && (update.phase === 'available' || update.phase === 'downloading' || update.phase === 'ready');
  const notes = has && r && hasNotes(r.notes);
  useEffect(() => { if (!has) setNotesOpen(false); }, [has]);

  const wn = notes ? (
    <button className={`b q s up-wnb${notesOpen ? ' on' : ''}`} data-about-notes="" onClick={() => setNotesOpen(o => !o)}>
      What's new<span className="chev"><IconChevD size={13} /></span>
    </button>
  ) : null;

  let key: string = update.phase;
  let left: React.ReactNode;
  let buttons: React.ReactNode;
  if (update.canCheck === false) {
    key = 'not-installed';
    left = errorText('not-installed');
    buttons = <button className="b s" disabled>Check for updates</button>;
  } else if (update.phase === 'checking') {
    left = <><span className="spin" />Checking...</>;
    buttons = <button className="b s" disabled>Check for updates</button>;
  } else if (has && r && update.phase === 'available') {
    const retry = update.error === 'checksum' || update.error === 'network';
    left = <b>afterterm {r.version} is available</b>;
    buttons = <>{wn}<button className="b p s" onClick={() => window.afterterm.update.download()}>{retry ? 'Try again' : 'Update'}</button></>;
  } else if (has && r && update.phase === 'downloading') {
    const pct = percent(update.received, r.size);
    left = <><span className="ibar"><i style={{ width: `${pct}%` }} /></span><span className="ipct">{pct}%</span></>;
    buttons = <>{wn}<button className="b q s" onClick={() => window.afterterm.update.cancel()}>Cancel</button></>;
  } else if (has && r && update.phase === 'ready') {
    left = <b>afterterm {r.version} is ready</b>;
    buttons = <>{wn}<button className="b p s" onClick={onRestart}>Restart to update</button></>;
  } else {
    key = update.upToDate ? 'newest' : update.error === 'check' ? 'failed' : 'idle';
    left = update.upToDate ? 'You have the newest version.'
      : update.error === 'check' ? errorText('check')
      : lastCheckedText(update.lastChecked, now);
    buttons = <button className="b s" disabled={update.canCheck !== true} onClick={() => window.afterterm.update.check()}>Check for updates</button>;
  }

  return (
    <UpdateDialog onClose={onClose} label="About afterterm" className="up-about">
      {close => (
        <>
          <AppLogo size={56} />
          <h2>afterterm</h2>
          <div className="ver2">Version {update.current}</div>
          <div className="aupd">
            <div className="arow" data-about-row={key}>
              <span className="al" key={key}>{left}</span>
              {buttons}
            </div>
            {notes && r && (
              <div className={`up-reveal${notesOpen ? ' open' : ''}`} data-about-reveal="">
                <div><UpdateNotes markdown={r.notes} fold /></div>
              </div>
            )}
          </div>
          <button className="arow" data-auto-switch="" onClick={() => window.afterterm.update.setAuto(!update.auto)}>
            <span className="grow">Check for updates automatically</span>
            <span className={`up-sw${update.auto ? ' on' : ''}`} />
          </button>
          <div className="links">
            <a href={REPO_URL} onClick={e => { e.preventDefault(); window.afterterm.shell.openExternal(REPO_URL); }}>afterterm on GitHub</a>
          </div>
          <div className="up-dbtns"><button className="b p s" onClick={close}>Close</button></div>
        </>
      )}
    </UpdateDialog>
  );
}

// "Restart afterterm to update?" (docs/design-05-automatic-updates.md, mockup
// question 4). Shown every time Restart to update is pressed, busy or not: one
// row per awake thread with what happens to it, one status line, Not now and
// Restart now. No version, no paragraph. The rows come from restartRows in
// src/update-check.ts; what "Stops mid-turn" means is in docs/features-updates.md,
// not on screen.
import React, { useState } from 'react';
import { restartStatus } from '../../../update-check';
import type { RestartRow } from '../../../update-check';
import { IconBell, IconCheck, KindIcon } from '../Icons';
import { UpdateDialog } from '../UpdateDialog';
import './RestartToUpdate.css';

export interface RestartToUpdateProps {
  rows: RestartRow[];
  onCancel: () => void;
  // Resolves once main has answered; the window stays (buttons off) meanwhile.
  onConfirm: () => Promise<void>;
}

export function RestartToUpdate({ rows, onCancel, onConfirm }: RestartToUpdateProps) {
  const [busy, setBusy] = useState(false);
  const status = restartStatus(rows);
  return (
    <UpdateDialog onClose={onCancel} closeOnScrim={false} label="Restart afterterm to update?" className="up-restart">
      {close => (
        <>
          <h2>Restart afterterm to update?</h2>
          {rows.length > 0 && (
            <div className="up-tlist" data-restart-rows="">
              {rows.map(r => (
                <div className="tr" key={r.id} data-outcome={r.outcome}>
                  <KindIcon kind={r.kind} size={14} />
                  <span className="n">{r.name}</span>
                  <span className={`w${r.warn ? ' warn' : ''}`}>{r.text}</span>
                </div>
              ))}
            </div>
          )}
          <div className="up-dfoot">
            {status.ok
              ? <span className="up-dstat ok"><IconCheck size={13} />{status.text}</span>
              : <span className="up-dstat warn"><IconBell size={12} />{status.text}</span>}
            <span className="sp" />
            <button className="b q s" disabled={busy} onClick={close}>Not now</button>
            <button
              className="b p s"
              data-restart-now=""
              autoFocus
              disabled={busy}
              onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}
            >
              Restart now
            </button>
          </div>
        </>
      )}
    </UpdateDialog>
  );
}

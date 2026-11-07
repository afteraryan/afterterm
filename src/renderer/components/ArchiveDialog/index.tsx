// "Archive <project>?" (docs/mockups/sidebar-archive-with-awake-threads.html,
// agreed with Aryan 2026-11-01). Shown only when the project has awake threads:
// one row per awake thread with its current status in the sidebar's own icon and
// words (statusText in threadView.ts; "Awake" in grey when it has no state), one
// amber line saying they will go to sleep, then Cancel and Archive. The frame is
// the Restart to update window's (UpdateDialog): Esc cancels, a click beside the
// window does not close it.
import React, { useRef } from 'react';
import type { Tab, Group } from '../TabBar/types';
import { FolderIcon, IconBell, KindIcon, StateIcon } from '../Icons';
import { UpdateDialog } from '../UpdateDialog';
import { statusText, threadKind, threadName, threadState } from '../../threadView';
import '../RestartToUpdate/RestartToUpdate.css';
import './ArchiveDialog.css';

export interface ArchiveDialogProps {
  group: Group;
  // The project's awake threads, in panel order.
  threads: Tab[];
  onCancel: () => void;
  // Called once the window has faded out, so the sleeping that follows is seen.
  onConfirm: () => void;
}

export function ArchiveDialog({ group, threads, onCancel, onConfirm }: ArchiveDialogProps) {
  // UpdateDialog fades the window out and then calls onClose once, for every way
  // it closes; this says which button started it.
  const confirmed = useRef(false);
  return (
    <UpdateDialog
      onClose={() => (confirmed.current ? onConfirm() : onCancel())}
      closeOnScrim={false}
      label={`Archive ${group.label}?`}
      className="ar-dlg"
    >
      {close => (
        <>
          <h2>
            Archive
            <FolderIcon color={group.color} size={18} icon={group.icon} />
            <span className="hn">{group.label}</span>?
          </h2>
          <div className="up-tlist" data-archive-rows="">
            {threads.map(t => {
              const status = statusText(t);
              return (
                <div className="tr" key={t.id} data-tid={t.id}>
                  <KindIcon kind={threadKind(t)} size={15} />
                  <span className="n">{threadName(t)}</span>
                  <span className={`w${status ? '' : ' quiet'}`}>
                    {status && <StateIcon state={threadState(t)} size={14} />}
                    {status ?? 'Awake'}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="up-dfoot">
            <span className="up-dstat warn"><IconBell size={12} />These threads will go to sleep</span>
            <span className="sp" />
            <button className="b q s" onClick={close}>Cancel</button>
            <button
              className="b p s"
              data-archive-confirm=""
              autoFocus
              onClick={() => { confirmed.current = true; close(); }}
            >
              Archive
            </button>
          </div>
        </>
      )}
    </UpdateDialog>
  );
}

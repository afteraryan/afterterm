// "Start a chat in <project>?" (AFT-126): an agent ran `afterterm chat start`, and
// nothing opens until Aryan clicks Start here. Decided on 2026-11-17: he can change
// the model and the effort, the prompt is shown as it will be sent, and a request he
// does not answer goes after 10 minutes (main ends it; this only shows the time).
//
// Start never takes the keyboard (no autoFocus, no Enter): the window can appear
// while Aryan is typing in a terminal, and a keystroke meant for that terminal must
// never start a chat. A click outside the card does nothing either.
import React, { useEffect, useState } from 'react';
import { EFFORTS, MODEL_CHOICES, type ChatRequestView, type Effort } from '../../../chat-start';
import './ChatRequestDialog.css';

export interface ChatRequestDialogProps {
  request: ChatRequestView;
  /** The name afterterm shows for the thread that asked, or null when it is not known. */
  fromName: string | null;
  /** How many more requests wait behind this one. */
  behind: number;
  onStart: (model: string, effort: Effort | null) => void;
  onDecline: () => void;
}

function minutesLeft(expiresAt: number, now: number): string {
  const m = Math.max(0, Math.ceil((expiresAt - now) / 60000));
  return m <= 1 ? 'Expires in under a minute' : `Expires in ${m} min`;
}

export function ChatRequestDialog({ request, fromName, behind, onStart, onDecline }: ChatRequestDialogProps) {
  const [model, setModel] = useState(request.model);
  const [effort, setEffort] = useState<Effort | ''>(request.effort ?? '');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setModel(request.model);
    setEffort(request.effort ?? '');
    setBusy(false);
  }, [request.id]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  const models: string[] = (MODEL_CHOICES as readonly string[]).includes(request.model)
    ? [...MODEL_CHOICES]
    : [request.model, ...MODEL_CHOICES];

  return (
    <div className="modal-overlay">
      <div className="modal-card chatreq-card" data-chat-request={request.id} role="dialog" aria-modal="true">
        <h2 className="modal-title">Start a chat in {request.projectName}?</h2>
        <div className="chatreq-rows">
          <span className="chatreq-k">Asked by</span>
          <span className="chatreq-v">{fromName ?? 'An agent'}</span>
          <span className="chatreq-k">Model</span>
          <select className="chatreq-sel" data-chat-model value={model} onChange={e => setModel(e.target.value)}>
            {models.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <span className="chatreq-k">Effort</span>
          <select className="chatreq-sel" data-chat-effort value={effort} onChange={e => setEffort(e.target.value as Effort | '')}>
            <option value="">Claude Code's default</option>
            {EFFORTS.map(x => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>
        <div className="chatreq-prompt" data-chat-prompt>{request.prompt}</div>
        <div className="chatreq-foot">
          <span className="chatreq-status">
            {minutesLeft(request.expiresAt, now)}{behind > 0 ? ` · ${behind} more waiting` : ''}
          </span>
          <button type="button" className="b q" data-chat-decline disabled={busy} onClick={() => { setBusy(true); onDecline(); }}>
            Decline
          </button>
          <button type="button" className="b p" data-chat-start disabled={busy}
            onClick={() => { setBusy(true); onStart(model, effort || null); }}>
            Start
          </button>
        </div>
      </div>
    </div>
  );
}

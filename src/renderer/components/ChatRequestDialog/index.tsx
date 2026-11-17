// The request bar (AFT-126): an agent ran `afterterm chat start`, and nothing opens
// until Aryan clicks Start here. Design picked on 2026-11-17 against
// https://claude.ai/artifact/TXRS4CabfGTXS7aMLYYAEz: a bar at the bottom of the main
// pane, on every screen, that never covers the app.
//
//   ring (time left) · folder · project · model ▴ · effort ▴ ·· chat · quote · Decline · Start
//
// The ring empties over the 10 minutes main gives a request. The model and effort
// chips open a menu upward; the effort starts on the model's level (startEffort)
// unless the agent named one, and moves with the model until Aryan picks an effort
// himself. The chat icon opens the chat that asked. The quote button slides the
// prompt open above the bar and stays pressed while it is open.
//
// Start never takes the keyboard (no autoFocus, no Enter): the bar can appear while
// Aryan is typing in a terminal, and a keystroke meant for that terminal must never
// start a chat.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { EFFORTS, MODEL_CHOICES, REQUEST_TTL_MS, startEffort, type ChatRequestView, type Effort } from '../../../chat-start';
import { FolderIcon } from '../Icons';
import type { GroupColor, ProjectIconId } from '../TabBar/types';
import './ChatRequestDialog.css';

export interface ChatRequestBarProps {
  request: ChatRequestView;
  /** The project's colour and icon, as the sidebar draws them. */
  projectColor?: GroupColor;
  projectIcon?: ProjectIconId;
  /** The thread that asked, when it is still there: its name, and how to open it. */
  from: { name: string; onOpen: () => void } | null;
  /**
   * Aryan's choices on this request, kept by the app so they survive the bar moving
   * between screens (it is drawn in the main pane of whichever screen is open).
   */
  choice: ChatChoice | undefined;
  onChoice: (c: ChatChoice) => void;
  onStart: (model: string, effort: Effort) => void;
  onDecline: () => void;
  /** Its place in the stack (AFT-135): 0 is the front bar, more is behind it. */
  depth?: number;
  /** Where the stack puts a bar behind the front one. */
  style?: React.CSSProperties;
  className?: string;
  cardRef?: React.Ref<HTMLDivElement>;
}

export interface ChatChoice {
  model: string;
  effort: Effort;
  /** Aryan picked the effort himself, so a change of model leaves it alone. */
  effortChosen: boolean;
  /** The prompt is open. */
  open: boolean;
}

export function initialChoice(request: ChatRequestView): ChatChoice {
  return { model: request.model, effort: request.effort ?? startEffort(request.model), effortChosen: request.effort !== null, open: false };
}

const MODEL_WORDS: Record<string, string> = { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus', fable: 'Fable' };
const EFFORT_WORDS: Record<Effort, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };
const modelWord = (m: string) => MODEL_WORDS[m] ?? m;

const R = 6;
const C = 2 * Math.PI * R;

function Chevron() {
  return <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M2 6l3-3 3 3" /></svg>;
}
function Check() {
  return <svg className="crb-ck" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M2.5 6.2l2.3 2.3 4.7-5" /></svg>;
}

function Picker<T extends string>({ kind, title, value, options, word, open, onOpen, onPick }: {
  kind: string; title: string; value: T; options: readonly T[]; word: (v: T) => string;
  open: boolean; onOpen: () => void; onPick: (v: T) => void;
}) {
  return (
    <span className="crb-pick">
      <button type="button" className="crb-chip" data-chat-pick={kind} aria-haspopup="menu" aria-expanded={open} onClick={onOpen}>
        <span>{word(value)}</span>
        <Chevron />
      </button>
      {open && (
        <span className="crb-menu" role="menu">
          <span className="crb-mh">{title}</span>
          {options.map(o => (
            <button type="button" role="menuitem" key={o} data-chat-option={`${kind}:${o}`} onClick={() => onPick(o)}>
              <span>{word(o)}</span>
              {o === value && <Check />}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

export function ChatRequestBar({ request, projectColor, projectIcon, from, choice, onChoice, onStart, onDecline, depth = 0, style, className, cardRef }: ChatRequestBarProps) {
  const c = choice ?? initialChoice(request);
  const { model, effort } = c;
  const front = depth === 0;
  const open = front && c.open;
  const set = (patch: Partial<ChatChoice>) => onChoice({ ...c, ...patch });
  const [menu, setMenu] = useState<'model' | 'effort' | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setMenu(null);
    setBusy(false);
  }, [request.id]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // A menu closes on a click anywhere else and on Esc.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => { if (!(e.target as Element).closest?.('.crb-pick')) setMenu(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('mousedown', onDown, true); window.removeEventListener('keydown', onKey, true); };
  }, [menu]);

  const models: string[] = (MODEL_CHOICES as readonly string[]).includes(request.model) ? [...MODEL_CHOICES] : [request.model, ...MODEL_CHOICES];
  // A request waiting behind another has not started its 10 minutes yet: a full ring.
  const left = request.expiresAt === null ? 1 : Math.max(0, Math.min(1, (request.expiresAt - now) / REQUEST_TTL_MS));
  const mins = request.expiresAt === null ? 10 : Math.max(1, Math.ceil((request.expiresAt - now) / 60000));

  return (
    <div className={`crb${open ? ' open' : ''}${className ? ' ' + className : ''}`} ref={cardRef} style={style}
      data-chat-request={request.id} data-depth={depth} inert={!front}>
      <div className="crb-drawer">
        <div>
          <div className="crb-in">
            <div className="crb-prompt" data-chat-prompt>{request.prompt}</div>
          </div>
        </div>
      </div>
      <div className="crb-bar">
        <svg className="crb-ring" viewBox="0 0 16 16" role="img" aria-label={`${mins} min left`} data-tip={`${mins} min left`}>
          <circle cx="8" cy="8" r={R} className="crb-rt" />
          <circle cx="8" cy="8" r={R} className="crb-rf" strokeDasharray={C} strokeDashoffset={C * (1 - left)} />
        </svg>
        <span className="crb-proj"><FolderIcon color={projectColor} size={14} icon={projectIcon} /></span>
        <span className="crb-name">{request.projectName}</span>
        <Picker kind="model" title="Model" value={model} options={models} word={modelWord}
          open={menu === 'model'} onOpen={() => setMenu(menu === 'model' ? null : 'model')}
          onPick={m => { set({ model: m, effort: c.effortChosen ? effort : startEffort(m) }); setMenu(null); }} />
        <Picker kind="effort" title="Effort" value={effort} options={EFFORTS} word={e => EFFORT_WORDS[e]}
          open={menu === 'effort'} onOpen={() => setMenu(menu === 'effort' ? null : 'effort')}
          onPick={e => { set({ effort: e, effortChosen: true }); setMenu(null); }} />
        <span className="crb-sp" />
        {from && (
          <button type="button" className="crb-ib" data-chat-open-asker data-tip={`Open ${from.name}`} aria-label={`Open ${from.name}`} onClick={from.onOpen}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 4A1.5 1.5 0 0 1 4 2.5h8A1.5 1.5 0 0 1 13.5 4v5.5A1.5 1.5 0 0 1 12 11H7l-3 2.5V11A1.5 1.5 0 0 1 2.5 9.5z" /></svg>
          </button>
        )}
        <button type="button" className={`crb-ib${open ? ' on' : ''}`} data-chat-prompt-toggle aria-pressed={open} aria-label="Prompt" data-tip="Prompt" onClick={() => { set({ open: !open }); setMenu(null); }}>
          <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3 9.5C3 6.8 4.5 5 6.5 4.5l.4.9C5.6 6 5 7 5 8h1.6v3.5H3zm6 0C9 6.8 10.5 5 12.5 4.5l.4.9C11.6 6 11 7 11 8h1.6v3.5H9z" /></svg>
        </button>
        <button type="button" className="b q s" data-chat-decline disabled={busy} onClick={() => { setBusy(true); onDecline(); }}>Decline</button>
        <button type="button" className="b p s" data-chat-start disabled={busy} onClick={() => { setBusy(true); onStart(model, effort); }}>Start</button>
      </div>
    </div>
  );
}

// ─── The stack (AFT-135) ────────────────────────────────────────────────────
// Several requests waiting: the front bar at the bottom, up to two more peeking
// above it (lifted 9px each, a little smaller and darker, their text dimmed), and
// the count in the front bar's corner. Agreed against
// https://claude.ai/artifact/MgNBhoUc77AeUnmBk6wn9b. On Start or Decline the front
// bar slides down and fades fast, the rest move down one place easing out with no
// overshoot, and the next waiting one fades in at the back.

export interface ChatRequestStackProps {
  requests: ChatRequestView[];
  /** Everything a bar needs besides the request and its place. */
  barProps: (view: ChatRequestView) => Omit<ChatRequestBarProps, 'request' | 'depth' | 'style' | 'className' | 'cardRef'>;
}

const LIFT = 9;
/** A closed bar's height, borders included: the bars behind are this tall. */
const BAR_H = 48;
const SHRINK = 0.04;
const LEAVE_MS = 200;

export function ChatRequestStack({ requests, barProps }: ChatRequestStackProps) {
  const frontRef = useRef<HTMLDivElement>(null);
  const [frontH, setFrontH] = useState(BAR_H);
  // A bar that just ended stays drawn a moment to leave; its props are the last ones it had.
  const last = useRef(new Map<string, { view: ChatRequestView; props: ReturnType<ChatRequestStackProps['barProps']> }>());
  const [leaving, setLeaving] = useState<{ view: ChatRequestView; props: ReturnType<ChatRequestStackProps['barProps']> }[]>([]);

  const ids = requests.map(r => r.id).join(',');
  useLayoutEffect(() => {
    const now = new Set(requests.map(r => r.id));
    const gone = [...last.current.entries()].filter(([id]) => !now.has(id)).map(([, v]) => v);
    // Only the front one leaves with the animation; one that ended from behind just goes.
    const front = gone.filter(g => g.view.id === prevFront.current);
    if (front.length) {
      setLeaving(l => [...l, ...front]);
      setTimeout(() => setLeaving(l => l.filter(x => !front.some(f => f.view.id === x.view.id))), LEAVE_MS);
    }
    for (const g of gone) last.current.delete(g.view.id);
    prevFront.current = requests[0]?.id ?? null;
  }, [ids]);
  const prevFront = useRef<string | null>(null);

  useLayoutEffect(() => {
    const el = frontRef.current;
    if (!el) return;
    const measure = () => setFrontH(el.offsetHeight || BAR_H);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [requests[0]?.id]);

  if (requests.length === 0 && leaving.length === 0) return null;
  return (
    <div className="crs" data-chat-stack="">
      {leaving.map(l => (
        <ChatRequestBar key={`leaving-${l.view.id}`} {...l.props} request={l.view} depth={1} className="crs-leaving" />
      ))}
      {requests.map((r, i) => {
        const props = barProps(r);
        last.current.set(r.id, { view: r, props });
        const depth = Math.min(i, 3);
        if (i === 0) return <ChatRequestBar key={r.id} {...props} request={r} depth={0} cardRef={frontRef} style={{ zIndex: 10 }} />;
        const lift = (frontH - BAR_H) + depth * LIFT;
        const scale = 1 - Math.min(depth, 2) * SHRINK;
        return (
          <ChatRequestBar key={r.id} {...props} request={r} depth={depth} className="crs-behind"
            style={{ transform: `translateY(${-lift}px) scale(${scale})`, opacity: depth >= 3 ? 0 : 1, zIndex: 10 - i }} />
        );
      })}
      {requests.length > 1 && (
        <span className="crs-count" data-chat-count style={{ bottom: frontH - 11 }}>{requests.length}</span>
      )}
    </div>
  );
}

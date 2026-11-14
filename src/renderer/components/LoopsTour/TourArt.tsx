// The loops tour's pictures (AFT-103, the mock's ART): pieces of afterterm's own
// grey UI, enlarged and slightly tilted on a deeper panel, with a cursor where
// there is an action. Each picture is a timeline of cues from the mock; a cue
// only moves the picture to its next state, the CSS does the motion (and under
// reduced motion every state simply appears).
import React, { useEffect, useState } from 'react';
import type { LoopLabel } from '../../../loops';
import type { TourArt as ArtKind } from '../../loopsTour';
import { LabelIcon } from '../Loops/LoopIcons';

// How many of the cue times (ms after the picture appears) have passed.
function useCues(times: readonly number[]): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const ids = times.map((t, i) => window.setTimeout(() => setN((v) => Math.max(v, i + 1)), t));
    return () => ids.forEach((id) => window.clearTimeout(id));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return n;
}

type St = '' | 'closed' | 'rot';
function Status({ s = '' }: { s?: St }) {
  return <span className={`ta-st${s ? ' ' + s : ''}`}><i /></span>;
}

function Row({ title, label, when, s = '', frac, className = '', children }: {
  title: string; label?: LoopLabel; when?: string; s?: St; frac?: string; className?: string; children?: React.ReactNode;
}) {
  return (
    <div className={`ta-row${s === 'closed' ? ' closed' : ''}${className ? ' ' + className : ''}`}>
      <Status s={s} />
      {label && <span className="ta-kind"><LabelIcon label={label} size={15} /></span>}
      <span className="ta-t1">{title}</span>
      {frac && <span className="ta-frac">{frac}</span>}
      {when && <span className="ta-when">{when}</span>}
      {children}
    </div>
  );
}

function Cursor({ x, y, press = false, hidden = false }: { x: number; y: number; press?: boolean; hidden?: boolean }) {
  return (
    <svg className={`ta-cursor${press ? ' press' : ''}`} viewBox="0 0 24 24" style={{ left: x, top: y, opacity: hidden ? 0 : 1 }} aria-hidden="true">
      <path d="M5 3l14 7.5-6.2 1.6L10 18.5z" fill="#ffffff" stroke="#0d0d0d" strokeWidth={1.3} strokeLinejoin="round" />
    </svg>
  );
}

function NoteIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden="true">
      <circle cx="7" cy="7" r="5.5" /><path d="M7 4v3.2l2 1.3" />
    </svg>
  );
}

// 1. A loop is a feature, a bug or an idea: three loops appear, each with its label.
function Kinds() {
  const n = useCues([250, 700, 1150]);
  const rows: [string, LoopLabel, string][] = [
    ['Notes to PDF app', 'feature', 'Feature'], ['Login button does nothing', 'bug', 'Bug'], ['Weekly summary email', 'idea', 'Idea'],
  ];
  return (
    <div className="ta-piece" style={{ left: 26, right: 26, top: 22, gap: 6 }}>
      {rows.map(([t, k, w], i) => (
        <div key={t} className={`ta-row ta-rowin${n > i ? ' on' : ''}`}>
          <Status /><span className="ta-t1">{t}</span>
          <span className="ta-lab"><LabelIcon label={k} size={14} />{w}</span>
        </div>
      ))}
    </div>
  );
}

// 2. Claude works in a chat: a loop appears, its note changes, it closes, with no
// one touching it; then a cursor marked "You" renames it.
function Auto() {
  const n = useCues([200, 600, 1500, 1800, 2700, 3000, 3700, 3900, 4600, 4760]);
  const moved = n >= 8;
  return (
    <>
      <div className="ta-term">
        <div className={`ta-tl${n >= 1 ? ' on' : ''}`}>Claude: started a loop for this</div>
        <div className={`ta-tl${n >= 3 ? ' on' : ''}`}>Claude: PDF layout done</div>
        <div className={`ta-tl${n >= 5 ? ' on' : ''}`}>Claude: all done, closing it</div>
      </div>
      <div className="ta-piece" style={{ left: 40, right: 18, top: 128, padding: 6 }}>
        <Row className={`ta-rowin${n >= 2 ? ' on' : ''}`} title={n >= 9 ? 'Notes to PDF app v1' : 'Notes to PDF app'} label="feature" when="now" s={n >= 6 ? 'closed' : ''} />
        <div className="ta-det" style={{ borderRadius: '0 0 9px 9px' }}>
          <span className="ta-stn"><NoteIcon /><span>{n >= 4 ? 'PDF layout done.' : 'Started.'}</span></span>
        </div>
      </div>
      <div className="ta-who" style={{ opacity: moved ? 1 : 0, left: moved ? 256 : 340, top: moved ? 176 : 230 }}>You</div>
      <Cursor x={moved ? 230 : 330} y={moved ? 146 : 250} hidden={n < 7} press={n === 9} />
    </>
  );
}

// 3. A loop left alone: the days count up, its circle turns amber, its title fades
// and is crossed out.
function Rot() {
  const days = [1, 2, 3, 5, 8, 12, 17, 23];
  const n = useCues(days.map((_, i) => 300 + i * 320));
  const d = days[Math.max(0, n - 1)];
  return (
    <>
      <div className={`ta-piece ta-worn${n >= 5 ? ' old' : ''}`} style={{ left: 34, right: 34, top: 76, padding: 6 }}>
        <Row title="Export to PDF" label="feature" when={d < 14 ? `${d}d` : `${Math.floor(d / 7)}w`} s={n >= 4 ? 'rot' : ''} />
      </div>
      <div className="ta-age" style={{ left: 34, top: 26 }}>Day {d}</div>
    </>
  );
}

// 4. A right-click on a loop opens the menu with Open chat.
function List() {
  const n = useCues([400, 1150, 1310]);
  return (
    <>
      <div className="ta-piece" style={{ left: 24, right: 60, top: 20 }}>
        <Row title="Notes to PDF app" label="feature" frac="1/3" when="2d" />
        <Row title="Login button does nothing" label="bug" when="5h" />
        <Row title="Price page redesign" label="feature" when="1d" s="closed" />
      </div>
      <div className="ta-menu" style={{ left: 200, top: 62, opacity: n >= 2 ? 1 : 0 }}>
        <span className="hl">Open chat</span><span>Close</span><span>Update</span>
      </div>
      <Cursor x={n >= 1 ? 190 : 330} y={n >= 1 ? 40 : 170} press={n === 2} />
    </>
  );
}

// 5. A click opens a loop and its three sub-loops slide open, one already closed.
function Subs() {
  const n = useCues([350, 1050, 1210]);
  const open = n >= 2;
  return (
    <>
      <div className="ta-piece" style={{ left: 24, right: 24, top: 14 }}>
        <Row className={open ? 'open-row' : ''} title="Notes to PDF app" label="feature" frac="1/3" when="2d" />
        <div className={`ta-subs ta-fold${open ? ' open' : ''}`}>
          <Row title="Pick the notes" label="feature" when="2d" s="closed" />
          <Row title="Lay out the PDF" label="feature" when="2d" />
          <Row title="Save to a folder" label="idea" when="3d" />
        </div>
      </div>
      <Cursor x={n >= 1 ? 170 : 330} y={n >= 1 ? 30 : 160} press={n === 2} />
    </>
  );
}

// 7. The calendar fills in, week by week.
const CAL_LEVELS = (() => {
  let s = 11;
  const r = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  return Array.from({ length: 7 * 14 }, () => { const v = r(); return v < 0.2 ? 0 : v < 0.45 ? 1 : v < 0.7 ? 2 : v < 0.9 ? 3 : 4; });
})();
function Calendar() {
  const n = useCues(Array.from({ length: 14 }, (_, c) => 200 + c * 70));
  return (
    <div className="ta-hm" style={{ left: 30, top: 24 }}>
      {CAL_LEVELS.map((l, i) => {
        const c = Math.floor(i / 7);
        return <span key={i} className={`ta-cell${c < n && l ? ' l' + l : ''}`} />;
      })}
    </div>
  );
}

// 8. Three finished loops, the first with its three sub-loops done.
function Done() {
  const n = useCues([200]);
  return (
    <div className={`ta-piece ta-in${n >= 1 ? ' on' : ''}`} style={{ left: 30, right: 30, top: 20, padding: 8 }}>
      <Row className="open-row" title="Notes to PDF app" label="feature" frac="3/3" when="now" s="closed" />
      <div className="ta-subs">
        <Row title="Pick the notes" label="feature" when="2d" s="closed" />
        <Row title="Lay out the PDF" label="feature" when="1d" s="closed" />
        <Row title="Save to a folder" label="idea" when="now" s="closed" />
      </div>
      <Row title="Login button does nothing" label="bug" when="3h" s="closed" />
      <Row title="Price page redesign" label="feature" when="1d" s="closed" />
    </div>
  );
}

const ARTS: Record<Exclude<ArtKind, null>, () => React.ReactElement> = {
  kinds: Kinds, auto: Auto, rot: Rot, list: List, subs: Subs, calendar: Calendar, done: Done,
};

export function TourArt({ kind }: { kind: Exclude<ArtKind, null> }) {
  const Art = ARTS[kind];
  const size = kind === 'done' ? ' tall' : kind === 'auto' ? ' tall2' : '';
  return <div className={`ta-art${size}`} data-tour-art={kind}><Art /></div>;
}

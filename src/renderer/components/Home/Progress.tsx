// Home's Progress column (design-07, mock loops-home.html, the Progress layout):
// the heading with its close button, the streak calendar card and the count card
// (both at the mock's 80%), then the filter row and the list of every loop at full
// size, the list scrolling on its own. Sizes are design-07's "Frontend spec: exact
// values"; they live in Progress.css.
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Group } from '../TabBar/types';
import { loopCounts, LOOP_LABELS, type Loop, type LoopLabel } from '../../../loops';
import { LoopList } from '../Loops/LoopList';
import { LoopMenu, type LoopMenuItem } from '../Loops/LoopMenu';
import { ChevronDown, ChevronLeft, ChevronRight, FilterIcon, LabelIcon, PanelCloseIcon, SmallX } from '../Loops/LoopIcons';
import { filterIsSet, LABEL_WORDS, loopProjects, projectLook, visibleLoops, type LoopFilter, type StatusFilter } from '../../loopsView';
import { calendarWeeks, shade, streaks } from '../../streakView';
import './Progress.css';

export interface ProgressProps {
  loops: Loop[];
  groups: Group[];
  now: number;
  days: Record<string, number>;
  filter: LoopFilter;
  setFilter: (f: LoopFilter) => void;
  onClose: () => void;
  onOpenChat: (loop: Loop) => void;
  onToast: (message: string, actionLabel?: string, onAction?: () => void) => void;
}

const WEEKS = 22;
const STEP_WEEKS = 4;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STATUSES: [StatusFilter, string][] = [['all', 'All'], ['open', 'Open'], ['rotting', 'Rotting'], ['closed', 'Closed'], ['archived', 'Archived']];
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function todayString(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function monthShort(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleString('en-GB', { month: 'short' });
}

// ---------- the streak calendar ----------

function CalendarGrid({ days, today, offset, streakStart }: { days: Record<string, number>; today: string; offset: number; streakStart: string | null }) {
  const weeks = calendarWeeks(today, WEEKS, offset);
  const first = weeks[0][0].day;
  const months = weeks.map((col, w) => {
    const firstOfMonth = col.find((c) => c.day.endsWith('-01'));
    if (firstOfMonth) return monthShort(firstOfMonth.day);
    if (w === 0 && Number(first.slice(8)) <= 18) return monthShort(first);
    return '';
  });
  return (
    <div className="pg-hm">
      <span />
      {months.map((m, w) => <span key={`m${w}`} className="pg-mo">{m}</span>)}
      {DAY_NAMES.map((name, row) => (
        <React.Fragment key={name}>
          <span className="pg-dl">{name}</span>
          {weeks.map((col) => {
            const c = col[row];
            if (c.future) return <span key={c.day} className="pg-cell future" />;
            const n = days[c.day] ?? 0;
            const cur = streakStart !== null && c.day >= streakStart && c.day <= today && n > 0;
            return <span key={c.day} className={`pg-cell l${shade(n)}${cur ? ' cur' : ''}`} data-day={c.day} data-n={n} title={`${c.day}: ${n}`} />;
          })}
        </React.Fragment>
      ))}
    </div>
  );
}

function Calendar({ days, now }: { days: Record<string, number>; now: number }) {
  const today = todayString(now);
  const s = streaks(days, today);
  const [offset, setOffset] = useState(0);
  const clip = useRef<HTMLDivElement>(null);
  const leaving = useRef<{ node: HTMLElement; dir: number } | null>(null);
  const earliest = useMemo(() => Object.keys(days).filter((d) => (days[d] ?? 0) > 0).sort()[0] ?? today, [days, today]);
  // Older is possible while the oldest day with messages is before what is shown.
  const shownFirst = calendarWeeks(today, WEEKS, offset)[0][0].day;
  const canOlder = earliest < shownFirst;

  const move = (next: number) => {
    if (next < 0 || next === offset) return;
    const grid = clip.current?.firstElementChild as HTMLElement | null;
    if (grid && !reduced()) leaving.current = { node: grid.cloneNode(true) as HTMLElement, dir: next > offset ? 1 : -1 };
    setOffset(next);
  };

  // The old weeks slide out one side while the new slide in from the other: full
  // width, 520 ms, cubic-bezier(.16,1,.3,1), no fade.
  useLayoutEffect(() => {
    const l = leaving.current;
    leaving.current = null;
    const box = clip.current;
    if (!l || !box) return;
    const fresh = box.firstElementChild as HTMLElement | null;
    const old = l.node;
    old.style.position = 'absolute';
    old.style.left = '0';
    old.style.top = '0';
    old.style.pointerEvents = 'none';
    box.appendChild(old);
    const ease = 'cubic-bezier(.16,1,.3,1)';
    old.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${l.dir * 100}%)` }], { duration: 520, easing: ease, fill: 'forwards' }).onfinish = () => old.remove();
    fresh?.animate([{ transform: `translateX(${-l.dir * 100}%)` }, { transform: 'translateX(0)' }], { duration: 520, easing: ease });
  }, [offset]);

  return (
    <div className="pg-act" data-calendar="">
      <div className="pg-act-h">
        <b data-streak={s.current}>{s.current} day streak</b>
        <span className="grow" />
        <span className="pg-long">Longest <b data-longest={s.longest}>{s.longest} days</b></span>
        <button type="button" className={`pg-nav${canOlder ? '' : ' off'}`} data-act="older" aria-label="Earlier" onClick={() => move(offset + STEP_WEEKS)}><ChevronLeft /></button>
        <button type="button" className={`pg-nav${offset ? '' : ' off'}`} data-act="newer" aria-label="Later" onClick={() => move(Math.max(0, offset - STEP_WEEKS))}><ChevronRight /></button>
      </div>
      <div className="pg-hmclip" ref={clip}>
        <CalendarGrid days={days} today={today} offset={offset} streakStart={s.currentStart} />
      </div>
      <div className="pg-legend">
        <span>Less</span>
        <span className="pg-cell" /><span className="pg-cell l1" /><span className="pg-cell l2" /><span className="pg-cell l3" /><span className="pg-cell l4" />
        <span>More</span>
        <span className="grow" />
        <span className="pg-curkey" />
        <span>Current streak</span>
      </div>
    </div>
  );
}

// ---------- the count card ----------

function CountCard({ loops, now, filter, setFilter }: { loops: Loop[]; now: number; filter: LoopFilter; setFilter: (f: LoopFilter) => void }) {
  const c = loopCounts(loops, now);
  const pick = (s: StatusFilter) => setFilter({ ...filter, status: filter.status === s ? 'all' : s });
  const on = (s: StatusFilter) => (filter.status === s ? 'on' : undefined);
  return (
    <div className="pg-count" data-count="">
      <div className="pg-big"><b data-remaining={c.remaining}>{c.remaining}</b><span>remaining</span></div>
      <div className="pg-split">
        <button type="button" data-f="open" className={on('open')} onClick={() => pick('open')}><b>{c.open}</b>open</button>
        <button type="button" data-f="rotting" className={on('rotting')} onClick={() => pick('rotting')}><span className="pg-rot-n">{c.rotting}</span>rotting</button>
        <button type="button" data-f="closed" className={on('closed')} onClick={() => pick('closed')}><b>{c.closed}</b>closed</button>
      </div>
      <span className="pg-track"><i style={{ width: `${c.total ? (c.closed / c.total) * 100 : 0}%` }} /></span>
    </div>
  );
}

// ---------- the filter row ----------

// A segment group whose highlight slides between choices (240 ms).
function Segments({ name, children, activeIndex }: { name: string; children: React.ReactNode; activeIndex: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  useLayoutEffect(() => {
    const box = ref.current, th = thumb.current;
    if (!box || !th) return;
    const btn = box.querySelectorAll('button')[activeIndex] as HTMLElement | undefined;
    if (!btn) { th.style.opacity = '0'; placed.current = false; return; }
    if (!placed.current) th.style.transition = 'none';
    th.style.opacity = '1';
    th.style.transform = `translateX(${btn.offsetLeft}px)`;
    th.style.width = `${btn.offsetWidth}px`;
    if (!placed.current) { void th.offsetWidth; th.style.transition = ''; placed.current = true; }
  });
  return <span className="pg-fseg" data-seg={name} ref={ref}><span className="pg-thumb" ref={thumb} />{children}</span>;
}

function FilterRow({ loops, groups, filter, setFilter }: { loops: Loop[]; groups: Group[]; filter: LoopFilter; setFilter: (f: LoopFilter) => void }) {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; items: LoopMenuItem[] } | null>(null);
  const projectName = filter.project === undefined ? null : projectLook(filter.project, groups).name;
  const projectMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const items: LoopMenuItem[] = [
      { label: 'Every project', check: filter.project === undefined, testId: 'pf-all', onSelect: () => setFilter({ ...filter, project: undefined }) },
      'sep',
      ...loopProjects(loops, groups).map((p) => ({
        label: p.name, check: filter.project === p.id, testId: `pf-${p.id ?? 'general'}`,
        onSelect: () => setFilter({ ...filter, project: p.id }),
      })),
    ];
    setMenu({ x: r.left, y: r.bottom + 4, items });
  };
  const chips: React.ReactNode[] = [];
  if (!open) {
    if (filter.status !== 'all') chips.push(<button key="s" type="button" className="pg-fchip" data-clear="status" onClick={() => setFilter({ ...filter, status: 'all' })}>{STATUSES.find((s) => s[0] === filter.status)?.[1]}<SmallX /></button>);
    if (filter.label) chips.push(<button key="l" type="button" className="pg-fchip" data-clear="label" onClick={() => setFilter({ ...filter, label: null })}>{LABEL_WORDS[filter.label]}<SmallX /></button>);
    if (projectName !== null) chips.push(<button key="p" type="button" className="pg-fchip" data-clear="project" onClick={() => setFilter({ ...filter, project: undefined })}>{projectName}<SmallX /></button>);
  }
  return (
    <div className="pg-fbar" data-filter-bar="">
      <button type="button" className={`pg-ibtn${open ? ' on' : ''}`} data-act="toggle-filters" aria-label="Filter" data-tip="Filter" onClick={() => setOpen((v) => !v)}><FilterIcon /></button>
      <span className={`pg-finline${open ? ' open' : ''}`} inert={!open}>
        <Segments name="status" activeIndex={STATUSES.findIndex((s) => s[0] === filter.status)}>
          {STATUSES.map(([key, word]) => (
            <button key={key} type="button" className={filter.status === key ? 'on' : undefined} data-fs={key} onClick={() => setFilter({ ...filter, status: key })}>{word}</button>
          ))}
        </Segments>
        <Segments name="label" activeIndex={filter.label ? LOOP_LABELS.indexOf(filter.label) : -1}>
          {LOOP_LABELS.map((k: LoopLabel) => (
            <button key={k} type="button" className={filter.label === k ? 'on' : undefined} data-fl={k} data-tip={LABEL_WORDS[k]} onClick={() => setFilter({ ...filter, label: filter.label === k ? null : k })}>
              <LabelIcon label={k} size={12} />
            </button>
          ))}
        </Segments>
        <button type="button" className={`pg-fdrop${projectName !== null ? ' on' : ''}`} data-act="project" onClick={projectMenu}>
          {projectName ?? 'Project'}<ChevronDown />
        </button>
      </span>
      {chips}
      {menu && <LoopMenu items={menu.items} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
    </div>
  );
}

// ---------- the column ----------

export function Progress({ loops, groups, now, days, filter, setFilter, onClose, onOpenChat, onToast }: ProgressProps) {
  const rows = visibleLoops(loops, filter, now);
  // Deleted loops are kept 30 days; the Archived filter lists them after the
  // archived ones, where Restore brings one back.
  const deleted = filter.status === 'archived'
    ? loops.filter((l) => !l.parent && l.deletedAt).sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0))
    : [];
  const [enterKey, setEnterKey] = useState(0);
  const filterText = JSON.stringify(filter);
  const firstFilter = useRef(filterText);
  useEffect(() => {
    if (filterText === firstFilter.current) return;
    firstFilter.current = filterText;
    setEnterKey((k) => k + 1);
  }, [filterText]);
  const empty = filter.status === 'archived' ? 'Nothing archived' : filterIsSet(filter) ? 'No loops' : 'No loops yet';
  return (
    <div className="prog-col" data-progress="">
      <div className="pg-top">
        <div className="pg-lbl">Progress<span className="grow" /><button type="button" className="pg-ibtn pg-close" data-act="progress-close" data-tip="Close" onClick={onClose}><PanelCloseIcon size={12} /></button></div>
        <Calendar days={days} now={now} />
        <CountCard loops={loops} now={now} filter={filter} setFilter={setFilter} />
      </div>
      <FilterRow loops={loops} groups={groups} filter={filter} setFilter={setFilter} />
      <div className="prog-list" data-loop-scroll="">
        <LoopList loops={loops} rows={rows} groups={groups} now={now} variant="list" enterKey={enterKey} emptyText={deleted.length ? null : empty} onOpenChat={onOpenChat} onToast={onToast} />
        {deleted.length > 0 && (
          <>
            <div className="pg-sublbl">Deleted</div>
            <LoopList loops={loops} rows={deleted} groups={groups} now={now} variant="list" onOpenChat={onOpenChat} onToast={onToast} />
          </>
        )}
      </div>
    </div>
  );
}

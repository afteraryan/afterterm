// Dragging in the panel: projects inside and between Pinned and Recent, threads
// between threads, onto a project's row, or above the first section heading into
// General. Built to docs/mockups/sidebar-drag-and-drop.html (Aryan, 2026-11-01),
// whose script this follows closely; read that page before changing anything here.
//
// The pieces, all as in the mockup:
// - A press becomes a drag only after the pointer moves DRAG_START_PX, so a click
//   never flashes the card or the line.
// - The card is the full row, floating to the right of the pointer and centred on
//   it, so the line is never under it. A thread's card opens a from-and-to line
//   once it would land in another project.
// - The line is a 2px accent bar with a ring at its start. It slides between
//   places, but appears in place the first time it shows. It is hidden while the
//   row would land where it already is.
// - Targets are read from the layout (offsetTop), never from rects that may be
//   mid-animation, so they do not flicker while rows slide.
// - The list scrolls with the wheel during a drag, and near its top or bottom edge
//   while a row is held there.
// - Letting go nowhere, on its own place, or Esc: the card floats back.
//
// The DOM contract with SidePanel/index.tsx: the scroller holds `.sec[data-sec]`
// sections (general, pinned, recent), each with a `.lbl` heading; a project is a
// `.pjw[data-pjw=<id>]` block holding its `.pj` row and a `.tlw` thread list
// (`.closed` when collapsed); every thread row is `.th[data-tid=<id>]`.
//
// Two threads side by side (design-06): a thread carried past the panel's right
// edge, over the main pane, stops targeting the panel and asks the app what the
// pane would do with it (`paneAt`): a half to take, or a refused drop. The app
// paints that (`paneHover`) and makes the split on release (`dropOnPane`).
// Inside the panel everything works exactly as before.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectSection } from '../../panelView';
import type { PaneTarget } from '../../splitView';

export const DRAG_START_PX = 7;
// Where the card floats: its left edge this far right of the pointer.
const CARD_OFFSET_X = 26;
const EDGE_PX = 40;
const EDGE_MAX_SPEED = 14;
const RETURN_MS = 220;

// 'general' stands for the threads with no project.
export type ListKey = string;
export const GENERAL: ListKey = 'general';

export interface DragState {
  kind: 'thread' | 'project';
  id: string;
  width: number;
  // The thread's own list, and the list it would land in now (the same while it
  // would stay where it is). Unused for a project.
  from: ListKey;
  to: ListKey;
  // The project row a thread is held over (it goes in at that project's top).
  overProject: string | null;
  // The card is floating back to its row.
  returning: boolean;
}

type Target =
  | { kind: 'project'; section: ProjectSection; beforeId: string | null }
  | { kind: 'thread'; list: ListKey; beforeId: string | null; onRow: boolean }
  // Over the main pane: what dropping there would do, or null for nothing.
  | { kind: 'pane'; pane: PaneTarget | null };

export interface PanelDragOptions {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  lineRef: React.RefObject<HTMLDivElement | null>;
  ghostRef: React.RefObject<HTMLDivElement | null>;
  // Every thread id in a list, in order (the full list, folded rows included).
  threadsOf: (list: ListKey) => string[];
  listOf: (tabId: string) => ListKey;
  // Called just before a drop changes state, with the card's rectangle, so the
  // panel can slide everything that moves from where it was.
  beforeDrop: (id: string, kind: 'thread' | 'project', cardRect: DOMRect) => void;
  dropThread: (tabId: string, list: ListKey, beforeId: string | null) => void;
  dropProject: (groupId: string, section: ProjectSection, beforeId: string | null) => void;
  onStart?: () => void;
  // The main pane as a drop target (design-06). Without paneAt the pane is no
  // target and a thread carried over it targets the panel as before.
  paneAt?: (tabId: string, x: number, y: number) => PaneTarget | null;
  paneHover?: (target: PaneTarget | null) => void;
  dropOnPane?: (tabId: string, target: PaneTarget) => void;
}

// A pane target that a release acts on: a half, not refused.
const paneDrops = (t: PaneTarget | null): t is PaneTarget => !!t && t.kind === 'half' && !t.bad;

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export function usePanelDrag(opts: PanelDragOptions) {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;

  // Everything that changes on every pointer move lives here, not in state.
  const live = useRef<{
    pending: boolean;
    kind: 'thread' | 'project';
    id: string;
    row: HTMLElement;
    src: HTMLElement;
    x0: number; y0: number;
    x: number; y: number;
    home: { left: number; top: number };
    target: Target | null;
    raf: number;
  } | null>(null);
  const suppressClick = useRef(false);
  const linePlaced = useRef(false);

  const update = (patch: Partial<DragState>) => {
    const cur = dragRef.current;
    if (!cur) return;
    const changed = (Object.keys(patch) as (keyof DragState)[]).some(k => cur[k] !== patch[k]);
    if (!changed) return;
    const next = { ...cur, ...patch };
    dragRef.current = next;
    setDrag(next);
  };

  // A row's place in the list's layout, in the scroller's viewport coordinates.
  // offsetTop ignores transforms, so rows sliding into place do not move it.
  const inList = (el: HTMLElement) => {
    const scroller = optsRef.current.scrollRef.current!;
    let t = 0;
    let e: HTMLElement | null = el;
    while (e && e !== scroller) { t += e.offsetTop; e = e.offsetParent as HTMLElement | null; }
    const top = t - scroller.scrollTop;
    return { top, bottom: top + el.offsetHeight, height: el.offsetHeight };
  };

  const showLine = (y: number, indent: boolean) => {
    const line = optsRef.current.lineRef.current;
    const scroller = optsRef.current.scrollRef.current;
    if (!line || !scroller) return;
    const fresh = !line.classList.contains('on');
    if (fresh) line.style.transition = 'none';
    line.style.top = `${y - 1 + scroller.scrollTop}px`;
    line.style.left = `${indent ? 30 : 6}px`;
    if (fresh) { void line.offsetWidth; line.style.transition = ''; }
    line.classList.add('on');
    linePlaced.current = true;
  };
  const hideLine = () => optsRef.current.lineRef.current?.classList.remove('on');

  const nextIn = (list: string[], id: string) => {
    const i = list.indexOf(id);
    return i === -1 ? undefined : (list[i + 1] ?? null);
  };

  // Whether dropping on `t` would leave the row where it is. Takes the drag's
  // record explicitly: finish() has already cleared live.current when it asks.
  const isNoop = (t: Target, rec = live.current): boolean => {
    const l = rec!;
    if (t.kind === 'pane') return !paneDrops(t.pane);
    if (t.kind === 'project') {
      if (l.kind !== 'project') return false;
      const sec = l.src.closest<HTMLElement>('.sec')?.dataset.sec;
      if (sec !== t.section) return false;
      const ids = [...l.src.parentElement!.querySelectorAll<HTMLElement>(':scope > .pjw')].map(b => b.dataset.pjw!);
      return t.beforeId === l.id || t.beforeId === (nextIn(ids, l.id) ?? null);
    }
    const o = optsRef.current;
    if (o.listOf(l.id) !== t.list) return false;
    const ids = o.threadsOf(t.list);
    return t.beforeId === l.id || t.beforeId === (nextIn(ids, l.id) ?? null);
  };

  const sectionLabel = (sec: string) =>
    optsRef.current.scrollRef.current!.querySelector<HTMLElement>(`.sec[data-sec="${sec}"] > .lbl`);

  const midIndex = (rows: HTMLElement[], y: number) => {
    let i = 0;
    for (const r of rows) { const b = inList(r); if (y > b.top + b.height / 2) i++; }
    return i;
  };

  // A project: a slot inside Pinned or Recent. Above Recent's heading counts as
  // Pinned (with no Pinned section yet, that is where it starts).
  const projectTarget = (y: number): Target | null => {
    const l = live.current!;
    const scroller = optsRef.current.scrollRef.current!;
    const recentLbl = sectionLabel('recent');
    const pinnedLbl = sectionLabel('pinned');
    let section: ProjectSection = 'pinned';
    if (recentLbl && y >= inList(recentLbl).top + 10) section = 'recent';
    if (section === 'pinned' && !pinnedLbl && !recentLbl) return null;
    const blocks = [...scroller.querySelectorAll<HTMLElement>(`.sec[data-sec="${section}"] > .pjw`)]
      .filter(b => b !== l.src && !b.classList.contains('shut'));
    const i = midIndex(blocks, y);
    let lineY: number;
    if (blocks.length === 0) {
      const lbl = section === 'pinned' ? pinnedLbl : recentLbl;
      lineY = section === 'pinned' && !pinnedLbl ? inList(recentLbl!).top - 6 : inList(lbl!).bottom + 2;
    } else if (i === 0) lineY = inList(blocks[0]).top;
    else lineY = inList(blocks[i - 1]).bottom;
    const t: Target = { kind: 'project', section, beforeId: blocks[i]?.dataset.pjw ?? null };
    if (!isNoop(t)) showLine(lineY, false);
    return t;
  };

  // A thread: above the first section heading (out of its project, into General),
  // a project's own row (in at the top of that project), or between two threads.
  const threadTarget = (y: number): Target | null => {
    const l = live.current!;
    const o = optsRef.current;
    const scroller = o.scrollRef.current!;
    const firstLbl = sectionLabel('pinned') ?? sectionLabel('recent');
    if (!firstLbl || y <= inList(firstLbl).bottom) {
      const rows = [...scroller.querySelectorAll<HTMLElement>('.sec[data-sec="general"] .th[data-tid]')].filter(r => r !== l.src);
      const t: Target = { kind: 'thread', list: GENERAL, beforeId: null, onRow: false };
      if (rows.length === 0) {
        if (!firstLbl) return null;
        if (!isNoop(t)) showLine(inList(firstLbl).top + 2, false);
        return t;
      }
      const i = midIndex(rows, y);
      t.beforeId = rows[i]?.dataset.tid ?? null;
      if (!isNoop(t)) showLine(i === 0 ? inList(rows[0]).top : inList(rows[i - 1]).bottom, false);
      return t;
    }
    for (const block of scroller.querySelectorAll<HTMLElement>('.sec > .pjw')) {
      if (block.classList.contains('shut')) continue;
      const b = inList(block);
      if (y < b.top || y > b.bottom) continue;
      const groupId = block.dataset.pjw!;
      const pj = block.querySelector<HTMLElement>('.pj')!;
      const pjBox = inList(pj);
      if (y <= pjBox.bottom) {
        const first = o.threadsOf(groupId).find(id => id !== l.id) ?? null;
        const t: Target = { kind: 'thread', list: groupId, beforeId: first, onRow: true };
        // Its own project's top, when it is already first there, is its own place.
        const own = o.listOf(l.id) === groupId && o.threadsOf(groupId)[0] === l.id;
        if (own) t.beforeId = l.id;
        return t;
      }
      const rows = [...block.querySelectorAll<HTMLElement>('.tlw:not(.closed) .th[data-tid]')].filter(r => r !== l.src);
      const i = midIndex(rows, y);
      let beforeId: string | null = rows[i]?.dataset.tid ?? null;
      if (beforeId === null && rows.length > 0) {
        // Below the last row shown: before whatever comes after it in the full
        // list (a row folded behind "Show more"), or at the end.
        const full = o.threadsOf(groupId).filter(id => id !== l.id);
        const last = rows[rows.length - 1].dataset.tid!;
        beforeId = full[full.indexOf(last) + 1] ?? null;
      }
      const t: Target = { kind: 'thread', list: groupId, beforeId, onRow: false };
      const ly = rows.length ? (i === 0 ? inList(rows[0]).top : inList(rows[i - 1]).bottom) : pjBox.bottom;
      if (!isNoop(t)) showLine(ly, true);
      return t;
    }
    return null;
  };

  // Each pass either places the line (the target functions call showLine) or,
  // when nothing called it (no target, its own place, a project's own row),
  // hides it.
  // Whether the pane is lit up right now, so it is cleared exactly once.
  const paneLit = useRef(false);
  const lightPane = (t: PaneTarget | null) => {
    if (!t && !paneLit.current) return;
    paneLit.current = !!t;
    optsRef.current.paneHover?.(t);
  };

  const retarget = () => {
    const l = live.current;
    const scroller = optsRef.current.scrollRef.current;
    if (!l || l.pending || !scroller) return;
    // Past the panel's right edge a thread is over the main pane.
    const panel = scroller.closest<HTMLElement>('.side-panel') ?? scroller;
    if (l.kind === 'thread' && optsRef.current.paneAt && l.x > panel.getBoundingClientRect().right) {
      hideLine();
      const pane = optsRef.current.paneAt(l.id, l.x, l.y);
      l.target = { kind: 'pane', pane };
      lightPane(pane);
      const from = optsRef.current.listOf(l.id);
      update({ to: from, overProject: null });
      return;
    }
    lightPane(null);
    const y = l.y - scroller.getBoundingClientRect().top;
    linePlaced.current = false;
    l.target = l.kind === 'project' ? projectTarget(y) : threadTarget(y);
    if (!linePlaced.current) hideLine();
    const t = l.target;
    if (l.kind === 'thread') {
      const from = optsRef.current.listOf(l.id);
      const noop = !t || isNoop(t);
      const to = noop || t.kind !== 'thread' ? from : t.list;
      update({ to, overProject: !noop && t.kind === 'thread' && t.onRow ? t.list : null });
    }
  };

  const placeCard = () => {
    const l = live.current;
    const ghost = optsRef.current.ghostRef.current;
    if (!l || !ghost) return;
    ghost.style.left = `${l.x + CARD_OFFSET_X}px`;
    ghost.style.top = `${l.y - ghost.offsetHeight / 2}px`;
  };

  const edgeLoop = () => {
    const l = live.current;
    const scroller = optsRef.current.scrollRef.current;
    if (!l || l.pending || !scroller) return;
    if (l.target?.kind === 'pane') { l.raf = requestAnimationFrame(edgeLoop); return; }
    const r = scroller.getBoundingClientRect();
    const y = l.y - r.top;
    let v = 0;
    if (y < EDGE_PX) v = -Math.min(EDGE_MAX_SPEED, (EDGE_PX - y) / 3);
    else if (y > r.height - EDGE_PX) v = Math.min(EDGE_MAX_SPEED, (y - (r.height - EDGE_PX)) / 3);
    if (v) scroller.scrollTop += v;
    l.raf = requestAnimationFrame(edgeLoop);
  };

  const start = () => {
    const l = live.current!;
    l.pending = false;
    const rr = l.row.getBoundingClientRect();
    l.home = { left: rr.left, top: rr.top };
    const from = l.kind === 'thread' ? optsRef.current.listOf(l.id) : '';
    const next: DragState = { kind: l.kind, id: l.id, width: rr.width, from, to: from, overProject: null, returning: false };
    dragRef.current = next;
    setDrag(next);
    document.body.classList.add('panel-dragging');
    optsRef.current.onStart?.();
    l.raf = requestAnimationFrame(edgeLoop);
  };

  const finish = (drop: boolean) => {
    const l = live.current;
    live.current = null;
    removeListeners();
    document.body.classList.remove('panel-dragging');
    lightPane(null);
    if (!l) return;
    if (l.pending) return;
    cancelAnimationFrame(l.raf);
    hideLine();
    suppressClick.current = true;
    setTimeout(() => { suppressClick.current = false; }, 0);
    const t = drop && l.target && !isNoop(l.target, l) ? l.target : null;
    const ghost = optsRef.current.ghostRef.current;
    if (!t) {
      // Nowhere to land, Esc, or the same place: the card floats back.
      if (!ghost || reducedMotion()) { setDrag(null); return; }
      update({ returning: true, overProject: null });
      ghost.classList.add('back');
      ghost.style.left = `${l.home.left}px`;
      ghost.style.top = `${l.home.top}px`;
      setTimeout(() => { if (dragRef.current?.returning) setDrag(null); }, RETURN_MS);
      return;
    }
    const cardRect = ghost ? ghost.getBoundingClientRect() : l.row.getBoundingClientRect();
    optsRef.current.beforeDrop(l.id, l.kind, cardRect);
    setDrag(null);
    if (t.kind === 'pane') { if (paneDrops(t.pane)) optsRef.current.dropOnPane?.(l.id, t.pane); }
    else if (t.kind === 'project') optsRef.current.dropProject(l.id, t.section, t.beforeId);
    else optsRef.current.dropThread(l.id, t.list, t.beforeId);
  };

  const onMove = (e: PointerEvent) => {
    const l = live.current;
    if (!l) return;
    l.x = e.clientX; l.y = e.clientY;
    if (l.pending) {
      if (Math.hypot(e.clientX - l.x0, e.clientY - l.y0) < DRAG_START_PX) return;
      start();
    }
    placeCard();
    retarget();
  };
  const onUp = () => finish(true);
  const onCancel = () => finish(false);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && live.current && !live.current.pending) {
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    }
  };
  // Window listeners with one identity for the hook's lifetime, each calling the
  // latest render's handler (which reads the latest options).
  const handlers = useRef({ onMove, onUp, onCancel, onKey });
  handlers.current = { onMove, onUp, onCancel, onKey };
  const stable = useRef({
    move: (e: PointerEvent) => handlers.current.onMove(e),
    up: () => handlers.current.onUp(),
    cancel: () => handlers.current.onCancel(),
    key: (e: KeyboardEvent) => handlers.current.onKey(e),
  }).current;
  const listenersOn = useRef(false);
  const addListeners = () => {
    if (listenersOn.current) return;
    listenersOn.current = true;
    window.addEventListener('pointermove', stable.move);
    window.addEventListener('pointerup', stable.up);
    window.addEventListener('pointercancel', stable.cancel);
    window.addEventListener('keydown', stable.key, true);
  };
  const removeListeners = () => {
    if (!listenersOn.current) return;
    listenersOn.current = false;
    window.removeEventListener('pointermove', stable.move);
    window.removeEventListener('pointerup', stable.up);
    window.removeEventListener('pointercancel', stable.cancel);
    window.removeEventListener('keydown', stable.key, true);
  };
  useEffect(() => () => {
    removeListeners();
    if (live.current) cancelAnimationFrame(live.current.raf);
    document.body.classList.remove('panel-dragging');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || live.current || dragRef.current) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, input, .thmore')) return;
    const th = target.closest<HTMLElement>('.th[data-tid]');
    const pj = th ? null : target.closest<HTMLElement>('.pjw > .pj, .pjw .pj');
    const row = th ?? pj;
    if (!row) return;
    const block = pj?.closest<HTMLElement>('.pjw') ?? null;
    if (pj && !block) return;
    live.current = {
      pending: true,
      kind: th ? 'thread' : 'project',
      id: th ? th.dataset.tid! : block!.dataset.pjw!,
      row,
      src: th ?? block!,
      x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY,
      home: { left: 0, top: 0 },
      target: null,
      raf: 0,
    };
    addListeners();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The card has just mounted: put it by the pointer before it paints.
  const onCardMount = useCallback(() => placeCard(), []);

  return {
    drag,
    onPointerDown,
    onScroll: retarget,
    onCardMount,
    // A click right after a drag ends is the drag's own pointerup, not a click.
    shouldSuppressClick: () => suppressClick.current,
  };
}

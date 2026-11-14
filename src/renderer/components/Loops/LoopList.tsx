// The list of loops both Home's Progress column and the workspace card draw
// (design-07, mocks loops-home.html and loops-always-visible.html): rows, a loop
// opening in place (its row and a box under it become one #333 shape, the full
// width of the list, with the description and the status note, then its
// sub-loops), the fold animation, and the right-click menu with its actions.
//
// Every change goes to main through window.afterterm.loops.act as Aryan's own
// (it never replaces a loop's remembered chat). Open chat is the caller's: it
// knows the threads.
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Group } from '../TabBar/types';
import {
  ageText, loopStatus, LOOP_LABELS, openSubLoops, orderedSubLoops, subLoopFraction,
  type Loop, type LoopLabel,
} from '../../../loops';
import { LABEL_WORDS, projectLook } from '../../loopsView';
import { ClockIcon, LabelIcon, StatusIcon } from './LoopIcons';
import { LoopMenu, type LoopMenuItem } from './LoopMenu';
import { ConfirmDialog } from '../ConfirmDialog';
import { RenameDialog } from '../RenameDialog';
import type { LoopAction } from '../../../loops-store';
import './Loops.css';

export interface LoopListProps {
  loops: Loop[];          // every loop, for sub-loops and statuses
  rows: Loop[];           // the top-level loops to show, in order
  groups: Group[];
  now: number;
  variant: 'list' | 'card';
  // Changes when the filter changes: the rows then fade up into place.
  enterKey?: number;
  emptyText?: string | null; // null: nothing at all when there are no rows
  onOpenChat: (loop: Loop) => void;
  onToast?: (message: string, actionLabel?: string, onAction?: () => void) => void;
}

const EASE = 'cubic-bezier(.2,.8,.2,1)';
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function act(action: LoopAction) {
  return window.afterterm.loops.act(action);
}

export function LoopList({ loops, rows, groups, now, variant, enterKey, emptyText, onOpenChat, onToast }: LoopListProps) {
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; items: LoopMenuItem[] } | null>(null);
  const [rename, setRename] = useState<Loop | null>(null);
  const [confirm, setConfirm] = useState<{ loop: Loop; open: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const justOpened = useRef<string | null>(null);
  const closing = useRef<Set<string>>(new Set());

  // A loop that left the list (deleted, archived, filtered out) is no longer open.
  useEffect(() => {
    setOpened((prev) => {
      const ids = new Set(loops.filter((l) => !l.deletedAt).map((l) => l.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [loops]);

  // The parts that belong to an opened loop: its box, and for a top-level loop the
  // block of its sub-loops.
  const partsOf = (id: string): HTMLElement[] =>
    rootRef.current ? Array.from(rootRef.current.querySelectorAll<HTMLElement>(`[data-part-of="${CSS.escape(id)}"]`)) : [];

  // Opening: the box and the sub-loops grow from zero height and fade in, 240 ms,
  // the sub-loops 30 ms after the box.
  useLayoutEffect(() => {
    const id = justOpened.current;
    justOpened.current = null;
    if (!id || reduced()) return;
    partsOf(id).forEach((el, n) => {
      const h = el.offsetHeight;
      const cs = getComputedStyle(el);
      el.style.overflow = 'hidden';
      const a = el.animate(
        [
          { height: '0px', opacity: 0, marginTop: '0px', marginBottom: '0px', paddingTop: '0px', paddingBottom: '0px' },
          { height: `${h}px`, opacity: 1, marginTop: cs.marginTop, marginBottom: cs.marginBottom, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom },
        ],
        { duration: 240, delay: n * 30, easing: EASE, fill: 'backwards' },
      );
      a.onfinish = () => { el.style.overflow = ''; };
    });
  }, [opened]);

  const toggle = useCallback((id: string) => {
    if (closing.current.has(id)) return;
    if (!opened.has(id)) {
      justOpened.current = id;
      setOpened((prev) => new Set(prev).add(id));
      return;
    }
    const parts = partsOf(id);
    const finish = () => {
      closing.current.delete(id);
      setOpened((prev) => { const n = new Set(prev); n.delete(id); return n; });
    };
    if (reduced() || !parts.length) { finish(); return; }
    closing.current.add(id);
    let left = parts.length;
    parts.forEach((el) => {
      el.style.overflow = 'hidden';
      const a = el.animate(
        [
          { height: `${el.offsetHeight}px`, opacity: 1 },
          { height: '0px', opacity: 0, marginTop: '0px', marginBottom: '0px', paddingTop: '0px', paddingBottom: '0px' },
        ],
        { duration: 200, easing: EASE, fill: 'forwards' },
      );
      a.onfinish = () => { if (--left === 0) finish(); };
    });
  }, [opened]);

  // Rows fade up when the filter changes.
  const lastEnter = useRef(enterKey);
  const animateRows = enterKey !== undefined && enterKey !== lastEnter.current;
  useEffect(() => { lastEnter.current = enterKey; }, [enterKey]);

  const report = async (action: LoopAction, done?: string) => {
    const r = await act(action);
    if (!r.ok) { onToast?.(r.error); return false; }
    if (done) onToast?.(done);
    return true;
  };

  const closeOrReopen = (l: Loop) => {
    if (l.status === 'closed') { void report({ op: 'reopen', id: l.id }); return; }
    const open = l.parent ? 0 : openSubLoops(l.id, loops).length;
    if (open > 0) { setConfirm({ loop: l, open }); return; }
    void report({ op: 'close', id: l.id });
  };

  const menuFor = (l: Loop): LoopMenuItem[] => {
    if (l.deletedAt) {
      return [{ label: 'Restore', testId: 'restore', onSelect: () => void report({ op: 'restore', id: l.id }) }];
    }
    const isSub = !!l.parent;
    const closed = l.status === 'closed';
    const update: LoopMenuItem[] = [
      { label: 'Status', testId: 'status', kids: [
        { label: 'Open', check: !closed, testId: 'status-open', onSelect: () => { if (closed) closeOrReopen(l); } },
        { label: 'Closed', check: closed, testId: 'status-closed', onSelect: () => { if (!closed) closeOrReopen(l); } },
      ] },
      { label: 'Label', testId: 'label', kids: LOOP_LABELS.map((k: LoopLabel) => ({
        label: LABEL_WORDS[k], icon: <LabelIcon label={k} size={13} />, check: l.label === k, testId: `label-${k}`,
        onSelect: () => { if (l.label !== k) void report({ op: 'update', id: l.id, edit: { label: k } }); },
      })) },
      { label: 'Rename', testId: 'rename', onSelect: () => setRename(l) },
    ];
    if (!isSub) {
      const projects = [...groups].sort((a, b) => a.label.localeCompare(b.label));
      update.push({ label: 'Move to project', testId: 'move', kids: [
        ...projects.map((g) => ({
          label: g.label, check: l.project === g.id, testId: `move-${g.id}`,
          onSelect: () => { if (l.project !== g.id) void report({ op: 'update', id: l.id, edit: { project: g.id } }); },
        })),
        { label: 'General', check: l.project === null || !groups.some((g) => g.id === l.project), testId: 'move-general',
          onSelect: () => { if (l.project !== null) void report({ op: 'update', id: l.id, edit: { project: null } }); } },
      ] });
    }
    update.push(
      l.archivedAt
        ? { label: 'Unarchive', testId: 'unarchive', onSelect: () => void report({ op: 'unarchive', id: l.id }) }
        : { label: 'Archive', testId: 'archive', onSelect: () => void report({ op: 'archive', id: l.id }, 'Archived') },
      'sep',
      { label: 'Delete', danger: true, testId: 'delete', onSelect: async () => {
        if (await report({ op: 'delete', id: l.id })) {
          onToast?.('Deleted', 'Undo', () => void report({ op: 'restore', id: l.id }));
        }
      } },
    );
    return [
      { label: 'Open chat', testId: 'open-chat', onSelect: () => onOpenChat(l) },
      { label: closed ? 'Reopen' : 'Close', testId: closed ? 'reopen' : 'close', onSelect: () => closeOrReopen(l) },
      'sep',
      { label: 'Update', testId: 'update', kids: update },
    ];
  };

  const onContext = (e: React.MouseEvent, l: Loop) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items: menuFor(l) });
  };

  const details = (l: Loop) => (
    <div className="lp-det" data-part-of={l.id}>
      <div className="lp-dtx">
        {l.description ? <span className="lp-desc">{l.description}</span> : null}
        {l.note ? <span className="lp-stn"><ClockIcon size={11} /><span>{l.note}</span></span> : null}
        {!l.description && !l.note ? <span className="lp-stn"><span>No notes</span></span> : null}
      </div>
    </div>
  );

  const row = (l: Loop, sub: boolean, n: number) => {
    const status = loopStatus(l, loops, now);
    const isOpen = opened.has(l.id);
    const frac = sub ? null : subLoopFraction(l.id, loops);
    const look = projectLook(l.project, groups);
    const enter = animateRows && !sub;
    return (
      <button
        type="button"
        key={l.id}
        className={`lp-row${sub ? ' sub' : ''}${status === 'closed' ? ' closed' : ''}${isOpen ? ' open-row' : ''}${l.deletedAt ? ' deleted' : ''}${enter ? ' lp-enter' : ''}`}
        style={enter ? { animationDelay: `${Math.min(n * 28, 300)}ms` } : undefined}
        data-loop={l.id}
        data-status={status}
        onClick={() => toggle(l.id)}
        onContextMenu={(e) => onContext(e, l)}
      >
        <StatusIcon status={status} />
        <span className="lp-kind" data-tip={LABEL_WORDS[l.label]}><LabelIcon label={l.label} size={sub ? 11 : 12} /></span>
        <span className="lp-t1">{l.title}</span>
        {frac && <span className="lp-frac" data-frac="">{frac.closed}/{frac.total}</span>}
        {!sub && <span className="lp-pname" style={{ color: look.color }}>{look.name}</span>}
        <span className="lp-when">{ageText(l.activityAt, now)}</span>
      </button>
    );
  };

  return (
    <div ref={rootRef} className={`lp-list lp-${variant}`} data-loop-list={variant}>
      {rows.length === 0 ? (
        emptyText === null ? null : <div className="lp-empty">{emptyText ?? 'No loops'}</div>
      ) : (
        rows.map((l, n) => {
          const isOpen = opened.has(l.id);
          const subs = isOpen ? orderedSubLoops(l.id, loops) : [];
          return (
            <React.Fragment key={l.id}>
              {row(l, false, n)}
              {isOpen && details(l)}
              {isOpen && subs.length > 0 && (
                <div className="lp-subs" data-part-of={l.id}>
                  {subs.map((s, j) => (
                    <React.Fragment key={s.id}>
                      {row(s, true, j)}
                      {opened.has(s.id) && details(s)}
                    </React.Fragment>
                  ))}
                </div>
              )}
            </React.Fragment>
          );
        })
      )}
      {menu && <LoopMenu items={menu.items} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
      {rename && (
        <RenameDialog
          title="Rename loop"
          initial={rename.title}
          onSave={(name) => { const id = rename.id; setRename(null); if (name.trim() && name.trim() !== rename.title) void report({ op: 'update', id, edit: { title: name.trim() } }); }}
          onCancel={() => setRename(null)}
        />
      )}
      {confirm && (
        <ConfirmDialog
          title={`Close ${confirm.open} sub-loop${confirm.open === 1 ? '' : 's'}?`}
          body={confirm.loop.title}
          confirmLabel="Close all"
          cancelLabel="Cancel"
          onConfirm={() => { const id = confirm.loop.id; setConfirm(null); void report({ op: 'close', id, withSubLoops: true }); }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

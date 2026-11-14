// The loops right-click menu (design-07, "Menus"): items with an optional check
// column and icon, separators, and submenus that open BESIDE their parent (to the
// left when there is no room on the right), never in its place. Esc or a click
// outside closes the whole stack. Positioned in viewport coordinates, in a portal.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight } from './LoopIcons';

export type LoopMenuItem =
  | 'sep'
  | {
      label: string;
      icon?: React.ReactNode;
      check?: boolean; // present: the item has a check column
      danger?: boolean;
      kids?: LoopMenuItem[];
      onSelect?: () => void;
      testId?: string;
    };

interface Level {
  items: LoopMenuItem[];
  x: number;
  y: number;
  // The parent row's rectangle, for a submenu that must flip to the left.
  anchor?: DOMRect;
  parentLeft?: number;
  parentRight?: number;
  // A chain that had to turn left keeps going left.
  left?: boolean;
}

const MENU_W = 176;

function Panel({ level, depth, onOpenKids, onSelect, highlighted, onPlaced }: {
  level: Level;
  depth: number;
  highlighted: number | null;
  onPlaced: (depth: number, left: boolean) => void;
  onOpenKids: (depth: number, index: number, el: HTMLElement | null, menuEl: HTMLElement | null) => void;
  onSelect: (fn?: () => void) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: level.x, y: level.y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const W = window.innerWidth, H = window.innerHeight;
    let x = level.x, y = level.y;
    let left = false;
    if (level.anchor && level.parentLeft !== undefined) {
      const wantLeft = level.left || x + r.width > W - 4;
      if (wantLeft && level.parentLeft - r.width - 2 >= 4) { x = level.parentLeft - r.width - 2; left = true; }
      else if (level.parentRight !== undefined) x = level.parentRight + 2;
    }
    if (!level.anchor && x + r.width > W - 4) x = W - r.width - 4;
    if (y + r.height > H - 4) y = Math.max(4, H - r.height - 4);
    setPos({ x: Math.max(4, x), y });
    onPlaced(depth, left);
  }, [level]);
  return (
    <div ref={ref} className="lp-menu" style={{ left: pos.x, top: pos.y }} data-loop-menu={depth} onContextMenu={(e) => e.preventDefault()}>
      {level.items.map((it, i) => {
        if (it === 'sep') return <span key={i} className="lp-menu-sep" />;
        return (
          <button
            key={i}
            type="button"
            className={`${it.danger ? 'danger' : ''}${highlighted === i ? ' hl' : ''}`}
            data-menu-item={it.testId ?? it.label}
            onMouseEnter={(e) => onOpenKids(depth, i, it.kids ? e.currentTarget : null, ref.current)}
            onClick={(e) => {
              e.stopPropagation();
              if (it.kids) onOpenKids(depth, i, e.currentTarget, ref.current);
              else onSelect(it.onSelect);
            }}
          >
            {it.check !== undefined && <span className="chk">{it.check ? '✓' : ''}</span>}
            {it.icon && <span className="mi">{it.icon}</span>}
            <span className="lbl2">{it.label}</span>
            {it.kids && <span className="chev"><ChevronRight /></span>}
          </button>
        );
      })}
    </div>
  );
}

export function LoopMenu({ items, x, y, onClose }: { items: LoopMenuItem[]; x: number; y: number; onClose: () => void }) {
  const [levels, setLevels] = useState<Level[]>([{ items, x, y }]);
  const [hl, setHl] = useState<(number | null)[]>([null]);
  const sides = useRef<boolean[]>([]);
  const placed = (depth: number, left: boolean) => { sides.current[depth] = left; };
  useEffect(() => { setLevels([{ items, x, y }]); setHl([null]); }, [items, x, y]);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('[data-loop-menu]')) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    const blur = () => onClose();
    window.addEventListener('mousedown', down, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('mousedown', down, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', blur);
    };
  }, [onClose]);

  const openKids = (depth: number, index: number, el: HTMLElement | null, menuEl: HTMLElement | null) => {
    const item = levels[depth]?.items[index];
    setHl((prev) => [...prev.slice(0, depth), item && item !== 'sep' && item.kids ? index : null]);
    if (!el || !menuEl || !item || item === 'sep' || !item.kids) {
      setLevels((prev) => prev.slice(0, depth + 1));
      return;
    }
    const b = el.getBoundingClientRect();
    const m = menuEl.getBoundingClientRect();
    const kids = item.kids;
    setLevels((prev) => [...prev.slice(0, depth + 1), { items: kids, x: m.right + 2, y: b.top - 5, anchor: b, parentLeft: m.left, parentRight: m.right, left: !!sides.current[depth] }]);
  };

  const select = (fn?: () => void) => { onClose(); fn?.(); };

  return createPortal(
    <>
      {levels.map((lv, d) => (
        <Panel key={d + ':' + lv.x + ':' + lv.y} level={lv} depth={d} highlighted={hl[d] ?? null} onOpenKids={openKids} onSelect={select} onPlaced={placed} />
      ))}
    </>,
    document.body,
  );
}

export { MENU_W };

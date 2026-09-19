// Generic positioned menu: a small dropdown/context menu with optional one-level
// submenus. Used for the thread menu today; written generically so other menus
// (project row, group header) can reuse it later.
import React, { useLayoutEffect, useRef, useState } from 'react';
import { IconChevL, IconChevR } from './Icons';
import './Menu.css';

export interface MenuItem {
  label: string; // plain text
  icon?: React.ReactNode; // optional left slot
  right?: React.ReactNode; // optional right slot (a submenu gets the chevron automatically)
  disabled?: boolean;
  tip?: string; // rendered as data-tip on the row (the app has a global tooltip for data-tip)
  danger?: boolean;
  onSelect?: () => void;
  submenu?: { title: string; items: MenuItem[] };
}

export interface MenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

const VIEWPORT_MARGIN = 8;

function MenuRow({ item, onClose, onOpenSubmenu }: { item: MenuItem; onClose: () => void; onOpenSubmenu: () => void }) {
  const classes = ['menu-item', 'ctx-menu-item'];
  if (item.disabled) classes.push('disabled');
  if (item.danger) classes.push('danger');

  const handleClick = () => {
    if (item.disabled) return;
    if (item.submenu) {
      onOpenSubmenu();
      return;
    }
    if (item.onSelect) {
      item.onSelect();
      onClose();
    }
  };

  return (
    <div
      className={classes.join(' ')}
      onClick={handleClick}
      data-tip={item.tip}
      aria-disabled={item.disabled || undefined}
    >
      {item.icon && <span className="menu-icon">{item.icon}</span>}
      <span className="menu-label">{item.label}</span>
      {item.submenu ? (
        <span className="menu-right"><IconChevR size={16} /></span>
      ) : item.right ? (
        <span className="menu-right">{item.right}</span>
      ) : null}
    </div>
  );
}

export function Menu({ x, y, items, onClose }: MenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  // Stack of item lists: [rootItems, submenuItems, ...]. The last entry is the
  // panel currently shown; a title accompanies every entry but the root.
  const [stack, setStack] = useState<{ title?: string; items: MenuItem[] }[]>([
    { items },
  ]);

  const current = stack[stack.length - 1];

  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!element) return;

    const rect = element.getBoundingClientRect();
    const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - rect.width - VIEWPORT_MARGIN);
    const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - rect.height - VIEWPORT_MARGIN);
    const left = Math.min(Math.max(x, VIEWPORT_MARGIN), maxLeft);
    const top = Math.min(Math.max(y, VIEWPORT_MARGIN), maxTop);

    setPosition(current => (current.left === left && current.top === top ? current : { left, top }));
  }, [x, y, stack]);

  React.useEffect(() => {
    const handleMouseDown = () => onClose();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <div ref={menuRef} className="menu" style={position} onMouseDown={e => e.stopPropagation()}>
      {current.title !== undefined && (
        <div className="menu-head">
          <button
            type="button"
            className="menu-back"
            title="Back"
            onClick={() => setStack(s => s.slice(0, -1))}
          >
            <IconChevL size={16} />
          </button>
          <span className="menu-title">{current.title}</span>
        </div>
      )}
      {current.items.map((item, i) => (
        <MenuRow
          key={i}
          item={item}
          onClose={onClose}
          onOpenSubmenu={() => {
            if (item.submenu) {
              setStack(s => [...s, { title: item.submenu!.title, items: item.submenu!.items }]);
            }
          }}
        />
      ))}
    </div>
  );
}

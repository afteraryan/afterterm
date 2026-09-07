// The "New thread in" popover opened by the sidebar's New thread button and by
// Ctrl+Shift+T. Lets the user pick which project (or no project) the new
// thread starts in, and which shell it starts with. Ordering and filtering are
// pure logic in chooserView.ts; this file is only the rendering and the
// keyboard/mouse wiring.
import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { chooserItems, defaultShell } from '../../chooserView';
import type { Group } from '../TabBar/types';
import { FolderIcon, IconTerm, IconChevD, IconCheck } from '../Icons';
import { Menu, MenuItem } from '../Menu';
import './NewThreadChooser.css';

export interface NewThreadChooserProps {
  anchor: { x: number; y: number };
  groups: Group[];
  currentGroupId?: string;
  shells: { id: string; name: string }[];
  onPick: (groupId: string | undefined, shellId: string | undefined) => void;
  onClose: () => void;
}

const VIEWPORT_MARGIN = 8;

export function NewThreadChooser({
  anchor, groups, currentGroupId, shells, onPick, onClose,
}: NewThreadChooserProps) {
  const [query, setQuery] = useState('');
  const [hi, setHi] = useState(0);
  const [shellId, setShellId] = useState<string | undefined>(
    () => defaultShell(groups, currentGroupId) ?? shells[0]?.id,
  );
  const [shellMenu, setShellMenu] = useState<{ x: number; y: number } | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [position, setPosition] = useState({ left: anchor.x, top: anchor.y });

  const items = useMemo(() => chooserItems(groups, currentGroupId, query), [groups, currentGroupId, query]);

  const selectedShellName = shells.find(s => s.id === shellId)?.name
    ?? shells[0]?.name
    ?? '';

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - rect.width - VIEWPORT_MARGIN);
    const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - rect.height - VIEWPORT_MARGIN);
    const left = Math.min(Math.max(anchor.x, VIEWPORT_MARGIN), maxLeft);
    const top = Math.min(Math.max(anchor.y, VIEWPORT_MARGIN), maxTop);
    setPosition(current => (current.left === left && current.top === top ? current : { left, top }));
  }, [anchor.x, anchor.y, items.length]);

  useLayoutEffect(() => {
    inputRef.current?.focus();
  }, []);

  React.useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (rootRef.current && rootRef.current.contains(e.target as Node)) return;
      onClose();
    };
    window.addEventListener('mousedown', handleMouseDown);
    return () => window.removeEventListener('mousedown', handleMouseDown);
  }, [onClose]);

  const pick = (index: number) => {
    const item = items[index];
    if (!item) return;
    onPick(item.group ? item.group.id : undefined, shellId);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHi(h => Math.min(h + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHi(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      pick(hi);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  const shellMenuItems: MenuItem[] = shells.map(s => ({
    label: s.name,
    icon: <IconTerm size={16} />,
    right: s.id === shellId ? <IconCheck size={16} /> : undefined,
    onSelect: () => {
      setShellId(s.id);
      inputRef.current?.focus();
    },
  }));

  return (
    <div
      ref={rootRef}
      className="nt show"
      style={{ left: position.left, top: position.top }}
      onMouseDown={e => e.stopPropagation()}
    >
      <div className="hd">New thread in</div>
      <input
        ref={inputRef}
        placeholder="Type to filter"
        autoFocus
        value={query}
        onChange={e => { setHi(0); setQuery(e.target.value); }}
        onKeyDown={handleKeyDown}
      />
      <div className="opts">
        {items.length === 0 && <div className="nothing">No match</div>}
        {items.map((item, i) => (
          <button
            key={item.group ? item.group.id : 'none'}
            type="button"
            className={`opt${i === hi ? ' hi' : ''}`}
            data-group={item.group ? item.group.id : 'none'}
            onClick={() => pick(i)}
            onMouseEnter={() => setHi(i)}
          >
            {item.group ? <FolderIcon color={item.group.color} size={16} /> : <IconTerm size={16} />}
            <span className="n">{item.group ? item.group.label : 'No project'}</span>
            {item.tag && <span className="r">{item.tag}</span>}
          </button>
        ))}
      </div>
      <div className="foot">
        Shell
        <button
          type="button"
          className="shb"
          onClick={e => {
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            setShellMenu({ x: rect.right - 200, y: rect.bottom + 4 });
          }}
        >
          {selectedShellName}
          <span className="ch"><IconChevD size={15} /></span>
        </button>
      </div>
      {shellMenu && (
        <Menu
          x={shellMenu.x}
          y={shellMenu.y}
          items={shellMenuItems}
          onClose={() => setShellMenu(null)}
        />
      )}
    </div>
  );
}

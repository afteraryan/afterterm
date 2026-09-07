// The search palette (Ctrl+Shift+P): one flat, keyboard-navigable list across
// projects and threads. Filtering and ranking are pure logic in
// paletteView.ts; this file is only the rendering and the keyboard/mouse
// wiring.
import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { paletteResults } from '../../paletteView';
import { threadName, threadKind, threadState } from '../../threadView';
import type { Group, Tab } from '../TabBar/types';
import { FolderIcon, KindIcon, StateIcon } from '../Icons';
import './SearchPalette.css';

export interface SearchPaletteProps {
  groups: Group[];
  tabs: Tab[];
  onOpenProject: (groupId: string) => void;
  onOpenThread: (tabId: string) => void;
  onClose: () => void;
}

export function SearchPalette({ groups, tabs, onOpenProject, onOpenThread, onClose }: SearchPaletteProps) {
  const [query, setQuery] = useState('');
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const results = useMemo(() => paletteResults(groups, tabs, query), [groups, tabs, query]);
  const { projects, threads } = results;
  const total = projects.length + threads.length;

  useLayoutEffect(() => {
    inputRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    rowRefs.current[hi]?.scrollIntoView({ block: 'nearest' });
  }, [hi]);

  const open = (index: number) => {
    if (index < projects.length) {
      const group = projects[index];
      if (group) onOpenProject(group.id);
      return;
    }
    const thread = threads[index - projects.length];
    if (thread) onOpenThread(thread.tab.id);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHi(h => Math.min(h + 1, total - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHi(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      open(hi);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  // Escape closes from anywhere, not only from the input, in case focus has
  // wandered to the terminal behind the backdrop.
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  rowRefs.current = [];
  let flatIndex = -1;

  return (
    <div
      className="palbg show"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="pal" onMouseDown={e => e.stopPropagation()}>
        <input
          ref={inputRef}
          placeholder="Search projects and threads"
          autoFocus
          value={query}
          onChange={e => { setHi(0); setQuery(e.target.value); }}
          onKeyDown={handleKeyDown}
        />
        <div className="res">
          {total === 0 && <div className="nothing">No results</div>}
          {projects.length > 0 && (
            <>
              <div className="gl">Projects</div>
              {projects.map(group => {
                flatIndex++;
                const index = flatIndex;
                return (
                  <button
                    key={group.id}
                    type="button"
                    ref={el => { rowRefs.current[index] = el; }}
                    className={`pi${index === hi ? ' hi' : ''}`}
                    data-kind="project"
                    data-id={group.id}
                    onClick={() => open(index)}
                    onMouseEnter={() => setHi(index)}
                  >
                    <FolderIcon color={group.color} open size={16} />
                    <span className="n">{group.label}</span>
                    <span className="m"></span>
                  </button>
                );
              })}
            </>
          )}
          {threads.length > 0 && (
            <>
              <div className="gl">Threads</div>
              {threads.map(({ tab, group }) => {
                flatIndex++;
                const index = flatIndex;
                const kind = threadKind(tab);
                const state = threadState(tab);
                return (
                  <button
                    key={tab.id}
                    type="button"
                    ref={el => { rowRefs.current[index] = el; }}
                    className={`pi${index === hi ? ' hi' : ''}`}
                    data-kind="thread"
                    data-id={tab.id}
                    onClick={() => open(index)}
                    onMouseEnter={() => setHi(index)}
                  >
                    <KindIcon kind={kind} size={15} />
                    <span className="n">{threadName(tab)}</span>
                    {state !== 'quiet' && <StateIcon state={state} size={15} />}
                    <span className="m">{group ? group.label : 'General'}</span>
                  </button>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// The main pane's header: kind icon and thread name on line 1, the project
// (and, from Phase 3 on, model / branch / worktree) on line 2, the state
// chip and the thread's dots menu on the right. See "Workspace" -> "Main
// pane" in docs/design-02-projects-and-threads.md and PHASES.md Phase 1.
import React, { useCallback, useRef, useState } from 'react';
import { Tab, Group } from '../TabBar/types';
import { FolderIcon, IconBranch, IconModel, IconMore, IconTerm, IconWorktree, KindIcon, StateIcon } from '../Icons';
import { Menu } from '../Menu';
import { buildThreadMenu, ThreadMenuActions } from '../../threadMenu';
import { threadKind, threadName, threadState, stateLabel, modelLabel, runningLabel } from '../../threadView';
import { asleepLabel } from '../../sleepWake';
import './Header.css';

// Matches the menu's own min-width (Menu.css), so the panel opens flush with
// the button's right edge before Menu's own viewport clamp can adjust it.
const MENU_WIDTH = 200;

export interface HeaderProps {
  tab: Tab | undefined;
  group: Group | undefined;
  groups: Group[];
  // Undefined only when there is no active tab (nothing to act on).
  actions?: ThreadMenuActions;
  // Clock reading for the asleep chip's "Asleep · 2d" wording (asleepLabel).
  // Required, not read from Date.now() here, so the chip updates on the same
  // tick as the rest of the app instead of drifting on its own render timing.
  now: number;
}

export function Header({ tab, group, groups, actions, now }: HeaderProps) {
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);

  const openMenu = useCallback(() => {
    const rect = moreButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuPos({ x: rect.right - MENU_WIDTH, y: rect.bottom + 4 });
  }, []);
  const closeMenu = useCallback(() => setMenuPos(null), []);

  if (!tab) {
    return (
      <div className="header">
        <span className="header-empty">Pick a thread</span>
      </div>
    );
  }

  const kind = threadKind(tab);
  const state = threadState(tab);
  const model = kind === 'chat' ? modelLabel(tab.model) : null;

  return (
    <div className="header">
      <div className="header-title">
        <div className="header-name">
          <KindIcon kind={kind} />
          <span>{threadName(tab)}</span>
        </div>
        <div className="header-meta">
          <span className="header-meta-item" data-meta="project">
            {group ? <FolderIcon color={group.color} open size={14} /> : <IconTerm size={14} />}
            {group ? group.label : 'General'}
          </span>
          {model && (
            <span className="header-meta-item" data-meta="model">
              <IconModel size={14} />
              {model}
            </span>
          )}
          {tab.branch && (
            <span className="header-meta-item" data-meta="branch">
              <IconBranch size={14} />
              {tab.branch}
            </span>
          )}
          {tab.worktree && (
            <span className="header-meta-item header-meta-worktree" data-meta="worktree">
              <IconWorktree size={14} />
              <span className="header-meta-text">{tab.worktree}</span>
            </span>
          )}
        </div>
      </div>
      <div className="header-actions">
        {state !== 'quiet' && (
          <span className="chip header-chip">
            <StateIcon state={state} />
            {state === 'asleep'
              ? asleepLabel(tab.sleptAt, now)
              : state === 'running' && tab.port !== undefined
                ? runningLabel(tab.port)
                : stateLabel(state)}
          </span>
        )}
        {actions && (
          <button ref={moreButtonRef} className="ic" data-tip="More" onClick={openMenu}>
            <IconMore size={18} />
          </button>
        )}
      </div>
      {menuPos && actions && (
        <Menu
          x={menuPos.x}
          y={menuPos.y}
          items={buildThreadMenu(tab, groups, actions)}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}

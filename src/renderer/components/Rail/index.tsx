// The always-on rail: a 76px column at the left edge of every screen (Home,
// the workspace, the project page). The sidebar toggle sits first, always, in
// the same place on every screen and whether the panel is open or not (Aryan,
// 2026-09-25: it used to appear only while the panel was hidden, so the Home
// button slid up into its spot and a second click on the same place opened
// Home); it is the only sidebar toggle, the panel has none of its own. Then the
// Home/Workspace pill, Search/New thread only while the panel is hidden on the
// workspace, then one tile per project that has something pending (a thread
// waiting for you, working, compacting or finished, unviewed; compacting is a
// corner icon on the tile, the rest are counts beside it). See
// docs/design-03-sidebar-and-attention.md decision 1 and
// docs/mockups/design-03-final-sidebar.html (.railblk, .navseg, .rail2, .l1,
// .col, .bd2, the rail()/railTile() functions), whose values this component
// copies rather than its markup.
import React, { useState } from 'react';
import type { Tab, Group } from '../TabBar/types';
import { GROUP_COLORS } from '../TabBar/types';
import { IconHome, IconTerm, IconPanel, IconSearch, IconPlus, IconFolder, IconCompact, ProjectIcon } from '../Icons';
import { railProjects, projectAttention } from '../../attention';
import { buildProjectMenu, ProjectActions } from '../../projectMenu';
import { Menu, MenuItem } from '../Menu';
import type { EditorInfo } from '../../../editors';
import './Rail.css';

export interface RailProps {
  screen: 'home' | 'workspace' | 'project';
  // Whether the panel is hidden on the workspace; the rail's two tool blocks open
  // only when this is true AND screen === 'workspace'.
  panelHidden: boolean;
  groups: Group[];
  tabs: Tab[];
  editors: EditorInfo[];
  folderExists: Record<string, boolean>; // keyed by folder path
  projectActions: ProjectActions;
  onGoHome: () => void;
  onGoWorkspace: () => void;
  // On the workspace, hides or shows the panel; on Home and the project page,
  // which have no panel, opens the workspace with the panel showing.
  onTogglePanel: () => void;
  onSearch: () => void;
  onNewThread: (anchor: { x: number; y: number }) => void; // bottom-left of the button + 6px, same as the sidebar's openChooserUnder
  onOpenProject: (groupId: string) => void; // a tile click
}

export function Rail({
  screen,
  panelHidden,
  groups,
  tabs,
  editors,
  folderExists,
  projectActions,
  onGoHome,
  onGoWorkspace,
  onTogglePanel,
  onSearch,
  onNewThread,
  onOpenProject,
}: RailProps) {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);

  const open = panelHidden && screen === 'workspace';
  // The project page is a page you visit from Home, not its own place in the
  // pill: the thumb sits at Home and Home reads selected there too.
  const homeSelected = screen === 'home' || screen === 'project';

  const tiles = railProjects(groups, tabs);
  const counts = projectAttention(groups, tabs);

  const openProjectMenu = (e: React.MouseEvent, group: Group) => {
    e.preventDefault();
    const folderMissing = !!group.cwd && folderExists[group.cwd] === false;
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: buildProjectMenu(group, { editors, folderMissing }, projectActions),
    });
  };

  const handleNewThread = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    onNewThread({ x: rect.left, y: rect.bottom + 6 });
  };

  return (
    <div className="rail-bar" data-screen={screen}>
      <button
        className="ic rail-toggle"
        data-tip={screen === 'workspace' && !panelHidden ? 'Close sidebar' : 'Open sidebar'}
        data-tip-side="right"
        data-toggle-panel=""
        onClick={onTogglePanel}
      >
        <IconPanel size={18} />
      </button>

      <div className={'navseg' + (homeSelected ? '' : ' at-work')}>
        <span className="thumb" />
        <button
          className="ic"
          data-go="home"
          aria-selected={homeSelected}
          data-tip="Home"
          data-tip-side="right"
          onClick={onGoHome}
        >
          <IconHome size={18} />
        </button>
        <button
          className="ic"
          data-go="work"
          aria-selected={!homeSelected}
          data-tip="Workspace"
          data-tip-side="right"
          onClick={onGoWorkspace}
        >
          <IconTerm size={18} />
        </button>
      </div>

      <div className={'railblk' + (open ? ' open' : '')}>
        <div>
          <button
            className="ic"
            data-tip="Search"
            data-tip-side="right"
            tabIndex={open ? 0 : -1}
            onClick={onSearch}
          >
            <IconSearch size={18} />
          </button>
          <button
            className="ic"
            data-tip="New thread"
            data-tip-side="right"
            data-new-thread=""
            tabIndex={open ? 0 : -1}
            onClick={handleNewThread}
          >
            <IconPlus size={18} />
          </button>
        </div>
      </div>

      <span className="sep" />

      <div className="tiles">
        {tiles.map(group => {
          const c = counts.get(group.id);
          const tc = GROUP_COLORS[group.color].border;
          return (
            <div className="l1" data-tile={group.id} key={group.id}>
              <button
                className="tile"
                style={{ '--tc': tc } as React.CSSProperties}
                data-tip={group.label}
                data-tip-side="right"
                onClick={() => onOpenProject(group.id)}
                onContextMenu={e => openProjectMenu(e, group)}
              >
                {group.icon ? <ProjectIcon icon={group.icon} size={20} /> : <IconFolder size={20} />}
                {/* Compacting is not a count in the column: it sits as its own icon on
                    the tile's top-left corner (Aryan, 2026-09-19). */}
                {!!c && c.compacting > 0 && (
                  <span className="corner compact" data-corner="compacting" data-tip="Compacting" data-tip-side="right">
                    <IconCompact size={12} />
                  </span>
                )}
              </button>
              <span className="col">
                {!!c && c.waiting > 0 && (
                  <span className="bd w" data-badge="waiting" data-tip="Waiting for you" data-tip-side="right">
                    {c.waiting}
                  </span>
                )}
                {!!c && c.working > 0 && (
                  <span className="bd k" data-badge="working" data-tip="Working" data-tip-side="right">
                    {c.working}
                  </span>
                )}
                {!!c && c.finished > 0 && (
                  <span className="bd d" data-badge="finished" data-tip="Finished" data-tip-side="right">
                    {c.finished}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      <span className="grow" />

      {menu && <Menu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

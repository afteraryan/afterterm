// The always-on rail: a 76px column at the left edge of every screen (Home,
// the workspace, the project page). Shows the sidebar toggle and Search/New
// thread only while the panel is hidden on the workspace, the Home/Workspace
// pill, then one tile per project that has something pending (a thread
// waiting for you, working, compacting or finished, unviewed). See
// docs/design-03-sidebar-and-attention.md decision 1 and
// docs/mockups/design-03-final-sidebar.html (.railblk, .navseg, .rail2, .l1,
// .col, .bd2, the rail()/railTile() functions), whose values this component
// copies rather than its markup.
import React, { useState } from 'react';
import type { Tab, Group } from '../TabBar/types';
import { GROUP_COLORS } from '../TabBar/types';
import { IconHome, IconTerm, IconPanel, IconSearch, IconPlus, IconFolder, ProjectIcon } from '../Icons';
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
      <div className={'railblk' + (open ? ' open' : '')}>
        <div>
          <button
            className="ic"
            data-tip="Open sidebar"
            data-tip-side="right"
            data-toggle-panel=""
            tabIndex={open ? 0 : -1}
            onClick={onTogglePanel}
          >
            <IconPanel size={18} />
          </button>
        </div>
      </div>

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
                {!!c && c.compacting > 0 && (
                  <span className="bd c" data-badge="compacting" data-tip="Compacting" data-tip-side="right">
                    {c.compacting}
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

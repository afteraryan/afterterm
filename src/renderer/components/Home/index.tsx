// The Home screen (mock #view-home / renderHome): "what am I working on right
// now" as a date heading, pinned project cards, a compact list of the other
// projects, and archived projects tucked behind one toggle. No sidebar.
import React, { useState } from 'react';
import { Tab, Group } from '../TabBar/types';
import { ScreenNav } from '../ScreenNav';
import { Menu, MenuItem } from '../Menu';
import { FolderIcon, IconPage, IconPin, IconPinOn, IconPlus, StateIcon } from '../Icons';
import { threadState, projectCounts } from '../../threadView';
import { dateHeading, relativeTime, homeSections, homeTotals, lastHereLine } from '../../homeView';
import { buildProjectMenu, ProjectActions } from '../../projectMenu';
import type { EditorInfo } from '../../../editors';
import './Home.css';

export interface HomeProps {
  groups: Group[];
  tabs: Tab[];
  now: number;
  editors: EditorInfo[];
  folderExists: Record<string, boolean>; // keyed by folder path
  actions: ProjectActions;
  onNewProject: () => void;
  // Not in the original contract: ScreenNav needs somewhere to send a click
  // on the Workspace icon. The Home icon click is a no-op here (already home).
  onGoWorkspace: () => void;
}

const PROJECT_LIMIT = 4;

export function Home({ groups, tabs, now, editors, folderExists, actions, onNewProject, onGoWorkspace }: HomeProps) {
  const [showAll, setShowAll] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);

  const { pinned, projects, shownProjects, archived } = homeSections(groups, tabs, {
    showAll,
    limit: PROJECT_LIMIT,
  });
  const totals = homeTotals(groups, tabs);

  // The last-opened experiment (PHASES.md Phase 3, CLAUDE.md "Experiment: last
  // opened on Home"). Aryan runs this as a user; whenever work on afterterm
  // resumes, ask him whether it was useful, then keep or remove it. Deliberately
  // this small: one quiet line, nothing else changes because of it. Guarded so a
  // render without preload (a unit-style render, or a test harness) never throws.
  const lastHere = lastHereLine(window.afterterm?.app?.lastOpenedAt ?? null, now);

  const tabsOf = (groupId: string) => tabs.filter(t => t.groupId === groupId);

  const isFolderMissing = (group: Group) => !!group.cwd && folderExists[group.cwd] === false;

  const openProjectMenu = (e: React.MouseEvent, group: Group) => {
    e.preventDefault();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: buildProjectMenu(group, { editors, folderMissing: isFolderMissing(group) }, actions),
    });
  };

  const activateOnEnter = (groupId: string) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') actions.open(groupId);
  };

  const pinButton = (group: Group) => (
    <button
      type="button"
      className={`ib${group.pinned ? ' on' : ''}`}
      data-pin={group.id}
      data-tip={group.pinned ? 'Unpin' : 'Pin'}
      onClick={e => { e.stopPropagation(); actions.togglePin(group.id); }}
    >
      {group.pinned ? <IconPinOn size={16} /> : <IconPin size={16} />}
    </button>
  );

  const pageButton = (group: Group) => (
    <button
      type="button"
      className="ib go"
      data-page={group.id}
      data-tip="Open project page"
      onClick={e => { e.stopPropagation(); actions.openPage(group.id); }}
    >
      <IconPage size={16} />
    </button>
  );

  const counterPills = (group: Group) => {
    const counts = projectCounts(tabsOf(group.id).map(threadState));
    return (
      <>
        {counts.needsYou > 0 && (
          <span className="sig need"><StateIcon state="needs-you" size={14} />{counts.needsYou}</span>
        )}
        {counts.running > 0 && (
          <span className="sig run"><StateIcon state="running" size={14} />{counts.running}</span>
        )}
      </>
    );
  };

  const renderCard = (group: Group) => (
    <div
      key={group.id}
      className="cd"
      data-group={group.id}
      role="button"
      tabIndex={0}
      onClick={() => actions.open(group.id)}
      onKeyDown={activateOnEnter(group.id)}
      onContextMenu={e => openProjectMenu(e, group)}
    >
      <div className="hd">
        <FolderIcon color={group.color} open size={18} />
        <span className="n">{group.label}</span>
        {pageButton(group)}
        {pinButton(group)}
      </div>
      <div className="f">
        {counterPills(group)}
        <span className="ago">{relativeTime(group.lastActiveAt, now)}</span>
      </div>
    </div>
  );

  const renderRow = (group: Group, archivedRow: boolean) => (
    <div
      key={group.id}
      className={`pr${archivedRow ? ' archived' : ''}`}
      data-group={group.id}
      role="button"
      tabIndex={0}
      onClick={() => actions.open(group.id)}
      onKeyDown={activateOnEnter(group.id)}
      onContextMenu={e => openProjectMenu(e, group)}
    >
      <FolderIcon color={group.color} open size={18} />
      <div className="tx">
        <div className="n">{group.label}</div>
      </div>
      {counterPills(group)}
      <span className="t">{relativeTime(group.lastActiveAt, now)}</span>
      {archivedRow ? (
        <button
          type="button"
          className="b q s"
          data-restore={group.id}
          onClick={e => { e.stopPropagation(); actions.restore(group.id); }}
        >
          Restore
        </button>
      ) : (
        <>
          {pageButton(group)}
          {pinButton(group)}
        </>
      )}
    </div>
  );

  return (
    <div className="screen-home">
      <ScreenNav screen="home" onGo={s => { if (s === 'workspace') onGoWorkspace(); }} />
      <div className="home">
        <div>
          <h1 className="home-date">{dateHeading(now)}</h1>
          {(totals.needsYou > 0 || totals.running > 0) && (
            <div className="sub tot">
              {totals.needsYou > 0 && (
                <span className="sig need"><StateIcon state="needs-you" size={14} />{totals.needsYou}</span>
              )}
              {totals.running > 0 && (
                <span className="sig run"><StateIcon state="running" size={14} />{totals.running}</span>
              )}
            </div>
          )}
          {lastHere && <div className="home-lasthere">{lastHere}</div>}
        </div>

        <div>
          <div className="lbl">Pinned</div>
          {pinned.length > 0 ? (
            <div className="cards">{pinned.map(renderCard)}</div>
          ) : (
            <div className="nothing">Pin a project to keep it here</div>
          )}
        </div>

        <div>
          <div className="lbl lblrow">
            <span>Projects</span>
            <button
              type="button"
              className="ib"
              data-newproj=""
              data-tip="New project"
              onClick={onNewProject}
            >
              <IconPlus size={16} />
            </button>
          </div>
          <div className="list">
            {shownProjects.map(g => renderRow(g, false))}
            {projects.length > PROJECT_LIMIT && (
              <button type="button" className="more" data-more="" onClick={() => setShowAll(v => !v)}>
                {showAll ? 'Show less' : 'Show more'}
              </button>
            )}
          </div>
        </div>

        {archived.length > 0 && (
          <div>
            <button
              type="button"
              className="more"
              data-archived=""
              onClick={() => setShowArchived(v => !v)}
            >
              {`Archived · ${archived.length}`}
            </button>
            {showArchived && (
              <div className="list">{archived.map(g => renderRow(g, true))}</div>
            )}
          </div>
        )}
      </div>

      {menu && <Menu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

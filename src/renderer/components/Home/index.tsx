// The Home screen, in the Progress layout (design-07, mock loops-home.html):
// left, the projects section (the date heading, pinned project cards, the other
// projects in two columns with a search box); right, the Progress column (the
// streak calendar, the loop counts, the filter and every loop). The page never
// scrolls; each side scrolls on its own. Progress closes with a slide, and a
// "Progress N" button brings it back. No sidebar; the Home and Workspace icons live
// on the always-on rail to the left (Rail/).
import React, { useLayoutEffect, useRef, useState } from 'react';
import { Tab, Group } from '../TabBar/types';
import { Menu, MenuItem } from '../Menu';
import { FolderIcon, IconPage, IconPin, IconPinOn, IconPlus, StateIcon } from '../Icons';
import { threadState, projectCounts } from '../../threadView';
import { dateHeading, relativeTime, homeSections, homeTotals, lastHereLine, hasNoProjects } from '../../homeView';
import { buildProjectMenu, ProjectActions } from '../../projectMenu';
import type { EditorInfo } from '../../../editors';
import { loopCounts, type Loop } from '../../../loops';
import type { LoopFilter } from '../../loopsView';
import { Progress } from './Progress';
import { PanelCloseIcon } from '../Loops/LoopIcons';
import './Home.css';

export interface HomeProps {
  groups: Group[];
  tabs: Tab[];
  now: number;
  editors: EditorInfo[];
  folderExists: Record<string, boolean>; // keyed by folder path
  actions: ProjectActions;
  onNewProject: () => void;
  loops: Loop[];
  days: Record<string, number>;
  progressOpen: boolean;
  setProgressOpen: (open: boolean) => void;
  filter: LoopFilter;
  setFilter: (f: LoopFilter) => void;
  onOpenLoopChat: (loop: Loop) => void;
  onToast: (message: string, actionLabel?: string, onAction?: () => void) => void;
}

// Two columns of projects: six rows until Show more.
const PROJECT_LIMIT = 6;

function SearchIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" />
    </svg>
  );
}

// The Projects heading's search box: always faintly there, no placeholder, a fixed
// width; a query longer than the box shows its end, with an ellipsis over the cut
// start.
function ProjectSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const mark = () => {
    const el = input.current;
    if (!el) return;
    const overflowing = el.scrollWidth > el.clientWidth + 1;
    if (overflowing && document.activeElement !== el) el.scrollLeft = el.scrollWidth;
    setOver(overflowing && el.scrollLeft > 0);
  };
  useLayoutEffect(mark, [value]);
  return (
    <label className={`psearch${over ? ' over' : ''}`} data-project-search="">
      <SearchIcon />
      <span className="dots">{'…'}</span>
      <input
        ref={input}
        type="text"
        aria-label="Search projects"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyUp={mark}
        onScroll={mark}
        onFocus={() => setTimeout(mark, 0)}
        onBlur={() => setTimeout(mark, 0)}
        onKeyDown={(e) => { if (e.key === 'Escape') { onChange(''); (e.target as HTMLInputElement).blur(); } }}
      />
    </label>
  );
}

export function Home({
  groups, tabs, now, editors, folderExists, actions, onNewProject,
  loops, days, progressOpen, setProgressOpen, filter, setFilter, onOpenLoopChat, onToast,
}: HomeProps) {
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);

  const { pinned, projects, shownProjects } = homeSections(groups, tabs, {
    showAll,
    limit: PROJECT_LIMIT,
  });
  const q = query.trim().toLowerCase();
  const listed = q ? projects.filter(g => g.label.toLowerCase().includes(q)) : shownProjects;
  const totals = homeTotals(groups, tabs);
  const noProjects = hasNoProjects(groups);
  const remaining = loopCounts(loops, now).remaining;

  // The last-opened experiment (docs/phases-01-projects-and-threads.md Phase 3, CLAUDE.md "Experiment: last
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
      {group.pinned ? <IconPinOn size={14} /> : <IconPin size={14} />}
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
      <IconPage size={14} />
    </button>
  );

  const counterPills = (group: Group) => {
    const counts = projectCounts(tabsOf(group.id).map(threadState));
    return (
      <>
        {counts.needsYou > 0 && (
          <span className="sig need"><StateIcon state="needs-you" size={13} />{counts.needsYou}</span>
        )}
        {counts.working > 0 && (
          <span className="sig work"><StateIcon state="working" size={10} />{counts.working}</span>
        )}
        {counts.background > 0 && (
          <span className="sig bg"><StateIcon state="background" size={12} />{counts.background}</span>
        )}
        {counts.running > 0 && (
          <span className="sig run"><StateIcon state="running" size={13} />{counts.running}</span>
        )}
        {counts.compacting > 0 && (
          <span className="sig compact"><StateIcon state="compacting" size={13} />{counts.compacting}</span>
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
        <FolderIcon color={group.color} open size={16} icon={group.icon} />
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

  const renderRow = (group: Group) => (
    <div
      key={group.id}
      className="pr"
      data-group={group.id}
      role="button"
      tabIndex={0}
      onClick={() => actions.open(group.id)}
      onKeyDown={activateOnEnter(group.id)}
      onContextMenu={e => openProjectMenu(e, group)}
    >
      <FolderIcon color={group.color} open size={14} icon={group.icon} />
      <div className="tx">
        <div className="n">{group.label}</div>
      </div>
      {counterPills(group)}
      <span className="t">{relativeTime(group.lastActiveAt, now)}</span>
      {pageButton(group)}
      {pinButton(group)}
    </div>
  );

  return (
    <div className="screen-home">
      <div className={`home-lay${progressOpen ? '' : ' closed'}`} data-progress-open={progressOpen ? 'true' : 'false'}>
        {!progressOpen && (
          <button type="button" className="pg-reopen" data-act="progress-open" onClick={() => setProgressOpen(true)}>
            <PanelCloseIcon size={15} />Progress <b>{remaining}</b>
          </button>
        )}
        <div className="home-scroll">
          <div className="home">
            <div>
              <h1 className="home-date">{dateHeading(now)}</h1>
              {(totals.needsYou > 0 || totals.working > 0 || totals.background > 0 || totals.running > 0 || totals.compacting > 0) && (
                <div className="sub tot">
                  {totals.needsYou > 0 && (
                    <span className="sig need"><StateIcon state="needs-you" size={13} />{totals.needsYou}</span>
                  )}
                  {totals.working > 0 && (
                    <span className="sig work"><StateIcon state="working" size={10} />{totals.working}</span>
                  )}
                  {totals.background > 0 && (
                    <span className="sig bg"><StateIcon state="background" size={12} />{totals.background}</span>
                  )}
                  {totals.running > 0 && (
                    <span className="sig run"><StateIcon state="running" size={13} />{totals.running}</span>
                  )}
                  {totals.compacting > 0 && (
                    <span className="sig compact"><StateIcon state="compacting" size={13} />{totals.compacting}</span>
                  )}
                </div>
              )}
              {lastHere && <div className="home-lasthere">{lastHere}</div>}
            </div>

            {!noProjects && (
              <div>
                <div className="lbl">Pinned</div>
                {pinned.length > 0 ? (
                  <div className="cards">{pinned.map(renderCard)}</div>
                ) : (
                  <div className="nothing">Pin a project to keep it here</div>
                )}
              </div>
            )}

            <div>
              <div className="lbl lblrow">
                <span>Projects</span>
                <span className="grow" />
                {!noProjects && <ProjectSearch value={query} onChange={setQuery} />}
                {!noProjects && (
                  <button
                    type="button"
                    className="ib"
                    data-newproj=""
                    data-tip="New project"
                    onClick={onNewProject}
                  >
                    <IconPlus size={14} />
                  </button>
                )}
              </div>
              {/* No project yet: one large button in the middle of the section, the
                  one thing to do on a fresh install (Aryan, 2026-10-29). */}
              {noProjects && (
                <button type="button" className="first-project" data-first-project="" onClick={onNewProject}>
                  <span className="plus"><IconPlus size={20} /></span>
                  <span className="t1">Create your first project</span>
                </button>
              )}
              {q && listed.length === 0 ? (
                <div className="nothing small">No projects</div>
              ) : (
                <div className="list">{listed.map(renderRow)}</div>
              )}
              {!q && projects.length > PROJECT_LIMIT && (
                <button type="button" className="more" data-more="" onClick={() => setShowAll(v => !v)}>
                  {showAll ? 'Show less' : 'Show more'}
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="prog-wrap">
          <Progress
            loops={loops}
            groups={groups}
            now={now}
            days={days}
            filter={filter}
            setFilter={setFilter}
            onClose={() => setProgressOpen(false)}
            onOpenChat={onOpenLoopChat}
            onToast={onToast}
          />
        </div>
      </div>

      {menu && <Menu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

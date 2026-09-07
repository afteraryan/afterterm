// The project page (mock #view-project / renderProject): reached only through
// the project page icon or a project's right-click menu, never by clicking a
// Home card or row directly. Shows the folder, its default shell, the action
// row, and the project's threads split into Live, Asleep and History (History
// stays empty this phase: no sleep/wake, no closing-to-history yet).
import React, { useState } from 'react';
import { Tab, Group } from '../TabBar/types';
import { ScreenNav } from '../ScreenNav';
import { Menu, MenuItem } from '../Menu';
import {
  FolderIcon, IconChevL, IconSearch, IconExplorer, EditorLogo, KindIcon, StateIcon,
  IconBranch, IconWorktree,
} from '../Icons';
import { threadKind, threadState, threadName } from '../../threadView';
import { relativeTime, filterThreads, splitLiveAsleep } from '../../homeView';
import { buildProjectMenu, ProjectActions } from '../../projectMenu';
import type { EditorInfo } from '../../../editors';
import './ProjectPage.css';

export interface ProjectPageProps {
  group: Group;
  tabs: Tab[]; // this project's threads, sidebar order
  activeTabId: string;
  now: number;
  editors: EditorInfo[];
  folderMissing: boolean;
  actions: ProjectActions;
  onOpenThread: (tabId: string) => void; // select it and go to the workspace
  threadMenu: (tab: Tab) => MenuItem[]; // the one thread menu, built by the caller
  onBack: () => void; // "Home" link at the top
  // Not in the original contract: ScreenNav needs somewhere to send a click
  // on the Workspace icon (its Home icon reuses onBack).
  onGoWorkspace: () => void;
}

type ProjectTab = 'live' | 'asleep' | 'history';

const SHELL_NAMES: Record<string, string> = {
  cmd: 'Command Prompt',
  pwsh: 'PowerShell 7',
  powershell: 'Windows PowerShell',
  gitbash: 'Git Bash',
  wsl: 'WSL',
};

function shellName(shellId: string | undefined): string {
  if (!shellId) return 'Default shell';
  return SHELL_NAMES[shellId] ?? 'Default shell';
}

// The word before the " · " separators in a row's detail line: what mock's
// kindWord dictionary uses ("Chat" / "Shell").
const KIND_WORD: Record<'chat' | 'shell', string> = { chat: 'Chat', shell: 'Shell' };

export function ProjectPage({
  group, tabs, activeTabId, now, editors, folderMissing, actions,
  onOpenThread, threadMenu, onBack, onGoWorkspace,
}: ProjectPageProps) {
  const [tab, setTab] = useState<ProjectTab>('live');
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);

  const { live, asleep } = splitLiveAsleep(tabs);
  // History arrives with sleep/wake and closing-to-history (later phases);
  // the tab exists now so the layout and the empty state are already right.
  const history: Tab[] = [];

  const hasFolder = !!group.cwd;
  const primaryEditor = editors[0];

  const listForTab = tab === 'live' ? live : tab === 'asleep' ? asleep : history;
  const filtered = filterThreads(listForTab, query);
  const emptyLabel = tab === 'live' ? 'Nothing running' : tab === 'asleep' ? 'Nothing asleep' : 'Nothing here yet';

  const openHeaderMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, items: buildProjectMenu(group, { editors, folderMissing }, actions) });
  };

  const openRowMenu = (e: React.MouseEvent, t: Tab) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, items: threadMenu(t) });
  };

  return (
    <div className="screen-project">
      <ScreenNav
        screen="project"
        onGo={s => (s === 'workspace' ? onGoWorkspace() : onBack())}
      />
      <div className="proj">
        <button type="button" className="back" onClick={onBack}>
          <IconChevL size={16} />
          Home
        </button>

        <div className="ph" onContextMenu={openHeaderMenu}>
          <h1>
            <FolderIcon color={group.color} open size={26} />
            {group.label}
          </h1>
          <p className="f">
            <span>{group.cwd ?? 'No folder'}</span>
            <span>{shellName(group.shellId)}</span>
          </p>
          <div className="acts">
            <button type="button" className="b p" data-action="open" onClick={() => actions.open(group.id)}>
              Open
            </button>
            <button type="button" className="b" data-action="new-thread" onClick={() => actions.newThread(group.id)}>
              New thread
            </button>
            <button type="button" className="b" data-action="pin" onClick={() => actions.togglePin(group.id)}>
              {group.pinned ? 'Unpin' : 'Pin'}
            </button>
            <button type="button" className="b" data-action="edit" onClick={() => actions.edit(group.id)}>
              Edit
            </button>
            <button
              type="button"
              className="b q"
              data-action="archive"
              onClick={() => (group.archived ? actions.restore(group.id) : actions.archive(group.id))}
            >
              {group.archived ? 'Restore' : 'Archive'}
            </button>
            {hasFolder && (
              <>
                {folderMissing ? (
                  <span
                    className="ic lg push disabled"
                    data-action="explorer"
                    aria-disabled="true"
                    data-tip="Folder not found"
                  >
                    <IconExplorer size={20} />
                  </span>
                ) : (
                  <button
                    type="button"
                    className="ic lg push"
                    data-action="explorer"
                    data-tip="Open in File Explorer"
                    onClick={() => actions.openInExplorer(group.id)}
                  >
                    <IconExplorer size={20} />
                  </button>
                )}
                {primaryEditor && (
                  folderMissing ? (
                    <span
                      className="ic lg disabled"
                      data-action="editor"
                      aria-disabled="true"
                      data-tip="Folder not found"
                    >
                      <EditorLogo product={primaryEditor.product} size={20} />
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="ic lg"
                      data-action="editor"
                      data-tip={`Open in ${primaryEditor.name}`}
                      onClick={() => actions.openInEditor(group.id, primaryEditor.id)}
                    >
                      <EditorLogo product={primaryEditor.product} size={20} />
                    </button>
                  )
                )}
              </>
            )}
          </div>
        </div>

        <div>
          <div className="tabs">
            <div className="seg">
              <button type="button" data-tab="live" aria-selected={tab === 'live'} onClick={() => setTab('live')}>
                Live <span style={{ opacity: .6 }}>{live.length}</span>
              </button>
              <button type="button" data-tab="asleep" aria-selected={tab === 'asleep'} onClick={() => setTab('asleep')}>
                Asleep <span style={{ opacity: .6 }}>{asleep.length}</span>
              </button>
              <button type="button" data-tab="history" aria-selected={tab === 'history'} onClick={() => setTab('history')}>
                History <span style={{ opacity: .6 }}>{history.length}</span>
              </button>
            </div>
            <label className="srch">
              <IconSearch size={15} />
              <input placeholder="Search" value={query} onChange={e => setQuery(e.target.value)} />
            </label>
          </div>

          <div className="list">
            {filtered.length === 0 ? (
              <div className="nothing">{emptyLabel}</div>
            ) : (
              filtered.map(t => {
                const state = threadState(t);
                return (
                  <div
                    key={t.id}
                    className={`tl${t.id === activeTabId ? ' cur' : ''}`}
                    data-tab-id={t.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpenThread(t.id)}
                    onKeyDown={e => { if (e.key === 'Enter') onOpenThread(t.id); }}
                    onContextMenu={e => openRowMenu(e, t)}
                  >
                    <KindIcon kind={threadKind(t)} />
                    <div className="tx">
                      <div className="n">{threadName(t)}</div>
                      <div className="d">
                        {KIND_WORD[threadKind(t)]}
                        {t.branch && (
                          <>
                            {' · '}
                            <span data-meta="branch"><IconBranch size={13} />{t.branch}</span>
                          </>
                        )}
                        {t.worktree && (
                          <>
                            {' · '}
                            <span data-meta="worktree"><IconWorktree size={13} />{t.worktree}</span>
                          </>
                        )}
                      </div>
                    </div>
                    {state !== 'quiet' && <StateIcon state={state} />}
                    <span className="t">{relativeTime(t.lastActiveAt, now)}</span>
                    <div className="acts">
                      <button
                        type="button"
                        className="b q s"
                        onClick={e => { e.stopPropagation(); onOpenThread(t.id); }}
                      >
                        Open
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {menu && <Menu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

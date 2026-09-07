// The project page (mock #view-project / renderProject): reached only through
// the project page icon or a project's right-click menu, never by clicking a
// Home card or row directly. Shows the folder, its default shell, the action
// row, and the project's threads split into Live, Asleep and History.
import React, { useEffect, useState } from 'react';
import { Tab, Group, HistoryEntry } from '../TabBar/types';
import { ScreenNav } from '../ScreenNav';
import { Menu, MenuItem } from '../Menu';
import {
  FolderIcon, IconChevL, IconSearch, IconExplorer, EditorLogo, KindIcon, StateIcon,
  IconBranch, IconWorktree,
} from '../Icons';
import { threadKind, threadState, threadName } from '../../threadView';
import { relativeTime, filterThreads, splitLiveAsleep } from '../../homeView';
import { isResumable, historyTitleMatches } from '../../history';
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
  onResume: (entryId: string) => void; // recreate a history entry and open it
  threadMenu: (tab: Tab) => MenuItem[]; // the one thread menu, built by the caller
  onBack: () => void; // "Home" link at the top
  // Not in the original contract: ScreenNav needs somewhere to send a click
  // on the Workspace icon (its Home icon reuses onBack).
  onGoWorkspace: () => void;
  // Which tab to open on: the palette's History rows and a future "resume"
  // link land here directly instead of always opening on Live. Read once into
  // state; a later change is followed by the effect below so a second click
  // through the palette (page already mounted) still switches tabs.
  initialTab?: ProjectTab;
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
  onOpenThread, onResume, threadMenu, onBack, onGoWorkspace, initialTab,
}: ProjectPageProps) {
  const [tab, setTab] = useState<ProjectTab>(initialTab ?? 'live');
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);

  // The page stays mounted across a search-palette "open on History" click
  // that lands on it a second time, so the prop's own change has to re-steer
  // the tab, not just its initial value.
  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  const { live, asleep } = splitLiveAsleep(tabs);
  const history = group.history;

  const hasFolder = !!group.cwd;
  const primaryEditor = editors[0];

  const listForTab = tab === 'live' ? live : asleep;
  const filtered = tab === 'history' ? [] : filterThreads(listForTab, query);
  const filteredHistory = tab === 'history' ? history.filter(e => historyTitleMatches(e, query)) : [];
  const emptyLabel = tab === 'live' ? 'Nothing running' : tab === 'asleep' ? 'Nothing asleep' : 'Nothing here';

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
            {tab === 'history' ? (
              filteredHistory.length === 0 ? (
                <div className="nothing">{emptyLabel}</div>
              ) : (
                filteredHistory.map(entry => (
                  <HistoryRow key={entry.id} entry={entry} now={now} onResume={onResume} />
                ))
              )
            ) : filtered.length === 0 ? (
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

// A closed thread. Unlike a live or asleep row, there is nothing to open: the
// row itself is inert (no role="button", no click handler), only Resume, and
// only when the entry is actually resumable, does anything.
function HistoryRow({ entry, now, onResume }: { entry: HistoryEntry; now: number; onResume: (id: string) => void }) {
  return (
    <div className="tl" data-history-id={entry.id}>
      <KindIcon kind={entry.kind} />
      <div className="tx">
        <div className="n">{entry.title}</div>
        <div className="d">{KIND_WORD[entry.kind]}</div>
      </div>
      <span className="t">{relativeTime(entry.closedAt, now)}</span>
      <div className="acts">
        {isResumable(entry) && (
          <button type="button" className="b q s" data-resume onClick={() => onResume(entry.id)}>
            Resume
          </button>
        )}
      </div>
    </div>
  );
}

// The main pane's header: kind icon and thread name on line 1, the project
// (and, from Phase 3 on, model / branch / worktree) on line 2, the state
// chip, the editor button and the thread's dots menu on the right. See
// "Workspace" -> "Main pane" in docs/design-02-projects-and-threads.md and
// PHASES.md Phase 1.
import React, { useCallback, useRef, useState } from 'react';
import { Tab, Group } from '../TabBar/types';
import { EditorLogo, FolderIcon, IconBranch, IconModel, IconMore, IconTerm, IconWorktree, KindIcon, StateIcon } from '../Icons';
import { Menu } from '../Menu';
import { buildHeaderMenu, HeaderMenuActions, ThreadMenuActions } from '../../threadMenu';
import { FOLDER_MISSING_TIP } from '../../projectMenu';
import { threadKind, threadName, threadState, stateLabel, modelLabel, runningLabel } from '../../threadView';
import { asleepLabel } from '../../sleepWake';
import { FilesButton, FilesButtonProps } from '../FilesButton';
import './Header.css';

// Matches the menu's own min-width (Menu.css), so the panel opens flush with
// the button's right edge before Menu's own viewport clamp can adjust it.
const MENU_WIDTH = 200;

export interface HeaderProps {
  tab: Tab | undefined;
  group: Group | undefined;
  groups: Group[];
  // Undefined only when there is no active tab (nothing to act on).
  actions?: HeaderMenuActions;
  // "Open in File Explorer" for the project's own folder, behind the project item
  // on line 2 (Phase 9, Aryan: the project item should open the project folder).
  // Undefined when the thread has no project or the project has no folder.
  projectExplorer?: { missing: boolean; open: () => void };
  // The editor button beside the dots: opens the thread's own folder (the
  // worktree for a worktree chat, the project root for a chat that runs there,
  // a shell's cwd) in the primary editor, drawn with that editor's logo.
  // Undefined when the thread has no folder or no editor was detected, and then
  // there is no button. The dots menu never gets these entries.
  editor?: ThreadMenuActions['openInEditor'];
  // Clock reading for the asleep chip's "Asleep · 2d" wording (asleepLabel).
  // Required, not read from Date.now() here, so the chip updates on the same
  // tick as the rest of the app instead of drifting on its own render timing.
  now: number;
  // The Files button (docs/edited-files): a chat's changed files and pasted
  // images. Undefined for a shell; the button itself hides at zero files.
  files?: FilesButtonProps;
}

export function Header({ tab, group, groups, actions, projectExplorer, editor, now, files }: HeaderProps) {
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
  // The worktree item opens the thread's own folder in Explorer (Phase 9, the
  // manual-testing ask: "clicking that worktree item should open the worktree
  // folder"). It is a button only when the caller offers the action; the
  // missing-folder case keeps the button but disables it with the same tip the
  // menus use, so a dead path is explained rather than silently ignored.
  const explorer = actions?.openInExplorer;
  const primaryEditor = editor?.editors[0];

  return (
    <div className="header">
      <div className="header-title">
        <div className="header-name">
          <KindIcon kind={kind} />
          <span>{threadName(tab)}</span>
        </div>
        <div className="header-meta">
          {group && projectExplorer ? (
            <button
              type="button"
              className="header-meta-item header-meta-link"
              data-meta="project"
              data-tip={projectExplorer.missing ? 'Folder not found' : 'Open in File Explorer'}
              disabled={projectExplorer.missing}
              onClick={projectExplorer.open}
            >
              <FolderIcon color={group.color} open size={14} icon={group.icon} />
              {group.label}
            </button>
          ) : (
            <span className="header-meta-item" data-meta="project">
              {group ? <FolderIcon color={group.color} open size={14} icon={group.icon} /> : <IconTerm size={14} />}
              {group ? group.label : 'General'}
            </span>
          )}
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
          {tab.worktree && (explorer ? (
            <button
              type="button"
              className="header-meta-item header-meta-worktree header-meta-link"
              data-meta="worktree"
              data-tip={explorer.missing ? 'Folder not found' : 'Open in File Explorer'}
              disabled={explorer.missing}
              onClick={explorer.open}
            >
              <IconWorktree size={14} />
              <span className="header-meta-text">{tab.worktree}</span>
            </button>
          ) : (
            <span className="header-meta-item header-meta-worktree" data-meta="worktree">
              <IconWorktree size={14} />
              <span className="header-meta-text">{tab.worktree}</span>
            </span>
          ))}
        </div>
      </div>
      <div className="header-actions">
        {files && <FilesButton {...files} />}
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
        {editor && primaryEditor && (editor.missing ? (
          <span
            className="ic disabled"
            data-action="editor"
            aria-disabled="true"
            data-tip={FOLDER_MISSING_TIP}
          >
            <EditorLogo product={primaryEditor.product} size={18} />
          </span>
        ) : (
          <button
            type="button"
            className="ic"
            data-action="editor"
            data-tip={`Open in ${primaryEditor.name}`}
            onClick={() => editor.open(primaryEditor.id)}
          >
            <EditorLogo product={primaryEditor.product} size={18} />
          </button>
        ))}
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
          items={buildHeaderMenu(tab, groups, actions)}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}

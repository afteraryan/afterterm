import React, { useState, useRef, useCallback, useEffect, useMemo, forwardRef, useImperativeHandle } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  DragOverEvent,
  DragEndEvent,
  closestCenter,
} from '@dnd-kit/core';
import { Tab, Group, GroupColor } from '../TabBar/types';
import { Menu, MenuItem } from '../Menu';
import { buildThreadMenu } from '../../threadMenu';
import { buildProjectMenu, ProjectActions } from '../../projectMenu';
import type { EditorInfo } from '../../../editors';
import {
  FolderIcon, KindIcon, StateIcon,
  IconPanel, IconSearch, IconPlus, IconPage, IconPin, IconPinOn, IconChevD,
  IconCollapseAll, IconExpandAll, IconBell, IconPlay, IconCompact, IconX,
} from '../Icons';
// The row order is computed groups-first (see sidebarWalk.ts), so a group with no
// terminals renders as a normal row instead of vanishing from the list. That walk
// is what retired the old Projects shelf.
import { computeSegments } from '../../sidebarWalk';
import {
  threadKind, threadState, stateBreathes, threadName, foldThreads,
  projectCounts,
} from '../../threadView';
// Phase 8: the panel's groups (General, Pinned, Recent, Other), the in-place
// search filter and the keyboard cycle's row order all come from panelView.ts,
// pure and unit-tested; this component only renders what it returns.
import { panelSections, filterPanel, visibleThreadIds, cycleThreadId } from '../../panelView';
import type { PanelEntry, PanelSections } from '../../panelView';
import { isWaitingState } from '../../attention';
import { relativeTime } from '../../homeView';
import { ThreadHoverCard } from '../ThreadHoverCard';
import './SidePanel.css';

const THREAD_FOLD_LIMIT = 5;
// How long the pointer has to rest on a thread row before its card appears. Long
// enough that moving the pointer down the list never flashes a card.
const HOVER_DELAY_MS = 350;

// ─── Thread row ────────────────────────────────────────────────────────────────

interface ThreadRowProps {
  tab: Tab;
  isActive: boolean;
  inProject: boolean;
  isDragging: boolean;
  isGroupPreview: boolean;
  // A collapsed project keeps its thread rows mounted (that is what lets the
  // expand and collapse animate), so they must be taken out of the drag graph
  // while they are folded away: a zero-height row is still a droppable that
  // closestCenter can pick.
  inert?: boolean;
  overlay?: boolean;
  onActivate: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onClose: () => void;
  // Hover card timing lives in the SidePanel, so the row only reports "the pointer
  // is resting on me, here is my rectangle" and "it left".
  onHoverStart?: (rect: DOMRect) => void;
  onHoverEnd?: () => void;
}

function ThreadRow({
  tab, isActive, inProject, isDragging, isGroupPreview, inert, overlay,
  onActivate, onContextMenu, onClose, onHoverStart, onHoverEnd,
}: ThreadRowProps) {
  const off = !!overlay || !!inert;
  const { attributes, listeners, setNodeRef: setDragRef } = useDraggable({ id: tab.id, disabled: off });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: tab.id, disabled: off });

  const setRef = (node: HTMLDivElement | null) => {
    setDragRef(node);
    setDropRef(node);
  };

  const state = threadState(tab);
  const breathe = !isActive && stateBreathes(state)
    ? (state === 'needs-you' || state === 'unread' ? 'breathe-need' : 'breathe-done')
    : '';

  // No transform on the in-list row: the DragOverlay renders the moving copy.
  // Translating the source corrupts collision detection (it stays "closest to
  // itself" when dragging up, so up-moves silently no-op).
  const className = [
    'th',
    inProject ? '' : 'gen',
    isActive ? 'sel' : '',
    isDragging ? 'dragging' : '',
    isOver && !isDragging ? 'drop-target' : '',
    isGroupPreview ? 'group-preview' : '',
    overlay ? 'drag-overlay' : '',
    // Dims on tab.asleep itself, not on state === 'asleep': an asleep thread
    // marked unread reads as 'unread' (it wins precedence), but it is still
    // asleep and still dims, with the bell shown on top of the dimmed row.
    tab.asleep ? 'sleep' : '',
    breathe,
  ].filter(Boolean).join(' ');

  return (
    <div
      ref={overlay ? undefined : setRef}
      className={className}
      onClick={() => { onHoverEnd?.(); onActivate(); }}
      onContextMenu={e => { onHoverEnd?.(); onContextMenu(e); }}
      onMouseEnter={overlay ? undefined : e => onHoverStart?.(e.currentTarget.getBoundingClientRect())}
      onMouseLeave={overlay ? undefined : () => onHoverEnd?.()}
      data-kind={threadKind(tab)}
      {...(overlay ? {} : { ...attributes, ...listeners })}
    >
      <KindIcon kind={threadKind(tab)} />
      <span className="n">{threadName(tab)}</span>
      {state === 'running' && <span className="prt">:{tab.port}</span>}
      <StateIcon state={state} />
      {!overlay && !inert && (
        <button
          className="xb"
          data-tip="Close"
          tabIndex={-1}
          onPointerDown={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onClose(); }}
        >
          <IconX size={14} />
        </button>
      )}
    </div>
  );
}

// ─── Project row ───────────────────────────────────────────────────────────────

interface ProjectRowProps {
  group: Group;
  threadCount: number;
  counts: { needsYou: number; running: number; compacting: number };
  pinned: boolean;
  isDragging: boolean;
  overlay?: boolean;
  onToggle: () => void;
  onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onNewThread: () => void;
  onOpenProjectPage: () => void;
  onTogglePin: () => void;
  isRenaming: boolean;
  renameValue: string;
  onRenameChange: (v: string) => void;
  onRenameCommit: () => void;
}

function ProjectRow({
  group, threadCount, counts, pinned, isDragging, overlay,
  onToggle, onDoubleClick, onContextMenu, onNewThread, onOpenProjectPage, onTogglePin,
  isRenaming, renameValue, onRenameChange, onRenameCommit,
}: ProjectRowProps) {
  const { attributes, listeners, setNodeRef: setDragRef } = useDraggable({
    id: `group-drag-${group.id}`,
    disabled: !!overlay,
  });
  // Distinct droppable id: dnd-kit keys droppables by id, so sharing the drag id
  // would let one silently replace the other as the drop target.
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `group-drop-${group.id}`,
    disabled: !!overlay || isDragging,
  });

  const setRef = (node: HTMLDivElement | null) => {
    setDragRef(node);
    setDropRef(node);
  };

  const expanded = !group.collapsed;

  const className = [
    'pj',
    pinned ? '' : 'dim',
    isOver ? 'drop-over' : '',
    isDragging ? 'dragging' : '',
    overlay ? 'drag-overlay' : '',
  ].filter(Boolean).join(' ');

  const stop = (e: React.MouseEvent | React.PointerEvent) => e.stopPropagation();

  return (
    <div
      ref={overlay ? undefined : setRef}
      className={className}
      onClick={e => { if (e.detail === 2) return; onToggle(); }}
      onDoubleClick={e => { e.stopPropagation(); onDoubleClick(); }}
      onContextMenu={onContextMenu}
      data-collapsed={expanded ? undefined : 'true'}
      data-threads={threadCount}
      {...(overlay ? {} : { ...attributes, ...listeners })}
    >
      <FolderIcon color={group.color} open={expanded} size={18} icon={group.icon} />
      {isRenaming ? (
        <input
          autoFocus
          className="pj-rename"
          value={renameValue}
          onFocus={e => e.currentTarget.select()}
          onChange={e => onRenameChange(e.target.value)}
          onBlur={onRenameCommit}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') onRenameCommit(); }}
          onClick={stop}
          onPointerDown={stop}
        />
      ) : (
        <span className="n">{group.label}</span>
      )}
      {!expanded && threadCount > 0 && <span className="c">{threadCount}</span>}
      {counts.needsYou > 0 && (
        <span className="sig need">
          <span className="si need"><IconBell size={14} /></span>
          {counts.needsYou}
        </span>
      )}
      {counts.running > 0 && (
        <span className="sig run">
          <span className="si run"><IconPlay size={13} /></span>
          {counts.running}
        </span>
      )}
      {/* Compacting is its own state with its own count, never folded into the
          play pill (Aryan, 2026-09-19). */}
      {counts.compacting > 0 && (
        <span className="sig compact">
          <span className="si compact"><IconCompact size={13} /></span>
          {counts.compacting}
        </span>
      )}
      {!overlay && (
        <>
          <button
            className="ib"
            data-tip={`New thread in ${group.label}`}
            onPointerDown={stop}
            onClick={e => { e.stopPropagation(); onNewThread(); }}
            tabIndex={-1}
          >
            <IconPlus size={14} />
          </button>
          <button
            className="ib"
            data-tip="Open project page"
            onPointerDown={stop}
            onClick={e => { e.stopPropagation(); onOpenProjectPage(); }}
            tabIndex={-1}
          >
            <IconPage size={14} />
          </button>
          {/* Only the unpinned rows carry a pin button: a pinned project sits in the
              Pinned section, where unpinning is a right-click away. */}
          {!pinned && (
            <button
              className="ib"
              data-tip="Pin"
              onPointerDown={stop}
              onClick={e => { e.stopPropagation(); onTogglePin(); }}
              tabIndex={-1}
            >
              <IconPin size={14} />
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ─── Main SidePanel ────────────────────────────────────────────────────────────

// What app.tsx reads off the panel for the keyboard cycle (Ctrl+Shift+Down and
// Up): the fold state and the search text live here, so only the panel knows
// which rows it is actually showing.
export interface SidePanelHandle {
  // The next (dir 1) or previous (dir -1) thread row the panel shows, in panel
  // order, across projects, wrapping at the ends; null when nothing is shown.
  cycleThread(activeTabId: string, dir: 1 | -1): string | null;
  // Every thread row the panel is showing, in panel order (the list the cycle
  // walks); the harness reads it as window.__afterterm.panelOrder().
  visibleIds(): string[];
  // Puts the caret in the search box.
  focusSearch(): void;
}

export interface SidePanelProps {
  tabs: Tab[];
  groups: Group[];
  activeTabId: string;
  // Phase 8: the panel is hidden by sliding its width to zero (design-03
  // decision 1); it stays mounted so the slide can animate. `hidden` covers both
  // the persisted Ctrl+Shift+B state and the transient slide-shut on the way to
  // Home (app.tsx).
  hidden: boolean;
  // The clock the Recent rule (3 days) and the docked Other rows' "2d" read.
  now: number;
  shells: { id: string; name: string }[];
  onToggleCollapse: () => void;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onSleep: (tabId: string) => void;
  onWake: (tabId: string) => void;
  // Mark as unread / Mark as read (threadMenu's setUnread), chats only.
  onSetUnread: (tabId: string, unread: boolean) => void;
  // Opens the running server's port in the browser (threadMenu's "Open
  // localhost:port"); only ever offered on an awake thread with a captured port.
  onOpenLocalhost: (tabId: string) => void;
  onNewTab: (groupId?: string, shellId?: string) => void;
  // The chooser is anchored under whichever New thread control was used, so the
  // caller is handed that control's bottom-left corner.
  onOpenChooser: (anchor: { x: number; y: number }) => void;
  onOpenProjectPage: (groupId: string) => void;
  onTogglePin: (groupId: string) => void;
  // The New/Edit project dialog lives in app.tsx now, so Home, the project page and
  // the sidebar all open the same one. Editing an existing project is reached
  // through the shared project menu (projectActions.edit), so only the "new"
  // entry point is a prop here.
  onNewProject: () => void;
  // Everything the shared project right-click menu needs (projectMenu.tsx).
  editors: EditorInfo[];
  folderExists: Record<string, boolean>; // keyed by folder path
  projectActions: ProjectActions;
  onCreateGroup: (tabId1: string, tabId2?: string) => string;
  onAddToGroup: (tabId: string, groupId: string) => void;
  onRemoveFromGroup: (tabId: string) => void;
  onRenameGroup: (groupId: string, label: string) => void;
  onSetGroupColor: (groupId: string, color: GroupColor) => void;
  onToggleGroupCollapse: (groupId: string) => void;
  // The collapse button on the Pinned and Recent headings: every project in that
  // group at once (design-03 decision 9).
  onSetGroupsCollapsed: (groupIds: string[], collapsed: boolean) => void;
  // A click on a project in the docked Other list: stamps its activity, expands
  // it and selects its first thread, waking nothing (design-03 decision 2).
  onBringIn: (groupId: string) => void;
  onMoveTab: (tabId: string, anchorTabId: string, position: 'before' | 'after') => void;
  onMoveGroup: (groupId: string, afterTabId: string | null) => void;
  onMoveGroupAfterGroup: (groupId: string, afterGroupId: string) => void;
}

export const SidePanel = forwardRef<SidePanelHandle, SidePanelProps>(function SidePanel(props, ref) {
  const {
    tabs, groups, activeTabId, hidden, now, shells, onToggleCollapse,
    onActivate, onClose, onSleep, onWake, onSetUnread, onOpenLocalhost, onNewTab,
    onOpenChooser, onOpenProjectPage, onTogglePin,
    onNewProject, editors, folderExists, projectActions,
    onCreateGroup, onAddToGroup, onRemoveFromGroup,
    onRenameGroup, onToggleGroupCollapse, onSetGroupsCollapsed, onBringIn,
    onMoveTab, onMoveGroup, onMoveGroupAfterGroup,
  } = props;

  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null);
  const [groupPreviewTarget, setGroupPreviewTarget] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  // Which thread lists are past their five-row fold. Transient, keyed by project id
  // ('general' for the projectless list): a fold is a glance, not a preference, so
  // it is not persisted.
  const [expandedLists, setExpandedLists] = useState<Record<string, boolean>>({});
  // The search box text (design-03 decision 13) and whether the docked Other
  // projects list is open. Both transient: a filter and a peek at the overflow are
  // things you do, not settings.
  const [query, setQuery] = useState('');
  const [dockOpen, setDockOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  // Which thread row the pointer is resting on, the rectangle the card points at,
  // and the clock reading it was opened with (the card shows relative times and
  // must not restart a timer of its own).
  const [hover, setHover] = useState<{ tabId: string; anchor: DOMRect; now: number } | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hideHover = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
    setHover(null);
  }, []);

  const startHover = useCallback((tabId: string, rect: DOMRect) => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      hoverTimerRef.current = null;
      setHover({ tabId, anchor: rect, now: Date.now() });
    }, HOVER_DELAY_MS);
  }, []);

  // A hidden sidebar has no rows to point at, and an unmount must not leave a
  // timer running that would open a card over whatever comes next.
  useEffect(() => {
    if (hidden) hideHover();
  }, [hidden, hideHover]);
  useEffect(() => () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
  }, []);

  // Keep the open thread visible: activating a thread whose project is collapsed
  // (Ctrl+Tab, a toast click, the header menu) expands that project, the way the
  // mock's selectThread does. Only activation triggers it, so the user can still
  // collapse the project that holds the active thread.
  useEffect(() => {
    const tab = tabs.find(t => t.id === activeTabId);
    const group = tab?.groupId ? groups.find(g => g.id === tab.groupId) : undefined;
    if (group?.collapsed) onToggleGroupCollapse(group.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId]);

  const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastOverRef = useRef<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const overId = event.over?.id as string | null;
    if (overId === lastOverRef.current) return;

    if (dwellTimerRef.current) clearTimeout(dwellTimerRef.current);
    setGroupPreviewTarget(null);
    lastOverRef.current = overId;

    // Dwell-to-group preview only arms when both tabs are ungrouped, that is the only
    // case dwell does anything now (create a new group). Every other drag is a
    // positional move and must not be hijacked by the grouping preview.
    const draggedTab = tabs.find(t => t.id === draggingTabId);
    const overTab = overId ? tabs.find(t => t.id === overId) : undefined;
    const bothUngrouped = !draggedTab?.groupId && !!overTab && !overTab.groupId;
    if (overId && overId !== draggingTabId && bothUngrouped) {
      dwellTimerRef.current = setTimeout(() => {
        setGroupPreviewTarget(overId);
      }, 550);
    }
  }, [draggingTabId, tabs]);

  // The drag/context-menu gesture stays instant: the project is created with defaults
  // and the name field opens focused and selected, so the placeholder name is one type
  // away from gone. Deliberate project setup goes through the modal instead.
  const createGroupAndRename = useCallback((tabId1: string, tabId2?: string) => {
    const id = onCreateGroup(tabId1, tabId2);
    if (!id) return;
    setRenamingGroupId(id);
    setRenameValue('New Group');
  }, [onCreateGroup]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    if (dwellTimerRef.current) clearTimeout(dwellTimerRef.current);
    const activeId = event.active.id as string;
    const overId = event.over?.id as string | null;

    setDraggingTabId(null);
    setDraggingGroupId(null);
    setGroupPreviewTarget(null);
    lastOverRef.current = null;

    if (!overId || overId === activeId) return;

    // Project row being dragged
    if (activeId.startsWith('group-drag-')) {
      const draggedGroupId = activeId.replace('group-drag-', '');
      if (overId.startsWith('group-drop-') || overId.startsWith('group-drag-')) {
        const targetGroupId = overId.replace('group-drop-', '').replace('group-drag-', '');
        if (targetGroupId !== draggedGroupId) {
          onMoveGroupAfterGroup(draggedGroupId, targetGroupId);
        }
      } else {
        onMoveGroup(draggedGroupId, overId);
      }
      return;
    }

    // Thread being dragged
    const activeTab = tabs.find(t => t.id === activeId);

    const reorderOnto = (targetTabId: string) => {
      // Above the hovered row's midpoint → before it; below → after.
      const activeRect = event.active.rect.current.translated;
      const overRect = event.over?.rect;
      let position: 'before' | 'after' = 'after';
      if (activeRect && overRect) {
        const activeCenterY = activeRect.top + activeRect.height / 2;
        const overCenterY = overRect.top + overRect.height / 2;
        position = activeCenterY < overCenterY ? 'before' : 'after';
      }
      onMoveTab(activeId, targetTabId, position);
    };

    // Dwell-to-group is the explicit "merge into a new project" gesture, only needed
    // when both threads are ungrouped (positional drops join an existing project on
    // their own, since moveTab inherits the drop target's group).
    if (groupPreviewTarget && overId === groupPreviewTarget) {
      const targetTab = tabs.find(t => t.id === groupPreviewTarget);
      if (targetTab && !targetTab.groupId && !activeTab?.groupId) {
        createGroupAndRename(activeId, groupPreviewTarget);
        return;
      }
      // else fall through to a positional move
    }

    // Dropped on a project row → land at the top of that project (joining it). A
    // project with no threads has no anchor to move before, so the thread is added to
    // the group outright and useTabState places it at the end of the list.
    if (overId.startsWith('group-drop-') || overId.startsWith('group-drag-')) {
      const targetGroupId = overId.replace(/^(group-drop-|group-drag-)/, '');
      const firstInGroup = tabs.find(t => t.groupId === targetGroupId);
      if (firstInGroup && firstInGroup.id !== activeId) {
        onMoveTab(activeId, firstInGroup.id, 'before');
      } else if (!firstInGroup) {
        onAddToGroup(activeId, targetGroupId);
      }
      return;
    }

    reorderOnto(overId);
  }, [groupPreviewTarget, tabs, onAddToGroup, createGroupAndRename, onMoveTab, onMoveGroup, onMoveGroupAfterGroup]);

  const handleDragCancel = useCallback(() => {
    if (dwellTimerRef.current) clearTimeout(dwellTimerRef.current);
    setDraggingTabId(null);
    setDraggingGroupId(null);
    setGroupPreviewTarget(null);
    lastOverRef.current = null;
  }, []);

  const startRename = (groupId: string) => {
    const g = groups.find(g => g.id === groupId);
    if (!g) return;
    setRenamingGroupId(groupId);
    setRenameValue(g.label);
  };

  const commitRename = () => {
    if (renamingGroupId && renameValue.trim()) {
      onRenameGroup(renamingGroupId, renameValue.trim());
    }
    setRenamingGroupId(null);
  };

  // ─── Menus ─────────────────────────────────────────────────────────────────

  // The chooser opens just under the New thread row.
  const openChooserUnder = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    onOpenChooser({ x: rect.left, y: rect.bottom + 6 });
  };

  const shellItems = (groupId?: string): MenuItem[] =>
    shells.map(s => ({ label: s.name, onSelect: () => onNewTab(groupId, s.id) }));

  const openNewThreadShellMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (shells.length === 0) return;
    setMenu({ x: e.clientX, y: e.clientY, items: shellItems(undefined) });
  };

  const openThreadMenu = (e: React.MouseEvent, tab: Tab) => {
    e.preventDefault();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: buildThreadMenu(tab, groups, {
        open: () => onActivate(tab.id),
        moveToGroup: id => (id ? onAddToGroup(tab.id, id) : onRemoveFromGroup(tab.id)),
        close: () => onClose(tab.id),
        sleep: () => onSleep(tab.id),
        wake: () => onWake(tab.id),
        setUnread: unread => onSetUnread(tab.id, unread),
        openProjectPage: tab.groupId ? () => onOpenProjectPage(tab.groupId!) : undefined,
        openLocalhost: () => onOpenLocalhost(tab.id),
      }),
    });
  };

  const openProjectMenu = (e: React.MouseEvent, group: Group) => {
    e.preventDefault();
    const folderMissing = !!group.cwd && folderExists[group.cwd] === false;
    const items = buildProjectMenu(group, { editors, folderMissing }, projectActions);
    // The shell submenu is a sidebar convenience, not part of the shared project
    // menu, so it is spliced in here, right after "New thread here".
    const afterNewThread = items.findIndex(i => i.label === 'New thread here') + 1;
    if (afterNewThread > 0 && shells.length > 0) {
      items.splice(afterNewThread, 0, {
        label: 'New thread with shell',
        submenu: { title: 'Shell', items: shellItems(group.id) },
      });
    }
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  // ─── Derived rows ──────────────────────────────────────────────────────────

  // Recomputed only when the data or the clock changes, not on every hover: the
  // Recent split reads lastActiveAt against `now`, which app.tsx moves once a minute.
  const sections: PanelSections = useMemo(
    () => panelSections(computeSegments(tabs, groups), now),
    [tabs, groups, now],
  );
  const view = useMemo(() => filterPanel(sections, query, threadName), [sections, query]);
  const filtered = view.filtered;
  const groupMap = new Map(groups.map(g => [g.id, g]));
  const hoverTab = hover ? tabs.find(t => t.id === hover.tabId) : undefined;
  const draggingTab = draggingTabId ? tabs.find(t => t.id === draggingTabId) : null;
  const draggingGroup = draggingGroupId ? groups.find(g => g.id === draggingGroupId) : null;
  // A hidden row that is waiting for you keeps the fold open (Aryan, 2026-09-19):
  // the same definition attention.ts counts with.
  const isWaiting = (t: Tab) => isWaitingState(threadState(t));

  // The keyboard cycle reads the rows exactly as they are shown: after the filter,
  // minus collapsed projects, minus fold-hidden rows.
  useImperativeHandle(ref, (): SidePanelHandle => ({
    cycleThread: (currentId, dir) => {
      const ids = visibleThreadIds(view, { activeTabId: currentId, expandedLists, limit: THREAD_FOLD_LIMIT, isWaiting });
      return cycleThreadId(ids, currentId, dir);
    },
    visibleIds: () => visibleThreadIds(view, { activeTabId, expandedLists, limit: THREAD_FOLD_LIMIT, isWaiting }),
    focusSearch: () => searchRef.current?.focus(),
  }), [view, expandedLists, activeTabId]);

  const clearQuery = () => {
    setQuery('');
    searchRef.current?.focus();
  };

  const renderThreadList = (threads: Tab[], key: string, inProject: boolean, inert: boolean) => {
    const { shown, hiddenCount, showMore } = foldThreads(threads, activeTabId, !!expandedLists[key], THREAD_FOLD_LIMIT, isWaiting);
    return (
      <>
        {shown.map(tab => (
          <ThreadRow
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            inProject={inProject}
            isDragging={tab.id === draggingTabId}
            isGroupPreview={tab.id === groupPreviewTarget}
            inert={inert}
            onActivate={() => onActivate(tab.id)}
            onContextMenu={e => openThreadMenu(e, tab)}
            onClose={() => onClose(tab.id)}
            onHoverStart={rect => startHover(tab.id, rect)}
            onHoverEnd={hideHover}
          />
        ))}
        {showMore && (
          <button
            className="thmore"
            onClick={() => setExpandedLists(p => ({ ...p, [key]: !p[key] }))}
          >
            {hiddenCount > 0 ? `Show ${hiddenCount} more` : 'Show less'}
          </button>
        )}
      </>
    );
  };

  const renderProject = (entry: PanelEntry, isPinned: boolean) => {
    const { group, tabs: groupTabs } = entry;
    const expanded = !group.collapsed;
    const counts = projectCounts(groupTabs.map(threadState));
    return (
      <div className="pjw" key={group.id}>
        <ProjectRow
          group={group}
          threadCount={groupTabs.length}
          counts={counts}
          pinned={isPinned}
          isDragging={group.id === draggingGroupId}
          onToggle={() => onToggleGroupCollapse(group.id)}
          onDoubleClick={() => startRename(group.id)}
          onContextMenu={e => openProjectMenu(e, group)}
          onNewThread={() => onNewTab(group.id)}
          onOpenProjectPage={() => onOpenProjectPage(group.id)}
          onTogglePin={() => onTogglePin(group.id)}
          isRenaming={renamingGroupId === group.id}
          renameValue={renameValue}
          onRenameChange={setRenameValue}
          onRenameCommit={commitRename}
        />
        {groupTabs.length > 0 && (
          // The list stays mounted while the project is collapsed: the 1fr → 0fr grid
          // transition is what animates the collapse, and unmounting would cut it off.
          <div className={`tlw${expanded ? '' : ' closed'}`} data-project={group.id} inert={!expanded}>
            <div className="tli">
              {renderThreadList(groupTabs, group.id, true, !expanded)}
            </div>
          </div>
        )}
      </div>
    );
  };

  // The collapse button at the right end of the Pinned and Recent headings: one
  // click collapses every project in the group, or expands every one when none is
  // open (design-03 decision 9). Icon and tip follow which way the click goes.
  const collapseButton = (key: 'pinned' | 'recent', entries: PanelEntry[]) => {
    if (entries.length === 0) return null;
    const anyOpen = entries.some(e => !e.group.collapsed);
    return (
      <button
        className="ib"
        data-collapse-sec={key}
        data-tip={anyOpen ? 'Collapse all' : 'Expand all'}
        onClick={e => { e.stopPropagation(); onSetGroupsCollapsed(entries.map(x => x.group.id), anyOpen); }}
      >
        {anyOpen ? <IconCollapseAll size={14} /> : <IconExpandAll size={14} />}
      </button>
    );
  };

  const showPinned = view.pinned.length > 0;
  // The Recent heading is the panel's home for the New project plus, so it shows
  // even with no recent project, unless a search is narrowing the list.
  const showRecent = view.recent.length > 0 || !filtered;
  const others = view.other;

  return (
    <>
      <div className={`side-panel${hidden ? ' hidden' : ''}`} inert={hidden}>
        <div className="brand">
          <span className="sp" />
          <button className="ic" onClick={onToggleCollapse} data-tip="Close sidebar">
            <IconPanel size={18} />
          </button>
        </div>

        <div className="side-body">
          {/* The Search box (design-03 decision 13): typing filters the panel in
              place; Ctrl+Shift+P still opens the palette, the only place closed
              threads are searched. Escape empties the box; a second Escape
              hands the keyboard back to the terminal. */}
          <div className={`srch${filtered ? ' has' : ''}`}>
            <span className="g"><IconSearch size={16} /></span>
            <input
              ref={searchRef}
              className="srch-input"
              placeholder="Search"
              value={query}
              spellCheck={false}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key !== 'Escape') return;
                e.preventDefault();
                if (query) setQuery('');
                else searchRef.current?.blur();
              }}
            />
            <span className="k">Ctrl Shift P</span>
            <button className="ib clr" data-tip="Clear" data-clear="" onClick={clearQuery} tabIndex={-1}>
              <IconX size={14} />
            </button>
          </div>

          {!filtered && (
            <button
              className="srow"
              data-new-thread=""
              onClick={e => openChooserUnder(e.currentTarget)}
              onContextMenu={openNewThreadShellMenu}
            >
              <span className="g"><IconPlus size={16} /></span>
              New thread
              <span className="k">Ctrl Shift T</span>
            </button>
          )}

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={e => {
              hideHover();
              const id = e.active.id as string;
              if (id.startsWith('group-drag-')) {
                setDraggingGroupId(id.replace('group-drag-', ''));
              } else {
                setDraggingTabId(id);
              }
            }}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <div className="scroll" onScroll={hideHover}>
              {view.general.length > 0 && (
                <div className="sec" data-sec="general">
                  <div className="lbl">General</div>
                  {renderThreadList(view.general, 'general', false, false)}
                </div>
              )}

              {showPinned && (
                <div className="sec pinned-sec" data-sec="pinned">
                  <div className="lbl lblrow">
                    <span className="hd"><span className="pin"><IconPinOn size={12} /></span>Pinned</span>
                    <span className="acts">{collapseButton('pinned', view.pinned)}</span>
                  </div>
                  {view.pinned.map(entry => renderProject(entry, true))}
                </div>
              )}

              {showPinned && showRecent && <div className="divider" />}

              {showRecent && (
                <div className="sec" data-sec="recent">
                  <div className="lbl lblrow">
                    <span className="hd">Recent</span>
                    <span className="acts">
                      {collapseButton('recent', view.recent)}
                      <button className="ib" data-tip="New project" data-new-project="" onClick={onNewProject}>
                        <IconPlus size={14} />
                      </button>
                    </span>
                  </div>
                  {view.recent.map(entry => renderProject(entry, false))}
                </div>
              )}

              {view.noMatches && <div className="nomatch">No matches</div>}
            </div>

            <DragOverlay dropAnimation={null}>
              {draggingTab ? (
                <ThreadRow
                  tab={draggingTab}
                  isActive={false}
                  inProject={!!(draggingTab.groupId && groupMap.has(draggingTab.groupId))}
                  isDragging={false}
                  isGroupPreview={false}
                  onActivate={() => {}}
                  onContextMenu={() => {}}
                  onClose={() => {}}
                  overlay
                />
              ) : draggingGroup ? (
                <ProjectRow
                  group={draggingGroup}
                  threadCount={tabs.filter(t => t.groupId === draggingGroup.id).length}
                  counts={{ needsYou: 0, running: 0, compacting: 0 }}
                  pinned={draggingGroup.pinned}
                  isDragging={false}
                  onToggle={() => {}}
                  onDoubleClick={() => {}}
                  onContextMenu={() => {}}
                  onNewThread={() => {}}
                  onOpenProjectPage={() => {}}
                  onTogglePin={() => {}}
                  isRenaming={false}
                  renameValue=""
                  onRenameChange={() => {}}
                  onRenameCommit={() => {}}
                  overlay
                />
              ) : null}
            </DragOverlay>
          </DndContext>

          {/* Other projects (design-03 decision 2): the unpinned projects outside the
              3-day window, docked under the scroll, collapsed by default. Expanding
              lists them as dim rows with no thread lists; clicking one brings it in.
              Hidden while a search is narrowing the list. */}
          {others.length > 0 && !filtered && (
            <div className={`dock${dockOpen ? ' open' : ''}`} data-dock="">
              <div className={`dlist${dockOpen ? ' open' : ''}`} inert={!dockOpen}>
                <div>
                  {others.map(entry => (
                    <div
                      key={entry.group.id}
                      className="pj dim"
                      data-other={entry.group.id}
                      onClick={() => { setDockOpen(false); onBringIn(entry.group.id); }}
                      onContextMenu={e => openProjectMenu(e, entry.group)}
                    >
                      <FolderIcon color={entry.group.color} open={false} size={18} icon={entry.group.icon} />
                      <span className="n">{entry.group.label}</span>
                      <span className="c">{relativeTime(entry.group.lastActiveAt, now)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <button className="drow" data-dock-toggle="" onClick={() => setDockOpen(o => !o)}>
                <span className={`chev${dockOpen ? ' up' : ''}`}><IconChevD size={14} /></span>
                Other projects
                <span className="c">{others.length}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {menu && (
        <Menu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}

      {/* Mounted at the panel root, outside the scrolling list, so the card is not
          clipped by it. */}
      {hoverTab && !hidden && (
        <ThreadHoverCard
          tab={hoverTab}
          group={hoverTab.groupId ? groupMap.get(hoverTab.groupId) : undefined}
          anchor={hover!.anchor}
          now={hover!.now}
        />
      )}

    </>
  );
});

import React, { useState, useRef, useCallback, useEffect } from 'react';
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
import { Tab, Group, GroupColor, nextGroupColor } from '../TabBar/types';
import { GroupModal, GroupDraft } from '../GroupModal';
import { Menu, MenuItem } from '../Menu';
import { buildThreadMenu } from '../../threadMenu';
import {
  FolderIcon, KindIcon, StateIcon,
  IconHome, IconTerm, IconPanel, IconSearch, IconPlus, IconPage, IconPin,
  IconBell, IconPlay, IconX,
} from '../Icons';
// The row order is computed groups-first (see sidebarWalk.ts), so a group with no
// terminals renders as a normal row instead of vanishing from the list. That walk
// is what retired the old Projects shelf.
import { computeSegments } from '../../sidebarWalk';
import {
  threadKind, threadState, stateBreathes, displayTitle, foldThreads,
  projectCounts, sidebarSections,
} from '../../threadView';
import './SidePanel.css';

const THREAD_FOLD_LIMIT = 5;

// Tips for the actions that only arrive in a later phase. They are rendered as
// aria-disabled rows rather than real disabled buttons: a disabled button emits no
// mouse events in Chromium, so the app tooltip would never fire on it.
const TIP_HOME = 'Home arrives in Phase 2';
const TIP_SEARCH = 'Search arrives in Phase 2';
const TIP_PROJECT_PAGE = 'Project page arrives in Phase 2';
const TIP_PIN = 'Pin arrives in Phase 2';

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
}

function ThreadRow({
  tab, isActive, inProject, isDragging, isGroupPreview, inert, overlay,
  onActivate, onContextMenu, onClose,
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
    ? (state === 'needs-you' ? 'breathe-need' : 'breathe-done')
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
    state === 'asleep' ? 'sleep' : '',
    tab.claudeRestorable ? 'restorable' : '',
    breathe,
  ].filter(Boolean).join(' ');

  return (
    <div
      ref={overlay ? undefined : setRef}
      className={className}
      onClick={onActivate}
      onContextMenu={onContextMenu}
      data-kind={threadKind(tab)}
      data-tip={!overlay && tab.claudeRestorable ? 'Click to resume this chat' : undefined}
      {...(overlay ? {} : { ...attributes, ...listeners })}
    >
      <KindIcon kind={threadKind(tab)} />
      <span className="n">{displayTitle(tab.title)}</span>
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
  counts: { needsYou: number; running: number };
  pinned: boolean;
  isDragging: boolean;
  overlay?: boolean;
  onToggle: () => void;
  onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onNewThread: () => void;
  isRenaming: boolean;
  renameValue: string;
  onRenameChange: (v: string) => void;
  onRenameCommit: () => void;
}

function ProjectRow({
  group, threadCount, counts, pinned, isDragging, overlay,
  onToggle, onDoubleClick, onContextMenu, onNewThread,
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
      <FolderIcon color={group.color} open={expanded} size={18} />
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
          <span
            className="ib disabled"
            aria-disabled="true"
            data-tip={TIP_PROJECT_PAGE}
            onPointerDown={stop}
            onClick={stop}
          >
            <IconPage size={14} />
          </span>
          {!pinned && (
            <span
              className="ib disabled"
              aria-disabled="true"
              data-tip={TIP_PIN}
              onPointerDown={stop}
              onClick={stop}
            >
              <IconPin size={14} />
            </span>
          )}
        </>
      )}
    </div>
  );
}

// ─── Main SidePanel ────────────────────────────────────────────────────────────

export interface SidePanelProps {
  tabs: Tab[];
  groups: Group[];
  activeTabId: string;
  collapsed: boolean;
  shells: { id: string; name: string }[];
  onToggleCollapse: () => void;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onNewTab: (groupId?: string, shellId?: string) => void;
  onCreateGroup: (tabId1: string, tabId2?: string) => string;
  onCreateProjectGroup: (draft: GroupDraft, openTerminal: boolean) => void;
  onUpdateGroup: (groupId: string, draft: GroupDraft) => void;
  onAddToGroup: (tabId: string, groupId: string) => void;
  onRemoveFromGroup: (tabId: string) => void;
  onRenameGroup: (groupId: string, label: string) => void;
  onSetGroupColor: (groupId: string, color: GroupColor) => void;
  onToggleGroupCollapse: (groupId: string) => void;
  onDeleteGroup: (groupId: string) => void;
  onMoveTab: (tabId: string, anchorTabId: string, position: 'before' | 'after') => void;
  onMoveGroup: (groupId: string, afterTabId: string | null) => void;
  onMoveGroupAfterGroup: (groupId: string, afterGroupId: string) => void;
}

export function SidePanel(props: SidePanelProps) {
  const {
    tabs, groups, activeTabId, collapsed, shells, onToggleCollapse,
    onActivate, onClose, onNewTab,
    onCreateGroup, onCreateProjectGroup, onUpdateGroup, onAddToGroup, onRemoveFromGroup,
    onRenameGroup, onToggleGroupCollapse,
    onDeleteGroup, onMoveTab, onMoveGroup, onMoveGroupAfterGroup,
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
  // null = closed; groupId absent = creating a new project.
  const [modal, setModal] = useState<{ mode: 'create' | 'edit'; groupId?: string } | null>(null);

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
      }),
    });
  };

  const openProjectMenu = (e: React.MouseEvent, group: Group) => {
    e.preventDefault();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'New thread here', onSelect: () => onNewTab(group.id) },
        { label: 'New thread with shell', submenu: { title: 'Shell', items: shellItems(group.id) } },
        { label: 'Edit project', onSelect: () => setModal({ mode: 'edit', groupId: group.id }) },
        { label: 'Open project page', disabled: true, tip: TIP_PROJECT_PAGE },
        { label: 'Delete project', danger: true, onSelect: () => onDeleteGroup(group.id) },
      ],
    });
  };

  // ─── Derived rows ──────────────────────────────────────────────────────────

  const segments = computeSegments(tabs, groups);
  const { general, pinned, projects } = sidebarSections(segments);
  const groupMap = new Map(groups.map(g => [g.id, g]));
  const draggingTab = draggingTabId ? tabs.find(t => t.id === draggingTabId) : null;
  const draggingGroup = draggingGroupId ? groups.find(g => g.id === draggingGroupId) : null;

  const renderThreadList = (threads: Tab[], key: string, inProject: boolean, inert: boolean) => {
    const { shown, hiddenCount, showMore } = foldThreads(threads, activeTabId, !!expandedLists[key], THREAD_FOLD_LIMIT);
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

  const renderProject = (entry: { group: Group; tabs: Tab[] }, isPinned: boolean) => {
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

  return (
    <>
      <div className={`side-panel${collapsed ? ' collapsed' : ''}`}>
        <div className="brand">
          <span className="ic disabled" aria-disabled="true" data-tip={TIP_HOME}>
            <IconHome size={18} />
          </span>
          <span className="ic" aria-selected="true" data-tip="Workspace">
            <IconTerm size={18} />
          </span>
          <span className="sp" />
          <button className="ic" onClick={onToggleCollapse} data-tip="Close sidebar">
            <IconPanel size={18} />
          </button>
        </div>

        <div className="side-body">
          <div className="srow disabled" aria-disabled="true" data-tip={TIP_SEARCH}>
            <span className="g"><IconSearch size={16} /></span>
            Search
            <span className="k">Ctrl Shift P</span>
          </div>

          <button
            className="srow"
            onClick={() => onNewTab()}
            onContextMenu={openNewThreadShellMenu}
          >
            <span className="g"><IconPlus size={16} /></span>
            New thread
            <span className="k">Ctrl Shift T</span>
          </button>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={e => {
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
            <div className="scroll">
              {general.length > 0 && (
                <div className="sec">
                  <div className="lbl">General</div>
                  {renderThreadList(general, 'general', false, false)}
                </div>
              )}

              {pinned.length > 0 && (
                <div className="sec">
                  <div className="lbl">Pinned</div>
                  {pinned.map(entry => renderProject(entry, true))}
                </div>
              )}

              <div className="sec">
                <div className="lbl lblrow">
                  <span>Projects</span>
                  <button
                    className="ib"
                    data-tip="New project"
                    onClick={() => setModal({ mode: 'create' })}
                  >
                    <IconPlus size={14} />
                  </button>
                </div>
                {projects.map(entry => renderProject(entry, false))}
              </div>
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
                  counts={{ needsYou: 0, running: 0 }}
                  pinned={draggingGroup.pinned}
                  isDragging={false}
                  onToggle={() => {}}
                  onDoubleClick={() => {}}
                  onContextMenu={() => {}}
                  onNewThread={() => {}}
                  isRenaming={false}
                  renameValue=""
                  onRenameChange={() => {}}
                  onRenameCommit={() => {}}
                  overlay
                />
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>

        <div className="rail">
          <button className="ic" onClick={onToggleCollapse} data-tip="Open sidebar">
            <IconPanel size={18} />
          </button>
          <span className="ic disabled" aria-disabled="true" data-tip={TIP_HOME}>
            <IconHome size={18} />
          </span>
          <span className="ic" aria-selected="true" data-tip="Workspace">
            <IconTerm size={18} />
          </span>
          <span className="ic disabled" aria-disabled="true" data-tip={TIP_SEARCH}>
            <IconSearch size={18} />
          </span>
          <button className="ic" onClick={() => onNewTab()} data-tip="New thread">
            <IconPlus size={18} />
          </button>
        </div>
      </div>

      {menu && (
        <Menu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}

      {modal && (() => {
        const editing = modal.groupId ? groups.find(g => g.id === modal.groupId) : undefined;
        // An edit whose project vanished (deleted underneath the menu) has nothing to show.
        if (modal.mode === 'edit' && !editing) return null;
        const initial: GroupDraft = editing
          ? { label: editing.label, color: editing.color, cwd: editing.cwd, shellId: editing.shellId }
          : { label: '', color: nextGroupColor(groups) };
        return (
          <GroupModal
            mode={modal.mode}
            initial={initial}
            shells={shells}
            onCancel={() => setModal(null)}
            onSubmit={(draft, openTerminal) => {
              if (editing) {
                onUpdateGroup(editing.id, draft);
              } else {
                onCreateProjectGroup(draft, openTerminal);
              }
              setModal(null);
            }}
          />
        );
      })()}
    </>
  );
}

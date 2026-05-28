import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
  rectIntersection,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Tab, Group, GroupColor, GROUP_COLORS, COLOR_CYCLE } from './types';
import './TabBar.css';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function groupCssVars(color: GroupColor) {
  const c = GROUP_COLORS[color];
  return {
    '--group-bg': c.bg,
    '--group-border': c.border,
    '--group-text': c.text,
  } as React.CSSProperties;
}

// ─── Context Menu ─────────────────────────────────────────────────────────────

interface CtxMenuState {
  x: number;
  y: number;
  tabId?: string;
  groupId?: string;
}

interface ContextMenuProps extends CtxMenuState {
  tabs: Tab[];
  groups: Group[];
  onClose: () => void;
  onCreateGroup: (tabId: string) => void;
  onAddToGroup: (tabId: string, groupId: string) => void;
  onRemoveFromGroup: (tabId: string) => void;
  onRenameGroup: (groupId: string) => void;
  onSetColor: (groupId: string, color: GroupColor) => void;
  onDeleteGroup: (groupId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewTabInGroup: (groupId: string) => void;
}

function ContextMenu(props: ContextMenuProps) {
  const { x, y, tabId, groupId, tabs, groups, onClose } = props;
  const tab = tabId ? tabs.find(t => t.id === tabId) : undefined;
  const group = groupId ? groups.find(g => g.id === groupId) : undefined;

  useEffect(() => {
    const close = () => onClose();
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [onClose]);

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div className="ctx-menu" style={{ left: x, top: y }} onMouseDown={stop}>
      {tab && (
        <>
          {tab.groupId ? (
            <>
              <div className="ctx-menu-item" onClick={() => { props.onRemoveFromGroup(tab.id); onClose(); }}>
                Remove from group
              </div>
              <div className="ctx-menu-separator" />
            </>
          ) : (
            <>
              <div className="ctx-menu-section">Add to group</div>
              {groups.map(g => (
                <div
                  key={g.id}
                  className="ctx-menu-item"
                  style={groupCssVars(g.color)}
                  onClick={() => { props.onAddToGroup(tab.id, g.id); onClose(); }}
                >
                  <span style={{ color: GROUP_COLORS[g.color].border }}>●</span>
                  {g.label}
                </div>
              ))}
              <div className="ctx-menu-item" onClick={() => { props.onCreateGroup(tab.id); onClose(); }}>
                + New group
              </div>
              <div className="ctx-menu-separator" />
            </>
          )}
          <div className="ctx-menu-item danger" onClick={() => { props.onCloseTab(tab.id); onClose(); }}>
            Close tab
          </div>
        </>
      )}

      {group && (
        <>
          <div className="ctx-menu-item" onClick={() => { props.onNewTabInGroup(group.id); onClose(); }}>
            New tab in group
          </div>
          <div className="ctx-menu-item" onClick={() => { props.onRenameGroup(group.id); onClose(); }}>
            Rename group
          </div>
          <div className="ctx-menu-separator" />
          <div className="ctx-menu-section">Color</div>
          <div className="color-swatches">
            {COLOR_CYCLE.map(c => (
              <div
                key={c}
                className={`color-swatch ${group.color === c ? 'active' : ''}`}
                style={{ background: GROUP_COLORS[c].border }}
                onClick={() => { props.onSetColor(group.id, c); onClose(); }}
              />
            ))}
          </div>
          <div className="ctx-menu-separator" />
          <div className="ctx-menu-item danger" onClick={() => { props.onDeleteGroup(group.id); onClose(); }}>
            Delete group
          </div>
        </>
      )}
    </div>
  );
}

// ─── Tab Item ─────────────────────────────────────────────────────────────────

interface TabItemProps {
  tab: Tab;
  isActive: boolean;
  isDragging: boolean;
  isGroupPreviewTarget: boolean;
  isDropBefore: boolean;
  groupColor?: GroupColor;
  onActivate: () => void;
  onClose: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  overlay?: boolean;
}

function TabItem({
  tab, isActive, isDragging, isGroupPreviewTarget, isDropBefore,
  groupColor, onActivate, onClose, onContextMenu, overlay,
}: TabItemProps) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: tab.id, disabled: overlay });
  const { setNodeRef: setDropRef } = useDroppable({ id: tab.id, disabled: overlay });

  const style = overlay
    ? undefined
    : { transform: CSS.Translate.toString(transform) };

  const setRef = (node: HTMLDivElement | null) => {
    setNodeRef(node);
    setDropRef(node);
  };

  const colorVars = groupColor ? groupCssVars(groupColor) : {};

  const classNames = [
    'tab-item',
    isActive ? 'active' : '',
    isDragging ? 'dragging' : '',
    isGroupPreviewTarget ? 'group-preview-target' : '',
    isDropBefore ? 'drop-before' : '',
    overlay ? 'tab-drag-overlay' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      ref={overlay ? undefined : setRef}
      className={classNames}
      style={{ ...style, ...colorVars }}
      onClick={onActivate}
      onContextMenu={onContextMenu}
      {...(overlay ? {} : { ...attributes, ...listeners })}
    >
      <span className="tab-title">{tab.title}</span>
      <button
        className="tab-close"
        onClick={e => { e.stopPropagation(); onClose(); }}
        tabIndex={-1}
      >
        ×
      </button>
    </div>
  );
}

// ─── Group Pill ───────────────────────────────────────────────────────────────

interface GroupPillProps {
  group: Group;
  tabCount: number;
  onToggleCollapse: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onRenameStart: () => void;
  isRenaming: boolean;
  renameValue: string;
  onRenameChange: (v: string) => void;
  onRenameCommit: () => void;
}

function GroupPill({
  group, tabCount, onToggleCollapse, onContextMenu, onRenameStart,
  isRenaming, renameValue, onRenameChange, onRenameCommit,
}: GroupPillProps) {
  const colorVars = groupCssVars(group.color);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === 'Escape') onRenameCommit();
  };

  return (
    <div
      className="group-pill"
      style={colorVars}
      onClick={onToggleCollapse}
      onContextMenu={onContextMenu}
      onDoubleClick={e => { e.stopPropagation(); onRenameStart(); }}
    >
      <span className="group-dot" />
      {isRenaming ? (
        <input
          autoFocus
          className="group-label-input"
          style={colorVars}
          value={renameValue}
          onChange={e => onRenameChange(e.target.value)}
          onBlur={onRenameCommit}
          onKeyDown={handleKeyDown}
          onClick={e => e.stopPropagation()}
        />
      ) : (
        <span className="group-label">{group.label}</span>
      )}
      {group.collapsed && (
        <span className="collapsed-count">{tabCount}</span>
      )}
      <span className="group-collapse-btn">
        {group.collapsed ? '▶' : '▼'}
      </span>
    </div>
  );
}

// ─── Segment types ─────────────────────────────────────────────────────────────

type Segment =
  | { type: 'tab'; tab: Tab }
  | { type: 'group'; group: Group; tabs: Tab[] };

function computeSegments(tabs: Tab[], groups: Group[]): Segment[] {
  const segments: Segment[] = [];
  const groupMap = new Map(groups.map(g => [g.id, g]));

  let i = 0;
  while (i < tabs.length) {
    const tab = tabs[i];
    if (tab.groupId && groupMap.has(tab.groupId)) {
      const group = groupMap.get(tab.groupId)!;
      const groupTabs: Tab[] = [];
      while (i < tabs.length && tabs[i].groupId === tab.groupId) {
        groupTabs.push(tabs[i]);
        i++;
      }
      segments.push({ type: 'group', group, tabs: groupTabs });
    } else {
      segments.push({ type: 'tab', tab });
      i++;
    }
  }
  return segments;
}

// ─── Main TabBar ──────────────────────────────────────────────────────────────

interface TabBarProps {
  tabs: Tab[];
  groups: Group[];
  activeTabId: string;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onNewTab: (groupId?: string) => void;
  onCreateGroup: (tabId1: string, tabId2: string) => void;
  onAddToGroup: (tabId: string, groupId: string) => void;
  onRemoveFromGroup: (tabId: string) => void;
  onRenameGroup: (groupId: string, label: string) => void;
  onSetGroupColor: (groupId: string, color: GroupColor) => void;
  onToggleCollapse: (groupId: string) => void;
  onDeleteGroup: (groupId: string) => void;
  onMoveTab: (tabId: string, afterTabId: string | null) => void;
}

export function TabBar(props: TabBarProps) {
  const {
    tabs, groups, activeTabId,
    onActivate, onClose, onNewTab,
    onCreateGroup, onAddToGroup, onRemoveFromGroup,
    onRenameGroup, onSetGroupColor, onToggleCollapse, onDeleteGroup,
    onMoveTab,
  } = props;

  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const [groupPreviewTarget, setGroupPreviewTarget] = useState<string | null>(null);
  const [dropBeforeTarget, setDropBeforeTarget] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastOverRef = useRef<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setDraggingTabId(event.active.id as string);
    setGroupPreviewTarget(null);
    setDropBeforeTarget(null);
    lastOverRef.current = null;
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const overId = event.over?.id as string | null;

    if (overId !== lastOverRef.current) {
      if (dwellTimerRef.current) clearTimeout(dwellTimerRef.current);
      setGroupPreviewTarget(null);
      lastOverRef.current = overId;

      if (overId && overId !== draggingTabId) {
        // Start dwell timer for group creation
        dwellTimerRef.current = setTimeout(() => {
          setGroupPreviewTarget(overId);
          setDropBeforeTarget(null);
        }, 550);
        // Show insert indicator immediately (will be cleared if dwell fires)
        setDropBeforeTarget(overId);
      } else {
        setDropBeforeTarget(null);
      }
    }
  }, [draggingTabId]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    if (dwellTimerRef.current) clearTimeout(dwellTimerRef.current);
    const activeId = event.active.id as string;
    const overId = event.over?.id as string | null;

    if (groupPreviewTarget && overId === groupPreviewTarget && overId !== activeId) {
      // Group creation / join
      const targetTab = tabs.find(t => t.id === groupPreviewTarget);
      if (targetTab?.groupId) {
        onAddToGroup(activeId, targetTab.groupId);
      } else {
        onCreateGroup(activeId, groupPreviewTarget);
      }
    } else if (overId && overId !== activeId) {
      // Reorder: insert dragged tab after the target
      onMoveTab(activeId, overId);
    }

    setDraggingTabId(null);
    setGroupPreviewTarget(null);
    setDropBeforeTarget(null);
    lastOverRef.current = null;
  }, [groupPreviewTarget, tabs, onAddToGroup, onCreateGroup, onMoveTab]);

  const handleDragCancel = useCallback(() => {
    if (dwellTimerRef.current) clearTimeout(dwellTimerRef.current);
    setDraggingTabId(null);
    setGroupPreviewTarget(null);
    setDropBeforeTarget(null);
    lastOverRef.current = null;
  }, []);

  const openTabCtxMenu = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, tabId });
  };

  const openGroupCtxMenu = (e: React.MouseEvent, groupId: string) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, groupId });
  };

  const startRename = (groupId: string) => {
    const g = groups.find(g => g.id === groupId);
    if (!g) return;
    setRenamingGroupId(groupId);
    setRenameValue(g.label);
    setCtxMenu(null);
  };

  const commitRename = () => {
    if (renamingGroupId && renameValue.trim()) {
      onRenameGroup(renamingGroupId, renameValue.trim());
    }
    setRenamingGroupId(null);
  };

  const segments = computeSegments(tabs, groups);
  const draggingTab = draggingTabId ? tabs.find(t => t.id === draggingTabId) : null;

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={rectIntersection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="tab-bar">
          {segments.map(seg => {
            if (seg.type === 'tab') {
              const { tab } = seg;
              return (
                <TabItem
                  key={tab.id}
                  tab={tab}
                  isActive={tab.id === activeTabId}
                  isDragging={tab.id === draggingTabId}
                  isGroupPreviewTarget={tab.id === groupPreviewTarget}
                  isDropBefore={tab.id === dropBeforeTarget && tab.id !== groupPreviewTarget}
                  onActivate={() => onActivate(tab.id)}
                  onClose={() => onClose(tab.id)}
                  onContextMenu={e => openTabCtxMenu(e, tab.id)}
                />
              );
            }

            const { group, tabs: groupTabs } = seg;
            const colorVars = groupCssVars(group.color);

            return (
              <div
                key={group.id}
                className={`tab-group ${group.collapsed ? 'collapsed' : ''}`}
                style={colorVars}
              >
                <GroupPill
                  group={group}
                  tabCount={groupTabs.length}
                  onToggleCollapse={() => onToggleCollapse(group.id)}
                  onContextMenu={e => openGroupCtxMenu(e, group.id)}
                  onRenameStart={() => startRename(group.id)}
                  isRenaming={renamingGroupId === group.id}
                  renameValue={renameValue}
                  onRenameChange={setRenameValue}
                  onRenameCommit={commitRename}
                />
                {!group.collapsed && (
                  <div className="group-tabs">
                    {groupTabs.map(tab => (
                      <TabItem
                        key={tab.id}
                        tab={tab}
                        isActive={tab.id === activeTabId}
                        isDragging={tab.id === draggingTabId}
                        isGroupPreviewTarget={tab.id === groupPreviewTarget}
                        isDropBefore={tab.id === dropBeforeTarget && tab.id !== groupPreviewTarget}
                        groupColor={group.color}
                        onActivate={() => onActivate(tab.id)}
                        onClose={() => onClose(tab.id)}
                        onContextMenu={e => openTabCtxMenu(e, tab.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          <button className="new-tab-btn" onClick={() => onNewTab()} title="New tab">
            +
          </button>
        </div>

        <DragOverlay dropAnimation={null}>
          {draggingTab ? (
            <TabItem
              tab={draggingTab}
              isActive={false}
              isDragging={false}
              isGroupPreviewTarget={false}
              isDropBefore={false}
              onActivate={() => {}}
              onClose={() => {}}
              onContextMenu={() => {}}
              overlay
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      {ctxMenu && (
        <ContextMenu
          {...ctxMenu}
          tabs={tabs}
          groups={groups}
          onClose={() => setCtxMenu(null)}
          onCreateGroup={tabId => {
            onCreateGroup(tabId, tabId);
          }}
          onAddToGroup={onAddToGroup}
          onRemoveFromGroup={onRemoveFromGroup}
          onRenameGroup={startRename}
          onSetColor={onSetGroupColor}
          onDeleteGroup={onDeleteGroup}
          onCloseTab={onClose}
          onNewTabInGroup={onNewTab}
        />
      )}
    </>
  );
}

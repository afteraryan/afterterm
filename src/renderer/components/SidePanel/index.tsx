import React, { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
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
import { Tab, Group, GroupColor, GROUP_COLORS, COLOR_CYCLE, TabNotification } from '../TabBar/types';
import './SidePanel.css';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function gc(color: GroupColor) {
  return GROUP_COLORS[color].border;
}

// Strip a leading notification/Claude glyph (✳ ▶ ✅ ⚠ ⏳ ⚙ braille spinner …) from a
// title, so a restorable tab's muted ✳ marker doesn't double up with the title's own.
function stripLeadingGlyph(title: string): string {
  return title.replace(/^[^\x00-\x7F]+\s*/, '');
}

const MENU_VIEWPORT_MARGIN = 8;

// ─── Context Menu ─────────────────────────────────────────────────────────────

interface CtxMenu {
  x: number;
  y: number;
  tabId?: string;
  groupId?: string;
}

interface ContextMenuProps {
  menu: CtxMenu;
  tabs: Tab[];
  groups: Group[];
  onClose: () => void;
  onCreateGroup: (tabId: string) => void;
  onAddToGroup: (tabId: string, groupId: string) => void;
  onRemoveFromGroup: (tabId: string) => void;
  onRenameGroup: (groupId: string) => void;
  onSetColor: (groupId: string, color: GroupColor) => void;
  onSetDirectory: (groupId: string) => void;
  onDeleteGroup: (groupId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewTabInGroup: (groupId: string) => void;
}

function ContextMenu({ menu, tabs, groups, onClose, ...actions }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: menu.x, top: menu.y });
  const tab = menu.tabId ? tabs.find(t => t.id === menu.tabId) : undefined;
  const group = menu.groupId ? groups.find(g => g.id === menu.groupId) : undefined;

  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!element) return;

    const rect = element.getBoundingClientRect();
    const maxLeft = Math.max(MENU_VIEWPORT_MARGIN, window.innerWidth - rect.width - MENU_VIEWPORT_MARGIN);
    const maxTop = Math.max(MENU_VIEWPORT_MARGIN, window.innerHeight - rect.height - MENU_VIEWPORT_MARGIN);
    const left = Math.min(Math.max(menu.x, MENU_VIEWPORT_MARGIN), maxLeft);
    const top = Math.min(Math.max(menu.y, MENU_VIEWPORT_MARGIN), maxTop);

    setPosition(current => current.left === left && current.top === top ? current : { left, top });
  });

  useEffect(() => {
    const handler = () => onClose();
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div ref={menuRef} className="ctx-menu" style={position} onMouseDown={e => e.stopPropagation()}>
      {tab && (
        <>
          {tab.groupId ? (
            <>
              <div className="ctx-menu-item" onClick={() => { actions.onRemoveFromGroup(tab.id); onClose(); }}>
                Remove from group
              </div>
              <div className="ctx-menu-separator" />
            </>
          ) : (
            <>
              {groups.length > 0 && (
                <>
                  <div className="ctx-menu-section">Add to group</div>
                  {groups.map(g => (
                    <div
                      key={g.id}
                      className="ctx-menu-item"
                      onClick={() => { actions.onAddToGroup(tab.id, g.id); onClose(); }}
                    >
                      <span style={{ color: gc(g.color) }}>●</span>
                      {g.label}
                    </div>
                  ))}
                  <div className="ctx-menu-separator" />
                </>
              )}
              <div className="ctx-menu-item" onClick={() => { actions.onCreateGroup(tab.id); onClose(); }}>
                New group with this tab
              </div>
              <div className="ctx-menu-separator" />
            </>
          )}
          <div className="ctx-menu-item danger" onClick={() => { actions.onCloseTab(tab.id); onClose(); }}>
            Close terminal
          </div>
        </>
      )}

      {group && (
        <>
          <div className="ctx-menu-item" onClick={() => { actions.onNewTabInGroup(group.id); onClose(); }}>
            New terminal in group
          </div>
          <div className="ctx-menu-item" onClick={() => { actions.onRenameGroup(group.id); onClose(); }}>
            Rename group
          </div>
          <div className="ctx-menu-item" onClick={() => { actions.onSetDirectory(group.id); onClose(); }}>
            Set directory{group.cwd ? '…' : ''}
          </div>
          {group.cwd && (
            <div className="ctx-menu-detail">{group.cwd.split('\\').pop()}</div>
          )}
          <div className="ctx-menu-separator" />
          <div className="ctx-menu-section">Color</div>
          <div className="color-swatches">
            {COLOR_CYCLE.map(c => (
              <div
                key={c}
                className={`color-swatch ${group.color === c ? 'active-swatch' : ''}`}
                style={{ background: GROUP_COLORS[c].border }}
                onClick={() => { actions.onSetColor(group.id, c); onClose(); }}
              />
            ))}
          </div>
          <div className="ctx-menu-separator" />
          <div className="ctx-menu-item danger" onClick={() => { actions.onDeleteGroup(group.id); onClose(); }}>
            Delete group
          </div>
        </>
      )}
    </div>
  );
}

// ─── Tab row ───────────────────────────────────────────────────────────────────

const NOTIF_DOT_COLOR: Record<TabNotification, string> = {
  done:       '#46b464',
  attention:  '#d28c32',
  background: '#d28c32',
  compacting: '#666',
  working:    '#61afef',
};

interface TabRowProps {
  tab: Tab;
  isActive: boolean;
  inGroup: boolean;
  groupColor?: GroupColor;
  isDragging: boolean;
  isGroupPreview: boolean;
  onActivate: () => void;
  onClose: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  overlay?: boolean;
}

function TabRow({
  tab, isActive, inGroup, groupColor: gc_, isDragging, isGroupPreview,
  onActivate, onClose, onContextMenu, overlay,
}: TabRowProps) {
  const { attributes, listeners, setNodeRef: setDragRef } = useDraggable({
    id: tab.id,
    disabled: !!overlay,
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: tab.id,
    disabled: !!overlay,
  });

  const setRef = (node: HTMLDivElement | null) => {
    setDragRef(node);
    setDropRef(node);
  };

  // Arrow color: group color if in a group, gray shades otherwise
  const arrowColor = gc_ ? GROUP_COLORS[gc_].border : '#3a3a3a';
  const arrowColorActive = gc_ ? GROUP_COLORS[gc_].border : '#5e5e5e';

  // No transform on the in-list row — the DragOverlay renders the moving copy.
  // Translating the source corrupts collision detection (it stays "closest to
  // itself" when dragging up, so up-moves silently no-op).
  const style: React.CSSProperties = {
    '--arrow-color': arrowColor,
    '--arrow-color-active': arrowColorActive,
  } as React.CSSProperties;

  const notif = tab.notification;
  const className = [
    'tab-row',
    isActive ? 'active' : '',
    inGroup ? 'in-group' : '',
    isDragging ? 'dragging' : '',
    isOver && !isDragging ? 'drop-target' : '',
    isGroupPreview ? 'group-preview' : '',
    overlay ? 'tab-drag-overlay' : '',
    notif && !isActive ? `notif-${notif}` : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      ref={overlay ? undefined : setRef}
      className={className}
      style={style}
      onClick={onActivate}
      onContextMenu={onContextMenu}
      {...(overlay ? {} : { ...attributes, ...listeners })}
    >
      <span className="tab-shell-icon">›</span>
      {notif && !overlay && (notif === 'working' || !isActive) ? (
        <span
          className={`tab-notif-dot${notif === 'working' ? ' tab-notif-working' : ''}`}
          style={notif !== 'working' ? { background: NOTIF_DOT_COLOR[notif] } : undefined}
        />
      ) : null}
      <span className="tab-row-title">{tab.claudeRestorable ? stripLeadingGlyph(tab.title) : tab.title}</span>
      {tab.claudeRestorable && !overlay ? (
        <span className="tab-restorable-star" title="Saved Claude session — click to resume">✳</span>
      ) : null}
      <button
        className="tab-row-close"
        onClick={e => { e.stopPropagation(); onClose(); }}
        tabIndex={-1}
      >
        ×
      </button>
    </div>
  );
}

// ─── Group header ──────────────────────────────────────────────────────────────

interface GroupHeaderProps {
  group: Group;
  tabCount: number;
  notifCount: number;
  isDragging: boolean;
  onToggle: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onAddTab: () => void;
  onAddTabWithShell: (shellId: string) => void;
  shells: { id: string; name: string }[];
  isRenaming: boolean;
  renameValue: string;
  onRenameChange: (v: string) => void;
  onRenameCommit: () => void;
  overlay?: boolean;
}

function GroupHeader({
  group, tabCount, notifCount, isDragging, onToggle, onContextMenu, onDoubleClick, onAddTab,
  onAddTabWithShell, shells,
  isRenaming, renameValue, onRenameChange, onRenameCommit, overlay,
}: GroupHeaderProps) {
  const [showShellMenu, setShowShellMenu] = useState(false);
  const shellMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showShellMenu) return;
    const handler = (e: MouseEvent) => {
      if (shellMenuRef.current && !shellMenuRef.current.contains(e.target as Node)) {
        setShowShellMenu(false);
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [showShellMenu]);
  const { attributes, listeners, setNodeRef: setDragRef } = useDraggable({
    id: `group-drag-${group.id}`,
    disabled: !!overlay,
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `group-drop-${group.id}`,
    disabled: !!overlay || isDragging,
  });

  const setRef = (node: HTMLDivElement | null) => {
    setDragRef(node);
    setDropRef(node);
  };

  const color = gc(group.color);

  const handleClick = (e: React.MouseEvent) => {
    if (e.detail === 2) return;
    onToggle();
  };

  const style: React.CSSProperties = {
    '--gc': color,
  } as React.CSSProperties;

  const className = [
    'group-header',
    isOver ? 'drop-over' : '',
    isDragging ? 'dragging' : '',
    overlay ? 'group-drag-overlay' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      ref={overlay ? undefined : setRef}
      className={className}
      style={style}
      onClick={handleClick}
      onDoubleClick={e => { e.stopPropagation(); onDoubleClick(); }}
      onContextMenu={onContextMenu}
      {...(overlay ? {} : { ...attributes, ...listeners })}
    >
      <span className="group-chevron">
        {group.collapsed ? '▶' : '▼'}
      </span>
      <span className="group-dot" />
      {isRenaming ? (
        <input
          autoFocus
          className="group-name-input"
          value={renameValue}
          onChange={e => onRenameChange(e.target.value)}
          onBlur={onRenameCommit}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') onRenameCommit(); }}
          onClick={e => e.stopPropagation()}
        />
      ) : (
        <div className="group-name-block">
          <span className="group-name">{group.label}</span>
          {group.cwd && <span className="group-cwd">{group.cwd.split('\\').pop()}</span>}
        </div>
      )}
      {group.collapsed && <span className="group-count">{tabCount}</span>}
      {notifCount > 0 && !overlay && (
        <span className="group-notif-badge">{notifCount}</span>
      )}
      <button
        className="group-add-btn"
        onClick={e => { e.stopPropagation(); onAddTab(); }}
        title="New terminal in group"
        tabIndex={-1}
      >
        +
      </button>
      <div className="group-shell-wrapper" ref={shellMenuRef}>
        <button
          className="group-add-btn group-shell-toggle"
          onClick={e => { e.stopPropagation(); setShowShellMenu(p => !p); }}
          title="Select shell type"
          tabIndex={-1}
        >
          ▾
        </button>
        {showShellMenu && shells.length > 0 && (
          <div className="shell-dropdown group-shell-dropdown">
            {shells.map(s => (
              <div
                key={s.id}
                className="shell-dropdown-item"
                onClick={e => { e.stopPropagation(); onAddTabWithShell(s.id); setShowShellMenu(false); }}
              >
                {s.name}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Segment helpers ───────────────────────────────────────────────────────────

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
        groupTabs.push(tabs[i++]);
      }
      segments.push({ type: 'group', group, tabs: groupTabs });
    } else {
      segments.push({ type: 'tab', tab });
      i++;
    }
  }
  return segments;
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
  onCreateGroup: (tabId1: string, tabId2?: string) => void;
  onAddToGroup: (tabId: string, groupId: string) => void;
  onRemoveFromGroup: (tabId: string) => void;
  onRenameGroup: (groupId: string, label: string) => void;
  onSetGroupColor: (groupId: string, color: GroupColor) => void;
  onSetGroupCwd: (groupId: string) => void;
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
    onCreateGroup, onAddToGroup, onRemoveFromGroup,
    onRenameGroup, onSetGroupColor, onSetGroupCwd, onToggleGroupCollapse,
    onDeleteGroup, onMoveTab, onMoveGroup, onMoveGroupAfterGroup,
  } = props;

  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null);
  const [groupPreviewTarget, setGroupPreviewTarget] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [shellDropdown, setShellDropdown] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const shellDropdownRef = useRef<HTMLDivElement>(null);
  const helpRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!shellDropdown && !helpOpen) return;
    const handler = (e: MouseEvent) => {
      if (shellDropdown && shellDropdownRef.current && !shellDropdownRef.current.contains(e.target as Node)) {
        setShellDropdown(false);
      }
      if (helpOpen && helpRef.current && !helpRef.current.contains(e.target as Node)) {
        setHelpOpen(false);
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [shellDropdown, helpOpen]);

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

    // Dwell-to-group preview only arms when both tabs are ungrouped — that's the only
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

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    if (dwellTimerRef.current) clearTimeout(dwellTimerRef.current);
    const activeId = event.active.id as string;
    const overId = event.over?.id as string | null;

    setDraggingTabId(null);
    setDraggingGroupId(null);
    setGroupPreviewTarget(null);
    lastOverRef.current = null;

    if (!overId || overId === activeId) return;

    // Group being dragged
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

    // Tab being dragged
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

    // Dwell-to-group is the explicit "merge into a new group" gesture — only needed
    // when both tabs are ungrouped (positional drops join an existing group on their
    // own, since moveTab inherits the drop target's group).
    if (groupPreviewTarget && overId === groupPreviewTarget) {
      const targetTab = tabs.find(t => t.id === groupPreviewTarget);
      if (targetTab && !targetTab.groupId && !activeTab?.groupId) {
        onCreateGroup(activeId, groupPreviewTarget);
        return;
      }
      // else fall through to a positional move
    }

    // Dropped on a group header → land at the top of that group (joining it).
    if (overId.startsWith('group-drop-') || overId.startsWith('group-drag-')) {
      const targetGroupId = overId.replace('group-drop-', '').replace('group-drag-', '');
      const firstInGroup = tabs.find(t => t.groupId === targetGroupId);
      if (firstInGroup && firstInGroup.id !== activeId) {
        onMoveTab(activeId, firstInGroup.id, 'before');
      } else if (!firstInGroup) {
        onAddToGroup(activeId, targetGroupId);
      }
      return;
    }

    reorderOnto(overId);
  }, [groupPreviewTarget, tabs, onAddToGroup, onCreateGroup, onMoveTab, onMoveGroup, onMoveGroupAfterGroup]);

  const handleDragCancel = useCallback(() => {
    if (dwellTimerRef.current) clearTimeout(dwellTimerRef.current);
    setDraggingTabId(null);
    setDraggingGroupId(null);
    setGroupPreviewTarget(null);
    lastOverRef.current = null;
  }, []);

  const openTabCtx = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, tabId });
  };

  const openGroupCtx = (e: React.MouseEvent, groupId: string) => {
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

  const groupMap = new Map(groups.map(g => [g.id, g]));
  const segments = computeSegments(tabs, groups);
  const draggingTab = draggingTabId ? tabs.find(t => t.id === draggingTabId) : null;
  const draggingGroup = draggingGroupId ? groups.find(g => g.id === draggingGroupId) : null;

  return (
    <>
      <div className={`side-panel ${collapsed ? 'collapsed' : ''}`}>
        <div className="panel-header">
          <span className="panel-title">Terminals</span>
          <div className="panel-header-actions">
            <button className="panel-icon-btn" onClick={() => onNewTab()} title="New terminal">+</button>
            <div className="shell-dropdown-wrapper" ref={shellDropdownRef}>
              <button
                className="panel-icon-btn shell-dropdown-toggle"
                onClick={() => setShellDropdown(p => !p)}
                title="Select shell type"
              >
                ▾
              </button>
              {shellDropdown && shells.length > 0 && (
                <div className="shell-dropdown">
                  {shells.map(s => (
                    <div
                      key={s.id}
                      className="shell-dropdown-item"
                      onClick={() => { onNewTab(undefined, s.id); setShellDropdown(false); }}
                    >
                      {s.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="help-wrapper" ref={helpRef}>
              <button
                className="panel-icon-btn help-toggle"
                onClick={() => setHelpOpen(p => !p)}
                title="Keyboard shortcuts"
              >
                ?
              </button>
              {helpOpen && (
                <div className="help-tooltip">
                  <div className="help-title">Shortcuts</div>
                  <div className="help-row"><kbd>Ctrl+Shift+T</kbd><span>New tab</span></div>
                  <div className="help-row"><kbd>Ctrl+Shift+W</kbd><span>Close tab</span></div>
                  <div className="help-row"><kbd>Ctrl+Tab</kbd><span>Next tab</span></div>
                  <div className="help-row"><kbd>Ctrl+Shift+Tab</kbd><span>Previous tab</span></div>
                  <div className="help-row"><kbd>Ctrl+Shift+B</kbd><span>Toggle panel</span></div>
                  <div className="help-separator" />
                  <div className="help-row"><kbd>Ctrl+V</kbd><span>Paste</span></div>
                  <div className="help-row"><kbd>Ctrl+C</kbd><span>Copy / SIGINT</span></div>
                </div>
              )}
            </div>
            <button className="panel-icon-btn" onClick={onToggleCollapse} title="Close panel">‹</button>
          </div>
        </div>

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
          <div className="panel-list">
            {segments.map(seg => {
              if (seg.type === 'tab') {
                const { tab } = seg;
                return (
                  <TabRow
                    key={tab.id}
                    tab={tab}
                    isActive={tab.id === activeTabId}
                    inGroup={false}
                    isDragging={tab.id === draggingTabId}
                    isGroupPreview={tab.id === groupPreviewTarget}
                    onActivate={() => onActivate(tab.id)}
                    onClose={() => onClose(tab.id)}
                    onContextMenu={e => openTabCtx(e, tab.id)}
                  />
                );
              }

              const { group, tabs: groupTabs } = seg;
              const notifCount = groupTabs.filter(t => t.notification && t.notification !== 'working' && t.id !== activeTabId).length;
              return (
                <div key={group.id} className="group-section">
                  <GroupHeader
                    group={group}
                    tabCount={groupTabs.length}
                    notifCount={notifCount}
                    isDragging={group.id === draggingGroupId}
                    onToggle={() => onToggleGroupCollapse(group.id)}
                    onContextMenu={e => openGroupCtx(e, group.id)}
                    onDoubleClick={() => startRename(group.id)}
                    onAddTab={() => onNewTab(group.id)}
                    onAddTabWithShell={shellId => onNewTab(group.id, shellId)}
                    shells={shells}
                    isRenaming={renamingGroupId === group.id}
                    renameValue={renameValue}
                    onRenameChange={setRenameValue}
                    onRenameCommit={commitRename}
                  />
                  {!group.collapsed && groupTabs.map(tab => (
                    <TabRow
                      key={tab.id}
                      tab={tab}
                      isActive={tab.id === activeTabId}
                      inGroup
                      groupColor={group.color}
                      isDragging={tab.id === draggingTabId}
                      isGroupPreview={tab.id === groupPreviewTarget}
                      onActivate={() => onActivate(tab.id)}
                      onClose={() => onClose(tab.id)}
                      onContextMenu={e => openTabCtx(e, tab.id)}
                    />
                  ))}
                </div>
              );
            })}
          </div>

          <DragOverlay dropAnimation={null}>
            {draggingTab ? (
              <TabRow
                tab={draggingTab}
                isActive={false}
                inGroup={!!draggingTab.groupId}
                groupColor={draggingTab.groupId ? groupMap.get(draggingTab.groupId)?.color : undefined}
                isDragging={false}
                isGroupPreview={false}
                onActivate={() => {}}
                onClose={() => {}}
                onContextMenu={() => {}}
                overlay
              />
            ) : draggingGroup ? (
              <GroupHeader
                group={draggingGroup}
                tabCount={tabs.filter(t => t.groupId === draggingGroup.id).length}
                notifCount={0}
                isDragging={false}
                onToggle={() => {}}
                onContextMenu={() => {}}
                onDoubleClick={() => {}}
                onAddTab={() => {}}
                onAddTabWithShell={() => {}}
                shells={[]}
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

      {ctxMenu && (
        <ContextMenu
          menu={ctxMenu}
          tabs={tabs}
          groups={groups}
          onClose={() => setCtxMenu(null)}
          onCreateGroup={tabId => { onCreateGroup(tabId); setCtxMenu(null); }}
          onAddToGroup={(tabId, groupId) => { onAddToGroup(tabId, groupId); setCtxMenu(null); }}
          onRemoveFromGroup={tabId => { onRemoveFromGroup(tabId); setCtxMenu(null); }}
          onRenameGroup={startRename}
          onSetColor={(groupId, color) => { onSetGroupColor(groupId, color); setCtxMenu(null); }}
          onSetDirectory={groupId => { onSetGroupCwd(groupId); setCtxMenu(null); }}
          onDeleteGroup={groupId => { onDeleteGroup(groupId); setCtxMenu(null); }}
          onCloseTab={tabId => { onClose(tabId); setCtxMenu(null); }}
          onNewTabInGroup={groupId => { onNewTab(groupId); setCtxMenu(null); }}
        />
      )}
    </>
  );
}

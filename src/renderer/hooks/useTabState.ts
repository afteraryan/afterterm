import { useState, useCallback } from 'react';
import { Tab, Group, GroupColor, COLOR_CYCLE, TabNotification } from '../components/TabBar/types';

let tabCounter = 0;
let groupCounter = 0;

function makeTabId() { return `tab-${++tabCounter}`; }
function makeGroupId() { return `group-${++groupCounter}`; }

export function useTabState() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('');

  const addTab = useCallback((groupId?: string, shellId?: string) => {
    const id = makeTabId();
    const groupCwd = groupId ? groups.find(g => g.id === groupId)?.cwd : undefined;
    const newTab: Tab = { id, title: 'Terminal', groupId, shellId, cwd: groupCwd };
    setTabs(prev => {
      if (groupId) {
        const lastIdx = prev.map(t => t.groupId).lastIndexOf(groupId);
        if (lastIdx === -1) return [...prev, newTab];
        const next = [...prev];
        next.splice(lastIdx + 1, 0, newTab);
        return next;
      }
      return [...prev, newTab];
    });
    setActiveTabId(id);
    return id;
  }, [groups]);

  const closeTab = useCallback((tabId: string) => {
    setTabs(prev => {
      const idx = prev.findIndex(t => t.id === tabId);
      const next = prev.filter(t => t.id !== tabId);
      if (activeTabId === tabId && next.length > 0) {
        const newActive = next[Math.min(idx, next.length - 1)];
        setActiveTabId(newActive.id);
      }
      return next;
    });
  }, [activeTabId]);

  const renameTab = useCallback((tabId: string, title: string) => {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, title } : t));
  }, []);

  const setTabNotification = useCallback((tabId: string, notification: TabNotification | undefined) => {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, notification } : t));
  }, []);

  const updateTabCwd = useCallback((tabId: string, cwd: string) => {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, cwd } : t));
  }, []);

  const createGroup = useCallback((tabId1: string, tabId2?: string): string => {
    const id = makeGroupId();
    const usedColors = groups.map(g => g.color);
    const color = COLOR_CYCLE.find(c => !usedColors.includes(c)) ?? COLOR_CYCLE[groups.length % COLOR_CYCLE.length];
    const newGroup: Group = { id, label: 'New Group', color, collapsed: false };
    setGroups(prev => [...prev, newGroup]);
    setTabs(prev => {
      if (!tabId2 || tabId2 === tabId1) {
        return prev.map(t => t.id === tabId1 ? { ...t, groupId: id } : t);
      }
      const t1Idx = prev.findIndex(t => t.id === tabId1);
      const t2Idx = prev.findIndex(t => t.id === tabId2);
      let next = prev.map(t =>
        t.id === tabId1 || t.id === tabId2 ? { ...t, groupId: id } : t
      );
      if (t1Idx > -1 && t2Idx > -1 && Math.abs(t1Idx - t2Idx) > 1) {
        const tab1 = next.find(t => t.id === tabId1)!;
        next = next.filter(t => t.id !== tabId1);
        const newT2Idx = next.findIndex(t => t.id === tabId2);
        next.splice(newT2Idx, 0, tab1);
      }
      return next;
    });
    return id;
  }, [groups]);

  const addToGroup = useCallback((tabId: string, groupId: string) => {
    setTabs(prev => {
      const next = prev.map(t => t.id === tabId ? { ...t, groupId } : t);
      const tab = next.find(t => t.id === tabId)!;
      const withoutTab = next.filter(t => t.id !== tabId);
      const lastGroupIdx = withoutTab.map(t => t.groupId).lastIndexOf(groupId);
      withoutTab.splice(lastGroupIdx + 1, 0, tab);
      return withoutTab;
    });
  }, []);

  const removeFromGroup = useCallback((tabId: string) => {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, groupId: undefined } : t));
  }, []);

  const renameGroup = useCallback((groupId: string, label: string) => {
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, label } : g));
  }, []);

  const setGroupColor = useCallback((groupId: string, color: GroupColor) => {
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, color } : g));
  }, []);

  const setGroupCwd = useCallback((groupId: string, cwd: string) => {
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, cwd } : g));
  }, []);

  const toggleGroupCollapse = useCallback((groupId: string) => {
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, collapsed: !g.collapsed } : g));
  }, []);

  const deleteGroup = useCallback((groupId: string) => {
    setGroups(prev => prev.filter(g => g.id !== groupId));
    setTabs(prev => prev.map(t => t.groupId === groupId ? { ...t, groupId: undefined } : t));
  }, []);

  const moveTab = useCallback((tabId: string, anchorTabId: string, position: 'before' | 'after') => {
    setTabs(prev => {
      const tab = prev.find(t => t.id === tabId);
      if (!tab || tabId === anchorTabId) return prev;
      const without = prev.filter(t => t.id !== tabId);
      const anchorIdx = without.findIndex(t => t.id === anchorTabId);
      if (anchorIdx === -1) return prev;
      const insertIdx = position === 'before' ? anchorIdx : anchorIdx + 1;
      const next = [...without];
      next.splice(insertIdx, 0, tab);

      // Reconcile group membership from where the tab landed:
      const tabIdx = next.findIndex(t => t.id === tabId);
      const prevG = tabIdx > 0 ? next[tabIdx - 1].groupId : undefined;
      const nextG = tabIdx < next.length - 1 ? next[tabIdx + 1].groupId : undefined;

      // Dropped in the interior of a group (both neighbors share it) → join that group.
      // Makes "drop into the middle/top of a group" work and prevents a groupless tab
      // from splitting a group's contiguous block.
      if (prevG && prevG === nextG && tab.groupId !== prevG) {
        return next.map(t => t.id === tabId ? { ...t, groupId: prevG } : t);
      }
      // In a group but no longer adjacent to it → leave the group (drag-out).
      if (tab.groupId && prevG !== tab.groupId && nextG !== tab.groupId) {
        return next.map(t => t.id === tabId ? { ...t, groupId: undefined } : t);
      }

      return next;
    });
  }, []);

  const moveGroup = useCallback((groupId: string, afterTabId: string | null) => {
    setTabs(prev => {
      const groupTabs = prev.filter(t => t.groupId === groupId);
      const rest = prev.filter(t => t.groupId !== groupId);
      if (groupTabs.length === 0) return prev;
      if (afterTabId === null) return [...groupTabs, ...rest];
      const idx = rest.findIndex(t => t.id === afterTabId);
      if (idx === -1) return [...rest, ...groupTabs];
      const next = [...rest];
      next.splice(idx + 1, 0, ...groupTabs);
      return next;
    });
  }, []);

  const moveGroupAfterGroup = useCallback((groupId: string, afterGroupId: string) => {
    setTabs(prev => {
      const groupTabs = prev.filter(t => t.groupId === groupId);
      const rest = prev.filter(t => t.groupId !== groupId);
      if (groupTabs.length === 0) return prev;
      const lastIdx = rest.map(t => t.groupId).lastIndexOf(afterGroupId);
      if (lastIdx === -1) return prev;
      const next = [...rest];
      next.splice(lastIdx + 1, 0, ...groupTabs);
      return next;
    });
  }, []);

  const restoreSession = useCallback((saved: { tabs: Tab[]; groups: Group[]; activeTabId: string }) => {
    // Reset counters to avoid ID collisions
    const maxTabNum = saved.tabs.reduce((max, t) => {
      const num = parseInt(t.id.replace('tab-', ''), 10);
      return isNaN(num) ? max : Math.max(max, num);
    }, 0);
    const maxGroupNum = saved.groups.reduce((max, g) => {
      const num = parseInt(g.id.replace('group-', ''), 10);
      return isNaN(num) ? max : Math.max(max, num);
    }, 0);
    tabCounter = maxTabNum;
    groupCounter = maxGroupNum;

    setTabs(saved.tabs);
    setGroups(saved.groups);
    setActiveTabId(saved.activeTabId || saved.tabs[0]?.id || '');
  }, []);

  return {
    tabs, groups, activeTabId,
    setActiveTabId,
    addTab, closeTab, renameTab, updateTabCwd, setTabNotification,
    createGroup, addToGroup, removeFromGroup,
    renameGroup, setGroupColor, setGroupCwd, toggleGroupCollapse, deleteGroup,
    moveTab, moveGroup, moveGroupAfterGroup,
    restoreSession,
  };
}

import { useState, useCallback } from 'react';
import { Tab, Group, GroupColor, nextGroupColor, TabNotification } from '../components/TabBar/types';

// Everything the group modal can set. A group with no tabs is a valid, persisted
// state (it sits in the sidebar's Projects shelf), so creation no longer needs a tab.
export interface GroupConfig {
  label: string;
  color: GroupColor;
  cwd?: string;
  shellId?: string;
}

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
    // A terminal opened inside a group starts in the project folder and, unless the
    // shell picker overrode it, uses the group's default shell.
    const group = groupId ? groups.find(g => g.id === groupId) : undefined;
    const newTab: Tab = { id, title: 'Terminal', groupId, shellId: shellId ?? group?.shellId, cwd: group?.cwd };
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

  // Record the tab's live Claude session (UUID + cwd) reported by the notify hook.
  // Last write wins — every turn refreshes it, so a forked/cleared session updates
  // to the newest id. Only writes when something actually changed (avoids churn /
  // needless session.json saves on every hook event).
  const setClaudeSession = useCallback((tabId: string, sessionId: string, cwd: string) => {
    setTabs(prev => prev.map(t =>
      t.id === tabId && (t.claudeSessionId !== sessionId || t.claudeCwd !== cwd)
        ? { ...t, claudeSessionId: sessionId, claudeCwd: cwd }
        : t));
  }, []);

  const setTabFontSize = useCallback((tabId: string, fontSize: number) => {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, fontSize } : t));
  }, []);

  // Drop the "restorable" marker once a tab is activated/resumed — the muted ✳ goes
  // away and the tab looks normal again.
  const clearTabRestorable = useCallback((tabId: string) => {
    setTabs(prev => prev.map(t => t.id === tabId && t.claudeRestorable ? { ...t, claudeRestorable: false } : t));
  }, []);

  // Group fully configured up front (name, folder, colour, shell). This is the modal's
  // path — no tab is required, an empty group lives in the Projects shelf until one
  // opens. Spawns the first terminal here rather than via addTab because the group
  // isn't in `groups` yet this render, so addTab couldn't read its cwd/shell.
  const createConfiguredGroup = useCallback((config: GroupConfig, openTerminal: boolean): string => {
    const id = makeGroupId();
    setGroups(prev => [...prev, { id, collapsed: false, ...config }]);
    if (openTerminal) {
      const tabId = makeTabId();
      setTabs(prev => [...prev, {
        id: tabId, title: 'Terminal', groupId: id, shellId: config.shellId, cwd: config.cwd,
      }]);
      setActiveTabId(tabId);
    }
    return id;
  }, []);

  const createGroup = useCallback((tabId1: string, tabId2?: string): string => {
    const id = makeGroupId();
    const color = nextGroupColor(groups);
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

  // Whole-group edit from the modal (name, folder, colour, shell in one commit).
  const updateGroup = useCallback((groupId: string, config: GroupConfig) => {
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, ...config } : g));
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
      const anchor = prev.find(t => t.id === anchorTabId);
      if (!tab || !anchor || tabId === anchorTabId) return prev;
      const without = prev.filter(t => t.id !== tabId);
      const anchorIdx = without.findIndex(t => t.id === anchorTabId);
      if (anchorIdx === -1) return prev;
      const insertIdx = position === 'before' ? anchorIdx : anchorIdx + 1;
      // The tab inherits the group of whatever it was dropped next to: drop among a
      // group's tabs → join that group at that spot; drop next to an ungrouped tab →
      // leave the group. Inserting adjacent to the anchor keeps every group contiguous.
      const moved = { ...tab, groupId: anchor.groupId };
      const next = [...without];
      next.splice(insertIdx, 0, moved);
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

    // Mark every saved Claude session as "restorable" so the sidebar shows the muted
    // ✳ — except the active tab, which auto-resumes on launch (so it's never dormant).
    const activeId = saved.activeTabId || saved.tabs[0]?.id || '';
    setTabs(saved.tabs.map(t => ({
      ...t,
      claudeRestorable: !!t.claudeSessionId && t.id !== activeId,
    })));
    setGroups(saved.groups);
    setActiveTabId(activeId);
  }, []);

  return {
    tabs, groups, activeTabId,
    setActiveTabId,
    addTab, closeTab, renameTab, updateTabCwd, setClaudeSession, clearTabRestorable, setTabNotification, setTabFontSize,
    createGroup, createConfiguredGroup, addToGroup, removeFromGroup,
    renameGroup, setGroupColor, updateGroup, toggleGroupCollapse, deleteGroup,
    moveTab, moveGroup, moveGroupAfterGroup,
    restoreSession,
  };
}

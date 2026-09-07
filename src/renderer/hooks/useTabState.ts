import { useState, useCallback, useRef } from 'react';
import { Tab, Group, GroupColor, nextGroupColor, TabNotification } from '../components/TabBar/types';
import type { SavedSession } from '../sessionMigration';
import { nextActiveTabAfterArchive, threadName } from '../threadView';
import { claudeSummaryTitle } from '../chatTitle';
// Named apart from the hook's own sleepTab/wakeTab callbacks below: these are the
// pure record transforms, the callbacks are the state actions that apply them.
import { sleepTab as sleepTabRecord, wakeTab as wakeTabRecord, restoredTab } from '../sleepWake';
import { historyEntryFor, appendHistory, removeHistoryEntry, tabFromHistory, maxNumericId } from '../history';

// Everything the group modal can set. A group with no tabs is a valid, persisted
// state (it sits in the sidebar's Projects shelf), so creation no longer needs a tab.
export interface GroupConfig {
  label: string;
  color: GroupColor;
  cwd?: string;
  shellId?: string;
}

// Which folder a thread's branch and worktree are read from. The hook-captured
// claudeCwd wins over the shell's own cwd: Claude usually runs where the work is,
// which for this project is often a git worktree, while the shell that launched it
// still sits in the main checkout. Reading the shell's cwd there would show the
// main branch for a thread that is working on a phase branch.
export function threadGitCwd(tab: Pick<Tab, 'cwd' | 'claudeCwd'>): string | undefined {
  return tab.claudeCwd ?? tab.cwd;
}

let tabCounter = 0;
let groupCounter = 0;

function makeTabId() { return `tab-${++tabCounter}`; }
function makeGroupId() { return `group-${++groupCounter}`; }

export function useTabState() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('');

  // Mirror of `tabs` for callbacks that must stay closure-safe: app.tsx registers
  // some handlers once (shortcuts, toast clicks) and they keep the first render's
  // callback, so a callback that read `tabs` directly would see an empty list.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  // Same reason as tabsRef: archiving and activity stamping read the current groups
  // from handlers that were registered once.
  const groupsRef = useRef(groups);
  groupsRef.current = groups;

  const addTab = useCallback((groupId?: string, shellId?: string) => {
    const id = makeTabId();
    // A terminal opened inside a group starts in the project folder and, unless the
    // shell picker overrode it, uses the group's default shell.
    const group = groupId ? groups.find(g => g.id === groupId) : undefined;
    const now = Date.now();
    const newTab: Tab = {
      id, title: 'Terminal', groupId, shellId: shellId ?? group?.shellId, cwd: group?.cwd,
      lastActiveAt: now, asleep: false,
    };
    // Opening a terminal in a project is the user acting on that project, so it
    // counts as activity for the group as much as switching to one of its tabs does.
    if (group) setGroups(prev => prev.map(g => g.id === group.id ? { ...g, lastActiveAt: now } : g));
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

  // Closing a thread that belongs to a project files it in that project's history
  // rather than dropping it: the record (title, kind, session id, cwd) is what makes
  // Resume possible, and its scrollback tail file is kept under the same id. A
  // thread in General has no project to file it under, so closing it really does end
  // it (design-02, "Open decisions"). Returns whether the thread went to history, so
  // the caller knows whether the thread's tail file is still wanted.
  const closeTab = useCallback((tabId: string): boolean => {
    const tab = tabsRef.current.find(t => t.id === tabId);
    const group = tab?.groupId ? groupsRef.current.find(g => g.id === tab.groupId) : undefined;
    if (tab && group) {
      const entry = historyEntryFor(tab, threadName(tab), Date.now());
      setGroups(prev => prev.map(g =>
        g.id === group.id ? { ...g, history: appendHistory(g.history, entry) } : g));
    }
    setTabs(prev => {
      const idx = prev.findIndex(t => t.id === tabId);
      const next = prev.filter(t => t.id !== tabId);
      if (activeTabId === tabId && next.length > 0) {
        const newActive = next[Math.min(idx, next.length - 1)];
        setActiveTabId(newActive.id);
      }
      return next;
    });
    return !!(tab && group);
  }, [activeTabId]);

  // Sleep is only a record change here: the terminal layer watches `asleep` and is
  // what actually captures the tail and kills the PTY tree. Keeping the two apart
  // means every sleep path (menu, pane, shutdown) agrees on what the record becomes.
  const sleepTab = useCallback((tabId: string) => {
    const now = Date.now();
    setTabs(prev => prev.map(t => t.id === tabId ? sleepTabRecord(t, now) : t));
  }, []);

  // Waking is the user acting on the project, so the project's lastActiveAt moves
  // too, exactly as activateTab does it. Without that, waking a thread from a
  // background row would leave its project sorted as untouched on Home.
  const wakeTab = useCallback((tabId: string) => {
    const now = Date.now();
    setTabs(prev => prev.map(t => t.id === tabId ? wakeTabRecord(t, now) : t));
    const groupId = tabsRef.current.find(t => t.id === tabId)?.groupId;
    if (groupId) {
      setGroups(prev => prev.map(g => g.id === groupId ? { ...g, lastActiveAt: now } : g));
    }
  }, []);

  // Resume a closed thread from a project's history. The recreated tab keeps the
  // closed thread's id (history.ts, tabFromHistory) so its saved tail file is found
  // again, and comes back awake with wokeAt set, so the terminal layer replays that
  // tail above a "Woke just now" divider the moment it mounts. Returns the new tab's
  // id, or null when the project or the entry has gone.
  const resumeFromHistory = useCallback((groupId: string, entryId: string): string | null => {
    const group = groupsRef.current.find(g => g.id === groupId);
    const entry = group?.history.find(e => e.id === entryId);
    if (!group || !entry) return null;
    const now = Date.now();
    const tab = tabFromHistory(entry, group, now);
    // Same splice as addTab: the thread lands at the end of its project's contiguous
    // block, which is what keeps every group contiguous in the tab list.
    setTabs(prev => {
      const lastIdx = prev.map(t => t.groupId).lastIndexOf(groupId);
      if (lastIdx === -1) return [...prev, tab];
      const next = [...prev];
      next.splice(lastIdx + 1, 0, tab);
      return next;
    });
    setGroups(prev => prev.map(g => g.id === groupId
      ? { ...g, history: removeHistoryEntry(g.history, entryId), lastActiveAt: now }
      : g));
    // setActiveTabId, not activateTab: the tab is not in `tabs` yet this render, so
    // activateTab's own stamping would find nothing. tabFromHistory already set
    // lastActiveAt on the tab, and the group's stamp is in the setGroups above.
    setActiveTabId(tab.id);
    return tab.id;
  }, []);

  // The raw title stays on the tab (detectNotification and the spinner logic read
  // it), but when Claude Code wrote it, its summary is also captured as the thread's
  // name. Without that, the notify hook's next state title ("▶ afterterm - working")
  // would overwrite the only copy of the conversation's name.
  const renameTab = useCallback((tabId: string, title: string) => {
    const claudeTitle = claudeSummaryTitle(title);
    setTabs(prev => prev.map(t =>
      t.id === tabId
        ? (claudeTitle ? { ...t, title, claudeTitle } : { ...t, title })
        : t));
  }, []);

  // What main read out of the session transcript. Both fields are "only when we
  // learned something": a null firstPrompt must not erase a prompt already captured,
  // and a null model (an unreadable or rotated-away transcript) keeps the last model
  // known for the thread rather than blanking the header line.
  const setClaudeMeta = useCallback((tabId: string, meta: { firstPrompt: string | null; model: string | null }) => {
    setTabs(prev => {
      let changed = false;
      const next = prev.map(t => {
        if (t.id !== tabId) return t;
        const firstPrompt = meta.firstPrompt ?? t.firstPrompt;
        const model = meta.model ?? t.model;
        if (firstPrompt === t.firstPrompt && model === t.model) return t;
        changed = true;
        return { ...t, firstPrompt, model };
      });
      return changed ? next : prev;
    });
  }, []);

  // Branch and worktree for the thread's folder, refreshed by app.tsx. A null value
  // deletes the key (a folder that left git, or a worktree that is now a plain
  // checkout, should stop showing a stale branch), and an unchanged pair writes
  // nothing, which is what makes the 30 second poll free.
  const setGitInfo = useCallback((tabId: string, info: { branch: string | null; worktree: string | null }) => {
    setTabs(prev => {
      let changed = false;
      const next = prev.map(t => {
        if (t.id !== tabId) return t;
        const branch = info.branch ?? undefined;
        const worktree = info.worktree ?? undefined;
        if (branch === t.branch && worktree === t.worktree) return t;
        changed = true;
        const updated = { ...t, branch, worktree };
        if (branch === undefined) delete updated.branch;
        if (worktree === undefined) delete updated.worktree;
        return updated;
      });
      return changed ? next : prev;
    });
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

  // Group fully configured up front (name, folder, colour, shell). This is the modal's
  // path — no tab is required, an empty group lives in the Projects shelf until one
  // opens. Spawns the first terminal here rather than via addTab because the group
  // isn't in `groups` yet this render, so addTab couldn't read its cwd/shell.
  const createConfiguredGroup = useCallback((config: GroupConfig, openTerminal: boolean): string => {
    const id = makeGroupId();
    const now = Date.now();
    setGroups(prev => [...prev, {
      id, collapsed: false, pinned: false, archived: false, lastActiveAt: now, history: [], ...config,
    }]);
    if (openTerminal) {
      const tabId = makeTabId();
      setTabs(prev => [...prev, {
        id: tabId, title: 'Terminal', groupId: id, shellId: config.shellId, cwd: config.cwd,
        lastActiveAt: now, asleep: false,
      }]);
      setActiveTabId(tabId);
    }
    return id;
  }, []);

  const createGroup = useCallback((tabId1: string, tabId2?: string): string => {
    const id = makeGroupId();
    const color = nextGroupColor(groups);
    const newGroup: Group = {
      id, label: 'New Group', color, collapsed: false,
      pinned: false, archived: false, lastActiveAt: Date.now(), history: [],
    };
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
      // A group with no tabs yet has no block to extend, so the tab goes to the end
      // of the list: that is where the sidebar walk already draws an empty group, so
      // the group stays put instead of jumping to the top.
      if (lastGroupIdx === -1) return [...withoutTab, tab];
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

  // User-driven activation: focus the tab and record the moment on it and on its
  // group. Only the user's own switching counts here; PTY input and output stamping
  // is Phase 2, so an unattended background process cannot look "recently used".
  const activateTab = useCallback((tabId: string) => {
    const now = Date.now();
    setActiveTabId(tabId);
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, lastActiveAt: now } : t));
    const groupId = tabsRef.current.find(t => t.id === tabId)?.groupId;
    if (groupId) {
      setGroups(prev => prev.map(g => g.id === groupId ? { ...g, lastActiveAt: now } : g));
    }
  }, []);

  // Pin and unpin a project. Pinning is explicit and only explicit: nothing else in
  // the app sets this flag, so a project reaches the Pinned section only because the
  // user put it there.
  const togglePin = useCallback((groupId: string) => {
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, pinned: !g.pinned } : g));
  }, []);

  // Archive takes a project off the board: it leaves the sidebar (sidebarSections
  // drops archived groups) and moves to Home's Archived list. Its threads keep
  // running, they are just no longer reachable from the sidebar, so an active thread
  // inside the project hands over to the first thread outside every archived one.
  // Archiving also clears `pinned`; restoring leaves the project unpinned, because
  // pinning is a deliberate act and has to be repeated deliberately.
  const setGroupArchived = useCallback((groupId: string, archived: boolean) => {
    setGroups(prev => prev.map(g =>
      g.id === groupId ? { ...g, archived, pinned: archived ? false : g.pinned } : g));
    if (!archived) return;
    const archivedIds = groupsRef.current
      .filter(g => g.archived || g.id === groupId)
      .map(g => g.id);
    setActiveTabId(cur => nextActiveTabAfterArchive(tabsRef.current, cur, archivedIds));
  }, []);

  // PTY activity (input or output, throttled in main to one stamp per tab per 15s)
  // counts as the thread being used, so Home's "5m" and the project ordering track
  // work that happens without a tab switch. Never moves a timestamp backwards, and
  // writes nothing when neither value would change, so a busy terminal does not
  // trigger a render (and a session save) every 15 seconds for no reason.
  const touchActivity = useCallback((tabId: string, at: number) => {
    const tab = tabsRef.current.find(t => t.id === tabId);
    if (!tab) return;
    if (tab.lastActiveAt < at) {
      setTabs(prev => prev.map(t => t.id === tabId && t.lastActiveAt < at ? { ...t, lastActiveAt: at } : t));
    }
    const groupId = tab.groupId;
    if (!groupId) return;
    const group = groupsRef.current.find(g => g.id === groupId);
    if (group && group.lastActiveAt < at) {
      setGroups(prev => prev.map(g => g.id === groupId && g.lastActiveAt < at ? { ...g, lastActiveAt: at } : g));
    }
  }, []);

  // Open a project in the workspace: expand it in the sidebar and focus its first
  // thread in tab order. Returns false when the project has no threads at all, which
  // is the caller's cue to open one (a project with nothing running should still be
  // one click from a terminal).
  const openProject = useCallback((groupId: string): boolean => {
    setGroups(prev => prev.map(g => g.id === groupId && g.collapsed ? { ...g, collapsed: false } : g));
    const first = tabsRef.current.find(t => t.groupId === groupId);
    if (!first) return false;
    activateTab(first.id);
    return true;
  }, [activateTab]);

  // `saved` has already been through migrateSession, so every field is present and
  // well typed; nothing here needs to guess at defaults.
  const restoreSession = useCallback((saved: SavedSession) => {
    // Reset counters to avoid ID collisions. History ids count as taken ids, not
    // just live tab ids: a closed thread keeps its id in its project's history and
    // its scrollback tail still sits at threads/<id>.txt, so handing that id to a
    // brand new tab would replay a stranger's output into it and let Resume find the
    // wrong thread.
    const now = Date.now();
    tabCounter = maxNumericId('tab-', [
      ...saved.tabs.map(t => t.id),
      ...saved.groups.flatMap(g => (g.history ?? []).map(e => e.id)),
    ]);
    groupCounter = maxNumericId('group-', saved.groups.map(g => g.id));

    const activeId = saved.activeTabId || saved.tabs[0]?.id || '';
    // Every restored thread starts asleep (sleepWake.ts, restoredTab): nothing is
    // spawned until the user wakes something, which is what keeps a relaunch from
    // cold-starting N shells (and N `claude --resume` processes) at once.
    // A saved claudeTitle names the thread from the first paint. A file written
    // before that field existed may still carry Claude's own summary as the raw
    // title (Claude's own glyph in front of it), so that is the fallback, read
    // before the restored shell replaces the title with something like "cmd.exe".
    setTabs(saved.tabs.map(t => {
      const claudeTitle = t.claudeTitle || claudeSummaryTitle(t.title);
      const tab = restoredTab(t, now);
      return claudeTitle ? { ...tab, claudeTitle } : tab;
    }));
    setGroups(saved.groups);
    setActiveTabId(activeId);
  }, []);

  return {
    tabs, groups, activeTabId,
    setActiveTabId, activateTab,
    addTab, closeTab, renameTab, updateTabCwd, setClaudeSession, setTabNotification, setTabFontSize,
    sleepTab, wakeTab, resumeFromHistory,
    setClaudeMeta, setGitInfo,
    createGroup, createConfiguredGroup, addToGroup, removeFromGroup,
    renameGroup, setGroupColor, updateGroup, toggleGroupCollapse, deleteGroup,
    togglePin, setGroupArchived, touchActivity, openProject,
    moveTab, moveGroup, moveGroupAfterGroup,
    restoreSession,
  };
}

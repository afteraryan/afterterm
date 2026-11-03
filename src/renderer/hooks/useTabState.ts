import { useState, useCallback, useRef, useLayoutEffect } from 'react';
import { Tab, Group, GroupColor, nextGroupColor, TabNotification, ProjectIconId } from '../components/TabBar/types';
import type { SavedSession } from '../sessionMigration';
import { insertNewThread, nextActiveTabAfterArchive, threadFolder, threadName } from '../threadView';
import { claudeSummaryTitle } from '../chatTitle';
// Named apart from the hook's own sleepTab/wakeTab callbacks below: these are the
// pure record transforms, the callbacks are the state actions that apply them.
import { sleepTab as sleepTabRecord, wakeTab as wakeTabRecord, restoredTab } from '../sleepWake';
import { historyEntryFor, appendHistory, removeHistoryEntry, tabFromHistory, maxNumericId } from '../history';
import { lastWorkedThread, enteringRecent, moveGroupsToTop } from '../attention';
import { placeProject as placeProjectRecord } from '../panelView';
import type { ProjectSection } from '../panelView';
import {
  createSplit, dissolveSplitOf, setSplitRatio as setSplitRatioRecord, activeAfterClose,
  placeThreadKeepingSplits, maxSplitNumber,
} from '../splitView';
import type { Split, SplitSide } from '../splitView';

// Everything the group modal can set. A group with no tabs is a valid, persisted
// state (it sits in the sidebar's Projects shelf), so creation no longer needs a tab.
export interface GroupConfig {
  label: string;
  color: GroupColor;
  cwd?: string;
  shellId?: string;
  // The project's chosen icon (Phase 8, design-03 decision 12). Undefined
  // means "no icon chosen", not "clear the icon and use the folder": both
  // createConfiguredGroup and updateGroup only ever store a real key here,
  // never an explicit `icon: undefined`, since a Group's icon field is
  // optional and its absence is what the rest of the app treats as "show the
  // folder".
  icon?: ProjectIconId;
}

// Which folder a thread's branch and worktree are read from: the thread's own
// working folder (threadFolder in threadView.ts, the same rule "Open in File
// Explorer" on a thread uses). The hook-captured claudeCwd wins over the shell's
// own cwd: Claude usually runs where the work is, which for this project is
// often a git worktree, while the shell that launched it still sits in the main
// checkout. Reading the shell's cwd there would show the main branch for a
// thread that is working on a phase branch.
export function threadGitCwd(tab: Pick<Tab, 'cwd' | 'claudeCwd'>): string | undefined {
  return threadFolder(tab);
}

let tabCounter = 0;
let groupCounter = 0;
let splitCounter = 0;

function makeTabId() { return `tab-${++tabCounter}`; }
function makeGroupId() { return `group-${++groupCounter}`; }

// A project being used: its activity stamped (never backwards) and, if it was
// archived, back out of Other projects (2026-11-01: using an archived project
// brings it back). Whether it then goes to the top of Recent is decided by the
// order effect in useTabState, not here.
function projectInUse(groups: Group[], groupId: string, now: number): Group[] {
  return groups.map(g => g.id === groupId
    ? { ...g, lastActiveAt: Math.max(g.lastActiveAt, now), archived: false }
    : g);
}

export function useTabState() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('');
  // Two threads side by side (splitView.ts, design-06). The focused half is
  // still just activeTabId; a split is on screen when the active thread is in it.
  const [splits, setSplits] = useState<Split[]>([]);
  const splitsRef = useRef(splits);
  splitsRef.current = splits;
  const activeRef = useRef(activeTabId);
  activeRef.current = activeTabId;

  // Mirror of `tabs` for callbacks that must stay closure-safe: app.tsx registers
  // some handlers once (shortcuts, toast clicks) and they keep the first render's
  // callback, so a callback that read `tabs` directly would see an empty list.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  // Same reason as tabsRef: archiving and activity stamping read the current groups
  // from handlers that were registered once.
  const groupsRef = useRef(groups);
  groupsRef.current = groups;

  // The panel's order rule (Aryan, 2026-11-01): a project that comes into
  // Recent goes to the top of it, and then stays where it is. Every state change
  // is compared with the one before it at the same clock reading (enteringRecent
  // in attention.ts); whatever entered moves to the front of the saved order.
  // Layout effect, so the panel never paints the project in its old place
  // first. A restored session sets a new baseline instead of counting every
  // project as just arrived.
  const orderBaseRef = useRef<{ groups: Group[]; tabs: Tab[] } | null>(null);
  const resetOrderBaseRef = useRef(false);
  useLayoutEffect(() => {
    const before = orderBaseRef.current;
    orderBaseRef.current = { groups, tabs };
    if (!before || resetOrderBaseRef.current) { resetOrderBaseRef.current = false; return; }
    const entering = enteringRecent(before, { groups, tabs }, Date.now());
    if (entering.length) setGroups(prev => moveGroupsToTop(prev, entering));
  }, [groups, tabs]);

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
    if (group) setGroups(prev => projectInUse(prev, group.id, now));
    // First in its project, so the newest threads are the ones the fold shows.
    setTabs(prev => insertNewThread(prev, newTab));
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
    // Closing either half of a split ends the split; closing the focused half
    // leaves the other on screen alone (design-06, rule 3).
    const nextActive = activeAfterClose(tabsRef.current, splitsRef.current, activeRef.current, tabId);
    setTabs(prev => prev.filter(t => t.id !== tabId));
    setActiveTabId(nextActive);
    setSplits(prev => dissolveSplitOf(prev, tabId));
    return !!(tab && group);
  }, []);

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
    // Waking a thread of an archived project brings the project back (2026-11-01).
    const groupId = tabsRef.current.find(t => t.id === tabId)?.groupId;
    if (groupId) setGroups(prev => projectInUse(prev, groupId, now));
  }, []);

  // Resume a closed thread from a project's history. The recreated tab keeps the
  // closed thread's id (history.ts, tabFromHistory) so its saved tail file is found
  // again, and comes back awake with wokeAt set, exactly like a freshly woken
  // thread. Returns the new tab's id, or null when the project or the entry has
  // gone.
  const resumeFromHistory = useCallback((groupId: string, entryId: string): string | null => {
    const group = groupsRef.current.find(g => g.id === groupId);
    const entry = group?.history.find(e => e.id === entryId);
    if (!group || !entry) return null;
    const now = Date.now();
    const tab = tabFromHistory(entry, group, now);
    // Same place as a new thread (insertNewThread): first in its project, since a
    // resumed thread is the one about to be worked in.
    setTabs(prev => insertNewThread(prev, tab));
    setGroups(prev => projectInUse(prev, groupId, now).map(g => g.id === groupId
      ? { ...g, history: removeHistoryEntry(g.history, entryId) }
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

  // The listening port main found in the thread's process tree, pushed on every
  // watcher pass. null means the listener has gone, which deletes the key rather
  // than storing undefined, so a thread that never served anything and one that
  // stopped serving look the same in session.json. An unchanged port writes
  // nothing: the watcher polls, and a render (plus a session save) per poll would
  // be a steady cost for no new information.
  const setPort = useCallback((tabId: string, port: number | null) => {
    setTabs(prev => {
      let changed = false;
      const next = prev.map(t => {
        if (t.id !== tabId) return t;
        const value = port ?? undefined;
        if (value === t.port) return t;
        changed = true;
        const updated = { ...t, port: value };
        if (value === undefined) delete updated.port;
        return updated;
      });
      return changed ? next : prev;
    });
  }, []);

  // The last command line entered at this thread's prompt (captured from the OSC
  // 133 marks in the terminal layer). Same no-op-when-unchanged rule as setPort:
  // re-running the same command should not churn state.
  const setLastCommand = useCallback((tabId: string, command: string) => {
    setTabs(prev => {
      let changed = false;
      const next = prev.map(t => {
        if (t.id !== tabId || t.lastCommand === command) return t;
        changed = true;
        return { ...t, lastCommand: command };
      });
      return changed ? next : prev;
    });
  }, []);

  // Mark as unread / Mark as read (threadMenu.tsx, chats only). Same no-op-when-
  // unchanged rule as setPort; false deletes the key rather than storing it, so
  // a never-marked thread and one explicitly marked read serialize identically
  // (sessionMigration.ts keeps only a literal true).
  const setUnread = useCallback((tabId: string, unread: boolean) => {
    setTabs(prev => {
      let changed = false;
      const next = prev.map(t => {
        if (t.id !== tabId) return t;
        const current = !!t.unread;
        if (current === unread) return t;
        changed = true;
        if (!unread) {
          const updated = { ...t };
          delete updated.unread;
          return updated;
        }
        return { ...t, unread: true };
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
    const group: Group = {
      id, collapsed: false, pinned: false, archived: false, lastActiveAt: now, history: [], ...config,
    };
    // Only ever set the key when an icon was actually chosen: `...config`
    // above would otherwise leave `icon: undefined` sitting on the group when
    // the caller's config object carries the key unset, rather than the key
    // being genuinely absent (sessionMigration.ts and everything downstream
    // treat "absent" as "show the folder", not "set to undefined").
    if (config.icon === undefined) delete group.icon;
    setGroups(prev => [...prev, group]);
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

  // Moving a thread to another project ends its split (design-06, rule 6).
  const addToGroup = useCallback((tabId: string, groupId: string) => {
    if (tabsRef.current.find(t => t.id === tabId)?.groupId !== groupId) setSplits(prev => dissolveSplitOf(prev, tabId));
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
    if (tabsRef.current.find(t => t.id === tabId)?.groupId) setSplits(prev => dissolveSplitOf(prev, tabId));
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, groupId: undefined } : t));
  }, []);

  const renameGroup = useCallback((groupId: string, label: string) => {
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, label } : g));
  }, []);

  const setGroupColor = useCallback((groupId: string, color: GroupColor) => {
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, color } : g));
  }, []);

  // Whole-group edit from the modal (name, folder, colour, shell, icon in one
  // commit). config.icon undefined means "no icon chosen in this edit", which
  // must delete any icon the group already carried, not leave it untouched as
  // a stale value nor store it as an explicit `undefined`: `{ ...g, ...config
  // }` alone would do neither correctly (a spread cannot remove a key), so
  // the key is deleted by hand when the config did not set one.
  const updateGroup = useCallback((groupId: string, config: GroupConfig) => {
    setGroups(prev => prev.map(g => {
      if (g.id !== groupId) return g;
      const next: Group = { ...g, ...config };
      if (config.icon === undefined) delete next.icon;
      return next;
    }));
  }, []);

  const toggleGroupCollapse = useCallback((groupId: string) => {
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, collapsed: !g.collapsed } : g));
  }, []);

  // Phase 8: the Pinned/Recent heading's collapse-all-or-expand-all button,
  // one setGroups call for every project in that section rather than one call
  // per project (which would otherwise re-render on every intermediate step).
  const setGroupCollapsedMany = useCallback((groupIds: string[], collapsed: boolean) => {
    const ids = new Set(groupIds);
    setGroups(prev => prev.map(g => ids.has(g.id) ? { ...g, collapsed } : g));
  }, []);

  const deleteGroup = useCallback((groupId: string) => {
    setGroups(prev => prev.filter(g => g.id !== groupId));
    setTabs(prev => prev.map(t => t.groupId === groupId ? { ...t, groupId: undefined } : t));
  }, []);

  // A drop in the panel (docs/mockups/sidebar-drag-and-drop.html). A thread goes
  // into `groupId` (undefined is General) just above `beforeId`, or at the end of
  // that list; a project goes into Pinned or Recent just above `beforeId`, or at
  // the end of that section, pinned or unpinned to match (placeThread in
  // threadView.ts, placeProject in panelView.ts). Nothing else moves.
  // placeProject returns whether the project's pinned flag changed, so the
  // caller can say so ("Pinned afterterm").
  // A split's two threads stay next to each other: a split thread dropped in
  // its own project takes its partner along, one dropped in another project
  // leaves its split, and any other thread dropped between a pair lands below
  // it (splitView.ts, placeThreadKeepingSplits).
  const placeThreadAt = useCallback((tabId: string, groupId: string | undefined, beforeId: string | null) => {
    const next = placeThreadKeepingSplits(tabsRef.current, splitsRef.current, tabId, groupId, beforeId);
    if (next.tabs !== tabsRef.current) { tabsRef.current = next.tabs; setTabs(next.tabs); }
    if (next.splits !== splitsRef.current) { splitsRef.current = next.splits; setSplits(next.splits); }
  }, []);

  // A thread dropped on a half of the thread on screen (design-06): the two
  // become a split with the dragged one on that side, its row moves next to the
  // other's, and it gets the focus.
  const makeSplit = useCallback((stayId: string, dragId: string, side: SplitSide) => {
    const next = createSplit(tabsRef.current, splitsRef.current, stayId, dragId, side, `split-${++splitCounter}`);
    if (next.splits === splitsRef.current) return;
    tabsRef.current = next.tabs;
    splitsRef.current = next.splits;
    setTabs(next.tabs);
    setSplits(next.splits);
    activateTabRef.current(dragId);
  }, []);

  // Ungroup (the sidebar row's menu): both threads keep running, the focused
  // one stays on screen alone.
  const ungroup = useCallback((tabId: string) => {
    setSplits(prev => dissolveSplitOf(prev, tabId));
  }, []);

  // The divider, committed once on release (or reset by a double-click).
  const setSplitRatio = useCallback((splitId: string, ratio: number) => {
    setSplits(prev => setSplitRatioRecord(prev, splitId, ratio));
  }, []);

  const placeProject = useCallback((groupId: string, section: ProjectSection, beforeId: string | null): boolean => {
    const was = groupsRef.current.find(g => g.id === groupId)?.pinned;
    const next = placeProjectRecord(groupsRef.current, tabsRef.current, Date.now(), groupId, section, beforeId);
    if (next === groupsRef.current) return false;
    groupsRef.current = next;
    setGroups(next);
    return next.find(g => g.id === groupId)?.pinned !== was;
  }, []);

  // User-driven activation: focus the tab and record the moment on it and on its
  // group. Only the user's own switching counts here; PTY input and output stamping
  // is Phase 2, so an unattended background process cannot look "recently used".
  // `keepProjectOrder` (Phase 8) skips the group stamp. The panel no longer orders
  // anything by that stamp (2026-11-01), but Home's Projects list still does, and
  // moving through threads with Ctrl+Shift+Down/Up is not using their projects.
  const activateTab = useCallback((tabId: string, keepProjectOrder = false) => {
    const now = Date.now();
    setActiveTabId(tabId);
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, lastActiveAt: now } : t));
    if (keepProjectOrder) return;
    const groupId = tabsRef.current.find(t => t.id === tabId)?.groupId;
    if (groupId) {
      setGroups(prev => prev.map(g => g.id === groupId ? { ...g, lastActiveAt: now } : g));
    }
  }, []);
  const activateTabRef = useRef(activateTab);
  activateTabRef.current = activateTab;

  // Pin and unpin a project. Pinning is explicit and only explicit: nothing else in
  // the app sets this flag, so a project reaches the Pinned section only because the
  // user put it there. From a button or a menu (a drag places it itself): pinned,
  // it goes at the end of Pinned; unpinned, at the top of Recent, where a
  // project coming into Recent always goes.
  const togglePin = useCallback((groupId: string) => {
    const g = groupsRef.current.find(x => x.id === groupId);
    if (!g) return;
    const next = g.pinned
      ? moveGroupsToTop(groupsRef.current.map(x => x.id === groupId ? { ...x, pinned: false } : x), [groupId])
      : placeProjectRecord(groupsRef.current, tabsRef.current, Date.now(), groupId, 'pinned', null);
    groupsRef.current = next;
    setGroups(next);
  }, []);

  // Archive moves a project into the panel's Other projects drawer, at its top
  // (2026-11-01; it used to hide the project everywhere except Home). Its awake
  // threads are put to sleep first by the caller (app.tsx), and an active thread
  // inside the project hands over to the first thread outside every archived one.
  // Archiving also clears `pinned` (Aryan, 2026-11-01). Restoring stamps its
  // activity, so it comes back at the top of Recent (the order effect above), and
  // leaves it unpinned: pinning is a deliberate act and is repeated deliberately.
  const setGroupArchived = useCallback((groupId: string, archived: boolean) => {
    const now = Date.now();
    setGroups(prev => archived
      ? moveGroupsToTop(prev.map(g => g.id === groupId ? { ...g, archived: true, pinned: false } : g), [groupId])
      : projectInUse(prev, groupId, now));
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

  // Open a project in the workspace: expand it in the sidebar and focus a thread.
  // Returns the activated tab id, or null when the project has no threads at all,
  // which is the caller's cue to open one (a project with nothing running should
  // still be one click from a terminal). The id is what the caller clears badges
  // and the toast for, so it must be the thread actually shown.
  // Opening a project lands on the thread last worked in (lastWorkedThread in
  // attention.ts; Aryan, 2026-09-19), not the first in tab order. It is only
  // shown, never woken, the same as clicking its row.
  const openProject = useCallback((groupId: string): string | null => {
    setGroups(prev => prev.map(g => g.id === groupId && g.collapsed ? { ...g, collapsed: false } : g));
    const last = lastWorkedThread(tabsRef.current.filter(t => t.groupId === groupId));
    if (!last) return null;
    activateTab(last.id);
    return last.id;
  }, [activateTab]);

  // Bringing a project in from the panel's docked "Other projects" row
  // (design-03 decision 2): this is a view filter over activity, not a pin,
  // so it only ever stamps lastActiveAt (never backwards, matching
  // touchActivity's own rule) so the Recent 3-day window picks the project up,
  // expands it, and activates the thread last worked in (lastWorkedThread, the
  // same rule opening a project from Home follows) through activateTab, the
  // ordinary user-activation stamp. Nothing here wakes an asleep thread:
  // bringing a project in is not the same as waking one of its threads.
  // Returns the activated tab id, or null when the project has no threads at
  // all (the caller decides what to do then, same as openProject's `false`).
  const bringProjectIn = useCallback((groupId: string, now: number): string | null => {
    setGroups(prev => projectInUse(prev, groupId, now).map(g => g.id === groupId ? { ...g, collapsed: false } : g));
    const last = lastWorkedThread(tabsRef.current.filter(t => t.groupId === groupId));
    if (!last) return null;
    activateTab(last.id);
    return last.id;
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
    setSplits(saved.splits ?? []);
    splitCounter = maxSplitNumber(saved.splits ?? []);
    setActiveTabId(activeId);
    resetOrderBaseRef.current = true;
  }, []);

  return {
    tabs, groups, activeTabId, splits,
    setActiveTabId, activateTab, makeSplit, ungroup, setSplitRatio,
    addTab, closeTab, renameTab, updateTabCwd, setClaudeSession, setTabNotification, setTabFontSize,
    sleepTab, wakeTab, resumeFromHistory,
    setClaudeMeta, setGitInfo, setPort, setLastCommand, setUnread,
    createConfiguredGroup, addToGroup, removeFromGroup,
    renameGroup, setGroupColor, updateGroup, toggleGroupCollapse, setGroupCollapsedMany, deleteGroup,
    togglePin, setGroupArchived, touchActivity, openProject, bringProjectIn,
    placeThreadAt, placeProject,
    restoreSession,
  };
}

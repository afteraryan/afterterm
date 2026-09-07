import React, { useState, useCallback, useEffect, useRef } from 'react';
import { SidePanel } from './components/SidePanel';
import { TerminalArea } from './components/Terminal';
import type { TerminalAreaHandle } from './components/Terminal';
import { AsleepPane } from './components/AsleepPane';
import { Header } from './components/Header';
import { TitleBar } from './components/TitleBar';
import { Tooltip } from './components/Tooltip';
import { Home } from './components/Home';
import { ProjectPage } from './components/ProjectPage';
import { NewThreadChooser } from './components/NewThreadChooser';
import { SearchPalette } from './components/SearchPalette';
import { GroupModal, GroupDraft } from './components/GroupModal';
import { Toast } from './components/Toast';
import { ConfirmDialog } from './components/ConfirmDialog';
import type { Screen } from './components/ScreenNav';
import { useTabState, threadGitCwd } from './hooks/useTabState';
import { TabNotification, GROUP_COLORS, nextGroupColor } from './components/TabBar/types';
import { onTitle, onOutput, onTick, onInterrupt, initTiming, TabTiming } from './spinnerState';
import { migrateSession, serializeSession } from './sessionMigration';
import { sleepAllForShutdown } from './sleepWake';
import { toastMessage, initialScreen, threadName, needsCloseConfirm, closeConfirmText, localhostUrl } from './threadView';
import { ProjectActions } from './projectMenu';
import { buildThreadMenu } from './threadMenu';
import type { EditorInfo } from '../editors';

let toastCounter = 0;

// How long div.app keeps its entrance class (see index.css / theme.css); the
// longest of the entrance animations is 320ms.
const ENTER_MS = 400;
// Home and the project page show relative times ("5m"), so they need the clock
// to move while they are open.
const CLOCK_MS = 60_000;
// Where the new thread chooser opens when no New thread control is on screen to
// anchor it under.
const CHOOSER_FALLBACK = { x: 80, y: 120 };
// How often every thread's branch and worktree are re-read. Slow on purpose: a
// branch switch is rare and nothing here is urgent, so this only has to be faster
// than the user noticing a stale branch.
const GIT_POLL_MS = 30_000;

interface AppToast {
  // Distinguishes one toast from the next even when the wording repeats, so the
  // pill remounts and its auto-hide timer starts again.
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

let appToastCounter = 0;

export function App() {
  const state = useTabState();
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [shells, setShells] = useState<{ id: string; name: string }[]>([]);
  const [initialized, setInitialized] = useState(false);
  // Which screen is showing. The workspace stays mounted behind Home and the
  // project page (it is only hidden with CSS) so terminals keep running and the
  // active tab's lazy Claude resume still happens; Home and the project page
  // mount only while they show.
  const [screen, setScreen] = useState<Screen>('workspace');
  const [projectPageId, setProjectPageId] = useState<string | null>(null);
  // Bumped on every screen switch so the entrance animation replays even when
  // the same screen is chosen twice in a row.
  const [screenSeq, setScreenSeq] = useState(0);
  // Screen-entrance animation class for div.app (Phase 1.1, see index.css and
  // theme.css). Cleared ~400ms after being set so it never lingers, which is
  // what lets the next switch re-trigger it.
  const [enterClass, setEnterClass] = useState('');
  // Now, refreshed once a minute while Home or a project page is open, so the
  // relative times on those screens stay current without a per-second timer.
  const [now, setNow] = useState(() => Date.now());
  // Editors detected by main, fetched once and replaced whenever an open or a
  // picker reports a fresher list.
  const [editors, setEditors] = useState<EditorInfo[]>([]);
  // Which project folders exist, keyed by path. Refreshed on entering Home or a
  // project page, the only screens that show the "Folder not found" state.
  const [folderExists, setFolderExists] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<AppToast | null>(null);
  const [chooser, setChooser] = useState<{ x: number; y: number } | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // null = closed; groupId absent = creating a new project.
  const [projectModal, setProjectModal] = useState<{ mode: 'create' | 'edit'; groupId?: string } | null>(null);
  // The saved scrollback tail of every thread whose pane may need it, keyed by tab
  // id. Filled when a thread goes to sleep (the terminal hands its last lines over
  // on the way out) and, for a thread restored from disk, read from its tail file
  // the first time its pane shows.
  const [tails, setTails] = useState<Record<string, string[]>>({});
  // The running server whose close is waiting on a confirm, or null. Closing a
  // thread that owns a listening port stops that server, which is worth asking
  // about once; every other close still goes straight through.
  const [closeConfirm, setCloseConfirm] = useState<{ tabId: string; port: number } | null>(null);
  // Which tab a project page opens on. Everything that opens a project page shows
  // Live; only the palette's history results open it on History.
  const [projectPageTab, setProjectPageTab] = useState<'live' | 'asleep' | 'history'>('live');

  // The terminal layer, for the one thing only it knows: what is on each screen
  // right now. Read at quit, when every awake thread's tail has to reach disk.
  const terminalRef = useRef<TerminalAreaHandle>(null);

  const stateRef = useRef(state);
  stateRef.current = state;
  const panelRef = useRef(panelCollapsed);
  panelRef.current = panelCollapsed;
  const screenRef = useRef(screen);
  screenRef.current = screen;

  // Read by the clock effect and the tail-reading effect below, both of which run
  // before `activeTab` is derived further down.
  const activeTabAsleep = !!state.tabs.find(t => t.id === state.activeTabId)?.asleep;

  // Every screen switch goes through here so the entrance class always replays.
  const goScreen = useCallback((next: Screen, groupId?: string) => {
    if (next === 'project') {
      if (!groupId) return;
      setProjectPageId(groupId);
      // Every route into a project page lands on Live. The one exception sets
      // History straight after calling this (see the palette's onOpenHistory).
      setProjectPageTab('live');
    }
    setScreen(next);
    setScreenSeq(n => n + 1);
  }, []);

  // One toast at a time: a new one replaces whatever is showing, so the newest
  // thing the user did is the thing they read.
  const showToast = useCallback((next: Omit<AppToast, 'id'>) => {
    setToast({ id: ++appToastCounter, ...next });
  }, []);

  function chooseEditor() {
    window.afterterm.editors.choose().then(result => {
      // null is the user cancelling the picker, which needs no comment.
      if (!result) return;
      setEditors(result.editors);
      if (result.invalid) showEditorPathToast();
    });
  }

  function showEditorPathToast() {
    showToast({ message: 'Editor path not valid', actionLabel: 'Choose editor...', onAction: chooseEditor });
  }

  // Ctrl+Shift+T. The chooser opens under whichever New thread control is on
  // screen (the sidebar row when it is expanded, the rail button when collapsed),
  // so the popover reads as coming from the button the shortcut stands in for.
  // The switch to the workspace has to paint first for that control to be
  // measurable, hence the frame wait.
  function openChooserFromShortcut() {
    if (screenRef.current !== 'workspace') goScreen('workspace');
    requestAnimationFrame(() => {
      const controls = Array.from(document.querySelectorAll<HTMLElement>('[data-new-thread]'));
      const rect = controls
        .map(el => el.getBoundingClientRect())
        .find(r => r.width > 0 && r.height > 0);
      setChooser(rect ? { x: rect.left, y: rect.bottom + 6 } : CHOOSER_FALLBACK);
    });
  }

  // Every project action in the app, in one object: Home's cards and rows, the
  // project page's buttons, and every project right-click menu all run through it
  // (see projectMenu.tsx).
  const findGroup = (groupId: string) => stateRef.current.groups.find(g => g.id === groupId);

  const projectActions: ProjectActions = {
    open: (groupId) => {
      const group = findGroup(groupId);
      if (!group) return;
      // Opening an archived project is the user saying they want it back.
      if (group.archived) stateRef.current.setGroupArchived(groupId, false);
      const first = stateRef.current.tabs.find(t => t.groupId === groupId);
      // A project with nothing running is still one click from a terminal: if it
      // has no thread to focus, opening it opens one.
      if (stateRef.current.openProject(groupId)) {
        if (first) clearThreadBadges(first.id);
      } else {
        stateRef.current.addTab(groupId);
      }
      goScreen('workspace');
    },
    newThread: (groupId) => {
      stateRef.current.addTab(groupId);
      goScreen('workspace');
    },
    togglePin: (groupId) => {
      const group = findGroup(groupId);
      if (!group) return;
      stateRef.current.togglePin(groupId);
      showToast({ message: `${group.pinned ? 'Unpinned' : 'Pinned'} ${group.label}` });
    },
    openPage: (groupId) => goScreen('project', groupId),
    openInExplorer: (groupId) => {
      const folder = findGroup(groupId)?.cwd;
      if (!folder) return;
      window.afterterm.projects.openInExplorer(folder).then(result => {
        if (!result.ok) showToast({ message: result.error ?? 'Could not open the folder' });
      });
    },
    openInEditor: (groupId, editorId) => {
      const folder = findGroup(groupId)?.cwd;
      if (!folder) return;
      const name = editors.find(e => e.id === editorId)?.name ?? 'the editor';
      window.afterterm.editors.open(folder, editorId).then(result => {
        // main re-runs detection on failure, so a vanished editor stops being offered.
        setEditors(result.editors);
        if (!result.ok) {
          showToast({ message: `Couldn't open ${name}`, actionLabel: 'Choose editor...', onAction: chooseEditor });
        }
      });
    },
    chooseEditor,
    edit: (groupId) => setProjectModal({ mode: 'edit', groupId }),
    archive: (groupId) => {
      const group = findGroup(groupId);
      if (!group) return;
      stateRef.current.setGroupArchived(groupId, true);
      showToast({ message: `Archived ${group.label}` });
    },
    restore: (groupId) => {
      const group = findGroup(groupId);
      if (!group) return;
      stateRef.current.setGroupArchived(groupId, false);
      showToast({ message: `Restored ${group.label}` });
    },
    deleteProject: (groupId) => stateRef.current.deleteGroup(groupId),
  };

  // Per-tab timing for the working-spinner state machine (see spinnerState.ts).
  // Lives in a ref, high-frequency PTY-output updates must never trigger a render.
  const timingRef = useRef(new Map<string, TabTiming>());
  const getTiming = (tabId: string, now: number): TabTiming => {
    let t = timingRef.current.get(tabId);
    if (!t) { t = initTiming(now); timingRef.current.set(tabId, t); }
    return t;
  };
  const applyNotif = (tabId: string, cur: TabNotification | undefined, next: TabNotification | undefined) => {
    if (next !== cur) stateRef.current.setTabNotification(tabId, next);
  };

  // Load shells + restore session on mount
  useEffect(() => {
    Promise.all([
      window.afterterm.shells.list(),
      window.afterterm.session.load(),
    ]).then(([shellList, saved]) => {
      setShells(shellList);
      // The file may predate the current format (0.8.1 wrote no version field and
      // none of the project/thread fields); migrate fills defaults or rejects it.
      const session = migrateSession(saved, Date.now());
      if (session && session.tabs.length > 0) {
        state.restoreSession(session);
        setScreen(initialScreen(session.groups));
      } else {
        state.addTab();
        // A fresh profile has no session at all; the rule is the same (always Home).
        setScreen(initialScreen([]));
      }
      setInitialized(true);
    });
  }, []);

  // Auto-save session (2s debounce after any state change)
  useEffect(() => {
    if (!initialized || state.tabs.length === 0) return;
    const timer = setTimeout(() => {
      const data = serializeSession(state.tabs, state.groups, state.activeTabId);
      window.afterterm.session.save(JSON.stringify(data));
    }, 2000);
    return () => clearTimeout(timer);
  }, [initialized, state.tabs, state.groups, state.activeTabId]);

  // Keyboard shortcuts from main process
  useEffect(() => {
    window.afterterm.shortcuts.onShortcut((action) => {
      const s = stateRef.current;
      switch (action) {
        case 'new-tab':
          openChooserFromShortcut();
          break;
        case 'search':
          setPaletteOpen(open => !open);
          break;
        case 'close-tab':
          if (s.tabs.length > 0) closeThread(s.activeTabId);
          break;
        case 'next-tab': {
          if (s.tabs.length < 2) break;
          const idx = s.tabs.findIndex(t => t.id === s.activeTabId);
          handleActivate(s.tabs[(idx + 1) % s.tabs.length].id);
          break;
        }
        case 'prev-tab': {
          if (s.tabs.length < 2) break;
          const idx = s.tabs.findIndex(t => t.id === s.activeTabId);
          handleActivate(s.tabs[(idx - 1 + s.tabs.length) % s.tabs.length].id);
          break;
        }
        case 'toggle-panel':
          setPanelCollapsed(p => !p);
          break;
      }
    });
  }, []);

  // Notifier window sends tab-click → jump to that tab
  useEffect(() => {
    window.afterterm.notify.onActivateTab((tabId) => {
      handleActivate(tabId);
    });
  }, []);

  // Read branch and worktree for one thread and put them on the tab. setGitInfo
  // no-ops when nothing changed, so calling this more often than needed is free.
  const refreshGit = useCallback((tabId: string, cwd: string | undefined) => {
    if (!cwd) return;
    window.afterterm.git.info(cwd).then(info => {
      stateRef.current.setGitInfo(tabId, { branch: info.branch, worktree: info.worktree });
    });
  }, []);

  // Read the session transcript for one thread (first prompt + model). Returns the
  // promise so the startup pass can await one read before starting the next.
  const refreshClaudeMeta = useCallback((tabId: string, sessionId: string, cwd: string) => {
    return window.afterterm.claudeSession.meta(sessionId, cwd).then(meta => {
      stateRef.current.setClaudeMeta(tabId, { firstPrompt: meta.firstPrompt, model: meta.model });
    });
  }, []);

  // Main captures each tab's live Claude session (via the notify hook's file channel)
  // and pushes it here → store on the tab so the next launch can resume it. The first
  // capture is also the moment the transcript and the folder become known, so both
  // are read once here; later turns arrive on the meta push below.
  useEffect(() => {
    window.afterterm.claudeSession.onUpdate(({ tabId, sessionId, cwd }) => {
      stateRef.current.setClaudeSession(tabId, sessionId, cwd);
      refreshClaudeMeta(tabId, sessionId, cwd);
      refreshGit(tabId, cwd);
    });
  }, []);

  // Main re-reads the transcript after every hook write, that is once a turn, so a
  // /model switch or Claude's first reply shows up without anything polling.
  useEffect(() => {
    window.afterterm.claudeSession.onMeta(({ tabId, firstPrompt, model }) => {
      stateRef.current.setClaudeMeta(tabId, { firstPrompt, model });
    });
  }, []);

  // One pass over the restored session: the transcript for every chat, and branch
  // and worktree for every thread with a folder. The transcript reads run one after
  // another, a session with 40 chats would otherwise fire 40 concurrent 512 KB reads
  // in the first second of launch; the git lookups are one round trip for the lot.
  useEffect(() => {
    if (!initialized) return;
    let cancelled = false;
    const tabs = stateRef.current.tabs;

    (async () => {
      for (const tab of tabs) {
        if (cancelled) return;
        if (!tab.claudeSessionId || !tab.claudeCwd) continue;
        await refreshClaudeMeta(tab.id, tab.claudeSessionId, tab.claudeCwd);
      }
    })();

    // Tail files outlive their threads (a closed thread keeps one for Resume), so
    // the only moment it is safe to sweep the folder is here, once the restored
    // session is in state: anything not backing a live thread or a history entry
    // belongs to a thread that was closed and forgotten long ago.
    window.afterterm.threads.prune([
      ...tabs.map(t => t.id),
      ...stateRef.current.groups.flatMap(g => g.history.map(e => e.id)),
    ]);

    const withCwd = tabs
      .map(t => ({ id: t.id, cwd: threadGitCwd(t) }))
      .filter((t): t is { id: string; cwd: string } => !!t.cwd);
    if (withCwd.length > 0) {
      window.afterterm.git.infoMany(withCwd.map(t => t.cwd)).then(infos => {
        if (cancelled) return;
        withCwd.forEach((t, i) => {
          const info = infos[i];
          if (info) stateRef.current.setGitInfo(t.id, { branch: info.branch, worktree: info.worktree });
        });
      });
    }

    return () => { cancelled = true; };
  }, [initialized]);

  // Slow refresh so a branch switched from inside a terminal (or from another app)
  // catches up on its own. setGitInfo writes nothing when a thread's branch is
  // unchanged, so a quiet window costs one main-process call and no render. Paused
  // while the window is hidden, where nobody can see the answer anyway.
  useEffect(() => {
    if (!initialized) return;
    const id = setInterval(() => {
      if (document.hidden) return;
      const withCwd = stateRef.current.tabs
        .map(t => ({ id: t.id, cwd: threadGitCwd(t) }))
        .filter((t): t is { id: string; cwd: string } => !!t.cwd);
      if (withCwd.length === 0) return;
      window.afterterm.git.infoMany(withCwd.map(t => t.cwd)).then(infos => {
        withCwd.forEach((t, i) => {
          const info = infos[i];
          if (info) stateRef.current.setGitInfo(t.id, { branch: info.branch, worktree: info.worktree });
        });
      });
    }, GIT_POLL_MS);
    return () => clearInterval(id);
  }, [initialized]);

  // A shell that reported a new cwd (OSC 9;9) may have walked into another repo or
  // worktree, so its branch is re-read. threadGitCwd still decides which folder
  // actually counts for a chat.
  const handleCwdChange = useCallback((tabId: string, cwd: string) => {
    stateRef.current.updateTabCwd(tabId, cwd);
    const tab = stateRef.current.tabs.find(t => t.id === tabId);
    refreshGit(tabId, tab?.claudeCwd ?? cwd);
  }, []);

  // Opening a thread clears what it was waiting to tell you: the pending
  // notification badge and any overlay toast for it. 'working' is ongoing-turn
  // state, not an unseen badge, so it keeps spinning.
  const clearThreadBadges = useCallback((tabId: string) => {
    const current = stateRef.current.tabs.find(t => t.id === tabId)?.notification;
    if (current !== 'working') stateRef.current.setTabNotification(tabId, undefined);
    window.afterterm.notify.dismissTab(tabId);
  }, []);

  const handleActivate = useCallback((tabId: string) => {
    // Ignore clicks for tabs that no longer exist (closed tab, or the one-time
    // setup toast's sentinel tabId), just dismiss it; don't blank the view.
    if (!stateRef.current.tabs.some(t => t.id === tabId)) {
      window.afterterm.notify.dismissTab(tabId);
      return;
    }
    // activateTab (not setActiveTabId) so the tab and its group get a lastActiveAt
    // stamp: this is the user choosing the tab, which is the only thing that should
    // count as "used" until Phase 2 adds PTY activity.
    state.activateTab(tabId);
    // An asleep thread is only shown, never woken: opening it puts its pane on
    // screen with the old output and a Wake button, and nothing is spawned until
    // that button (or the menu's Wake) is used.
    clearThreadBadges(tabId);
  }, [state.activateTab, clearThreadBadges]);

  // Open a thread and show it: used by the palette and the project page, which can
  // both pick a thread from a screen that is not the workspace.
  const openThreadInWorkspace = useCallback((tabId: string) => {
    handleActivate(tabId);
    goScreen('workspace');
  }, [handleActivate, goScreen]);

  const handleNotification = useCallback((tabId: string, type: TabNotification | undefined, projectName: string) => {
    // Route the title through the spinner state machine. An undecorated title (type
    // undefined) is a no-op here, `working` is cleared by output silence, not by a
    // plain title (see spinnerState.ts / docs/bugs.md), so it can't stop the spinner.
    const now = Date.now();
    const timing = getTiming(tabId, now);
    const cur = stateRef.current.tabs.find(t => t.id === tabId)?.notification;
    applyNotif(tabId, cur, onTitle(cur, type, timing, now));

    if (!type) return;
    // Working indicator is sidebar-only, no toast while Claude is mid-turn
    if (type === 'working') return;
    // Only skip toast if user is actively looking at this tab right now
    if (stateRef.current.activeTabId === tabId && document.hasFocus()) return;

    const s = stateRef.current;
    const tab = s.tabs.find(t => t.id === tabId);
    const group = tab?.groupId ? s.groups.find(g => g.id === tab.groupId) : undefined;

    window.afterterm.notify.push({
      id: `toast-${++toastCounter}`,
      tabId,
      type,
      primaryLabel: tab ? threadName(tab) : projectName,
      secondaryLabel: group?.label,
      projectColor: group ? GROUP_COLORS[group.color].border : undefined,
      message: toastMessage(type),
    });
  }, [state.setTabNotification]);

  // Typing into a terminal (e.g. interrupting Claude with Esc / Ctrl+C) ends the
  // working turn from afterterm's view, clear the spinner. Leaves other notifs alone.
  const handleUserInput = useCallback((tabId: string) => {
    const cur = stateRef.current.tabs.find(t => t.id === tabId)?.notification;
    applyNotif(tabId, cur, onInterrupt(cur));
  }, [state.setTabNotification]);

  // Every PTY output chunk. Refreshes the tab's silence clock and, if the tab was
  // paused at a permission prompt / compaction, re-arms `working` once Claude's
  // output resumes (see spinnerState.ts). Must stay cheap, no render unless the
  // notif actually changes (only on a rare re-arm), so normal output is free.
  const handleOutput = useCallback((tabId: string, byteLen: number) => {
    const now = Date.now();
    const timing = getTiming(tabId, now);
    const cur = stateRef.current.tabs.find(t => t.id === tabId)?.notification;
    applyNotif(tabId, cur, onOutput(cur, timing, now, byteLen));
  }, [state.setTabNotification]);

  // Clock tick: clear a tab's `working` spinner after its output has been silent long
  // enough (fixes the stuck-spinner bug where Stop's ✅ never fires). Also prunes
  // timing entries for closed tabs.
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      const s = stateRef.current;
      for (const tab of s.tabs) {
        if (tab.notification !== 'working') continue;
        const timing = timingRef.current.get(tab.id);
        if (timing) applyNotif(tab.id, 'working', onTick('working', timing, now));
      }
      for (const id2 of [...timingRef.current.keys()]) {
        if (!s.tabs.some(t => t.id === id2)) timingRef.current.delete(id2);
      }
    }, 500);
    return () => clearInterval(id);
  }, []);

  // Sleep destroys the PTY too, and its exit listener is unregistered before the
  // kill for exactly that reason, but the guard stays: a sleeping thread must never
  // be closed by its own process going away.
  const handlePtyExit = useCallback((tabId: string) => {
    const tab = stateRef.current.tabs.find(t => t.id === tabId);
    if (!tab || tab.asleep) return;
    closeThreadNow(tabId);
  }, []);

  // Closing a thread inside a project files it in that project's history; a thread
  // in General is simply gone. Neither says anything: a "Moved to history" toast was
  // tried and Aryan dropped it at the Phase 4 handoff (2026-09-07), closing is too
  // frequent an action to announce.
  const closeThreadNow = useCallback((tabId: string) => {
    const wasAsleep = !!stateRef.current.tabs.find(t => t.id === tabId)?.asleep;
    const toHistory = stateRef.current.closeTab(tabId);
    if (!toHistory && wasAsleep) {
      // Closing an awake thread goes through handleTail, which is what deletes a
      // General thread's tail file. An asleep thread has no terminal left to hand a
      // tail over, so its file has to be dropped here instead of waiting for the
      // next launch's prune.
      window.afterterm.threads.deleteTail(tabId);
      setTails(prev => {
        if (prev[tabId] === undefined) return prev;
        const next = { ...prev };
        delete next[tabId];
        return next;
      });
    }
  }, []);

  // Every close the user asks for comes through here. A running server is the one
  // case that stops something the user cannot get back by reopening the thread, so
  // it asks first; everything else closes immediately. A PTY that exited on its own
  // goes straight to closeThreadNow: the process is already gone, there is nothing
  // left to confirm.
  const closeThread = useCallback((tabId: string) => {
    const tab = stateRef.current.tabs.find(t => t.id === tabId);
    if (tab && tab.port !== undefined && needsCloseConfirm(tab)) {
      setCloseConfirm({ tabId, port: tab.port });
      return;
    }
    closeThreadNow(tabId);
  }, [closeThreadNow]);

  // Open a running server's page in the default browser, through the same
  // safelisted shell:openExternal the terminal's links use.
  const openLocalhost = useCallback((tabId: string) => {
    const tab = stateRef.current.tabs.find(t => t.id === tabId);
    if (!tab || tab.port === undefined) return;
    const url = localhostUrl(tab.port);
    // The harness cannot see a browser open, so the URL is recorded on the same
    // window object the terminal layer already publishes for it. Extended, not
    // replaced: Terminal/index.tsx owns tail/activeTail/commandState on it.
    const win = window as unknown as { __afterterm?: Record<string, unknown> };
    win.__afterterm = { ...(win.__afterterm ?? {}), lastOpenExternal: url };
    window.afterterm.shell.openExternal(url);
  }, []);

  // Sleep, wake and resume, the three things Phase 4 adds. Sleeping is a record
  // change here; the terminal layer sees `asleep` turn true and does the rest
  // (capture the tail, unhook the listeners, kill the process tree).
  const sleepThread = useCallback((tabId: string) => {
    stateRef.current.sleepTab(tabId);
    // Nothing left to time: the spinner's silence clock belongs to a running
    // process, and a stale entry would survive into the next wake.
    timingRef.current.delete(tabId);
    window.afterterm.notify.dismissTab(tabId);
  }, []);

  // No screen switch and no activation: Wake from a background thread's menu wakes
  // it where it is, and the pane's own Wake button is on the active thread anyway.
  const wakeThread = useCallback((tabId: string) => {
    stateRef.current.wakeTab(tabId);
  }, []);

  // Bring a closed thread back from its project's history. The recreated tab carries
  // the closed thread's id, so its saved tail replays, and it comes back awake.
  const resumeThread = useCallback((groupId: string, entryId: string) => {
    const s = stateRef.current;
    const group = s.groups.find(g => g.id === groupId);
    const entry = group?.history.find(e => e.id === entryId);
    const tabId = s.resumeFromHistory(groupId, entryId);
    if (!tabId || !entry) return;
    // The new tab is not in state yet this tick, so its session and folder are read
    // from the entry, which is where tabFromHistory takes them from.
    const cwd = entry.cwd ?? group?.cwd;
    if (entry.kind === 'chat' && entry.sessionId && entry.cwd) {
      refreshClaudeMeta(tabId, entry.sessionId, entry.cwd);
    }
    refreshGit(tabId, cwd);
    goScreen('workspace');
  }, [refreshClaudeMeta, refreshGit, goScreen]);

  // The last lines of a terminal that is about to be destroyed. A sleeping thread's
  // tail is what its pane shows and what it replays on waking, so it is both kept in
  // state and written to disk. A closed thread's is only worth keeping when the
  // thread itself was kept: a closed General thread leaves nothing behind, file
  // included.
  const handleTail = useCallback((tabId: string, lines: string[], reason: 'sleep' | 'close') => {
    if (reason === 'sleep') {
      setTails(prev => ({ ...prev, [tabId]: lines }));
      window.afterterm.threads.saveTail(tabId, lines);
      return;
    }
    const inHistory = stateRef.current.groups.some(g => g.history.some(e => e.id === tabId));
    if (inHistory) window.afterterm.threads.saveTail(tabId, lines);
    else window.afterterm.threads.deleteTail(tabId);
    setTails(prev => {
      if (prev[tabId] === undefined) return prev;
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
  }, []);

  // Flush a synchronous save on window close, the debounced save's pending timer is
  // cleared on unmount, so the last <2s of changes (e.g. a fresh cwd) would be lost.
  useEffect(() => {
    const flush = () => {
      const s = stateRef.current;
      if (!s.tabs.length) return;
      // Screens first: once the window is gone the buffers are gone with it, and a
      // thread with no saved tail wakes into a blank terminal.
      window.afterterm.threads.saveTailsSync(terminalRef.current?.readAllTails() ?? {});
      // Quitting puts every thread to sleep, stamped now, so the "Asleep · 2d" chip
      // on the next launch counts from when the app actually closed.
      const data = serializeSession(sleepAllForShutdown(s.tabs, Date.now()), s.groups, s.activeTabId);
      window.afterterm.session.saveSync(JSON.stringify(data));
    };
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, []);

  // Always keep at least one tab
  useEffect(() => {
    if (initialized && state.tabs.length === 0) {
      state.addTab();
    }
  }, [initialized, state.tabs.length, state.addTab]);

  // Play the entrance for whichever screen is now showing: on every switch, and
  // once on the first paint after the restored session has loaded (never on the
  // empty paint before it, which has nothing to animate in).
  useEffect(() => {
    if (!initialized) return;
    setEnterClass(screen === 'home' ? 'enter-home' : screen === 'project' ? 'enter-project' : 'enter-workspace');
    const timer = setTimeout(() => setEnterClass(''), ENTER_MS);
    return () => clearTimeout(timer);
  }, [initialized, screen, screenSeq]);

  // The clock behind the relative times on Home and the project page, and behind
  // the "Asleep · 2d" chip and the asleep pane's "asleep since" line, which are the
  // only relative times in the workspace. It is set once on entry so a screen opened
  // after a long spell elsewhere never shows a stale "5m".
  useEffect(() => {
    if (screen === 'workspace' && !activeTabAsleep) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(id);
  }, [screen, screenSeq, activeTabAsleep]);

  // A sleeping thread's pane shows the output it had when it went to sleep. It is
  // already in `tails` when the thread slept in this session; a thread restored from
  // disk has to read its file, once (an empty array is stored for a missing file, so
  // a thread that never saved one is not re-read on every render).
  useEffect(() => {
    const tab = stateRef.current.tabs.find(t => t.id === state.activeTabId);
    if (!tab?.asleep || tails[tab.id] !== undefined) return;
    let cancelled = false;
    window.afterterm.threads.readTail(tab.id).then(lines => {
      if (!cancelled) setTails(prev => ({ ...prev, [tab.id]: lines ?? [] }));
    });
    return () => { cancelled = true; };
  }, [state.activeTabId, activeTabAsleep, tails]);

  // Folder existence for the screens that show it. One round trip per entry, so a
  // folder deleted while you were in the workspace is caught on the way back.
  useEffect(() => {
    if (screen === 'workspace') return;
    const folders = stateRef.current.groups
      .map(g => g.cwd)
      .filter((cwd): cwd is string => !!cwd);
    if (folders.length === 0) return;
    let cancelled = false;
    window.afterterm.projects.checkFolders(folders).then(result => {
      if (!cancelled) setFolderExists(result);
    });
    return () => { cancelled = true; };
  }, [screen, screenSeq]);

  // Editor detection runs in main at startup; the renderer just reads the result
  // once. A prefs.json editorPath that exists but is not an editor is the one
  // case worth saying out loud, so it gets a toast with a way to fix it.
  useEffect(() => {
    window.afterterm.editors.list().then(setEditors);
    window.afterterm.editors.prefsPathInvalid().then(invalid => {
      if (invalid) showEditorPathToast();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // PTY input and output stamp the thread (and its project) as recently used, so
  // Home's ordering and its "5m" follow work that happens without a tab switch.
  // Main throttles this to one stamp per tab per 15 seconds.
  useEffect(() => {
    window.afterterm.pty.onActivity(({ tabId, at }) => {
      stateRef.current.touchActivity(tabId, at);
    });
  }, []);

  // Main watches each awake thread's process tree for a listening socket and
  // pushes the port it found (or null when it has gone). Nothing here wakes or
  // activates anything: a port appearing on a background thread only changes its
  // row and its project's pills.
  // A null for a thread that is already asleep is dropped: sleeping kills the
  // process tree, and main reports the listener going away once the kill has run,
  // but the record keeps its port while asleep (it is what marks the thread as a
  // server, so the pane can say "runs npm start" and the wake can re-run it). Only
  // an awake thread losing its listener (the server was stopped, the shell stays)
  // clears the port.
  useEffect(() => {
    window.afterterm.pty.onPort(({ tabId, port }) => {
      if (port === null && stateRef.current.tabs.find(t => t.id === tabId)?.asleep) return;
      stateRef.current.setPort(tabId, port);
    });
  }, []);

  // Harness hook: the current record of one thread (drive eval
  // "window.__afterterm.tab('tab-1')"), so a test can check port, lastCommand and
  // asleep without going through the saved file's two second debounce. Extended,
  // not replaced, for the same reason as openLocalhost's hook above.
  useEffect(() => {
    const win = window as unknown as { __afterterm?: Record<string, unknown> };
    win.__afterterm = {
      ...(win.__afterterm ?? {}),
      tab: (tabId: string) => stateRef.current.tabs.find(t => t.id === tabId) ?? null,
    };
  }, []);

  // A project page whose project was deleted (from its own menu, say) has nothing
  // left to show, so it falls back to Home.
  useEffect(() => {
    if (!initialized || screen !== 'project') return;
    if (!projectPageId || !state.groups.some(g => g.id === projectPageId)) goScreen('home');
  }, [initialized, screen, projectPageId, state.groups, goScreen]);

  // The command line a thread's user just entered, captured from the OSC 133 marks
  // (commandMarks.ts). It is what a sleeping server re-runs on wake.
  const handleCommand = useCallback((tabId: string, command: string) => {
    stateRef.current.setLastCommand(tabId, command);
  }, []);

  const tabInfos = state.tabs.map(t => ({ id: t.id, shellId: t.shellId, cwd: t.cwd, fontSize: t.fontSize, claudeSessionId: t.claudeSessionId, claudeCwd: t.claudeCwd, asleep: t.asleep, wokeAt: t.wokeAt, port: t.port, lastCommand: t.lastCommand }));

  const activeTab = state.tabs.find(t => t.id === state.activeTabId);
  const activeGroup = activeTab?.groupId ? state.groups.find(g => g.id === activeTab.groupId) : undefined;
  const pageGroup = projectPageId ? state.groups.find(g => g.id === projectPageId) : undefined;
  const folderMissing = (group: { cwd?: string }) => !!group.cwd && folderExists[group.cwd] === false;

  return (
    <div className={`app${enterClass ? ` ${enterClass}` : ''}`} data-screen={screen}>
      <TitleBar />

      {screen === 'home' && (
        <Home
          groups={state.groups}
          tabs={state.tabs}
          now={now}
          editors={editors}
          folderExists={folderExists}
          actions={projectActions}
          onNewProject={() => setProjectModal({ mode: 'create' })}
          onGoWorkspace={() => goScreen('workspace')}
        />
      )}

      {screen === 'project' && pageGroup && (
        <ProjectPage
          group={pageGroup}
          tabs={state.tabs.filter(t => t.groupId === pageGroup.id)}
          activeTabId={state.activeTabId}
          now={now}
          editors={editors}
          folderMissing={folderMissing(pageGroup)}
          actions={projectActions}
          onOpenThread={openThreadInWorkspace}
          onResume={entryId => resumeThread(pageGroup.id, entryId)}
          initialTab={projectPageTab}
          threadMenu={tab => buildThreadMenu(tab, state.groups, {
            open: () => openThreadInWorkspace(tab.id),
            moveToGroup: id => (id ? state.addToGroup(tab.id, id) : state.removeFromGroup(tab.id)),
            close: () => closeThread(tab.id),
            sleep: () => sleepThread(tab.id),
            wake: () => wakeThread(tab.id),
            openLocalhost: () => openLocalhost(tab.id),
            openProjectPage: tab.groupId ? () => goScreen('project', tab.groupId) : undefined,
          })}
          onBack={() => goScreen('home')}
          onGoWorkspace={() => goScreen('workspace')}
        />
      )}

      {/* The workspace stays mounted on every screen (hidden with CSS) so its
          terminals keep running and the active tab's Claude resume still fires. */}
      <div className={`workspace${screen === 'workspace' ? '' : ' hidden'}`}>
        <SidePanel
          tabs={state.tabs}
          groups={state.groups}
          activeTabId={state.activeTabId}
          collapsed={panelCollapsed}
          shells={shells}
          onToggleCollapse={() => setPanelCollapsed(p => !p)}
          onActivate={handleActivate}
          onClose={closeThread}
          onSleep={sleepThread}
          onWake={wakeThread}
          onOpenLocalhost={openLocalhost}
          onNewTab={state.addTab}
          onGoHome={() => goScreen('home')}
          onSearch={() => setPaletteOpen(open => !open)}
          onOpenChooser={setChooser}
          onOpenProjectPage={groupId => goScreen('project', groupId)}
          onTogglePin={projectActions.togglePin}
          onNewProject={() => setProjectModal({ mode: 'create' })}
          editors={editors}
          folderExists={folderExists}
          projectActions={projectActions}
          onCreateGroup={(t1, t2) => state.createGroup(t1, t2)}
          onAddToGroup={state.addToGroup}
          onRemoveFromGroup={state.removeFromGroup}
          onRenameGroup={state.renameGroup}
          onSetGroupColor={state.setGroupColor}
          onToggleGroupCollapse={state.toggleGroupCollapse}
          onMoveTab={state.moveTab}
          onMoveGroup={state.moveGroup}
          onMoveGroupAfterGroup={state.moveGroupAfterGroup}
        />

        <div className="terminal-area">
          <Header
            tab={activeTab}
            group={activeGroup}
            groups={state.groups}
            now={now}
            actions={activeTab ? {
              open: () => state.activateTab(activeTab.id),
              moveToGroup: (id) => id ? state.addToGroup(activeTab.id, id) : state.removeFromGroup(activeTab.id),
              close: () => closeThread(activeTab.id),
              sleep: () => sleepThread(activeTab.id),
              wake: () => wakeThread(activeTab.id),
              openLocalhost: () => openLocalhost(activeTab.id),
              openProjectPage: activeTab.groupId ? () => goScreen('project', activeTab.groupId) : undefined,
            } : undefined}
          />
          {/* An asleep thread has no terminal at all, so its pane stands in for one:
              the saved tail, dimmed, and a Wake button. */}
          {activeTab?.asleep && (
            <AsleepPane
              tab={activeTab}
              tail={tails[activeTab.id] ?? null}
              now={now}
              onWake={() => wakeThread(activeTab.id)}
            />
          )}
          {initialized && (
            <TerminalArea
              ref={terminalRef}
              tabs={tabInfos}
              activeTabId={state.activeTabId}
              visible={screen === 'workspace'}
              hidden={!!activeTab?.asleep}
              onTitleChange={state.renameTab}
              onCwdChange={handleCwdChange}
              onNotification={handleNotification}
              onUserInput={handleUserInput}
              onOutput={handleOutput}
              onFontSizeChange={state.setTabFontSize}
              onExit={handlePtyExit}
              onTail={handleTail}
              onCommand={handleCommand}
            />
          )}
        </div>
      </div>

      {chooser && (
        <NewThreadChooser
          anchor={chooser}
          groups={state.groups}
          currentGroupId={activeTab?.groupId}
          shells={shells}
          onPick={(groupId, shellId) => {
            state.addTab(groupId, shellId);
            setChooser(null);
            goScreen('workspace');
          }}
          onClose={() => setChooser(null)}
        />
      )}

      {paletteOpen && (
        <SearchPalette
          groups={state.groups}
          tabs={state.tabs}
          onOpenProject={groupId => { projectActions.open(groupId); setPaletteOpen(false); }}
          onOpenThread={tabId => { openThreadInWorkspace(tabId); setPaletteOpen(false); }}
          onOpenHistory={(groupId, _entryId) => {
            // A history hit opens its project page on the History tab, where the row
            // and its Resume button live; the entry id is not needed to get there,
            // the list is short and searchable in place.
            goScreen('project', groupId);
            setProjectPageTab('history');
            setPaletteOpen(false);
          }}
          onClose={() => setPaletteOpen(false)}
        />
      )}

      {projectModal && (() => {
        const editing = projectModal.groupId ? state.groups.find(g => g.id === projectModal.groupId) : undefined;
        // An edit whose project vanished (deleted underneath the menu) has nothing to show.
        if (projectModal.mode === 'edit' && !editing) return null;
        const initial: GroupDraft = editing
          ? { label: editing.label, color: editing.color, cwd: editing.cwd, shellId: editing.shellId }
          : { label: '', color: nextGroupColor(state.groups) };
        return (
          <GroupModal
            mode={projectModal.mode}
            initial={initial}
            shells={shells}
            onCancel={() => setProjectModal(null)}
            onSubmit={(draft, openTerminal) => {
              if (editing) {
                state.updateGroup(editing.id, draft);
              } else {
                state.createConfiguredGroup(draft, openTerminal);
                // A new project with a terminal in it belongs on screen, not behind
                // the Home board that was used to create it.
                if (openTerminal) goScreen('workspace');
              }
              setProjectModal(null);
            }}
          />
        );
      })()}

      {closeConfirm && (() => {
        const text = closeConfirmText(closeConfirm.port);
        return (
          <ConfirmDialog
            title={text.title}
            body={text.body}
            confirmLabel={text.confirm}
            cancelLabel={text.cancel}
            danger
            onConfirm={() => {
              // The thread may have been slept or closed by other means while the
              // dialog stood; closeThreadNow on an id that is no longer there is a
              // no-op (closeTab finds no tab, filters nothing out).
              closeThreadNow(closeConfirm.tabId);
              setCloseConfirm(null);
            }}
            onCancel={() => setCloseConfirm(null)}
          />
        );
      })()}

      {toast && (
        <Toast
          key={toast.id}
          message={toast.message}
          actionLabel={toast.actionLabel}
          onAction={toast.onAction}
          onDone={() => setToast(null)}
        />
      )}

      <Tooltip />
    </div>
  );
}

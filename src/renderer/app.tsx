import React, { useState, useCallback, useEffect, useRef } from 'react';
import { SidePanel } from './components/SidePanel';
import type { SidePanelHandle } from './components/SidePanel';
import { Rail } from './components/Rail';
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
import { Tab, TabNotification, GROUP_COLORS, nextGroupColor } from './components/TabBar/types';
import { onTitle, onOutput, onTick, onInterrupt, onAnswer, initTiming, TabTiming } from './spinnerState';
import { migrateSession, serializeSession } from './sessionMigration';
import { sleepAllForShutdown } from './sleepWake';
import { toastMessage, initialScreen, threadName, needsCloseConfirm, closeConfirmText, needsSleepConfirm, sleepConfirmText, localhostUrl, threadFolder, threadFolderTarget } from './threadView';
import { ProjectActions } from './projectMenu';
import { buildThreadMenu } from './threadMenu';
import { projectAttention, totalAttention, railProjects, firstThreadToOpen } from './attention';
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
// How long the panel takes to slide shut (SidePanel.css, .side-panel.hidden).
// Going to Home waits this long before the screen changes, so the slide is seen
// (design-03 decision 1); under reduced motion there is nothing to see and the
// switch is immediate.
const PANEL_SLIDE_MS = 320;
const reducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
  // Whether the panel is hidden (Ctrl+Shift+B, the toggle). Persisted in
  // session.json as ui.panelHidden (Phase 8); the rail is never hidden.
  const [panelHidden, setPanelHidden] = useState(false);
  // The transient slide: the panel is shut on the way to Home and slides open
  // again on the way back (design-03 decision 1), without touching the
  // persisted flag above. Never true while panelHidden already is.
  const [panelShut, setPanelShut] = useState(false);
  const slideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelRef = useRef<SidePanelHandle>(null);
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
  // One dialog serves both Close and Sleep: Aryan decided on 2026-09-07 that Sleep
  // asks the same way Close does, since both stop the running server. The difference
  // is only that Wake brings it back, which the sleep wording says. `kind` picks
  // the text, the danger styling and which action the confirm runs.
  const [pendingConfirm, setPendingConfirm] =
    useState<{ kind: 'close' | 'sleep'; tabId: string; port: number } | null>(null);
  // Which tab a project page opens on. Everything that opens a project page shows
  // Live; only the palette's history results open it on History.
  const [projectPageTab, setProjectPageTab] = useState<'live' | 'asleep' | 'history'>('live');

  // The terminal layer, for the one thing only it knows: what is on each screen
  // right now. Read at quit, when every awake thread's tail has to reach disk.
  const terminalRef = useRef<TerminalAreaHandle>(null);

  const stateRef = useRef(state);
  stateRef.current = state;
  const panelHiddenRef = useRef(panelHidden);
  panelHiddenRef.current = panelHidden;
  const screenRef = useRef(screen);
  screenRef.current = screen;

  // Read by the clock effect and the tail-reading effect below, both of which run
  // before `activeTab` is derived further down.
  const activeTabAsleep = !!state.tabs.find(t => t.id === state.activeTabId)?.asleep;

  // Every screen switch goes through here so the entrance class always replays.
  // Phase 8 adds the panel's slide (design-03 decision 1): leaving the workspace
  // slides the panel shut first and only then changes the screen; coming back
  // changes the screen at once and the panel slides open from zero, unless it
  // was hidden before, in which case it stays hidden. The slide is skipped
  // outright under reduced motion.
  const goScreen = useCallback((next: Screen, groupId?: string) => {
    if (next === 'project') {
      if (!groupId) return;
      setProjectPageId(groupId);
      // Every route into a project page lands on Live. The one exception sets
      // History straight after calling this (see the palette's onOpenHistory).
      setProjectPageTab('live');
    }
    if (slideTimerRef.current) { clearTimeout(slideTimerRef.current); slideTimerRef.current = null; }
    const switchNow = () => {
      setScreen(next);
      setScreenSeq(n => n + 1);
    };
    const wasWorkspace = screenRef.current === 'workspace';
    const canSlide = !panelHiddenRef.current && !reducedMotion();
    if (next !== 'workspace' && wasWorkspace && canSlide) {
      // A second switch (Home, then a project page) must not slide again: the
      // panel is already shut once the first one has landed.
      setPanelShut(true);
      slideTimerRef.current = setTimeout(() => { slideTimerRef.current = null; switchNow(); }, PANEL_SLIDE_MS);
      return;
    }
    if (next === 'workspace' && !wasWorkspace && canSlide) {
      // Mount shut, then release on the next frames so the width transition
      // runs from zero rather than the panel appearing at full width.
      setPanelShut(true);
      switchNow();
      requestAnimationFrame(() => requestAnimationFrame(() => setPanelShut(false)));
      return;
    }
    if (next === 'workspace') setPanelShut(false);
    switchNow();
  }, []);

  useEffect(() => () => { if (slideTimerRef.current) clearTimeout(slideTimerRef.current); }, []);

  // Ctrl+Shift+B and the two toggle buttons. Showing the panel again also ends any
  // transient shut, so a toggle mid-slide always lands on "shown".
  const togglePanel = useCallback(() => {
    setPanelShut(false);
    setPanelHidden(h => !h);
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

  // One Explorer launch for the project menu (its folder) and the thread menu
  // (the thread's own folder, Phase 9): the same projects:openInExplorer IPC,
  // the same toast when main reports a failure.
  const openFolderInExplorer = (folder: string) => {
    // Recorded for the harness (drive.mjs's `opened`), which cannot see an
    // Explorer window open; main logs the same folder under AFTERTERM_HARNESS=1.
    const win = window as unknown as { __afterterm?: Record<string, unknown> };
    win.__afterterm = { ...(win.__afterterm ?? {}), lastOpenFolder: folder };
    window.afterterm.projects.openInExplorer(folder).then(result => {
      if (!result.ok) showToast({ message: result.error ?? 'Could not open the folder' });
    });
  };

  // What the thread menu's "Open in File Explorer" gets for a thread: nothing
  // when the thread has no folder (the item is then left out), otherwise the
  // folder's checked existence and the launch. `folderExists` is only ever
  // false for a folder main has actually checked and found missing; an
  // unchecked one counts as present, so the item never starts out disabled.
  const threadExplorer = (tab: Tab) => {
    const target = threadFolderTarget(tab, folderExists);
    if (!target) return undefined;
    return { missing: target.missing, open: () => openFolderInExplorer(target.folder) };
  };

  // Launches an editor on a folder, for a project (its root) and a thread (its
  // own folder) alike. main re-runs detection on failure, so a vanished editor
  // stops being offered, and the toast offers to pick one.
  const openFolderInEditor = (folder: string, editorId: string) => {
    // Recorded for the harness (drive.mjs's `opened`), like lastOpenFolder.
    const win = window as unknown as { __afterterm?: Record<string, unknown> };
    win.__afterterm = { ...(win.__afterterm ?? {}), lastOpenEditor: { folder, editorId } };
    const name = editors.find(e => e.id === editorId)?.name ?? 'the editor';
    window.afterterm.editors.open(folder, editorId).then(result => {
      setEditors(result.editors);
      if (!result.ok) {
        showToast({ message: `Couldn't open ${name}`, actionLabel: 'Choose editor...', onAction: chooseEditor });
      }
    });
  };

  // "Open in <editor>" for a thread's own folder (the worktree for a worktree
  // chat, the project root for a chat that runs there, a shell's cwd), the
  // editor twin of threadExplorer: the header's editor button and the thread
  // menu entries. Undefined when the thread has no folder or no editor was found.
  const threadEditor = (tab: Tab) => {
    const target = threadFolderTarget(tab, folderExists);
    if (!target || editors.length === 0) return undefined;
    return { editors, missing: target.missing, open: (editorId: string) => openFolderInEditor(target.folder, editorId) };
  };

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
      if (folder) openFolderInExplorer(folder);
    },
    openInEditor: (groupId, editorId) => {
      const folder = findGroup(groupId)?.cwd;
      if (folder) openFolderInEditor(folder, editorId);
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
        setPanelHidden(!!session.ui?.panelHidden);
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
      const data = serializeSession(state.tabs, state.groups, state.activeTabId, { panelHidden });
      window.afterterm.session.save(JSON.stringify(data));
    }, 2000);
    return () => clearTimeout(timer);
  }, [initialized, state.tabs, state.groups, state.activeTabId, panelHidden]);

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
          togglePanel();
          break;
        case 'next-thread':
          cycleThread(1);
          break;
        case 'prev-thread':
          cycleThread(-1);
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
  // A transcript read also says where the session was last working (meta.cwd, the
  // newest entry's cwd). When that differs from the folder the notify hook recorded
  // (a session that entered a worktree, then was resumed: Claude Code restores the
  // worktree, the hook only reports it on the next prompt) the tab follows the
  // transcript at once, so the header's branch and worktree, Open in File Explorer
  // and the next wake's `claude --resume` folder are right without a message being
  // sent (Aryan, 2026-09-19). The hook's own report still wins on every turn: it
  // arrives through onUpdate with the same setClaudeSession.
  const applyClaudeMeta = useCallback((tabId: string, sessionId: string, meta: ClaudeSessionMeta) => {
    stateRef.current.setClaudeMeta(tabId, { firstPrompt: meta.firstPrompt, model: meta.model });
    if (!meta.cwd) return;
    const tab = stateRef.current.tabs.find(t => t.id === tabId);
    if (!tab || tab.claudeSessionId !== sessionId || tab.claudeCwd === meta.cwd) return;
    stateRef.current.setClaudeSession(tabId, sessionId, meta.cwd);
    refreshGit(tabId, meta.cwd);
  }, [refreshGit]);

  const refreshClaudeMeta = useCallback((tabId: string, sessionId: string, cwd: string) => {
    return window.afterterm.claudeSession.meta(sessionId, cwd).then(meta => applyClaudeMeta(tabId, sessionId, meta));
  }, [applyClaudeMeta]);

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
    window.afterterm.claudeSession.onMeta(({ tabId, sessionId, firstPrompt, model, cwd }) => {
      applyClaudeMeta(tabId, sessionId, { firstPrompt, model, cwd, exists: true });
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

  // Opening a thread clears what it had finished telling you: a 'done' or
  // 'background' badge, the unread mark, and any overlay toast for it. It does
  // not clear needs-you (Phase 7, design-03 decision 4): a permission prompt is
  // still waiting after you look at it, and only answering it (Enter), cancelling
  // it (Esc or Ctrl+C) or the hook's next title ends it, all in spinnerState.ts.
  // 'working' and 'compacting' are ongoing-turn state, not unseen badges, so they
  // keep spinning.
  const clearThreadBadges = useCallback((tabId: string) => {
    const tab = stateRef.current.tabs.find(t => t.id === tabId);
    const current = tab?.notification;
    if (current === 'done' || current === 'background') stateRef.current.setTabNotification(tabId, undefined);
    if (tab?.unread) stateRef.current.setUnread(tabId, false);
    window.afterterm.notify.dismissTab(tabId);
  }, []);

  // `keepProjectOrder` is the keyboard cycle's flag (see activateTab in
  // useTabState.ts): moving through the panel must not reorder its Recent list.
  const handleActivate = useCallback((tabId: string, keepProjectOrder = false) => {
    // Ignore clicks for tabs that no longer exist (closed tab, or the one-time
    // setup toast's sentinel tabId), just dismiss it; don't blank the view.
    if (!stateRef.current.tabs.some(t => t.id === tabId)) {
      window.afterterm.notify.dismissTab(tabId);
      return;
    }
    // activateTab (not setActiveTabId) so the tab and its group get a lastActiveAt
    // stamp: this is the user choosing the tab, which is the only thing that should
    // count as "used" until Phase 2 adds PTY activity.
    state.activateTab(tabId, keepProjectOrder);
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

  // Ctrl+Shift+Down and Up (design-03 decisions 6 and 7): the next or previous
  // thread row the panel is showing, in panel order, across projects. The panel
  // owns the fold state and the search text, so it is asked rather than
  // recomputed here. From Home or a project page the workspace comes back too.
  const cycleThread = useCallback((dir: 1 | -1) => {
    const next = panelRef.current?.cycleThread(stateRef.current.activeTabId, dir);
    if (!next) return;
    // Without reordering Recent: a project rising to the top the moment the cycle
    // lands in it would put the same two projects in front of the keys forever.
    handleActivate(next, true);
    if (screenRef.current !== 'workspace') goScreen('workspace');
  }, [handleActivate, goScreen]);

  // A rail tile click (design-03 decision 1): the workspace on that project's
  // first thread waiting for you, else its first finished one, else its most
  // recently active awake thread; the project is expanded in the panel by the
  // panel's own activation effect. A project with nothing to open (every thread
  // asleep, nothing pending) opens the way a Home card does.
  const openProjectFromRail = useCallback((groupId: string) => {
    const s = stateRef.current;
    const target = firstThreadToOpen(s.tabs.filter(t => t.groupId === groupId));
    if (target) {
      handleActivate(target.id);
      goScreen('workspace');
      return;
    }
    projectActions.open(groupId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleActivate, goScreen]);

  // A click on a project in the panel's docked Other list (design-03 decision
  // 2): its activity is stamped to now so the Recent rule holds it for three
  // days, it is expanded, and its first thread is selected, waking nothing.
  const bringProjectIn = useCallback((groupId: string) => {
    const tabId = stateRef.current.bringProjectIn(groupId, Date.now());
    if (tabId) clearThreadBadges(tabId);
  }, [clearThreadBadges]);

  const handleNotification = useCallback((tabId: string, type: TabNotification | undefined, projectName: string) => {
    // Route the title through the spinner state machine. An undecorated title (type
    // undefined) is a no-op here, `working` is cleared by output silence, not by a
    // plain title (see spinnerState.ts / docs/bugs.md), so it can't stop the spinner.
    const now = Date.now();
    const timing = getTiming(tabId, now);
    const cur = stateRef.current.tabs.find(t => t.id === tabId)?.notification;
    const next = onTitle(cur, type, timing, now);
    // The user is looking at this thread right now: the same test that suppresses
    // the toast below. A `done` that lands on the viewed thread has already been
    // seen, so it clears at once instead of waiting for the next activation
    // (Aryan, 2026-09-19); with the app behind another window it stays done until
    // the thread is looked at, exactly as a background one does.
    const viewing = stateRef.current.activeTabId === tabId && document.hasFocus();
    applyNotif(tabId, cur, next === 'done' && viewing ? undefined : next);

    if (!type) return;
    // Working indicator is sidebar-only, no toast while Claude is mid-turn
    if (type === 'working') return;
    // Only skip toast if user is actively looking at this tab right now
    if (viewing) return;

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
      projectIcon: group?.icon,
      message: toastMessage(type),
    });
  }, [state.setTabNotification]);

  // Esc or Ctrl+C in a terminal ends the working turn from afterterm's view and
  // cancels a permission prompt, so both the spinner and needs-you clear. Leaves
  // other notifs alone.
  const handleUserInput = useCallback((tabId: string) => {
    const cur = stateRef.current.tabs.find(t => t.id === tabId)?.notification;
    applyNotif(tabId, cur, onInterrupt(cur));
  }, [state.setTabNotification]);

  // Enter in a terminal. At a permission prompt this is the answer, so needs-you
  // becomes working (and the silence clear drops it again if Claude does not
  // resume). In every other state it is a no-op (spinnerState.ts, onAnswer).
  const handleAnswer = useCallback((tabId: string) => {
    const now = Date.now();
    const timing = getTiming(tabId, now);
    const cur = stateRef.current.tabs.find(t => t.id === tabId)?.notification;
    applyNotif(tabId, cur, onAnswer(cur, timing, now));
  }, [state.setTabNotification]);

  // A real keystroke in a thread. An unread chat the user is typing in is no
  // longer unread (Aryan, 2026-09-19); nothing else changes here, the attention
  // state machine has its own two signals above.
  const handleTyped = useCallback((tabId: string) => {
    if (stateRef.current.tabs.find(t => t.id === tabId)?.unread) stateRef.current.setUnread(tabId, false);
  }, []);

  // Every PTY output chunk. Refreshes the tab's silence clock and, if the tab was
  // paused at a compaction, re-arms `working` once Claude's output resumes (see
  // spinnerState.ts; a permission prompt no longer re-arms from output, since
  // arrowing through its options echoes output too). Must stay cheap, no render unless the
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
      setPendingConfirm({ kind: 'close', tabId, port: tab.port });
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
  const sleepThreadNow = useCallback((tabId: string) => {
    stateRef.current.sleepTab(tabId);
    // Nothing left to time: the spinner's silence clock belongs to a running
    // process, and a stale entry would survive into the next wake.
    timingRef.current.delete(tabId);
    window.afterterm.notify.dismissTab(tabId);
  }, []);

  // Every sleep the user asks for comes through here, and a running server asks
  // first, exactly as closing one does: sleeping kills the process tree, so the
  // server stops either way. Only the wording differs, since Wake brings this one
  // back. The quit flush (sleepAllForShutdown) is not a user sleep and deliberately
  // does not come through here.
  const sleepThread = useCallback((tabId: string) => {
    const tab = stateRef.current.tabs.find(t => t.id === tabId);
    if (tab && tab.port !== undefined && needsSleepConfirm(tab)) {
      setPendingConfirm({ kind: 'sleep', tabId, port: tab.port });
      return;
    }
    sleepThreadNow(tabId);
  }, [sleepThreadNow]);

  // No screen switch and no activation: Wake from a background thread's menu wakes
  // it where it is, and the pane's own Wake button is on the active thread anyway.
  // A chat reads its transcript before the wake (one small IPC round trip, a head
  // and tail read), so a session that moved worktree resumes in the folder it was
  // last working in rather than the one the hook recorded (applyClaudeMeta); the
  // wake never waits on a failed read.
  const wakeThread = useCallback(async (tabId: string) => {
    const tab = stateRef.current.tabs.find(t => t.id === tabId);
    if (tab?.claudeSessionId && tab.claudeCwd) {
      try { await refreshClaudeMeta(tabId, tab.claudeSessionId, tab.claudeCwd); } catch { /* wake anyway */ }
    }
    stateRef.current.wakeTab(tabId);
    // Waking is acting on the thread, the same as typing in it: the unread mark
    // has done its job.
    if (stateRef.current.tabs.find(t => t.id === tabId)?.unread) stateRef.current.setUnread(tabId, false);
  }, [refreshClaudeMeta]);

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
      // The panel flag rides along here too, or a quit with the panel hidden
      // would come back with it shown (found in the Phase 8 self-test).
      const data = serializeSession(sleepAllForShutdown(s.tabs, Date.now()), s.groups, s.activeTabId, { panelHidden: panelHiddenRef.current });
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
  // the "Asleep · 2d" chip and the asleep pane's "asleep since" line. It is set
  // once on entry so a screen opened after a long spell elsewhere never shows a
  // stale "5m".
  // Since Phase 8 the panel reads it too (the Recent rule's 3-day window and the
  // docked Other rows' "2d"), so it ticks on every screen.
  useEffect(() => {
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

  // Folder existence for the screens that show it and, since Phase 9, for the
  // thread menu's own Explorer entry. One round trip per screen entry, so a folder
  // deleted while you were in the workspace is caught on the way back, plus one
  // whenever the set of folders itself changes (a thread cd-ing somewhere new, a
  // project added), which is what keeps the workspace's thread menus honest
  // without polling. Project folders and thread folders go in one call.
  const folderKey = [
    ...state.groups.map(g => g.cwd),
    ...state.tabs.map(t => threadFolder(t)),
  ].filter((f): f is string => !!f).sort().join('\0');
  useEffect(() => {
    const folders = folderKey === '' ? [] : Array.from(new Set(folderKey.split('\0')));
    if (folders.length === 0) return;
    let cancelled = false;
    window.afterterm.projects.checkFolders(folders).then(result => {
      if (!cancelled) setFolderExists(result);
    });
    return () => { cancelled = true; };
  }, [screen, screenSeq, folderKey]);

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
      // Phase 8: the same for a project (lastActiveAt, collapsed, icon, pinned).
      group: (groupId: string) => stateRef.current.groups.find(g => g.id === groupId) ?? null,
      // Phase 7: the aggregate every count reads from (attention.ts), per project
      // and in total, for the harness's `counts` command. Keyed by project label
      // as well as id so a test can name the project it seeded.
      counts: () => {
        const s = stateRef.current;
        const perProject = projectAttention(s.groups, s.tabs);
        return {
          total: totalAttention(s.groups, s.tabs),
          projects: s.groups
            .filter(g => !g.archived)
            .map(g => ({ id: g.id, label: g.label, pinned: g.pinned, ...(perProject.get(g.id) ?? { waiting: 0, working: 0, running: 0, finished: 0, compacting: 0 }) })),
          rail: railProjects(s.groups, s.tabs).map(g => g.label),
        };
      },
      // Phase 8: the persisted panel flag, read by the harness's `rail` command,
      // and the panel's own row order, the list Ctrl+Shift+Down/Up walks.
      panelHidden: () => panelHiddenRef.current,
      panelOrder: () => panelRef.current?.visibleIds() ?? [],
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

      <div className="app-body">
      {/* The always-on rail (Phase 8, design-03 decision 1): on every screen, never
          hidden. Its Search and New thread buttons only open while the panel is
          hidden on the workspace, so they stand in for the panel's own rows. */}
      <Rail
        screen={screen}
        panelHidden={panelHidden}
        groups={state.groups}
        tabs={state.tabs}
        editors={editors}
        folderExists={folderExists}
        projectActions={projectActions}
        onGoHome={() => goScreen('home')}
        onGoWorkspace={() => goScreen('workspace')}
        onTogglePanel={togglePanel}
        onSearch={() => setPaletteOpen(open => !open)}
        onNewThread={setChooser}
        onOpenProject={openProjectFromRail}
      />

      <div className="app-main">
      {screen === 'home' && (
        <Home
          groups={state.groups}
          tabs={state.tabs}
          now={now}
          editors={editors}
          folderExists={folderExists}
          actions={projectActions}
          onNewProject={() => setProjectModal({ mode: 'create' })}
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
            setUnread: unread => state.setUnread(tab.id, unread),
            openLocalhost: () => openLocalhost(tab.id),
            openInExplorer: threadExplorer(tab),
            openInEditor: threadEditor(tab),
            openProjectPage: tab.groupId ? () => goScreen('project', tab.groupId) : undefined,
          })}
          onBack={() => goScreen('home')}
        />
      )}

      {/* The workspace stays mounted on every screen (hidden with CSS) so its
          terminals keep running and the active tab's Claude resume still fires. */}
      <div className={`workspace${screen === 'workspace' ? '' : ' hidden'}`}>
        <SidePanel
          ref={panelRef}
          tabs={state.tabs}
          groups={state.groups}
          activeTabId={state.activeTabId}
          hidden={panelHidden || panelShut}
          now={now}
          shells={shells}
          onToggleCollapse={togglePanel}
          onActivate={handleActivate}
          onClose={closeThread}
          onSleep={sleepThread}
          onSetUnread={state.setUnread}
          onWake={wakeThread}
          onOpenLocalhost={openLocalhost}
          threadExplorer={threadExplorer}
          threadEditor={threadEditor}
          onNewTab={state.addTab}
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
          onSetGroupsCollapsed={state.setGroupCollapsedMany}
          onBringIn={bringProjectIn}
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
            projectExplorer={activeGroup?.cwd ? {
              missing: folderMissing(activeGroup),
              open: () => openFolderInExplorer(activeGroup.cwd!),
            } : undefined}
            editor={activeTab ? threadEditor(activeTab) : undefined}
            actions={activeTab ? {
              open: () => state.activateTab(activeTab.id),
              moveToGroup: (id) => id ? state.addToGroup(activeTab.id, id) : state.removeFromGroup(activeTab.id),
              close: () => closeThread(activeTab.id),
              sleep: () => sleepThread(activeTab.id),
              wake: () => wakeThread(activeTab.id),
              setUnread: unread => state.setUnread(activeTab.id, unread),
              openLocalhost: () => openLocalhost(activeTab.id),
              openInExplorer: threadExplorer(activeTab),
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
              onAnswer={handleAnswer}
              onTyped={handleTyped}
              onOutput={handleOutput}
              onFontSizeChange={state.setTabFontSize}
              onExit={handlePtyExit}
              onTail={handleTail}
              onCommand={handleCommand}
            />
          )}
        </div>
      </div>
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
          ? { label: editing.label, color: editing.color, cwd: editing.cwd, shellId: editing.shellId, icon: editing.icon }
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

      {pendingConfirm && (() => {
        const tab = state.tabs.find(t => t.id === pendingConfirm.tabId);
        const text = pendingConfirm.kind === 'close'
          ? closeConfirmText(pendingConfirm.port)
          : sleepConfirmText(pendingConfirm.port, tab?.lastCommand);
        return (
          <ConfirmDialog
            title={text.title}
            body={text.body}
            confirmLabel={text.confirm}
            cancelLabel={text.cancel}
            // Only closing is destructive: a slept thread is still there, and Wake
            // brings its server back.
            danger={pendingConfirm.kind === 'close'}
            onConfirm={() => {
              // The thread may have been slept or closed by other means while the
              // dialog stood; either action on an id that is no longer there is a
              // no-op (closeTab and sleepTab both find no tab and change nothing).
              if (pendingConfirm.kind === 'close') closeThreadNow(pendingConfirm.tabId);
              else sleepThreadNow(pendingConfirm.tabId);
              setPendingConfirm(null);
            }}
            onCancel={() => setPendingConfirm(null)}
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

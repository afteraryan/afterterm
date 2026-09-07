import React, { useState, useCallback, useEffect, useRef } from 'react';
import { SidePanel } from './components/SidePanel';
import { TerminalArea } from './components/Terminal';
import { Header } from './components/Header';
import { TitleBar } from './components/TitleBar';
import { Tooltip } from './components/Tooltip';
import { Home } from './components/Home';
import { ProjectPage } from './components/ProjectPage';
import { NewThreadChooser } from './components/NewThreadChooser';
import { SearchPalette } from './components/SearchPalette';
import { GroupModal, GroupDraft } from './components/GroupModal';
import { Toast } from './components/Toast';
import type { Screen } from './components/ScreenNav';
import { useTabState } from './hooks/useTabState';
import { TabNotification, GROUP_COLORS, nextGroupColor } from './components/TabBar/types';
import { onTitle, onOutput, onTick, onInterrupt, initTiming, TabTiming } from './spinnerState';
import { migrateSession, serializeSession } from './sessionMigration';
import { displayTitle, toastMessage, initialScreen } from './threadView';
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

  const stateRef = useRef(state);
  stateRef.current = state;
  const panelRef = useRef(panelCollapsed);
  panelRef.current = panelCollapsed;
  const screenRef = useRef(screen);
  screenRef.current = screen;

  // Every screen switch goes through here so the entrance class always replays.
  const goScreen = useCallback((next: Screen, groupId?: string) => {
    if (next === 'project') {
      if (!groupId) return;
      setProjectPageId(groupId);
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
          if (s.tabs.length > 0) s.closeTab(s.activeTabId);
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

  // Main captures each tab's live Claude session (via the notify hook's file channel)
  // and pushes it here → store on the tab so the next launch can resume it.
  useEffect(() => {
    window.afterterm.claudeSession.onUpdate(({ tabId, sessionId, cwd }) => {
      stateRef.current.setClaudeSession(tabId, sessionId, cwd);
    });
  }, []);

  // Opening a thread clears what it was waiting to tell you: the pending
  // notification badge, the muted restorable marker, and any overlay toast for it.
  // 'working' is ongoing-turn state, not an unseen badge, so it keeps spinning.
  const clearThreadBadges = useCallback((tabId: string) => {
    const current = stateRef.current.tabs.find(t => t.id === tabId)?.notification;
    if (current !== 'working') stateRef.current.setTabNotification(tabId, undefined);
    stateRef.current.clearTabRestorable(tabId);
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
    // Activating a restorable tab is what resumes its Claude session (the Terminal's
    // activeTab effect injects `claude --resume`), so the badges go now.
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
      primaryLabel: displayTitle(tab?.title || projectName),
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

  const handlePtyExit = useCallback((tabId: string) => {
    state.closeTab(tabId);
  }, [state.closeTab]);

  // Flush a synchronous save on window close, the debounced save's pending timer is
  // cleared on unmount, so the last <2s of changes (e.g. a fresh cwd) would be lost.
  useEffect(() => {
    const flush = () => {
      const s = stateRef.current;
      if (!s.tabs.length) return;
      const data = serializeSession(s.tabs, s.groups, s.activeTabId);
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

  // The clock behind the relative times on Home and the project page. It runs
  // only while one of those screens is open, and is set once on entry so a screen
  // opened after a long spell in the workspace never shows a stale "5m".
  useEffect(() => {
    if (screen === 'workspace') return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(id);
  }, [screen, screenSeq]);

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

  // A project page whose project was deleted (from its own menu, say) has nothing
  // left to show, so it falls back to Home.
  useEffect(() => {
    if (!initialized || screen !== 'project') return;
    if (!projectPageId || !state.groups.some(g => g.id === projectPageId)) goScreen('home');
  }, [initialized, screen, projectPageId, state.groups, goScreen]);

  const tabInfos = state.tabs.map(t => ({ id: t.id, shellId: t.shellId, cwd: t.cwd, fontSize: t.fontSize, claudeSessionId: t.claudeSessionId, claudeCwd: t.claudeCwd }));

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
          threadMenu={tab => buildThreadMenu(tab, state.groups, {
            open: () => openThreadInWorkspace(tab.id),
            moveToGroup: id => (id ? state.addToGroup(tab.id, id) : state.removeFromGroup(tab.id)),
            close: () => state.closeTab(tab.id),
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
          onClose={state.closeTab}
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
            actions={activeTab ? {
              open: () => state.activateTab(activeTab.id),
              moveToGroup: (id) => id ? state.addToGroup(activeTab.id, id) : state.removeFromGroup(activeTab.id),
              close: () => state.closeTab(activeTab.id),
              openProjectPage: activeTab.groupId ? () => goScreen('project', activeTab.groupId) : undefined,
            } : undefined}
          />
          {initialized && (
            <TerminalArea
              tabs={tabInfos}
              activeTabId={state.activeTabId}
              visible={screen === 'workspace'}
              onTitleChange={state.renameTab}
              onCwdChange={state.updateTabCwd}
              onNotification={handleNotification}
              onUserInput={handleUserInput}
              onOutput={handleOutput}
              onFontSizeChange={state.setTabFontSize}
              onExit={handlePtyExit}
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

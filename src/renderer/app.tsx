import React, { useState, useCallback, useEffect, useRef } from 'react';
import { SidePanel } from './components/SidePanel';
import { TerminalArea } from './components/Terminal';
import { useTabState } from './hooks/useTabState';
import { TabNotification } from './components/TabBar/types';
import { onTitle, onOutput, onTick, onInterrupt, initTiming, TabTiming } from './spinnerState';
import logoUrl from '../../assets/icon-256.png';

let toastCounter = 0;

// 'working' is intentionally absent — it's a sidebar-only spinner and never toasts.
const TOAST_MESSAGES: Record<Exclude<TabNotification, 'working'>, string> = {
  done:       'Response complete',
  attention:  'Needs permission',
  background: 'Background tasks running',
  compacting: 'Compacting context…',
};

export function App() {
  const state = useTabState();
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [shells, setShells] = useState<{ id: string; name: string }[]>([]);
  const [initialized, setInitialized] = useState(false);

  const stateRef = useRef(state);
  stateRef.current = state;
  const panelRef = useRef(panelCollapsed);
  panelRef.current = panelCollapsed;

  // Per-tab timing for the working-spinner state machine (see spinnerState.ts).
  // Lives in a ref — high-frequency PTY-output updates must never trigger a render.
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
      if (saved && saved.tabs?.length > 0) {
        state.restoreSession(saved);
      } else {
        state.addTab();
      }
      setInitialized(true);
    });
  }, []);

  // Auto-save session (2s debounce after any state change)
  useEffect(() => {
    if (!initialized || state.tabs.length === 0) return;
    const timer = setTimeout(() => {
      const data = {
        tabs: state.tabs.map(t => ({
          id: t.id, title: t.title, groupId: t.groupId,
          shellId: t.shellId, cwd: t.cwd, fontSize: t.fontSize,
          claudeSessionId: t.claudeSessionId, claudeCwd: t.claudeCwd,
        })),
        groups: state.groups,
        activeTabId: state.activeTabId,
      };
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
          s.addTab();
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

  const handleActivate = useCallback((tabId: string) => {
    // Ignore clicks for tabs that no longer exist (closed tab, or the one-time
    // setup toast's sentinel tabId) — just dismiss it; don't blank the view.
    if (!stateRef.current.tabs.some(t => t.id === tabId)) {
      window.afterterm.notify.dismissTab(tabId);
      return;
    }
    state.setActiveTabId(tabId);
    // Activating a restorable tab is what resumes its Claude session (the Terminal's
    // activeTab effect injects `claude --resume`), so drop the muted ✳ marker now.
    state.clearTabRestorable(tabId);
    // 'working' is ongoing-turn state, not an unseen badge — keep it spinning even
    // when you open the tab. Only clear the "you-haven't-seen-it" notifications.
    const current = stateRef.current.tabs.find(t => t.id === tabId)?.notification;
    if (current !== 'working') {
      state.setTabNotification(tabId, undefined);
    }
    window.afterterm.notify.dismissTab(tabId);
  }, [state.setActiveTabId, state.setTabNotification, state.clearTabRestorable]);

  const handleNotification = useCallback((tabId: string, type: TabNotification | undefined, projectName: string) => {
    // Route the title through the spinner state machine. An undecorated title (type
    // undefined) is a no-op here — `working` is cleared by output silence, not by a
    // plain title (see spinnerState.ts / docs/bugs.md), so it can't stop the spinner.
    const now = Date.now();
    const timing = getTiming(tabId, now);
    const cur = stateRef.current.tabs.find(t => t.id === tabId)?.notification;
    applyNotif(tabId, cur, onTitle(cur, type, timing, now));

    if (!type) return;
    // Working indicator is sidebar-only — no toast while Claude is mid-turn
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
      primaryLabel: group?.label ?? (tab?.title || projectName),
      secondaryLabel: group ? (tab?.title || projectName) : undefined,
      message: TOAST_MESSAGES[type],
    });
  }, [state.setTabNotification]);

  // Typing into a terminal (e.g. interrupting Claude with Esc / Ctrl+C) ends the
  // working turn from afterterm's view — clear the spinner. Leaves other notifs alone.
  const handleUserInput = useCallback((tabId: string) => {
    const cur = stateRef.current.tabs.find(t => t.id === tabId)?.notification;
    applyNotif(tabId, cur, onInterrupt(cur));
  }, [state.setTabNotification]);

  // Every PTY output chunk. Refreshes the tab's silence clock and, if the tab was
  // paused at a permission prompt / compaction, re-arms `working` once Claude's
  // output resumes (see spinnerState.ts). Must stay cheap — no render unless the
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

  // Flush a synchronous save on window close — the debounced save's pending timer is
  // cleared on unmount, so the last <2s of changes (e.g. a fresh cwd) would be lost.
  useEffect(() => {
    const flush = () => {
      const s = stateRef.current;
      if (!s.tabs.length) return;
      const data = {
        tabs: s.tabs.map(t => ({
          id: t.id, title: t.title, groupId: t.groupId, shellId: t.shellId, cwd: t.cwd, fontSize: t.fontSize,
          claudeSessionId: t.claudeSessionId, claudeCwd: t.claudeCwd,
        })),
        groups: s.groups,
        activeTabId: s.activeTabId,
      };
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

  const tabInfos = state.tabs.map(t => ({ id: t.id, shellId: t.shellId, cwd: t.cwd, fontSize: t.fontSize, claudeSessionId: t.claudeSessionId, claudeCwd: t.claudeCwd }));

  return (
    <div className="app">
      <div className="titlebar-drag">
        <div className="titlebar-brand">
          <img className="titlebar-logo" src={logoUrl} alt="" />
          <span className="titlebar-name">afterterm</span>
          <span className="titlebar-version">v{window.afterterm.appVersion}</span>
        </div>
      </div>
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
        onCreateGroup={(t1, t2) => state.createGroup(t1, t2)}
        onCreateProjectGroup={(draft, openTerminal) => state.createConfiguredGroup(draft, openTerminal)}
        onUpdateGroup={state.updateGroup}
        onAddToGroup={state.addToGroup}
        onRemoveFromGroup={state.removeFromGroup}
        onRenameGroup={state.renameGroup}
        onSetGroupColor={state.setGroupColor}
        onToggleGroupCollapse={state.toggleGroupCollapse}
        onDeleteGroup={state.deleteGroup}
        onMoveTab={state.moveTab}
        onMoveGroup={state.moveGroup}
        onMoveGroupAfterGroup={state.moveGroupAfterGroup}
      />

      <div className="terminal-area">
        {panelCollapsed && (
          <button
            className="panel-reopen-btn"
            onClick={() => setPanelCollapsed(false)}
            title="Open terminals panel"
          >
            ›
          </button>
        )}
        {initialized && (
          <TerminalArea
            tabs={tabInfos}
            activeTabId={state.activeTabId}
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
  );
}

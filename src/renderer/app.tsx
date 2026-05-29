import React, { useState, useCallback, useEffect, useRef } from 'react';
import { SidePanel } from './components/SidePanel';
import { TerminalArea } from './components/Terminal';
import { useTabState } from './hooks/useTabState';
import { TabNotification } from './components/TabBar/types';

let toastCounter = 0;

const TOAST_MESSAGES: Record<TabNotification, string> = {
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
          shellId: t.shellId, cwd: t.cwd,
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

  const handleActivate = useCallback((tabId: string) => {
    state.setActiveTabId(tabId);
    // 'working' is ongoing-turn state, not an unseen badge — keep it spinning even
    // when you open the tab. Only clear the "you-haven't-seen-it" notifications.
    const current = stateRef.current.tabs.find(t => t.id === tabId)?.notification;
    if (current !== 'working') {
      state.setTabNotification(tabId, undefined);
    }
    window.afterterm.notify.dismissTab(tabId);
  }, [state.setActiveTabId, state.setTabNotification]);

  const handleNotification = useCallback((tabId: string, type: TabNotification | undefined, projectName: string) => {
    if (!type) return;
    state.setTabNotification(tabId, type);
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
    if (stateRef.current.tabs.find(t => t.id === tabId)?.notification === 'working') {
      state.setTabNotification(tabId, undefined);
    }
  }, [state.setTabNotification]);

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
          id: t.id, title: t.title, groupId: t.groupId, shellId: t.shellId, cwd: t.cwd,
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

  const tabInfos = state.tabs.map(t => ({ id: t.id, shellId: t.shellId, cwd: t.cwd }));

  return (
    <div className="app">
      <div className="titlebar-drag" />
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
        onAddToGroup={state.addToGroup}
        onRemoveFromGroup={state.removeFromGroup}
        onRenameGroup={state.renameGroup}
        onSetGroupColor={state.setGroupColor}
        onSetGroupCwd={async (groupId) => {
          const folder = await window.afterterm.dialog.pickFolder();
          if (folder) state.setGroupCwd(groupId, folder);
        }}
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
            onExit={handlePtyExit}
          />
        )}
      </div>
    </div>
  );
}

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { SidePanel } from './components/SidePanel';
import { TerminalArea } from './components/Terminal';
import { useTabState } from './hooks/useTabState';

export function App() {
  const state = useTabState();
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [shells, setShells] = useState<{ id: string; name: string }[]>([]);
  const [initialized, setInitialized] = useState(false);

  // Refs for shortcuts (avoid stale closures)
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
          s.setActiveTabId(s.tabs[(idx + 1) % s.tabs.length].id);
          break;
        }
        case 'prev-tab': {
          if (s.tabs.length < 2) break;
          const idx = s.tabs.findIndex(t => t.id === s.activeTabId);
          s.setActiveTabId(s.tabs[(idx - 1 + s.tabs.length) % s.tabs.length].id);
          break;
        }
        case 'toggle-panel':
          setPanelCollapsed(p => !p);
          break;
      }
    });
  }, []);

  const handlePtyExit = useCallback((tabId: string) => {
    state.closeTab(tabId);
  }, [state.closeTab]);

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
        onActivate={state.setActiveTabId}
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
            onExit={handlePtyExit}
          />
        )}
      </div>
    </div>
  );
}

// The thread menus: two builders, one per place, over shared item helpers.
// buildThreadMenu is the row menu (the sidebar right-click and the project page
// rows); buildHeaderMenu is the main pane header's dots button, for the thread
// already on screen. Neither has an "Open" item: a click on a row already opens
// its thread, and the header's thread is the open one (Aryan, 2026-09-21).
// Sleep and wake are here (Phase 4); still no rename, `/rename` in Claude Code
// is the only rename. Mark as unread/read (Phase 7) is chats only, since a
// shell has no conversation to flag as unlooked-at.
import { Tab, Group } from './components/TabBar/types';
import { MenuItem } from './components/Menu';
import { FolderIcon, IconExplorer, IconTerm, EditorLogo } from './components/Icons';
import { openLocalhostLabel } from './threadView';
import { FOLDER_MISSING_TIP } from './projectMenu';
import type { EditorInfo } from '../editors';

export interface ThreadMenuActions {
  moveToGroup: (groupId: string | undefined) => void; // undefined = General (no project)
  close: () => void;
  sleep: () => void;
  wake: () => void;
  // Mark as unread / Mark as read (chats only; the builders decide which label
  // to show and whether to show either at all).
  setUnread: (unread: boolean) => void;
  // Only passed where there is a screen to go to. A thread with no project has no
  // page to open, so the item stays out of the menu in that case either way.
  openProjectPage?: () => void;
  // Only offered for an awake server (design-02 "Right-click on a thread": "Open
  // localhost:port (servers)"). Absent for a chat, a plain shell, or an asleep
  // server, same conditions the builders check before inserting the item.
  openLocalhost?: () => void;
  // "Open in File Explorer" for the thread's own folder (Phase 9): the folder
  // its Claude session reports for a chat, often a worktree, the shell's cwd
  // otherwise (threadFolder in threadView.ts). Absent when the thread has no
  // folder at all, so the item stays out of the menu; `missing` disables it
  // with the same "Folder not found" tip the project menu uses.
  openInExplorer?: { missing: boolean; open: () => void };
  // "Open in <editor>" for the same folder, one entry per detected editor, the
  // primary first. Only the row menu shows these; the header carries its own
  // editor button right beside the dots. Absent (or no editors) leaves them out.
  openInEditor?: { editors: EditorInfo[]; missing: boolean; open: (editorId: string) => void };
}

// The header's dots menu has no editor entries, so it takes no editor action.
export type HeaderMenuActions = Omit<ThreadMenuActions, 'openInEditor'>;

function sleepOrWakeItem(tab: Tab, actions: HeaderMenuActions): MenuItem {
  return tab.asleep ? { label: 'Wake', onSelect: actions.wake } : { label: 'Sleep', onSelect: actions.sleep };
}

function unreadItems(tab: Tab, actions: HeaderMenuActions): MenuItem[] {
  if (!tab.claudeSessionId) return [];
  return [tab.unread
    ? { label: 'Mark as read', onSelect: () => actions.setUnread(false) }
    : { label: 'Mark as unread', onSelect: () => actions.setUnread(true) }];
}

function moveItem(tab: Tab, groups: Group[], actions: HeaderMenuActions): MenuItem {
  const otherGroups = groups.filter(g => !g.archived && g.id !== tab.groupId);
  const moveItems: MenuItem[] = [
    {
      label: 'General',
      icon: <IconTerm size={16} />,
      disabled: !tab.groupId,
      onSelect: () => actions.moveToGroup(undefined),
    },
    ...otherGroups.map(g => ({
      label: g.label,
      icon: <FolderIcon color={g.color} size={16} icon={g.icon} />,
      onSelect: () => actions.moveToGroup(g.id),
    })),
  ];
  return { label: 'Move to project', submenu: { title: 'Move to', items: moveItems } };
}

function localhostItems(tab: Tab, actions: HeaderMenuActions): MenuItem[] {
  if (tab.asleep || tab.port === undefined || !actions.openLocalhost) return [];
  return [{ label: openLocalhostLabel(tab.port), onSelect: actions.openLocalhost }];
}

function projectPageItems(tab: Tab, actions: HeaderMenuActions): MenuItem[] {
  if (!tab.groupId) return [];
  const openPage = actions.openProjectPage;
  return [openPage
    ? { label: 'Open project page', onSelect: openPage }
    : { label: 'Open project page', disabled: true }];
}

function explorerItems(actions: HeaderMenuActions): MenuItem[] {
  if (!actions.openInExplorer) return [];
  const { missing, open } = actions.openInExplorer;
  return [{
    label: 'Open in File Explorer',
    right: <IconExplorer size={16} />,
    disabled: missing,
    tip: missing ? FOLDER_MISSING_TIP : undefined,
    onSelect: open,
  }];
}

function editorItems(actions: ThreadMenuActions): MenuItem[] {
  if (!actions.openInEditor) return [];
  const { editors, missing, open } = actions.openInEditor;
  return editors.map(editor => ({
    label: `Open in ${editor.name}`,
    right: <EditorLogo product={editor.product} size={16} />,
    disabled: missing,
    tip: missing ? FOLDER_MISSING_TIP : undefined,
    onSelect: () => open(editor.id),
  }));
}

function closeItem(actions: HeaderMenuActions): MenuItem {
  return { label: 'Close', danger: true, onSelect: actions.close };
}

// The row menu: the sidebar right-click and the project page rows.
export function buildThreadMenu(tab: Tab, groups: Group[], actions: ThreadMenuActions): MenuItem[] {
  return [
    sleepOrWakeItem(tab, actions),
    ...unreadItems(tab, actions),
    moveItem(tab, groups, actions),
    ...localhostItems(tab, actions),
    ...projectPageItems(tab, actions),
    ...explorerItems(actions),
    ...editorItems(actions),
    closeItem(actions),
  ];
}

// The header's dots menu, for the thread on screen: no editor entries, since
// the editor button sits beside the dots.
export function buildHeaderMenu(tab: Tab, groups: Group[], actions: HeaderMenuActions): MenuItem[] {
  return [
    sleepOrWakeItem(tab, actions),
    ...unreadItems(tab, actions),
    moveItem(tab, groups, actions),
    ...localhostItems(tab, actions),
    ...projectPageItems(tab, actions),
    ...explorerItems(actions),
    closeItem(actions),
  ];
}

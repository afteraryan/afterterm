// The one thread menu, shared by the sidebar right-click and the main pane
// header's dots button. Sleep and wake are here now (Phase 4); still no
// rename, `/rename` in Claude Code is the only rename.
import { Tab, Group } from './components/TabBar/types';
import { MenuItem } from './components/Menu';
import { FolderIcon, IconTerm } from './components/Icons';

export interface ThreadMenuActions {
  open: () => void;
  moveToGroup: (groupId: string | undefined) => void; // undefined = General (no project)
  close: () => void;
  sleep: () => void;
  wake: () => void;
  // Only passed where there is a screen to go to. A thread with no project has no
  // page to open, so the item stays out of the menu in that case either way.
  openProjectPage?: () => void;
}

export function buildThreadMenu(tab: Tab, groups: Group[], actions: ThreadMenuActions): MenuItem[] {
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
      icon: <FolderIcon color={g.color} size={16} />,
      onSelect: () => actions.moveToGroup(g.id),
    })),
  ];

  const items: MenuItem[] = [
    { label: 'Open', onSelect: actions.open },
    tab.asleep ? { label: 'Wake', onSelect: actions.wake } : { label: 'Sleep', onSelect: actions.sleep },
    { label: 'Move to project', submenu: { title: 'Move to', items: moveItems } },
  ];

  if (tab.groupId) {
    const openPage = actions.openProjectPage;
    items.push(openPage
      ? { label: 'Open project page', onSelect: openPage }
      : { label: 'Open project page', disabled: true });
  }

  items.push({ label: 'Close', danger: true, onSelect: actions.close });

  return items;
}

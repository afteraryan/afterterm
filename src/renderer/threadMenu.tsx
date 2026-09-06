// The one thread menu, shared by the sidebar right-click and the main pane
// header's dots button. No rename, no sleep, no wake: those arrive later
// (Tab.asleep exists in the data model but nothing sets it true yet).
import { Tab, Group } from './components/TabBar/types';
import { MenuItem } from './components/Menu';
import { FolderIcon, IconTerm } from './components/Icons';

export interface ThreadMenuActions {
  open: () => void;
  moveToGroup: (groupId: string | undefined) => void; // undefined = General (no project)
  close: () => void;
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
    { label: 'Move to project', submenu: { title: 'Move to', items: moveItems } },
  ];

  if (tab.groupId) {
    items.push({
      label: 'Open project page',
      disabled: true,
      tip: 'Project page arrives in Phase 2',
    });
  }

  items.push({ label: 'Close', danger: true, onSelect: actions.close });

  return items;
}

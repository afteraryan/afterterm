// The one project menu, shared by every place a project can be right-clicked:
// Home's pinned cards and project rows (including the archived list), and the
// project page header. Built the same way threadMenu.tsx builds the one
// thread menu: a pure function from data to MenuItem[], so every call site
// renders it through the same <Menu>.
import React from 'react';
import { Group } from './components/TabBar/types';
import { MenuItem } from './components/Menu';
import { IconExplorer, EditorLogo } from './components/Icons';
import type { EditorInfo } from '../editors';

const FOLDER_MISSING_TIP = 'Folder not found';

export interface ProjectActions {
  open: (groupId: string) => void; // workspace on that project
  newThread: (groupId: string) => void; // creates a thread directly in the project's shell
  togglePin: (groupId: string) => void;
  openPage: (groupId: string) => void;
  openInExplorer: (groupId: string) => void;
  openInEditor: (groupId: string, editorId: string) => void;
  chooseEditor: () => void;
  edit: (groupId: string) => void;
  archive: (groupId: string) => void;
  restore: (groupId: string) => void;
  deleteProject: (groupId: string) => void;
}

export interface ProjectMenuContext {
  editors: EditorInfo[];
  folderMissing: boolean;
}

export function buildProjectMenu(group: Group, ctx: ProjectMenuContext, actions: ProjectActions): MenuItem[] {
  if (group.archived) {
    return [
      { label: 'Restore', onSelect: () => actions.restore(group.id) },
      { label: 'Delete project', danger: true, onSelect: () => actions.deleteProject(group.id) },
    ];
  }

  const items: MenuItem[] = [
    { label: 'Open', onSelect: () => actions.open(group.id) },
    { label: 'New thread here', onSelect: () => actions.newThread(group.id) },
    { label: group.pinned ? 'Unpin' : 'Pin', onSelect: () => actions.togglePin(group.id) },
    { label: 'Open project page', onSelect: () => actions.openPage(group.id) },
  ];

  // Explorer and editor entries only make sense for a project that has a
  // folder at all; with no cwd there is nothing to open in either.
  if (group.cwd) {
    items.push({
      label: 'Open in File Explorer',
      right: <IconExplorer size={16} />,
      disabled: ctx.folderMissing,
      tip: ctx.folderMissing ? FOLDER_MISSING_TIP : undefined,
      onSelect: () => actions.openInExplorer(group.id),
    });

    if (ctx.editors.length > 0) {
      const [primary, ...rest] = ctx.editors;
      items.push({
        label: `Open in ${primary.name}`,
        right: <EditorLogo product={primary.product} size={16} />,
        disabled: ctx.folderMissing,
        tip: ctx.folderMissing ? FOLDER_MISSING_TIP : undefined,
        onSelect: () => actions.openInEditor(group.id, primary.id),
      });
      for (const editor of rest) {
        items.push({
          label: `Open in ${editor.name}`,
          right: <EditorLogo product={editor.product} size={16} />,
          disabled: ctx.folderMissing,
          tip: ctx.folderMissing ? FOLDER_MISSING_TIP : undefined,
          onSelect: () => actions.openInEditor(group.id, editor.id),
        });
      }
    } else {
      items.push({ label: 'Choose editor...', onSelect: () => actions.chooseEditor() });
    }
  }

  items.push(
    { label: 'Edit project', onSelect: () => actions.edit(group.id) },
    { label: 'Archive', onSelect: () => actions.archive(group.id) },
    { label: 'Delete project', danger: true, onSelect: () => actions.deleteProject(group.id) },
  );

  return items;
}

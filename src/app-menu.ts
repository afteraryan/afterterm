// The application menu (AFT-26). Pure: plain menu templates, no Electron calls,
// so the rule can be unit-tested in plain Node (node src/app-menu.test.ts).
//
// Electron gives every app a default menu when the app sets none, and the window
// keeps its keys even with the menu bar hidden. Its View menu holds Reload
// (Ctrl+R) and Force Reload (Ctrl+Shift+R). A reload restarts the window's page,
// which restores session.json, so every thread came back asleep and the app
// landed on Home: one key press stopped every shell, server and chat. A key only
// reaches the menu when the page did not use it, so Ctrl+R in a terminal went to
// the shell, but Ctrl+Shift+R (which the terminal ignores) and Ctrl+R anywhere
// outside a terminal reloaded the window.
//
// This is Electron's default Windows menu without those two items: every other
// key it answered (copy and paste in text fields, the zoom keys, F11, Ctrl+Shift+I
// for the developer tools, Ctrl+M and Ctrl+W) keeps working as before. The keys
// are not swallowed in main's before-input-event instead, because the terminal
// needs Ctrl+R: it is reverse history search in PowerShell and bash. F5 was never
// in the menu.
import type { MenuItemConstructorOptions } from 'electron';

// The two roles that reload the window's page. Never in afterterm's menu.
export const RELOAD_ROLES: readonly string[] = ['reload', 'forceReload'];

export function appMenuTemplate(): MenuItemConstructorOptions[] {
  return [
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
}

// Every role in a template, submenus included, lower-cased the way Electron
// compares roles ('forceReload' and 'forcereload' are the same role).
export function menuRoles(template: MenuItemConstructorOptions[]): string[] {
  const roles: string[] = [];
  const walk = (items: MenuItemConstructorOptions[]) => {
    for (const item of items) {
      if (item.role) roles.push(item.role.toLowerCase());
      if (Array.isArray(item.submenu)) walk(item.submenu);
    }
  };
  walk(template);
  return roles;
}

// Whether a template holds anything that reloads the window's page.
export function hasReload(template: MenuItemConstructorOptions[]): boolean {
  const reload = RELOAD_ROLES.map(r => r.toLowerCase());
  return menuRoles(template).some(r => reload.includes(r));
}

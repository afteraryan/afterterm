// Unit tests for app-menu.ts. Run directly on Node 24+ (strips types):
//   node src/app-menu.test.ts
// Exits 0 if all pass, 1 on any failure.

import { appMenuTemplate, hasReload, menuRoles } from './app-menu.ts';
import type { MenuItemConstructorOptions } from 'electron';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}
const show = (v: unknown) => JSON.stringify(v);

console.log('\napp-menu: no key reloads the window (AFT-26)\n');
{
  const t = appMenuTemplate();
  const roles = menuRoles(t);
  check('afterterm\'s menu has no Reload and no Force Reload', !hasReload(t), show(roles));
  check('no role in it reloads, by any spelling', !roles.includes('reload') && !roles.includes('forcereload'), show(roles));
  check('no item carries a key of its own (keys come only from the roles)',
    JSON.stringify(t).indexOf('accelerator') === -1);
}

console.log('\napp-menu: every other key of Electron\'s default menu is kept\n');
{
  const roles = menuRoles(appMenuTemplate());
  for (const role of ['filemenu', 'editmenu', 'windowmenu', 'toggledevtools', 'resetzoom', 'zoomin', 'zoomout', 'togglefullscreen']) {
    check(`keeps ${role}`, roles.includes(role), show(roles));
  }
}

console.log('\napp-menu: hasReload finds a reload wherever it is\n');
{
  const top: MenuItemConstructorOptions[] = [{ role: 'reload' }];
  const nested: MenuItemConstructorOptions[] = [{ label: 'View', submenu: [{ role: 'zoomIn' }, { role: 'forceReload' }] }];
  const lower: MenuItemConstructorOptions[] = [{ label: 'View', submenu: [{ role: 'forcereload' as MenuItemConstructorOptions['role'] }] }];
  const none: MenuItemConstructorOptions[] = [{ role: 'editMenu' }, { label: 'View', submenu: [{ role: 'zoomIn' }] }];
  check('at the top level', hasReload(top));
  check('inside a submenu', hasReload(nested));
  check('spelled in lower case', hasReload(lower));
  check('not in a menu without one', !hasReload(none));
  check('not in an empty menu', !hasReload([]));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

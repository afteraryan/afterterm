// Drive the harness-launched afterterm over the Chrome DevTools Protocol.
//
//   node scripts/agent-harness/drive.mjs <command> [args] [--port <n>] [--data-dir <dir>]
//
// Commands:
//   targets                       list DevTools targets
//   bounds                        main window bounds (JSON) and which display holds it
//   screenshot <out.png>          PNG of the main window's web content
//   eval "<js expression>"        Runtime.evaluate, promises awaited, JSON result
//   dom "<css selector>" [--html] matches: count plus trimmed innerText (or outerHTML)
//   click "<css selector>" [index]     real mouse click on the element's centre
//   rightclick "<css selector>" [index]
//   type "<text>"                 insert text at the focused element
//   key <Enter|Escape|Tab|...> [--ctrl] [--shift] [--alt]
//   sidebar                       the rendered sidebar as a tree
//
// Every command reads latest.json (written by launch.mjs) for the port unless
// --port or --data-dir is given.

import fs from 'node:fs';
import path from 'node:path';
import {
  parseArgs, loadRun, resolvePort, listTargets, pickMainPage, Cdp, evaluate,
  listDisplays, displayContaining, listWindows, pidListeningOn, sleep,
} from './lib.mjs';

// ─── Sidebar selectors (keep in one place; later phases update them here) ─────
// Read from src/renderer/components/SidePanel/index.tsx and SidePanel.css.
const SEL = {
  panel: '.side-panel',
  panelCollapsedClass: 'collapsed',
  list: '.panel-list',
  groupSection: '.group-section',
  groupHeader: '.group-header',
  groupName: '.group-name',
  groupCwd: '.group-cwd',
  groupCount: '.group-count',
  groupBadge: '.group-notif-badge',
  groupNameInput: '.group-name-input',
  tabRow: '.tab-row',
  tabTitle: '.tab-row-title',
  tabActiveClass: 'active',
  tabRestorable: '.tab-restorable-star',
  tabWorkingDot: '.tab-notif-working',
  shelf: '.project-shelf',
  shelfRow: '.shelf-row',
  shelfName: '.shelf-name',
  shelfCwd: '.shelf-cwd',
};

// Windows virtual-key codes for the keys an agent is likely to press.
const KEYS = {
  Enter: { code: 'Enter', vk: 13, text: '\r' },
  Escape: { code: 'Escape', vk: 27 },
  Tab: { code: 'Tab', vk: 9 },
  Backspace: { code: 'Backspace', vk: 8 },
  Delete: { code: 'Delete', vk: 46 },
  Space: { code: 'Space', vk: 32, text: ' ', key: ' ' },
  ArrowUp: { code: 'ArrowUp', vk: 38 },
  ArrowDown: { code: 'ArrowDown', vk: 40 },
  ArrowLeft: { code: 'ArrowLeft', vk: 37 },
  ArrowRight: { code: 'ArrowRight', vk: 39 },
  Home: { code: 'Home', vk: 36 },
  End: { code: 'End', vk: 35 },
  PageUp: { code: 'PageUp', vk: 33 },
  PageDown: { code: 'PageDown', vk: 34 },
  F5: { code: 'F5', vk: 116 },
};

const { opts, positional } = parseArgs(process.argv.slice(2));
const [command, ...args] = positional;

if (!command || opts.help) {
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(0, 19).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(command ? 0 : 1);
}

class DriveError extends Error {}

let run = null;
let port;
let page = null;
let cdp = null;

// Errors are thrown, not process.exit()ed, so the WebSocket closes cleanly first
// (exiting with a socket mid-close trips a libuv assertion on Windows).
try {
  try { run = loadRun(opts); } catch (e) { if (!opts.port) throw new DriveError(e.message); }
  port = resolvePort(opts, run);

  let targets;
  try { targets = await listTargets(port); } catch (e) { throw new DriveError(`no DevTools endpoint on port ${port} (${e.message}); is the harness running?`); }

  if (command === 'targets') {
    for (const t of targets) console.log(`${t.type.padEnd(8)} ${t.id}  ${t.url}`);
  } else {
    page = pickMainPage(targets);
    if (!page) throw new DriveError(`no main-window page target among: ${targets.map(t => `${t.type} ${t.url}`).join('; ')}`);
    cdp = await Cdp.connect(page.webSocketDebuggerUrl);
    switch (command) {
      case 'bounds': await cmdBounds(); break;
      case 'screenshot': await cmdScreenshot(args[0]); break;
      case 'eval': await cmdEval(args.join(' ')); break;
      case 'dom': await cmdDom(args[0]); break;
      case 'click': await cmdClick(args[0], args[1], 'left'); break;
      case 'rightclick': await cmdClick(args[0], args[1], 'right'); break;
      case 'type': await cmdType(args.join(' ')); break;
      case 'key': await cmdKey(args[0]); break;
      case 'sidebar': await cmdSidebar(); break;
      default: throw new DriveError(`unknown command: ${command}`);
    }
  }
} catch (e) {
  console.error(`drive: ${e.message}`);
  process.exitCode = 1;
} finally {
  if (cdp) cdp.close();
}

// ─── Commands ─────────────────────────────────────────────────────────────────

async function cmdBounds() {
  // Two witnesses. Electron's DevTools endpoint does not implement
  // Browser.getWindowForTarget, so the page reports its own screen position
  // (window.screenX/Y, in Chromium's DIP layout, where a secondary display is
  // re-positioned by scale factor) and the OS reports the electron process's
  // visible top-level windows in physical pixels (GetWindowRect, same space as
  // listDisplays() and screenshot-display.ps1). The OS witness is the one to
  // trust for "which monitor". The electron pid is re-resolved from the port
  // because a main-process edit makes forge restart electron under a new pid.
  const inPage = await evaluate(cdp, '({ x: window.screenX, y: window.screenY, width: window.outerWidth, height: window.outerHeight, devicePixelRatio: window.devicePixelRatio, screen: { availLeft: screen.availLeft, availTop: screen.availTop, width: screen.width, height: screen.height } })');
  let displays = [];
  try { displays = listDisplays(); } catch {}
  let windows = [];
  const electronPid = pidListeningOn(port) ?? run?.electronPid ?? null;
  if (electronPid) { try { windows = listWindows(electronPid); } catch (e) { windows = [{ error: e.message }]; } }
  const centreOf = w => ({ x: w.x + w.width / 2, y: w.y + w.height / 2 });
  const describe = w => {
    const c = centreOf(w);
    const d = displayContaining(displays, c.x, c.y);
    return { ...w, onDisplay: d ? { name: d.name, primary: d.primary } : null };
  };
  console.log(JSON.stringify({
    electronPid,
    os: windows.map(w => (w.error ? w : describe(w))),
    page: { ...inPage, note: 'Chromium DIP layout; compare with os, not with displays' },
    displays,
  }, null, 2));
}

async function cmdScreenshot(out) {
  if (!out) fail('screenshot needs an output path');
  const file = path.resolve(out);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log(file);
}

async function cmdEval(expr) {
  if (!expr) fail('eval needs an expression');
  const value = await evaluate(cdp, expr);
  console.log(value === undefined ? 'undefined' : JSON.stringify(value, null, 2));
}

async function cmdDom(selector) {
  if (!selector) fail('dom needs a selector');
  const html = !!opts.html;
  const rows = await evaluate(cdp, `(() => {
    const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
    return els.map(el => ({
      tag: el.tagName.toLowerCase(),
      className: el.className && typeof el.className === 'string' ? el.className : '',
      text: (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 160),
      html: ${html} ? el.outerHTML : null,
    }));
  })()`);
  console.log(`${rows.length} match(es) for ${selector}`);
  rows.forEach((r, i) => {
    if (html) console.log(`[${i}] ${r.html}`);
    else console.log(`[${i}] <${r.tag}${r.className ? ' class="' + r.className + '"' : ''}> ${r.text}`);
  });
}

async function cmdClick(selector, indexArg, button) {
  if (!selector) fail(`${button === 'right' ? 'rightclick' : 'click'} needs a selector`);
  const index = Number(indexArg ?? 0);
  const rect = await evaluate(cdp, `(() => {
    const els = document.querySelectorAll(${JSON.stringify(selector)});
    const el = els[${index}];
    if (!el) return { count: els.length };
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    return { count: els.length, x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width, height: r.height };
  })()`);
  if (rect.x === undefined) fail(`no element at index ${index} for ${selector} (${rect.count} match(es))`);
  if (rect.width === 0 || rect.height === 0) fail(`element ${index} for ${selector} has no size (hidden?)`);
  const x = Math.round(rect.x);
  const y = Math.round(rect.y);
  // Real input events through Chromium's input pipeline, so React's synthetic
  // handlers, dnd-kit's pointer sensor and context-menu logic all see what a
  // user's mouse would produce.
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: 1 });
  await sleep(50);
  console.log(`${button === 'right' ? 'right-clicked' : 'clicked'} ${selector}[${index}] at (${x}, ${y}) of ${rect.count} match(es)`);
}

async function cmdType(text) {
  if (!text) fail('type needs text');
  await cdp.send('Input.insertText', { text });
  console.log(`typed ${JSON.stringify(text)}`);
}

async function cmdKey(name) {
  if (!name) fail('key needs a key name');
  const spec = KEYS[name] ?? (name.length === 1 ? { code: `Key${name.toUpperCase()}`, vk: name.toUpperCase().charCodeAt(0), text: name, key: name } : null);
  if (!spec) fail(`unknown key ${name}; known: ${Object.keys(KEYS).join(', ')} or a single character`);
  // CDP modifier bitmask: Alt=1, Ctrl=2, Meta=4, Shift=8.
  const modifiers = (opts.alt ? 1 : 0) | (opts.ctrl ? 2 : 0) | (opts.shift ? 8 : 0);
  const base = {
    key: spec.key ?? name,
    code: spec.code,
    windowsVirtualKeyCode: spec.vk,
    nativeVirtualKeyCode: spec.vk,
    modifiers,
  };
  await cdp.send('Input.dispatchKeyEvent', { ...base, type: spec.text && !modifiers ? 'keyDown' : 'rawKeyDown', text: modifiers ? undefined : spec.text });
  await cdp.send('Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
  console.log(`pressed ${[opts.ctrl && 'Ctrl', opts.shift && 'Shift', opts.alt && 'Alt', name].filter(Boolean).join('+')}`);
}

async function cmdSidebar() {
  const tree = await evaluate(cdp, `((S) => {
    const text = el => (el ? (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim() : '');
    const panel = document.querySelector(S.panel);
    if (!panel) return { present: false };
    const tabInfo = row => ({
      title: text(row.querySelector(S.tabTitle)),
      active: row.classList.contains(S.tabActiveClass),
      restorable: !!row.querySelector(S.tabRestorable),
      working: !!row.querySelector(S.tabWorkingDot),
      notif: (Array.from(row.classList).find(c => c.startsWith('notif-')) || '').replace('notif-', '') || null,
    });
    const items = [];
    const list = panel.querySelector(S.list);
    for (const child of list ? Array.from(list.children) : []) {
      if (child.matches(S.tabRow)) { items.push({ kind: 'tab', ...tabInfo(child) }); continue; }
      if (child.matches(S.groupSection)) {
        const header = child.querySelector(S.groupHeader);
        const tabs = Array.from(child.querySelectorAll(S.tabRow)).map(tabInfo);
        const countEl = header && header.querySelector(S.groupCount);
        items.push({
          kind: 'group',
          label: text(header && header.querySelector(S.groupName)) || (header && header.querySelector(S.groupNameInput) ? header.querySelector(S.groupNameInput).value + ' (renaming)' : ''),
          cwd: text(header && header.querySelector(S.groupCwd)) || null,
          collapsed: !!countEl,
          count: countEl ? Number(text(countEl)) : tabs.length,
          badge: text(header && header.querySelector(S.groupBadge)) || null,
          tabs,
        });
        continue;
      }
      items.push({ kind: 'other', className: child.className, text: text(child).slice(0, 80) });
    }
    const shelf = panel.querySelector(S.shelf);
    const shelfRows = shelf ? Array.from(shelf.querySelectorAll(S.shelfRow)).map(r => ({
      label: text(r.querySelector(S.shelfName)),
      cwd: text(r.querySelector(S.shelfCwd)) || null,
    })) : null;
    return { present: true, collapsed: panel.classList.contains(S.panelCollapsedClass), items, shelf: shelfRows };
  })(${JSON.stringify(SEL)})`);

  if (!tree.present) { console.log(`(no ${SEL.panel} in the DOM)`); return; }
  console.log(`side-panel${tree.collapsed ? ' (collapsed)' : ''}`);
  const tabLine = (t, indent) => `${indent}- ${t.active ? '* ' : ''}"${t.title}"${t.restorable ? ' [restorable]' : ''}${t.working ? ' [working]' : ''}${t.notif ? ` [${t.notif}]` : ''}`;
  for (const item of tree.items) {
    if (item.kind === 'tab') console.log(tabLine(item, '  '));
    else if (item.kind === 'group') {
      console.log(`  [group] ${item.label}${item.cwd ? ` (${item.cwd})` : ''}  tabs=${item.count}${item.collapsed ? ' collapsed' : ''}${item.badge ? ` badge=${item.badge}` : ''}`);
      for (const t of item.tabs) console.log(tabLine(t, '    '));
    } else console.log(`  [${item.className}] ${item.text}`);
  }
  if (tree.shelf) {
    console.log(`  shelf: ${tree.shelf.length} project(s)`);
    for (const s of tree.shelf) console.log(`    [shelf] ${s.label}${s.cwd ? ` (${s.cwd})` : ''}`);
  }
}

function fail(msg) {
  throw new DriveError(msg);
}

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
  section: '.sec',
  sectionLabel: '.lbl',
  projectWrap: '.pjw',
  projectRow: '.pj',
  projectName: '.n',
  projectRename: '.pj-rename',
  pillNeed: '.sig.need',
  pillRun: '.sig.run',
  threadListWrap: '.tlw',
  threadListClosedClass: 'closed',
  threadRow: '.th',
  threadName: '.n',
  threadSelectedClass: 'sel',
  threadRestorableClass: 'restorable',
  threadClose: '.xb',
  stateIcon: '[data-state]',
  showMore: '.thmore',
  rail: '.rail',
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

    const threadInfo = row => {
      const icon = row.querySelector(S.stateIcon);
      return {
        title: text(row.querySelector(S.threadName)),
        active: row.classList.contains(S.threadSelectedClass),
        kind: row.dataset.kind || null,
        state: icon ? icon.getAttribute('data-state') : 'quiet',
        restorable: row.classList.contains(S.threadRestorableClass),
        close: !!row.querySelector(S.threadClose),
      };
    };

    const threadsUnder = wrap => Array.from(wrap.querySelectorAll(S.threadRow)).map(threadInfo);

    const sections = Array.from(panel.querySelectorAll(S.section)).map(sec => {
      const label = text(sec.querySelector(S.sectionLabel));
      const projects = Array.from(sec.querySelectorAll(S.projectWrap)).map(w => {
        const row = w.querySelector(S.projectRow);
        const list = w.querySelector(S.threadListWrap);
        // A collapsed project keeps its fold button in the DOM (inert); only report it when the list is open.
        const more = list && !list.classList.contains(S.threadListClosedClass) ? w.querySelector(S.showMore) : null;
        return {
          label: text(row && row.querySelector(S.projectName))
            || (row && row.querySelector(S.projectRename) ? row.querySelector(S.projectRename).value + ' (renaming)' : ''),
          collapsed: !!(row && row.dataset.collapsed),
          threads: row ? Number(row.dataset.threads || 0) : 0,
          need: text(row && row.querySelector(S.pillNeed)) || null,
          run: text(row && row.querySelector(S.pillRun)) || null,
          more: text(more) || null,
          rows: list && !list.classList.contains(S.threadListClosedClass) ? threadsUnder(list) : [],
        };
      });
      // Threads that belong to no project sit directly in the section (General).
      const loose = Array.from(sec.children)
        .filter(c => c.matches && c.matches(S.threadRow))
        .map(threadInfo);
      const looseMore = sec.querySelector(':scope > ' + S.showMore);
      return { label, projects, loose, looseMore: text(looseMore) || null };
    });

    return {
      present: true,
      collapsed: panel.classList.contains(S.panelCollapsedClass),
      rail: !!panel.querySelector(S.rail),
      sections,
    };
  })(${JSON.stringify(SEL)})`);

  if (!tree.present) { console.log(`(no ${SEL.panel} in the DOM)`); return; }
  console.log(`side-panel${tree.collapsed ? ' (collapsed, rail only)' : ''}`);
  const threadLine = (t, indent) => `${indent}- ${t.active ? '* ' : ''}"${t.title}" [${t.kind || '?'}/${t.state || 'quiet'}]${t.close ? ' [x]' : ''}${t.restorable ? ' [restorable]' : ''}`;
  for (const sec of tree.sections) {
    console.log(`  ${sec.label}`);
    for (const t of sec.loose) console.log(threadLine(t, '    '));
    if (sec.looseMore) console.log(`    (${sec.looseMore})`);
    for (const p of sec.projects) {
      const pills = [p.need ? `need=${p.need}` : null, p.run ? `run=${p.run}` : null].filter(Boolean).join(' ');
      console.log(`    [project] ${p.label}  threads=${p.threads}${p.collapsed ? ' collapsed' : ''}${pills ? '  ' + pills : ''}`);
      for (const t of p.rows) console.log(threadLine(t, '      '));
      if (p.more) console.log(`      (${p.more})`);
    }
  }
}

function fail(msg) {
  throw new DriveError(msg);
}

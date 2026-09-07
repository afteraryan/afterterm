// Drive the harness-launched afterterm over the Chrome DevTools Protocol.
//
//   node scripts/agent-harness/drive.mjs <command> [args] [--port <n>] [--data-dir <dir>]
//
// Commands:
//   targets                       list DevTools targets
//   bounds                        main window bounds (JSON) and which display holds it
//   screenshot <out.png> [--window]    PNG of the main window's web content; --window
//                                  captures the whole OS window instead, through PrintWindow,
//                                  so it still works while the window is occluded
//   eval "<js expression>"        Runtime.evaluate, promises awaited, JSON result
//   dom "<css selector>" [--html] matches: count plus trimmed innerText (or outerHTML)
//   click "<css selector>" [index]     real mouse click on the element's centre
//   rightclick "<css selector>" [index]
//   hover "<css selector>" [index] [--wait <ms>]   move the pointer onto the element's centre
//                                  and hold it there; --wait pauses after the move (a hover card
//                                  needs 350ms to appear)
//   unhover                       move the pointer to (2, 2) of the viewport, off every hover target
//   drag "<from selector>" [fromIndex] "<to selector>" [toIndex] [--steps N] [--hold-ms N]
//                                  press at the source centre, step to the target centre
//                                  (default 12 steps), optional dwell (--hold-ms), then release
//   emulate-media reduce|no-preference|off [--click "<sel>"] [--wait <ms>] [--eval "<js>"] [--screenshot <png>]
//                                  set prefers-reduced-motion for this one session and observe it
//                                  in the same session (the override ends when the command exits)
//   type "<text>"                 insert text at the focused element
//   key <Enter|Escape|Tab|...> [--ctrl] [--shift] [--alt]
//   sidebar                       the rendered sidebar as a tree
//   screen                        which screen is showing plus overlay flags, as JSON
//   home                          the rendered Home screen as a tree
//   project                       the rendered project page as a tree
//   chooser                       the new-thread chooser's rows
//   palette                       the search palette's rows
//   header                        the main pane header as a tree
//   hover-card                    the thread hover card as a tree (or "(no hover card)")
//   pane                           the asleep pane as a tree (data-tab-id, wake button,
//                                  since text, past lines), or "(terminal)" plus whether
//                                  .terminal-instances is hidden when no thread is asleep
//   tail [n]                      last n lines (default 30) of the active tab's xterm
//                                  buffer via window.__afterterm; add --tab <id> for a
//                                  specific tab instead of the active one
//   window bottom|restore|quit|close-dialogs   OS-level window z-order, un-minimise,
//                                  a graceful quit (WM_CLOSE, so the quit flush runs), and
//                                  closing stray native dialogs (e.g. a file picker)
//   record start --out <file.mp4> [--max-width N] [--fps N] [--quality N]
//                                  start recording the page content to video, detached
//   record stop [--out <file.mp4>]     stop the recording (latest one if --out is omitted)
//                                  and stitch it
//   record status                  list recordings for this run and whether they are alive
//
// Every command reads latest.json (written by launch.mjs) for the port unless
// --port or --data-dir is given.

import fs from 'node:fs';
import path from 'node:path';
import {
  REPO_ROOT, LATEST_FILE, parseArgs, loadRun, resolvePort, listTargets, pickMainPage, Cdp, evaluate,
  listDisplays, displayContaining, listWindows, pidListeningOn, pidExists, spawnViaWmi,
  readJson, writeJson, sleep, powershell, DPI_AWARE_PRELUDE,
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
  threadAsleepClass: 'sleep', // Phase 4: replaces threadRestorableClass ('restorable' no longer exists)
  threadClose: '.xb',
  stateIcon: '[data-state]',
  showMore: '.thmore',
  rail: '.rail',

  // Home screen (src/renderer/components/Home/index.tsx, Home.css).
  home: {
    root: '.home',
    dateHeading: 'h1.home-date',
    totNeed: '.home .tot .sig.need',
    totRun: '.home .tot .sig.run',
    lastHere: '.home-lasthere',
    pinnedCard: '.cards .cd',
    name: '.n',
    pillNeed: '.sig.need',
    pillRun: '.sig.run',
    ago: '.ago',
    pinButton: '[data-pin]',
    pinButtonOnClass: 'on',
    projectRow: '.list .pr',
    projectTime: '.t',
    moreProjects: '.more[data-more]',
    archivedToggle: '.more[data-archived]',
    archivedRow: '.pr.archived',
    restoreButton: '[data-restore]',
    nothing: '.home .nothing',
  },

  // Project page (src/renderer/components/ProjectPage/index.tsx, ProjectPage.css).
  project: {
    root: '.proj',
    title: '.ph h1',
    folderLine: '.ph .f',
    action: '.ph .acts [data-action]',
    tab: '.tabs .seg button',
    search: '.srch input',
    row: '.tl[data-tab-id]',
    rowName: '.n',
    rowDetail: '.d',
    rowTime: '.t',
    stateIcon: '[data-state]',
    nothing: '.nothing',
    // Phase 4: History tab rows (closed threads; no state icon, an optional Resume button).
    historyRow: '.tl[data-history-id]',
    resumeButton: '.acts [data-resume]',
  },

  // New-thread chooser (src/renderer/components/NewThreadChooser/index.tsx).
  chooser: {
    root: '.nt',
    input: '.nt input',
    opt: '.nt .opt',
    optName: '.n',
    optTag: '.r',
    hiClass: 'hi',
    shellButton: '.nt .shb',
  },

  // Search palette (src/renderer/components/SearchPalette/index.tsx).
  palette: {
    root: '.pal',
    input: '.pal input',
    item: '.pi',
    itemName: '.n',
    itemMeta: '.m',
    hiClass: 'hi',
    nothing: '.nothing',
    groupLabel: '.gl', // Phase 4: group headers ("Projects", "Threads", "History")
  },

  // Main pane header (src/renderer/components/Header/index.tsx).
  header: {
    root: '.header',
    name: '.header-name',
    metaItem: '.header-meta-item',
    chip: '.header-chip',
    empty: '.header-empty',
  },

  // Thread hover card (Phase 3).
  hoverCard: {
    root: '.hover-card',
    title: '.hn',
    row: 'dd[data-row]',
  },

  // Asleep pane (Phase 4, src/renderer/components/AsleepPane/index.tsx): shown in the
  // main pane instead of the terminal card while the active thread is asleep.
  asleepPane: {
    root: '.asleep-pane',
    wake: '[data-wake]',
    since: '.wakebox .w',
    past: 'pre.past',
  },
  // Phase 4: the terminal host carries this class while the asleep pane covers it.
  terminalHidden: '.terminal-instances.asleep-hidden',
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
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(0, 50).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
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
  } else if (command === 'record') {
    // The recorder is its own detached process with its own CDP session (see
    // record.mjs); this drive.mjs process needs no page connection of its own.
    await cmdRecord(args[0]);
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
      case 'hover': await cmdHover(args[0], args[1]); break;
      case 'unhover': await cmdUnhover(); break;
      case 'drag': await cmdDrag(args); break;
      case 'emulate-media': await cmdEmulateMedia(args[0]); break;
      case 'type': await cmdType(args.join(' ')); break;
      case 'key': await cmdKey(args[0]); break;
      case 'sidebar': await cmdSidebar(); break;
      case 'screen': await cmdScreen(); break;
      case 'home': await cmdHome(); break;
      case 'project': await cmdProject(); break;
      case 'chooser': await cmdChooser(); break;
      case 'palette': await cmdPalette(); break;
      case 'header': await cmdHeader(); break;
      case 'hover-card': await cmdHoverCard(); break;
      case 'pane': await cmdPane(); break;
      case 'tail': await cmdTail(args[0]); break;
      case 'window': await cmdWindow(args[0]); break;
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
  if (opts.window) {
    screenshotWholeWindow(file);
    console.log(file);
    return;
  }
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

// Scrolls the match at `index` into view and returns its centre in page
// coordinates, shared by click, hover and drag so all three land on exactly
// what a user would see and touch.
async function elementCentre(selector, indexArg) {
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
  return { x: Math.round(rect.x), y: Math.round(rect.y), count: rect.count, index };
}

async function cmdClick(selector, indexArg, button) {
  if (!selector) fail(`${button === 'right' ? 'rightclick' : 'click'} needs a selector`);
  const { x, y, count, index } = await elementCentre(selector, indexArg);
  // Real input events through Chromium's input pipeline, so React's synthetic
  // handlers, dnd-kit's pointer sensor and context-menu logic all see what a
  // user's mouse would produce.
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: 1 });
  await sleep(50);
  console.log(`${button === 'right' ? 'right-clicked' : 'clicked'} ${selector}[${index}] at (${x}, ${y}) of ${count} match(es)`);
}

async function cmdHover(selector, indexArg) {
  if (!selector) fail('hover needs a selector');
  const { x, y, count, index } = await elementCentre(selector, indexArg);
  // Two intermediate moves from just outside the element, so both CSS :hover
  // and React's onMouseEnter see a real enter transition rather than a single
  // teleporting mouseMoved (which some handlers coalesce away).
  const start = { x: Math.max(0, x - 24), y: Math.max(0, y - 24) };
  const steps = 3;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const mx = Math.round(start.x + (x - start.x) * t);
    const my = Math.round(start.y + (y - start.y) * t);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mx, y: my, button: 'none' });
    await sleep(16);
  }
  const waitMs = Number(opts.wait ?? 0);
  if (waitMs > 0) await sleep(waitMs);
  console.log(`hovered ${selector}[${index}] at (${x}, ${y}) of ${count} match(es)${waitMs ? `, waited ${waitMs}ms` : ''}`);
}

async function cmdUnhover() {
  // (2, 2) sits in the title bar strip, which has no hover targets.
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2, button: 'none' });
  console.log('moved pointer to (2, 2), off every hover target');
}

// Parses "<selector> [index] <selector> [index]" where an index is a bare
// integer immediately following its selector, so `drag ".a" ".b" 1` (no
// fromIndex) and `drag ".a" 2 ".b"` (no toIndex) are both unambiguous.
function parseSelectorIndexPair(args) {
  let i = 0;
  const fromSelector = args[i++];
  let fromIndex = 0;
  if (args[i] !== undefined && /^\d+$/.test(args[i])) { fromIndex = Number(args[i]); i++; }
  const toSelector = args[i++];
  let toIndex = 0;
  if (args[i] !== undefined && /^\d+$/.test(args[i])) { toIndex = Number(args[i]); i++; }
  return { fromSelector, fromIndex, toSelector, toIndex };
}

async function cmdDrag(args) {
  const { fromSelector, fromIndex, toSelector, toIndex } = parseSelectorIndexPair(args);
  if (!fromSelector) fail('drag needs a from-selector');
  if (!toSelector) fail('drag needs a to-selector');
  const steps = Number(opts.steps ?? 12);
  const holdMs = Number(opts['hold-ms'] ?? 0);
  const from = await elementCentre(fromSelector, fromIndex);
  const to = await elementCentre(toSelector, toIndex);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', clickCount: 1 });
  // dnd-kit's PointerSensor has a 6px activation distance, so this first move
  // must clear it before dnd-kit will treat the gesture as a drag at all.
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const mx = Math.round(from.x + (to.x - from.x) * t);
    const my = Math.round(from.y + (to.y - from.y) * t);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mx, y: my, button: 'left' });
    await sleep(16);
  }
  if (holdMs > 0) await sleep(holdMs);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', clickCount: 1 });
  console.log(`dragged ${fromSelector}[${fromIndex}] (${from.x}, ${from.y}) to ${toSelector}[${toIndex}] (${to.x}, ${to.y}) in ${steps} steps${holdMs ? `, held ${holdMs}ms` : ''}`);
}

async function cmdEmulateMedia(mode) {
  if (!mode) fail('emulate-media needs reduce, no-preference or off');
  let features;
  if (mode === 'off') features = [];
  else if (mode === 'reduce') features = [{ name: 'prefers-reduced-motion', value: 'reduce' }];
  else if (mode === 'no-preference') features = [{ name: 'prefers-reduced-motion', value: 'no-preference' }];
  else fail(`unknown mode ${mode}; known: reduce, no-preference, off`);
  await cdp.send('Emulation.setEmulatedMedia', { features });
  console.log(`set prefers-reduced-motion: ${mode === 'off' ? '(cleared)' : mode}`);
  // CDP emulation lives only as long as the DevTools session that set it, and
  // every drive command opens its own session, so the override is gone the moment
  // this command exits. Anything that must observe it has to run right here:
  // --click "<selector>" [--index N] clicks first, --wait <ms> pauses, --eval
  // "<js>" prints a result and --screenshot <png> captures, all in this session.
  if (opts.click) {
    const { x, y, count, index } = await elementCentre(String(opts.click), opts.index);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    console.log(`clicked ${opts.click}[${index}] at (${x}, ${y}) of ${count} match(es)`);
  }
  if (opts.wait) await sleep(Number(opts.wait));
  if (opts.eval) {
    const value = await evaluate(cdp, String(opts.eval));
    console.log(value === undefined ? 'undefined' : JSON.stringify(value, null, 2));
  }
  if (opts.screenshot) await cmdScreenshot(String(opts.screenshot));
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
        asleep: row.classList.contains(S.threadAsleepClass),
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
  const threadLine = (t, indent) => `${indent}- ${t.active ? '* ' : ''}"${t.title}" [${t.kind || '?'}/${t.state || 'quiet'}]${t.asleep ? ' [asleep]' : ''}${t.close ? ' [x]' : ''}`;
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

async function cmdScreen() {
  const info = await evaluate(cdp, `(() => {
    const app = document.querySelector('.app');
    const entranceClasses = ['enter-home', 'enter-project', 'enter-workspace'];
    return {
      screen: app ? (app.dataset.screen || null) : null,
      entrance: app ? (entranceClasses.find(c => app.classList.contains(c)) || null) : null,
      palette: !!document.querySelector('.palbg'),
      chooser: !!document.querySelector('.nt'),
      menu: !!document.querySelector('.menu'),
      dialog: !!document.querySelector('.modal-overlay'),
      toast: !!document.querySelector('.app-toast'),
    };
  })()`);
  console.log(JSON.stringify(info, null, 2));
}

async function cmdHome() {
  const S = SEL.home;
  const data = await evaluate(cdp, `((S) => {
    const text = el => (el ? (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim() : '');
    const home = document.querySelector(S.root);
    if (!home) return { present: false };
    const pinned = Array.from(document.querySelectorAll(S.pinnedCard)).map(cd => {
      const pinBtn = cd.querySelector(S.pinButton);
      return {
        group: cd.dataset.group || null,
        name: text(cd.querySelector(S.name)),
        need: text(cd.querySelector(S.pillNeed)) || null,
        run: text(cd.querySelector(S.pillRun)) || null,
        ago: text(cd.querySelector(S.ago)) || null,
        pinnedOn: !!(pinBtn && pinBtn.classList.contains(S.pinButtonOnClass)),
      };
    });
    const projects = Array.from(document.querySelectorAll(S.projectRow))
      .filter(pr => !pr.classList.contains('archived'))
      .map(pr => ({
        group: pr.dataset.group || null,
        name: text(pr.querySelector(S.name)),
        need: text(pr.querySelector(S.pillNeed)) || null,
        run: text(pr.querySelector(S.pillRun)) || null,
        time: text(pr.querySelector(S.projectTime)) || null,
      }));
    const archivedRows = Array.from(document.querySelectorAll(S.archivedRow)).map(pr => ({
      group: pr.dataset.group || null,
      name: text(pr.querySelector(S.name)),
      time: text(pr.querySelector(S.projectTime)) || null,
    }));
    return {
      present: true,
      dateHeading: text(document.querySelector(S.dateHeading)),
      totNeed: text(document.querySelector(S.totNeed)) || null,
      totRun: text(document.querySelector(S.totRun)) || null,
      lastHere: text(document.querySelector(S.lastHere)) || null,
      pinned,
      nothingPinned: text(document.querySelector(S.nothing)) || null,
      projects,
      more: text(document.querySelector(S.moreProjects)) || null,
      archivedToggle: text(document.querySelector(S.archivedToggle)) || null,
      archivedRows,
    };
  })(${JSON.stringify(S)})`);

  if (!data.present) { console.log('(not on Home)'); return; }
  console.log(data.dateHeading || '(no date heading)');
  console.log(`  totals: need=${data.totNeed ?? 'none'} run=${data.totRun ?? 'none'}`);
  if (data.lastHere) console.log(`  lasthere: ${data.lastHere}`);
  const pills = p => [p.need ? `need=${p.need}` : null, p.run ? `run=${p.run}` : null].filter(Boolean).join(' ');
  console.log('  Pinned:');
  if (!data.pinned.length) console.log(`    ${data.nothingPinned || '(none)'}`);
  for (const p of data.pinned) {
    console.log(`    [${p.group}] ${p.name}${pills(p) ? '  ' + pills(p) : ''}${p.ago ? '  ' + p.ago : ''}  pin=${p.pinnedOn ? 'on' : 'off'}`);
  }
  console.log('  Projects:');
  for (const p of data.projects) {
    console.log(`    [${p.group}] ${p.name}${pills(p) ? '  ' + pills(p) : ''}${p.time ? '  ' + p.time : ''}`);
  }
  if (data.more) console.log(`    (${data.more})`);
  console.log('  Archived:');
  if (data.archivedToggle) console.log(`    (${data.archivedToggle})`);
  for (const p of data.archivedRows) console.log(`    [${p.group}] ${p.name}${p.time ? '  ' + p.time : ''}`);
}

async function cmdProject() {
  const S = SEL.project;
  const data = await evaluate(cdp, `((S) => {
    const text = el => (el ? (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim() : '');
    const proj = document.querySelector(S.root);
    if (!proj) return { present: false };
    const actions = Array.from(document.querySelectorAll(S.action)).map(b => ({
      action: b.dataset.action || null,
      disabled: b.getAttribute('aria-disabled') === 'true' || b.classList.contains('disabled') || b.disabled === true,
    }));
    const tabs = Array.from(document.querySelectorAll(S.tab)).map(b => ({
      label: text(b),
      selected: b.getAttribute('aria-selected') === 'true',
    }));
    const rows = Array.from(document.querySelectorAll(S.row)).map(row => {
      const icon = row.querySelector(S.stateIcon);
      return {
        tabId: row.dataset.tabId || null,
        name: text(row.querySelector(S.rowName)),
        detail: text(row.querySelector(S.rowDetail)) || null,
        state: icon ? icon.getAttribute('data-state') : 'quiet',
        time: text(row.querySelector(S.rowTime)) || null,
      };
    });
    // Phase 4: History tab rows. No state icon (the thread is closed); an
    // optional Resume button on rows that carry a resumable session.
    const historyRows = Array.from(document.querySelectorAll(S.historyRow)).map(row => ({
      historyId: row.dataset.historyId || null,
      name: text(row.querySelector(S.rowName)),
      detail: text(row.querySelector(S.rowDetail)) || null,
      time: text(row.querySelector(S.rowTime)) || null,
      resume: !!row.querySelector(S.resumeButton),
    }));
    const search = document.querySelector(S.search);
    return {
      present: true,
      title: text(document.querySelector(S.title)),
      folderLine: text(document.querySelector(S.folderLine)),
      actions,
      tabs,
      search: search ? search.value : '',
      rows,
      historyRows,
      nothing: text(document.querySelector(S.nothing)) || null,
    };
  })(${JSON.stringify(S)})`);

  if (!data.present) { console.log('(not on a project page)'); return; }
  console.log(data.title || '(no title)');
  console.log(`  folder: ${data.folderLine || '(none)'}`);
  console.log(`  actions: ${data.actions.map(a => `${a.action}${a.disabled ? ' (disabled)' : ''}`).join(', ') || '(none)'}`);
  // The selected tab label prints before the rows, so a reader always knows
  // which list (Live, Asleep or History) the rows below belong to.
  const selected = data.tabs.find(t => t.selected);
  const others = data.tabs.filter(t => !t.selected).map(t => t.label);
  console.log(`  tab: ${selected ? selected.label : '(none selected)'}  other tabs: ${others.join(', ') || '(none)'}`);
  console.log(`  search: ${JSON.stringify(data.search)}`);
  if (data.rows.length) {
    for (const r of data.rows) console.log(`  - "${r.name}" [${r.detail || ''}] [${r.state || 'quiet'}]${r.time ? '  ' + r.time : ''}`);
  } else if (data.historyRows.length) {
    for (const r of data.historyRows) {
      const kind = (r.detail || '').toLowerCase() === 'chat' ? 'chat' : 'shell';
      console.log(`  - "${r.name}" [${kind}]${r.time ? '  ' + r.time : ''}${r.resume ? ' [resume]' : ''}`);
    }
  } else {
    console.log(`  ${data.nothing || '(no rows)'}`);
  }
}

async function cmdChooser() {
  const S = SEL.chooser;
  const data = await evaluate(cdp, `((S) => {
    const text = el => (el ? (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim() : '');
    const root = document.querySelector(S.root);
    if (!root) return { present: false };
    const input = document.querySelector(S.input);
    const opts = Array.from(document.querySelectorAll(S.opt)).map(o => ({
      group: o.dataset.group || null,
      name: text(o.querySelector(S.optName)),
      tag: text(o.querySelector(S.optTag)) || null,
      hi: o.classList.contains(S.hiClass),
    }));
    return { present: true, input: input ? input.value : '', opts, shell: text(document.querySelector(S.shellButton)) || null };
  })(${JSON.stringify(S)})`);

  if (!data.present) { console.log('(no chooser open)'); return; }
  console.log(`input: ${JSON.stringify(data.input)}`);
  for (const o of data.opts) console.log(`  ${o.hi ? '*' : ' '} [${o.group}] ${o.name}${o.tag ? '  (' + o.tag + ')' : ''}`);
  console.log(`shell: ${data.shell || '(none)'}`);
}

async function cmdPalette() {
  const S = SEL.palette;
  const data = await evaluate(cdp, `((S) => {
    const text = el => (el ? (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim() : '');
    const root = document.querySelector(S.root);
    if (!root) return { present: false };
    const input = document.querySelector(S.input);
    // Walk group headers (Projects, Threads, and Phase 4's History) and result
    // rows together in document order, so each row prints under its own group.
    const rows = Array.from(root.querySelectorAll(S.groupLabel + ', ' + S.item)).map(el => {
      if (el.matches(S.groupLabel)) return { group: text(el) };
      return {
        kind: el.dataset.kind || null,
        id: el.dataset.id || null,
        name: text(el.querySelector(S.itemName)),
        meta: text(el.querySelector(S.itemMeta)) || null,
        hi: el.classList.contains(S.hiClass),
      };
    });
    return { present: true, input: input ? input.value : '', rows, nothing: text(document.querySelector(S.nothing)) || null };
  })(${JSON.stringify(S)})`);

  if (!data.present) { console.log('(no palette open)'); return; }
  console.log(`input: ${JSON.stringify(data.input)}`);
  const items = data.rows.filter(r => r.group === undefined);
  if (!items.length) console.log(`  ${data.nothing || '(no results)'}`);
  for (const r of data.rows) {
    if (r.group !== undefined) { console.log(`  ${r.group}`); continue; }
    console.log(`  ${r.hi ? '*' : ' '} [${r.kind}/${r.id}] ${r.name}${r.meta ? '  ' + r.meta : ''}`);
  }
}

async function cmdHeader() {
  const S = SEL.header;
  const data = await evaluate(cdp, `((S) => {
    const text = el => (el ? (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim() : '');
    const header = document.querySelector(S.root);
    if (!header) return { present: false };
    const isEmpty = !!header.querySelector(S.empty);
    const nameEl = header.querySelector(S.name);
    // KindIcon has no data attribute of its own today; this looks for one on
    // any element inside the name line so a future KindIcon change (or a
    // wrapper the Header agent adds) is picked up without touching the harness.
    const kindEl = nameEl ? nameEl.querySelector('[data-kind]') : null;
    const meta = Array.from(header.querySelectorAll(S.metaItem)).map(el => ({
      meta: el.dataset.meta || null,
      text: text(el),
    }));
    const chip = header.querySelector(S.chip);
    return {
      present: true,
      isEmpty,
      name: text(nameEl),
      kind: kindEl ? kindEl.getAttribute('data-kind') : null,
      meta,
      chip: text(chip) || null,
    };
  })(${JSON.stringify(S)})`);

  if (!data.present) { console.log(`(no ${SEL.header.root} in the DOM)`); return; }
  if (data.isEmpty) { console.log('(no thread)'); return; }
  console.log(data.name || '(no name)');
  if (data.kind) console.log(`  kind: ${data.kind}`);
  for (const m of data.meta) console.log(`  ${m.meta || '?'}=${m.text}`);
  console.log(`  ${data.chip || '(quiet)'}`);
}

async function cmdHoverCard() {
  const S = SEL.hoverCard;
  const data = await evaluate(cdp, `((S) => {
    const text = el => (el ? (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim() : '');
    const card = document.querySelector(S.root);
    if (!card) return { present: false };
    const rows = Array.from(card.querySelectorAll(S.row)).map(dd => ({
      row: dd.dataset.row || null,
      text: text(dd),
    }));
    return { present: true, title: text(card.querySelector(S.title)), rows };
  })(${JSON.stringify(S)})`);

  if (!data.present) { console.log('(no hover card)'); return; }
  console.log(data.title || '(no title)');
  for (const r of data.rows) console.log(`  ${r.row || '?'}: ${r.text}`);
}

// Phase 4: the asleep pane (src/renderer/components/AsleepPane/index.tsx) that
// covers the terminal card while the active thread is asleep.
async function cmdPane() {
  const S = SEL.asleepPane;
  const data = await evaluate(cdp, `((S, hiddenSel) => {
    const text = el => (el ? (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim() : '');
    const root = document.querySelector(S.root);
    const hostHidden = !!document.querySelector(hiddenSel);
    if (!root) return { present: false, hostHidden };
    const pastEl = root.querySelector(S.past);
    // Absent while the tail is still loading or once loaded empty (AsleepPane
    // only renders <pre class="past"> when tail !== null && tail.length > 0).
    const pastLines = pastEl ? (pastEl.innerText || pastEl.textContent || '').replace(/\\r\\n/g, '\\n').split('\\n') : null;
    return {
      present: true,
      tabId: root.dataset.tabId || null,
      wake: !!root.querySelector(S.wake),
      since: text(root.querySelector(S.since)),
      pastLines,
    };
  })(${JSON.stringify(S)}, ${JSON.stringify(SEL.terminalHidden)})`);

  if (!data.present) {
    console.log('(terminal)');
    console.log(`terminal: ${data.hostHidden ? 'hidden' : 'shown'}`);
    return;
  }
  console.log(`asleep pane for ${data.tabId || '(unknown)'}`);
  console.log(`wake button: ${data.wake ? 'yes' : 'no'}`);
  console.log(`since: ${data.since || '(none)'}`);
  if (!data.pastLines) {
    console.log('past: (none)');
  } else {
    console.log(`past lines: ${data.pastLines.length}`);
    for (const l of data.pastLines.slice(-5)) console.log(`  ${l}`);
  }
}

// Phase 4: reads an xterm buffer through window.__afterterm, the hook Terminal/
// index.tsx installs for the harness (tail(tabId, n) and activeTail(n), each
// trimming trailing blank lines and returning null when there is no terminal
// for that id, e.g. it is asleep).
async function cmdTail(nArg) {
  const n = Number(nArg ?? 30) || 30;
  const expr = opts.tab
    ? `window.__afterterm && window.__afterterm.tail(${JSON.stringify(String(opts.tab))}, ${n})`
    : `window.__afterterm && window.__afterterm.activeTail(${n})`;
  const lines = await evaluate(cdp, expr);
  if (!lines) { console.log('(no terminal)'); return; }
  for (const l of lines) console.log(l);
}

// The electron browser process id, re-resolved from the listening DevTools
// socket first (a main-process edit restarts electron under a new pid; see
// cmdBounds), falling back to the recorded run.
function resolveElectronPid() {
  return pidListeningOn(port) ?? run?.electronPid ?? null;
}

// Among the electron process's visible windows, the main window is the
// largest by area: the notifier overlay is a small toast strip and any native
// dialog is smaller still, so area alone tells them apart without depending on
// window title text (which is the page's own document.title and changes with
// the active tab).
function pickMainWindow(windows) {
  const sized = windows.filter(w => !w.error && w.width > 0 && w.height > 0);
  if (!sized.length) return null;
  return sized.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b));
}

// Captures the whole OS window, native title bar and all, through PrintWindow
// with PW_RENDERFULLCONTENT (2). Unlike Page.captureScreenshot this works even
// while another window covers afterterm's, because PrintWindow asks the target
// window to paint into a device context we hand it, rather than reading back
// what is currently on screen.
function screenshotWholeWindow(file) {
  const electronPid = resolveElectronPid();
  if (!electronPid) fail('could not resolve the electron process id');
  const win = pickMainWindow(listWindows(electronPid));
  if (!win) fail(`no visible top-level window found for pid ${electronPid}`);
  const escapedPath = file.replace(/'/g, "''");
  const script = DPI_AWARE_PRELUDE + `
Add-Type -AssemblyName System.Drawing
Add-Type -Namespace Harness -Name Shot -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool GetWindowRect(System.IntPtr hWnd, out RECT lpRect);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern int PrintWindow(System.IntPtr hwnd, System.IntPtr hdcBlt, uint nFlags);
public struct RECT { public int Left, Top, Right, Bottom; }
'@
$hwnd = [IntPtr]${win.hwnd}
$rect = New-Object Harness.Shot+RECT
[void][Harness.Shot]::GetWindowRect($hwnd, [ref]$rect)
$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top
$bmp = New-Object System.Drawing.Bitmap $w, $h
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $gfx.GetHdc()
[void][Harness.Shot]::PrintWindow($hwnd, $hdc, 2)
$gfx.ReleaseHdc($hdc)
$gfx.Dispose()
$bmp.Save('${escapedPath}', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
`;
  powershell(script);
}

async function cmdWindow(sub) {
  if (!sub) fail('window needs bottom, restore, quit or close-dialogs');
  const electronPid = resolveElectronPid();
  if (!electronPid) fail('could not resolve the electron process id');
  const windows = listWindows(electronPid);

  if (sub === 'bottom' || sub === 'restore') {
    const win = pickMainWindow(windows);
    if (!win) fail(`no visible top-level window found for pid ${electronPid}`);
    // bottom: SetWindowPos(HWND_BOTTOM=1, SWP_NOACTIVATE|SWP_NOMOVE|SWP_NOSIZE=0x13)
    // restore: ShowWindow(SW_SHOWNOACTIVATE=4)
    const call = sub === 'bottom'
      ? '$r = [Harness.Pos]::SetWindowPos($hwnd, [IntPtr]1, 0, 0, 0, 0, 19)'
      : '$r = [Harness.Pos]::ShowWindow($hwnd, 4)';
    const script = `
Add-Type -Namespace Harness -Name Pos -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetWindowPos(System.IntPtr hWnd, System.IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr hWnd, int nCmdShow);
'@
$hwnd = [IntPtr]${win.hwnd}
${call}
"$r"`;
    const out = powershell(script).trim();
    console.log(`hwnd=${win.hwnd} ${sub} -> ${out}`);
    return;
  }

  if (sub === 'quit') {
    // A graceful quit, as the user's close button would do it: WM_CLOSE to the main
    // window, so the renderer's beforeunload flush (session.json with every thread
    // stamped asleep, and every live terminal's tail) runs before the process goes.
    // stop.mjs kills the tree outright and skips all of that. The dev build answers
    // its own "terminals still running" confirm for a harness run (AFTERTERM_HARNESS=1
    // in src/main.ts), so nothing waits on a dialog. Polls until the electron process
    // is gone (up to 30s).
    const win = pickMainWindow(windows);
    if (!win) fail(`no visible top-level window found for pid ${electronPid}`);
    const script = `
Add-Type -Namespace Harness -Name Quit -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr PostMessage(System.IntPtr hWnd, uint Msg, System.IntPtr wParam, System.IntPtr lParam);
'@
[void][Harness.Quit]::PostMessage([IntPtr]${win.hwnd}, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
"posted"`;
    const out = powershell(script).trim();
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline && pidExists(electronPid)) await sleep(250);
    const gone = !pidExists(electronPid);
    console.log(`hwnd=${win.hwnd} WM_CLOSE ${out}; electron ${electronPid} ${gone ? 'exited' : 'still running after 30s'}`);
    if (!gone) process.exitCode = 1;
    return;
  }

  if (sub === 'close-dialogs') {
    // Native common dialogs (file pickers, message boxes) run in-process under
    // the electron browser pid and carry the stock Windows dialog class.
    const dialogs = windows.filter(w => w.className === '#32770');
    if (!dialogs.length) { console.log('no native dialogs found'); return; }
    const script = `
Add-Type -Namespace Harness -Name Close -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr PostMessage(System.IntPtr hWnd, uint Msg, System.IntPtr wParam, System.IntPtr lParam);
'@
foreach ($h in @(${dialogs.map(d => d.hwnd).join(',')})) { [void][Harness.Close]::PostMessage([IntPtr]$h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) }
"closed ${dialogs.length}"`;
    const out = powershell(script).trim();
    console.log(`${out}: ${dialogs.map(d => `${d.hwnd} "${d.title}"`).join(', ')}`);
    return;
  }

  fail(`unknown window subcommand: ${sub}; known: bottom, restore, quit, close-dialogs`);
}

// ─── Recording (see record.mjs) ────────────────────────────────────────────────
// `record` spawns record.mjs as its own detached process (spawnViaWmi, same as
// launch.mjs uses for the dev build, so it survives the caller's shell being
// recycled) and tracks it two ways: `<out>.recording.json` next to the video
// (the reliable one, always written) and a `recordings` list appended to the
// run record when one is available, so `record status` and an --out-less
// `record stop` need no arguments.

async function cmdRecord(sub) {
  if (!sub) fail('record needs start, stop or status');
  if (sub === 'start') return cmdRecordStart();
  if (sub === 'stop') return cmdRecordStop();
  if (sub === 'status') return cmdRecordStatus();
  fail(`unknown record subcommand: ${sub}; known: start, stop, status`);
}

async function cmdRecordStart() {
  if (!opts.out) fail('record start needs --out <file.mp4>');
  const outFile = path.resolve(String(opts.out));
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  // Everything but the mp4 (frames, stop file, logs, the pid record) is bookkeeping
  // and goes under the run's data dir, never beside the mp4: the mp4 lands in
  // docs/screenshots/<phase>/, which is committed.
  const workDir = recordingWorkDir(outFile);
  fs.mkdirSync(workDir, { recursive: true });
  const framesDir = path.join(workDir, 'frames');
  const spawnLog = path.join(workDir, 'spawn.log');
  const recordScript = path.join(REPO_ROOT, 'scripts', 'agent-harness', 'record.mjs');

  const passthrough = [];
  for (const k of ['max-width', 'fps', 'quality']) {
    if (opts[k] !== undefined && opts[k] !== true) passthrough.push(`--${k} ${opts[k]}`);
  }
  const quote = s => `"${s}"`;
  const commandLine = `cmd.exe /d /s /c "${quote(process.execPath)} ${quote(recordScript)} --out ${quote(outFile)} --work-dir ${quote(workDir)} --port ${port} ${passthrough.join(' ')} >> ${quote(spawnLog)} 2>&1"`;

  const pid = spawnViaWmi({ commandLine, cwd: REPO_ROOT, env: process.env, dataDir: workDir });
  const startedAt = new Date().toISOString();
  const entry = { pid, out: outFile, workDir, port, startedAt };
  writeJson(path.join(workDir, 'recording.json'), entry);
  addRecordingToRun(entry);

  // Wait for the first frame so a caller knows recording has actually begun
  // before it starts driving the app.
  const deadline = Date.now() + 10000;
  let sawFrame = false;
  while (Date.now() < deadline) {
    if (!pidExists(pid)) fail(`recorder exited before capturing a frame; see ${spawnLog} and ${path.join(workDir, 'record.log')}`);
    if (fs.existsSync(framesDir) && fs.readdirSync(framesDir).some(f => f.startsWith('frame-'))) { sawFrame = true; break; }
    await sleep(200);
  }
  if (!sawFrame) console.error(`drive: no frame seen within 10s yet (pid ${pid} still running); continuing`);
  console.log(`recording ${outFile}`);
}

async function cmdRecordStop() {
  const outFile = opts.out ? path.resolve(String(opts.out)) : latestRecordingOut();
  if (!outFile) fail('record stop found no recording to stop; pass --out <file.mp4>');
  const workDir = recordingWorkDir(outFile);
  const infoFile = path.join(workDir, 'recording.json');
  if (!fs.existsSync(infoFile)) fail(`no ${infoFile}; was this recording started with 'record start'?`);
  const info = readJson(infoFile);
  fs.writeFileSync(path.join(workDir, 'stop'), '');
  console.log(`stopping ${outFile} (pid ${info.pid})...`);

  const deadline = Date.now() + 60000;
  while (Date.now() < deadline && pidExists(info.pid)) await sleep(500);
  if (pidExists(info.pid)) console.error(`drive: recorder pid ${info.pid} still alive after 60s`);

  const logFile = path.join(workDir, 'record.log');
  if (fs.existsSync(logFile)) {
    const lines = fs.readFileSync(logFile, 'utf8').split(/\r?\n/).filter(Boolean);
    for (const l of lines.slice(-10)) console.log(l);
  }
  console.log(outFile);
}

async function cmdRecordStatus() {
  const recordings = run?.recordings ?? [];
  if (!recordings.length) { console.log('(no recordings)'); return; }
  for (const r of recordings) console.log(`${pidExists(r.pid) ? 'alive ' : 'gone  '} pid=${r.pid}  ${r.out}`);
}

// Where a recording's frames, stop file, logs and pid record live: under the run's
// data dir when there is a run record, else beside the mp4 (a manual --port run).
function recordingWorkDir(outFile) {
  const base = path.basename(outFile, path.extname(outFile));
  return run?.dataDir ? path.join(run.dataDir, 'recordings', base) : `${outFile}.work`;
}

function latestRecordingOut() {
  const recordings = run?.recordings ?? [];
  return recordings.length ? recordings[recordings.length - 1].out : null;
}

function addRecordingToRun(entry) {
  const target = run ?? { port };
  target.recordings = target.recordings ?? [];
  target.recordings.push(entry);
  run = target;
  if (opts['data-dir']) {
    const file = path.join(path.resolve(opts['data-dir']), 'harness.json');
    if (fs.existsSync(file)) writeJson(file, target);
  } else if (fs.existsSync(LATEST_FILE)) {
    writeJson(LATEST_FILE, target);
  }
}

function fail(msg) {
  throw new DriveError(msg);
}

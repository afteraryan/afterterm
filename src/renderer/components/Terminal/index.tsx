import React, { useRef, useEffect, useLayoutEffect, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
import { Terminal, type ILinkProvider } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon, ISearchOptions } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import { TabNotification } from '../TabBar/types';
import { wakePlan } from '../../sleepWake';
import {
  parseOsc133, initialCommandMarkState, onMark, onEnter, onInput, onCommandSent,
  type CommandMarkState,
} from '../../commandMarks';
import { TAIL_MAX_LINES } from '../../../thread-tail';
import { JUMP_THRESHOLD_LINES, JumpState, JumpTarget, initialJumpState, onScrollSample, jumpDurationMs, jumpLineAt, prefersReducedMotion, wheelToLines, isUserScroll } from '../../jumpScroll';
import { JumpButton, JumpButtonHandle } from '../JumpButton';
import { isWindowsDrivePath, osc7ToWindowsPath } from '../../../shell-paths';
import { createFileLinkProvider, trackToolLines, hideTip, type FileLinkContext, type FileLinkProvider, type FileLinkTarget } from './fileLinks';
import { createWebLinkProvider } from './webLinks';
import { Menu, type MenuItem } from '../Menu';
import { SPLIT_MIN, SPLIT_MAX, SPLIT_DEFAULT } from '../../splitView';
import type { PaneTarget } from '../../splitView';

interface TermInfo {
  term: Terminal;
  fitAddon: FitAddon;
  search: SearchAddon;
  container: HTMLDivElement;
  scheduleFit: () => void;
}

interface TabInfo {
  id: string;
  shellId?: string;
  cwd?: string;
  fontSize?: number;
  claudeSessionId?: string;
  claudeCwd?: string;
  // The source of truth this whole layer reconciles to: an asleep thread has no
  // xterm instance and no PTY, an awake one has both.
  asleep: boolean;
  // Set when a thread wakes (or comes back from history). Until Phase 9 this was
  // the cue to replay its saved tail above a "Woke just now" divider; the terminal
  // no longer reads it, it is kept in the props for the record only.
  wokeAt?: number;
  // The port the thread's process tree was last seen listening on, and the last
  // command entered at its prompt. Both are read on a wake: together they are what
  // tells wakePlan this thread is a server whose command should be re-run
  // (sleepWake.ts).
  port?: number;
  lastCommand?: string;
}

// What the app can ask this layer for at quit time: the on-screen tail of one
// terminal, or of every terminal at once. Only the buffer knows what is on screen,
// so the flush has to come through here rather than out of app state.
export interface TerminalAreaHandle {
  readTail(tabId: string): string[] | null;
  readAllTails(): Record<string, string[]>;
  // Gives the keyboard to the active thread's terminal; nothing if it has none.
  focusActive(): void;
}

interface TerminalAreaProps {
  tabs: TabInfo[];
  activeTabId: string;
  // False while another screen (Home, a project page) is showing. The area stays
  // mounted so the terminals keep running, but a hidden container measures 0, so
  // the active terminal is refit and refocused when it comes back.
  visible: boolean;
  // The threads on screen, left to right: the active thread alone, or the two
  // halves of its split (design-06, splitView.ts panesFor). Empty when nothing
  // is on screen. activeTabId is the focused one.
  panes: string[];
  // The left half's share of the width, for a split.
  ratio: number;
  // Each column's header, and the pane an asleep thread shows in its card.
  // `split` says whether the column is one half of two.
  renderHeader: (tabId: string, split: boolean) => React.ReactNode;
  renderAsleep: (tabId: string, focused: boolean) => React.ReactNode;
  // A pointer press anywhere in a column (header or card) gives it the focus.
  onFocusPane: (tabId: string) => void;
  // The divider, committed once when the drag ends (or 0.5 on a double-click).
  onRatio: (ratio: number) => void;
  // Where a thread dragged from the sidebar would land (design-06): a half lit
  // up, or the refused drop in red with its label.
  dropZone: PaneTarget | null;
  onTitleChange: (tabId: string, title: string) => void;
  onCwdChange: (tabId: string, cwd: string) => void;
  onNotification: (tabId: string, type: TabNotification | undefined, projectName: string) => void;
  onUserInput: (tabId: string) => void;
  // Fires on Enter in the terminal. At a Claude Code permission prompt that is the
  // answer, so it is what ends needs-you (spinnerState.ts, onAnswer). Fired for
  // every Enter; the state machine ignores it outside a prompt.
  onAnswer: (tabId: string) => void;
  // Fires on a real keystroke or paste in the terminal (anything xterm hands to
  // onData that is not an escape sequence). Typing in a chat is what clears its
  // unread mark (Aryan, 2026-09-19); the focus reports xterm emits on a tab switch
  // start with ESC and are excluded, so merely focusing a thread does not count.
  onTyped: (tabId: string) => void;
  // Fires on every PTY output chunk (byteLen = chunk size), drives the working-
  // spinner's silence-clear and resume-based re-arm (see spinnerState.ts).
  onOutput: (tabId: string, byteLen: number) => void;
  onFontSizeChange: (tabId: string, fontSize: number) => void;
  onExit: (tabId: string) => void;
  // The last lines of a terminal, handed over the moment before it is destroyed.
  // The app decides what happens to them: a sleeping thread's tail is written to
  // disk, a closed thread's only if it went to a project's history.
  onTail: (tabId: string, lines: string[], reason: 'sleep' | 'close') => void;
  // A command line the user just entered at a shell prompt, read out of the buffer
  // between the OSC 133;B mark and the cursor (commandMarks.ts). Every shell with
  // integration emits the marks: cmd through its injected PROMPT, PowerShell through
  // a wrapped prompt function, Git Bash and WSL through a PROMPT_COMMAND hook (all
  // set up in src/shell-integration.ts).
  onCommand: (tabId: string, command: string) => void;
  // Whether the shell sits at its prompt, from the same marks (commandMarks.ts,
  // atPrompt): fired on a thread's first mark and then whenever it changes, false
  // when Enter runs a command, true when the next prompt is drawn. Never fired for
  // a thread that has produced no marks. The restart window reads it (plan-02, Fix 8).
  onPromptState?: (tabId: string, atPrompt: boolean) => void;
  // Edited files, Phase 3: what a thread's file paths resolve against (its folder,
  // its project's, the files its chat changed), read on every hover, and what a
  // click on one does. Without them no file links are made.
  fileContext?: (tabId: string) => FileLinkContext | null;
  onOpenFileLink?: (target: FileLinkTarget) => void;
  // The right-click menu on a file link.
  fileLinkMenu?: (target: FileLinkTarget) => MenuItem[];
}

// SECURITY: claudeSessionId is read from persisted session.json (a plain file that
// could be hand-edited) and typed into the shell as `claude --resume <id>`. Only run
// it if it's a canonical UUID, no shell metacharacters or newlines can slip through.
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const NOTIF_PREFIXES: [string, TabNotification][] = [
  ['✅', 'done'],       // ✅
  ['⚠', 'attention'],  // ⚠
  ['⏳', 'background'], // ⏳
  ['⚙', 'compacting'], // ⚙
  ['▶', 'working'],    // ▶ emitted by UserPromptSubmit hook
];

// How long a freshly spawned shell gets before anything is typed into it. cmd
// prints its banner and its first prompt inside that window, and input sent before
// the prompt is there is lost. Both things a wake can type share it: a chat's
// `claude --resume`, and a server's last command re-run.
const SHELL_READY_MS = 700;

const DEFAULT_FONT_SIZE = 14;
const MIN_FONT_SIZE = 6;
const MAX_FONT_SIZE = 40;

// Match-highlight colors for the find bar. The all-occurrences highlight is a dim,
// low-key amber so it doesn't shout; the current match is a bright bordered amber
// that clearly stands out from the rest (these two were too close before).
const SEARCH_OPTIONS: ISearchOptions = {
  decorations: {
    matchBackground: '#3d3420',
    matchBorder: '#3d3420',
    matchOverviewRuler: '#9a824a',
    activeMatchBackground: '#f0a830',
    activeMatchBorder: '#ffd98a',
    activeMatchColorOverviewRuler: '#ffffff',
  },
};

function detectNotification(title: string): TabNotification | undefined {
  for (const [prefix, type] of NOTIF_PREFIXES) {
    if (title.startsWith(prefix)) return type;
  }
  return undefined;
}

function extractProjectName(rawTitle: string): string {
  // "<emoji> project - message" → "project"
  const match = rawTitle.match(/^.\s+(.+?)\s+-\s+/);
  return match?.[1] ?? rawTitle;
}

function formatTabTitle(raw: string): string {
  const home = window.afterterm.env.userProfile;

  if (/^[A-Za-z]:\\/.test(raw)) {
    if (home && raw.toLowerCase() === home.toLowerCase()) return '~';
    const segments = raw.split('\\').filter(Boolean);
    if (segments.length <= 1) return raw;
    return segments[segments.length - 1];
  }

  return raw;
}

/** How long a right-click waits to learn whether it landed on a file link. */
const LINK_AT_WAIT_MS = 500;

/** The 1-based buffer cell under a point on the page, or null when it is off the grid. */
function cellAt(term: Terminal, clientX: number, clientY: number): { x: number; y: number } | null {
  const screen = term.element?.querySelector('.xterm-screen');
  if (!screen) return null;
  const r = screen.getBoundingClientRect();
  const col = Math.floor((clientX - r.left) / (r.width / term.cols));
  const row = Math.floor((clientY - r.top) / (r.height / term.rows));
  if (col < 0 || col >= term.cols || row < 0 || row >= term.rows) return null;
  return { x: col + 1, y: term.buffer.active.viewportY + row + 1 };
}

// The last `max` rows of a terminal, as plain strings. `translateToString(true)`
// trims each row's right padding; the trailing empty rows below a prompt are dropped
// too, since a tail made mostly of blank lines shows nothing when it is replayed.
//
// The byte cap and the canonical trim live in main (thread-tail.ts, trimTail, called
// by every threads:save* handler). They are not applied here on purpose: trimTail
// measures UTF-8 with Buffer, a Node global the sandboxed renderer does not have.
function captureTail(term: Terminal, max: number = TAIL_MAX_LINES): string[] {
  const buffer = term.buffer.active;
  // The viewport is part of the buffer and ConPTY paints from its top, so a short
  // session leaves a run of blank rows under the prompt. Read one screenful beyond
  // `max`, drop the blank rows at the end, and only then keep the last `max` lines:
  // otherwise "the last 20 lines" of a fresh shell would be 20 empty rows.
  const start = Math.max(0, buffer.length - max - term.rows);
  const lines: string[] = [];
  for (let i = start; i <= buffer.length - 1; i++) {
    const line = buffer.getLine(i);
    lines.push(line ? line.translateToString(true).replace(/\s+$/, '') : '');
  }
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.slice(-max);
}

// The command line sitting between the prompt's end (the OSC 133;B mark) and the
// cursor. It reads the xterm buffer, which is why it lives here and not in
// commandMarks.ts: that module stays pure and knows nothing about xterm.
//
// The first row starts at the mark's column (the prompt text itself is to its
// left); every later row is taken whole and joined with no separator. A long
// command wraps, and xterm stores a wrapped line as several rows of one logical
// line, so plain concatenation is the correct rejoin. A row that is not wrapped is
// still included: cmd never draws a second prompt line between B and Enter, so
// every row in this range belongs to the command.
function readCommandText(term: Terminal, from: { row: number; col: number }): string {
  const buffer = term.buffer.active;
  const endRow = buffer.baseY + buffer.cursorY;
  let text = '';
  for (let row = from.row; row <= endRow; row++) {
    const line = buffer.getLine(row);
    if (!line) continue;
    text += row === from.row ? line.translateToString(true, from.col) : line.translateToString(true);
  }
  return text;
}

const THEME = {
  background: '#191919',
  foreground: '#e0e0e0',
  cursor: '#e0e0e0',
  cursorAccent: '#191919',
  selectionBackground: 'rgba(255,255,255,0.2)',
  black: '#1a1a1a',
  red: '#e06c75',
  green: '#98c379',
  yellow: '#e5c07b',
  blue: '#61afef',
  magenta: '#c678dd',
  cyan: '#56b6c2',
  white: '#abb2bf',
  brightBlack: '#5c6370',
  brightRed: '#e06c75',
  brightGreen: '#98c379',
  brightYellow: '#e5c07b',
  brightBlue: '#61afef',
  brightMagenta: '#c678dd',
  brightCyan: '#56b6c2',
  brightWhite: '#ffffff',
};

export const TerminalArea = forwardRef<TerminalAreaHandle, TerminalAreaProps>(function TerminalArea(
  { tabs: tabInfos, activeTabId, visible, panes, ratio, renderHeader, renderAsleep, onFocusPane, onRatio, dropZone, onTitleChange, onCwdChange, onNotification, onUserInput, onAnswer, onTyped, onOutput, onFontSizeChange, onExit, onTail, onCommand, onPromptState, fileContext, onOpenFileLink, fileLinkMenu },
  ref,
) {
  // Where every terminal that is not on screen waits (display: none). A
  // terminal on screen lives in its column's card instead (slotsRef), moved
  // there when the panes change: React never owns these containers.
  const parkRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const slotsRef = useRef(new Map<string, HTMLDivElement>());
  const colsRef = useRef(new Map<string, HTMLDivElement>());
  const termsRef = useRef(new Map<string, TermInfo>());
  const activeRef = useRef(activeTabId);
  activeRef.current = activeTabId;
  const panesRef = useRef(panes);
  panesRef.current = panes;
  // True while the divider is held: nothing refits until it is let go.
  const dividingRef = useRef(false);
  const onRatioRef = useRef(onRatio);
  onRatioRef.current = onRatio;

  const onTitleChangeRef = useRef(onTitleChange);
  onTitleChangeRef.current = onTitleChange;
  const onCwdChangeRef = useRef(onCwdChange);
  onCwdChangeRef.current = onCwdChange;
  const onNotificationRef = useRef(onNotification);
  onNotificationRef.current = onNotification;
  const onUserInputRef = useRef(onUserInput);
  onUserInputRef.current = onUserInput;
  const onAnswerRef = useRef(onAnswer);
  onAnswerRef.current = onAnswer;
  const onTypedRef = useRef(onTyped);
  onTypedRef.current = onTyped;
  const onOutputRef = useRef(onOutput);
  onOutputRef.current = onOutput;
  const onFontSizeChangeRef = useRef(onFontSizeChange);
  onFontSizeChangeRef.current = onFontSizeChange;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const onTailRef = useRef(onTail);
  onTailRef.current = onTail;
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;
  const onPromptStateRef = useRef(onPromptState);
  onPromptStateRef.current = onPromptState;
  const fileContextRef = useRef(fileContext);
  fileContextRef.current = fileContext;
  const onOpenFileLinkRef = useRef(onOpenFileLink);
  onOpenFileLinkRef.current = onOpenFileLink;
  const fileLinkMenuRef = useRef(fileLinkMenu);
  fileLinkMenuRef.current = fileLinkMenu;
  // Each terminal's file-link provider, kept so the harness can ask one for the
  // links on a row without moving a mouse (window.__afterterm.fileLinks).
  const fileLinkProvidersRef = useRef(new Map<string, FileLinkProvider>());
  // And each one's provider for links cut over several rows (window.__afterterm.webLinks).
  const webLinkProvidersRef = useRef(new Map<string, ILinkProvider>());

  // The menu a right-click on a file link opens. The terminal gives up the keyboard
  // while it is up, so an Esc to close it does not reach the shell, where it would
  // interrupt Claude Code; closing hands the keyboard back.
  const [linkMenu, setLinkMenu] = useState<{ tabId: string; x: number; y: number; items: MenuItem[] } | null>(null);
  const linkMenuRef = useRef(linkMenu);
  linkMenuRef.current = linkMenu;
  const closeLinkMenu = useCallback(() => {
    const open = linkMenuRef.current;
    if (!open) return;
    setLinkMenu(null);
    termsRef.current.get(open.tabId)?.term.focus();
  }, []);

  // OSC 133 prompt-mark state per terminal, kept beside the terminals rather than
  // inside TermInfo so the OSC handler and the onData handler (both closures made
  // during createTerminal) read and write the same record by tab id.
  const marksRef = useRef(new Map<string, CommandMarkState>());
  // The atPrompt each terminal last reported upward (onPromptState), so the app hears
  // only a change. A tab is absent until its first mark: a terminal that has seen no
  // marks reports nothing, which the app reads as "no marks" rather than "busy".
  const promptReportedRef = useRef(new Map<string, boolean>());
  const reportPrompt = useCallback((tabId: string, atPrompt: boolean) => {
    if (promptReportedRef.current.get(tabId) === atPrompt) return;
    promptReportedRef.current.set(tabId, atPrompt);
    onPromptStateRef.current?.(tabId, atPrompt);
  }, []);

  // The jump button (Phase 9): where each terminal's viewport was on its last scroll
  // sample and which end, if any, the button offers, per tab. Only the active
  // terminal's target is rendered (`jump`), but every terminal keeps its own state
  // so switching back to a thread does not read its next scroll against a
  // stranger's position. jumpScroll.ts holds the rule; this side only samples
  // viewportY (how far from the top) and baseY (how far it can go) on xterm's own
  // scroll event, which fires for the user's scrolling and for output arriving alike.
  const jumpRef = useRef(new Map<string, JumpState>());
  const [jump, setJump] = useState<JumpTarget>(null);
  const jumpBtnRef = useRef<JumpButtonHandle>(null);
  // Only the user's own scrolling may show the button (isUserScroll in
  // jumpScroll.ts): a wheel or a key over the terminal stamps jumpInputRef, a
  // pointer down outside the screen (the scrollbar) holds jumpDragRef until
  // release. Output arriving, a refit, the animated jump: those scroll events
  // only update the sampled position.
  const jumpInputRef = useRef(0);
  const jumpDragRef = useRef(false);
  useEffect(() => {
    const release = () => { jumpDragRef.current = false; };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  }, []);

  // ── Find bar state (operates on the active tab only) ──────────────────────
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState('');
  const [matchInfo, setMatchInfo] = useState<{ current: number; total: number } | null>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const findOpenRef = useRef(findOpen);
  findOpenRef.current = findOpen;

  const openFind = useCallback(() => {
    setFindOpen(true);
    // Focus + preselect so the user can immediately type or replace the query
    requestAnimationFrame(() => findInputRef.current?.select());
  }, []);

  const closeFind = useCallback(() => {
    setFindOpen(false);
    setMatchInfo(null);
    const info = termsRef.current.get(activeRef.current);
    info?.search.clearDecorations();
    info?.term.focus();
  }, []);

  const runFind = useCallback((text: string, dir: 'next' | 'prev', incremental = false) => {
    const info = termsRef.current.get(activeRef.current);
    if (!info) return;
    if (!text) {
      info.search.clearDecorations();
      setMatchInfo(null);
      return;
    }
    if (dir === 'prev') info.search.findPrevious(text, SEARCH_OPTIONS);
    else info.search.findNext(text, { ...SEARCH_OPTIONS, incremental });
  }, []);

  // Resume is user-initiated by construction now: a terminal is only ever created
  // when the user wakes a thread (every restored thread starts asleep), so nothing
  // can cold-start N `claude` processes and their MCP servers in one burst at
  // launch, which is what used to OOM-crash the app on a loaded machine. `resumed`
  // still guards against double-injecting into one live terminal; the entry is
  // dropped when a thread sleeps, so waking it again resumes again.
  const resumedRef = useRef(new Set<string>());

  // A destroy in flight, per tab. Waking a thread the instant after it slept must
  // wait for its old PTY to be gone: main's `pty:create` puts the new PTY in its map
  // under the same tab id, and the OLD PTY's exit handler then deletes that entry
  // unconditionally, leaving the new PTY alive but unreachable (input and resize go
  // nowhere, silently).
  const pendingDestroyRef = useRef(new Map<string, Promise<void>>());
  // Terminals being built right now. createTerminal has awaits in it, so the
  // reconcile effect can run again before the new TermInfo is in the map; without
  // this a second pass would build a second terminal for the same tab.
  const creatingRef = useRef(new Set<string>());

  // A whole command line afterterm types into a shell itself (a wake's `claude
  // --resume`, a server's last command). It goes straight to the PTY, so the marks
  // are told here (onCommandSent): the shell is busy from now, or from its next
  // prompt if it has not drawn one yet, and the restart window must not read it as
  // sitting at its prompt.
  const writeCommand = useCallback((tabId: string, command: string) => {
    const marks = marksRef.current.get(tabId);
    if (marks) {
      marksRef.current.set(tabId, onCommandSent(marks));
      if (marks.atPrompt) reportPrompt(tabId, false);
    }
    window.afterterm.pty.write(tabId, command + '\r');
  }, [reportPrompt]);

  const resumeTab = useCallback((tabId: string, sessionId: string) => {
    if (resumedRef.current.has(tabId) || !UUID_RE.test(sessionId)) return;
    resumedRef.current.add(tabId);
    // Short delay lets the freshly-spawned shell print its first prompt before we type.
    setTimeout(() => writeCommand(tabId, `claude --resume ${sessionId}`), SHELL_READY_MS);
  }, [writeCommand]);

  // Sleep and close are the same routine with a different reason: hand the tail over,
  // stop listening, kill the process tree, drop the xterm. The order matters. offData
  // runs first so nothing can still be written into the buffer after it has been
  // read: main batches output on a 16ms timer and flushes what it holds when the
  // process exits, so a chunk can land between a capture and a dispose. With the
  // listener off, the captured tail is exactly what was on screen.
  const teardownTerminal = useCallback(async (tabId: string, reason: 'sleep' | 'close') => {
    const info = termsRef.current.get(tabId);
    if (!info) return;
    termsRef.current.delete(tabId);

    const api = window.afterterm;
    api.pty.offData(tabId);
    // The exit that this destroy causes must not reach the "PTY exited, close the
    // tab" path: a sleeping thread keeps its tab.
    api.pty.offExit(tabId);
    onTailRef.current(tabId, captureTail(info.term), reason);
    // A woken thread should resume its session again, so this tab stops counting as
    // already resumed the moment its terminal goes.
    resumedRef.current.delete(tabId);
    // The prompt marks describe a buffer that is about to be disposed; a fresh
    // terminal starts again from no prompt seen at all. The tab's own atPrompt is
    // cleared by sleepTab (or goes with a closed tab).
    marksRef.current.delete(tabId);
    promptReportedRef.current.delete(tabId);
    jumpRef.current.delete(tabId);
    fileLinkProvidersRef.current.delete(tabId);
    webLinkProvidersRef.current.delete(tabId);
    if (tabId === activeRef.current) setJump(null);

    const destroy = api.pty.destroy(tabId).finally(() => {
      if (pendingDestroyRef.current.get(tabId) === destroy) pendingDestroyRef.current.delete(tabId);
    });
    pendingDestroyRef.current.set(tabId, destroy);

    info.term.dispose();
    info.container.remove();
    await destroy;
  }, []);

  const createTerminal = useCallback(async (tab: TabInfo) => {
    const tabId = tab.id;
    if (termsRef.current.has(tabId) || creatingRef.current.has(tabId) || !parkRef.current) return;
    creatingRef.current.add(tabId);
    try {
      // A wake right after a sleep: the old PTY has to be gone before the new one is
      // asked for (see pendingDestroyRef).
      const pending = pendingDestroyRef.current.get(tabId);
      if (pending) await pending;
      if (termsRef.current.has(tabId) || !parkRef.current) return;

      // Straight into its column when it is on screen (a wake, a new thread),
      // otherwise into the park.
      const container = document.createElement('div');
      container.className = 'xterm-container';
      const slot = panesRef.current.includes(tabId) ? slotsRef.current.get(tabId) : undefined;
      container.style.display = slot ? '' : 'none';
      (slot ?? parkRef.current).appendChild(container);

      const term = new Terminal({
        theme: THEME,
        fontFamily: "'Cascadia Code', 'Cascadia Mono', 'Consolas', 'Courier New', monospace",
        fontSize: tab.fontSize ?? DEFAULT_FONT_SIZE,
        cursorBlink: true,
        scrollback: 5000,
        allowProposedApi: true,
        // OSC 8 hyperlinks (e.g. `ls --hyperlink`, ripgrep, modern CLIs) → open in browser
        linkHandler: {
          activate: (_event, uri) => window.afterterm.shell.openExternal(uri),
        },
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      // Debounce fit() so a burst of resize/zoom events collapses into a single
      // ConPTY resize. A touchpad pinch arrives as dozens of ctrl+wheel events;
      // a window-edge drag fires the ResizeObserver continuously. Each raw fit()
      // recomputes cols/rows → term.onResize → pty.resize → ResizePseudoConsole,
      // and the hosted TUI (Claude Code/Ink) repaints on every one. Ink's known
      // resize-redraw leak then floods scrollback with duplicated frames. Coalescing
      // to the final size means the PTY (and Ink) sees one resize, not fifty.
      let fitTimer: ReturnType<typeof setTimeout> | undefined;
      const scheduleFit = () => {
        if (fitTimer) clearTimeout(fitTimer);
        fitTimer = setTimeout(() => {
          fitTimer = undefined;
          try { fitAddon.fit(); } catch { /* container hidden or disposed */ }
        }, 80);
      };

      // A link cut over several rows (AFT-61, webLinks.ts): read whole from a chat's
      // transcript, or joined at the column it was cut at. Registered before the
      // addon below, because xterm gives a cell to the first provider with a link on
      // it, and the addon only ever has the first row's part.
      const webLinks = createWebLinkProvider(
        term,
        () => {
          const chat = fileContextRef.current?.(tabId)?.chat;
          return chat ? { sessionId: chat.sessionId, cwd: chat.cwd } : null;
        },
        url => window.afterterm.shell.openExternal(url),
      );
      term.registerLinkProvider(webLinks);
      webLinkProvidersRef.current.set(tabId, webLinks);

      // Plain URLs in output → underlined + clickable, opening the default browser
      term.loadAddon(new WebLinksAddon((_event, uri) => window.afterterm.shell.openExternal(uri)));

      // File paths in output, underlined and opened like links once they exist on
      // disk (edited files, Phase 3, fileLinks.ts). Beside the web-links addon,
      // which keeps URLs: the path recogniser leaves anything with a scheme alone.
      const fileLinks = createFileLinkProvider(
        term,
        () => fileContextRef.current?.(tabId) ?? null,
        target => onOpenFileLinkRef.current?.(target),
        trackToolLines(term),
      );
      term.registerLinkProvider(fileLinks);
      fileLinkProvidersRef.current.set(tabId, fileLinks);

      const search = new SearchAddon();
      term.loadAddon(search);
      search.onDidChangeResults(({ resultIndex, resultCount }) => {
        if (tabId === activeRef.current) {
          setMatchInfo({ current: resultCount > 0 ? resultIndex + 1 : 0, total: resultCount });
        }
      });

      term.open(container);

      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        term.loadAddon(webgl);
      } catch {
        // WebGL not available, canvas fallback is fine
      }

      // Ctrl+V paste, Ctrl+C copy (when selection exists), Ctrl+Shift+A select all,
      // Ctrl+Shift+F find. The find/select-all combos live here (not main.ts's
      // before-input-event) because they act on this terminal's xterm instance.
      term.attachCustomKeyEventHandler((event) => {
        // While the link menu is up nothing reaches the shell. An Esc to close it
        // would interrupt Claude Code, and focus can land back here while it opens
        // (a click into the other half of a split focuses this terminal late).
        if (linkMenuRef.current) return false;
        if (event.type !== 'keydown') return true;

        if (event.ctrlKey && !event.shiftKey && event.key === 'v') {
          event.preventDefault();
          navigator.clipboard.readText().then(text => {
            if (text) term.paste(text);
          });
          return false;
        }

        if (event.ctrlKey && !event.shiftKey && event.key === 'c' && term.hasSelection()) {
          navigator.clipboard.writeText(term.getSelection());
          term.clearSelection();
          return false;
        }

        if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'a') {
          event.preventDefault();
          term.selectAll();
          return false;
        }

        if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'f') {
          event.preventDefault();
          openFind();
          return false;
        }

        return true;
      });

      // A press that closes the link menu only closes it: without this, a right-click
      // to dismiss the menu would go on to paste into the terminal.
      let pressClosedMenu = false;
      container.addEventListener('mousedown', () => {
        pressClosedMenu = linkMenuRef.current !== null;
      }, { capture: true });

      // Right-click: copy the selection (and clear it) if there is one; on a file
      // link, its menu; otherwise paste, the classic Windows console QuickEdit behavior.
      container.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        if (pressClosedMenu) {
          pressClosedMenu = false;
          return;
        }
        if (term.hasSelection()) {
          navigator.clipboard.writeText(term.getSelection());
          term.clearSelection();
          return;
        }
        const { clientX: x, clientY: y } = event;
        const cell = cellAt(term, x, y);
        // Asking main can take a moment on a row it has not seen. A paste should not
        // wait long for that, so after LINK_AT_WAIT_MS the click counts as off a link.
        const giveUp = new Promise<null>(resolve => setTimeout(() => resolve(null), LINK_AT_WAIT_MS));
        void Promise.race([cell ? fileLinks.linkAt(cell.x, cell.y) : null, giveUp]).then(link => {
          const items = link ? fileLinkMenuRef.current?.(link) : undefined;
          if (items) {
            hideTip();
            term.blur();
            setLinkMenu({ tabId, x, y, items });
          } else {
            navigator.clipboard.readText().then(text => {
              if (text) term.paste(text);
            });
          }
        });
      });

      // Ctrl+scroll → zoom this tab's font size (per-tab, persisted via session.json).
      // Capture phase + preventDefault so xterm's viewport doesn't also scroll.
      container.addEventListener('wheel', (event) => {
        if (!event.ctrlKey) return;
        event.preventDefault();
        const cur = term.options.fontSize ?? DEFAULT_FONT_SIZE;
        const next = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, cur + (event.deltaY < 0 ? 1 : -1)));
        if (next !== cur) {
          term.options.fontSize = next;
          scheduleFit();
          onFontSizeChangeRef.current(tabId, next);
        }
      }, { capture: true, passive: false });

      // Drag a file/folder from Explorer → paste its absolute path (quoted if it has
      // spaces). Multiple files are space-separated, matching cmd.exe drag behavior.
      container.addEventListener('dragover', (event) => {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      });
      container.addEventListener('drop', (event) => {
        event.preventDefault();
        const files = event.dataTransfer?.files;
        if (!files || files.length === 0) return;
        const paths = Array.from(files).map(f => {
          const p = window.afterterm.files.pathForFile(f);
          return /\s/.test(p) ? `"${p}"` : p;
        });
        if (paths.length) term.paste(paths.join(' '));
      });

      termsRef.current.set(tabId, { term, fitAddon, search, container, scheduleFit });
      marksRef.current.set(tabId, initialCommandMarkState());

      // Only fit visible tabs, fitAddon on a hidden container returns 0 dimensions
      if (slot) {
        fitAddon.fit();
      }

      const api = window.afterterm;

      // Register data handler BEFORE creating the PTY, shell can emit the prompt
      // immediately on spawn and we'd miss it if the listener isn't ready
      api.pty.onData(tabId, (data) => {
        term.write(data);
        // Feed output activity to the spinner state machine (silence-clear + re-arm).
        onOutputRef.current(tabId, data.length);
      });

      // A woken thread starts with a clean terminal. Until Phase 9 the saved tail was
      // replayed here, dimmed, above a "Woke just now" divider, and the viewport was
      // scrolled back to it once ConPTY's first paint had settled; Aryan chose on
      // 2026-09-19 to drop that, since the asleep pane has already shown the same
      // tail and the replay stayed on screen after the terminal came back (the
      // Phase 9 log in docs/phases-01-projects-and-threads.md). tab.wokeAt still marks "woken this launch" for
      // the rest of the app; nothing here reads it any more.

      // Waking respawns where the thread was: claudeCwd over cwd, because
      // `claude --resume <id>` resolves the session against the *current* cwd's
      // project store (see CLAUDE.md / claude-code source), and claudeCwd is the
      // hook-reported dir, authoritative across all shells.
      const plan = wakePlan(tab);
      await api.pty.create(tabId, plan.shellId, plan.cwd);

      // A chat picks its session back up; a shell just gets a fresh prompt. The id is
      // re-validated as a UUID inside resumeTab as well (session.json is
      // hand-editable, and this becomes a typed shell command).
      if (plan.resumeSessionId) resumeTab(tabId, plan.resumeSessionId);

      // Waking a server means re-running what it was running (design-02, "Asleep":
      // "the last command re-run for a server"). wakePlan has already checked the
      // command is one safe line, so it only has to be typed here, after the same
      // wait resumeTab uses for the shell's first prompt.
      const runCommand = plan.runCommand;
      if (runCommand) {
        setTimeout(() => {
          if (!termsRef.current.has(tabId)) return;
          writeCommand(tabId, runCommand);
        }, SHELL_READY_MS);
      }

      term.onData((data) => {
        // Enter closes the command line, so it is read out of the buffer here,
        // before the write: this runs synchronously, so nothing the shell echoes
        // back can have landed in the range between the prompt mark and the cursor
        // yet. The Enter itself is always still written through, unchanged.
        if (data === '\r' || data === '\r\n') {
          const marks = marksRef.current.get(tabId);
          if (marks) {
            const result = onEnter(marks, from => readCommandText(term, from));
            marksRef.current.set(tabId, result.state);
            if (result.command) onCommandRef.current(tabId, result.command);
            // Enter at a prompt runs whatever was typed there, so the shell is busy
            // until it draws its next prompt. Only a prompt the marks opened can be
            // closed here, so a thread with no marks still reports nothing.
            if (marks.atPrompt && !result.state.atPrompt) reportPrompt(tabId, false);
          }
        } else {
          // Every other chunk is fed to the mark state as typed text, the second
          // signal onEnter uses to drop output a background process printed on the
          // prompt line while the user was typing. onInput ignores escape sequences
          // (arrows, the focus reports xterm emits on tab switch) and control
          // characters, so only real characters and pasted text land in it.
          // A chunk carrying a CR (a paste ending in a newline) submits the line
          // there, so the shell is running it: report that, as Enter does. No
          // command is captured from it (onInput says why).
          const marks = marksRef.current.get(tabId);
          if (marks) {
            const next = onInput(marks, data);
            marksRef.current.set(tabId, next);
            if (marks.atPrompt && !next.atPrompt) reportPrompt(tabId, false);
          }
        }
        api.pty.write(tabId, data);
        // Clear the working spinner, and since Phase 7 cancel a permission prompt
        // (needs-you), only on a REAL interrupt, a bare Esc ('\x1b') or
        // Ctrl+C ('\x03'). Must NOT fire on the focus-report sequences xterm emits via
        // onData when the terminal blurs on tab switch (focus-out is 'ESC [ O', focus-in
        // 'ESC [ I'), those were stopping the spinner the moment you left the tab.
        // Arrow keys etc. ('ESC [ A'…) are also multi-char and correctly excluded.
        if (data === '\x1b' || data === '\x03') {
          onUserInputRef.current(tabId);
        } else if (data === '\r' || data === '\r\n') {
          // Phase 7: Enter answers a permission prompt (spinnerState.ts, onAnswer);
          // needs-you ends only when it is answered, never on viewing. A pasted
          // block ending in a newline is not an Enter keypress and does not match.
          onAnswerRef.current(tabId);
        }
        // Any real keystroke (not an escape sequence: arrows, focus reports) is
        // the user working in this thread, which clears its unread mark.
        if (data.length > 0 && !data.startsWith('\x1b')) onTypedRef.current(tabId);
      });

      term.onResize(({ cols, rows }) => api.pty.resize(tabId, cols, rows));

      jumpRef.current.set(tabId, initialJumpState(term.buffer.active.viewportY));
      term.onScroll(() => {
        const buffer = term.buffer.active;
        const prev = jumpRef.current.get(tabId) ?? initialJumpState(buffer.viewportY);
        const userScroll = isUserScroll(jumpInputRef.current, performance.now(), jumpDragRef.current);
        const next = userScroll
          ? onScrollSample(prev, buffer.viewportY, buffer.baseY, JUMP_THRESHOLD_LINES)
          : { target: prev.target, position: buffer.viewportY };
        jumpRef.current.set(tabId, next);
        if (tabId === activeRef.current && next.target !== prev.target) setJump(next.target);
        // Still scrolling: the button stays another JUMP_IDLE_MS (JumpButton).
        if (tabId === activeRef.current && userScroll) jumpBtnRef.current?.poke();
      });
      container.addEventListener('wheel', () => { jumpInputRef.current = performance.now(); }, { passive: true, capture: true });
      container.addEventListener('keydown', () => { jumpInputRef.current = performance.now(); }, { capture: true });
      container.addEventListener('pointerdown', (e) => {
        // The screen takes clicks for selection and focus; anything else in the
        // container is the scrollbar.
        if (!(e.target instanceof Element) || !e.target.closest('.xterm-screen')) jumpDragRef.current = true;
      }, { capture: true });

      term.onTitleChange((rawTitle) => {
        const notifType = detectNotification(rawTitle);
        const projectName = notifType ? extractProjectName(rawTitle) : rawTitle;
        onNotificationRef.current(tabId, notifType, projectName);

        // NOTE: cwd is NOT captured from the title, cmd.exe sets its console title
        // to "C:\…\cmd.exe - <command>", which looks path-like but is garbage. CWD is
        // captured from the OSC reports below: 9;9 for every shell with integration,
        // OSC 7 for WSL. See CLAUDE.md.
        onTitleChangeRef.current(tabId, formatTabTitle(rawTitle));
      });

      // OSC 9;9;<path>, ConEmu-style cwd report, carrying a Windows path. Every shell
      // with integration except WSL emits it: cmd through its injected PROMPT,
      // PowerShell through a wrapped prompt function, Git Bash through a
      // PROMPT_COMMAND hook (all set up in src/shell-integration.ts), so those tabs can
      // restore to the right directory. The handler receives the OSC 9 payload, i.e.
      // "9;C:\path". Other OSC 9 uses (progress, notify) don't carry the "9;" prefix,
      // so we ignore those and let xterm handle them.
      term.parser.registerOscHandler(9, (data) => {
        if (data.startsWith('9;')) {
          const dir = data.slice(2);
          if (isWindowsDrivePath(dir)) {
            onCwdChangeRef.current(tabId, dir);
            return true;
          }
        }
        return false;
      });

      // OSC 7 "file://<host>/<path>", the cwd report WSL uses instead of 9;9. It comes
      // from afterterm's WSL PROMPT_COMMAND hook (which puts the distro name in the
      // host slot), and from any Linux tool that emits OSC 7 on its own. The payload is
      // a Linux path, so it is converted to the Windows form Tab.cwd stores: a /mnt/c
      // path becomes "C:\…", anything else becomes "\\wsl$\<distro>\…", which Explorer,
      // the editor launcher and the branch reader can all open (shell-paths.ts).
      term.parser.registerOscHandler(7, (data) => {
        const dir = osc7ToWindowsPath(data);
        if (dir) {
          onCwdChangeRef.current(tabId, dir);
          return true;
        }
        return false;
      });

      // OSC 133;A/B/C/D, the de facto shell-integration marks. Every shell with
      // integration emits A before the prompt and B after it (cmd through its injected
      // PROMPT, PowerShell through a wrapped prompt function, Git Bash and WSL through
      // a PROMPT_COMMAND hook, all in src/shell-integration.ts), which is what makes
      // the typed command line locatable in the buffer (commandMarks.ts).
      term.parser.registerOscHandler(133, (payload) => {
        const mark = parseOsc133(payload);
        if (!mark) return false;
        const buffer = term.buffer.active;
        const state = marksRef.current.get(tabId) ?? initialCommandMarkState();
        const next = onMark(state, mark, {
          row: buffer.baseY + buffer.cursorY,
          col: buffer.cursorX,
        });
        marksRef.current.set(tabId, next);
        // A B mark reports "at the prompt". One accepted limit: cmd with echo on
        // draws its prompt, marks and all, during a batch file run without @echo
        // off, so such a run reads as at the prompt (onMark, case B).
        reportPrompt(tabId, next.atPrompt);
        return true;
      });

      api.pty.onExit(tabId, () => onExitRef.current(tabId));

      // Sync initial size to PTY
      api.pty.resize(tabId, term.cols, term.rows);

      if (tabId === activeRef.current) {
        term.focus();
      }
    } finally {
      creatingRef.current.delete(tabId);
    }
  }, [openFind, resumeTab, reportPrompt, writeCommand]);

  // Reconcile the terminals with the tab list. `asleep` is the source of truth:
  // awake with no terminal → build one (a wake, or a brand new thread); asleep with
  // a terminal → sleep it; a terminal whose tab is gone → close it. Both of the last
  // two run the same teardown, only the reason differs, which is what the app uses to
  // decide whether the tail is kept.
  useEffect(() => {
    const currentIds = new Set(tabInfos.map(t => t.id));

    for (const tab of tabInfos) {
      if (tab.asleep) {
        if (termsRef.current.has(tab.id)) void teardownTerminal(tab.id, 'sleep');
      } else if (!termsRef.current.has(tab.id)) {
        void createTerminal(tab);
      }
    }

    // A copy of the keys: teardownTerminal deletes from the map as it goes.
    for (const id of [...termsRef.current.keys()]) {
      if (!currentIds.has(id)) void teardownTerminal(id, 'close');
    }
  }, [tabInfos, createTerminal, teardownTerminal]);

  // Fit every terminal on screen. Each one's fit resizes its PTY (term.onResize),
  // so this runs on a layout change, a window resize and a divider release,
  // never while the divider is moving.
  const fitVisible = useCallback(() => {
    for (const id of panesRef.current) {
      const info = termsRef.current.get(id);
      if (!info) continue;
      try { info.fitAddon.fit(); } catch { /* not laid out yet */ }
    }
  }, []);

  // Put every terminal where it belongs: in its column's card when it is on
  // screen, in the park otherwise. Runs after React has drawn the columns for
  // the new panes (a layout effect, so nothing paints in the wrong place), then
  // fits what is on screen once the browser has laid it out.
  const panesKey = panes.join('|');
  useLayoutEffect(() => {
    const park = parkRef.current;
    if (!park) return;
    for (const [id, info] of termsRef.current) {
      const slot = panesRef.current.includes(id) ? slotsRef.current.get(id) : undefined;
      const target = slot ?? park;
      if (info.container.parentElement !== target) target.appendChild(info.container);
      info.container.style.display = slot ? '' : 'none';
    }
    const frame = requestAnimationFrame(() => {
      fitVisible();
      // Moving a container drops its keyboard focus; the focused half gets it back.
      const active = document.activeElement;
      const info = termsRef.current.get(activeRef.current);
      if (info && (!active || active === document.body)) info.term.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [panesKey, fitVisible]);

  // Focus follows the active thread, which in a split is the focused half
  // (design-06): typing goes there and nowhere else. An asleep half has no
  // terminal; its pane takes the focus on its Wake button (AsleepPane), and a
  // terminal in the other half must not keep it. Switching also closes the find
  // bar (search is scoped to a single terminal).
  useEffect(() => {
    if (findOpenRef.current) {
      for (const info of termsRef.current.values()) info.search.clearDecorations();
      setFindOpen(false);
      setMatchInfo(null);
    }
    const frame = requestAnimationFrame(() => {
      const info = termsRef.current.get(activeTabId);
      if (info) { info.term.focus(); return; }
      const el = document.activeElement;
      if (el instanceof HTMLElement && el.closest('.xterm')) el.blur();
    });
    return () => cancelAnimationFrame(frame);
  }, [activeTabId]);

  // The jump button follows the active terminal. Switching threads re-bases the
  // new one's sample on where its viewport is now and starts it hidden: the next
  // scroll decides the direction, not the last one made before switching away.
  useEffect(() => {
    const info = termsRef.current.get(activeTabId);
    if (info) jumpRef.current.set(activeTabId, initialJumpState(info.term.buffer.active.viewportY));
    setJump(null);
  }, [activeTabId]);

  // A jump scrolls, it does not teleport (Aryan, 2026-09-19). xterm has no smooth
  // scrolling of its own, so the viewport is moved line by line on animation
  // frames along an ease-out curve (jumpLineAt), instant under reduced motion. A
  // second click, or a jump on another thread, cancels the one in flight; the
  // scroll events fired along the way resample the button, which hides on arrival.
  const jumpFrameRef = useRef<number | null>(null);
  const jumpTo = useCallback((target: 'top' | 'bottom') => {
    const info = termsRef.current.get(activeRef.current);
    if (!info) return;
    const term = info.term;
    if (jumpFrameRef.current !== null) cancelAnimationFrame(jumpFrameRef.current);
    const from = term.buffer.active.viewportY;
    const to = target === 'top' ? 0 : term.buffer.active.baseY;
    // The button shrinks away as the jump starts; the scroll events along the
    // way are not the user's and only track the position.
    jumpRef.current.set(activeRef.current, initialJumpState(from));
    setJump(null);
    const duration = prefersReducedMotion() ? 0 : jumpDurationMs(to - from);
    if (duration === 0) {
      if (target === 'top') term.scrollToTop(); else term.scrollToBottom();
      return;
    }
    const started = performance.now();
    const step = (now: number) => {
      // The terminal may have been torn down mid-jump (sleep, close).
      if (!termsRef.current.has(activeRef.current) || termsRef.current.get(activeRef.current)?.term !== term) return;
      const elapsed = now - started;
      // Output arriving during a jump to the bottom moves the bottom; re-read it.
      const end = target === 'top' ? 0 : term.buffer.active.baseY;
      term.scrollToLine(jumpLineAt(from, end, elapsed, duration));
      if (elapsed < duration) jumpFrameRef.current = requestAnimationFrame(step);
      else jumpFrameRef.current = null;
    };
    jumpFrameRef.current = requestAnimationFrame(step);
  }, []);

  // A wheel event over the jump button scrolls the active terminal as if the
  // button were not there, so it never interrupts scrolling. The native event
  // never reaches xterm (the button is a sibling of the terminal host, not a
  // child of it), and replaying a constructed WheelEvent onto xterm does nothing
  // (see wheelToLines), so the lines are computed with xterm's own maths and
  // applied through scrollLines. The cell height is the screen's height over
  // the row count, which holds for the WebGL renderer too.
  const wheelCarryRef = useRef(0);
  const wheelToTerminal = useCallback((deltaY: number, _deltaX: number, deltaMode: number) => {
    const info = termsRef.current.get(activeRef.current);
    if (!info) return;
    jumpInputRef.current = performance.now();
    const screen = info.container.querySelector('.xterm-screen');
    const cellHeight = screen ? screen.clientHeight / Math.max(1, info.term.rows) : 0;
    const { lines, carry } = wheelToLines(deltaY, deltaMode, cellHeight, info.term.rows, wheelCarryRef.current);
    wheelCarryRef.current = carry;
    if (lines !== 0) info.term.scrollLines(lines);
  }, []);

  // Coming back from another screen. The workspace is hidden with display: none
  // while Home or a project page shows, and FitAddon on a hidden container
  // measures 0, so the active terminal is left at the size it had. Refit it once
  // the container is on screen again (RAF, so the browser has reflowed first) and
  // give it the keyboard back: the click that brought us here was on a button
  // that has just unmounted.
  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => {
      // Every terminal on screen: in a split the focused half may be asleep
      // while the other half's terminal still needs its size back.
      fitVisible();
      // Only take the keyboard when nothing else holds it: Ctrl+Shift+T from Home
      // switches to the workspace and opens the new thread chooser in the same
      // breath, and its input must keep focus (Escape and Enter go to it).
      const info = termsRef.current.get(activeTabId);
      const active = document.activeElement;
      if (info && (!active || active === document.body)) info.term.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [visible, activeTabId, fitVisible]);

  // Resize the terminals on screen when the pane resizes (the window, the
  // panel sliding). The divider does not resize the pane, only its columns, and
  // is handled on its own below.
  useEffect(() => {
    if (!rootRef.current) return;
    const observer = new ResizeObserver(() => {
      if (dividingRef.current) return;
      for (const id of panesRef.current) termsRef.current.get(id)?.scheduleFit();
    });
    observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, []);

  // The divider between two halves (design-06): drag between a quarter and
  // three quarters; the columns follow the pointer directly (no render per
  // move), and the terminals refit and their PTYs resize once, on release. A
  // double-click puts it back at half and half. Pointer capture keeps the drag
  // going over the terminals' canvases.
  const onDividerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || panes.length !== 2) return;
    e.preventDefault();
    const handle = e.currentTarget;
    const row = handle.parentElement;
    const [a, b] = panes.map(id => colsRef.current.get(id));
    if (!row || !a || !b) return;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('active');
    document.body.classList.add('dividing');
    dividingRef.current = true;
    const rect = row.getBoundingClientRect();
    const style = getComputedStyle(row);
    const left = rect.left + parseFloat(style.paddingLeft);
    const width = rect.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    let f = ratio;
    const move = (ev: PointerEvent) => {
      f = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, (ev.clientX - left) / width));
      a.style.flex = `${f} 1 0`;
      b.style.flex = `${1 - f} 1 0`;
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      handle.classList.remove('active');
      document.body.classList.remove('dividing');
      dividingRef.current = false;
      onRatioRef.current(f);
      requestAnimationFrame(fitVisible);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };
  const onDividerDoubleClick = () => {
    const [a, b] = panes.map(id => colsRef.current.get(id));
    if (a) a.style.flex = `${SPLIT_DEFAULT} 1 0`;
    if (b) b.style.flex = `${SPLIT_DEFAULT} 1 0`;
    onRatioRef.current(SPLIT_DEFAULT);
    requestAnimationFrame(fitVisible);
  };

  // What the app reads at quit time, when every awake thread's screen has to reach
  // disk before the window goes.
  useImperativeHandle(ref, (): TerminalAreaHandle => ({
    readTail: (tabId) => {
      const info = termsRef.current.get(tabId);
      return info ? captureTail(info.term) : null;
    },
    readAllTails: () => {
      const tails: Record<string, string[]> = {};
      for (const [id, info] of termsRef.current) tails[id] = captureTail(info.term);
      return tails;
    },
    focusActive: () => { termsRef.current.get(activeRef.current)?.term.focus(); },
  }), []);

  // Read by scripts/agent-harness/drive.mjs, which drives the app for phase testing
  // and has no other way to see what a terminal is showing (the xterm buffer is not
  // in the DOM as text). Returns null when the thread has no terminal, which is
  // itself the answer to "is it asleep".
  useEffect(() => {
    const readTail = (tabId: string, n: number): string[] | null => {
      const info = termsRef.current.get(tabId);
      return info ? captureTail(info.term, n) : null;
    };
    const win = window as unknown as {
      __afterterm?: {
        tail(tabId: string, n?: number): string[] | null;
        activeTail(n?: number): string[] | null;
        commandState(tabId: string): CommandMarkState | null;
        viewport(tabId?: string): { viewportY: number; baseY: number } | null;
        fileLinks(tabId: string, row: number): Promise<{ text: string; range: unknown }[]>;
        webLinks(tabId: string, row: number): Promise<{ text: string; range: unknown }[]>;
        openFileLink(tabId: string, row: number, index?: number): Promise<boolean>;
        cellCentre(tabId: string, row: number, col: number): { x: number; y: number } | null;
        findRow(tabId: string, text: string): number;
      };
    };
    // Extended, never replaced: app.tsx hangs its own harness value
    // (lastOpenExternal) on the same object, and this effect can run after it has.
    win.__afterterm = {
      ...(win.__afterterm ?? {}),
      tail: (tabId, n = 30) => readTail(tabId, n),
      activeTail: (n = 30) => readTail(activeRef.current, n),
      // Lets the harness check the OSC 133 marks landed without reading the buffer.
      // What reached the app from them is the tab's atPrompt (window.__afterterm.tab).
      commandState: (tabId) => marksRef.current.get(tabId) ?? null,
      // Phase 9: where a terminal's viewport sits (the jump button's own inputs),
      // since xterm 6 no longer mirrors it on .xterm-viewport's scrollTop.
      viewport: (tabId = activeRef.current) => {
        const info = termsRef.current.get(tabId);
        if (!info) return null;
        const buffer = info.term.buffer.active;
        return { viewportY: buffer.viewportY, baseY: buffer.baseY };
      },
      // Edited files, Phase 3: the file links on one 1-based buffer row, as xterm
      // would get them on a hover, and a click on one of them.
      fileLinks: (tabId, row) => new Promise(resolve => {
        const provider = fileLinkProvidersRef.current.get(tabId);
        if (!provider) { resolve([]); return; }
        provider.provideLinks(row, links => resolve((links ?? []).map(l => ({ text: l.text, range: l.range }))));
      }),
      // AFT-61: the links cut over several rows that reach one 1-based row, the
      // way xterm gets them on a hover (the addon's one-row links are not here).
      webLinks: (tabId, row) => new Promise(resolve => {
        const provider = webLinkProvidersRef.current.get(tabId);
        if (!provider) { resolve([]); return; }
        provider.provideLinks(row, links => resolve((links ?? []).map(l => ({ text: l.text, range: l.range }))));
      }),
      openFileLink: (tabId, row, index = 0) => new Promise(resolve => {
        const provider = fileLinkProvidersRef.current.get(tabId);
        if (!provider) { resolve(false); return; }
        provider.provideLinks(row, links => {
          const link = links?.[index];
          if (!link) { resolve(false); return; }
          link.activate(new MouseEvent('click', { button: 0 }), link.text);
          resolve(true);
        });
      }),
      // Where one 1-based buffer cell is on the page, so `drive cell` can point a real
      // mouse at it. Null when the row is scrolled out of view.
      cellCentre: (tabId, row, col) => {
        const info = termsRef.current.get(tabId);
        const screen = info?.term.element?.querySelector('.xterm-screen');
        if (!info || !screen) return null;
        const y = row - 1 - info.term.buffer.active.viewportY;
        if (y < 0 || y >= info.term.rows) return null;
        const r = screen.getBoundingClientRect();
        return { x: r.left + (col - 0.5) * (r.width / info.term.cols), y: r.top + (y + 0.5) * (r.height / info.term.rows) };
      },
      // The last 1-based buffer row whose text contains `text`, or 0.
      findRow: (tabId, text) => {
        const info = termsRef.current.get(tabId);
        if (!info) return 0;
        const buffer = info.term.buffer.active;
        for (let y = buffer.length - 1; y >= 0; y--) {
          if ((buffer.getLine(y)?.translateToString(true) ?? '').includes(text)) return y + 1;
        }
        return 0;
      },
    };
  }, []);

  // Cleanup all terminals on unmount
  useEffect(() => {
    return () => {
      for (const [id, info] of termsRef.current) {
        window.afterterm.pty.offData(id);
        window.afterterm.pty.offExit(id);
        window.afterterm.pty.destroy(id);
        info.term.dispose();
        info.container.remove();
      }
      termsRef.current.clear();
    };
  }, []);

  const split = panes.length === 2;
  const asleepIds = new Set(tabInfos.filter(t => t.asleep).map(t => t.id));
  const findBar = findOpen && (
    <div className="find-bar">
      <input
        ref={findInputRef}
        className="find-input"
        type="text"
        placeholder="Find"
        value={findText}
        autoFocus
        onChange={(e) => {
          setFindText(e.target.value);
          runFind(e.target.value, 'next', true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
          else if (e.key === 'Enter') {
            e.preventDefault();
            runFind(findText, e.shiftKey ? 'prev' : 'next');
          }
        }}
      />
      <span className="find-count">
        {findText ? (matchInfo ? `${matchInfo.current}/${matchInfo.total}` : '…') : ''}
      </span>
      <button className="find-btn" title="Previous (Shift+Enter)" onClick={() => runFind(findText, 'prev')}>↑</button>
      <button className="find-btn" title="Next (Enter)" onClick={() => runFind(findText, 'next')}>↓</button>
      <button className="find-btn" title="Close (Esc)" onClick={closeFind}>✕</button>
    </div>
  );
  // A lone thread's drop zone covers half its card; with a split on screen the
  // refused zone covers both columns (the mockup's .dz).
  const halfZone = !split && dropZone?.kind === 'half' ? dropZone : null;

  return (
    <div
      ref={rootRef}
      className={`term-panes${panes.length ? '' : ' empty'}${split ? ' split' : ''}`}
      data-panes={panes.join(' ')}
    >
      {/* React never touches this node's children: terminals that are not on
          screen are parked here. */}
      <div ref={parkRef} className="terminal-park" />

      {panes.map((id, i) => {
        const focused = id === activeTabId;
        const asleep = asleepIds.has(id);
        const flex = split ? (i === 0 ? ratio : 1 - ratio) : 1;
        return (
          <React.Fragment key={id}>
            {i === 1 && (
              <div
                className="term-divider"
                data-tip="Drag to resize"
                onPointerDown={onDividerDown}
                onDoubleClick={onDividerDoubleClick}
              />
            )}
            <div
              ref={el => { if (el) colsRef.current.set(id, el); else colsRef.current.delete(id); }}
              className={`term-col${focused ? ' fcol' : ''}`}
              data-pane={id}
              style={{ flex: `${flex} 1 0` }}
              onPointerDownCapture={() => { if (id !== activeRef.current) onFocusPane(id); }}
            >
              {renderHeader(id, split)}
              <div className={`term-card${split && focused ? ' focus' : ''}`}>
                {/* React never touches this node's children either: the
                    thread's terminal is moved in here while it is on screen. */}
                <div
                  ref={el => { if (el) slotsRef.current.set(id, el); else slotsRef.current.delete(id); }}
                  className="terminal-host"
                />
                {asleep && renderAsleep(id, focused)}
                {focused && !asleep && (
                  <JumpButton ref={jumpBtnRef} target={jump} onJump={jumpTo} onWheel={wheelToTerminal} />
                )}
                {focused && !asleep && findBar}
                {halfZone && (
                  <div className={`dz${halfZone.bad ? ' bad' : ` ${halfZone.side}`}`} data-dz={halfZone.bad ? 'bad' : halfZone.side} />
                )}
                {halfZone?.bad && <div className="dz-text"><span className="lab">{halfZone.bad}</span></div>}
              </div>
            </div>
          </React.Fragment>
        );
      })}

      {split && dropZone?.kind === 'whole' && (
        <>
          <div className="dz bad whole" data-dz="bad" />
          <div className="dz-text whole"><span className="lab">{dropZone.bad}</span></div>
        </>
      )}

      {linkMenu && <Menu x={linkMenu.x} y={linkMenu.y} items={linkMenu.items} onClose={closeLinkMenu} />}
    </div>
  );
});

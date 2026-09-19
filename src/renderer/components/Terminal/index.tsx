import { useRef, useEffect, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
import { Terminal } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon, ISearchOptions } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import { TabNotification } from '../TabBar/types';
import { wakePlan } from '../../sleepWake';
import {
  parseOsc133, initialCommandMarkState, onMark, onEnter, onInput,
  type CommandMarkState,
} from '../../commandMarks';
import { TAIL_MAX_LINES, renderTailForTerminal } from '../../../thread-tail';
import { isWindowsDrivePath, osc7ToWindowsPath } from '../../../shell-paths';

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
  // Set for one render when a thread wakes (or comes back from history), which is
  // the cue to replay its saved scrollback tail above a "Woke just now" divider.
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
}

interface TerminalAreaProps {
  tabs: TabInfo[];
  activeTabId: string;
  // False while another screen (Home, a project page) is showing. The area stays
  // mounted so the terminals keep running, but a hidden container measures 0, so
  // the active terminal is refit and refocused when it comes back.
  visible: boolean;
  // True while the active thread is asleep: the AsleepPane is showing in this
  // thread's place, so the whole terminal card (find bar included) goes away.
  hidden: boolean;
  onTitleChange: (tabId: string, title: string) => void;
  onCwdChange: (tabId: string, cwd: string) => void;
  onNotification: (tabId: string, type: TabNotification | undefined, projectName: string) => void;
  onUserInput: (tabId: string) => void;
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

// How long after the spawn the viewport is scrolled back to a woken thread's replay:
// cmd.exe's clear and banner arrive well inside this, and the resume command is
// typed at 700 ms, after it.
const REPLAY_SCROLL_MS = 450;

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
  { tabs: tabInfos, activeTabId, visible, hidden, onTitleChange, onCwdChange, onNotification, onUserInput, onOutput, onFontSizeChange, onExit, onTail, onCommand },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termsRef = useRef(new Map<string, TermInfo>());
  const activeRef = useRef(activeTabId);
  activeRef.current = activeTabId;

  const onTitleChangeRef = useRef(onTitleChange);
  onTitleChangeRef.current = onTitleChange;
  const onCwdChangeRef = useRef(onCwdChange);
  onCwdChangeRef.current = onCwdChange;
  const onNotificationRef = useRef(onNotification);
  onNotificationRef.current = onNotification;
  const onUserInputRef = useRef(onUserInput);
  onUserInputRef.current = onUserInput;
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

  // OSC 133 prompt-mark state per terminal, kept beside the terminals rather than
  // inside TermInfo so the OSC handler and the onData handler (both closures made
  // during createTerminal) read and write the same record by tab id.
  const marksRef = useRef(new Map<string, CommandMarkState>());

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

  const resumeTab = useCallback((tabId: string, sessionId: string) => {
    if (resumedRef.current.has(tabId) || !UUID_RE.test(sessionId)) return;
    resumedRef.current.add(tabId);
    // Short delay lets the freshly-spawned shell print its first prompt before we type.
    setTimeout(() => window.afterterm.pty.write(tabId, `claude --resume ${sessionId}\r`), SHELL_READY_MS);
  }, []);

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
    // terminal starts again from no prompt seen at all.
    marksRef.current.delete(tabId);

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
    if (termsRef.current.has(tabId) || creatingRef.current.has(tabId) || !hostRef.current) return;
    creatingRef.current.add(tabId);
    try {
      // A wake right after a sleep: the old PTY has to be gone before the new one is
      // asked for (see pendingDestroyRef).
      const pending = pendingDestroyRef.current.get(tabId);
      if (pending) await pending;
      if (termsRef.current.has(tabId) || !hostRef.current) return;

      const container = document.createElement('div');
      container.className = 'xterm-container';
      container.style.display = tabId === activeRef.current ? '' : 'none';
      hostRef.current.appendChild(container);

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

      // Plain URLs in output → underlined + clickable, opening the default browser
      term.loadAddon(new WebLinksAddon((_event, uri) => window.afterterm.shell.openExternal(uri)));

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

      // Right-click: copy the selection (and clear it) if there is one, otherwise
      // paste, the classic Windows console QuickEdit behavior.
      container.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        if (term.hasSelection()) {
          navigator.clipboard.writeText(term.getSelection());
          term.clearSelection();
        } else {
          navigator.clipboard.readText().then(text => {
            if (text) term.paste(text);
          });
        }
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
      if (tabId === activeRef.current) {
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

      // A woken thread replays what was on its screen when it went to sleep, dimmed,
      // with a divider under it, so waking looks like coming back to the same desk
      // rather than opening a blank terminal. Written before the shell spawns so the
      // fresh prompt lands under the divider.
      //
      // ConPTY does not append to whatever the terminal already shows: it paints its
      // own viewport with absolute cursor positions and clears the screen when the
      // shell starts, so a tail left in the viewport would be wiped by the first
      // paint (seen in the Phase 4 test: only the cmd banner survived). The replay is
      // therefore pushed into scrollback with a screenful of newlines before the
      // spawn (ConPTY's clear is a viewport erase, which leaves scrollback alone), and
      // once the first paint has settled the viewport is scrolled back up so the
      // tail, the divider and the fresh prompt are on screen together.
      let replayLines = 0;
      if (tab.wokeAt) {
        const tail = await window.afterterm.threads.readTail(tabId);
        // Slept again while the file was being read: the teardown has already run,
        // so there must be no PTY left behind for it.
        if (!termsRef.current.has(tabId)) return;
        const lines = tail ?? [];
        replayLines = lines.length + 2;
        term.write(renderTailForTerminal(lines, 'Woke just now', term.cols) + '\r\n'.repeat(term.rows));
      }

      // Waking respawns where the thread was: claudeCwd over cwd, because
      // `claude --resume <id>` resolves the session against the *current* cwd's
      // project store (see CLAUDE.md / claude-code source), and claudeCwd is the
      // hook-reported dir, authoritative across all shells.
      const plan = wakePlan(tab);
      await api.pty.create(tabId, plan.shellId, plan.cwd);

      // Bring the replay back into view once ConPTY's first paint (the clear and the
      // shell banner) has landed. Only for the thread on screen: a background wake is
      // scrolled to the bottom like any terminal, and the user finds the tail above.
      if (replayLines > 0) {
        setTimeout(() => {
          if (tabId !== activeRef.current || !termsRef.current.has(tabId)) return;
          term.scrollLines(-replayLines);
        }, REPLAY_SCROLL_MS);
      }

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
          window.afterterm.pty.write(tabId, runCommand + '\r');
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
          }
        } else {
          // Every other chunk is fed to the mark state as typed text, the second
          // signal onEnter uses to drop output a background process printed on the
          // prompt line while the user was typing. onInput ignores escape sequences
          // (arrows, the focus reports xterm emits on tab switch) and control
          // characters, so only real characters and pasted text land in it.
          const marks = marksRef.current.get(tabId);
          if (marks) marksRef.current.set(tabId, onInput(marks, data));
        }
        api.pty.write(tabId, data);
        // Clear the working spinner only on a REAL interrupt, a bare Esc ('\x1b') or
        // Ctrl+C ('\x03'). Must NOT fire on the focus-report sequences xterm emits via
        // onData when the terminal blurs on tab switch (focus-out is 'ESC [ O', focus-in
        // 'ESC [ I'), those were stopping the spinner the moment you left the tab.
        // Arrow keys etc. ('ESC [ A'…) are also multi-char and correctly excluded.
        if (data === '\x1b' || data === '\x03') {
          onUserInputRef.current(tabId);
        }
      });

      term.onResize(({ cols, rows }) => api.pty.resize(tabId, cols, rows));

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
        marksRef.current.set(tabId, onMark(state, mark, {
          row: buffer.baseY + buffer.cursorY,
          col: buffer.cursorX,
        }));
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
  }, [openFind, resumeTab]);

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

  // Show/hide + focus on active tab change. Switching tabs also closes the find bar
  // (search is scoped to a single terminal).
  useEffect(() => {
    if (findOpenRef.current) {
      termsRef.current.get(activeTabId)?.search.clearDecorations();
      setFindOpen(false);
      setMatchInfo(null);
    }
    for (const [id, info] of termsRef.current) {
      if (id === activeTabId) {
        info.container.style.display = '';
        // RAF ensures the browser has reflowed display:none→'' before xterm measures
        requestAnimationFrame(() => {
          info.fitAddon.fit();
          info.term.focus();
        });
      } else {
        info.container.style.display = 'none';
      }
    }
  }, [activeTabId]);

  // Coming back from another screen. The workspace is hidden with display: none
  // while Home or a project page shows, and FitAddon on a hidden container
  // measures 0, so the active terminal is left at the size it had. Refit it once
  // the container is on screen again (RAF, so the browser has reflowed first) and
  // give it the keyboard back: the click that brought us here was on a button
  // that has just unmounted.
  useEffect(() => {
    if (!visible) return;
    const info = termsRef.current.get(activeTabId);
    if (!info) return;
    const frame = requestAnimationFrame(() => {
      try { info.fitAddon.fit(); } catch { /* container not laid out yet */ }
      // Only take the keyboard when nothing else holds it: Ctrl+Shift+T from Home
      // switches to the workspace and opens the new thread chooser in the same
      // breath, and its input must keep focus (Escape and Enter go to it).
      const active = document.activeElement;
      if (!active || active === document.body) info.term.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [visible, activeTabId]);

  // Resize active terminal when the wrapper resizes
  useEffect(() => {
    if (!hostRef.current) return;

    const observer = new ResizeObserver(() => {
      const info = termsRef.current.get(activeRef.current);
      if (info) {
        info.scheduleFit();
      }
    });

    observer.observe(hostRef.current);
    return () => observer.disconnect();
  }, []);

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
      };
    };
    // Extended, never replaced: app.tsx hangs its own harness value
    // (lastOpenExternal) on the same object, and this effect can run after it has.
    win.__afterterm = {
      ...(win.__afterterm ?? {}),
      tail: (tabId, n = 30) => readTail(tabId, n),
      activeTail: (n = 30) => readTail(activeRef.current, n),
      // Lets the harness check the OSC 133 marks landed without reading the buffer.
      commandState: (tabId) => marksRef.current.get(tabId) ?? null,
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

  return (
    <div className={`terminal-instances${hidden ? ' asleep-hidden' : ''}`}>
      {/* React never touches this node's children, terminal containers are appended
          imperatively. The find bar lives as a sibling so React can manage it freely. */}
      <div ref={hostRef} className="terminal-host" />

      {findOpen && (
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
      )}
    </div>
  );
});

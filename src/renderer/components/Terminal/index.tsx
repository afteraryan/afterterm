import { useRef, useEffect, useCallback, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon, ISearchOptions } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import { TabNotification } from '../TabBar/types';

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
}

interface TerminalAreaProps {
  tabs: TabInfo[];
  activeTabId: string;
  onTitleChange: (tabId: string, title: string) => void;
  onCwdChange: (tabId: string, cwd: string) => void;
  onNotification: (tabId: string, type: TabNotification | undefined, projectName: string) => void;
  onUserInput: (tabId: string) => void;
  // Fires on every PTY output chunk (byteLen = chunk size), drives the working-
  // spinner's silence-clear and resume-based re-arm (see spinnerState.ts).
  onOutput: (tabId: string, byteLen: number) => void;
  onFontSizeChange: (tabId: string, fontSize: number) => void;
  onExit: (tabId: string) => void;
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

export function TerminalArea({ tabs: tabInfos, activeTabId, onTitleChange, onCwdChange, onNotification, onUserInput, onOutput, onFontSizeChange, onExit }: TerminalAreaProps) {
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

  // Lazy Claude-session resume. Resuming every saved session at once cold-starts N
  // `claude` processes (+ their MCP servers) simultaneously, which can OOM-crash the
  // app on a loaded machine. So we resume only the active tab on launch and defer the
  // rest until first activated. pendingResume: tabId -> sessionId awaiting activation;
  // resumed: guards against double-injecting.
  const pendingResumeRef = useRef(new Map<string, string>());
  const resumedRef = useRef(new Set<string>());

  const resumeTab = useCallback((tabId: string, sessionId: string) => {
    if (resumedRef.current.has(tabId) || !UUID_RE.test(sessionId)) return;
    resumedRef.current.add(tabId);
    // Short delay lets the freshly-spawned shell print its first prompt before we type.
    setTimeout(() => window.afterterm.pty.write(tabId, `claude --resume ${sessionId}\r`), 700);
  }, []);

  const createTerminal = useCallback(async (tabId: string, shellId?: string, cwd?: string, fontSize?: number, claudeSessionId?: string, claudeCwd?: string) => {
    if (termsRef.current.has(tabId) || !hostRef.current) return;

    const container = document.createElement('div');
    container.className = 'xterm-container';
    container.style.display = tabId === activeRef.current ? '' : 'none';
    hostRef.current.appendChild(container);

    const term = new Terminal({
      theme: THEME,
      fontFamily: "'Cascadia Code', 'Cascadia Mono', 'Consolas', 'Courier New', monospace",
      fontSize: fontSize ?? DEFAULT_FONT_SIZE,
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

    // Resume-on-restart: a tab carrying a saved Claude session must relaunch in that
    // session's own directory, because `claude --resume <id>` resolves the session
    // against the *current* cwd's project store (see CLAUDE.md / claude-code source).
    // claudeCwd is the hook-reported dir, authoritative across all shells.
    const spawnCwd = claudeCwd ?? cwd;
    await api.pty.create(tabId, shellId, spawnCwd);

    // Resume the Claude session, lazily. The tab you're looking at resumes now;
    // background tabs are deferred until you first switch to them (see resumeTab and
    // the activeTabId effect), so we never cold-start N sessions in one burst. The id
    // is re-validated as a UUID inside resumeTab (session.json is hand-editable, and
    // this becomes a typed shell command).
    if (claudeSessionId && UUID_RE.test(claudeSessionId)) {
      if (tabId === activeRef.current) resumeTab(tabId, claudeSessionId);
      else pendingResumeRef.current.set(tabId, claudeSessionId);
    }

    term.onData((data) => {
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
      // captured from the OSC 9;9 report below (cmd.exe only). See CLAUDE.md.
      onTitleChangeRef.current(tabId, formatTabTitle(rawTitle));
    });

    // OSC 9;9;<path>, ConEmu-style cwd report. cmd.exe emits this via its injected
    // PROMPT (see main.ts) so its tabs can restore to the right directory. The handler
    // receives the OSC 9 payload, i.e. "9;C:\path". Other OSC 9 uses (progress, notify)
    // don't carry the "9;" prefix, so we ignore those and let xterm handle them.
    term.parser.registerOscHandler(9, (data) => {
      if (data.startsWith('9;')) {
        const dir = data.slice(2);
        if (/^[A-Za-z]:\\/.test(dir)) {
          onCwdChangeRef.current(tabId, dir);
          return true;
        }
      }
      return false;
    });

    api.pty.onExit(tabId, () => onExitRef.current(tabId));

    // Sync initial size to PTY
    api.pty.resize(tabId, term.cols, term.rows);

    if (tabId === activeRef.current) {
      term.focus();
    }
  }, [openFind, resumeTab]);

  // Sync terminals with tab list, create new, destroy removed
  useEffect(() => {
    const currentIds = new Set(tabInfos.map(t => t.id));
    const existingIds = new Set(termsRef.current.keys());

    for (const tab of tabInfos) {
      if (!existingIds.has(tab.id)) {
        createTerminal(tab.id, tab.shellId, tab.cwd, tab.fontSize, tab.claudeSessionId, tab.claudeCwd);
      }
    }

    for (const id of existingIds) {
      if (!currentIds.has(id)) {
        const info = termsRef.current.get(id)!;
        window.afterterm.pty.offData(id);
        window.afterterm.pty.destroy(id);
        info.term.dispose();
        info.container.remove();
        termsRef.current.delete(id);
      }
    }
  }, [tabInfos, createTerminal]);

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

    // Lazy resume: a background Claude tab resumes the first time you open it.
    const pending = pendingResumeRef.current.get(activeTabId);
    if (pending) {
      pendingResumeRef.current.delete(activeTabId);
      resumeTab(activeTabId, pending);
    }
  }, [activeTabId, resumeTab]);

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

  // Cleanup all terminals on unmount
  useEffect(() => {
    return () => {
      for (const [id, info] of termsRef.current) {
        window.afterterm.pty.offData(id);
        window.afterterm.pty.destroy(id);
        info.term.dispose();
        info.container.remove();
      }
      termsRef.current.clear();
    };
  }, []);

  return (
    <div className="terminal-instances">
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
}

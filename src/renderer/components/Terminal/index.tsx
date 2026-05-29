import { useRef, useEffect, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { TabNotification } from '../TabBar/types';

interface TermInfo {
  term: Terminal;
  fitAddon: FitAddon;
  container: HTMLDivElement;
}

interface TabInfo {
  id: string;
  shellId?: string;
  cwd?: string;
}

interface TerminalAreaProps {
  tabs: TabInfo[];
  activeTabId: string;
  onTitleChange: (tabId: string, title: string) => void;
  onCwdChange: (tabId: string, cwd: string) => void;
  onNotification: (tabId: string, type: TabNotification | undefined, projectName: string) => void;
  onUserInput: (tabId: string) => void;
  onExit: (tabId: string) => void;
}

const NOTIF_PREFIXES: [string, TabNotification][] = [
  ['✅', 'done'],       // ✅
  ['⚠', 'attention'],  // ⚠
  ['⏳', 'background'], // ⏳
  ['⚙', 'compacting'], // ⚙
  ['▶', 'working'],    // ▶ emitted by UserPromptSubmit hook
];

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
  background: '#141414',
  foreground: '#e0e0e0',
  cursor: '#e0e0e0',
  cursorAccent: '#141414',
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

export function TerminalArea({ tabs: tabInfos, activeTabId, onTitleChange, onCwdChange, onNotification, onUserInput, onExit }: TerminalAreaProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
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
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  const createTerminal = useCallback(async (tabId: string, shellId?: string, cwd?: string) => {
    if (termsRef.current.has(tabId) || !wrapperRef.current) return;

    const container = document.createElement('div');
    container.className = 'xterm-container';
    container.style.display = tabId === activeRef.current ? '' : 'none';
    wrapperRef.current.appendChild(container);

    const term = new Terminal({
      theme: THEME,
      fontFamily: "'Cascadia Code', 'Cascadia Mono', 'Consolas', 'Courier New', monospace",
      fontSize: 14,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);

    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      // WebGL not available — canvas fallback is fine
    }

    // Ctrl+V paste, Ctrl+C copy (when selection exists)
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

      return true;
    });

    termsRef.current.set(tabId, { term, fitAddon, container });

    // Only fit visible tabs — fitAddon on a hidden container returns 0 dimensions
    if (tabId === activeRef.current) {
      fitAddon.fit();
    }

    const api = window.afterterm;

    // Register data handler BEFORE creating the PTY — shell can emit the prompt
    // immediately on spawn and we'd miss it if the listener isn't ready
    api.pty.onData(tabId, (data) => term.write(data));

    await api.pty.create(tabId, shellId, cwd);

    term.onData((data) => {
      api.pty.write(tabId, data);
      onUserInputRef.current(tabId);
    });

    term.onResize(({ cols, rows }) => api.pty.resize(tabId, cols, rows));

    term.onTitleChange((rawTitle) => {
      const notifType = detectNotification(rawTitle);
      const projectName = notifType ? extractProjectName(rawTitle) : rawTitle;
      onNotificationRef.current(tabId, notifType, projectName);

      // NOTE: cwd is NOT captured from the title — cmd.exe sets its console title
      // to "C:\…\cmd.exe - <command>", which looks path-like but is garbage. CWD is
      // captured from the OSC 9;9 report below (cmd.exe only). See CLAUDE.md.
      onTitleChangeRef.current(tabId, formatTabTitle(rawTitle));
    });

    // OSC 9;9;<path> — ConEmu-style cwd report. cmd.exe emits this via its injected
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
  }, []);

  // Sync terminals with tab list — create new, destroy removed
  useEffect(() => {
    const currentIds = new Set(tabInfos.map(t => t.id));
    const existingIds = new Set(termsRef.current.keys());

    for (const tab of tabInfos) {
      if (!existingIds.has(tab.id)) {
        createTerminal(tab.id, tab.shellId, tab.cwd);
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

  // Show/hide + focus on active tab change
  useEffect(() => {
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

  // Resize active terminal when the wrapper resizes
  useEffect(() => {
    if (!wrapperRef.current) return;

    const observer = new ResizeObserver(() => {
      const info = termsRef.current.get(activeRef.current);
      if (info) {
        info.fitAddon.fit();
      }
    });

    observer.observe(wrapperRef.current);
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

  return <div ref={wrapperRef} className="terminal-instances" />;
}

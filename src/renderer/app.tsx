import React, { useState, useCallback, useEffect, useRef } from 'react';
import { SidePanel } from './components/SidePanel';
import type { SidePanelHandle } from './components/SidePanel';
import { Rail } from './components/Rail';
import { TerminalArea } from './components/Terminal';
import type { TerminalAreaHandle } from './components/Terminal';
import { AsleepPane } from './components/AsleepPane';
import { Header } from './components/Header';
import { TitleBar } from './components/TitleBar';
import { Tooltip } from './components/Tooltip';
import { Home } from './components/Home';
import { ProjectPage } from './components/ProjectPage';
import { NewThreadChooser } from './components/NewThreadChooser';
import { SearchPalette } from './components/SearchPalette';
import { GroupModal, GroupDraft } from './components/GroupModal';
import { Toast } from './components/Toast';
import { ConfirmDialog } from './components/ConfirmDialog';
import { RenameDialog } from './components/RenameDialog';
import { ArchiveDialog } from './components/ArchiveDialog';
import { UsageCard } from './components/UsageCard';
import { AboutWindow } from './components/AboutWindow';
import { RestartToUpdate } from './components/RestartToUpdate';
import { UpdatedPill } from './components/UpdatedPill';
import { WhatsNewDialog } from './components/UpdateDialog';
import { notesOf } from './components/UpdateNotes';
import type { ReleaseNote } from '../update-check';
import { initialUpdateState, restartRows, isMidTurn, hasBackgroundTask, shellBusy } from '../update-check';
import type { UpdateState, AwakeThread } from '../update-check';
import type { Screen } from './components/ScreenNav';
import { useTabState, threadGitCwd } from './hooks/useTabState';
import { Tab, TabNotification, nextGroupColor } from './components/TabBar/types';
import { groupColors } from './projectColour';
import { onTitle, onOutput, onTick, onInterrupt, onAnswer, onViewedTitle, onRecordStatus, backgroundAfterTitle, backgroundAfterRecord, backgroundAfterPrompt, clearsWhenSeen, withBackground, initTiming, TabTiming } from './spinnerState';
import { migrateSession, serializeSession } from './sessionMigration';
import { sleepAllForShutdown, wakePlan, screenAfterReload } from './sleepWake';
import { toastMessage, initialScreen, threadName, automaticThreadName, threadKind, needsCloseConfirm, closeConfirmText, needsSleepConfirm, sleepConfirmText, localhostUrl, threadFolder, threadFolderTarget, projectLookChanges } from './threadView';
import { ProjectActions } from './projectMenu';
import { buildThreadMenu } from './threadMenu';
import { projectAttention, totalAttention, railProjects, firstThreadToOpen } from './attention';
import type { EditorInfo } from '../editors';
import type { SessionFiles } from '../session-files';
import type { FilesButtonProps } from './components/FilesButton';
import { filesListView } from './filesView';
import { panesFor, splitOf, paneDropTarget } from './splitView';
import { PANEL_DEFAULT_WIDTH, clampPanelWidth, savedUi } from './panelWidth';
import type { PaneTarget } from './splitView';
import type { FileLinkContext, FileLinkTarget } from './components/Terminal/fileLinks';
import type { MenuItem } from './components/Menu';
import { EditorLogo, IconExplorer } from './components/Icons';
import { loopsContextFrom, NO_FILTER, openChatPlan, type LoopFilter } from './loopsView';
import { useActivityDays, useLoops } from './hooks/useLoops';
import type { Loop } from '../loops';

let toastCounter = 0;

// How long div.app keeps its entrance class (see index.css / theme.css); the
// longest of the entrance animations is 320ms.
const ENTER_MS = 400;
// Home and the project page show relative times ("5m"), so they need the clock
// to move while they are open.
const CLOCK_MS = 60_000;
// Where the new thread chooser opens when no New thread control is on screen to
// anchor it under.
const CHOOSER_FALLBACK = { x: 80, y: 120 };
// How often every thread's branch and worktree are re-read. Slow on purpose: a
// branch switch is rare and nothing here is urgent, so this only has to be faster
// than the user noticing a stale branch.
const GIT_POLL_MS = 30_000;
// How long the panel takes to slide shut (SidePanel.css, .side-panel.hidden).
// Going to Home waits this long before the screen changes, so the slide is seen
// (design-03 decision 1); under reduced motion there is nothing to see and the
// switch is immediate.
const PANEL_SLIDE_MS = 320;
// How soon after a change main gets the page's state in memory (AFT-33): what a page
// that crashes can lose at most, against the two seconds the file save waits.
const REMEMBER_MS = 250;
const reducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface AppToast {
  // Distinguishes one toast from the next even when the wording repeats, so the
  // pill remounts and its auto-hide timer starts again.
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

let appToastCounter = 0;

export function App() {
  const state = useTabState();
  // Whether the panel is hidden (Ctrl+Shift+B, the toggle). Persisted in
  // session.json as ui.panelHidden (Phase 8); the rail is never hidden.
  const [panelHidden, setPanelHidden] = useState(false);
  // The panel's width in pixels (AFT-30): the person's own, from dragging its right
  // edge, or the default. Persisted as ui.panelWidth only when it is not the
  // default. What is drawn is this held to the window (shownPanelWidth), so a width
  // chosen in a big window is kept, not overwritten, when the window gets small.
  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT_WIDTH);
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
  const shownPanelWidth = clampPanelWidth(panelWidth, windowWidth);
  // The transient slide: the panel is shut on the way to Home and slides open
  // again on the way back (design-03 decision 1), without touching the
  // persisted flag above. Never true while panelHidden already is.
  const [panelShut, setPanelShut] = useState(false);
  const slideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelRef = useRef<SidePanelHandle>(null);
  const [shells, setShells] = useState<{ id: string; name: string }[]>([]);
  const [initialized, setInitialized] = useState(false);
  // Which screen is showing. The workspace stays mounted behind Home and the
  // project page (it is only hidden with CSS) so terminals keep running and the
  // active tab's lazy Claude resume still happens; Home and the project page
  // mount only while they show.
  const [screen, setScreen] = useState<Screen>('workspace');
  const [projectPageId, setProjectPageId] = useState<string | null>(null);
  // Bumped on every screen switch so the entrance animation replays even when
  // the same screen is chosen twice in a row.
  const [screenSeq, setScreenSeq] = useState(0);
  // Screen-entrance animation class for div.app (Phase 1.1, see index.css and
  // theme.css). Cleared ~400ms after being set so it never lingers, which is
  // what lets the next switch re-trigger it.
  const [enterClass, setEnterClass] = useState('');
  // Now, refreshed once a minute while Home or a project page is open, so the
  // relative times on those screens stay current without a per-second timer.
  const [now, setNow] = useState(() => Date.now());
  // Editors detected by main, fetched once and replaced whenever an open or a
  // picker reports a fresher list.
  const [editors, setEditors] = useState<EditorInfo[]>([]);
  // Which project folders exist, keyed by path. Refreshed on entering Home or a
  // project page, the only screens that show the "Folder not found" state.
  const [folderExists, setFolderExists] = useState<Record<string, boolean>>({});
  // Bumped when a git read changes a thread's worktree or working tree top, so the
  // folder check runs again (see the effect that reads it).
  const [gitMoves, setGitMoves] = useState(0);
  const [toast, setToast] = useState<AppToast | null>(null);
  // Archive (2026-11-01): the project whose "Archive <name>?" window is open, and
  // the project being archived right now, which the panel keeps in Recent until
  // its threads have gone to sleep and its row has folded away.
  const [archiveAsk, setArchiveAsk] = useState<string | null>(null);
  // The usage card (AFT-85). The shortcut handler below is registered once, so it reads the
  // open state through a ref; closing goes through the card itself so it can fade out.
  const [usageOpen, setUsageOpen] = useState(false);
  const usageOpenRef = useRef(false);
  usageOpenRef.current = usageOpen;
  const toggleUsage = () => {
    if (usageOpenRef.current) window.dispatchEvent(new Event('usage:close'));
    else setUsageOpen(true);
  };
  const [archiving, setArchiving] = useState<string | null>(null);
  const archivingRef = useRef(false);
  const [chooser, setChooser] = useState<{ x: number; y: number } | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // null = closed; groupId absent = creating a new project.
  const [projectModal, setProjectModal] = useState<{ mode: 'create' | 'edit'; groupId?: string } | null>(null);
  // The thread or project the Rename dialog is open for, null when it is closed.
  const [renaming, setRenaming] = useState<{ kind: 'thread' | 'project'; id: string } | null>(null);
  // The saved scrollback tail of every thread whose pane may need it, keyed by tab
  // id. Filled when a thread goes to sleep (the terminal hands its last lines over
  // on the way out) and, for a thread restored from disk, read from its tail file
  // the first time its pane shows.
  const [tails, setTails] = useState<Record<string, string[]>>({});
  // What each chat changed and had pasted into it, read from its transcript
  // (docs/edited-files). Keyed by tab id, with the session it was read for, so a
  // chat that started a new session never shows the old one's files. Not
  // persisted: the transcript is the record.
  const [filesByTab, setFilesByTab] = useState<Record<string, { sessionId: string; files: SessionFiles }>>({});
  // The running server whose close is waiting on a confirm, or null. Closing a
  // thread that owns a listening port stops that server, which is worth asking
  // about once; every other close still goes straight through.
  // One dialog serves both Close and Sleep: Aryan decided on 2026-09-07 that Sleep
  // asks the same way Close does, since both stop the running server. The difference
  // is only that Wake brings it back, which the sleep wording says. `kind` picks
  // the text, the danger styling and which action the confirm runs.
  const [pendingConfirm, setPendingConfirm] =
    useState<{ kind: 'close' | 'sleep'; tabId: string; port: number } | null>(null);
  // Which tab a project page opens on. Everything that opens a project page shows
  // Live; only the palette's history results open it on History.
  const [projectPageTab, setProjectPageTab] = useState<'live' | 'asleep' | 'history'>('live');

  // Automatic updates (docs/design-05-automatic-updates.md). The state is main's
  // (src/updater.ts), pushed on every change. `updateWindow` is the About window
  // or the restart window; `whatsNew` the notes over the app after an update
  // restart; `updatedPill` the "Updated to" note that restart leaves.
  const [update, setUpdate] = useState<UpdateState>(() => initialUpdateState(window.afterterm.appVersion));
  const [updateWindow, setUpdateWindow] = useState<'about' | 'restart' | null>(null);
  // since: every release from `from` to `version` (AFT-56).
  type WhatsNewInfo = { version: string; from: string; notes: string; since: ReleaseNote[]; more: number };
  const [whatsNew, setWhatsNew] = useState<WhatsNewInfo | null>(null);
  const [updatedPill, setUpdatedPill] = useState<WhatsNewInfo | null>(null);
  // The threads awake when Restart now was pressed: the quit flush writes them to
  // session.json (wakeAfterUpdate), and only that quit does.
  const wakeAfterUpdateRef = useRef<string[]>([]);
  // On the launch after an update restart: what to reopen and wake, once the
  // restored session is in state.
  const afterUpdateRef = useRef<{ wake: string[]; activeThreadId?: string } | null>(null);
  const projectPageIdRef = useRef(projectPageId);
  projectPageIdRef.current = projectPageId;
  const updateRef = useRef(update);
  updateRef.current = update;

  // The terminal layer, for the one thing only it knows: what is on each screen
  // right now. Read at quit, when every awake thread's tail has to reach disk.
  const terminalRef = useRef<TerminalAreaHandle>(null);

  const stateRef = useRef(state);
  stateRef.current = state;
  const panelHiddenRef = useRef(panelHidden);
  panelHiddenRef.current = panelHidden;
  const panelWidthRef = useRef(panelWidth);
  panelWidthRef.current = panelWidth;
  // A window resize re-renders the app only when it changes the width the panel is
  // drawn at (the width is held to half the window, so most resizes change
  // nothing). windowWidth is kept in step wherever the width itself changes
  // (changePanelWidth, the restore), so what is drawn is always the chosen width
  // held to the real window.
  useEffect(() => {
    const onResize = () => {
      const width = window.innerWidth;
      setWindowWidth(prev => clampPanelWidth(panelWidthRef.current, prev) === clampPanelWidth(panelWidthRef.current, width) ? prev : width);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  // The panel's edge was dragged (settled) or double-clicked back to the default.
  // After a drag the terminals were held still, so they are fitted once now (the
  // drag has already put the panel at its final width, so the layout is settled); a
  // reset animates, and the terminal area's own ResizeObserver fits when it ends.
  const changePanelWidth = useCallback((width: number, settled: boolean) => {
    setPanelWidth(width);
    setWindowWidth(window.innerWidth);
    if (settled) terminalRef.current?.refit();
  }, []);
  const screenRef = useRef(screen);
  screenRef.current = screen;

  // Read by the clock effect and the tail-reading effect below, both of which run
  // before `activeTab` is derived further down.
  const activeTabAsleep = !!state.tabs.find(t => t.id === state.activeTabId)?.asleep;
  // The threads on screen, left to right (design-06): the active thread alone,
  // or both halves of its split, the active one being the focused half.
  const panes = state.tabs.some(t => t.id === state.activeTabId)
    ? panesFor(state.splits, state.activeTabId).filter(id => state.tabs.some(t => t.id === id))
    : [];
  const asleepPanesKey = panes.filter(id => state.tabs.find(t => t.id === id)?.asleep).join('|');
  // Where a thread dragged from the sidebar would land on the main pane: a half
  // lit up, or the refused drop with its label (Terminal/index.tsx draws it).
  const [paneDrop, setPaneDrop] = useState<PaneTarget | null>(null);

  // Every screen switch goes through here so the entrance class always replays.
  // Phase 8 adds the panel's slide (design-03 decision 1): leaving the workspace
  // slides the panel shut first and only then changes the screen; coming back
  // changes the screen at once and the panel slides open from zero, unless it
  // was hidden before, in which case it stays hidden. The slide is skipped
  // outright under reduced motion.
  const goScreen = useCallback((next: Screen, groupId?: string) => {
    if (next === 'project') {
      if (!groupId) return;
      setProjectPageId(groupId);
      // Every route into a project page lands on Live. The one exception sets
      // History straight after calling this (see the palette's onOpenHistory).
      setProjectPageTab('live');
    }
    if (slideTimerRef.current) { clearTimeout(slideTimerRef.current); slideTimerRef.current = null; }
    const switchNow = () => {
      setScreen(next);
      setScreenSeq(n => n + 1);
    };
    const wasWorkspace = screenRef.current === 'workspace';
    const canSlide = !panelHiddenRef.current && !reducedMotion();
    if (next !== 'workspace' && wasWorkspace && canSlide) {
      // A second switch (Home, then a project page) must not slide again: the
      // panel is already shut once the first one has landed.
      setPanelShut(true);
      slideTimerRef.current = setTimeout(() => { slideTimerRef.current = null; switchNow(); }, PANEL_SLIDE_MS);
      return;
    }
    if (next === 'workspace' && !wasWorkspace && canSlide) {
      // Mount shut, then release on the next frames so the width transition
      // runs from zero rather than the panel appearing at full width.
      setPanelShut(true);
      switchNow();
      requestAnimationFrame(() => requestAnimationFrame(() => setPanelShut(false)));
      return;
    }
    if (next === 'workspace') setPanelShut(false);
    switchNow();
  }, []);

  useEffect(() => () => { if (slideTimerRef.current) clearTimeout(slideTimerRef.current); }, []);

  // Ctrl+Shift+B and the two toggle buttons. Showing the panel again also ends any
  // transient shut, so a toggle mid-slide always lands on "shown".
  const togglePanel = useCallback(() => {
    setPanelShut(false);
    setPanelHidden(h => !h);
  }, []);

  // One toast at a time: a new one replaces whatever is showing, so the newest
  // thing the user did is the thing they read.
  const showToast = useCallback((next: Omit<AppToast, 'id'>) => {
    setToast({ id: ++appToastCounter, ...next });
  }, []);

  function chooseEditor() {
    window.afterterm.editors.choose().then(result => {
      // null is the user cancelling the picker, which needs no comment.
      if (!result) return;
      setEditors(result.editors);
      if (result.invalid) showEditorPathToast();
    });
  }

  function showEditorPathToast() {
    showToast({ message: 'Editor path not valid', actionLabel: 'Choose editor...', onAction: chooseEditor });
  }

  // Ctrl+Shift+T. The chooser opens under whichever New thread control is on
  // screen (the sidebar row when it is expanded, the rail button when collapsed),
  // so the popover reads as coming from the button the shortcut stands in for.
  // The switch to the workspace has to paint first for that control to be
  // measurable, hence the frame wait.
  function openChooserFromShortcut() {
    if (screenRef.current !== 'workspace') goScreen('workspace');
    requestAnimationFrame(() => {
      const controls = Array.from(document.querySelectorAll<HTMLElement>('[data-new-thread]'));
      const rect = controls
        .map(el => el.getBoundingClientRect())
        .find(r => r.width > 0 && r.height > 0);
      setChooser(rect ? { x: rect.left, y: rect.bottom + 6 } : CHOOSER_FALLBACK);
    });
  }

  // Every project action in the app, in one object: Home's cards and rows, the
  // project page's buttons, and every project right-click menu all run through it
  // (see projectMenu.tsx).
  const findGroup = (groupId: string) => stateRef.current.groups.find(g => g.id === groupId);

  // One Explorer launch for the project menu (its folder) and the thread menu
  // (the thread's own folder, Phase 9): the same projects:openInExplorer IPC,
  // the same toast when main reports a failure.
  const openFolderInExplorer = (folder: string) => {
    // Recorded for the harness (drive.mjs's `opened`), which cannot see an
    // Explorer window open; main logs the same folder under AFTERTERM_HARNESS=1.
    const win = window as unknown as { __afterterm?: Record<string, unknown> };
    win.__afterterm = { ...(win.__afterterm ?? {}), lastOpenFolder: folder };
    window.afterterm.projects.openInExplorer(folder).then(result => {
      if (!result.ok) showToast({ message: result.error ?? 'Could not open the folder' });
    });
  };

  // The top of each thread's git working tree, filled by every git read
  // (noteGitInfo) and not saved. File links try paths from it, and a thread's
  // Open in File Explorer and Open in <editor> open it (threadFolderTarget).
  const gitTopsRef = useRef(new Map<string, string>());

  // The folder a thread's own Open in File Explorer and Open in <editor> act on
  // (threadFolderTarget): the top of the thread's git working tree, never above
  // its project. The top is read from a ref that fills after a render and causes
  // none, so the launches below call this again at the click.
  const threadTarget = (tab: Tab) => threadFolderTarget(
    tab,
    folderExists,
    gitTopsRef.current.get(tab.id),
    tab.groupId ? state.groups.find(g => g.id === tab.groupId)?.cwd : undefined,
  );

  // What the thread menu's "Open in File Explorer" gets for a thread: nothing
  // when the thread has no folder (the item is then left out), otherwise the
  // folder's checked existence and the launch. `folderExists` is only ever
  // false for a folder main has actually checked and found missing; an
  // unchecked one counts as present, so the item never starts out disabled.
  const threadExplorer = (tab: Tab) => {
    const target = threadTarget(tab);
    if (!target) return undefined;
    return {
      missing: target.missing,
      open: () => openFolderInExplorer((threadTarget(tab) ?? target).folder),
    };
  };

  // Launches an editor on a folder, for a project (its root) and a thread (its
  // own folder) alike. main re-runs detection on failure, so a vanished editor
  // stops being offered, and the toast offers to pick one.
  const openFolderInEditor = (folder: string, editorId: string) => {
    // Recorded for the harness (drive.mjs's `opened`), like lastOpenFolder.
    const win = window as unknown as { __afterterm?: Record<string, unknown> };
    win.__afterterm = { ...(win.__afterterm ?? {}), lastOpenEditor: { folder, editorId } };
    const name = editors.find(e => e.id === editorId)?.name ?? 'the editor';
    window.afterterm.editors.open(folder, editorId).then(result => {
      setEditors(result.editors);
      if (!result.ok) {
        showToast({ message: `Couldn't open ${name}`, actionLabel: 'Choose editor...', onAction: chooseEditor });
      }
    });
  };

  // "Open in <editor>" for the same folder as threadExplorer (the worktree for a
  // worktree chat, the repo's top for a chat or shell in a subfolder of one, the
  // thread's own folder outside git, never above the project), the editor twin
  // of it: the header's editor button and the thread menu entries. Undefined when
  // the thread has no folder or no editor was found.
  const threadEditor = (tab: Tab) => {
    const target = threadTarget(tab);
    if (!target || editors.length === 0) return undefined;
    return {
      editors,
      missing: target.missing,
      open: (editorId: string) => openFolderInEditor((threadTarget(tab) ?? target).folder, editorId),
    };
  };

  // ── Edited files (docs/edited-files) ──────────────────────────────────────
  // One recorder for the harness (drive.mjs's `opened`), like lastOpenFolder:
  // main only logs the launch under AFTERTERM_HARNESS=1, so this is how a test
  // sees which file a click reached.
  const noteOpened = (key: string, value: unknown) => {
    const win = window as unknown as { __afterterm?: Record<string, unknown> };
    win.__afterterm = { ...(win.__afterterm ?? {}), [key]: value };
  };

  const openFileInEditor = (path: string, line?: number) => {
    noteOpened('lastOpenFile', line ? `${path}:${line}` : path);
    window.afterterm.files.open(path, line).then(result => {
      if (!result.ok) showToast({ message: result.error ?? 'Could not open the file' });
    });
  };

  const openFileWithDefaultApp = (path: string) => {
    noteOpened('lastOpenFile', path);
    window.afterterm.files.openDefault(path).then(result => {
      if (!result.ok) showToast({ message: result.error ?? 'Could not open the file' });
    });
  };

  const revealFile = (path: string) => {
    noteOpened('lastRevealFile', path);
    window.afterterm.files.reveal(path).then(result => {
      if (!result.ok) showToast({ message: result.error ?? 'Could not open File Explorer' });
    });
  };

  const copyPath = (path: string) => {
    navigator.clipboard.writeText(path).then(
      () => showToast({ message: 'Path copied' }),
      () => showToast({ message: 'Could not copy the path' }),
    );
  };

  // Brings one chat's list up to date. Only new transcript bytes are read, so
  // calling it on every turn is cheap.
  const refreshFiles = useCallback(async (tabId: string): Promise<SessionFiles | undefined> => {
    const tab = stateRef.current.tabs.find(t => t.id === tabId);
    const sessionId = tab?.claudeSessionId;
    const cwd = tab?.claudeCwd;
    if (!sessionId || !cwd) return undefined;
    const files = await window.afterterm.sessionFiles.list(sessionId, cwd);
    setFilesByTab(prev => ({ ...prev, [tabId]: { sessionId, files } }));
    return files;
  }, []);

  // What a terminal's file links resolve against (Phase 3): the thread's own
  // folder, the top of its worktree, its project's, the home folder, and for a
  // chat the files it changed. Read through refs because the terminal asks on
  // every hover. The worktree's top comes with each git read (noteGitInfo) and is
  // not saved: the first read after a launch fills it again.
  const filesByTabRef = useRef(filesByTab);
  filesByTabRef.current = filesByTab;
  const fileContextFor = useCallback((tabId: string): FileLinkContext | null => {
    const tab = stateRef.current.tabs.find(t => t.id === tabId);
    if (!tab) return null;
    const project = tab.groupId ? stateRef.current.groups.find(g => g.id === tab.groupId) : undefined;
    const entry = filesByTabRef.current[tabId];
    const files = entry && entry.sessionId === tab.claudeSessionId ? entry.files : undefined;
    const sessionId = tab.claudeSessionId;
    const cwd = tab.claudeCwd;
    return {
      threadFolder: threadFolder(tab),
      worktreeTop: gitTopsRef.current.get(tabId),
      projectFolder: project?.cwd,
      home: window.afterterm.app.homeDir || undefined,
      changed: files?.changed ?? [],
      edits: files?.edits ?? [],
      refs: files?.refs ?? [],
      chat: sessionId && cwd ? {
        sessionId,
        cwd,
        pasted: files?.pasted ?? [],
        refreshPasted: async () => (await refreshFiles(tabId))?.pasted ?? [],
      } : undefined,
    };
  }, [refreshFiles]);

  // One pasted image, by its key in the chat's transcript. The Files list and the
  // [Image #N] tags in the terminal both come through here.
  const openPastedImage = (sessionId: string, cwd: string, key: string) => {
    window.afterterm.sessionFiles.openPasted(sessionId, cwd, key).then(result => {
      noteOpened('lastOpenFile', result.path ?? key);
      if (!result.ok) showToast({ message: result.error ?? 'Could not open the image' });
    });
  };
  const withPastedPath = (sessionId: string, cwd: string, key: string, then: (path: string) => void) => {
    window.afterterm.sessionFiles.pastedPath(sessionId, cwd, key).then(path => {
      if (path) then(path);
      else showToast({ message: 'Image not found' });
    });
  };

  const openFileLink = (target: FileLinkTarget) => {
    if (target.how === 'pasted') {
      openPastedImage(target.sessionId, target.cwd, target.key);
    } else if (target.how === 'explorer') {
      noteOpened('lastOpenFile', target.path);
      window.afterterm.files.openFolder(target.path).then(result => {
        if (!result.ok) showToast({ message: result.error ?? 'Could not open the folder' });
      });
    } else if (target.how === 'default') {
      openFileWithDefaultApp(target.path);
    } else {
      openFileInEditor(target.path, target.line);
    }
  };

  // The right-click menu on a file link in the terminal.
  const fileLinkMenu = (target: FileLinkTarget): MenuItem[] => {
    const word = target.how === 'explorer' ? 'folder' : 'file';
    const withPath = (then: (path: string) => void) => {
      if (target.how === 'pasted') withPastedPath(target.sessionId, target.cwd, target.key, then);
      else then(target.path);
    };
    const opensIn = target.how === 'editor' && editors[0] ? <EditorLogo product={editors[0].product} size={16} />
      : target.how === 'explorer' ? <IconExplorer size={16} />
      : undefined;
    return [
      { label: 'Open', right: opensIn, onSelect: () => openFileLink(target) },
      { label: `Open ${word} location`, right: <IconExplorer size={16} />, onSelect: () => withPath(revealFile) },
      { label: `Copy ${word} path`, onSelect: () => withPath(copyPath) },
    ];
  };

  // The Files button's props for a chat, or undefined for a shell.
  const filesButtonFor = (tab: Tab): FilesButtonProps | undefined => {
    const sessionId = tab.claudeSessionId;
    const cwd = tab.claudeCwd;
    if (!sessionId || !cwd) return undefined;
    const entry = filesByTab[tab.id];
    const files = entry && entry.sessionId === sessionId ? entry.files : undefined;
    const project = tab.groupId ? stateRef.current.groups.find(g => g.id === tab.groupId) : undefined;
    const view = filesListView(files, threadFolder(tab), window.afterterm.app.homeDir || undefined, Date.now(), project?.cwd);
    return {
      view,
      threadKey: `${tab.id}:${sessionId}`,
      editorName: editors[0]?.name ?? '',
      editorProduct: editors[0]?.product,
      onOpenList: () => refreshFiles(tab.id),
      onOpenFile: path => openFileInEditor(path),
      onRevealFile: revealFile,
      onCopyFile: copyPath,
      onOpenPasted: key => openPastedImage(sessionId, cwd, key),
      onRevealPasted: key => withPastedPath(sessionId, cwd, key, revealFile),
      onCopyPasted: key => withPastedPath(sessionId, cwd, key, copyPath),
      thumb: key => window.afterterm.sessionFiles.thumb(sessionId, cwd, key),
    };
  };

  const projectActions: ProjectActions = {
    open: (groupId) => {
      const group = findGroup(groupId);
      if (!group) return;
      // Opening an archived project is the user saying they want it back.
      if (group.archived) stateRef.current.setGroupArchived(groupId, false);
      // A project with nothing running is still one click from a terminal: if it
      // has no thread to focus, opening it opens one. Badges and the toast are
      // cleared for the thread openProject lands on, not the project's first one.
      const opened = stateRef.current.openProject(groupId);
      if (opened) clearThreadBadges(opened);
      else stateRef.current.addTab(groupId);
      goScreen('workspace');
      panelRef.current?.revealProject(groupId);
    },
    newThread: (groupId) => {
      stateRef.current.addTab(groupId);
      goScreen('workspace');
    },
    togglePin: (groupId) => {
      const group = findGroup(groupId);
      if (!group) return;
      stateRef.current.togglePin(groupId);
      showToast({ message: `${group.pinned ? 'Unpinned' : 'Pinned'} ${group.label}` });
    },
    openPage: (groupId) => goScreen('project', groupId),
    openInExplorer: (groupId) => {
      const folder = findGroup(groupId)?.cwd;
      if (folder) openFolderInExplorer(folder);
    },
    openInEditor: (groupId, editorId) => {
      const folder = findGroup(groupId)?.cwd;
      if (folder) openFolderInEditor(folder, editorId);
    },
    chooseEditor,
    edit: (groupId) => setProjectModal({ mode: 'edit', groupId }),
    rename: (groupId) => setRenaming({ kind: 'project', id: groupId }),
    // Archive moves the project into the panel's Other projects drawer. With
    // awake threads it asks first (ArchiveDialog), since they go to sleep;
    // with none it goes straight away. Either way archiveNow runs the sequence.
    archive: (groupId) => {
      const group = findGroup(groupId);
      if (!group || archivingRef.current) return;
      const awake = stateRef.current.tabs.some(t => t.groupId === groupId && !t.asleep);
      if (awake) setArchiveAsk(groupId);
      else void archiveNow(groupId);
    },
    restore: (groupId) => {
      const group = findGroup(groupId);
      if (!group) return;
      stateRef.current.setGroupArchived(groupId, false);
      showToast({ message: `Restored ${group.label}` });
    },
    deleteProject: (groupId) => stateRef.current.deleteGroup(groupId),
  };

  // The Archive sequence Aryan agreed on (docs/mockups/sidebar-archive-with-awake-threads.html):
  // the awake threads go to sleep one after the other, about 140ms apart, so each
  // row's icon turns into the moon in turn; then the project folds out of Recent
  // and the rows below slide up; then it is archived (the top of Other projects,
  // whose count bumps) and the toast says where it went. The project is held in
  // Recent while this runs, so its last thread going to sleep does not drop it
  // into Other before the fold.
  const archiveNow = async (groupId: string) => {
    if (archivingRef.current) return;
    archivingRef.current = true;
    setArchiving(groupId);
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const wait = (ms: number) => (reduce ? Promise.resolve() : new Promise<void>(r => setTimeout(r, ms)));
    try {
      const awake = stateRef.current.tabs.filter(t => t.groupId === groupId && !t.asleep);
      for (const t of awake) {
        sleepThreadNow(t.id);
        await wait(140);
      }
      if (awake.length) await wait(420);
      await panelRef.current?.foldOut(groupId);
      stateRef.current.setGroupArchived(groupId, true);
      showToast({ message: 'Moved to Other projects' });
    } finally {
      archivingRef.current = false;
      setArchiving(null);
    }
  };

  // Per-tab timing for the working-spinner state machine (see spinnerState.ts).
  // Lives in a ref, high-frequency PTY-output updates must never trigger a render.
  const timingRef = useRef(new Map<string, TabTiming>());
  const getTiming = (tabId: string, now: number): TabTiming => {
    let t = timingRef.current.get(tabId);
    if (!t) { t = initTiming(now); timingRef.current.set(tabId, t); }
    return t;
  };
  // Every change of notif lands here, with the thread's background work flag
  // (Tab.backgroundTasks) as it stands after the event being handled: a caller that
  // changes the flag in the same event passes the new value, since state still holds
  // the old one until the next render. withBackground (spinnerState.ts) turns a quiet
  // thread with background work into background, so the hourglass stays for as long
  // as the work runs, viewed or not (AFT-25, AFT-43).
  const applyNotif = (tabId: string, cur: TabNotification | undefined, next: TabNotification | undefined, background: boolean) => {
    const settled = withBackground(next, background);
    if (settled !== cur) stateRef.current.setTabNotification(tabId, settled);
  };

  // Load shells + restore session on mount
  useEffect(() => {
    Promise.all([
      window.afterterm.shells.list(),
      window.afterterm.session.load(),
      window.afterterm.update.takeLaunch(),
      window.afterterm.recovery.state(),
    ]).then(([shellList, saved, landed, recovered]) => {
      setShells(shellList);
      // The file may predate the current format (0.8.1 wrote no version field and
      // none of the project/thread fields); migrate fills defaults or rejects it.
      const session = migrateSession(saved, Date.now());
      // Restored even with no threads at all: projects can exist without one. A
      // fresh profile starts with nothing running (no General thread spawned on
      // first launch, Yogansh 2026-10-29); either way the app opens on Home.
      // AFT-33: when only the page reloaded (a crash, a hang, a reload), main still
      // holds the shells that were running. Those threads come back awake and their
      // new terminals attach to the same shells; a shell no saved thread names is
      // ended, since nothing could reach it. A launch has no live shells.
      const restored = session
        ? state.restoreSession(session, recovered.threads)
        : { reattached: [], orphans: recovered.threads.map(t => t.tabId) };
      for (const id of restored.orphans) void window.afterterm.pty.destroy(id);
      if (session) {
        setPanelHidden(!!session.ui?.panelHidden);
        setPanelWidth(session.ui?.panelWidth ?? PANEL_DEFAULT_WIDTH);
        setWindowWidth(window.innerWidth);
        setScreen(initialScreen(session.groups));
      } else {
        setScreen(initialScreen([]));
      }
      // And it opens where it was: the screen, project page and active thread main
      // remembered for this run of the app. Nothing is remembered on a launch, which
      // opens Home as always.
      const back = screenAfterReload(recovered.ui, session?.groups.map(g => g.id) ?? [], session?.tabs.map(t => t.id) ?? []);
      if (back) {
        if (back.screen === 'project' && back.projectId) setProjectPageId(back.projectId);
        setScreen(back.screen);
        if (back.activeTabId) state.setActiveTabId(back.activeTabId);
      }
      // After an update restart, and only then (Aryan, 2026-10-30): back on the
      // screen and thread that were open, the threads that were awake woken (the
      // effect below), and the "Updated to" note. Every other launch keeps the
      // 0.9.0 rule that everything starts asleep.
      if (landed) {
        afterUpdateRef.current = { wake: session?.wakeAfterUpdate ?? [], activeThreadId: landed.activeThreadId };
        const project = landed.screen === 'project' && landed.projectId && session?.groups.some(g => g.id === landed.projectId);
        if (project) { setProjectPageId(landed.projectId!); setScreen('project'); }
        else if (landed.screen === 'home') setScreen('home');
        else setScreen('workspace');
        setUpdatedPill({ version: landed.to, from: landed.from, notes: landed.notes, since: landed.since, more: landed.more });
      }
      setInitialized(true);
    });
  }, []);

  // The update state, from main.
  useEffect(() => {
    window.afterterm.update.get().then(setUpdate);
    return window.afterterm.update.onState(setUpdate);
  }, []);

  // Waking what was awake before the update restart, once the restored threads
  // are in state, through the same wake every Wake button uses (a chat resumes
  // its Claude Code session, a server runs its command again, a shell opens in
  // its folder). A little apart, so a dozen shells do not all start in one frame.
  useEffect(() => {
    if (!initialized || !afterUpdateRef.current) return;
    const { wake, activeThreadId } = afterUpdateRef.current;
    afterUpdateRef.current = null;
    if (activeThreadId && stateRef.current.tabs.some(t => t.id === activeThreadId)) {
      stateRef.current.setActiveTabId(activeThreadId);
    }
    wake.forEach((id, i) => setTimeout(() => {
      if (stateRef.current.tabs.find(t => t.id === id)?.asleep) void wakeThreadRef.current(id);
    }, i * 250));
  }, [initialized]);

  // AFT-33: main keeps the latest state in memory, a moment after every change, so
  // a page that crashes or hangs before the two second save below still comes back
  // with its last threads. Throttled, not debounced: a stream of changes (a chat's
  // title) still reaches main every REMEMBER_MS. Memory only, nothing is written.
  // Each thread's notification and background work go with it: they are never saved,
  // and a chat waiting for Aryan must still show needs-you after a reload.
  const rememberTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!initialized || rememberTimerRef.current) return;
    rememberTimerRef.current = setTimeout(() => {
      rememberTimerRef.current = null;
      const s = stateRef.current;
      const data = serializeSession(s.tabs, s.groups, s.activeTabId, savedUi(panelHiddenRef.current, panelWidthRef.current), undefined, s.splits);
      const shown: Record<string, { notification?: string; backgroundTasks?: boolean }> = {};
      for (const t of s.tabs) {
        if (t.asleep || (!t.notification && !t.backgroundTasks)) continue;
        shown[t.id] = { ...(t.notification ? { notification: t.notification } : {}), ...(t.backgroundTasks ? { backgroundTasks: true } : {}) };
      }
      window.afterterm.session.remember(JSON.stringify(data), shown);
    }, REMEMBER_MS);
  }, [initialized, state.tabs, state.groups, state.activeTabId, state.splits, panelHidden, panelWidth]);

  // And what the page shows, so a reloaded page opens on the same screen, project
  // page and thread (screenAfterReload).
  useEffect(() => {
    if (!initialized) return;
    window.afterterm.recovery.noteUi({
      screen,
      ...(screen === 'project' && projectPageId ? { projectId: projectPageId } : {}),
      ...(state.activeTabId ? { activeTabId: state.activeTabId } : {}),
    });
  }, [initialized, screen, projectPageId, state.activeTabId]);

  // Auto-save session (2s debounce after any state change). No threads at all is
  // a state worth saving too (the last one was closed); only an unloaded session
  // is not.
  useEffect(() => {
    if (!initialized) return;
    const timer = setTimeout(() => {
      const data = serializeSession(state.tabs, state.groups, state.activeTabId, savedUi(panelHidden, panelWidth), undefined, state.splits);
      window.afterterm.session.save(JSON.stringify(data));
    }, 2000);
    return () => clearTimeout(timer);
  }, [initialized, state.tabs, state.groups, state.activeTabId, state.splits, panelHidden, panelWidth]);

  // Loops: main answers `afterterm loops` and needs each thread's project and chat
  // (loopsView.ts). Sent only when it changes.
  const loopsContextSent = useRef('');
  useEffect(() => {
    const text = JSON.stringify(loopsContextFrom(state.tabs, state.groups));
    if (text === loopsContextSent.current) return;
    loopsContextSent.current = text;
    window.afterterm.loops.setContext(JSON.parse(text));
  }, [state.tabs, state.groups]);

  // Keyboard shortcuts from main process
  useEffect(() => {
    window.afterterm.shortcuts.onShortcut((action) => {
      const s = stateRef.current;
      switch (action) {
        case 'new-tab':
          openChooserFromShortcut();
          break;
        case 'search':
          setPaletteOpen(open => !open);
          break;
        case 'usage':
          toggleUsage();
          break;
        case 'close-tab':
          if (s.tabs.length > 0) closeThread(s.activeTabId);
          break;
        case 'next-tab': {
          if (s.tabs.length < 2) break;
          const idx = s.tabs.findIndex(t => t.id === s.activeTabId);
          handleActivate(s.tabs[(idx + 1) % s.tabs.length].id);
          break;
        }
        case 'prev-tab': {
          if (s.tabs.length < 2) break;
          const idx = s.tabs.findIndex(t => t.id === s.activeTabId);
          handleActivate(s.tabs[(idx - 1 + s.tabs.length) % s.tabs.length].id);
          break;
        }
        case 'toggle-panel':
          togglePanel();
          break;
        case 'next-thread':
          cycleThread(1);
          break;
        case 'prev-thread':
          cycleThread(-1);
          break;
      }
    });
  }, []);

  // Notifier window sends tab-click → jump to that tab
  useEffect(() => {
    window.afterterm.notify.onActivateTab((tabId) => {
      handleActivate(tabId);
    });
  }, []);

  // One thread's git read: branch and worktree onto the tab (setGitInfo no-ops when
  // nothing changed), and the worktree's top kept for its file links and its
  // folder buttons. When the read moves the worktree or the top (a worktree
  // deleted from outside: git-info walks up from the missing folder and finds the
  // main checkout), the folder check runs again, so threadFolderTarget sees the
  // thread's folder as missing instead of opening the repo above it.
  const noteGitInfo = useCallback((tabId: string, info: GitInfo) => {
    const topBefore = gitTopsRef.current.get(tabId);
    const worktreeBefore = stateRef.current.tabs.find(t => t.id === tabId)?.worktree;
    if (info.top) gitTopsRef.current.set(tabId, info.top);
    else gitTopsRef.current.delete(tabId);
    stateRef.current.setGitInfo(tabId, { branch: info.branch, worktree: info.worktree });
    if ((info.top ?? undefined) !== topBefore || (info.worktree ?? undefined) !== worktreeBefore) {
      setGitMoves(n => n + 1);
    }
  }, []);

  // Read one thread's git info (noteGitInfo). Calling it more often than needed is
  // free.
  const refreshGit = useCallback((tabId: string, cwd: string | undefined) => {
    if (!cwd) return;
    window.afterterm.git.info(cwd).then(info => noteGitInfo(tabId, info));
  }, [noteGitInfo]);

  // Read the session transcript for one thread (first prompt + model). Returns the
  // promise so the startup pass can await one read before starting the next.
  // A transcript read also says where the session was last working (meta.cwd, the
  // newest entry's cwd). When that differs from the folder the notify hook recorded
  // (a session that entered a worktree, then was resumed: Claude Code restores the
  // worktree, the hook only reports it on the next prompt) the tab follows the
  // transcript at once, so the header's branch and worktree, Open in File Explorer
  // and the next wake's `claude --resume` folder are right without a message being
  // sent (Aryan, 2026-09-19). The hook's own report still wins on every turn: it
  // arrives through onUpdate with the same setClaudeSession.
  const applyClaudeMeta = useCallback((tabId: string, sessionId: string, meta: ClaudeSessionMeta) => {
    stateRef.current.setClaudeMeta(tabId, { firstPrompt: meta.firstPrompt, model: meta.model });
    if (!meta.cwd) return;
    const tab = stateRef.current.tabs.find(t => t.id === tabId);
    if (!tab || tab.claudeSessionId !== sessionId || tab.claudeCwd === meta.cwd) return;
    stateRef.current.setClaudeSession(tabId, sessionId, meta.cwd);
    refreshGit(tabId, meta.cwd);
  }, [refreshGit]);

  const refreshClaudeMeta = useCallback((tabId: string, sessionId: string, cwd: string) => {
    return window.afterterm.claudeSession.meta(sessionId, cwd).then(meta => applyClaudeMeta(tabId, sessionId, meta));
  }, [applyClaudeMeta]);

  // Main captures each tab's live Claude session (via the notify hook's file channel)
  // and pushes it here → store on the tab so the next launch can resume it. The first
  // capture is also the moment the transcript and the folder become known, so both
  // are read once here; later turns arrive on the meta push below.
  // Since Fix 5 (plan-02) a capture also comes from Claude Code's own session record,
  // through the same onUpdate, so a chat with no hooks is still a chat. The record's
  // live status arrives beside it and is kept on the tab, never saved.
  // Fix 11: a busy status also starts the spinner (spinnerState.ts, onRecordStatus),
  // through applyNotif like every other notif change, so a chat with no hooks shows
  // as working in the sidebar and the rail the same way a hooked one does.
  useEffect(() => {
    window.afterterm.claudeSession.onUpdate(({ tabId, sessionId, cwd }) => {
      stateRef.current.setClaudeSession(tabId, sessionId, cwd);
      refreshClaudeMeta(tabId, sessionId, cwd);
      refreshGit(tabId, cwd);
    });
    return window.afterterm.claudeRecord.onStatus(({ tabId, status }) => {
      stateRef.current.setClaudeRecordStatus(tabId, status);
      // State still holds the previous status here: the setter above lands on the next render.
      const tab = stateRef.current.tabs.find(t => t.id === tabId);
      if (!tab || tab.asleep) return;
      // The thread's Claude has gone (/exit): its background work stopped or left with
      // it, and no hook title will come to say so (plan-02, Fix 7).
      const hadBackground = !!tab.backgroundTasks;
      const background = backgroundAfterRecord(hadBackground, tab.recordStatus, status ?? undefined);
      if (background !== hadBackground) stateRef.current.setBackgroundTasks(tabId, background);
      // A busy record starts working from quiet; idle or shell ends a compaction that
      // was cancelled (AFT-42). A thread left with background work shows background.
      const next = onRecordStatus(tab.notification, status ?? undefined);
      // The tick only clears a tab it has a clock for, so make sure there is one.
      if (next === 'working') getTiming(tabId, Date.now());
      applyNotif(tabId, tab.notification, next, background);
    });
  }, []);

  // Main re-reads the transcript after every hook write, that is once a turn, so a
  // /model switch or Claude's first reply shows up without anything polling.
  useEffect(() => {
    window.afterterm.claudeSession.onMeta(({ tabId, sessionId, firstPrompt, model, cwd }) => {
      applyClaudeMeta(tabId, sessionId, { firstPrompt, model, cwd, exists: true });
      // The same beat (UserPromptSubmit and Stop) keeps the Files list current.
      refreshFiles(tabId);
    });
  }, []);

  // One pass over the restored session: the transcript for every chat, and branch
  // and worktree for every thread with a folder. The transcript reads run one after
  // another, a session with 40 chats would otherwise fire 40 concurrent 512 KB reads
  // in the first second of launch; the git lookups are one round trip for the lot.
  useEffect(() => {
    if (!initialized) return;
    let cancelled = false;
    const tabs = stateRef.current.tabs;

    (async () => {
      for (const tab of tabs) {
        if (cancelled) return;
        if (!tab.claudeSessionId || !tab.claudeCwd) continue;
        await refreshClaudeMeta(tab.id, tab.claudeSessionId, tab.claudeCwd);
      }
    })();

    // Tail files outlive their threads (a closed thread keeps one for Resume), so
    // the only moment it is safe to sweep the folder is here, once the restored
    // session is in state: anything not backing a live thread or a history entry
    // belongs to a thread that was closed and forgotten long ago.
    window.afterterm.threads.prune([
      ...tabs.map(t => t.id),
      ...stateRef.current.groups.flatMap(g => g.history.map(e => e.id)),
    ]);

    const withCwd = tabs
      .map(t => ({ id: t.id, cwd: threadGitCwd(t) }))
      .filter((t): t is { id: string; cwd: string } => !!t.cwd);
    if (withCwd.length > 0) {
      window.afterterm.git.infoMany(withCwd.map(t => t.cwd)).then(infos => {
        if (cancelled) return;
        withCwd.forEach((t, i) => {
          const info = infos[i];
          if (info) noteGitInfo(t.id, info);
        });
      });
    }

    return () => { cancelled = true; };
  }, [initialized]);

  // Slow refresh so a branch switched from inside a terminal (or from another app)
  // catches up on its own. setGitInfo writes nothing when a thread's branch is
  // unchanged, so a quiet window costs one main-process call and no render. Paused
  // while the window is hidden, where nobody can see the answer anyway.
  useEffect(() => {
    if (!initialized) return;
    const id = setInterval(() => {
      if (document.hidden) return;
      const withCwd = stateRef.current.tabs
        .map(t => ({ id: t.id, cwd: threadGitCwd(t) }))
        .filter((t): t is { id: string; cwd: string } => !!t.cwd);
      if (withCwd.length === 0) return;
      window.afterterm.git.infoMany(withCwd.map(t => t.cwd)).then(infos => {
        withCwd.forEach((t, i) => {
          const info = infos[i];
          if (info) noteGitInfo(t.id, info);
        });
      });
    }, GIT_POLL_MS);
    return () => clearInterval(id);
  }, [initialized]);

  // A shell that reported a new cwd (OSC 9;9) may have walked into another repo or
  // worktree, so its branch is re-read. threadGitCwd still decides which folder
  // actually counts for a chat.
  const handleCwdChange = useCallback((tabId: string, cwd: string) => {
    stateRef.current.updateTabCwd(tabId, cwd);
    const tab = stateRef.current.tabs.find(t => t.id === tabId);
    refreshGit(tabId, tab?.claudeCwd ?? cwd);
  }, []);

  // Opening a thread clears what it had finished telling you: a 'done' badge, the
  // unread mark, and any overlay toast for it. It does not clear needs-you (Phase 7,
  // design-03 decision 4): a permission prompt is still waiting after you look at
  // it, and only answering it (Enter), cancelling it (Esc or Ctrl+C) or the hook's
  // next title ends it, all in spinnerState.ts. 'working' and 'compacting' are
  // ongoing-turn state, not unseen badges, so they keep spinning, and since
  // 2026-11-08 so is 'background': it lasts while the background work runs (AFT-43),
  // and a seen done falls back to it when there is still some (withBackground). The
  // same rule (clearsWhenSeen) clears a title that lands on the thread while it is
  // being viewed, in handleNotification.
  const clearThreadBadges = useCallback((tabId: string) => {
    const tab = stateRef.current.tabs.find(t => t.id === tabId);
    if (clearsWhenSeen(tab?.notification)) stateRef.current.setTabNotification(tabId, withBackground(undefined, !!tab?.backgroundTasks));
    if (tab?.unread) stateRef.current.setUnread(tabId, false);
    window.afterterm.notify.dismissTab(tabId);
  }, []);

  // `keepProjectOrder` is the keyboard cycle's flag (see activateTab in
  // useTabState.ts): moving through the panel must not reorder its Recent list.
  const handleActivate = useCallback((tabId: string, keepProjectOrder = false) => {
    // Ignore clicks for tabs that no longer exist (closed tab, or the one-time
    // setup toast's sentinel tabId), just dismiss it; don't blank the view.
    if (!stateRef.current.tabs.some(t => t.id === tabId)) {
      window.afterterm.notify.dismissTab(tabId);
      return;
    }
    // activateTab (not setActiveTabId) so the tab and its group get a lastActiveAt
    // stamp: this is the user choosing the tab, which is the only thing that should
    // count as "used" until Phase 2 adds PTY activity.
    state.activateTab(tabId, keepProjectOrder);
    // An asleep thread is only shown, never woken: opening it puts its pane on
    // screen with the old output and a Wake button, and nothing is spawned until
    // that button (or the menu's Wake) is used.
    clearThreadBadges(tabId);
  }, [state.activateTab, clearThreadBadges]);

  // Open a thread and show it: used by the palette and the project page, which can
  // both pick a thread from a screen that is not the workspace.
  // A thread of an archived project opened this way brings the project back out
  // of Other projects (2026-11-01: using it brings it back).
  const openThreadInWorkspace = useCallback((tabId: string) => {
    const groupId = stateRef.current.tabs.find(t => t.id === tabId)?.groupId;
    if (groupId && stateRef.current.groups.find(g => g.id === groupId)?.archived) {
      stateRef.current.setGroupArchived(groupId, false);
    }
    handleActivate(tabId);
    goScreen('workspace');
  }, [handleActivate, goScreen]);

  // Ctrl+Shift+Down and Up (design-03 decisions 6 and 7): the next or previous
  // thread row the panel is showing, in panel order, across projects. The panel
  // owns the fold state and the search text, so it is asked rather than
  // recomputed here. From Home or a project page the workspace comes back too.
  const cycleThread = useCallback((dir: 1 | -1) => {
    const next = panelRef.current?.cycleThread(stateRef.current.activeTabId, dir);
    if (!next) return;
    // Without reordering Recent: a project rising to the top the moment the cycle
    // lands in it would put the same two projects in front of the keys forever.
    handleActivate(next, true);
    if (screenRef.current !== 'workspace') goScreen('workspace');
  }, [handleActivate, goScreen]);

  // A rail tile click (design-03 decision 1): the workspace on that project's
  // first thread waiting for you, else its first finished one, else its most
  // recently active awake thread; the project is expanded in the panel by the
  // panel's own activation effect. A project with nothing to open (every thread
  // asleep, nothing pending) opens the way a Home card does.
  const openProjectFromRail = useCallback((groupId: string) => {
    const s = stateRef.current;
    const target = firstThreadToOpen(s.tabs.filter(t => t.groupId === groupId));
    if (target) {
      handleActivate(target.id);
      goScreen('workspace');
      panelRef.current?.revealProject(groupId);
      return;
    }
    projectActions.open(groupId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleActivate, goScreen]);

  // A click on a project in the panel's docked Other list (design-03 decision
  // 2): its activity is stamped to now so the Recent rule holds it for three
  // days, it is expanded, and its first thread is selected, waking nothing.
  const bringProjectIn = useCallback((groupId: string) => {
    const tabId = stateRef.current.bringProjectIn(groupId, Date.now());
    if (tabId) clearThreadBadges(tabId);
    panelRef.current?.revealProject(groupId);
  }, [clearThreadBadges]);

  const handleNotification = useCallback((tabId: string, type: TabNotification | undefined, projectName: string) => {
    // Route the title through the spinner state machine. An undecorated title (type
    // undefined) is a no-op here, `working` is cleared by output silence, not by a
    // plain title (see spinnerState.ts / docs/bugs.md), so it can't stop the spinner.
    const now = Date.now();
    const timing = getTiming(tabId, now);
    const current = stateRef.current.tabs.find(t => t.id === tabId);
    const cur = current?.notification;
    // The background work flag first, since the notif below is settled against it: a
    // ⏳ sets it, viewed or not, and only the hook's ✅ clears it (plan-02, Fix 7; the
    // restart window reads it; backgroundAfterTitle says why ▶, ⚠ and ⚙ leave it).
    const hadBackground = !!current?.backgroundTasks;
    const background = backgroundAfterTitle(hadBackground, type);
    if (background !== hadBackground) stateRef.current.setBackgroundTasks(tabId, background);
    // The flag goes to onTitle too: a needs-you over background is a background
    // agent's prompt, which Enter answers back to background (onAnswer).
    const next = onTitle(cur, type, timing, now, background);
    // The user is looking at this thread right now: the same test that suppresses
    // the toast below. A `done` that lands on the viewed thread has already been
    // seen, so it clears at once instead of waiting for the next activation (Aryan,
    // 2026-09-19). With the app behind another window it stays until the thread is
    // looked at. A ⏳ stays either way since 2026-11-08: the background work it
    // announced is still running (AFT-25, AFT-43), and the turn's spinner still
    // stops, since the hourglass replaces it.
    const viewing = stateRef.current.activeTabId === tabId && document.hasFocus();
    applyNotif(tabId, cur, onViewedTitle(next, viewing), background);

    if (!type) return;
    // Working indicator is sidebar-only, no toast while Claude is mid-turn
    if (type === 'working') return;
    // Only skip toast if user is actively looking at this tab right now
    if (viewing) return;

    const s = stateRef.current;
    const tab = s.tabs.find(t => t.id === tabId);
    const group = tab?.groupId ? s.groups.find(g => g.id === tab.groupId) : undefined;

    window.afterterm.notify.push({
      id: `toast-${++toastCounter}`,
      tabId,
      type,
      primaryLabel: tab ? threadName(tab) : projectName,
      secondaryLabel: group?.label,
      projectColor: group ? groupColors(group.color).border : undefined,
      projectIcon: group?.icon,
      projectId: group?.id,
      message: toastMessage(type),
    });
  }, [state.setTabNotification]);

  // Esc or Ctrl+C in a terminal ends the working turn from afterterm's view,
  // cancels a permission prompt and cancels a compaction (AFT-42), so the spinner,
  // needs-you and compacting clear; a thread with background work running falls
  // back to background. Leaves other notifs alone.
  const handleUserInput = useCallback((tabId: string) => {
    const tab = stateRef.current.tabs.find(t => t.id === tabId);
    applyNotif(tabId, tab?.notification, onInterrupt(tab?.notification), !!tab?.backgroundTasks);
  }, [state.setTabNotification]);

  // Enter in a terminal. At a permission prompt this is the answer, so needs-you
  // becomes working (and the silence clear drops it again if Claude does not
  // resume). In every other state it is a no-op (spinnerState.ts, onAnswer).
  const handleAnswer = useCallback((tabId: string) => {
    const now = Date.now();
    const timing = getTiming(tabId, now);
    const tab = stateRef.current.tabs.find(t => t.id === tabId);
    applyNotif(tabId, tab?.notification, onAnswer(tab?.notification, timing, now), !!tab?.backgroundTasks);
  }, [state.setTabNotification]);

  // A real keystroke in a thread. An unread chat the user is typing in is no
  // longer unread (Aryan, 2026-09-19); nothing else changes here, the attention
  // state machine has its own two signals above.
  const handleTyped = useCallback((tabId: string) => {
    if (stateRef.current.tabs.find(t => t.id === tabId)?.unread) stateRef.current.setUnread(tabId, false);
  }, []);

  // Every PTY output chunk. Refreshes the tab's silence clock and, if the tab was
  // paused at a compaction, re-arms `working` once Claude's output resumes (see
  // spinnerState.ts; a permission prompt no longer re-arms from output, since
  // arrowing through its options echoes output too). Must stay cheap, no render unless the
  // notif actually changes (only on a rare re-arm), so normal output is free.
  const handleOutput = useCallback((tabId: string, byteLen: number) => {
    const now = Date.now();
    const timing = getTiming(tabId, now);
    const tab = stateRef.current.tabs.find(t => t.id === tabId);
    applyNotif(tabId, tab?.notification, onOutput(tab?.notification, timing, now, byteLen), !!tab?.backgroundTasks);
  }, [state.setTabNotification]);

  // Clock tick: clear a tab's `working` spinner after its output has been silent long
  // enough (fixes the stuck-spinner bug where Stop's ✅ never fires), and its
  // `compacting` after a longer silence (AFT-42: a cancelled compaction sends no hook
  // title), unless Claude Code's record still says busy for a turn (plan-02, Fix 11: a
  // stalled turn keeps its spinner). A thread with background work running falls back
  // to background. Also prunes timing entries for closed tabs.
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      const s = stateRef.current;
      for (const tab of s.tabs) {
        if (tab.notification !== 'working' && tab.notification !== 'compacting') continue;
        const timing = timingRef.current.get(tab.id);
        if (timing) applyNotif(tab.id, tab.notification, onTick(tab.notification, timing, now, tab.recordStatus), !!tab.backgroundTasks);
      }
      for (const id2 of [...timingRef.current.keys()]) {
        if (!s.tabs.some(t => t.id === id2)) timingRef.current.delete(id2);
      }
    }, 500);
    return () => clearInterval(id);
  }, []);

  // Sleep destroys the PTY too, and its exit listener is unregistered before the
  // kill for exactly that reason, but the guard stays: a sleeping thread must never
  // be closed by its own process going away.
  const handlePtyExit = useCallback((tabId: string) => {
    const tab = stateRef.current.tabs.find(t => t.id === tabId);
    if (!tab || tab.asleep) return;
    closeThreadNow(tabId);
  }, []);

  // Closing a thread inside a project files it in that project's history; a thread
  // in General is simply gone. Neither says anything: a "Moved to history" toast was
  // tried and Aryan dropped it at the Phase 4 handoff (2026-09-07), closing is too
  // frequent an action to announce.
  const closeThreadNow = useCallback((tabId: string) => {
    const wasAsleep = !!stateRef.current.tabs.find(t => t.id === tabId)?.asleep;
    const toHistory = stateRef.current.closeTab(tabId);
    if (!toHistory && wasAsleep) {
      // Closing an awake thread goes through handleTail, which is what deletes a
      // General thread's tail file. An asleep thread has no terminal left to hand a
      // tail over, so its file has to be dropped here instead of waiting for the
      // next launch's prune.
      window.afterterm.threads.deleteTail(tabId);
      setTails(prev => {
        if (prev[tabId] === undefined) return prev;
        const next = { ...prev };
        delete next[tabId];
        return next;
      });
    }
  }, []);

  // Every close the user asks for comes through here. A running server is the one
  // case that stops something the user cannot get back by reopening the thread, so
  // it asks first; everything else closes immediately. A PTY that exited on its own
  // goes straight to closeThreadNow: the process is already gone, there is nothing
  // left to confirm.
  const closeThread = useCallback((tabId: string) => {
    const tab = stateRef.current.tabs.find(t => t.id === tabId);
    if (tab && tab.port !== undefined && needsCloseConfirm(tab)) {
      setPendingConfirm({ kind: 'close', tabId, port: tab.port });
      return;
    }
    closeThreadNow(tabId);
  }, [closeThreadNow]);

  // Open a running server's page in the default browser, through the same
  // safelisted shell:openExternal the terminal's links use.
  const openLocalhost = useCallback((tabId: string) => {
    const tab = stateRef.current.tabs.find(t => t.id === tabId);
    if (!tab || tab.port === undefined) return;
    const url = localhostUrl(tab.port);
    // The harness cannot see a browser open, so the URL is recorded on the same
    // window object the terminal layer already publishes for it. Extended, not
    // replaced: Terminal/index.tsx owns tail/activeTail/commandState on it.
    const win = window as unknown as { __afterterm?: Record<string, unknown> };
    win.__afterterm = { ...(win.__afterterm ?? {}), lastOpenExternal: url };
    window.afterterm.shell.openExternal(url);
  }, []);

  // Sleep, wake and resume, the three things Phase 4 adds. Sleeping is a record
  // change here; the terminal layer sees `asleep` turn true and does the rest
  // (capture the tail, unhook the listeners, kill the process tree).
  const sleepThreadNow = useCallback((tabId: string) => {
    stateRef.current.sleepTab(tabId);
    // Nothing left to time: the spinner's silence clock belongs to a running
    // process, and a stale entry would survive into the next wake.
    timingRef.current.delete(tabId);
    window.afterterm.notify.dismissTab(tabId);
  }, []);

  // Every sleep the user asks for comes through here, and a running server asks
  // first, exactly as closing one does: sleeping kills the process tree, so the
  // server stops either way. Only the wording differs, since Wake brings this one
  // back. The quit flush (sleepAllForShutdown) is not a user sleep and deliberately
  // does not come through here.
  const sleepThread = useCallback((tabId: string) => {
    const tab = stateRef.current.tabs.find(t => t.id === tabId);
    if (tab && tab.port !== undefined && needsSleepConfirm(tab)) {
      setPendingConfirm({ kind: 'sleep', tabId, port: tab.port });
      return;
    }
    sleepThreadNow(tabId);
  }, [sleepThreadNow]);

  // No screen switch and no activation: Wake from a background thread's menu wakes
  // it where it is, and the pane's own Wake button is on the active thread anyway.
  // A chat reads its transcript before the wake (one small IPC round trip, a head
  // and tail read), so a session that moved worktree resumes in the folder it was
  // last working in rather than the one the hook recorded (applyClaudeMeta); the
  // wake never waits on a failed read.
  const wakeThread = useCallback(async (tabId: string) => {
    const tab = stateRef.current.tabs.find(t => t.id === tabId);
    if (tab?.claudeSessionId && tab.claudeCwd) {
      try { await refreshClaudeMeta(tabId, tab.claudeSessionId, tab.claudeCwd); } catch { /* wake anyway */ }
    }
    stateRef.current.wakeTab(tabId);
    // Waking is acting on the thread, the same as typing in it: the unread mark
    // has done its job.
    if (stateRef.current.tabs.find(t => t.id === tabId)?.unread) stateRef.current.setUnread(tabId, false);
  }, [refreshClaudeMeta]);
  const wakeThreadRef = useRef(wakeThread);
  wakeThreadRef.current = wakeThread;

  // Restart to update. The restart window lists every awake thread and what
  // happens to it (restartRows in src/update-check.ts); "Restart now" records
  // them for the quit flush below, then asks main to start Setup and quit. When
  // main cannot go ahead (a copy that is not installed, Setup not starting) the
  // window closes and the notice says why.
  // Computed from state on every render, so a status that changes while the window
  // is open (Claude Code's record, a hook title, a prompt mark, the process tree)
  // redraws its row at once. plan-02, Fixes 6 to 10: Claude's own record first, the
  // hook's notification as the fallback, and for a thread with no live Claude its
  // shell, from the prompt marks or else its process tree.
  const awakeThreads = (): AwakeThread[] => state.tabs.filter(t => !t.asleep).map(t => {
    const plan = wakePlan(t);
    return {
      id: t.id,
      name: threadName(t),
      kind: threadKind(t),
      resumes: !!plan.resumeSessionId,
      midTurn: isMidTurn(t.recordStatus, t.notification),
      background: hasBackgroundTask(t.recordStatus, t.notification, t.backgroundTasks),
      claudeAlive: t.recordStatus !== undefined,
      shellBusy: shellBusy(t.atPrompt, t.hasChildren),
      rerunPort: plan.runCommand !== null ? t.port : undefined,
    };
  });

  // Whichever button opened the restart window (the title bar's or the About
  // window's), read Claude Code's session records now rather than up to two seconds
  // ago. The result is ignored: any status that changed arrives on onStatus and the
  // rows re-render with it.
  useEffect(() => {
    if (updateWindow !== 'restart') return;
    void window.afterterm.claudeRecord.refresh().catch(() => { /* the timer's next read covers it */ });
  }, [updateWindow]);

  const restartNow = useCallback(async () => {
    const s = stateRef.current;
    wakeAfterUpdateRef.current = s.tabs.filter(t => !t.asleep).map(t => t.id);
    const result = await window.afterterm.update.restart({
      activeThreadId: s.activeTabId || undefined,
      screen: screenRef.current,
      projectId: screenRef.current === 'project' ? projectPageIdRef.current ?? undefined : undefined,
    });
    if (!result.ok) {
      wakeAfterUpdateRef.current = [];
      setUpdateWindow(null);
    }
  }, []);

  // Bring a closed thread back from its project's history. The recreated tab carries
  // the closed thread's id, so its saved tail replays, and it comes back awake.
  const resumeThread = useCallback((groupId: string, entryId: string) => {
    const s = stateRef.current;
    const group = s.groups.find(g => g.id === groupId);
    const entry = group?.history.find(e => e.id === entryId);
    const tabId = s.resumeFromHistory(groupId, entryId);
    if (!tabId || !entry) return;
    // The new tab is not in state yet this tick, so its session and folder are read
    // from the entry, which is where tabFromHistory takes them from.
    const cwd = entry.cwd ?? group?.cwd;
    if (entry.kind === 'chat' && entry.sessionId && entry.cwd) {
      refreshClaudeMeta(tabId, entry.sessionId, entry.cwd);
    }
    refreshGit(tabId, cwd);
    goScreen('workspace');
  }, [refreshClaudeMeta, refreshGit, goScreen]);

  // Loops, Open chat (design-07): the loop's remembered chat, wherever it is now
  // (loopsView.ts, openChatPlan). An open thread is shown (and woken when asleep), a
  // closed one comes back from its project's history, and a chat in neither is
  // resumed in a new thread of the loop's project. A worktree that was deleted since
  // cannot hold the chat any more: it opens in the project's folder instead, and
  // Claude Code says so itself if it cannot find the session there.
  const openLoopChat = useCallback(async (loop: Loop) => {
    const s = stateRef.current;
    const plan = openChatPlan(loop, s.tabs, s.groups);
    if (plan.kind === 'none') { showToast({ message: 'No chat' }); return; }
    if (plan.kind === 'tab') {
      openThreadInWorkspace(plan.tabId);
      if (plan.wake) await wakeThreadRef.current(plan.tabId);
      return;
    }
    if (plan.kind === 'history') { resumeThread(plan.groupId, plan.entryId); return; }
    let entry = plan.entry;
    if (entry.cwd) {
      const st = await window.afterterm.files.stat([entry.cwd]).catch(() => ({} as Record<string, 'file' | 'dir' | null>));
      if (st[entry.cwd] !== 'dir') {
        const folder = s.groups.find(g => g.id === plan.groupId)?.cwd;
        entry = { ...entry, cwd: folder };
        if (!folder) delete entry.cwd;
        showToast({ message: 'Folder gone, opened in the project folder' });
      }
    }
    const tabId = s.openResumedChat(entry, plan.groupId);
    if (entry.sessionId && entry.cwd) refreshClaudeMeta(tabId, entry.sessionId, entry.cwd);
    refreshGit(tabId, entry.cwd);
    goScreen('workspace');
  }, [openThreadInWorkspace, resumeThread, refreshClaudeMeta, refreshGit, goScreen, showToast]);
  const loopToast = useCallback((message: string, actionLabel?: string, onAction?: () => void) => {
    showToast({ message, actionLabel, onAction });
  }, [showToast]);
  const loops = useLoops();
  const activityDays = useActivityDays();
  // Home's Progress column: open or closed (remembered per viewer in local storage,
  // a convenience only) and its filter, here so the workspace card's rotting and All
  // buttons can open it filtered.
  const [progressOpen, setProgressOpenState] = useState<boolean>(() => {
    try { return localStorage.getItem('afterterm.progressOpen') !== 'false'; } catch { return true; }
  });
  const setProgressOpen = useCallback((open: boolean) => {
    setProgressOpenState(open);
    try { localStorage.setItem('afterterm.progressOpen', String(open)); } catch { /* not kept */ }
  }, []);
  const [progressFilter, setProgressFilter] = useState<LoopFilter>(NO_FILTER);

  // The last lines of a terminal that is about to be destroyed. A sleeping thread's
  // tail is what its pane shows and what it replays on waking, so it is both kept in
  // state and written to disk. A closed thread's is only worth keeping when the
  // thread itself was kept: a closed General thread leaves nothing behind, file
  // included.
  const handleTail = useCallback((tabId: string, lines: string[], reason: 'sleep' | 'close') => {
    if (reason === 'sleep') {
      setTails(prev => ({ ...prev, [tabId]: lines }));
      window.afterterm.threads.saveTail(tabId, lines);
      return;
    }
    const inHistory = stateRef.current.groups.some(g => g.history.some(e => e.id === tabId));
    if (inHistory) window.afterterm.threads.saveTail(tabId, lines);
    else window.afterterm.threads.deleteTail(tabId);
    setTails(prev => {
      if (prev[tabId] === undefined) return prev;
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
  }, []);

  // Flush a synchronous save on window close, the debounced save's pending timer is
  // cleared on unmount, so the last <2s of changes (e.g. a fresh cwd) would be lost.
  const initializedRef = useRef(false);
  initializedRef.current = initialized;
  useEffect(() => {
    const flush = () => {
      const s = stateRef.current;
      // Before the session has loaded there is nothing of the user's to save, and
      // saving would overwrite the file with an empty one.
      if (!initializedRef.current) return;
      // Screens first: once the window is gone the buffers are gone with it, and a
      // thread with no saved tail wakes into a blank terminal.
      window.afterterm.threads.saveTailsSync(terminalRef.current?.readAllTails() ?? {});
      // Quitting puts every thread to sleep, stamped now, so the "Asleep · 2d" chip
      // on the next launch counts from when the app actually closed.
      // The panel flag rides along here too, or a quit with the panel hidden
      // would come back with it shown (found in the Phase 8 self-test).
      // An update restart also records which threads were awake, to wake them on
      // the other side; on any other quit the list is empty and nothing is written.
      const data = serializeSession(sleepAllForShutdown(s.tabs, Date.now()), s.groups, s.activeTabId, savedUi(panelHiddenRef.current, panelWidthRef.current), wakeAfterUpdateRef.current, s.splits);
      window.afterterm.session.saveSync(JSON.stringify(data));
    };
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, []);

  // Closing the last thread hands over to Home. (Until 0.10.0 a fresh General
  // thread was spawned here instead, which is why a first launch, and closing the
  // last thread, started a terminal nobody asked for.) Opening the workspace on
  // purpose with no threads stays there: its panel holds New thread and New
  // project, and the main pane says what to do.
  const prevTabCountRef = useRef(0);
  useEffect(() => {
    const prev = prevTabCountRef.current;
    prevTabCountRef.current = state.tabs.length;
    if (initialized && prev > 0 && state.tabs.length === 0 && screenRef.current === 'workspace') {
      goScreen('home');
    }
  }, [initialized, state.tabs.length, goScreen]);

  // Play the entrance for whichever screen is now showing: on every switch, and
  // once on the first paint after the restored session has loaded (never on the
  // empty paint before it, which has nothing to animate in).
  useEffect(() => {
    if (!initialized) return;
    setEnterClass(screen === 'home' ? 'enter-home' : screen === 'project' ? 'enter-project' : 'enter-workspace');
    const timer = setTimeout(() => setEnterClass(''), ENTER_MS);
    return () => clearTimeout(timer);
  }, [initialized, screen, screenSeq]);

  // The clock behind the relative times on Home and the project page, and behind
  // the "Asleep · 2d" chip and the asleep pane's "asleep since" line. It is set
  // once on entry so a screen opened after a long spell elsewhere never shows a
  // stale "5m".
  // Since Phase 8 the panel reads it too (the Recent rule's 3-day window and the
  // docked Other rows' "2d"), so it ticks on every screen.
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(id);
  }, [screen, screenSeq, activeTabAsleep]);

  // A sleeping thread's pane shows the output it had when it went to sleep. It is
  // already in `tails` when the thread slept in this session; a thread restored from
  // disk has to read its file, once (an empty array is stored for a missing file, so
  // a thread that never saved one is not re-read on every render).
  // Every asleep thread on screen counts, so both halves of a split show theirs.
  useEffect(() => {
    const ids = asleepPanesKey ? asleepPanesKey.split('|') : [];
    const missing = ids.filter(id => tails[id] === undefined);
    if (missing.length === 0) return;
    let cancelled = false;
    for (const id of missing) {
      window.afterterm.threads.readTail(id).then(lines => {
        if (!cancelled) setTails(prev => (prev[id] !== undefined ? prev : { ...prev, [id]: lines ?? [] }));
      });
    }
    return () => { cancelled = true; };
  }, [asleepPanesKey, tails]);

  // A toast is drawn from what it was sent, so a project edited while its toast
  // is on screen tells the overlay its new name, colour and icon. The first
  // render only records the projects: nothing on screen can be out of date yet.
  const prevGroupsRef = useRef<typeof state.groups | null>(null);
  useEffect(() => {
    const prev = prevGroupsRef.current;
    prevGroupsRef.current = state.groups;
    if (!prev) return;
    for (const look of projectLookChanges(prev, state.groups)) {
      window.afterterm.notify.projectUpdated({
        projectId: look.projectId,
        label: look.label,
        color: groupColors(look.color).border,
        icon: look.icon,
      });
    }
  }, [state.groups]);

  // Folder existence for the screens that show it and, since Phase 9, for the
  // thread menu's own Explorer entry. One round trip per screen entry, so a folder
  // deleted while you were in the workspace is caught on the way back, plus one
  // whenever the set of folders itself changes (a thread cd-ing somewhere new, a
  // project added), which is what keeps the workspace's thread menus honest
  // without polling, and one whenever a git read moves a thread's worktree or
  // working tree top (gitMoves), which is how a worktree deleted from outside
  // gets noticed within a poll. Project folders and thread folders go in one call.
  const folderKey = [
    ...state.groups.map(g => g.cwd),
    ...state.tabs.map(t => threadFolder(t)),
  ].filter((f): f is string => !!f).sort().join('\0');
  useEffect(() => {
    const folders = folderKey === '' ? [] : Array.from(new Set(folderKey.split('\0')));
    if (folders.length === 0) return;
    let cancelled = false;
    window.afterterm.projects.checkFolders(folders).then(result => {
      if (!cancelled) setFolderExists(result);
    });
    return () => { cancelled = true; };
  }, [screen, screenSeq, folderKey, gitMoves]);

  // Editor detection runs in main at startup; the renderer just reads the result
  // once. A prefs.json editorPath that exists but is not an editor is the one
  // case worth saying out loud, so it gets a toast with a way to fix it.
  useEffect(() => {
    window.afterterm.editors.list().then(setEditors);
    window.afterterm.editors.prefsPathInvalid().then(invalid => {
      if (invalid) showEditorPathToast();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // PTY input and output stamp the thread (and its project) as recently used, so
  // Home's ordering and its "5m" follow work that happens without a tab switch.
  // Main throttles this to one stamp per tab per 15 seconds.
  useEffect(() => {
    window.afterterm.pty.onActivity(({ tabId, at }) => {
      stateRef.current.touchActivity(tabId, at);
    });
  }, []);

  // Main watches each awake thread's process tree for a listening socket and
  // pushes the port it found (or null when it has gone). Nothing here wakes or
  // activates anything: a port appearing on a background thread only changes its
  // row and its project's pills.
  // A null for a thread that is already asleep is dropped: sleeping kills the
  // process tree, and main reports the listener going away once the kill has run,
  // but the record keeps its port while asleep (it is what marks the thread as a
  // server, so the pane can say "runs npm start" and the wake can re-run it). Only
  // an awake thread losing its listener (the server was stopped, the shell stays)
  // clears the port.
  useEffect(() => {
    window.afterterm.pty.onPort(({ tabId, port }) => {
      if (port === null && stateRef.current.tabs.find(t => t.id === tabId)?.asleep) return;
      stateRef.current.setPort(tabId, port);
    });
  }, []);

  // Whether each awake thread's shell has a process below it, from main's process
  // list, pushed when it changes: the restart window's fallback for a shell with no
  // prompt marks (plan-02, Fix 8). Kept on the tab, never saved; a value for a thread
  // already asleep is dropped by the setter.
  useEffect(() => {
    window.afterterm.pty.onChildren(({ tabId, hasChildren }) => {
      stateRef.current.setHasChildren(tabId, hasChildren);
    });
  }, []);

  // Harness hook: the current record of one thread (drive eval
  // "window.__afterterm.tab('tab-1')"), so a test can check port, lastCommand,
  // asleep, and recordStatus, atPrompt, hasChildren and backgroundTasks (never saved,
  // so only here), without going through the saved file's two second debounce.
  // Extended, not replaced, for the same reason as openLocalhost's hook above.
  useEffect(() => {
    const win = window as unknown as { __afterterm?: Record<string, unknown> };
    win.__afterterm = {
      ...(win.__afterterm ?? {}),
      tab: (tabId: string) => stateRef.current.tabs.find(t => t.id === tabId) ?? null,
      // Automatic updates: wake a thread, and give one a state, so a test can fill
      // the restart window (a chat mid-turn) without a real Claude Code session.
      wake: (tabId: string) => wakeThreadRef.current(tabId),
      // 'background' also sets the background work flag, as the hook's ⏳ does, and
      // quiet (undefined) clears it: the state is drawn from that flag since
      // 2026-11-08 (withBackground), so without it the next output chunk would undo
      // the state set here.
      setNotification: (tabId: string, n: TabNotification | undefined) => {
        if (n === 'background') stateRef.current.setBackgroundTasks(tabId, true);
        else if (n === undefined) stateRef.current.setBackgroundTasks(tabId, false);
        stateRef.current.setTabNotification(tabId, n);
      },
      update: () => updateRef.current,
      // Phase 8: the same for a project (lastActiveAt, collapsed, icon, pinned).
      group: (groupId: string) => stateRef.current.groups.find(g => g.id === groupId) ?? null,
      // Phase 7: the aggregate every count reads from (attention.ts), per project
      // and in total, for the harness's `counts` command. Keyed by project label
      // as well as id so a test can name the project it seeded.
      counts: () => {
        const s = stateRef.current;
        const perProject = projectAttention(s.groups, s.tabs);
        return {
          total: totalAttention(s.groups, s.tabs),
          projects: s.groups
            .filter(g => !g.archived)
            .map(g => ({ id: g.id, label: g.label, pinned: g.pinned, ...(perProject.get(g.id) ?? { waiting: 0, working: 0, running: 0, finished: 0, compacting: 0, background: 0 }) })),
          rail: railProjects(s.groups, s.tabs).map(g => g.label),
        };
      },
      // Phase 8: the persisted panel flag, read by the harness's `rail` command,
      // and the panel's own row order, the list Ctrl+Shift+Down/Up walks.
      panelHidden: () => panelHiddenRef.current,
      panelWidth: () => panelWidthRef.current,
      panelOrder: () => panelRef.current?.visibleIds() ?? [],
    };
  }, []);

  // A project page whose project was deleted (from its own menu, say) has nothing
  // left to show, so it falls back to Home.
  useEffect(() => {
    if (!initialized || screen !== 'project') return;
    if (!projectPageId || !state.groups.some(g => g.id === projectPageId)) goScreen('home');
  }, [initialized, screen, projectPageId, state.groups, goScreen]);

  // The command line a thread's user just entered, captured from the OSC 133 marks
  // (commandMarks.ts). It is what a sleeping server re-runs on wake.
  const handleCommand = useCallback((tabId: string, command: string) => {
    stateRef.current.setLastCommand(tabId, command);
  }, []);

  // Whether the thread's shell sits at its prompt, from the same marks: what the
  // restart window reads for a thread with no live Claude (plan-02, Fix 8). The prompt
  // coming back also means the thread's Claude has gone, so its background work flag
  // clears and a leftover hourglass goes (backgroundAfterPrompt; review 1 of PR #90:
  // without a record afterterm can read, nothing else would clear it after /exit).
  // endBackgroundWork decides on the latest state, not this render's: a ⏳ and the
  // prompt can arrive in the same batch of output.
  const handlePromptState = useCallback((tabId: string, atPrompt: boolean) => {
    stateRef.current.setAtPrompt(tabId, atPrompt);
    if (!backgroundAfterPrompt(true, atPrompt)) stateRef.current.endBackgroundWork(tabId);
  }, []);

  // The Files list of the chat on screen is read when it comes on screen (a
  // restored, asleep chat included: reading needs no wake), and again on every
  // turn through the meta push above.
  // Both halves of a split are on screen, so both lists are read.
  const paneSessionsKey = panes.map(id => {
    const t = state.tabs.find(x => x.id === id);
    return t?.claudeSessionId && t.claudeCwd ? `${id}\0${t.claudeSessionId}\0${t.claudeCwd}` : '';
  }).filter(Boolean).join('|');
  useEffect(() => {
    if (!initialized || !paneSessionsKey) return;
    for (const entry of paneSessionsKey.split('|')) refreshFiles(entry.split('\0')[0]);
  }, [initialized, paneSessionsKey, refreshFiles]);

  // Dragging a thread from the sidebar over the main pane (design-06): what a
  // release there would do. Over the pane at all is the sidebar's call (past
  // its right edge); this decides which half, or which refusal.
  const paneTargetAt = useCallback((dragId: string, x: number, y: number): PaneTarget | null => {
    if (screenRef.current !== 'workspace') return null;
    const area = document.querySelector('.workspace .terminal-area');
    const panesEl = document.querySelector('.workspace .term-panes');
    if (!area || !panesEl) return null;
    const a = area.getBoundingClientRect();
    if (x < a.left || x > a.right || y < a.top || y > a.bottom) return null;
    const r = panesEl.getBoundingClientRect();
    if (r.width === 0) return null;
    const s = stateRef.current;
    return paneDropTarget(s.tabs, s.groups, s.splits, s.activeTabId, dragId, x < r.left + r.width / 2 ? 'a' : 'b');
  }, []);
  const onPaneHover = useCallback((t: PaneTarget | null) => {
    setPaneDrop(prev => (JSON.stringify(prev) === JSON.stringify(t) ? prev : t));
  }, []);
  // A drop on a half: the dragged thread goes on that side and gets the focus.
  const onPaneDrop = useCallback((dragId: string, t: PaneTarget) => {
    setPaneDrop(null);
    if (t.kind !== 'half' || t.bad) return;
    const s = stateRef.current;
    s.makeSplit(s.activeTabId, dragId, t.side);
    clearThreadBadges(dragId);
  }, [clearThreadBadges]);

  // One column's header (Terminal/index.tsx draws one per thread on screen):
  // a whole thread view's header, with its own dots menu, editor button and
  // Files button, compact when it is one half of two.
  const headerFor = (tab: Tab, compact: boolean) => {
    const group = tab.groupId ? state.groups.find(g => g.id === tab.groupId) : undefined;
    return (
      <Header
        tab={tab}
        compact={compact}
        group={group}
        groups={state.groups}
        now={now}
        projectExplorer={group?.cwd ? {
          missing: folderMissing(group),
          open: () => openFolderInExplorer(group.cwd!),
        } : undefined}
        editor={threadEditor(tab)}
        files={filesButtonFor(tab)}
        actions={{
          moveToGroup: (id) => id ? state.addToGroup(tab.id, id) : state.removeFromGroup(tab.id),
          close: () => closeThread(tab.id),
          rename: () => setRenaming({ kind: 'thread', id: tab.id }),
          sleep: () => sleepThread(tab.id),
          wake: () => wakeThread(tab.id),
          setUnread: unread => state.setUnread(tab.id, unread),
          openLocalhost: () => openLocalhost(tab.id),
          openInExplorer: threadExplorer(tab),
          openProjectPage: tab.groupId ? () => goScreen('project', tab.groupId) : undefined,
        }}
      />
    );
  };

  const tabInfos = state.tabs.map(t => ({ id: t.id, shellId: t.shellId, cwd: t.cwd, fontSize: t.fontSize, claudeSessionId: t.claudeSessionId, claudeCwd: t.claudeCwd, asleep: t.asleep, wokeAt: t.wokeAt, port: t.port, lastCommand: t.lastCommand, reattach: t.reattach }));

  const activeTab = state.tabs.find(t => t.id === state.activeTabId);
  const activeSplit = splitOf(state.splits, state.activeTabId);
  const pageGroup = projectPageId ? state.groups.find(g => g.id === projectPageId) : undefined;
  const folderMissing = (group: { cwd?: string }) => !!group.cwd && folderExists[group.cwd] === false;

  return (
    <div className={`app${enterClass ? ` ${enterClass}` : ''}`} data-screen={screen}>
      <TitleBar
        update={update}
        onOpenAbout={() => setUpdateWindow('about')}
        onRestart={() => setUpdateWindow('restart')}
      />

      <div className="app-body">
      {/* The always-on rail (Phase 8, design-03 decision 1): on every screen, never
          hidden. Its Search and New thread buttons only open while the panel is
          hidden on the workspace, so they stand in for the panel's own rows. */}
      <Rail
        screen={screen}
        panelHidden={panelHidden}
        groups={state.groups}
        tabs={state.tabs}
        editors={editors}
        folderExists={folderExists}
        projectActions={projectActions}
        onGoHome={() => goScreen('home')}
        onGoWorkspace={() => goScreen('workspace')}
        onTogglePanel={() => {
          // Home and the project page have no panel: the toggle takes you to
          // the workspace with it showing, rather than flipping a hidden flag.
          if (screen !== 'workspace') {
            setPanelShut(false);
            setPanelHidden(false);
            goScreen('workspace');
          } else {
            togglePanel();
          }
        }}
        onSearch={() => setPaletteOpen(open => !open)}
        onNewThread={setChooser}
        onOpenProject={openProjectFromRail}
        onUsage={toggleUsage}
      />

      <div className="app-main">
      {screen === 'home' && (
        <Home
          groups={state.groups}
          tabs={state.tabs}
          now={now}
          editors={editors}
          folderExists={folderExists}
          actions={projectActions}
          onNewProject={() => setProjectModal({ mode: 'create' })}
          loops={loops}
          days={activityDays}
          progressOpen={progressOpen}
          setProgressOpen={setProgressOpen}
          filter={progressFilter}
          setFilter={setProgressFilter}
          onOpenLoopChat={openLoopChat}
          onToast={loopToast}
        />
      )}

      {screen === 'project' && pageGroup && (
        <ProjectPage
          group={pageGroup}
          tabs={state.tabs.filter(t => t.groupId === pageGroup.id)}
          activeTabId={state.activeTabId}
          now={now}
          editors={editors}
          folderMissing={folderMissing(pageGroup)}
          actions={projectActions}
          onOpenThread={openThreadInWorkspace}
          onResume={entryId => resumeThread(pageGroup.id, entryId)}
          initialTab={projectPageTab}
          threadMenu={tab => buildThreadMenu(tab, state.groups, {
            moveToGroup: id => (id ? state.addToGroup(tab.id, id) : state.removeFromGroup(tab.id)),
            close: () => closeThread(tab.id),
            rename: () => setRenaming({ kind: 'thread', id: tab.id }),
            sleep: () => sleepThread(tab.id),
            wake: () => wakeThread(tab.id),
            setUnread: unread => state.setUnread(tab.id, unread),
            openLocalhost: () => openLocalhost(tab.id),
            openInExplorer: threadExplorer(tab),
            openInEditor: threadEditor(tab),
            // No openProjectPage: these rows are on the project page already.
          })}
          onBack={() => goScreen('home')}
        />
      )}

      {/* The workspace stays mounted on every screen (hidden with CSS) so its
          terminals keep running and the active tab's Claude resume still fires. */}
      <div className={`workspace${screen === 'workspace' ? '' : ' hidden'}`}>
        <SidePanel
          ref={panelRef}
          tabs={state.tabs}
          groups={state.groups}
          activeTabId={state.activeTabId}
          hidden={panelHidden || panelShut}
          width={shownPanelWidth}
          onWidthChange={changePanelWidth}
          now={now}
          shells={shells}
          onActivate={handleActivate}
          onClose={closeThread}
          onSleep={sleepThread}
          onSetUnread={state.setUnread}
          onRenameThread={tabId => setRenaming({ kind: 'thread', id: tabId })}
          onWake={wakeThread}
          onOpenLocalhost={openLocalhost}
          threadExplorer={threadExplorer}
          threadEditor={threadEditor}
          onNewTab={state.addTab}
          onOpenChooser={setChooser}
          onOpenProjectPage={groupId => goScreen('project', groupId)}
          onTogglePin={projectActions.togglePin}
          onNewProject={() => setProjectModal({ mode: 'create' })}
          editors={editors}
          folderExists={folderExists}
          projectActions={projectActions}
          onAddToGroup={state.addToGroup}
          onRemoveFromGroup={state.removeFromGroup}
          onRenameGroup={state.renameGroup}
          onSetGroupColor={state.setGroupColor}
          onToggleGroupCollapse={state.toggleGroupCollapse}
          onSetGroupsCollapsed={state.setGroupCollapsedMany}
          onBringIn={bringProjectIn}
          holdInRecent={archiving}
          onPlaceThread={state.placeThreadAt}
          onPlaceProject={(groupId, section, beforeId) => {
            const group = findGroup(groupId);
            if (state.placeProject(groupId, section, beforeId) && group) {
              showToast({ message: `${section === 'pinned' ? 'Pinned' : 'Unpinned'} ${group.label}` });
            }
          }}
          splits={state.splits}
          onUngroup={state.ungroup}
          paneAt={paneTargetAt}
          onPaneHover={onPaneHover}
          onPaneDrop={onPaneDrop}
        />

        <div className="terminal-area">
          {panes.length === 0 && (
            <Header
              tab={undefined}
              emptyText={state.tabs.length === 0 ? 'No threads open' : undefined}
              group={undefined}
              groups={state.groups}
              now={now}
            />
          )}
          {initialized && state.tabs.length === 0 && (
            <div className="no-threads">
              <button className="b p" data-new-thread="" onClick={() => openChooserFromShortcut()}>New thread</button>
              <span className="k">Ctrl Shift T</span>
            </div>
          )}
          {initialized && (
            <TerminalArea
              ref={terminalRef}
              tabs={tabInfos}
              activeTabId={state.activeTabId}
              visible={screen === 'workspace'}
              panes={panes}
              ratio={activeSplit?.ratio ?? 0.5}
              renderHeader={(id, split) => {
                const tab = state.tabs.find(t => t.id === id);
                return tab ? headerFor(tab, split) : null;
              }}
              // An asleep thread has no terminal at all, so its pane stands in
              // for one inside its card: the saved tail, dimmed, and Wake.
              renderAsleep={(id, focused) => {
                const tab = state.tabs.find(t => t.id === id);
                return tab ? (
                  <AsleepPane
                    tab={tab}
                    tail={tails[id] ?? null}
                    now={now}
                    focused={focused}
                    onWake={() => wakeThread(id)}
                  />
                ) : null;
              }}
              onFocusPane={id => handleActivate(id)}
              onRatio={r => { if (activeSplit) state.setSplitRatio(activeSplit.id, r); }}
              dropZone={paneDrop}
              onTitleChange={state.renameTab}
              onCwdChange={handleCwdChange}
              onNotification={handleNotification}
              onUserInput={handleUserInput}
              onAnswer={handleAnswer}
              onTyped={handleTyped}
              onOutput={handleOutput}
              onFontSizeChange={state.setTabFontSize}
              onExit={handlePtyExit}
              onShellGone={(tabId) => stateRef.current.sleepTab(tabId)}
              onTail={handleTail}
              onCommand={handleCommand}
              onPromptState={handlePromptState}
              fileContext={fileContextFor}
              onOpenFileLink={openFileLink}
              fileLinkMenu={fileLinkMenu}
            />
          )}
        </div>
      </div>
      </div>
      </div>

      {chooser && (
        <NewThreadChooser
          anchor={chooser}
          groups={state.groups}
          currentGroupId={activeTab?.groupId}
          shells={shells}
          onPick={(groupId, shellId) => {
            state.addTab(groupId, shellId);
            setChooser(null);
            goScreen('workspace');
          }}
          onClose={() => setChooser(null)}
        />
      )}

      {paletteOpen && (
        <SearchPalette
          groups={state.groups}
          tabs={state.tabs}
          onOpenProject={groupId => { projectActions.open(groupId); setPaletteOpen(false); }}
          onOpenThread={tabId => { openThreadInWorkspace(tabId); setPaletteOpen(false); }}
          onOpenHistory={(groupId, _entryId) => {
            // A history hit opens its project page on the History tab, where the row
            // and its Resume button live; the entry id is not needed to get there,
            // the list is short and searchable in place.
            goScreen('project', groupId);
            setProjectPageTab('history');
            setPaletteOpen(false);
          }}
          onClose={() => setPaletteOpen(false)}
        />
      )}

      {projectModal && (() => {
        const editing = projectModal.groupId ? state.groups.find(g => g.id === projectModal.groupId) : undefined;
        // An edit whose project vanished (deleted underneath the menu) has nothing to show.
        if (projectModal.mode === 'edit' && !editing) return null;
        const initial: GroupDraft = editing
          ? { label: editing.label, color: editing.color, cwd: editing.cwd, shellId: editing.shellId, icon: editing.icon }
          : { label: '', color: nextGroupColor(state.groups) };
        return (
          <GroupModal
            mode={projectModal.mode}
            initial={initial}
            shells={shells}
            onCancel={() => setProjectModal(null)}
            onSubmit={(draft, openTerminal) => {
              if (editing) {
                state.updateGroup(editing.id, draft);
              } else {
                state.createConfiguredGroup(draft, openTerminal);
                // A new project with a terminal in it belongs on screen, not behind
                // the Home board that was used to create it.
                if (openTerminal) goScreen('workspace');
              }
              setProjectModal(null);
            }}
          />
        );
      })()}

      {renaming && (() => {
        // Opening the menu took the keyboard away from the terminal, and nothing else
        // gives it back, so typing after a rename would go nowhere.
        const close = () => {
          setRenaming(null);
          requestAnimationFrame(() => terminalRef.current?.focusActive());
        };
        if (renaming.kind === 'project') {
          const group = state.groups.find(g => g.id === renaming.id);
          if (!group) return null;
          return (
            <RenameDialog
              title="Rename project"
              initial={group.label}
              onCancel={close}
              onSave={name => { state.renameGroup(group.id, name.trim()); close(); }}
            />
          );
        }
        const tab = state.tabs.find(t => t.id === renaming.id);
        if (!tab) return null;
        return (
          <RenameDialog
            title="Rename thread"
            initial={threadName(tab)}
            placeholder={automaticThreadName(tab)}
            onCancel={close}
            onSave={name => { state.setThreadName(tab.id, name); close(); }}
          />
        );
      })()}

      {pendingConfirm && (() => {
        const tab = state.tabs.find(t => t.id === pendingConfirm.tabId);
        const text = pendingConfirm.kind === 'close'
          ? closeConfirmText(pendingConfirm.port)
          : sleepConfirmText(pendingConfirm.port, tab ? wakePlan(tab) : { resumeSessionId: null, runCommand: null });
        return (
          <ConfirmDialog
            title={text.title}
            body={text.body}
            confirmLabel={text.confirm}
            cancelLabel={text.cancel}
            // Only closing is destructive: a slept thread is still there, and Wake
            // brings it back (its server, or its chat when it holds a session id).
            danger={pendingConfirm.kind === 'close'}
            onConfirm={() => {
              // The thread may have been slept or closed by other means while the
              // dialog stood; either action on an id that is no longer there is a
              // no-op (closeTab and sleepTab both find no tab and change nothing).
              if (pendingConfirm.kind === 'close') closeThreadNow(pendingConfirm.tabId);
              else sleepThreadNow(pendingConfirm.tabId);
              setPendingConfirm(null);
            }}
            onCancel={() => setPendingConfirm(null)}
          />
        );
      })()}

      {usageOpen && <UsageCard onClose={() => setUsageOpen(false)} />}

      {archiveAsk && (() => {
        const group = state.groups.find(g => g.id === archiveAsk);
        if (!group) return null;
        return (
          <ArchiveDialog
            group={group}
            threads={state.tabs.filter(t => t.groupId === archiveAsk && !t.asleep)}
            onCancel={() => setArchiveAsk(null)}
            onConfirm={() => { setArchiveAsk(null); void archiveNow(group.id); }}
          />
        );
      })()}

      {toast && (
        <Toast
          key={toast.id}
          message={toast.message}
          actionLabel={toast.actionLabel}
          onAction={toast.onAction}
          onDone={() => setToast(null)}
        />
      )}

      {updateWindow === 'about' && (
        <AboutWindow
          update={update}
          onClose={() => setUpdateWindow(null)}
          onRestart={() => setUpdateWindow('restart')}
        />
      )}

      {updateWindow === 'restart' && (
        <RestartToUpdate
          rows={restartRows(awakeThreads())}
          onCancel={() => setUpdateWindow(null)}
          onConfirm={restartNow}
        />
      )}

      {whatsNew && (
        <WhatsNewDialog
          version={whatsNew.version}
          from={whatsNew.from}
          releases={notesOf(whatsNew).releases}
          more={whatsNew.more}
          onClose={() => setWhatsNew(null)}
        />
      )}

      {/* Over the app's own toast: it only shows on the launch after an update. */}
      {updatedPill && !toast && (
        <UpdatedPill
          version={updatedPill.version}
          onWhatsNew={notesOf(updatedPill).any ? () => setWhatsNew(updatedPill) : undefined}
          onDone={() => setUpdatedPill(null)}
        />
      )}

      <Tooltip />
    </div>
  );
}

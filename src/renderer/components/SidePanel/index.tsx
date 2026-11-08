import React, { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo, forwardRef, useImperativeHandle } from 'react';
import { Tab, Group, GroupColor } from '../TabBar/types';
import { Menu, MenuItem } from '../Menu';
import { buildThreadMenu, ThreadMenuActions } from '../../threadMenu';
import { buildProjectMenu, ProjectActions } from '../../projectMenu';
import type { EditorInfo } from '../../../editors';
import {
  FolderIcon, KindIcon, StateIcon,
  IconSearch, IconPlus, IconPage, IconPin, IconPinOn, IconChevD,
  IconCollapseAll, IconExpandAll, IconBell, IconPlay, IconCompact, IconHourglass, IconX, Spinner,
  IconArrowRight, IconFolderNone,
} from '../Icons';
import {
  threadKind, threadState, stateBreathes, threadName, foldThreads,
  projectCounts,
} from '../../threadView';
import type { ProjectPillCounts } from '../../threadView';
// Phase 8: the panel's groups (General, Pinned, Recent, Other), the in-place
// search filter and the keyboard cycle's row order all come from panelView.ts,
// pure and unit-tested; this component only renders what it returns. Since
// 2026-11-01 the project order is the saved order (the `groups` array), and
// nothing in the panel moves because it was used.
import { panelSections, filterPanel, visibleThreadIds, cycleThreadId, revealScrollTop } from '../../panelView';
import type { PanelEntry, PanelSections, ProjectSection } from '../../panelView';
import { isWaitingState } from '../../attention';
import { relativeTime } from '../../homeView';
import { ThreadHoverCard } from '../ThreadHoverCard';
import { usePanelDrag, GENERAL } from './usePanelDrag';
import { foldLimit, partnerOf, splitOf } from '../../splitView';
import type { Split, PaneTarget } from '../../splitView';
import type { ListKey } from './usePanelDrag';
import './SidePanel.css';
import './SidePanelMotion.css';

const THREAD_FOLD_LIMIT = 5;
// How long the pointer has to rest on a thread row before its card appears. Long
// enough that moving the pointer down the list never flashes a card.
const HOVER_DELAY_MS = 350;
// revealProject's timing: wait out the project's expand transition (--med,
// 200ms) before measuring, retry while the workspace is still hidden, and keep
// the landing highlight on the row for a little over a second.
const REVEAL_SETTLE_MS = 260;
const REVEAL_RETRY_MS = 50;
const REVEAL_MAX_TRIES = 20;
const REVEAL_FLASH_MS = 1200;
// The slides (docs/mockups/sidebar-drag-and-drop.html's flip(), and the archive
// mockup's fold): how long a row takes to slide into its new place, and how long
// a project takes to fold out of Recent.
const FLIP_MS = 320;
const FOLD_MS = 360;
const ENTER_MS = 420;

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

// ─── Thread row ────────────────────────────────────────────────────────────────

interface ThreadRowProps {
  tab: Tab;
  isActive: boolean;
  // The other half of the split on screen (design-06): a lighter selected look.
  isPartner?: boolean;
  inProject: boolean;
  // The row being dragged stays in its place, dimmed.
  isDragging?: boolean;
  // A thread that has just arrived (new or resumed): it opens in place, and the
  // rows below slide down.
  entering?: boolean;
  overlay?: boolean;
  onActivate: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onClose: () => void;
  // Hover card timing lives in the SidePanel, so the row only reports "the pointer
  // is resting on me, here is my rectangle" and "it left".
  onHoverStart?: (rect: DOMRect) => void;
  onHoverEnd?: () => void;
}

function ThreadRow({
  tab, isActive, isPartner, inProject, isDragging, entering, overlay,
  onActivate, onContextMenu, onClose, onHoverStart, onHoverEnd,
}: ThreadRowProps) {
  const state = threadState(tab);
  const breathe = !isActive && !isPartner && stateBreathes(state)
    ? (state === 'needs-you' || state === 'unread' ? 'breathe-need' : 'breathe-done')
    : '';

  // Going to sleep (Archive puts every awake thread to sleep one after the
  // other): the state icon turns into the moon with a small pop, and a server's
  // port fades out instead of vanishing (the archive mockup's iconswap).
  const prevAsleep = useRef(tab.asleep);
  const lastPort = useRef(tab.port);
  if (tab.port !== undefined) lastPort.current = tab.port;
  const [swap, setSwap] = useState(false);
  useLayoutEffect(() => {
    const was = prevAsleep.current;
    prevAsleep.current = tab.asleep;
    if (!tab.asleep || was || overlay) return;
    setSwap(true);
    const t = setTimeout(() => setSwap(false), ENTER_MS);
    return () => clearTimeout(t);
  }, [tab.asleep, overlay]);

  const className = [
    'th',
    inProject ? '' : 'gen',
    isActive ? 'sel' : '',
    isPartner ? 'on' : '',
    isDragging ? 'dragging' : '',
    entering ? 'enter' : '',
    overlay ? 'drag-overlay' : '',
    // Dims on tab.asleep itself, not on state === 'asleep': an asleep thread
    // marked unread reads as 'unread' (it wins precedence), but it is still
    // asleep and still dims, with the bell shown on top of the dimmed row.
    tab.asleep ? 'sleep' : '',
    breathe,
  ].filter(Boolean).join(' ');

  const fadingPort = swap && lastPort.current !== undefined;

  return (
    <div
      className={className}
      data-tid={overlay ? undefined : tab.id}
      data-flip={overlay ? undefined : `t:${tab.id}`}
      onClick={() => { onHoverEnd?.(); onActivate(); }}
      onContextMenu={e => { onHoverEnd?.(); onContextMenu(e); }}
      onMouseEnter={overlay ? undefined : e => onHoverStart?.(e.currentTarget.getBoundingClientRect())}
      onMouseLeave={overlay ? undefined : () => onHoverEnd?.()}
      data-kind={threadKind(tab)}
    >
      <KindIcon kind={threadKind(tab)} />
      <span className="n">{threadName(tab)}</span>
      {state === 'running' && <span className="prt">:{tab.port}</span>}
      {state !== 'running' && fadingPort && <span className="prt gone">:{lastPort.current}</span>}
      {swap ? <span className="st swap"><StateIcon state={state} /></span> : <StateIcon state={state} />}
      {!overlay && (
        <button
          className="xb"
          data-tip="Close"
          tabIndex={-1}
          onPointerDown={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onClose(); }}
        >
          <IconX size={14} />
        </button>
      )}
    </div>
  );
}

// ─── Project row ───────────────────────────────────────────────────────────────

interface ProjectRowProps {
  group: Group;
  threadCount: number;
  counts: ProjectPillCounts;
  pinned: boolean;
  // The short highlight after the project was opened from elsewhere.
  revealed?: boolean;
  // A thread is held over this row: it goes in at the top of this project.
  drop?: boolean;
  overlay?: boolean;
  onToggle: () => void;
  onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onNewThread: () => void;
  onOpenProjectPage: () => void;
  onTogglePin: () => void;
  isRenaming: boolean;
  renameValue: string;
  onRenameChange: (v: string) => void;
  onRenameCommit: () => void;
}

function ProjectRow({
  group, threadCount, counts, pinned, revealed, drop, overlay,
  onToggle, onDoubleClick, onContextMenu, onNewThread, onOpenProjectPage, onTogglePin,
  isRenaming, renameValue, onRenameChange, onRenameCommit,
}: ProjectRowProps) {
  const expanded = !group.collapsed;

  const className = [
    'pj',
    pinned ? '' : 'dim',
    drop ? 'drop' : '',
    revealed ? 'revealed' : '',
    overlay ? 'drag-overlay' : '',
  ].filter(Boolean).join(' ');

  const stop = (e: React.MouseEvent | React.PointerEvent) => e.stopPropagation();

  return (
    <div
      className={className}
      data-gid={overlay ? undefined : group.id}
      onClick={e => { if (e.detail === 2) return; onToggle(); }}
      onDoubleClick={e => { e.stopPropagation(); onDoubleClick(); }}
      onContextMenu={onContextMenu}
      data-collapsed={expanded ? undefined : 'true'}
      data-threads={threadCount}
    >
      <FolderIcon color={group.color} open={expanded} size={18} icon={group.icon} />
      {isRenaming ? (
        <input
          autoFocus
          className="pj-rename"
          value={renameValue}
          onFocus={e => e.currentTarget.select()}
          onChange={e => onRenameChange(e.target.value)}
          onBlur={onRenameCommit}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') onRenameCommit(); }}
          onClick={stop}
          onPointerDown={stop}
        />
      ) : (
        <span className="n">{group.label}</span>
      )}
      {!expanded && threadCount > 0 && <span className="c">{threadCount}</span>}
      {counts.needsYou > 0 && (
        <span className="sig need">
          <span className="si need"><IconBell size={14} /></span>
          {counts.needsYou}
        </span>
      )}
      {counts.working > 0 && (
        <span className="sig work">
          <span className="si"><Spinner size={11} /></span>
          {counts.working}
        </span>
      )}
      {counts.background > 0 && (
        <span className="sig bg">
          <span className="si bg"><IconHourglass size={13} /></span>
          {counts.background}
        </span>
      )}
      {counts.running > 0 && (
        <span className="sig run">
          <span className="si run"><IconPlay size={13} /></span>
          {counts.running}
        </span>
      )}
      {/* Compacting is its own state with its own count, never folded into the
          play pill (Aryan, 2026-09-19). */}
      {counts.compacting > 0 && (
        <span className="sig compact">
          <span className="si compact"><IconCompact size={13} /></span>
          {counts.compacting}
        </span>
      )}
      {!overlay && (
        <>
          <button
            className="ib"
            data-tip={`New thread in ${group.label}`}
            onPointerDown={stop}
            onClick={e => { e.stopPropagation(); onNewThread(); }}
            tabIndex={-1}
          >
            <IconPlus size={14} />
          </button>
          <button
            className="ib"
            data-tip="Open project page"
            onPointerDown={stop}
            onClick={e => { e.stopPropagation(); onOpenProjectPage(); }}
            tabIndex={-1}
          >
            <IconPage size={14} />
          </button>
          {/* Only the unpinned rows carry a pin button: a pinned project sits in the
              Pinned section, where unpinning is a right-click away. */}
          {!pinned && (
            <button
              className="ib"
              data-tip="Pin"
              onPointerDown={stop}
              onClick={e => { e.stopPropagation(); onTogglePin(); }}
              tabIndex={-1}
            >
              <IconPin size={14} />
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ─── Main SidePanel ────────────────────────────────────────────────────────────

// What app.tsx reads off the panel for the keyboard cycle (Ctrl+Shift+Down and
// Up): the fold state and the search text live here, so only the panel knows
// which rows it is actually showing.
export interface SidePanelHandle {
  // The next (dir 1) or previous (dir -1) thread row the panel shows, in panel
  // order, across projects, wrapping at the ends; null when nothing is shown.
  cycleThread(activeTabId: string, dir: 1 | -1): string | null;
  // Every thread row the panel is showing, in panel order (the list the cycle
  // walks); the harness reads it as window.__afterterm.panelOrder().
  visibleIds(): string[];
  // Puts the caret in the search box.
  focusSearch(): void;
  // Scrolls a project that was just opened (from Home, the rail, the palette or
  // the Other projects drawer) into view with its active thread, and highlights
  // its row for a moment. A search that is narrowing the list is cleared first.
  revealProject(groupId: string): void;
  // Archive's fold: the project's block closes and the rows below slide up.
  // Resolves when the fold is done (at once when the row is not on screen).
  foldOut(groupId: string): Promise<void>;
}

export interface SidePanelProps {
  tabs: Tab[];
  groups: Group[];
  activeTabId: string;
  // Phase 8: the panel is hidden by sliding its width to zero (design-03
  // decision 1); it stays mounted so the slide can animate. `hidden` covers both
  // the persisted Ctrl+Shift+B state and the transient slide-shut on the way to
  // Home (app.tsx).
  hidden: boolean;
  // The clock the Recent rule (3 days) and the docked Other rows' "2d" read.
  now: number;
  shells: { id: string; name: string }[];
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onSleep: (tabId: string) => void;
  onWake: (tabId: string) => void;
  // Mark as unread / Mark as read (threadMenu's setUnread), chats only.
  onSetUnread: (tabId: string, unread: boolean) => void;
  // Rename in the thread menu: opens the Rename dialog for this thread.
  onRenameThread: (tabId: string) => void;
  // Opens the running server's port in the browser (threadMenu's "Open
  // localhost:port"); only ever offered on an awake thread with a captured port.
  onOpenLocalhost: (tabId: string) => void;
  // threadMenu's "Open in File Explorer" for the thread's own folder (Phase 9):
  // the caller decides whether the thread has a folder and whether it exists.
  threadExplorer: (tab: Tab) => { missing: boolean; open: () => void } | undefined;
  // threadMenu's "Open in <editor>" entries for the same folder; undefined when
  // the thread has no folder or no editor was detected.
  threadEditor: (tab: Tab) => ThreadMenuActions['openInEditor'];
  onNewTab: (groupId?: string, shellId?: string) => void;
  // The chooser is anchored under whichever New thread control was used, so the
  // caller is handed that control's bottom-left corner.
  onOpenChooser: (anchor: { x: number; y: number }) => void;
  onOpenProjectPage: (groupId: string) => void;
  onTogglePin: (groupId: string) => void;
  // The New/Edit project dialog lives in app.tsx now, so Home, the project page and
  // the sidebar all open the same one. Editing an existing project is reached
  // through the shared project menu (projectActions.edit), so only the "new"
  // entry point is a prop here.
  onNewProject: () => void;
  // Everything the shared project right-click menu needs (projectMenu.tsx).
  editors: EditorInfo[];
  folderExists: Record<string, boolean>; // keyed by folder path
  projectActions: ProjectActions;
  onAddToGroup: (tabId: string, groupId: string) => void;
  onRemoveFromGroup: (tabId: string) => void;
  onRenameGroup: (groupId: string, label: string) => void;
  onSetGroupColor: (groupId: string, color: GroupColor) => void;
  onToggleGroupCollapse: (groupId: string) => void;
  // The collapse button on the Pinned and Recent headings: every project in that
  // group at once (design-03 decision 9).
  onSetGroupsCollapsed: (groupIds: string[], collapsed: boolean) => void;
  // A click on a project in the docked Other list: stamps its activity, expands
  // it and selects its first thread, waking nothing (design-03 decision 2).
  onBringIn: (groupId: string) => void;
  // The project being archived: kept in Recent while its threads go to sleep,
  // until its row has folded away (app.tsx, archiveNow).
  holdInRecent?: string | null;
  // A drop (docs/mockups/sidebar-drag-and-drop.html): a thread into a project
  // (undefined is General) above `beforeId` or at the end; a project into Pinned
  // or Recent above `beforeId` or at the end of that section.
  onPlaceThread: (tabId: string, groupId: string | undefined, beforeId: string | null) => void;
  onPlaceProject: (groupId: string, section: ProjectSection, beforeId: string | null) => void;
  // Two threads side by side (design-06): the splits, so a split's two rows are
  // drawn joined by a line and the fold never cuts them apart; Ungroup in a
  // split row's menu; and the main pane as a drop target for a dragged thread.
  splits: Split[];
  onUngroup: (tabId: string) => void;
  paneAt: (tabId: string, x: number, y: number) => PaneTarget | null;
  onPaneHover: (target: PaneTarget | null) => void;
  onPaneDrop: (tabId: string, target: PaneTarget) => void;
}

export const SidePanel = forwardRef<SidePanelHandle, SidePanelProps>(function SidePanel(props, ref) {
  const {
    tabs, groups, activeTabId, hidden, now, shells,
    onActivate, onClose, onSleep, onWake, onSetUnread, onRenameThread, onOpenLocalhost, threadExplorer, threadEditor, onNewTab,
    onOpenChooser, onOpenProjectPage, onTogglePin,
    onNewProject, editors, folderExists, projectActions,
    onAddToGroup, onRemoveFromGroup,
    onRenameGroup, onToggleGroupCollapse, onSetGroupsCollapsed, onBringIn,
    holdInRecent, onPlaceThread, onPlaceProject,
    splits, onUngroup, paneAt, onPaneHover, onPaneDrop,
  } = props;

  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  // Which thread lists are past their five-row fold. Transient, keyed by project id
  // ('general' for the projectless list): a fold is a glance, not a preference, so
  // it is not persisted.
  const [expandedLists, setExpandedLists] = useState<Record<string, boolean>>({});
  // The search box text (design-03 decision 13) and whether the docked Other
  // projects list is open. Both transient: a filter and a peek at the overflow are
  // things you do, not settings.
  const [query, setQuery] = useState('');
  const [dockOpen, setDockOpen] = useState(false);
  const dockRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // A project to bring into view (revealProject), and the row being highlighted
  // after it arrives. `seq` makes a second open of the same project count again.
  const [reveal, setReveal] = useState<{ groupId: string; seq: number } | null>(null);
  const [flash, setFlash] = useState<{ groupId: string; seq: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  // Which thread row the pointer is resting on, the rectangle the card points at,
  // and the clock reading it was opened with (the card shows relative times and
  // must not restart a timer of its own).
  const [hover, setHover] = useState<{ tabId: string; anchor: DOMRect; now: number } | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Projects folding out of Recent (Archive), and what has just arrived: projects
  // entering Recent, new threads, projects joining Other projects. `bump` restarts
  // the Other projects count's little pop.
  const [folding, setFolding] = useState<ReadonlySet<string>>(new Set());
  const [arrived, setArrived] = useState<{ projects: Set<string>; threads: Set<string>; other: Set<string> }>(
    { projects: new Set(), threads: new Set(), other: new Set() });
  const [bump, setBump] = useState(0);

  const hideHover = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
    setHover(null);
  }, []);

  const draggingRef = useRef(false);
  const startHover = useCallback((tabId: string, rect: DOMRect) => {
    if (draggingRef.current) return;
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      hoverTimerRef.current = null;
      setHover({ tabId, anchor: rect, now: Date.now() });
    }, HOVER_DELAY_MS);
  }, []);

  // A hidden sidebar has no rows to point at, and an unmount must not leave a
  // timer running that would open a card over whatever comes next.
  useEffect(() => {
    if (hidden) hideHover();
  }, [hidden, hideHover]);
  useEffect(() => () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
  }, []);

  // Keep the open thread visible: activating a thread whose project is collapsed
  // (Ctrl+Tab, a toast click, the header menu) expands that project, the way the
  // mock's selectThread does. Only activation triggers it, so the user can still
  // collapse the project that holds the active thread.
  useEffect(() => {
    const tab = tabs.find(t => t.id === activeTabId);
    const group = tab?.groupId ? groups.find(g => g.id === tab.groupId) : undefined;
    if (group?.collapsed) onToggleGroupCollapse(group.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId]);

  // Bring a just-opened project into view. The wait lets the project's expand
  // transition (--med) finish so its rows have their real height, and it retries
  // while the workspace is still hidden (opened from Home, it is display: none
  // until the screen switches). Then the smallest scroll that shows the project
  // row down to its active thread, and a short highlight on the row.
  useEffect(() => {
    if (!reveal) return;
    let cancelled = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const attempt = () => {
      if (cancelled) return;
      const scroller = scrollRef.current;
      const wrap = scroller?.querySelector<HTMLElement>(`[data-pjw="${CSS.escape(reveal.groupId)}"]`);
      const row = wrap?.querySelector<HTMLElement>('.pj');
      if (!scroller || !wrap || !row || scroller.clientHeight === 0) {
        if (++tries < REVEAL_MAX_TRIES) timer = setTimeout(attempt, REVEAL_RETRY_MS);
        return;
      }
      const base = scroller.getBoundingClientRect().top - scroller.scrollTop;
      const active = wrap.querySelector<HTMLElement>('.th.sel');
      const top = row.getBoundingClientRect().top - base;
      const bottom = (active ?? row).getBoundingClientRect().bottom - base;
      const next = revealScrollTop(scroller.scrollTop, scroller.clientHeight, top, bottom);
      if (next !== null) {
        scroller.scrollTo({ top: next, behavior: reducedMotion() ? 'auto' : 'smooth' });
      }
      setFlash(reveal);
    };
    timer = setTimeout(attempt, REVEAL_SETTLE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [reveal]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), REVEAL_FLASH_MS);
    return () => clearTimeout(t);
  }, [flash]);

  const startRename = (groupId: string) => {
    const g = groups.find(g => g.id === groupId);
    if (!g) return;
    setRenamingGroupId(groupId);
    setRenameValue(g.label);
  };

  const commitRename = () => {
    if (renamingGroupId && renameValue.trim()) {
      onRenameGroup(renamingGroupId, renameValue.trim());
    }
    setRenamingGroupId(null);
  };

  // ─── Menus ─────────────────────────────────────────────────────────────────

  // The chooser opens just under the New thread row.
  const openChooserUnder = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    onOpenChooser({ x: rect.left, y: rect.bottom + 6 });
  };

  const shellItems = (groupId?: string): MenuItem[] =>
    shells.map(s => ({ label: s.name, onSelect: () => onNewTab(groupId, s.id) }));

  const openNewThreadShellMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (shells.length === 0) return;
    setMenu({ x: e.clientX, y: e.clientY, items: shellItems(undefined) });
  };

  const openThreadMenu = (e: React.MouseEvent, tab: Tab) => {
    e.preventDefault();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: buildThreadMenu(tab, groups, {
        moveToGroup: id => (id ? onAddToGroup(tab.id, id) : onRemoveFromGroup(tab.id)),
        close: () => onClose(tab.id),
        rename: () => onRenameThread(tab.id),
        sleep: () => onSleep(tab.id),
        wake: () => onWake(tab.id),
        setUnread: unread => onSetUnread(tab.id, unread),
        openProjectPage: tab.groupId ? () => onOpenProjectPage(tab.groupId!) : undefined,
        openLocalhost: () => onOpenLocalhost(tab.id),
        openInExplorer: threadExplorer(tab),
        openInEditor: threadEditor(tab),
        ungroup: splitOf(splits, tab.id) ? () => onUngroup(tab.id) : undefined,
      }),
    });
  };

  const openProjectMenu = (e: React.MouseEvent, group: Group) => {
    e.preventDefault();
    const folderMissing = !!group.cwd && folderExists[group.cwd] === false;
    const items = buildProjectMenu(group, { editors, folderMissing }, projectActions);
    // The shell submenu is a sidebar convenience, not part of the shared project
    // menu, so it is spliced in here, right after "New thread here".
    const afterNewThread = items.findIndex(i => i.label === 'New thread here') + 1;
    if (afterNewThread > 0 && shells.length > 0) {
      items.splice(afterNewThread, 0, {
        label: 'New thread with shell',
        submenu: { title: 'Shell', items: shellItems(group.id) },
      });
    }
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  // ─── Derived rows ──────────────────────────────────────────────────────────

  // Recomputed only when the data or the clock changes, not on every hover: the
  // Recent split reads lastActiveAt against `now`, which app.tsx moves once a minute.
  const sections: PanelSections = useMemo(
    () => panelSections(tabs, groups, now, holdInRecent ? new Set([holdInRecent]) : undefined),
    [tabs, groups, now, holdInRecent],
  );
  const view = useMemo(() => filterPanel(sections, query, threadName), [sections, query]);
  const filtered = view.filtered;
  const groupMap = new Map(groups.map(g => [g.id, g]));
  const hoverTab = hover ? tabs.find(t => t.id === hover.tabId) : undefined;
  // A hidden row that is waiting for you keeps the fold open (Aryan, 2026-09-19):
  // the same definition attention.ts counts with.
  const isWaiting = (t: Tab) => isWaitingState(threadState(t));

  // ─── Slides ────────────────────────────────────────────────────────────────

  // On a drop, everything that moved slides into place from where it was, and
  // the dropped row slides from where the card was (the mockup's flip()). The
  // rectangles are taken just before the drop changes state; the next commit
  // puts each row back where it was with a transform and lets it go.
  const flipFirst = useRef<Map<string, DOMRect> | null>(null);
  const captureFlip = useCallback((key?: string, rect?: DOMRect) => {
    const scroller = scrollRef.current;
    if (!scroller || reducedMotion()) return;
    const first = new Map<string, DOMRect>();
    scroller.querySelectorAll<HTMLElement>('[data-flip]').forEach(el => first.set(el.dataset.flip!, el.getBoundingClientRect()));
    if (key && rect) first.set(key, rect);
    flipFirst.current = first;
  }, []);
  useLayoutEffect(() => {
    const first = flipFirst.current;
    const scroller = scrollRef.current;
    if (!first || !scroller) return;
    flipFirst.current = null;
    const moves = new Map<HTMLElement, { dx: number; dy: number }>();
    scroller.querySelectorAll<HTMLElement>('[data-flip]').forEach(el => {
      const f = first.get(el.dataset.flip!);
      if (!f) return;
      const l = el.getBoundingClientRect();
      moves.set(el, { dx: f.left - l.left, dy: f.top - l.top });
    });
    const moving: HTMLElement[] = [];
    moves.forEach((d, el) => {
      // A thread inside a project block that also slides moves only by the difference.
      const parent = el.classList.contains('th') ? el.closest<HTMLElement>('.pjw') : null;
      const pd = parent ? moves.get(parent) : undefined;
      const dx = d.dx - (pd?.dx ?? 0);
      const dy = d.dy - (pd?.dy ?? 0);
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      moving.push(el);
    });
    if (moving.length === 0) return;
    void scroller.offsetWidth;
    for (const el of moving) {
      el.style.transition = `transform ${FLIP_MS}ms cubic-bezier(.2,.8,.2,1)`;
      el.style.transform = '';
      setTimeout(() => { el.style.transition = ''; }, FLIP_MS + 20);
    }
  });

  // What has just arrived, compared with the last render: a project entering
  // Recent opens in place at the top and the rows below slide down (with the
  // short highlight when it came back from Other projects); a new or resumed
  // thread opens in its place; a project joining Other projects pops into the
  // drawer and bumps the count. Nothing is animated while a search is narrowing
  // the list, nor on the render that restores a session.
  const prevSeen = useRef<{ placed: Set<string>; other: Set<string>; tabs: Set<string>; filtered: boolean } | null>(null);
  useLayoutEffect(() => {
    const placed = new Set([...view.pinned, ...view.recent].map(e => e.group.id));
    const other = new Set(sections.other.map(e => e.group.id));
    const tabIds = new Set(tabs.map(t => t.id));
    const prev = prevSeen.current;
    prevSeen.current = { placed, other, tabs: tabIds, filtered };
    if (!prev || prev.filtered || filtered || reducedMotion()) return;
    const hadProjects = prev.placed.size + prev.other.size > 0;
    const projects = hadProjects ? view.recent.map(e => e.group.id).filter(id => !prev.placed.has(id)) : [];
    const threads = prev.tabs.size > 0 ? tabs.map(t => t.id).filter(id => !prev.tabs.has(id)) : [];
    const joined = [...other].filter(id => !prev.other.has(id) && prev.placed.has(id));
    if (projects.length === 0 && threads.length === 0 && joined.length === 0) return;
    setArrived({ projects: new Set(projects), threads: new Set(threads), other: new Set(joined) });
    if (other.size > prev.other.size) setBump(b => b + 1);
    const back = projects.find(id => prev.other.has(id));
    if (back) setFlash(f => ({ groupId: back, seq: (f?.seq ?? 0) + 1 }));
  }, [view, sections, tabs, filtered]);
  useEffect(() => {
    if (arrived.projects.size + arrived.threads.size + arrived.other.size === 0) return;
    const t = setTimeout(() => setArrived({ projects: new Set(), threads: new Set(), other: new Set() }), ENTER_MS);
    return () => clearTimeout(t);
  }, [arrived]);

  // The open Other projects drawer closes on a press anywhere outside it and on
  // Escape (AFT-37). The listener is on the document in the capture phase: the
  // terminal is an xterm canvas that takes focus on mousedown and can stop the
  // event before it bubbles, so a bubbling listener would never see a click there.
  // A press on the drawer itself (its rows, its toggle) is left to their own click
  // handlers, so the toggle still opens and closes it as before.
  useEffect(() => {
    if (!dockOpen) return;
    const onPress = (e: PointerEvent) => {
      if (e.target instanceof Node && dockRef.current?.contains(e.target)) return;
      setDockOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDockOpen(false);
    };
    document.addEventListener('pointerdown', onPress, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPress, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [dockOpen]);

  // A project that has folded away and left Recent is no longer folding.
  useEffect(() => {
    if (folding.size === 0) return;
    const shown = new Set([...view.pinned, ...view.recent].map(e => e.group.id));
    const still = [...folding].filter(id => shown.has(id));
    if (still.length !== folding.size) setFolding(new Set(still));
  }, [view, folding]);

  // ─── Dragging ──────────────────────────────────────────────────────────────

  const threadsOf = useCallback((list: ListKey): string[] => {
    if (list === GENERAL) return sections.general.map(t => t.id);
    return tabs.filter(t => t.groupId === list).map(t => t.id);
  }, [sections, tabs]);
  const listOf = useCallback((tabId: string): ListKey => {
    const tab = tabs.find(t => t.id === tabId);
    return tab?.groupId && groupMap.has(tab.groupId) ? tab.groupId : GENERAL;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, groups]);

  const { drag, onPointerDown, onScroll: onDragScroll, onCardMount, shouldSuppressClick } = usePanelDrag({
    scrollRef, lineRef, ghostRef,
    threadsOf, listOf,
    onStart: hideHover,
    beforeDrop: (id, kind, cardRect) => captureFlip(kind === 'thread' ? `t:${id}` : `p:${id}`, cardRect),
    dropThread: (tabId, list, beforeId) => onPlaceThread(tabId, list === GENERAL ? undefined : list, beforeId),
    dropProject: (groupId, section, beforeId) => onPlaceProject(groupId, section, beforeId),
    paneAt,
    paneHover: onPaneHover,
    dropOnPane: onPaneDrop,
  });
  draggingRef.current = !!drag;

  // The keyboard cycle reads the rows exactly as they are shown: after the filter,
  // minus collapsed projects, minus fold-hidden rows.
  useImperativeHandle(ref, (): SidePanelHandle => ({
    cycleThread: (currentId, dir) => {
      const ids = visibleThreadIds(view, { activeTabId: currentId, expandedLists, limit: THREAD_FOLD_LIMIT, isWaiting, splits });
      return cycleThreadId(ids, currentId, dir);
    },
    visibleIds: () => visibleThreadIds(view, { activeTabId, expandedLists, limit: THREAD_FOLD_LIMIT, isWaiting, splits }),
    focusSearch: () => searchRef.current?.focus(),
    revealProject: (groupId) => {
      if (query) setQuery('');
      setDockOpen(false);
      setReveal(r => ({ groupId, seq: (r?.seq ?? 0) + 1 }));
    },
    foldOut: (groupId) => new Promise<void>(resolve => {
      const row = scrollRef.current?.querySelector(`[data-pjw="${CSS.escape(groupId)}"]`);
      if (!row || hidden || reducedMotion()) { resolve(); return; }
      setFolding(f => new Set([...f, groupId]));
      setTimeout(resolve, FOLD_MS);
    }),
  }), [view, expandedLists, activeTabId, query, hidden, splits]);

  const clearQuery = () => {
    setQuery('');
    searchRef.current?.focus();
  };

  // The other half of the split on screen, if any: its row gets the lighter
  // selected look (design-06).
  const partnerId = partnerOf(splits, activeTabId);

  const renderThreadList = (threads: Tab[], key: string, inProject: boolean) => {
    // The fold never cuts a split's two rows apart (splitView.ts, foldLimit).
    const limit = foldLimit(threads, THREAD_FOLD_LIMIT, splits);
    const { shown, hiddenCount, showMore } = foldThreads(threads, activeTabId, !!expandedLists[key], limit, isWaiting);
    const row = (tab: Tab) => (
      <ThreadRow
        key={tab.id}
        tab={tab}
        isActive={tab.id === activeTabId}
        isPartner={tab.id === partnerId}
        inProject={inProject}
        isDragging={drag?.kind === 'thread' && drag.id === tab.id}
        entering={arrived.threads.has(tab.id)}
        onActivate={() => onActivate(tab.id)}
        onContextMenu={e => openThreadMenu(e, tab)}
        onClose={() => onClose(tab.id)}
        onHoverStart={rect => startHover(tab.id, rect)}
        onHoverEnd={hideHover}
      />
    );
    // A split's two rows (always next to each other) are wrapped together and
    // joined by a thin line on their left: no name, no number (design-06).
    const items: React.ReactNode[] = [];
    for (let i = 0; i < shown.length; i++) {
      const tab = shown[i];
      const next = shown[i + 1];
      const s = splitOf(splits, tab.id);
      if (s && s.a === tab.id && next?.id === s.b) {
        items.push(
          <div key={`split:${s.id}`} className={`sgw${inProject ? '' : ' gen'}`} data-split={s.id}>
            {row(tab)}
            {row(next)}
          </div>,
        );
        i++;
      } else {
        items.push(row(tab));
      }
    }
    return (
      <>
        {items}
        {showMore && (
          <button
            className="thmore"
            onClick={() => setExpandedLists(p => ({ ...p, [key]: !p[key] }))}
          >
            {hiddenCount > 0 ? `Show ${hiddenCount} more` : 'Show less'}
          </button>
        )}
      </>
    );
  };

  const renderProject = (entry: PanelEntry, isPinned: boolean) => {
    const { group, tabs: groupTabs } = entry;
    const expanded = !group.collapsed;
    const counts = projectCounts(groupTabs.map(threadState));
    const className = [
      'pjw',
      folding.has(group.id) ? 'shut' : '',
      arrived.projects.has(group.id) ? 'enter' : '',
      drag?.kind === 'project' && drag.id === group.id ? 'dragging' : '',
    ].filter(Boolean).join(' ');
    return (
      <div className={className} key={group.id} data-pjw={group.id} data-flip={`p:${group.id}`}>
        <div className="pjw-in">
          <ProjectRow
            group={group}
            revealed={flash?.groupId === group.id}
            drop={drag?.overProject === group.id}
            threadCount={groupTabs.length}
            counts={counts}
            pinned={isPinned}
            onToggle={() => onToggleGroupCollapse(group.id)}
            onDoubleClick={() => startRename(group.id)}
            onContextMenu={e => openProjectMenu(e, group)}
            onNewThread={() => onNewTab(group.id)}
            onOpenProjectPage={() => onOpenProjectPage(group.id)}
            onTogglePin={() => onTogglePin(group.id)}
            isRenaming={renamingGroupId === group.id}
            renameValue={renameValue}
            onRenameChange={setRenameValue}
            onRenameCommit={commitRename}
          />
          {groupTabs.length > 0 && (
            // The list stays mounted while the project is collapsed: the 1fr → 0fr grid
            // transition is what animates the collapse, and unmounting would cut it off.
            <div className={`tlw${expanded ? '' : ' closed'}`} data-project={group.id} inert={!expanded}>
              <div className="tli">
                {renderThreadList(groupTabs, group.id, true)}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  // The collapse button at the right end of the Pinned and Recent headings: one
  // click collapses every project in the group, or expands every one when none is
  // open (design-03 decision 9). Icon and tip follow which way the click goes.
  const collapseButton = (key: 'pinned' | 'recent', entries: PanelEntry[]) => {
    if (entries.length === 0) return null;
    const anyOpen = entries.some(e => !e.group.collapsed);
    return (
      <button
        className="ib"
        data-collapse-sec={key}
        data-tip={anyOpen ? 'Collapse all' : 'Expand all'}
        onClick={e => { e.stopPropagation(); onSetGroupsCollapsed(entries.map(x => x.group.id), anyOpen); }}
      >
        {anyOpen ? <IconCollapseAll size={14} /> : <IconExpandAll size={14} />}
      </button>
    );
  };

  const showPinned = view.pinned.length > 0;
  // A heading shows only over projects: an empty Recent read as broken (Aryan,
  // 2026-10-29). The New project plus sits on Recent's heading, on Pinned's when
  // Recent is not there, and becomes its own row under New thread when neither is.
  const showRecent = view.recent.length > 0;
  const plusOn: 'recent' | 'pinned' | 'row' | null = filtered ? null
    : showRecent ? 'recent' : showPinned ? 'pinned' : 'row';
  const newProjectPlus = (
    <button className="ib" data-tip="New project" data-new-project="" onClick={onNewProject}>
      <IconPlus size={14} />
    </button>
  );
  const others = view.other;
  // The drawer's count reads the unfiltered list, so it does not drop to 0 and
  // bump back while a search is typed.
  const otherCount = sections.other.length;

  // ─── The dragged card ──────────────────────────────────────────────────────

  // One side of a thread card's from-and-to line: the project's coloured folder
  // and name, or General's dashed grey folder.
  const listTag = (key: ListKey, side: 'from' | 'to') => {
    const g = key === GENERAL ? undefined : groupMap.get(key);
    return (
      <>
        {g ? <FolderIcon color={g.color} size={13} icon={g.icon} /> : <span className="fo none"><IconFolderNone size={13} /></span>}
        <span className={`pn ${side}`}>{g ? g.label : 'General'}</span>
      </>
    );
  };
  // When the thread is brought back over its own project the line folds away
  // with its last content still in it, so that content is kept here.
  const lastFromTo = useRef<{ from: ListKey; to: ListKey } | null>(null);
  if (drag?.kind === 'thread' && drag.to !== drag.from) lastFromTo.current = { from: drag.from, to: drag.to };
  if (!drag) lastFromTo.current = null;

  const dragTab = drag?.kind === 'thread' ? tabs.find(t => t.id === drag.id) : undefined;
  const dragGroup = drag?.kind === 'project' ? groupMap.get(drag.id) : undefined;
  const card = drag && (dragTab || dragGroup) ? (
    <div
      className={`pd-ghost${drag.returning ? ' back' : ''}`}
      ref={el => { ghostRef.current = el; if (el) onCardMount(); }}
      style={{ width: drag.width }}
    >
      {dragTab && (
        <>
          <ThreadRow
            tab={dragTab}
            isActive={false}
            inProject={listOf(dragTab.id) !== GENERAL}
            onActivate={() => {}}
            onContextMenu={() => {}}
            onClose={() => {}}
            overlay
          />
          <div className={`dest${drag.to !== drag.from ? ' on' : ''}`}>
            <div>
              <div className="ft">
                {lastFromTo.current && (
                  <>
                    {listTag(lastFromTo.current.from, 'from')}
                    <IconArrowRight size={12} />
                    {listTag(lastFromTo.current.to, 'to')}
                  </>
                )}
              </div>
            </div>
          </div>
        </>
      )}
      {dragGroup && (() => {
        const n = tabs.filter(t => t.groupId === dragGroup.id).length;
        return (
          <>
            <ProjectRow
              group={dragGroup}
              threadCount={n}
              counts={projectCounts(tabs.filter(t => t.groupId === dragGroup.id).map(threadState))}
              pinned={dragGroup.pinned}
              onToggle={() => {}}
              onDoubleClick={() => {}}
              onContextMenu={() => {}}
              onNewThread={() => {}}
              onOpenProjectPage={() => {}}
              onTogglePin={() => {}}
              isRenaming={false}
              renameValue=""
              onRenameChange={() => {}}
              onRenameCommit={() => {}}
              overlay
            />
            {n > 0 && <div className="more">{n === 1 ? '1 thread' : `${n} threads`}</div>}
          </>
        );
      })()}
    </div>
  ) : null;

  return (
    <>
      <div className={`side-panel${hidden ? ' hidden' : ''}${drag && !drag.returning ? ' dragmode' : ''}`} inert={hidden}>
        <div className="side-body">
          {/* The Search box (design-03 decision 13): typing filters the panel in
              place; Ctrl+Shift+P still opens the palette, the only place closed
              threads are searched. Escape empties the box; a second Escape
              hands the keyboard back to the terminal. */}
          <div className={`srch${filtered ? ' has' : ''}`}>
            <span className="g"><IconSearch size={16} /></span>
            <input
              ref={searchRef}
              className="srch-input"
              placeholder="Search"
              value={query}
              spellCheck={false}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key !== 'Escape') return;
                e.preventDefault();
                if (query) setQuery('');
                else searchRef.current?.blur();
              }}
            />
            <span className="k">Ctrl Shift P</span>
            <button className="ib clr" data-tip="Clear" data-clear="" onClick={clearQuery} tabIndex={-1}>
              <IconX size={14} />
            </button>
          </div>

          {!filtered && (
            <button
              className="srow"
              data-new-thread=""
              onClick={e => openChooserUnder(e.currentTarget)}
              onContextMenu={openNewThreadShellMenu}
            >
              <span className="g"><IconPlus size={16} /></span>
              New thread
              <span className="k">Ctrl Shift T</span>
            </button>
          )}

          {plusOn === 'row' && (
            <button className="srow" data-new-project="" onClick={onNewProject}>
              <span className="g"><FolderIcon size={16} /></span>
              New project
            </button>
          )}

          <div
            className="scroll"
            ref={scrollRef}
            onScroll={() => { hideHover(); onDragScroll(); }}
            onPointerDown={onPointerDown}
            onClickCapture={e => { if (shouldSuppressClick()) { e.stopPropagation(); e.preventDefault(); } }}
          >
            {view.general.length > 0 && (
              <div className="sec" data-sec="general">
                <div className="lbl" data-flip="l:general">General</div>
                {renderThreadList(view.general, 'general', false)}
              </div>
            )}

            {showPinned && (
              <div className="sec pinned-sec" data-sec="pinned">
                <div className="lbl lblrow" data-flip="l:pinned">
                  <span className="hd"><span className="pin"><IconPinOn size={12} /></span>Pinned</span>
                  <span className="acts">
                    {collapseButton('pinned', view.pinned)}
                    {plusOn === 'pinned' && newProjectPlus}
                  </span>
                </div>
                {view.pinned.map(entry => renderProject(entry, true))}
              </div>
            )}

            {showPinned && showRecent && <div className="divider" data-flip="l:divider" />}

            {showRecent && (
              <div className="sec" data-sec="recent">
                <div className="lbl lblrow" data-flip="l:recent">
                  <span className="hd">Recent</span>
                  <span className="acts">
                    {collapseButton('recent', view.recent)}
                    {plusOn === 'recent' && newProjectPlus}
                  </span>
                </div>
                {view.recent.map(entry => renderProject(entry, false))}
              </div>
            )}

            {view.noMatches && <div className="nomatch">No matches</div>}

            {/* Where a dragged row lands (usePanelDrag places it). */}
            <div className="dline" ref={lineRef} />
          </div>

          {/* Other projects (design-03 decision 2): the unpinned projects outside the
              3-day window and, since 2026-11-01, the archived ones (an archived
              project goes in at the top), docked under the scroll, collapsed by
              default. Expanding lists them as dim rows with no thread lists;
              clicking one brings it in. Hidden while a search is narrowing the
              list. */}
          {otherCount > 0 && !filtered && (
            <div className={`dock${dockOpen ? ' open' : ''}`} data-dock="" ref={dockRef}>
              <div className={`dlist${dockOpen ? ' open' : ''}`} inert={!dockOpen}>
                <div>
                  {others.map(entry => (
                    <div
                      key={entry.group.id}
                      className={`pj dim${arrived.other.has(entry.group.id) ? ' new' : ''}`}
                      data-other={entry.group.id}
                      onClick={() => { setDockOpen(false); onBringIn(entry.group.id); }}
                      onContextMenu={e => openProjectMenu(e, entry.group)}
                    >
                      <FolderIcon color={entry.group.color} open={false} size={18} icon={entry.group.icon} />
                      <span className="n">{entry.group.label}</span>
                      <span className="c">{relativeTime(entry.group.lastActiveAt, now)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <button className="drow" data-dock-toggle="" onClick={() => setDockOpen(o => !o)}>
                <span className={`chev${dockOpen ? ' up' : ''}`}><IconChevD size={14} /></span>
                Other projects
                <span className={`c${bump ? ' bump' : ''}`} key={`c${bump}`} data-other-count="">{otherCount}</span>
              </button>
            </div>
          )}
        </div>

        {/* The dragged card floats over everything (position: fixed), inside the
            panel so it keeps the panel's row styles. */}
        {card}
      </div>

      {menu && (
        <Menu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}

      {/* Mounted at the panel root, outside the scrolling list, so the card is not
          clipped by it. */}
      {hoverTab && !hidden && !drag && (
        <ThreadHoverCard
          tab={hoverTab}
          group={hoverTab.groupId ? groupMap.get(hoverTab.groupId) : undefined}
          anchor={hover!.anchor}
          now={hover!.now}
        />
      )}

    </>
  );
});

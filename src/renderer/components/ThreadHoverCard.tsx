// The hover card shown when a sidebar thread row is hovered: a quick preview of
// the thread's identity without opening it. Mounted by the sidebar (this module
// only builds the card itself); positioning follows the mock's showHover
// (docs/mockups/afterterm-next.html, .hover / showHover) with the extra Project
// row PHASES.md Phase 3 asks for.
import React from 'react';
import { Tab, Group } from './TabBar/types';
import { FolderIcon, StateIcon } from './Icons';
import { threadName, threadState, statusText, modelLabel, kindWord } from '../threadView';
import { relativeTime } from '../homeView';
import './ThreadHoverCard.css';

export interface ThreadHoverCardProps {
  tab: Tab;
  group: Group | undefined;
  anchor: DOMRect;
  now: number;
}

export function ThreadHoverCard({ tab, group, anchor, now }: ThreadHoverCardProps): React.JSX.Element {
  // Type and Status are two rows (Aryan, 2026-09-25): Type is the kind alone,
  // Status the same icon the sidebar row shows beside its word. There is no
  // sleep age here: next to Last used it read as a second, contradicting age
  // ("Asleep · 1d" above "2d ago"). A quiet thread has no Status row, as it has
  // no header chip.
  const state = threadState(tab);
  const status = statusText(tab);
  const model = modelLabel(tab.model);
  const lastUsed = relativeTime(tab.lastActiveAt, now);
  const lastUsedText = lastUsed === 'now' ? 'now' : `${lastUsed} ago`;

  const style: React.CSSProperties = {
    left: anchor.right + 8,
    top: Math.min(anchor.top - 8, window.innerHeight - 250),
  };

  return (
    <div className="hover-card" data-tab-id={tab.id} style={style}>
      <div className="hn">{threadName(tab)}</div>
      <dl>
        <dt>Type</dt>
        <dd data-row="type">{kindWord(tab)}</dd>

        {status && (
          <>
            <dt>Status</dt>
            <dd data-row="status" data-state={state} className="hc-status">
              <StateIcon state={state} size={14} />
              <span className="hc-status-text">{status}</span>
            </dd>
          </>
        )}

        <dt>Project</dt>
        <dd data-row="project" className="hc-project">
          {group ? (
            <>
              <FolderIcon color={group.color} open size={14} icon={group.icon} />
              <span className="hc-project-name">{group.label}</span>
            </>
          ) : (
            'General'
          )}
        </dd>

        {model && (
          <>
            <dt>Model</dt>
            <dd data-row="model">{model}</dd>
          </>
        )}

        {tab.branch && (
          <>
            <dt>Branch</dt>
            <dd data-row="branch">{tab.branch}</dd>
          </>
        )}

        {tab.worktree && (
          <>
            <dt>Worktree</dt>
            <dd data-row="worktree">{tab.worktree}</dd>
          </>
        )}

        {tab.lastCommand && (
          <>
            <dt>Last ran</dt>
            <dd data-row="last-ran">{tab.lastCommand}</dd>
          </>
        )}

        <dt>Last used</dt>
        <dd data-row="last-used">{lastUsedText}</dd>
      </dl>
    </div>
  );
}

// The hover card shown when a sidebar thread row is hovered: a quick preview of
// the thread's identity without opening it. Mounted by the sidebar (this module
// only builds the card itself); positioning follows the mock's showHover
// (docs/mockups/afterterm-next.html, .hover / showHover) with the extra Project
// row PHASES.md Phase 3 asks for.
import React from 'react';
import { Tab, Group } from './TabBar/types';
import { FolderIcon } from './Icons';
import { threadKind, threadName, threadState, stateLabel, modelLabel } from '../threadView';
import { relativeTime } from '../homeView';
import './ThreadHoverCard.css';

export interface ThreadHoverCardProps {
  tab: Tab;
  group: Group | undefined;
  anchor: DOMRect;
  now: number;
}

export function ThreadHoverCard({ tab, group, anchor, now }: ThreadHoverCardProps): React.JSX.Element {
  const kind = threadKind(tab);
  const state = threadState(tab);
  const kindWord = kind === 'chat' ? 'Chat' : 'Shell';
  // A restored chat that has not been resumed yet says so here rather than in a
  // row tooltip, which would sit on top of this card.
  const typeBase = state === 'quiet' ? kindWord : `${kindWord} · ${stateLabel(state)}`;
  const typeText = tab.claudeRestorable ? `${typeBase} · Resumes on click` : typeBase;
  const model = modelLabel(tab.model);
  const active = relativeTime(tab.lastActiveAt, now);
  const activeText = active === 'now' ? 'now' : `${active} ago`;

  const style: React.CSSProperties = {
    left: anchor.right + 8,
    top: Math.min(anchor.top - 8, window.innerHeight - 250),
  };

  return (
    <div className="hover-card" data-tab-id={tab.id} style={style}>
      <div className="hn">{threadName(tab)}</div>
      <dl>
        <dt>Type</dt>
        <dd data-row="type">{typeText}</dd>

        <dt>Project</dt>
        <dd data-row="project" className="hc-project">
          {group ? (
            <>
              <FolderIcon color={group.color} open size={14} />
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

        <dt>Active</dt>
        <dd data-row="active">{activeText}</dd>
      </dl>
    </div>
  );
}

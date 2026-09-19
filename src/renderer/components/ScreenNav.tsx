// The 56px icon row shared by Home and the project page: the Home and
// Workspace icons, exactly like the sidebar's own brand row but standalone
// (there is no sidebar on either of these screens). On the project page the
// Home icon reads as selected, matching the mock: you are conceptually still
// "at Home", the project page is a page you visit from there.
import React from 'react';
import { IconHome, IconTerm } from './Icons';
import './ScreenNav.css';

export type Screen = 'home' | 'workspace' | 'project';

export interface ScreenNavProps {
  screen: Screen;
  onGo: (screen: 'home' | 'workspace') => void;
}

export function ScreenNav({ screen, onGo }: ScreenNavProps) {
  const homeSelected = screen === 'home' || screen === 'project';
  const workspaceSelected = screen === 'workspace';

  return (
    <div className="brand screen-nav">
      <button
        type="button"
        className="ic"
        data-go="home"
        aria-selected={homeSelected}
        data-tip="Home"
        onClick={() => onGo('home')}
      >
        <IconHome size={18} />
      </button>
      <button
        type="button"
        className="ic"
        data-go="work"
        aria-selected={workspaceSelected}
        data-tip="Workspace"
        onClick={() => onGo('workspace')}
      >
        <IconTerm size={18} />
      </button>
    </div>
  );
}

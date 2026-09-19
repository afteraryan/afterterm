// The window's title bar strip (Phase 1.1): a 32px row across the full width,
// darker than every surface below it, holding "afterterm" and the version
// badge on the left. The OS draws the caption buttons on the right through
// titleBarOverlay (see main.ts createWindow). It sits above every screen and
// nothing else ever shares its row, so nothing can collide with those
// buttons. It is the window's only drag region. See "Workspace" -> "Title
// bar" in docs/design-02-projects-and-threads.md and PHASES.md Phase 1.1.
import React from 'react';
import './TitleBar.css';

export function TitleBar() {
  return (
    <div className="titlebar">
      <span className="tname">afterterm</span>
      <span className="ver">v{window.afterterm.appVersion}</span>
    </div>
  );
}

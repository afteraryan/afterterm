// The pane app.tsx shows in place of the terminal card while the active
// thread is asleep (design-02 "Workspace": "the old output dimmed, a large
// Wake button at the top of the pane"). Fills the same area TerminalArea's
// .terminal-instances fills (index.css: same margin, #191919 background,
// 16px radius), so swapping one for the other never shifts the header or the
// sidebar.
//
// Why the tail is a prop rather than read here: the file lives at
// %APPDATA%\afterterm\threads\<id>.txt on disk, and reading it is an IPC call
// app.tsx already has to make to decide whether to show a "Woke just now"
// divider on wake. Keeping this component pure data-in also makes it easy to
// test the loading state (tail === null) without a real file.
import React, { useEffect, useRef } from 'react';
import { Tab } from '../TabBar/types';
import { kindWord } from '../../threadView';
import { asleepSinceText } from '../../sleepWake';
import './AsleepPane.css';

export interface AsleepPaneProps {
  tab: Tab;
  // null while the tail file is still being read; an empty array once read if
  // the thread never wrote one (e.g. it slept before Phase 4 shipped).
  tail: string[] | null;
  now: number;
  onWake: () => void;
}

export function AsleepPane({ tab, tail, now, onWake }: AsleepPaneProps) {
  const wakeRef = useRef<HTMLButtonElement>(null);

  // Autofocus Wake so Enter wakes the thread, the same "don't steal focus from
  // something else" guard Terminal/index.tsx uses when it focuses xterm: a
  // chooser or palette input open over this pane must keep the keystroke.
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) wakeRef.current?.focus();
  }, [tab.id]);

  return (
    <div className="asleep-pane" data-tab-id={tab.id}>
      <div className="wakebox">
        <button type="button" className="b p big" data-wake ref={wakeRef} onClick={onWake}>
          Wake
        </button>
        <span className="w">{asleepSinceText(kindWord(tab), tab.sleptAt, now, tab.lastCommand)}</span>
      </div>
      {tail !== null && tail.length > 0 && (
        <pre className="past">{tail.join('\n')}</pre>
      )}
    </div>
  );
}

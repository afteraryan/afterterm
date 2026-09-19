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
import React, { useEffect, useRef, useState } from 'react';
import { Tab } from '../TabBar/types';
import { kindWord } from '../../threadView';
import { asleepSinceText } from '../../sleepWake';
import { initialJumpState, onScrollSample, JUMP_THRESHOLD_PX } from '../../jumpScroll';
import type { JumpState } from '../../jumpScroll';
import { JumpButton } from '../JumpButton';
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const [jump, setJump] = useState<JumpState>(() => initialJumpState());

  // Autofocus Wake so Enter wakes the thread, the same "don't steal focus from
  // something else" guard Terminal/index.tsx uses when it focuses xterm: a
  // chooser or palette input open over this pane must keep the keystroke.
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) wakeRef.current?.focus();
  }, [tab.id]);

  // Open scrolled to the newest lines: the saved tail reads top to bottom like
  // a transcript, but what matters on landing here is what the thread was
  // last showing before it slept, which sits at the very end. Re-runs on tab
  // change too, so switching straight from one asleep thread to another does
  // not carry over the previous thread's scroll position.
  //
  // The pane can mount while the workspace is hidden (Home or a project page
  // showing over it, the workspace kept mounted with display: none), and a
  // hidden scroller has no scrollHeight to scroll to, so the effect alone
  // landed at 0 (found in the Phase 9 harness). The flag below keeps the
  // intent, and a ResizeObserver on the scroller finishes the job the moment
  // it gets a size, which is exactly when the workspace comes on screen.
  const needsEndRef = useRef(false);
  const scrollToEnd = () => {
    const el = scrollRef.current;
    if (!el || el.clientHeight === 0) return false;
    el.scrollTop = el.scrollHeight;
    // Reset the jump button to hidden at the position this scroll-to-end
    // actually landed on, rather than assuming it reached the true bottom (a
    // pane too short to scroll at all lands at 0 either way).
    setJump(initialJumpState(el.scrollTop));
    return true;
  };
  useEffect(() => {
    needsEndRef.current = !scrollToEnd();
  }, [tab.id, tail]);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (needsEndRef.current && scrollToEnd()) needsEndRef.current = false;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setJump((prev) => onScrollSample(prev, el.scrollTop, el.scrollHeight - el.clientHeight, JUMP_THRESHOLD_PX));
  };

  const onJump = (target: 'top' | 'bottom') => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = target === 'top' ? 0 : el.scrollHeight;
  };

  return (
    <div className="asleep-pane" data-tab-id={tab.id}>
      <div className="asleep-scroll" ref={scrollRef} onScroll={onScroll}>
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
      <JumpButton target={jump.target} onJump={onJump} />
    </div>
  );
}

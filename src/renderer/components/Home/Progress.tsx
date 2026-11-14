// Home's Progress column (design-07, mock loops-home.html, the Progress layout):
// the streak calendar, the count card, the filter and the list of every loop.
import React from 'react';
import type { Group } from '../TabBar/types';
import type { Loop } from '../../../loops';
import { orderedTopLoops } from '../../../loops';
import { LoopList } from '../Loops/LoopList';

export interface ProgressProps {
  loops: Loop[];
  groups: Group[];
  now: number;
  onOpenChat: (loop: Loop) => void;
  onToast: (message: string, actionLabel?: string, onAction?: () => void) => void;
}

export function Progress({ loops, groups, now, onOpenChat, onToast }: ProgressProps) {
  const rows = orderedTopLoops(loops);
  return (
    <div className="prog-col" data-progress="">
      <div className="prog-list">
        <LoopList loops={loops} rows={rows} groups={groups} now={now} variant="list" onOpenChat={onOpenChat} onToast={onToast} />
      </div>
    </div>
  );
}

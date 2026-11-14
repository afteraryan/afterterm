// Loops in the renderer (design-07): pure helpers shared by Home's Progress column
// and the workspace card. No DOM, no React.

import type { Group, Tab } from './components/TabBar/types';
import type { LoopsContext } from '../loops-cli';

// What main needs to know for `afterterm loops`: each project's name and folder,
// each thread's project, Claude session and folder. Sent whenever it changes.
export function loopsContextFrom(tabs: readonly Tab[], groups: readonly Group[]): LoopsContext {
  return {
    projects: groups.map((g) => ({ id: g.id, name: g.label, folder: g.cwd || undefined })),
    threads: tabs.map((t) => ({
      id: t.id,
      project: t.groupId ?? null,
      sessionId: t.claudeSessionId || undefined,
      cwd: t.claudeCwd || t.cwd || undefined,
    })),
  };
}

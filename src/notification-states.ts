// The states a thread's notification can be in (the hook's titles: done, needs-you,
// background, compacting, working). One list for every place that names them: the
// Tab type (renderer/components/TabBar/types.ts), the restore after a reload
// (reattachedTab in renderer/sleepWake.ts) and main's memory of what each thread
// showed (AFT-33). Pure, so main and the renderer can both import it.

export const TAB_NOTIFICATIONS = ['done', 'attention', 'background', 'compacting', 'working'] as const;

export type TabNotification = (typeof TAB_NOTIFICATIONS)[number];

export function isTabNotification(v: unknown): v is TabNotification {
  return typeof v === 'string' && (TAB_NOTIFICATIONS as readonly string[]).includes(v);
}

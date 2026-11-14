// The loops list in the renderer: read once from main, then kept whole from every
// `loops:changed`. Main is the only writer (loops-store.ts).
import { useEffect, useState } from 'react';
import type { Loop } from '../../loops';

export function useLoops(): Loop[] {
  const [loops, setLoops] = useState<Loop[]>([]);
  useEffect(() => {
    const api = window.afterterm?.loops;
    if (!api) return;
    let alive = true;
    const off = api.onChange((l) => { if (alive) setLoops(l); });
    api.list().then((l) => { if (alive) setLoops(l); }).catch(() => { /* main not ready: the next change brings it */ });
    return () => { alive = false; off(); };
  }, []);
  return loops;
}

// A clock for "2m", rotting and the calendar: ticks every 30 seconds.
export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

// Which thread is running a server, and on what port.
//
// A dev server started in a tab (`npm start`, `vite`, `next dev`) is the thing you
// most often want to find again, and today a terminal gives you no sign of it: the
// row looks like every other row and the port is somewhere up in the scrollback.
// afterterm labels the thread instead, so the sidebar can say ":5173" and the menu
// can offer "Open localhost:5173".
//
// Finding the port means joining two lists Windows will give us:
//
//   1. the listening TCP sockets and the pid that owns each one (`netstat -ano`,
//      about 45 ms on this machine),
//   2. every process with its parent and its creation time (a single CIM query,
//      about 1 s), so the shell pid of a tab can be expanded into the whole tree
//      of things it started. `npm start` is several processes deep: cmd.exe spawns
//      npm's node, which spawns the server's node, and only the last one listens.
//
// Windows re-uses pids, so a naive parent walk can adopt an unrelated process that
// happens to sit under a recycled pid. The creation-time guard below is the fix, and
// it is the same one scripts/agent-harness/lib.mjs uses: a child that existed before
// its parent did is not that parent's child.
//
// Everything here is pure text and set work, no Electron and no child_process, so it
// runs under plain Node for the tests and main.ts only has to orchestrate: run the two
// commands, feed the output in, send the ports that changed.

/** One listening TCP socket: the port, the pid holding it, and the local address. */
export interface Listener {
  port: number;
  pid: number;
  address: string;
}

/**
 * The listening sockets in `netstat -ano` output.
 *
 * Only TCP rows in state LISTENING count (UDP has no state column, and an outbound
 * ESTABLISHED connection is not a server). A Node server bound to `::` shows up twice,
 * once as `0.0.0.0:48765` and once as `[::]:48765`, both with the same pid; both rows
 * are returned as they are, since the callers reduce to one port per tree anyway.
 *
 * Anything unparseable is skipped rather than thrown on: this is command output, and a
 * localised or truncated line must not cost us the whole poll.
 */
export function parseNetstatListeners(text: string): Listener[] {
  if (typeof text !== 'string' || text === '') return [];
  const out: Listener[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const parts = rawLine.trim().split(/\s+/);
    // Proto, Local Address, Foreign Address, State, PID.
    if (parts.length < 5) continue;
    if (parts[0].toUpperCase() !== 'TCP') continue;
    if (parts[3].toUpperCase() !== 'LISTENING') continue;

    const local = parseLocalAddress(parts[1]);
    if (!local) continue;

    const pid = Number(parts[4]);
    if (!Number.isInteger(pid) || pid < 0) continue;

    out.push({ port: local.port, pid, address: local.address });
  }
  return out;
}

/**
 * "0.0.0.0:5173", "127.0.0.1:5173", "[::]:5173" or "[::1]:5173" split into address and
 * port. Port 0 is rejected: it is the "any port" placeholder, never a real server.
 */
function parseLocalAddress(field: string): { address: string; port: number } | null {
  const cut = field.lastIndexOf(':');
  if (cut <= 0 || cut === field.length - 1) return null;
  const address = field.slice(0, cut);
  if (address === '') return null;
  const portText = field.slice(cut + 1);
  if (!/^\d+$/.test(portText)) return null;
  const port = Number(portText);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { address, port };
}

/**
 * One running process: its pid, its parent's pid, and when it started, in ms since
 * epoch. created is null when Windows would not tell us (a protected process), and
 * the descendant walk treats that as "no opinion" rather than as a mismatch.
 */
export interface Proc {
  pid: number;
  ppid: number;
  created: number | null;
}

/**
 * The process list as printed by:
 *
 *   Get-CimInstance Win32_Process
 *     | Select-Object ProcessId,ParentProcessId,@{n="c";e={[DateTimeOffset]::new($_.CreationDate).ToUnixTimeMilliseconds()}}
 *     | ConvertTo-Json -Compress
 *
 * ConvertTo-Json emits a bare object rather than an array when there is exactly one
 * result, so both shapes are accepted. Entries without a numeric ProcessId are dropped.
 * Never throws: unparseable output gives an empty list and the caller keeps the ports
 * it already had.
 */
export function parseProcessList(json: string): Proc[] {
  if (typeof json !== 'string' || json.trim() === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const out: Proc[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const pid = Number(r.ProcessId);
    if (!Number.isInteger(pid) || pid < 0) continue;
    const ppidRaw = Number(r.ParentProcessId);
    const ppid = Number.isInteger(ppidRaw) && ppidRaw >= 0 ? ppidRaw : 0;
    const createdRaw = Number(r.c);
    const created = r.c === null || r.c === undefined || !Number.isFinite(createdRaw)
      ? null
      : createdRaw;
    out.push({ pid, ppid, created });
  }
  return out;
}

/**
 * The root pid plus everything it started, transitively.
 *
 * The creation-time guard is what makes this safe on Windows: pids are recycled, so a
 * long-dead shell's pid can be handed to something else and a plain parent walk would
 * then claim that stranger's whole subtree. A child that was created before its parent
 * cannot really be its child, so that edge is dropped. When either creation time is
 * unknown the edge is kept, since dropping it would lose real children.
 *
 * Cycle safe (a corrupt parent chain cannot loop forever) via the visited set.
 */
export function descendantPids(procs: Proc[], rootPid: number): Set<number> {
  const result = new Set<number>();
  if (!Number.isInteger(rootPid) || rootPid < 0) return result;
  result.add(rootPid);
  if (!Array.isArray(procs) || procs.length === 0) return result;

  const byPid = new Map<number, Proc>();
  const byParent = new Map<number, Proc[]>();
  for (const p of procs) {
    if (!byPid.has(p.pid)) byPid.set(p.pid, p);
    const siblings = byParent.get(p.ppid);
    if (siblings) siblings.push(p);
    else byParent.set(p.ppid, [p]);
  }

  const stack = [rootPid];
  const seen = new Set<number>([rootPid]);
  while (stack.length > 0) {
    const pid = stack.pop() as number;
    const self = byPid.get(pid);
    for (const child of byParent.get(pid) ?? []) {
      if (child.pid === pid) continue; // a process that claims itself as parent
      if (seen.has(child.pid)) continue;
      if (self && self.created !== null && child.created !== null && child.created < self.created) continue;
      seen.add(child.pid);
      result.add(child.pid);
      stack.push(child.pid);
    }
  }
  return result;
}

/**
 * The port to show for a process tree: the lowest listening port owned by anything in
 * it, or null when nothing in it listens.
 *
 * Lowest wins because a thread gets one port in the UI and a dev server's main port is
 * almost always the lowest of the ones it opens: Vite serves on 5173 and opens a higher
 * ephemeral port for HMR, Next serves on 3000 and its watcher takes a random high one.
 * Picking the lowest gives the address a person would actually type.
 */
export function portForTree(listeners: Listener[], tree: Set<number>): number | null {
  if (!Array.isArray(listeners) || !tree || tree.size === 0) return null;
  let best: number | null = null;
  for (const l of listeners) {
    if (!tree.has(l.pid)) continue;
    if (best === null || l.port < best) best = l.port;
  }
  return best;
}

/**
 * A stable fingerprint of a set of listeners: the sorted, de-duplicated "pid:port"
 * pairs joined by commas. main.ts compares this poll's key with the last one to decide
 * whether the expensive process list needs re-reading; nothing about the sockets having
 * changed means the tree mapping cannot have changed either.
 *
 * Addresses are deliberately left out, so the two rows a dual-stack server produces
 * collapse into one and do not look like a change.
 */
export function listenerKey(listeners: Listener[]): string {
  if (!Array.isArray(listeners) || listeners.length === 0) return '';
  const pairs = new Set<string>();
  for (const l of listeners) pairs.add(`${l.pid}:${l.port}`);
  return [...pairs].sort().join(',');
}

/**
 * The port for every tab, given each tab's shell pid: expand the shell into its tree,
 * then take the lowest listening port in it. A tab with no server gets null, which the
 * caller sends so the renderer can clear a port that has gone away.
 */
export function tabPorts(
  shellPids: Map<string, number>,
  procs: Proc[],
  listeners: Listener[],
): Map<string, number | null> {
  const out = new Map<string, number | null>();
  if (!shellPids) return out;
  for (const [tabId, pid] of shellPids) {
    out.set(tabId, portForTree(listeners, descendantPids(procs, pid)));
  }
  return out;
}

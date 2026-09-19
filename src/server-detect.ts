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
// A tree can hold more than one listening port, so one of them has to be chosen. The
// rule (Aryan, 2026-09-07) is: show the port that started latest. The most recent
// listener is the one the user just started, which is the one they are looking for.
// That needs a memory of when each listener was first seen, which main.ts keeps in a
// map and hands to portForTree; trackFirstSeen below is what maintains that map.
//
// Git Bash needs one extra list. Every exec of an MSYS program forks a stub that
// exits at once, so the real process is left pointing at a Windows parent pid that
// no longer exists and the walk from the shell pid stops there. MSYS's own table
// still knows the true parent, so `ps -l` is read as well for a Git Bash tab and its
// edges are folded into the Windows list (parseMsysPs + applyMsysParents below).
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
 * The port to show for a process tree, or null when nothing in it listens.
 *
 * A thread gets one port in the UI, so when its tree listens on several the latest one
 * to start wins: the most recent listener is the one the user just started, and that is
 * the one they are looking for. `firstSeen` supplies that ordering, mapping a listener
 * key ("pid:port", the same shape listenerKey uses) to the poll time it was first seen.
 *
 * Ties fall back to the lowest port, and a tie is the common case: a dev server that
 * opens its main port and a helper port in the same second is seen for the first time
 * on one poll, so both carry the same time. The lowest of them is then almost always
 * the main one (Vite serves on 5173 and opens a higher ephemeral port for HMR, Next
 * serves on 3000 and its watcher takes a random high one), which is the address a
 * person would actually type. A helper port that opens on a later poll than the main
 * one does win, which is the cost of the rule: only a listener that genuinely started
 * later can outrank the main port.
 *
 * With no map given (or a listener missing from it) every listener ties, so the whole
 * function degrades to the lowest port.
 */
export function portForTree(
  listeners: Listener[],
  tree: Set<number>,
  firstSeen?: Map<string, number>,
): number | null {
  if (!Array.isArray(listeners) || !tree || tree.size === 0) return null;
  let bestPort: number | null = null;
  let bestTime = -Infinity;
  for (const l of listeners) {
    if (!tree.has(l.pid)) continue;
    const seen = firstSeen?.get(`${l.pid}:${l.port}`) ?? -Infinity;
    if (bestPort === null || seen > bestTime || (seen === bestTime && l.port < bestPort)) {
      bestPort = l.port;
      bestTime = seen;
    }
  }
  return bestPort;
}

/**
 * Keep a "when was this listener first seen" map in step with the current listeners:
 * add a key for anything new at `now`, drop a key for anything that has stopped
 * listening. Mutates the map it is given, so main.ts can hold one across polls.
 *
 * Dropping keys is what makes a restarted server count as new: a port that goes away
 * and comes back is first seen again at the poll it reappeared on, which is what puts
 * a just-restarted server ahead of one that has been up all along. It also stops the
 * map growing without bound as processes come and go.
 */
export function trackFirstSeen(
  firstSeen: Map<string, number>,
  listeners: Listener[],
  now: number,
): void {
  if (!firstSeen) return;
  const live = new Set<string>();
  for (const l of listeners ?? []) {
    const key = `${l.pid}:${l.port}`;
    live.add(key);
    if (!firstSeen.has(key)) firstSeen.set(key, now);
  }
  for (const key of [...firstSeen.keys()]) {
    if (!live.has(key)) firstSeen.delete(key);
  }
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
 * then pick that tree's port with portForTree. A tab with no server gets null, which
 * the caller sends so the renderer can clear a port that has gone away.
 *
 * `firstSeen` is passed straight through to portForTree, so leaving it out gives the
 * lowest port per tree.
 */
export function tabPorts(
  shellPids: Map<string, number>,
  procs: Proc[],
  listeners: Listener[],
  firstSeen?: Map<string, number>,
): Map<string, number | null> {
  const out = new Map<string, number | null>();
  if (!shellPids) return out;
  for (const [tabId, pid] of shellPids) {
    out.set(tabId, portForTree(listeners, descendantPids(procs, pid), firstSeen));
  }
  return out;
}

/**
 * One row of MSYS's own process table, as `ps -l` prints it inside Git Bash.
 *
 * pid and ppid are MSYS pids, its own numbering, which mean nothing to Windows;
 * winpid is the Windows pid of the same process, the number netstat and
 * Win32_Process speak.
 */
export interface MsysProc {
  pid: number;
  ppid: number;
  winpid: number;
}

/**
 * The rows of MSYS `ps -l` output (the ps.exe that ships under a Git install's
 * usr\bin).
 *
 * The columns are `PID PPID PGID WINPID TTY UID STIME COMMAND`, so only the first
 * four fields are read and the rest of the line (a TTY of `cons1` or `?`, and a
 * command that can contain spaces) is ignored. The header, blank lines and any row
 * whose first four fields are not non-negative integers are skipped, so a localised
 * or truncated line costs one row rather than the whole list.
 */
export function parseMsysPs(text: string): MsysProc[] {
  if (typeof text !== 'string' || text === '') return [];
  const out: MsysProc[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const parts = rawLine.trim().split(/\s+/);
    if (parts.length < 4) continue;
    const nums = parts.slice(0, 4).map(f => (/^\d+$/.test(f) ? Number(f) : NaN));
    if (nums.some(n => !Number.isInteger(n))) continue;
    out.push({ pid: nums[0], ppid: nums[1], winpid: nums[3] });
  }
  return out;
}

/**
 * The Windows process list with the parent links MSYS knows about but Windows does
 * not, so a Git Bash tree can be walked from the shell pid like any other tree.
 *
 * Every exec of an MSYS program goes through a fork stub that exits as soon as the
 * real process is up, which leaves the real process with a Windows ppid pointing at
 * a pid that no longer exists: the Windows walk stops dead at that gap, and a server
 * started from a Git Bash thread is never matched to it (nor killed with it). MSYS's
 * own table still records the true parent, so each row's real Windows parent is
 * looked up as: this row's MSYS ppid, then that MSYS row's winpid. Native children
 * below the gap (node, cmd) keep intact Windows links, so repairing the MSYS edges
 * is enough to make the whole walk complete.
 *
 * Returns a new array; the input is never mutated, and `created` is left exactly as
 * it was so the pid-reuse guard in descendantPids keeps working. A row is left alone
 * when its MSYS parent is 1 or 0 (MSYS's own root), when that MSYS parent is not in
 * the ps output, when the parent's winpid is not a process we can see, or when the
 * parent's winpid is the row's own pid.
 */
export function applyMsysParents(procs: Proc[], msys: MsysProc[]): Proc[] {
  if (!Array.isArray(procs)) return [];
  if (!Array.isArray(msys) || msys.length === 0) return procs.slice();

  const winPidByMsysPid = new Map<number, number>();
  for (const row of msys) {
    if (!winPidByMsysPid.has(row.pid)) winPidByMsysPid.set(row.pid, row.winpid);
  }
  const knownWinPids = new Set<number>();
  for (const p of procs) knownWinPids.add(p.pid);

  const parentByWinPid = new Map<number, number>();
  for (const row of msys) {
    if (row.ppid <= 1) continue;
    const parentWinPid = winPidByMsysPid.get(row.ppid);
    if (parentWinPid === undefined) continue;
    if (parentWinPid === row.winpid) continue;
    if (!knownWinPids.has(parentWinPid)) continue;
    if (!parentByWinPid.has(row.winpid)) parentByWinPid.set(row.winpid, parentWinPid);
  }
  if (parentByWinPid.size === 0) return procs.slice();

  return procs.map(p => {
    const parent = parentByWinPid.get(p.pid);
    if (parent === undefined || parent === p.ppid) return p;
    return { pid: p.pid, ppid: parent, created: p.created };
  });
}

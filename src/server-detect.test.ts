// Unit tests for server detection. Run directly on Node 24+ (strips types):
//   node src/server-detect.test.ts
// Exits 0 if all pass, 1 on any failure.
//
// All of this is pure parsing and set work, so the cases are real command output
// shapes: netstat rows as Windows prints them (including the duplicate a dual-stack
// listener produces), the CIM process list as ConvertTo-Json prints it (including the
// bare object a single result gives), and the pid-reuse trap the creation-time guard
// exists to avoid.

import {
  descendantPids,
  listenerKey,
  parseNetstatListeners,
  parseProcessList,
  portForTree,
  tabPorts,
  trackFirstSeen,
} from './server-detect.ts';
import type { Listener, Proc } from './server-detect.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}
const show = (v: unknown) => JSON.stringify(v, (_k, x) => (x instanceof Set ? [...x] : x));

console.log('\nserver-detect: parseNetstatListeners\n');
{
  const real = [
    '',
    'Active Connections',
    '',
    '  Proto  Local Address          Foreign Address        State           PID',
    '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1924',
    '  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       4242',
    '  TCP    [::]:48765             [::]:0                 LISTENING       16072',
    '  TCP    0.0.0.0:48765          0.0.0.0:0              LISTENING       16072',
    '  TCP    [::1]:3000             [::]:0                 LISTENING       777',
    '  TCP    192.168.1.5:52233      140.82.113.4:443       ESTABLISHED     9000',
    '  TCP    127.0.0.1:52001        127.0.0.1:52002        TIME_WAIT       0',
    '  UDP    0.0.0.0:5353           *:*                                    3131',
    '',
  ].join('\r\n');
  const got = parseNetstatListeners(real);

  check('only listening TCP rows are returned', got.length === 5, show(got));
  check('an IPv4 wildcard row parses', got.some(l => l.address === '0.0.0.0' && l.port === 135 && l.pid === 1924), show(got[0]));
  check('a loopback IPv4 row parses', got.some(l => l.address === '127.0.0.1' && l.port === 5173 && l.pid === 4242));
  check('an IPv6 wildcard row parses', got.some(l => l.address === '[::]' && l.port === 48765 && l.pid === 16072));
  check('an IPv6 loopback row parses', got.some(l => l.address === '[::1]' && l.port === 3000 && l.pid === 777));
  check('a dual-stack listener appears twice', got.filter(l => l.port === 48765).length === 2, show(got.filter(l => l.port === 48765)));
  check('ESTABLISHED rows are ignored', !got.some(l => l.pid === 9000));
  check('TIME_WAIT rows are ignored', !got.some(l => l.port === 52001));
  check('UDP rows are ignored', !got.some(l => l.pid === 3131));
  check('the header row is ignored', !got.some(l => Number.isNaN(l.port)));

  check('LF-only output parses the same',
    parseNetstatListeners(real.replace(/\r\n/g, '\n')).length === 5);
  check('leading whitespace is tolerated',
    parseNetstatListeners('       TCP    0.0.0.0:80   0.0.0.0:0   LISTENING   5').length === 1);
  check('a lowercase state is tolerated',
    parseNetstatListeners('  TCP  0.0.0.0:80  0.0.0.0:0  listening  5').length === 1);

  check('an empty string gives nothing', parseNetstatListeners('').length === 0);
  check('a non-string gives nothing', parseNetstatListeners(undefined as unknown as string).length === 0);
  check('pure garbage gives nothing', parseNetstatListeners('hello there\nnot a table').length === 0);
  check('a short row is ignored',
    parseNetstatListeners('  TCP  0.0.0.0:80  LISTENING  5').length === 0);
  check('a non-numeric pid is ignored',
    parseNetstatListeners('  TCP  0.0.0.0:80  0.0.0.0:0  LISTENING  abc').length === 0);
  check('port 0 is ignored',
    parseNetstatListeners('  TCP  0.0.0.0:0  0.0.0.0:0  LISTENING  5').length === 0);
  check('a port above 65535 is ignored',
    parseNetstatListeners('  TCP  0.0.0.0:70000  0.0.0.0:0  LISTENING  5').length === 0);
  check('an address with no colon is ignored',
    parseNetstatListeners('  TCP  0.0.0.0  0.0.0.0:0  LISTENING  5').length === 0);
  check('a missing port after the colon is ignored',
    parseNetstatListeners('  TCP  0.0.0.0:  0.0.0.0:0  LISTENING  5').length === 0);
  check('a non-numeric port is ignored',
    parseNetstatListeners('  TCP  0.0.0.0:http  0.0.0.0:0  LISTENING  5').length === 0);
  check('pid 0 is kept (the system idle owner still parses)',
    parseNetstatListeners('  TCP  0.0.0.0:445  0.0.0.0:0  LISTENING  0').length === 1);
}

console.log('\nserver-detect: parseProcessList\n');
{
  const arr = '[{"ProcessId":100,"ParentProcessId":4,"c":1700000000000},'
    + '{"ProcessId":200,"ParentProcessId":100,"c":1700000001000}]';
  const got = parseProcessList(arr);
  check('an array of two rows parses', got.length === 2, show(got));
  check('pid, ppid and created come through',
    got[0].pid === 100 && got[0].ppid === 4 && got[0].created === 1700000000000, show(got[0]));

  const one = parseProcessList('{"ProcessId":42,"ParentProcessId":1,"c":1700000000000}');
  check('a single bare object parses as one row', one.length === 1 && one[0].pid === 42, show(one));

  const nullC = parseProcessList('[{"ProcessId":7,"ParentProcessId":1,"c":null}]');
  check('a null creation time becomes null', nullC.length === 1 && nullC[0].created === null, show(nullC));

  const missingC = parseProcessList('[{"ProcessId":7,"ParentProcessId":1}]');
  check('a missing creation time becomes null', missingC[0].created === null, show(missingC));

  const noPid = parseProcessList('[{"ParentProcessId":1,"c":5},{"ProcessId":"x","ParentProcessId":1},{"ProcessId":9,"ParentProcessId":1}]');
  check('rows without a numeric pid are dropped', noPid.length === 1 && noPid[0].pid === 9, show(noPid));

  const noPpid = parseProcessList('[{"ProcessId":9,"c":5}]');
  check('a missing parent pid becomes 0', noPpid[0].ppid === 0, show(noPpid));

  check('unparseable JSON gives nothing', parseProcessList('not json {').length === 0);
  check('an empty string gives nothing', parseProcessList('').length === 0);
  check('whitespace gives nothing', parseProcessList('   \r\n ').length === 0);
  check('a non-string gives nothing', parseProcessList(null as unknown as string).length === 0);
  check('a JSON scalar gives nothing', parseProcessList('123').length === 0);
  check('an array of scalars gives nothing', parseProcessList('[1,2,"x",null]').length === 0);
}

console.log('\nserver-detect: descendantPids\n');
{
  // cmd (100) → npm's node (200) → the server's node (300), plus a sibling (400).
  const tree: Proc[] = [
    { pid: 4, ppid: 0, created: 1000 },
    { pid: 100, ppid: 4, created: 2000 },
    { pid: 200, ppid: 100, created: 3000 },
    { pid: 300, ppid: 200, created: 4000 },
    { pid: 400, ppid: 100, created: 3500 },
    { pid: 999, ppid: 4, created: 2500 },
  ];
  const got = descendantPids(tree, 100);
  check('the root is in its own tree', got.has(100), show(got));
  check('a direct child is in the tree', got.has(200));
  check('a grandchild is in the tree', got.has(300));
  check('a second child is in the tree', got.has(400));
  check('an unrelated sibling is not in the tree', !got.has(999));
  check('the parent is not in the tree', !got.has(4));
  check('the tree has exactly four members', got.size === 4, show(got));

  // Pid reuse: 500 is claimed by 100, but 500 started before 100 existed, so it is
  // a leftover from whatever owned pid 100 last time.
  const reuse: Proc[] = [
    { pid: 100, ppid: 4, created: 5000 },
    { pid: 500, ppid: 100, created: 1000 },
    { pid: 600, ppid: 100, created: 6000 },
  ];
  const reused = descendantPids(reuse, 100);
  check('a child older than its parent is rejected (pid reuse)', !reused.has(500), show(reused));
  check('a child younger than its parent is kept', reused.has(600));

  // A rejected child's own subtree goes with it.
  const deepReuse: Proc[] = [
    { pid: 100, ppid: 4, created: 5000 },
    { pid: 500, ppid: 100, created: 1000 },
    { pid: 510, ppid: 500, created: 1500 },
  ];
  check("a rejected child's subtree is rejected too", !descendantPids(deepReuse, 100).has(510));

  const unknownParent: Proc[] = [
    { pid: 100, ppid: 4, created: null },
    { pid: 200, ppid: 100, created: 1 },
  ];
  check('an unknown parent creation time keeps the edge', descendantPids(unknownParent, 100).has(200));

  const unknownChild: Proc[] = [
    { pid: 100, ppid: 4, created: 5000 },
    { pid: 200, ppid: 100, created: null },
  ];
  check('an unknown child creation time keeps the edge', descendantPids(unknownChild, 100).has(200));

  const cycle: Proc[] = [
    { pid: 100, ppid: 200, created: 1000 },
    { pid: 200, ppid: 100, created: 1000 },
  ];
  const cycled = descendantPids(cycle, 100);
  check('a two-process cycle terminates', cycled.size === 2, show(cycled));

  const selfParent: Proc[] = [{ pid: 100, ppid: 100, created: 1000 }];
  check('a process that parents itself terminates', descendantPids(selfParent, 100).size === 1);

  check('an empty process list still contains the root',
    descendantPids([], 100).size === 1 && descendantPids([], 100).has(100));
  check('a pid missing from the list still contains itself',
    descendantPids(tree, 7777).size === 1);
  check('a negative root pid gives an empty set', descendantPids(tree, -1).size === 0);
  check('a non-integer root pid gives an empty set',
    descendantPids(tree, 1.5 as number).size === 0);
}

console.log('\nserver-detect: portForTree\n');
{
  const listeners: Listener[] = [
    { port: 5173, pid: 300, address: '127.0.0.1' },
    { port: 63113, pid: 300, address: '[::]' },
    { port: 5173, pid: 300, address: '[::]' },
    { port: 8080, pid: 999, address: '0.0.0.0' },
  ];
  check('with no first-seen map the lowest port in the tree wins',
    portForTree(listeners, new Set([100, 200, 300])) === 5173,
    show(portForTree(listeners, new Set([300]))));
  check('a listener outside the tree is ignored',
    portForTree(listeners, new Set([100])) === null);
  check('a tree with no listeners gives null',
    portForTree([], new Set([100, 200])) === null);
  check('an empty tree gives null',
    portForTree(listeners, new Set<number>()) === null);
  check('the only member listening decides the port',
    portForTree(listeners, new Set([999])) === 8080);
  check('a lower port found later still wins',
    portForTree([
      { port: 9000, pid: 1, address: '0.0.0.0' },
      { port: 3000, pid: 2, address: '0.0.0.0' },
    ], new Set([1, 2])) === 3000);

  // The latest listener to start is the one the user just started, so it wins even
  // when a lower port has been up longer.
  const two: Listener[] = [
    { port: 3000, pid: 300, address: '0.0.0.0' },
    { port: 5173, pid: 300, address: '0.0.0.0' },
  ];
  check('the latest listener wins over a lower, older port',
    portForTree(two, new Set([300]), new Map([['300:3000', 1000], ['300:5173', 2000]])) === 5173,
    show(portForTree(two, new Set([300]), new Map([['300:3000', 1000], ['300:5173', 2000]]))));
  check('the latest listener wins when it is the lower port',
    portForTree(two, new Set([300]), new Map([['300:3000', 2000], ['300:5173', 1000]])) === 3000);
  check('ports first seen on the same poll fall back to the lowest',
    portForTree(two, new Set([300]), new Map([['300:3000', 1000], ['300:5173', 1000]])) === 3000);
  check('an empty first-seen map falls back to the lowest',
    portForTree(two, new Set([300]), new Map()) === 3000);
  check('a port missing from the map loses to one that is in it',
    portForTree(two, new Set([300]), new Map([['300:5173', 1000]])) === 5173);
  check('a dual-stack duplicate does not change the winner',
    portForTree([...two, { port: 5173, pid: 300, address: '[::]' }], new Set([300]),
      new Map([['300:3000', 2000], ['300:5173', 1000]])) === 3000);
  check('a listener outside the tree is ignored even when it is the latest',
    portForTree([...two, { port: 8080, pid: 999, address: '0.0.0.0' }], new Set([300]),
      new Map([['300:3000', 1000], ['300:5173', 1000], ['999:8080', 5000]])) === 3000);
}

console.log('\nserver-detect: trackFirstSeen\n');
{
  const firstSeen = new Map<string, number>();
  trackFirstSeen(firstSeen, [{ port: 3000, pid: 300, address: '0.0.0.0' }], 1000);
  check('a new listener is stamped with now', firstSeen.get('300:3000') === 1000, show([...firstSeen]));

  trackFirstSeen(firstSeen, [
    { port: 3000, pid: 300, address: '0.0.0.0' },
    { port: 5173, pid: 300, address: '0.0.0.0' },
  ], 2000);
  check('a listener already known keeps its first time', firstSeen.get('300:3000') === 1000);
  check('a second listener is stamped with the later time', firstSeen.get('300:5173') === 2000);

  trackFirstSeen(firstSeen, [{ port: 5173, pid: 300, address: '0.0.0.0' }], 3000);
  check('a listener that stopped is pruned', !firstSeen.has('300:3000'), show([...firstSeen]));
  check('a listener that is still up survives the prune', firstSeen.get('300:5173') === 2000);

  // A restarted server has to count as new, otherwise it could never overtake a
  // server that has been up all along.
  trackFirstSeen(firstSeen, [
    { port: 3000, pid: 300, address: '0.0.0.0' },
    { port: 5173, pid: 300, address: '0.0.0.0' },
  ], 4000);
  check('a listener that comes back is stamped as new', firstSeen.get('300:3000') === 4000);
  check('a disappeared-and-back listener now wins the port',
    portForTree([
      { port: 3000, pid: 300, address: '0.0.0.0' },
      { port: 5173, pid: 300, address: '0.0.0.0' },
    ], new Set([300]), firstSeen) === 3000);

  const dual = new Map<string, number>();
  trackFirstSeen(dual, [
    { port: 5173, pid: 300, address: '0.0.0.0' },
    { port: 5173, pid: 300, address: '[::]' },
  ], 1000);
  check('a dual-stack listener makes one entry', dual.size === 1 && dual.get('300:5173') === 1000, show([...dual]));

  trackFirstSeen(dual, [], 2000);
  check('no listeners at all empties the map', dual.size === 0, show([...dual]));

  const safe = new Map<string, number>([['300:3000', 1]]);
  trackFirstSeen(safe, undefined as unknown as Listener[], 2000);
  check('a missing listener list prunes rather than throwing', safe.size === 0);
}

console.log('\nserver-detect: listenerKey\n');
{
  const a: Listener[] = [
    { port: 5173, pid: 300, address: '127.0.0.1' },
    { port: 8080, pid: 999, address: '0.0.0.0' },
  ];
  const reordered: Listener[] = [a[1], a[0]];
  check('order does not change the key', listenerKey(a) === listenerKey(reordered), listenerKey(a));
  check('a dual-stack duplicate does not change the key',
    listenerKey([...a, { port: 5173, pid: 300, address: '[::]' }]) === listenerKey(a));
  check('a new port changes the key',
    listenerKey([...a, { port: 3000, pid: 300, address: '0.0.0.0' }]) !== listenerKey(a));
  check('the same port on a new pid changes the key',
    listenerKey([...a, { port: 5173, pid: 301, address: '0.0.0.0' }]) !== listenerKey(a));
  check('an empty list gives an empty key', listenerKey([]) === '');
  check('the key is the sorted pid:port pairs',
    listenerKey([{ port: 80, pid: 2, address: 'x' }, { port: 90, pid: 1, address: 'y' }]) === '1:90,2:80',
    listenerKey([{ port: 80, pid: 2, address: 'x' }, { port: 90, pid: 1, address: 'y' }]));
}

console.log('\nserver-detect: tabPorts\n');
{
  const procs: Proc[] = [
    { pid: 100, ppid: 4, created: 1000 },   // tab-1's cmd
    { pid: 200, ppid: 100, created: 2000 }, // npm
    { pid: 300, ppid: 200, created: 3000 }, // the server
    { pid: 700, ppid: 4, created: 1000 },   // tab-2's cmd, nothing running
    { pid: 800, ppid: 4, created: 1000 },   // tab-3's cmd
    { pid: 810, ppid: 800, created: 2000 },
  ];
  const listeners: Listener[] = [
    { port: 5173, pid: 300, address: '127.0.0.1' },
    { port: 60123, pid: 300, address: '[::]' },
    { port: 3000, pid: 810, address: '0.0.0.0' },
    { port: 22, pid: 4242, address: '0.0.0.0' },
  ];
  const shellPids = new Map<string, number>([['tab-1', 100], ['tab-2', 700], ['tab-3', 800]]);
  const got = tabPorts(shellPids, procs, listeners);

  check('every tab gets an entry', got.size === 3, show([...got]));
  check("a server deep in a tab's tree is found", got.get('tab-1') === 5173, show(got.get('tab-1')));
  check('a tab with no server gets null', got.get('tab-2') === null, show(got.get('tab-2')));
  check('a second tab gets its own port', got.get('tab-3') === 3000, show(got.get('tab-3')));
  check('a listener owned by nobody in any tree is ignored',
    ![...got.values()].includes(22));

  check('no tabs gives no entries', tabPorts(new Map(), procs, listeners).size === 0);
  check('an empty process list still reports the shell pid itself',
    tabPorts(new Map([['tab-1', 300]]), [], listeners).get('tab-1') === 5173);
  check('no listeners gives null for every tab',
    [...tabPorts(shellPids, procs, []).values()].every(v => v === null));

  check('a first-seen map is forwarded, so the latest port wins per tab',
    tabPorts(shellPids, procs, listeners,
      new Map([['300:5173', 1000], ['300:60123', 2000]])).get('tab-1') === 60123,
    show(tabPorts(shellPids, procs, listeners,
      new Map([['300:5173', 1000], ['300:60123', 2000]])).get('tab-1')));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);

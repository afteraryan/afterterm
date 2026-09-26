// Unit tests for Phase 2's attribution: which changes the folder watch saw were
// made by the chat's own commands, what the watch ignores, and what is saved.
// Run directly on Node 24+ (strips types):
//   node src/command-files.test.ts
// Exits 0 if all pass, 1 on any failure.

import { attributeCommandChanges, isIgnoredChange, isBulkCommand, pruneChanges, mergeSaved, SLACK_AFTER_MS, SLACK_BEFORE_MS, type FsChange } from './command-files.ts';
import { newParseState, ingestText } from './session-files.ts';
import type { ShellWindow } from './session-files.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}
const show = (v: unknown) => JSON.stringify(v);

const ROOT = 'D:\\scratch\\proj';
const T = 1_000_000;
const change = (rel: string, at: number, birth = 0): FsChange => ({ path: `${ROOT}\\${rel}`, at, birth });
const win = (start: number, end: number | null, cwd: string | null = ROOT, bulk = false): ShellWindow => ({ start, end, cwd, bulk });

console.log('what the watch ignores');
check('a document in the folder is kept', !isIgnoredChange(`${ROOT}\\docs\\a.md`, ROOT));
check('node_modules is ignored', isIgnoredChange(`${ROOT}\\node_modules\\x\\index.js`, ROOT));
check('.git is ignored', isIgnoredChange(`${ROOT}\\.git\\index`, ROOT));
check('out and dist are ignored', isIgnoredChange(`${ROOT}\\out\\a.js`, ROOT) && isIgnoredChange(`${ROOT}\\dist\\a.js`, ROOT));
check('.vite is ignored', isIgnoredChange(`${ROOT}\\.vite\\build\\main.js`, ROOT));
check('case does not matter', isIgnoredChange(`${ROOT}\\Node_Modules\\a.js`, ROOT));
check('another chat\'s worktree under .claude\\worktrees is ignored', isIgnoredChange(`${ROOT}\\.claude\\worktrees\\x\\a.md`, ROOT));
check('other .claude files are kept', !isIgnoredChange(`${ROOT}\\.claude\\commands\\run.md`, ROOT));
check('a folder merely named like one is only ignored as a folder', !isIgnoredChange(`${ROOT}\\docs\\out.md`, ROOT));
check('sed\'s temp file is ignored', isIgnoredChange(`${ROOT}\\docs\\sedAb12Cd`, ROOT));
check('a .tmp file is ignored', isIgnoredChange(`${ROOT}\\a.md.tmp`, ROOT));
check('an editor backup is ignored', isIgnoredChange(`${ROOT}\\a.md~`, ROOT));
check('outside the folder is ignored', isIgnoredChange('D:\\elsewhere\\a.md', ROOT));
check('the folder itself is ignored', isIgnoredChange(ROOT, ROOT));

console.log('checkout-like commands');
check('git checkout is bulk', isBulkCommand('git checkout main'));
check('git pull is bulk', isBulkCommand('git pull --rebase'));
check('git -C path stash is bulk', isBulkCommand('git -C D:/x stash push -u'));
check('after cd && is bulk', isBulkCommand('cd app && git merge feature'));
check('git restore a file is not bulk', !isBulkCommand('git restore src/a.ts'));
check('git status is not bulk', !isBulkCommand('git status'));
check('cat > file is not bulk', !isBulkCommand('cat > docs/a.md <<EOF'));
check('a command mentioning git later is judged by its first git call', isBulkCommand('npm test; git stash'));

console.log('attribution');
{
  const windows = [win(T, T + 5000)];
  const out = attributeCommandChanges([
    change('docs\\made.md', T + 1000, T + 1000),
    change('docs\\edited.md', T + 2000, T - 100000),
    change('by-hand.md', T + 60000, T - 100000),
    change('shot.png', T + 1500, T + 1500),
  ], windows, T + 100000);
  const names = out.map(f => f.path.split('\\').pop());
  check('a file made during the command is listed', names.includes('made.md'), show(names));
  check('it is New', out.find(f => f.path.endsWith('made.md'))!.created === true);
  check('a file changed during the command is listed, not New', out.find(f => f.path.endsWith('edited.md'))?.created === false);
  check('a file changed by hand later is left out', !names.includes('by-hand.md'));
  check('an image is left out', !names.includes('shot.png'));
  check('source is command', out.every(f => f.source === 'command'));
  check('newest first', names[0] === 'edited.md');
}
{
  const at = (d: number) => attributeCommandChanges([change('a.md', d)], [win(T, T + 1000)], T + 100000).length === 1;
  check('just before the recorded start still counts', at(T - SLACK_BEFORE_MS + 10));
  check('well before the start does not', !at(T - SLACK_BEFORE_MS - 10));
  check('just after the result still counts', at(T + 1000 + SLACK_AFTER_MS - 10));
  check('well after the result does not', !at(T + 1000 + SLACK_AFTER_MS + 10));
}
check('a command still running counts up to now', attributeCommandChanges([change('a.md', T + 50000)], [win(T, null)], T + 60000).length === 1);
check('a change outside the command\'s folder is left out', attributeCommandChanges([{ path: 'D:\\other\\a.md', at: T + 10, birth: 0 }], [win(T, T + 100)], T + 1000).length === 0);
check('a change in a subfolder of the command\'s folder counts', attributeCommandChanges([change('deep\\er\\a.md', T + 10)], [win(T, T + 100)], T + 1000).length === 1);
check('a git checkout window claims nothing', attributeCommandChanges([change('a.md', T + 10)], [win(T, T + 100, ROOT, true)], T + 1000).length === 0);
check('a window with no folder claims nothing', attributeCommandChanges([change('a.md', T + 10)], [win(T, T + 100, null)], T + 1000).length === 0);
check('several changes to one file are one row, newest time', (() => {
  const out = attributeCommandChanges([change('a.md', T + 10, T + 10), change('a.md', T + 90, T + 10)], [win(T, T + 100)], T + 1000);
  return out.length === 1 && out[0].at === T + 90 && out[0].created;
})());
check('two chats running a command in the same folder at once both get the file', (() => {
  const c = [change('shared.md', T + 50)];
  return attributeCommandChanges(c, [win(T, T + 100)], T + 1000).length === 1
    && attributeCommandChanges(c, [win(T + 20, T + 80)], T + 1000).length === 1;
})());

console.log('windows from a real-shaped transcript');
{
  const s = newParseState();
  const iso = (ms: number) => new Date(ms).toISOString();
  const base = Date.parse('2026-09-25T10:00:00Z');
  ingestText(s, [
    JSON.stringify({ type: 'assistant', timestamp: iso(base), cwd: ROOT, message: { content: [{ type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'cat > notes.md <<EOF' } }] } }),
    JSON.stringify({ type: 'user', timestamp: iso(base + 800), cwd: ROOT, message: { content: [{ type: 'tool_result', tool_use_id: 'b1' }] } }),
    JSON.stringify({ type: 'assistant', timestamp: iso(base + 5000), cwd: ROOT, message: { content: [{ type: 'tool_use', id: 'b2', name: 'Bash', input: { command: 'git checkout -b x' } }] } }),
    JSON.stringify({ type: 'user', timestamp: iso(base + 5500), cwd: ROOT, message: { content: [{ type: 'tool_result', tool_use_id: 'b2' }] } }),
  ].join('\n'));
  check('the parser marks a checkout window bulk', s.windows[1].bulk === true && s.windows[0].bulk === false);
  const out = attributeCommandChanges([change('notes.md', base + 400, base + 400), change('src\\a.ts', base + 5200)], s.windows, base + 10000);
  check('cat > notes.md is attributed; the checkout\'s change is not', show(out.map(f => f.path.split('\\').pop())) === show(['notes.md']), show(out));
}

console.log('pruning and saving');
{
  const many: FsChange[] = Array.from({ length: 30 }, (_, i) => change(`f${i}.md`, T + i));
  check('capped to the newest', pruneChanges(many, T + 30, 10).length === 10 && pruneChanges(many, T + 30, 10)[0].path.endsWith('f20.md'));
  check('old changes dropped', pruneChanges([change('old.md', T), change('new.md', T + 100)], T + 100, 100, 50).length === 1);
  const saved = [{ path: 'D:\\a.md', kind: 'doc', created: true, at: 5, source: 'command' }, { junk: 1 }, null, { path: 'D:\\b.png', kind: 'image', created: true, at: 1 }];
  const merged = mergeSaved(saved, [{ path: 'D:\\c.ts', kind: 'code', created: false, at: 9, source: 'command' }]);
  check('saved entries merge with fresh ones, junk dropped', show(merged.map(f => f.path)) === show(['D:\\c.ts', 'D:\\a.md']), show(merged));
  check('a non-array save is ignored', mergeSaved({ nope: 1 }, []).length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

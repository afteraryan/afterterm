// Unit tests for the file-name index behind file links (edited files, 2026-09-26).
// Run directly on Node 24+ (strips types):
//   node src/file-index.test.ts
// Exits 0 if all pass, 1 on any failure. Uses an in-memory folder tree.

import { buildNameIndex, findByName, MAX_INDEX_ENTRIES, type IndexFs } from './file-index.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}
const show = (v: unknown) => JSON.stringify(v);

// A tree as nested objects: a string value is a file, an object a folder.
type Tree = { [name: string]: Tree | string };
function fsFrom(root: string, tree: Tree): IndexFs & { listed: string[] } {
  const listed: string[] = [];
  const at = (dir: string): Tree | null => {
    if (dir === root) return tree;
    const rel = dir.slice(root.length + 1).split('\\');
    let cur: Tree | string = tree;
    for (const part of rel) { if (typeof cur !== 'object' || !(part in cur)) return null; cur = cur[part]; }
    return typeof cur === 'object' ? cur : null;
  };
  return {
    listed,
    list: async (dir) => {
      listed.push(dir);
      const t = at(dir);
      return t ? Object.entries(t).map(([name, v]) => ({ name, dir: typeof v === 'object' })) : [];
    },
  };
}

const ROOT = 'D:\\p';
const tree: Tree = {
  'README.md': '',
  docs: { screenshots: { flows: { '03-operator-home.png': '' }, 'README.md': '' } },
  assets: { v4: { 'burger.png': '' } },
  node_modules: { lib: { 'burger.png': '' } },
  '.git': { 'HEAD': '' },
  out: { 'app.js': '' },
  '.claude': { worktrees: { other: { 'burger.png': '' } }, commands: { 'run.md': '' } },
  src: { a: { 'index.tsx': '' }, b: { 'index.tsx': '' } },
};

const fsLike = fsFrom(ROOT, tree);
const idx = await buildNameIndex(ROOT, fsLike, 5);

console.log('indexing');
check('a deep screenshot is found by its bare name', show(findByName(idx, '03-operator-home.png')) === show(['D:\\p\\docs\\screenshots\\flows\\03-operator-home.png']));
check('case does not matter', findByName(idx, '03-OPERATOR-HOME.PNG').length === 1);
check('two files with one name are both returned', findByName(idx, 'index.tsx').length === 2);
check('shallow files come first', findByName(idx, 'README.md')[0] === 'D:\\p\\README.md');
check('node_modules is not indexed', !findByName(idx, 'burger.png').some(p => p.includes('node_modules')));
check('another chat\'s worktree is not indexed', !findByName(idx, 'burger.png').some(p => p.includes('worktrees')));
check('so burger.png has exactly one match', findByName(idx, 'burger.png').length === 1, show(findByName(idx, 'burger.png')));
check('.claude\\commands is indexed', findByName(idx, 'run.md').length === 1);
check('.git and out are not walked', !fsLike.listed.some(d => /\\(\.git|out)$/.test(d)));
check('a path argument uses its name', findByName(idx, 'assets/v4/burger.png').length === 1);
check('an unknown name finds nothing', findByName(idx, 'nope.png').length === 0);
check('an empty name finds nothing', findByName(idx, '').length === 0);
check('build time kept', idx.builtAt === 5 && idx.root === ROOT);
check('not truncated', idx.truncated === false);

console.log('the cap');
{
  const big: Tree = {};
  for (let i = 0; i < MAX_INDEX_ENTRIES + 50; i++) big[`f${i}.txt`] = '';
  const bigIdx = await buildNameIndex(ROOT, fsFrom(ROOT, big));
  check('a folder past the cap is marked partial', bigIdx.truncated === true);
  check('and holds at most the cap', bigIdx.byName.size <= MAX_INDEX_ENTRIES);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

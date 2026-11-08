// Prints what planSpawn gives cmd for several inherited PROMPT values, for the fixed worktree
// (argv[2]) and the baseline copy at fac29ed (argv[3]). Also prints the exact marked values.
import { pathToFileURL } from 'node:url';
const fixedPath = process.argv[2], basePath = process.argv[3];
const fixed = await import(pathToFileURL(fixedPath).href);
const base = await import(pathToFileURL(basePath).href);
const cmd = { id: 'cmd', command: 'cmd.exe', args: [] };
const plan = (m, env, prefs) => m.planSpawn({ shell: cmd, cwd: undefined, home: 'C:\\', env, prefs, dirExists: () => false });
const OFF = { shellIntegration: { cmd: 'off' } };
const marked = (v) => fixed.wrapCmdPrompt(v);
const cases = {
  'single wrap of $P$G (what a parent afterterm exports)': marked('$P$G'),
  'double wrap of $P$G': marked(marked('$P$G')),
  'single wrap of $E[32m$P$G (custom green prompt)': marked('$E[32m$P$G'),
  'double wrap of $E[32m$P$G': marked(marked('$E[32m$P$G')),
  'no PROMPT at all': undefined,
};
console.log('CMD_MARK_START =', fixed.CMD_MARK_START);
console.log('CMD_MARK_END   =', fixed.CMD_MARK_END);
for (const [label, p] of Object.entries(cases)) {
  const env = p === undefined ? { AFTERTERM: '1' } : { AFTERTERM: '1', PROMPT: p };
  console.log('\n== inherited:', label, '\n   value:', p);
  for (const [mname, m] of [['BASELINE fac29ed', base], ['FIXED  HEAD', fixed]]) {
    for (const [pname, prefs] of [['on ', undefined], ['off', OFF]]) {
      const out = plan(m, env, prefs);
      console.log(`   ${mname} integration ${pname} -> PROMPT = ${out.env.PROMPT}`);
    }
  }
}

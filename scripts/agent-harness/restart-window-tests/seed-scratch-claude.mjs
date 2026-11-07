// Builds a scratch Claude folder for the hook tests: a settings.json holding afterterm's
// hooks block plus two hooks that are not afterterm's, one in its own group and one
// sharing a group with afterterm's entry, and a few other keys that must survive.
//
//   node seed-scratch-claude.mjs <scratch folder> [<source settings.json>]
//
// The hooks block comes from <source>, by default the scratch folder's own settings.json:
// launch the app once with CLAUDE_CONFIG_DIR=<a scratch folder> and it writes one there.
// It never reads the real Claude folder (it refuses a source or target inside it), and
// it writes only under the scratch folder. The hook script is copied from the repo's
// assets when the folder has none.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = process.argv[2];
if (!dir) throw new Error('usage: node seed-scratch-claude.mjs <scratch folder> [<source settings.json>]');
const source = process.argv[3] || path.join(dir, 'settings.json');
const realDir = path.resolve(os.homedir(), '.claude').toLowerCase();
const inReal = (p) => {
  const r = path.resolve(p).toLowerCase();
  return r === realDir || r.startsWith(realDir + path.sep);
};
if (inReal(dir)) throw new Error(`refusing: ${dir} is the real Claude folder`);
if (inReal(source)) throw new Error(`refusing to read ${source}: it is in the real Claude folder`);

const base = JSON.parse(fs.readFileSync(source, 'utf-8').replace(/^﻿/, ''));
if (!base.hooks || !Array.isArray(base.hooks.Stop) || !Array.isArray(base.hooks.UserPromptSubmit)) {
  throw new Error(`${source} has no afterterm hooks block: launch the app once with CLAUDE_CONFIG_DIR set to a scratch folder first`);
}
const other = (name) => ({ type: 'command', command: 'cmd', args: ['/c', `echo ${name}`] });
const s = { theme: 'scratch-marker', statusLine: { type: 'command', command: 'echo scratch' }, hooks: JSON.parse(JSON.stringify(base.hooks)) };
s.hooks.Stop.push({ matcher: '', hooks: [other('someone-elses-hook-own-group')] });
s.hooks.UserPromptSubmit[0].hooks.push(other('someone-elses-hook-same-group'));

fs.mkdirSync(path.join(dir, 'hooks'), { recursive: true });
const script = path.join(dir, 'hooks', 'afterterm-notify.ps1');
if (!fs.existsSync(script)) {
  const repoScript = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'assets', 'hooks', 'afterterm-notify.ps1');
  fs.copyFileSync(repoScript, script);
}
fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(s, null, 2) + '\n');
console.log('seeded', dir, 'from', source, 'events:', Object.keys(s.hooks).join(', '));

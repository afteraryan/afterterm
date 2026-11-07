// Builds a scratch Claude folder whose settings.json is a copy of the real hooks block,
// plus two hooks that are not afterterm's: one in its own group and one sharing a group
// with afterterm's entry. Reads the real file, writes only under the scratch folder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir = process.argv[2];
const real = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf-8'));
const other = (name) => ({ type: 'command', command: 'cmd', args: ['/c', `echo ${name}`] });
const s = { theme: 'scratch-marker', statusLine: { type: 'command', command: 'echo scratch' }, hooks: JSON.parse(JSON.stringify(real.hooks)) };
s.hooks.Stop.push({ matcher: '', hooks: [other('someone-elses-hook-own-group')] });
s.hooks.UserPromptSubmit[0].hooks.push(other('someone-elses-hook-same-group'));
fs.mkdirSync(path.join(dir, 'hooks'), { recursive: true });
fs.copyFileSync(path.join(os.homedir(), '.claude', 'hooks', 'afterterm-notify.ps1'), path.join(dir, 'hooks', 'afterterm-notify.ps1'));
fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(s, null, 2) + '\n');
console.log('seeded', dir, 'events:', Object.keys(s.hooks).join(', '));

// NOTE: the settings it writes name the real hook script (~/.claude/hooks/afterterm-notify.ps1) by path, read only. An agent must not run it unless that is the intent.
// Writes the settings files the remaining live tests use. Only writes under the scratch
// folder; the real afterterm hook script is referenced read-only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const rw = process.argv[2];
fs.mkdirSync(path.join(rw, 'cwd'), { recursive: true }); // the empty folder test chats start in
const ps = (file) => ({ type: 'command', command: 'pwsh', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file] });
const after = ps(path.join(os.homedir(), '.claude', 'hooks', 'afterterm-notify.ps1'));
const other = ps(path.join(rw, 'other-hook.ps1'));
const both = (a, b) => ({ UserPromptSubmit: [{ matcher: '', hooks: [a] }, { matcher: '', hooks: [b] }], Stop: [{ matcher: '', hooks: [a] }, { matcher: '', hooks: [b] }] });
fs.writeFileSync(path.join(rw, 'two-hooks-other-first.json'), JSON.stringify({ hooks: both(other, after) }, null, 2));
fs.writeFileSync(path.join(rw, 'two-hooks-afterterm-first.json'), JSON.stringify({ hooks: both(after, other) }, null, 2));
const hot = path.join(rw, 'cwd-hot', '.claude');
fs.mkdirSync(hot, { recursive: true });
const log = path.join(rw, 'hook-fired.log');
const fire = (ev) => ({ type: 'command', command: 'cmd', args: ['/c', path.join(rw, 'hook-fire.cmd'), ev] });
const on = { hooks: { UserPromptSubmit: [{ matcher: '', hooks: [fire('UserPromptSubmit')] }], Stop: [{ matcher: '', hooks: [fire('Stop')] }] } };
fs.writeFileSync(path.join(rw, 'hot-on.json'), JSON.stringify(on, null, 2) + '\n');
fs.writeFileSync(path.join(rw, 'hot-off.json'), JSON.stringify({ hooks: {} }, null, 2) + '\n');
fs.writeFileSync(path.join(hot, 'settings.local.json'), JSON.stringify(on, null, 2) + '\n');
console.log('written');

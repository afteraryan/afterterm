// Unit tests for shell integration (Phase 6). Run directly on Node 24+ (strips
// types):
//   node src/shell-integration.test.ts
// Exits 0 if all pass, 1 on any failure.
//
// Most of this is pure string/plan building, so it runs against fakes: a fake
// dirExists, hand-built ShellProfileLike values, fake prefs objects. The last
// section spawns the real shells (pwsh, Windows PowerShell, Git Bash) to prove the
// generated scripts actually work; each of those is skipped with a printed note
// when its binary is missing, never failing the run for absence. Nothing here
// touches the user's real profile or rc files: PowerShell runs use -NoProfile,
// and Git Bash gets its hook only through env, never through ~/.bashrc.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import {
  appendWslEnv,
  BASH_BOOTSTRAP,
  BASH_HOOK,
  integrationEnabled,
  planSpawn,
  PWSH_BOOTSTRAP,
  pwshEncodedCommand,
  SHELL_INTEGRATION_ENV_KEYS,
} from './shell-integration.ts';
import type { ShellProfileLike, SpawnPlanInput } from './shell-integration.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); fail++; }
}
const show = (v: unknown) => JSON.stringify(v);

console.log('\nshell-integration: integrationEnabled\n');
{
  check('a missing shellIntegration key is enabled', integrationEnabled({}, 'cmd') === true);
  check('an explicit "off" is disabled',
    integrationEnabled({ shellIntegration: { cmd: 'off' } }, 'cmd') === false);
  check('an explicit "on" is enabled',
    integrationEnabled({ shellIntegration: { cmd: 'on' } }, 'cmd') === true);
  check('a different shell turned off does not affect this one',
    integrationEnabled({ shellIntegration: { pwsh: 'off' } }, 'cmd') === true);
  check('"off" is case-sensitive, "Off" stays enabled',
    integrationEnabled({ shellIntegration: { cmd: 'Off' } }, 'cmd') === true);
  check('undefined prefs is enabled', integrationEnabled(undefined, 'cmd') === true);
  check('null prefs is enabled', integrationEnabled(null, 'cmd') === true);
  check('a non-object prefs (string) is enabled', integrationEnabled('nope', 'cmd') === true);
  check('a non-object prefs (number) is enabled', integrationEnabled(42, 'cmd') === true);
  check('a non-object shellIntegration is enabled',
    integrationEnabled({ shellIntegration: 'off' }, 'cmd') === true);
  check('a null shellIntegration is enabled',
    integrationEnabled({ shellIntegration: null }, 'cmd') === true);
  check('every shell id can be turned off independently',
    integrationEnabled({ shellIntegration: { pwsh: 'off' } }, 'pwsh') === false
    && integrationEnabled({ shellIntegration: { powershell: 'off' } }, 'powershell') === false
    && integrationEnabled({ shellIntegration: { gitbash: 'off' } }, 'gitbash') === false
    && integrationEnabled({ shellIntegration: { wsl: 'off' } }, 'wsl') === false);
  check('an unknown shell id with no entry is enabled',
    integrationEnabled({ shellIntegration: {} }, 'made-up') === true);
}

console.log('\nshell-integration: pwshEncodedCommand\n');
{
  const enc = pwshEncodedCommand();
  check('the encoded command is a non-empty base64 string',
    typeof enc === 'string' && enc.length > 0 && /^[A-Za-z0-9+/=]+$/.test(enc));
  const decoded = Buffer.from(enc, 'base64').toString('utf16le');
  check('it round-trips back to the bootstrap script', decoded === PWSH_BOOTSTRAP, show(decoded.length));

  const custom = 'function global:prompt { "x" }\n' + PWSH_BOOTSTRAP;
  const customEnc = pwshEncodedCommand(custom);
  check('a custom script argument round-trips too',
    Buffer.from(customEnc, 'base64').toString('utf16le') === custom);
  check('the default and a custom script give different encodings', customEnc !== enc);
}

console.log('\nshell-integration: PWSH_BOOTSTRAP shape\n');
{
  check('sets a wrap guard', PWSH_BOOTSTRAP.includes('__AftertermPromptWrapped'));
  check('saves the original prompt function', PWSH_BOOTSTRAP.includes('__AftertermOriginalPrompt'));
  check('defines a replacement prompt', PWSH_BOOTSTRAP.includes('function global:prompt'));
  check('emits OSC 133;A', PWSH_BOOTSTRAP.includes(']133;A'));
  check('emits OSC 133;B', PWSH_BOOTSTRAP.includes(']133;B'));
  check('emits OSC 9;9', PWSH_BOOTSTRAP.includes(']9;9;'));
  check('gates the cwd report on the FileSystem provider',
    PWSH_BOOTSTRAP.includes("FileSystem"));
  check('restores $? with a suppressed Write-Error',
    PWSH_BOOTSTRAP.includes('Write-Error') && PWSH_BOOTSTRAP.includes('-ErrorAction Ignore'));
  check('contains the Windows PowerShell banner text',
    PWSH_BOOTSTRAP.includes('Windows PowerShell')
    && PWSH_BOOTSTRAP.includes('Copyright (C) Microsoft Corporation. All rights reserved.'));
  check('contains the PowerShell 7 banner text',
    PWSH_BOOTSTRAP.includes('PowerShell $($PSVersionTable.PSVersion)'));
}

console.log('\nshell-integration: BASH_HOOK and BASH_BOOTSTRAP shape\n');
{
  check('BASH_HOOK has no newline characters', !BASH_HOOK.includes('\n'));
  check('BASH_HOOK is non-empty', BASH_HOOK.length > 0);
  check('BASH_HOOK wraps PS1 with OSC 133;A', BASH_HOOK.includes('133;A'));
  check('BASH_HOOK wraps PS1 with OSC 133;B', BASH_HOOK.includes('133;B'));
  check('BASH_HOOK reports cwd with OSC 9;9', BASH_HOOK.includes('9;9;'));
  check('BASH_HOOK reports the WSL case with OSC 7 file://', BASH_HOOK.includes('7;file://'));
  check('BASH_HOOK unexports itself once installed', BASH_HOOK.includes('export -n'));
  check('BASH_HOOK defines the precmd function', BASH_HOOK.includes('__afterterm_precmd()'));
  check('BASH_HOOK embeds the literal bootstrap text to strip it out',
    BASH_HOOK.includes(BASH_BOOTSTRAP));

  check('BASH_BOOTSTRAP has no newline characters', !BASH_BOOTSTRAP.includes('\n'));
  check('BASH_BOOTSTRAP evaluates the hook env var', BASH_BOOTSTRAP.includes('$AFTERTERM_BASH_HOOK'));
  check('BASH_BOOTSTRAP falls back to unsetting itself on failure',
    BASH_BOOTSTRAP.includes('unset PROMPT_COMMAND'));
}

console.log('\nshell-integration: SHELL_INTEGRATION_ENV_KEYS\n');
{
  check('lists PROMPT_COMMAND and AFTERTERM_BASH_HOOK',
    SHELL_INTEGRATION_ENV_KEYS.includes('PROMPT_COMMAND')
    && SHELL_INTEGRATION_ENV_KEYS.includes('AFTERTERM_BASH_HOOK')
    && SHELL_INTEGRATION_ENV_KEYS.length === 2);
}

console.log('\nshell-integration: appendWslEnv\n');
{
  check('undefined existing gives just the new names, no leading colon',
    appendWslEnv(undefined, ['A', 'B']) === 'A:B');
  check('an empty existing string gives just the new names',
    appendWslEnv('', ['A', 'B']) === 'A:B');
  check('existing entries are kept, new ones appended',
    appendWslEnv('FOO:BAR', ['A', 'B']) === 'FOO:BAR:A:B');
  check('a duplicate name is not added twice',
    appendWslEnv('FOO:A', ['A', 'B']) === 'FOO:A:B');
  check('all names already present changes nothing',
    appendWslEnv('A:B', ['A', 'B']) === 'A:B');
  check('an empty names list changes nothing',
    appendWslEnv('FOO', []) === 'FOO');
  check('a real WSLENV example gains both keys',
    appendWslEnv('SOME_VAR/u', SHELL_INTEGRATION_ENV_KEYS) === 'SOME_VAR/u:PROMPT_COMMAND:AFTERTERM_BASH_HOOK');
}

console.log('\nshell-integration: planSpawn\n');
{
  const cmdShell: ShellProfileLike = { id: 'cmd', command: 'cmd.exe', args: [] };
  const pwshShell: ShellProfileLike = { id: 'pwsh', command: 'pwsh.exe', args: [] };
  const powershellShell: ShellProfileLike = { id: 'powershell', command: 'powershell.exe', args: [] };
  const gitbashShell: ShellProfileLike = { id: 'gitbash', command: 'C:\\Program Files\\Git\\bin\\bash.exe', args: ['--login', '-i'] };
  const wslShell: ShellProfileLike = { id: 'wsl', command: 'wsl.exe', args: [] };
  const unknownShell: ShellProfileLike = { id: 'made-up', command: 'made-up.exe', args: ['-x'] };

  const HOME = 'C:\\Users\\test';
  const existsOnly = (only: string) => (p: string) => p === only;
  const neverExists = () => false;
  const baseEnv = { AFTERTERM: '1', SOMETHING: 'else' };

  function plan(over: Partial<SpawnPlanInput>): ReturnType<typeof planSpawn> {
    return planSpawn({
      shell: cmdShell,
      cwd: undefined,
      home: HOME,
      env: baseEnv,
      prefs: undefined,
      dirExists: neverExists,
      ...over,
    });
  }

  // ── cwd rules ──
  {
    const missing = plan({ cwd: undefined });
    check('a missing cwd falls back to home', missing.cwd === HOME && missing.cwdFallback === true, show(missing));

    const stale = plan({ cwd: 'C:\\gone', dirExists: existsOnly('C:\\elsewhere') });
    check('a stale cwd (dirExists false) falls back to home',
      stale.cwd === HOME && stale.cwdFallback === true, show(stale));

    const valid = plan({ cwd: 'C:\\real\\project', dirExists: existsOnly('C:\\real\\project') });
    check('a valid cwd is used as-is',
      valid.cwd === 'C:\\real\\project' && valid.cwdFallback === false, show(valid));

    let statCalls = 0;
    const countingDirExists = (p: string) => { statCalls++; return p === 'whatever'; };
    const wslUncForWsl = planSpawn({
      shell: wslShell, cwd: '\\\\wsl$\\Ubuntu\\home\\aryan', home: HOME, env: baseEnv,
      prefs: undefined, dirExists: countingDirExists,
    });
    check('a WSL UNC cwd for the wsl shell is honoured through -d/--cd',
      wslUncForWsl.args[0] === '-d' && wslUncForWsl.args[1] === 'Ubuntu'
      && wslUncForWsl.args[2] === '--cd' && wslUncForWsl.args[3] === '/home/aryan', show(wslUncForWsl));
    check('the wsl UNC case still uses home as the process cwd',
      wslUncForWsl.cwd === HOME, show(wslUncForWsl));
    check('the wsl UNC case is not a fallback (the request was honoured)',
      wslUncForWsl.cwdFallback === false);
    check('the wsl UNC case never calls dirExists', statCalls === 0);

    let statCalls2 = 0;
    const countingDirExists2 = (p: string) => { statCalls2++; return true; };
    const wslUncForOther = planSpawn({
      shell: pwshShell, cwd: '\\\\wsl$\\Ubuntu\\home\\aryan', home: HOME, env: baseEnv,
      prefs: undefined, dirExists: countingDirExists2,
    });
    check('a WSL UNC cwd for a non-wsl shell falls back to home',
      wslUncForOther.cwd === HOME && wslUncForOther.cwdFallback === true, show(wslUncForOther));
    check('a WSL UNC cwd for a non-wsl shell never calls dirExists', statCalls2 === 0);

    const wslUncLocalhost = planSpawn({
      shell: wslShell, cwd: '\\\\wsl.localhost\\Debian', home: HOME, env: baseEnv,
      prefs: undefined, dirExists: neverExists,
    });
    check('the wsl.localhost UNC form is also honoured',
      wslUncLocalhost.args[1] === 'Debian' && wslUncLocalhost.args[3] === '/', show(wslUncLocalhost));
  }

  // ── cmd ──
  {
    const on = plan({ shell: cmdShell, env: { ...baseEnv } });
    check('cmd with integration on injects PROMPT',
      on.env.PROMPT === '$E]133;A$E\\$E]9;9;$P$E\\$P$G$E]133;B$E\\', show(on.env.PROMPT));
    check('cmd integration flag is true', on.integration === true);

    const custom = plan({ shell: cmdShell, env: { ...baseEnv, PROMPT: '$M$P$G' } });
    check('cmd preserves a custom PROMPT as the visible part',
      custom.env.PROMPT === '$E]133;A$E\\$E]9;9;$P$E\\$M$P$G$E]133;B$E\\', show(custom.env.PROMPT));

    const off = plan({
      shell: cmdShell, env: { ...baseEnv, PROMPT: '$M$P$G' },
      prefs: { shellIntegration: { cmd: 'off' } },
    });
    check('cmd with integration off leaves PROMPT untouched',
      off.env.PROMPT === '$M$P$G', show(off.env));
    check('cmd integration flag is false when off', off.integration === false);
    check('cmd args pass through unchanged when off', off.args.length === 0);
  }

  // ── pwsh / powershell ──
  {
    const on = plan({ shell: pwshShell, env: { ...baseEnv } });
    check('pwsh with integration on uses -NoExit -EncodedCommand',
      on.args[0] === '-NoExit' && on.args[1] === '-EncodedCommand'
      && on.args[2] === pwshEncodedCommand(), show(on.args));
    check('pwsh integration flag is true', on.integration === true);
    check('pwsh env is unchanged besides being a copy', on.env.SOMETHING === 'else');

    const off = plan({
      shell: powershellShell, env: { ...baseEnv },
      prefs: { shellIntegration: { powershell: 'off' } },
    });
    check('powershell with integration off keeps its own (empty) args',
      off.args.length === 0, show(off.args));
    check('powershell integration flag is false when off', off.integration === false);
  }

  // ── gitbash ──
  {
    const on = plan({ shell: gitbashShell, env: { ...baseEnv } });
    check('gitbash with integration on sets PROMPT_COMMAND to the bootstrap',
      on.env.PROMPT_COMMAND === BASH_BOOTSTRAP);
    check('gitbash with integration on sets AFTERTERM_BASH_HOOK', on.env.AFTERTERM_BASH_HOOK === BASH_HOOK);
    check('gitbash keeps its own args (--login -i)',
      on.args[0] === '--login' && on.args[1] === '-i');
    check('gitbash integration flag is true', on.integration === true);

    const off = plan({
      shell: gitbashShell, env: { ...baseEnv },
      prefs: { shellIntegration: { gitbash: 'off' } },
    });
    check('gitbash with integration off has no PROMPT_COMMAND', off.env.PROMPT_COMMAND === undefined);
    check('gitbash with integration off has no AFTERTERM_BASH_HOOK', off.env.AFTERTERM_BASH_HOOK === undefined);
    check('gitbash integration flag is false when off', off.integration === false);
  }

  // ── wsl ──
  {
    const on = plan({ shell: wslShell, env: { ...baseEnv } });
    check('wsl with integration on sets PROMPT_COMMAND', on.env.PROMPT_COMMAND === BASH_BOOTSTRAP);
    check('wsl with integration on sets AFTERTERM_BASH_HOOK', on.env.AFTERTERM_BASH_HOOK === BASH_HOOK);
    check('wsl with integration on sets WSLENV with both keys, no leading colon',
      on.env.WSLENV === 'PROMPT_COMMAND:AFTERTERM_BASH_HOOK', show(on.env.WSLENV));
    check('wsl with no explicit cwd keeps its own (empty) args', on.args.length === 0);

    const withExistingWslenv = plan({
      shell: wslShell, env: { ...baseEnv, WSLENV: 'FOO/u' },
    });
    check('wsl appends to an existing WSLENV rather than replacing it',
      withExistingWslenv.env.WSLENV === 'FOO/u:PROMPT_COMMAND:AFTERTERM_BASH_HOOK',
      show(withExistingWslenv.env.WSLENV));

    const off = plan({ shell: wslShell, env: { ...baseEnv }, prefs: { shellIntegration: { wsl: 'off' } } });
    check('wsl with integration off sets no env keys',
      off.env.PROMPT_COMMAND === undefined && off.env.AFTERTERM_BASH_HOOK === undefined
      && off.env.WSLENV === undefined, show(off.env));
    check('wsl integration flag is false when off', off.integration === false);
  }

  // ── unknown shell ──
  {
    const unk = plan({ shell: unknownShell, env: { ...baseEnv } });
    check('an unknown shell id gets no integration', unk.integration === false);
    check('an unknown shell id passes its own args through unchanged',
      unk.args.length === 1 && unk.args[0] === '-x', show(unk.args));
    check('an unknown shell id gets a plain env copy',
      unk.env.PROMPT_COMMAND === undefined && unk.env.AFTERTERM_BASH_HOOK === undefined
      && unk.env.PROMPT === undefined);
    check('an unknown shell id still resolves command and cwd',
      unk.command === 'made-up.exe' && unk.cwd === HOME);
  }

  // ── env immutability ──
  {
    const input = { ...baseEnv };
    const out = plan({ shell: cmdShell, env: input });
    check('the input env object is untouched after a run with integration on',
      input.PROMPT === undefined && Object.keys(input).length === 2, show(input));
    check('the returned env is a different object from the input', out.env !== input);

    const input2 = { ...baseEnv, PROMPT: 'kept' };
    const out2 = plan({ shell: cmdShell, env: input2, prefs: { shellIntegration: { cmd: 'off' } } });
    check('the input env object is untouched after a run with integration off',
      input2.PROMPT === 'kept', show(input2));
    check('the returned env is still a copy, not the same reference', out2.env !== input2);
  }
}

console.log('\nshell-integration: real-shell checks (skipped when a binary is missing)\n');

function haveBinary(check: () => boolean): boolean {
  try { return check(); } catch { return false; }
}

const havePwsh = haveBinary(() => {
  const r = spawnSync('where', ['pwsh.exe'], { encoding: 'utf8' });
  return r.status === 0;
});
const havePowershell = haveBinary(() => {
  const r = spawnSync('where', ['powershell.exe'], { encoding: 'utf8' });
  return r.status === 0;
});
const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe';
const haveGitBash = haveBinary(() => fs.existsSync(GIT_BASH));

function runPwshLike(exe: string, script: string, stdinLines: string[]): { status: number | null; out: string } {
  const enc = pwshEncodedCommand(script);
  const r = spawnSync(exe, ['-NoProfile', '-NoExit', '-EncodedCommand', enc], {
    input: stdinLines.join('\n') + '\n',
    encoding: 'utf8',
    cwd: 'C:\\Windows',
  });
  return { status: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

const basicPwshLines = [
  'Get-Item C:\\nonexistent-zz -ErrorAction SilentlyContinue',
  'prompt',
  'Get-Item C:\\',
  'prompt',
  'exit',
];

function checkBasicPwshOutput(label: string, out: string) {
  check(`${label}: emits OSC 133;A`, out.includes('\x1b]133;A\x1b\\'), show(out.slice(0, 80)));
  check(`${label}: emits OSC 9;9;C:\\`, out.includes('\x1b]9;9;C:\\'));
  check(`${label}: emits OSC 133;B`, out.includes('\x1b]133;B\x1b\\'));
}

if (havePwsh) {
  const { out } = runPwshLike('pwsh.exe', PWSH_BOOTSTRAP, basicPwshLines);
  checkBasicPwshOutput('pwsh', out);
  check('pwsh: prints its own banner ("PowerShell <version>") as the first output',
    /^PowerShell \d+\.\d+\.\d+/.test(out), show(out.slice(0, 40)));
} else {
  check('pwsh.exe not found, real-shell pwsh checks skipped', true);
}

{
  // powershell.exe (Windows PowerShell 5.1) is always present on Windows.
  const { out } = runPwshLike('powershell.exe', PWSH_BOOTSTRAP, basicPwshLines);
  checkBasicPwshOutput('powershell', out);
  check('powershell: prints the Windows PowerShell banner as the first output',
    out.startsWith('Windows PowerShell\nCopyright (C) Microsoft Corporation. All rights reserved.'),
    show(out.slice(0, 100)));
}

function customPromptScript(): string {
  return 'function global:prompt { "[$?] custom> " }\n' + PWSH_BOOTSTRAP;
}

function checkCustomPromptOutput(label: string, out: string) {
  check(`${label} custom prompt: shows the failure state after the bad command`,
    out.includes('[False] custom> '), show(out.slice(0, 200)));
  check(`${label} custom prompt: shows the success state after the good command`,
    out.includes('[True] custom> '));
  const idx = out.indexOf('[False] custom> ');
  check(`${label} custom prompt: the marks wrap the custom text in order (A, 9;9, text, B)`,
    idx > 0 && (() => {
      const before = out.lastIndexOf('\x1b]133;A\x1b\\', idx);
      const cwdMark = out.indexOf('\x1b]9;9;', before);
      const afterMark = out.indexOf('\x1b]133;B\x1b\\', idx);
      return before !== -1 && cwdMark !== -1 && cwdMark > before && cwdMark < idx && afterMark > idx;
    })());
}

if (havePwsh) {
  const { out } = runPwshLike('pwsh.exe', customPromptScript(), basicPwshLines);
  checkCustomPromptOutput('pwsh', out);
} else {
  check('pwsh.exe not found, custom-prompt pwsh check skipped', true);
}

{
  const { out } = runPwshLike('powershell.exe', customPromptScript(), basicPwshLines);
  checkCustomPromptOutput('powershell', out);
}

if (haveGitBash) {
  const env1 = { ...process.env, PROMPT_COMMAND: BASH_BOOTSTRAP, AFTERTERM_BASH_HOOK: BASH_HOOK };
  const stdin1 = [
    'echo "PC=[$PROMPT_COMMAND]"',
    'export -p | grep -c AFTERTERM_BASH_HOOK',
    'cd /usr/bin',
    'exit',
    '',
  ].join('\n');
  const r1 = spawnSync(GIT_BASH, ['--login', '-i'], { env: env1 as NodeJS.ProcessEnv, cwd: 'C:\\Windows', input: stdin1, encoding: 'utf8' });
  const out1 = (r1.stdout ?? '') + (r1.stderr ?? '');

  check('git bash: emits OSC 9;9;C:\\Windows', out1.includes('\x1b]9;9;C:\\Windows\x1b\\'), show(out1.slice(0, 120)));
  check('git bash: emits OSC 133;A', out1.includes('\x1b]133;A\x1b\\'));
  check('git bash: emits OSC 133;B', out1.includes('\x1b]133;B\x1b\\'));
  check('git bash: PROMPT_COMMAND becomes just __afterterm_precmd', /PC=\[__afterterm_precmd\]/.test(out1), show(out1));
  check('git bash: AFTERTERM_BASH_HOOK is no longer exported (export -p count is 0)',
    out1.includes('\\0\n'), show(out1));
  check('git bash: reports the new cwd after cd', out1.includes('\x1b]9;9;C:\\Program Files\\Git\\usr\\bin\x1b\\'));

  const env2 = { ...process.env, PROMPT_COMMAND: 'echo RCHOOK; ' + BASH_BOOTSTRAP, AFTERTERM_BASH_HOOK: BASH_HOOK };
  const stdin2 = ['echo "PC=[$PROMPT_COMMAND]"', 'exit', ''].join('\n');
  const r2 = spawnSync(GIT_BASH, ['--login', '-i'], { env: env2 as NodeJS.ProcessEnv, cwd: 'C:\\Windows', input: stdin2, encoding: 'utf8' });
  const out2 = (r2.stdout ?? '') + (r2.stderr ?? '');

  check('git bash rc-file case: RCHOOK still runs on every prompt',
    (out2.match(/RCHOOK/g) || []).length >= 2, show(out2));
  check('git bash rc-file case: an rc addition to PROMPT_COMMAND survives install',
    /PC=\[echo RCHOOK; ?__afterterm_precmd\]/.test(out2), show(out2));
} else {
  check('Git Bash not found at C:\\Program Files\\Git\\bin\\bash.exe, real-shell checks skipped', true);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);

// Unit tests for reconcileClaudeHook — run directly on Node 24+ (strips types):
//   node src/claude-hook-install.test.ts
// Exits 0 if all pass, 1 on any failure.

import fs from 'fs';
import path from 'path';
import os from 'os';
import { reconcileClaudeHook, hookReconcileAllowed, HOOK_SCRIPT_NAME } from './claude-hook-install.ts';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    console.log(`  PASS  ${name}`);
    pass++;
  } else {
    console.log(`  FAIL  ${name}${detail ? '  — ' + detail : ''}`);
    fail++;
  }
}

// Each test gets a fresh temp sandbox: a fake ~/.claude, a prefs path, and a
// real bundled-script source so we exercise the actual file copy.
function sandbox(withClaudeDir = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'afterterm-hook-'));
  const claudeDir = path.join(root, '.claude');
  if (withClaudeDir) fs.mkdirSync(claudeDir, { recursive: true });
  const prefsPath = path.join(root, 'prefs.json');
  const scriptSource = path.join(root, 'afterterm-notify.ps1');
  fs.writeFileSync(scriptSource, '# bundled hook v1\n', 'utf-8');
  return { root, claudeDir, prefsPath, scriptSource };
}
const opts = (b: ReturnType<typeof sandbox>) => ({
  scriptSource: b.scriptSource,
  claudeDir: b.claudeDir,
  prefsPath: b.prefsPath,
  powershell: 'pwsh', // deterministic — don't depend on where.exe in CI
});
function readSettings(claudeDir: string): any {
  const p = path.join(claudeDir, 'settings.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : null;
}
function groupsFor(settings: any, event: string): any[] {
  return settings?.hooks?.[event] ?? [];
}
function hasOurEntry(settings: any, event: string): boolean {
  return groupsFor(settings, event).some((g: any) =>
    g?.hooks?.some((h: any) => h?.args?.some((a: any) => String(a).endsWith(HOOK_SCRIPT_NAME))),
  );
}

console.log('\nreconcileClaudeHook tests\n');

// 1. Fresh install: no settings.json yet.
{
  const b = sandbox();
  const r = reconcileClaudeHook(opts(b));
  const s = readSettings(b.claudeDir);
  check('fresh: status registered', r.status === 'registered', r.status);
  check('fresh: changed + showToast', r.changed && r.showToast);
  check('fresh: all 5 events registered',
    ['SessionStart', 'UserPromptSubmit', 'Notification', 'Stop', 'PreCompact'].every((e) => hasOurEntry(s, e)));
  check('fresh: Notification matcher is permission_prompt',
    groupsFor(s, 'Notification').some((g: any) => g.matcher === 'permission_prompt'));
  check('fresh: script copied into ~/.claude/hooks', fs.existsSync(path.join(b.claudeDir, 'hooks', HOOK_SCRIPT_NAME)));
  check('fresh: prefs records enabled + toastShown', (() => {
    const p = JSON.parse(fs.readFileSync(b.prefsPath, 'utf-8'));
    return p.claudeNotifications === 'enabled' && p.claudeHookToastShown === true;
  })());
}

// 2. Idempotency: running twice must not duplicate, and must not re-toast.
{
  const b = sandbox();
  reconcileClaudeHook(opts(b));
  const r2 = reconcileClaudeHook(opts(b));
  const s = readSettings(b.claudeDir);
  check('rerun: status already-current', r2.status === 'already-current', r2.status);
  check('rerun: no change, no toast', !r2.changed && !r2.showToast);
  check('rerun: Stop still has exactly 1 of our entries',
    groupsFor(s, 'Stop').filter((g: any) => hasOurEntry({ hooks: { Stop: [g] } }, 'Stop')).length === 1);
}

// 3. Preserve the user's existing hooks (merge, not overwrite).
{
  const b = sandbox();
  const userSettings = {
    permissions: { defaultMode: 'auto' },
    hooks: {
      Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'pwsh', args: ['-File', 'C:\\mine\\my-hook.ps1'] }] }],
    },
  };
  fs.writeFileSync(path.join(b.claudeDir, 'settings.json'), JSON.stringify(userSettings, null, 2), 'utf-8');
  const r = reconcileClaudeHook(opts(b));
  const s = readSettings(b.claudeDir);
  check('merge: status registered', r.status === 'registered', r.status);
  check('merge: user permissions untouched', s.permissions?.defaultMode === 'auto');
  check('merge: user Stop hook preserved',
    groupsFor(s, 'Stop').some((g: any) => g.hooks?.some((h: any) => String(h.args?.[1]).endsWith('my-hook.ps1'))));
  check('merge: afterterm Stop entry added alongside (2 groups)', groupsFor(s, 'Stop').length === 2);
}

// 4. Opt-out: prefs disabled → our entries removed, user's kept.
{
  const b = sandbox();
  reconcileClaudeHook(opts(b)); // register first
  // user adds their own Stop hook after the fact
  const s0 = readSettings(b.claudeDir);
  s0.hooks.Stop.push({ matcher: '', hooks: [{ type: 'command', command: 'pwsh', args: ['-File', 'C:\\mine\\my-hook.ps1'] }] });
  fs.writeFileSync(path.join(b.claudeDir, 'settings.json'), JSON.stringify(s0, null, 2), 'utf-8');
  // now opt out
  fs.writeFileSync(b.prefsPath, JSON.stringify({ claudeNotifications: 'disabled' }), 'utf-8');
  const r = reconcileClaudeHook(opts(b));
  const s = readSettings(b.claudeDir);
  check('disable: status removed', r.status === 'removed', r.status);
  check('disable: afterterm entries gone from all events',
    ['SessionStart', 'UserPromptSubmit', 'Notification', 'Stop', 'PreCompact'].every((e) => !hasOurEntry(s, e)));
  check('disable: user Stop hook survived',
    groupsFor(s, 'Stop').some((g: any) => g.hooks?.some((h: any) => String(h.args?.[1]).endsWith('my-hook.ps1'))));
  check('disable: empty event keys cleaned up', !('SessionStart' in (s.hooks ?? {})));
}

// 5. Disabled with nothing of ours present → disabled-noop.
{
  const b = sandbox();
  fs.writeFileSync(b.prefsPath, JSON.stringify({ claudeNotifications: 'disabled' }), 'utf-8');
  const r = reconcileClaudeHook(opts(b));
  check('disabled-noop: status', r.status === 'disabled-noop' && !r.changed, r.status);
}

// 6. No ~/.claude at all → skipped, nothing created.
{
  const b = sandbox(false);
  const r = reconcileClaudeHook(opts(b));
  check('no-claude-dir: skipped', r.status === 'skipped' && !r.changed, r.status);
  check('no-claude-dir: dir not created', !fs.existsSync(b.claudeDir));
}

// 7. Unparseable settings.json → skipped, file left byte-for-byte untouched.
{
  const b = sandbox();
  const garbage = '{ this is : not json ]';
  const sp = path.join(b.claudeDir, 'settings.json');
  fs.writeFileSync(sp, garbage, 'utf-8');
  const r = reconcileClaudeHook(opts(b));
  check('bad-json: skipped', r.status === 'skipped', r.status);
  check('bad-json: file untouched', fs.readFileSync(sp, 'utf-8') === garbage);
}

// 8. Re-enable after opt-out: registers again but does NOT re-toast.
{
  const b = sandbox();
  reconcileClaudeHook(opts(b)); // first register (toast shown, marker set)
  fs.writeFileSync(b.prefsPath, JSON.stringify({ claudeNotifications: 'disabled', claudeHookToastShown: true }), 'utf-8');
  reconcileClaudeHook(opts(b)); // remove
  fs.writeFileSync(b.prefsPath, JSON.stringify({ claudeNotifications: 'enabled', claudeHookToastShown: true }), 'utf-8');
  const r = reconcileClaudeHook(opts(b)); // re-register
  check('re-enable: registered again', r.status === 'registered', r.status);
  check('re-enable: no second toast', r.showToast === false);
}

// 9. Version bump: changed bundled script content is re-copied even when settings already current.
{
  const b = sandbox();
  reconcileClaudeHook(opts(b));
  fs.writeFileSync(b.scriptSource, '# bundled hook v2 — updated\n', 'utf-8');
  const r = reconcileClaudeHook(opts(b));
  const onDisk = fs.readFileSync(path.join(b.claudeDir, 'hooks', HOOK_SCRIPT_NAME), 'utf-8');
  check('version-bump: script refreshed on disk', onDisk.includes('v2'));
  check('version-bump: settings unchanged (already-current)', r.status === 'already-current');
}

// 10. Fresh entries run the script with -ExecutionPolicy Bypass (a stock Windows
//     machine's Restricted policy refused the plain -File form, 2026-10-29).
{
  const b = sandbox();
  reconcileClaudeHook(opts(b));
  const s = readSettings(b.claudeDir);
  const args = groupsFor(s, 'UserPromptSubmit')[0]?.hooks?.[0]?.args ?? [];
  const scriptDest = path.join(b.claudeDir, 'hooks', HOOK_SCRIPT_NAME);
  check('bypass: fresh args are -NoProfile -ExecutionPolicy Bypass -File <script>',
    JSON.stringify(args) === JSON.stringify(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptDest]),
    JSON.stringify(args));
}

// 11. Upgrade: entries from 0.9.x (no -ExecutionPolicy) are rewritten in place,
//     keeping their matcher and command, without duplicating and without a toast.
{
  const b = sandbox();
  const scriptDest = path.join(b.claudeDir, 'hooks', HOOK_SCRIPT_NAME);
  const old = (matcher: string) => [{ matcher, hooks: [{ type: 'command', command: 'powershell', args: ['-NoProfile', '-File', scriptDest] }] }];
  const userStop = { matcher: '', hooks: [{ type: 'command', command: 'pwsh', args: ['-File', 'C:\\mine\\my-hook.ps1'] }] };
  fs.writeFileSync(path.join(b.claudeDir, 'settings.json'), JSON.stringify({
    hooks: {
      SessionStart: old(''), UserPromptSubmit: old(''), Notification: old('permission_prompt'),
      Stop: [...old(''), userStop], PreCompact: old(''),
    },
  }, null, 2), 'utf-8');
  fs.writeFileSync(b.prefsPath, JSON.stringify({ claudeNotifications: 'enabled', claudeHookToastShown: true }), 'utf-8');
  const r = reconcileClaudeHook(opts(b));
  const s = readSettings(b.claudeDir);
  check('upgrade: status upgraded, changed, no toast', r.status === 'upgraded' && r.changed && !r.showToast, r.status);
  check('upgrade: every event now passes Bypass',
    ['SessionStart', 'UserPromptSubmit', 'Notification', 'Stop', 'PreCompact'].every((e) =>
      groupsFor(s, e).filter((g: any) => hasOurEntry({ hooks: { [e]: [g] } }, e))
        .every((g: any) => g.hooks[0].args.includes('Bypass'))));
  check('upgrade: command kept as it was', groupsFor(s, 'Stop')[0].hooks[0].command === 'powershell');
  check('upgrade: Notification matcher kept', groupsFor(s, 'Notification')[0].matcher === 'permission_prompt');
  check('upgrade: no duplicates (Stop still has 2 groups)', groupsFor(s, 'Stop').length === 2);
  check('upgrade: the user\'s own Stop hook untouched',
    JSON.stringify(groupsFor(s, 'Stop')[1]) === JSON.stringify(userStop));
  const r2 = reconcileClaudeHook(opts(b));
  check('upgrade: second run is already-current', r2.status === 'already-current' && !r2.changed, r2.status);
}

// 12. A hand-written entry that already passes -ExecutionPolicy (Aryan's own,
//     with a full path to powershell.exe) is left byte-for-byte alone.
{
  const b = sandbox();
  const scriptDest = path.join(b.claudeDir, 'hooks', HOOK_SCRIPT_NAME);
  const mine = (matcher: string) => [{ matcher, hooks: [{ type: 'command', command: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptDest] }] }];
  const settings = { hooks: { SessionStart: mine(''), UserPromptSubmit: mine(''), Notification: mine('permission_prompt'), Stop: mine(''), PreCompact: mine('') } };
  const sp = path.join(b.claudeDir, 'settings.json');
  fs.writeFileSync(sp, JSON.stringify(settings, null, 2), 'utf-8');
  const before = fs.readFileSync(sp, 'utf-8');
  const r = reconcileClaudeHook(opts(b));
  check('hand-written: already-current', r.status === 'already-current', r.status);
  check('hand-written: file untouched', fs.readFileSync(sp, 'utf-8') === before);
}

// 13. 'command' mode (set by the setup check when -File is blocked even with
//     Bypass): every entry of ours, Bypass ones included, is rewritten to run the
//     script's text, and stays recognised as ours afterwards.
{
  const b = sandbox();
  reconcileClaudeHook(opts(b)); // file mode first
  fs.writeFileSync(b.prefsPath, JSON.stringify({ claudeNotifications: 'enabled', claudeHookToastShown: true, claudeHookMode: 'command' }), 'utf-8');
  const r = reconcileClaudeHook(opts(b));
  const s = readSettings(b.claudeDir);
  const args = groupsFor(s, 'Stop')[0].hooks[0].args;
  check('command mode: upgraded', r.status === 'upgraded', r.status);
  check('command mode: args run the script text',
    args[1] === '-Command' && args[2].includes('Invoke-Expression') && args[2].includes(HOOK_SCRIPT_NAME), JSON.stringify(args));
  check('command mode: still one entry of ours per event', groupsFor(s, 'Stop').length === 1);
  const r2 = reconcileClaudeHook(opts(b));
  check('command mode: rerun already-current', r2.status === 'already-current', r2.status);
}

// 14. The opt-out removes only afterterm's own hook from a group. A group that also
//     holds another tool's hook keeps that hook and the group's matcher; before this,
//     the whole group went and the other tool's hook with it (2026-11-07).
{
  const b = sandbox();
  const scriptDest = path.join(b.claudeDir, 'hooks', HOOK_SCRIPT_NAME);
  const ours = { type: 'command', command: 'pwsh', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptDest] };
  const theirs = { type: 'command', command: 'pwsh', args: ['-File', 'C:\\mine\\my-hook.ps1'] };
  const shared = { matcher: 'permission_prompt', hooks: [ours, theirs] };
  const onlyOurs = { matcher: '', hooks: [ours] };
  const onlyTheirs = { matcher: 'Bash', hooks: [{ type: 'command', command: 'node', args: ['other-tool.js'] }] };
  const settings = {
    permissions: { defaultMode: 'auto' },
    hooks: {
      Notification: [shared],                // afterterm's hook shares a group with another tool's
      Stop: [onlyOurs, onlyTheirs],          // a group of only ours beside another tool's own group
      SessionStart: [onlyOurs],              // nothing left after the opt-out
      PreToolUse: [onlyTheirs],              // no hook of ours anywhere in this event
    },
  };
  fs.writeFileSync(path.join(b.claudeDir, 'settings.json'), JSON.stringify(settings, null, 2), 'utf-8');
  fs.writeFileSync(b.prefsPath, JSON.stringify({ claudeNotifications: 'disabled' }), 'utf-8');
  const r = reconcileClaudeHook(opts(b));
  const s = readSettings(b.claudeDir);
  check('shared group: status removed and written', r.status === 'removed' && r.changed, r.status);
  check('shared group: afterterm hook is gone', !hasOurEntry(s, 'Notification'));
  check('shared group: the other tool\'s hook is kept',
    groupsFor(s, 'Notification').length === 1 &&
    JSON.stringify(groupsFor(s, 'Notification')[0].hooks) === JSON.stringify([theirs]),
    JSON.stringify(groupsFor(s, 'Notification')));
  check('shared group: the group keeps its matcher', groupsFor(s, 'Notification')[0]?.matcher === 'permission_prompt');
  check('only-ours group: removed, and the event key with it when nothing is left',
    !('SessionStart' in s.hooks), JSON.stringify(s.hooks));
  check('only-ours group: beside another tool\'s group, only ours goes',
    groupsFor(s, 'Stop').length === 1 && JSON.stringify(groupsFor(s, 'Stop')[0]) === JSON.stringify(onlyTheirs));
  check('another tool\'s group in an event of its own is untouched',
    JSON.stringify(groupsFor(s, 'PreToolUse')) === JSON.stringify([onlyTheirs]));
  check('other settings kept', s.permissions?.defaultMode === 'auto');
  const r2 = reconcileClaudeHook(opts(b));
  check('shared group: a second opt-out run finds nothing to remove', r2.status === 'disabled-noop' && !r2.changed, r2.status);
}

// 15. Opt-out with nothing of ours to remove writes nothing: no hooks key, hooks
//     of other tools only, and no settings file at all. The files are laid out in a
//     way JSON.stringify would not reproduce, so any rewrite shows.
{
  const cases: { name: string; text: string | null }[] = [
    { name: 'no hooks key', text: '{"permissions":{"defaultMode":"auto"}}' },
    { name: 'hooks of another tool only', text: '{"hooks":{"Stop":[{"matcher":"","hooks":[{"type":"command","command":"node","args":["other-tool.js"]}]}],"Empty":[]}}' },
    { name: 'no settings file', text: null },
  ];
  for (const c of cases) {
    const b = sandbox();
    const sp = path.join(b.claudeDir, 'settings.json');
    if (c.text !== null) fs.writeFileSync(sp, c.text, 'utf-8');
    fs.writeFileSync(b.prefsPath, JSON.stringify({ claudeNotifications: 'disabled' }), 'utf-8');
    const r = reconcileClaudeHook(opts(b));
    check(`opt-out, ${c.name}: disabled-noop, nothing changed`, r.status === 'disabled-noop' && !r.changed, r.status);
    check(`opt-out, ${c.name}: file not written`,
      c.text === null ? !fs.existsSync(sp) : fs.readFileSync(sp, 'utf-8') === c.text);
  }
}

// 16. A test launch leaves the Claude folder alone (hookReconcileAllowed): reconcile
//     may run unless AFTERTERM_USER_DATA_DIR is set without CLAUDE_CONFIG_DIR.
{
  check('launch rule: neither set (a normal launch) runs reconcile', hookReconcileAllowed({}) === true);
  check('launch rule: only CLAUDE_CONFIG_DIR set (the sandbox build) runs reconcile',
    hookReconcileAllowed({ CLAUDE_CONFIG_DIR: 'C:\\scratch\\claude' }) === true);
  check('launch rule: both set (a test launch with its own Claude folder) runs reconcile',
    hookReconcileAllowed({ AFTERTERM_USER_DATA_DIR: 'C:\\scratch\\data', CLAUDE_CONFIG_DIR: 'C:\\scratch\\claude' }) === true);
  check('launch rule: only AFTERTERM_USER_DATA_DIR set (a test launch on the real folder) skips reconcile',
    hookReconcileAllowed({ AFTERTERM_USER_DATA_DIR: 'C:\\scratch\\data' }) === false);
  check('launch rule: empty values count as not set',
    hookReconcileAllowed({ AFTERTERM_USER_DATA_DIR: '', CLAUDE_CONFIG_DIR: '' }) === true &&
    hookReconcileAllowed({ AFTERTERM_USER_DATA_DIR: 'C:\\scratch\\data', CLAUDE_CONFIG_DIR: '' }) === false);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);

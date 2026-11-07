// Unit tests for reconcileClaudeHook — run directly on Node 24+ (strips types):
//   node src/claude-hook-install.test.ts
// Exits 0 if all pass, 1 on any failure.

import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  reconcileClaudeHook,
  hookReconcileAllowed,
  needsHookRepair,
  hookRepairWait,
  HOOK_REPAIR_LIMIT,
  HOOK_REPAIR_WINDOW_MS,
  HOOK_SCRIPT_NAME,
} from './claude-hook-install.ts';

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

// 15b. Opt out on a group shared with another tool, then opt back in: afterterm's hook
//      comes back as its own group with the same matcher, the other tool's hook is
//      still there, and the next run has nothing to do.
{
  const b = sandbox();
  reconcileClaudeHook(opts(b)); // register first
  const s0 = readSettings(b.claudeDir);
  const theirs = { type: 'command', command: 'pwsh', args: ['-File', 'C:\\mine\\my-hook.ps1'] };
  const ourGroup = groupsFor(s0, 'Notification')[0];
  ourGroup.hooks.push(theirs); // the other tool's hook shares afterterm's group
  fs.writeFileSync(path.join(b.claudeDir, 'settings.json'), JSON.stringify(s0, null, 2), 'utf-8');
  fs.writeFileSync(b.prefsPath, JSON.stringify({ claudeNotifications: 'disabled', claudeHookToastShown: true }), 'utf-8');
  reconcileClaudeHook(opts(b)); // opt out
  fs.writeFileSync(b.prefsPath, JSON.stringify({ claudeNotifications: 'enabled', claudeHookToastShown: true }), 'utf-8');
  const r = reconcileClaudeHook(opts(b)); // opt back in
  const s = readSettings(b.claudeDir);
  const groups = groupsFor(s, 'Notification');
  const ours = groups.filter((g: any) => hasOurEntry({ hooks: { Notification: [g] } }, 'Notification'));
  const others = groups.filter((g: any) => g.hooks?.some((h: any) => JSON.stringify(h) === JSON.stringify(theirs)));
  check('re-enable after a shared group: registered again, no toast', r.status === 'registered' && !r.showToast, r.status);
  check('re-enable after a shared group: afterterm\'s hook is its own group again, same matcher',
    ours.length === 1 && ours[0].hooks.length === 1 && ours[0].matcher === 'permission_prompt', JSON.stringify(groups));
  check('re-enable after a shared group: the other tool\'s hook is still there, in its own group',
    others.length === 1 && others[0] !== ours[0] && others[0].hooks.length === 1 && others[0].matcher === 'permission_prompt',
    JSON.stringify(groups));
  const r2 = reconcileClaudeHook(opts(b));
  check('re-enable after a shared group: the next run is already-current', r2.status === 'already-current' && !r2.changed, r2.status);
}

// 15c. An opt-out that removes ours leaves an unrelated empty event key as it was.
{
  const b = sandbox();
  reconcileClaudeHook(opts(b)); // register first
  const s0 = readSettings(b.claudeDir);
  s0.hooks.Empty = [];
  fs.writeFileSync(path.join(b.claudeDir, 'settings.json'), JSON.stringify(s0, null, 2), 'utf-8');
  fs.writeFileSync(b.prefsPath, JSON.stringify({ claudeNotifications: 'disabled', claudeHookToastShown: true }), 'utf-8');
  const r = reconcileClaudeHook(opts(b));
  const s = readSettings(b.claudeDir);
  check('empty key: the opt-out removed ours', r.status === 'removed', r.status);
  check('empty key: an unrelated empty event key is kept',
    'Empty' in (s.hooks ?? {}) && Array.isArray(s.hooks.Empty) && s.hooks.Empty.length === 0, JSON.stringify(s.hooks));
  check('empty key: events that held only ours are gone', !('Stop' in s.hooks) && !('SessionStart' in s.hooks));
}

// 15d. The same in command mode (claudeHookMode "command" in prefs): afterterm's hook
//      then carries the script's name inside a -Command text, and the opt-out still
//      removes only that hook from a group shared with another tool.
{
  const b = sandbox();
  fs.writeFileSync(b.prefsPath, JSON.stringify({ claudeNotifications: 'enabled', claudeHookToastShown: true, claudeHookMode: 'command' }), 'utf-8');
  reconcileClaudeHook(opts(b)); // registers in command mode
  const s0 = readSettings(b.claudeDir);
  const theirs = { type: 'command', command: 'pwsh', args: ['-File', 'C:\\mine\\my-hook.ps1'] };
  const shared = groupsFor(s0, 'Stop')[0];
  const wasCommandMode = shared.hooks[0].args[1] === '-Command';
  shared.hooks.push(theirs); // the other tool's hook shares afterterm's group
  fs.writeFileSync(path.join(b.claudeDir, 'settings.json'), JSON.stringify(s0, null, 2), 'utf-8');
  fs.writeFileSync(b.prefsPath, JSON.stringify({ claudeNotifications: 'disabled', claudeHookToastShown: true, claudeHookMode: 'command' }), 'utf-8');
  const r = reconcileClaudeHook(opts(b));
  const s = readSettings(b.claudeDir);
  check('command mode, shared group: the entry really was in command mode', wasCommandMode);
  check('command mode, shared group: the opt-out removed ours', r.status === 'removed' && r.changed, r.status);
  check('command mode, shared group: afterterm\'s hook is gone from every event',
    ['SessionStart', 'UserPromptSubmit', 'Notification', 'Stop', 'PreCompact'].every((e) => !hasOurEntry(s, e)) &&
    !JSON.stringify(s).includes(HOOK_SCRIPT_NAME));
  check('command mode, shared group: the other tool\'s hook is kept, the group keeps its matcher',
    groupsFor(s, 'Stop').length === 1 &&
    JSON.stringify(groupsFor(s, 'Stop')[0].hooks) === JSON.stringify([theirs]) &&
    groupsFor(s, 'Stop')[0].matcher === '',
    JSON.stringify(groupsFor(s, 'Stop')));
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

// 17. needsHookRepair: the check main's settings.json watch runs after each change,
//     to put afterterm's entries back while the app runs (Fix 4).
{
  const ALL = ['SessionStart', 'UserPromptSubmit', 'Notification', 'Stop', 'PreCompact'];
  const enabled = { claudeNotifications: 'enabled' as const };
  // A complete settings file, as reconcile writes it, beside other settings.
  const b = sandbox();
  fs.writeFileSync(path.join(b.claudeDir, 'settings.json'), JSON.stringify({ permissions: { defaultMode: 'auto' } }), 'utf-8');
  reconcileClaudeHook(opts(b));
  const complete = readSettings(b.claudeDir);
  const text = (obj: unknown) => JSON.stringify(obj, null, 2);
  const without = (...events: string[]) => {
    const s = structuredClone(complete);
    for (const e of events) delete s.hooks[e];
    return s;
  };

  const all = needsHookRepair(text(complete), enabled);
  check('repair check: all five present, no repair', !all.repair && all.missing.length === 0, JSON.stringify(all));
  check('repair check: no prefs file ({}) counts as enabled', !needsHookRepair(text(complete), {}).repair);

  const one = needsHookRepair(text(without('Stop')), enabled);
  check('repair check: one event missing, repair', one.repair, JSON.stringify(one));
  check('repair check: one event missing, names only that event',
    JSON.stringify(one.missing) === JSON.stringify(['Stop']), JSON.stringify(one.missing));
  check('repair check: the reason names the missing event', one.reason.includes('Stop'), one.reason);

  const noHooks = structuredClone(complete);
  delete noHooks.hooks;
  const nh = needsHookRepair(text(noHooks), enabled);
  check('repair check: hooks key missing, repair with all five missing',
    nh.repair && JSON.stringify(nh.missing) === JSON.stringify(ALL), JSON.stringify(nh));
  const nullHooks = needsHookRepair(text({ ...noHooks, hooks: null }), enabled);
  check('repair check: hooks null, repair (reconcile treats it as no hooks)', nullHooks.repair, JSON.stringify(nullHooks));

  const gone = needsHookRepair(null, enabled);
  check('repair check: settings.json missing, repair when enabled',
    gone.repair && JSON.stringify(gone.missing) === JSON.stringify(ALL), JSON.stringify(gone));

  // A byte order mark counts as not valid JSON, as it does for reconcile's own reader.
  const badFiles: [string, string][] = [
    ['garbage', '{ this is : not json ]'],
    ['an empty file', ''],
    ['a byte order mark first', '\uFEFF' + text(complete)],
  ];
  for (const [name, bad] of badFiles) {
    const r = needsHookRepair(bad, enabled);
    check(`repair check: settings.json not valid JSON (${name}), left alone`, !r.repair, JSON.stringify(r));
  }

  for (const shape of ['[]', 'null', '42', '"text"']) {
    const r = needsHookRepair(shape, enabled);
    check(`repair check: settings.json is ${shape}, not an object, left alone`, !r.repair, JSON.stringify(r));
  }
  for (const hooks of [[], 'text', 3]) {
    const r = needsHookRepair(JSON.stringify({ hooks }), enabled);
    check(`repair check: hooks is ${JSON.stringify(hooks)}, not an object, left alone`, !r.repair, JSON.stringify(r));
  }

  const disabled = { claudeNotifications: 'disabled' as const };
  check('repair check: opted out, no repair even with every entry missing',
    !needsHookRepair(text(noHooks), disabled).repair);
  check('repair check: opted out, no repair when settings.json is missing',
    !needsHookRepair(null, disabled).repair);
  check('repair check: opted out, no repair when one event is missing',
    !needsHookRepair(text(without('Notification')), disabled).repair);
  check('repair check: prefs.json not valid JSON (null), no repair',
    !needsHookRepair(text(noHooks), null).repair && !needsHookRepair(null, null).repair);

  const theirs = { matcher: '', hooks: [{ type: 'command', command: 'node', args: ['other-tool.js'] }] };
  const otherOnly = { hooks: { Stop: [theirs], SessionStart: [theirs] } };
  const oo = needsHookRepair(JSON.stringify(otherOnly), enabled);
  check('repair check: another tool\'s groups only, repair with all five missing',
    oo.repair && JSON.stringify(oo.missing) === JSON.stringify(ALL), JSON.stringify(oo));

  const notArray = structuredClone(complete);
  notArray.hooks.Stop = { matcher: '' };
  const na = needsHookRepair(text(notArray), enabled);
  check('repair check: an event that is not a list counts as missing',
    na.repair && JSON.stringify(na.missing) === JSON.stringify(['Stop']), JSON.stringify(na));

  const shared = structuredClone(complete);
  shared.hooks.Stop[0].hooks.push(theirs.hooks[0]);
  check('repair check: afterterm\'s hook in a group shared with another tool counts as present',
    !needsHookRepair(text(shared), enabled).repair);

  const c = sandbox();
  fs.writeFileSync(c.prefsPath, JSON.stringify({ claudeNotifications: 'enabled', claudeHookMode: 'command' }), 'utf-8');
  reconcileClaudeHook(opts(c));
  const commandMode = readSettings(c.claudeDir);
  check('repair check: entries in command mode count as present',
    commandMode.hooks.Stop[0].hooks[0].args[1] === '-Command' &&
    !needsHookRepair(text(commandMode), enabled).repair);
}

// 18. No loop: from every starting point the check repairs, one reconcile leaves a
//     file the check is happy with, and the reconcile after that writes nothing.
{
  const theirs = { matcher: 'Bash', hooks: [{ type: 'command', command: 'node', args: ['other-tool.js'] }] };
  const starts: { name: string; settings: unknown | null }[] = [
    { name: 'no settings file', settings: null },
    { name: 'no hooks key', settings: { model: 'opus' } },
    { name: 'another tool\'s groups only', settings: { hooks: { Stop: [theirs], PreToolUse: [theirs] } } },
    { name: 'an event that is not a list', settings: { hooks: { Stop: { matcher: '' } } } },
  ];
  for (const st of starts) {
    const b = sandbox();
    const sp = path.join(b.claudeDir, 'settings.json');
    if (st.settings !== null) fs.writeFileSync(sp, JSON.stringify(st.settings, null, 2), 'utf-8');
    fs.writeFileSync(b.prefsPath, JSON.stringify({ claudeNotifications: 'enabled', claudeHookToastShown: true }), 'utf-8');
    const before = needsHookRepair(st.settings === null ? null : fs.readFileSync(sp, 'utf-8'), { claudeNotifications: 'enabled' });
    reconcileClaudeHook(opts(b));
    const after = needsHookRepair(fs.readFileSync(sp, 'utf-8'), { claudeNotifications: 'enabled' });
    const written = fs.readFileSync(sp, 'utf-8');
    const again = reconcileClaudeHook(opts(b));
    check(`no loop, ${st.name}: the check asked for a repair`, before.repair, JSON.stringify(before));
    check(`no loop, ${st.name}: after one reconcile the check finds nothing to do`, !after.repair, JSON.stringify(after));
    check(`no loop, ${st.name}: the next reconcile writes nothing`,
      again.status === 'already-current' && !again.changed && fs.readFileSync(sp, 'utf-8') === written, again.status);
  }
  // The other tool's groups are still there, untouched, after the repair.
  const b = sandbox();
  const sp = path.join(b.claudeDir, 'settings.json');
  fs.writeFileSync(sp, JSON.stringify({ hooks: { Stop: [theirs], PreToolUse: [theirs] } }, null, 2), 'utf-8');
  reconcileClaudeHook(opts(b));
  const s = readSettings(b.claudeDir);
  check('no loop, another tool\'s groups: kept as they were, ours added beside them',
    JSON.stringify(groupsFor(s, 'Stop')[0]) === JSON.stringify(theirs) && groupsFor(s, 'Stop').length === 2 &&
    JSON.stringify(groupsFor(s, 'PreToolUse')) === JSON.stringify([theirs]) && hasOurEntry(s, 'Stop'),
    JSON.stringify(s.hooks));
}

// 19. The repair path end to end, without a watcher: reconcile writes a complete
//     file, the hooks key is deleted by hand, the check asks for a repair, and a
//     second reconcile puts all five entries back with nothing else changed.
{
  const b = sandbox();
  const sp = path.join(b.claudeDir, 'settings.json');
  fs.writeFileSync(sp, JSON.stringify({ permissions: { defaultMode: 'auto', allow: ['Bash(ls)'] }, model: 'opus' }, null, 2), 'utf-8');
  reconcileClaudeHook(opts(b)); // the launch reconcile
  const complete = fs.readFileSync(sp, 'utf-8');
  const prefs = JSON.parse(fs.readFileSync(b.prefsPath, 'utf-8'));
  check('end to end: the launch reconcile left a complete file', !needsHookRepair(complete, prefs).repair);

  const stripped = JSON.parse(complete);
  delete stripped.hooks; // what the test launch's opt-out did to the real file on 2026-11-06
  fs.writeFileSync(sp, JSON.stringify(stripped, null, 2) + '\n', 'utf-8');
  const check1 = needsHookRepair(fs.readFileSync(sp, 'utf-8'), JSON.parse(fs.readFileSync(b.prefsPath, 'utf-8')));
  check('end to end: the check asks for a repair of all five',
    check1.repair && check1.missing.length === 5, JSON.stringify(check1));

  const r = reconcileClaudeHook(opts(b)); // the repair
  const repaired = fs.readFileSync(sp, 'utf-8');
  const s = JSON.parse(repaired);
  check('end to end: repair registered and wrote, no toast', r.status === 'registered' && r.changed && !r.showToast, r.status);
  check('end to end: all five entries are back',
    ['SessionStart', 'UserPromptSubmit', 'Notification', 'Stop', 'PreCompact'].every((e) => hasOurEntry(s, e)));
  check('end to end: the file is exactly as the launch reconcile left it', repaired === complete);
  check('end to end: other settings untouched',
    s.model === 'opus' && JSON.stringify(s.permissions) === JSON.stringify({ defaultMode: 'auto', allow: ['Bash(ls)'] }));
  check('end to end: the next check finds nothing to do',
    !needsHookRepair(repaired, JSON.parse(fs.readFileSync(b.prefsPath, 'utf-8'))).repair);
}

// 20. hookRepairWait, the guard against a repair loop: at most HOOK_REPAIR_LIMIT
//     repairs within HOOK_REPAIR_WINDOW_MS.
{
  const W = HOOK_REPAIR_WINDOW_MS;
  const now = 10 * W;
  check('loop guard: no earlier repairs, repair now', hookRepairWait([], now) === 0);
  check('loop guard: fewer than the limit in the window, repair now',
    hookRepairWait(Array.from({ length: HOOK_REPAIR_LIMIT - 1 }, (_, i) => now - 1000 * (i + 1)), now) === 0);
  const full = Array.from({ length: HOOK_REPAIR_LIMIT }, (_, i) => now - 10_000 * (i + 1));
  const oldest = Math.min(...full);
  check('loop guard: the limit reached, wait until the oldest leaves the window',
    hookRepairWait(full, now) === oldest + W - now, String(hookRepairWait(full, now)));
  check('loop guard: once the oldest has left the window, repair again',
    hookRepairWait(full, oldest + W) === 0);
  check('loop guard: repairs older than the window do not count',
    hookRepairWait(Array.from({ length: HOOK_REPAIR_LIMIT + 2 }, (_, i) => now - W - 1 - i), now) === 0);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);

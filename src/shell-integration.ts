// Shell integration (Phase 6): the OSC 133 prompt marks and OSC 9;9 cwd report,
// extended from cmd.exe (Phase 5) to pwsh, Windows PowerShell, Git Bash and WSL.
//
// This module is pure: it plans a spawn (command, args, cwd, env) from inputs the
// caller already has, and does no I/O of its own besides the caller-supplied
// dirExists predicate. main.ts is the only caller and owns the actual pty.spawn.
//
// The renderer already parses OSC 9;9 (a Windows path report) and OSC 133 A/B
// (prompt start/end, used for last-command capture). Every shell here is made to
// emit the same two things around its own prompt, so the renderer needs no
// per-shell knowledge.

import { isWslUncPath, wslUncToLinux } from './shell-paths.ts';

// ─── Opt-out ──────────────────────────────────────────────────────────────────

// prefs.json may hold `shellIntegration: { <shellId>: 'on' | 'off' }`. Anything
// but an explicit 'off' for this shell id, including a missing key or a prefs
// object that is not shaped as expected, leaves integration on.
export function integrationEnabled(prefs: unknown, shellId: string): boolean {
  if (!prefs || typeof prefs !== 'object') return true;
  const si = (prefs as { shellIntegration?: unknown }).shellIntegration;
  if (!si || typeof si !== 'object') return true;
  return (si as Record<string, unknown>)[shellId] !== 'off';
}

// ─── cmd: the marked PROMPT ──────────────────────────────────────────────────

// What afterterm wraps round a cmd prompt ($E is ESC in PROMPT syntax): OSC 133;A
// (prompt start), then OSC 9;9 with the cwd (cmd's own $P), before the user's own
// visible prompt, and OSC 133;B (prompt end) after it. The wrap and the strip below
// both build on these two constants, so they cannot drift apart: the strip finds
// afterterm's marks by exactly what the wrap writes.
export const CMD_MARK_START = '$E]133;A$E\\$E]9;9;$P$E\\';
export const CMD_MARK_END = '$E]133;B$E\\';

export function wrapCmdPrompt(visible: string): string {
  return CMD_MARK_START + visible + CMD_MARK_END;
}

// The user's own prompt, recovered from a PROMPT that carries afterterm's marks
// (one wrap or several). A PROMPT reaches a cmd thread already marked when afterterm
// is launched from a cmd thread of another afterterm: the launching shell's PROMPT
// is inherited by the new app and every shell it starts. Marks are recognised by
// CMD_MARK_START, whose 133;A followed at once by the cwd report is afterterm's own
// signature; a PROMPT without it is returned as it came, so a user's own OSC 9;9 or
// 133 text (the Windows Terminal recipe, for one) is never touched. Whatever the user
// added around the marks (for example `set PROMPT=%PROMPT%> `) is kept.
export function stripCmdPromptMarks(prompt: string): string {
  if (!prompt.includes(CMD_MARK_START)) return prompt;
  let out = prompt;
  while (out.includes(CMD_MARK_START)) out = out.split(CMD_MARK_START).join('');
  return out.split(CMD_MARK_END).join('');
}

// ─── PowerShell (pwsh and Windows PowerShell) ───────────────────────────────

// Wraps the prompt function once, so it runs after the user's own profile has had
// a chance to set one. Verified on PowerShell 7.6 and Windows PowerShell 5.1, so
// it deliberately avoids anything PowerShell-7-only.
//
// No banner: a shell started with a command (afterterm's -EncodedCommand,
// same as any other) prints no startup banner at all. VS Code's shell
// integration injects its script into PowerShell the same way and shows no
// banner either, so afterterm follows that rather than trying to reproduce
// PowerShell's own banner text. No banner text lives in afterterm.
//
// The Write-Error trick: by the time the wrapped prompt gets to call the user's
// original prompt function, $? has already been overwritten to $true by the string
// building above (any successful expression resets it). If the command the user
// actually ran had failed, the original prompt (which may print its own [$?]-style
// indicator, e.g. starship) needs to see that failure again, so a non-terminating,
// suppressed error is raised first to flip $? back to $false before handing off.
export const PWSH_BOOTSTRAP = `if ($global:__AftertermPromptWrapped) { return }
$global:__AftertermPromptWrapped = $true
if ($null -eq $function:prompt) {
  $global:__AftertermOriginalPrompt = { "PS $($executionContext.SessionState.Path.CurrentLocation)$('>' * ($nestedPromptLevel + 1)) " }
} else {
  $global:__AftertermOriginalPrompt = $function:prompt
}
function global:prompt {
  $__aftertermOk = $global:?
  $esc = [char]27
  $out = "$esc]133;A$esc\\"
  if ($PWD.Provider.Name -eq 'FileSystem') {
    $out += "$esc]9;9;$($PWD.ProviderPath)$esc\\"
  }
  if (-not $__aftertermOk) {
    Write-Error 'afterterm: restoring $?' -ErrorAction Ignore
  }
  $out += (& $global:__AftertermOriginalPrompt) -join ''
  $out += "$esc]133;B$esc\\"
  return $out
}
`;

// Exactly what -EncodedCommand expects: base64 of the script text as UTF-16LE.
export function pwshEncodedCommand(script: string = PWSH_BOOTSTRAP): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

// ─── Bash (Git Bash and WSL) ─────────────────────────────────────────────────

// Readable form of BASH_HOOK below (the exported constant is the same logic
// joined onto one line, since it also has to survive a trip through WSLENV,
// which cannot carry a newline). Trace through this copy when changing the hook.
//
// __afterterm_precmd() {
//   if [ "$PS1" != "$__afterterm_wrapped_ps1" ]; then
//     __afterterm_original_ps1="$PS1"
//     PS1='\[\e]133;A\e\\\]'"$__afterterm_original_ps1"'\[\e]133;B\e\\\]'
//     __afterterm_wrapped_ps1="$PS1"
//   fi
//   if [ -n "$WSL_DISTRO_NAME" ]; then
//     printf '\033]7;file://%s%s\033\\' "$WSL_DISTRO_NAME" "$PWD"
//   else
//     case "$PWD" in
//       /?)
//         __afterterm_d="${PWD:1:1}"
//         __afterterm_win="${__afterterm_d^^}:\\"
//         ;;
//       /?/*)
//         __afterterm_d="${PWD:1:1}"
//         __afterterm_rest="${PWD:3}"
//         __afterterm_win="${__afterterm_d^^}:\\${__afterterm_rest//\//\\}"
//         ;;
//       *)
//         __afterterm_w="$(pwd -W 2>/dev/null)"
//         if [ -n "$__afterterm_w" ]; then
//           __afterterm_win="${__afterterm_w//\//\\}"
//         else
//           __afterterm_win=""
//         fi
//         ;;
//     esac
//     if [ -n "$__afterterm_win" ]; then
//       printf '\033]9;9;%s\033\\' "$__afterterm_win"
//     fi
//   fi
// }
// if [ -z "$__afterterm_installed" ]; then
//   __afterterm_installed=1
//   __afterterm_bootstrap='eval "$AFTERTERM_BASH_HOOK" 2>/dev/null || unset PROMPT_COMMAND'
//   if declare -p PROMPT_COMMAND 2>/dev/null | grep -q '^declare -a'; then
//     __afterterm_new=()
//     for __afterterm_item in "${PROMPT_COMMAND[@]}"; do
//       case "$__afterterm_item" in
//         *"$__afterterm_bootstrap"*) __afterterm_new+=("__afterterm_precmd") ;;
//         *) __afterterm_new+=("$__afterterm_item") ;;
//       esac
//     done
//     PROMPT_COMMAND=("${__afterterm_new[@]}")
//   else
//     __afterterm_rest="${PROMPT_COMMAND//"$__afterterm_bootstrap"/}"
//     while [[ "$__afterterm_rest" == [\ \;]* ]]; do __afterterm_rest="${__afterterm_rest:1}"; done
//     while [[ "$__afterterm_rest" == *[\ \;] ]]; do __afterterm_rest="${__afterterm_rest%?}"; done
//     PROMPT_COMMAND="${__afterterm_rest:+$__afterterm_rest;}__afterterm_precmd"
//   fi
//   export -n PROMPT_COMMAND AFTERTERM_BASH_HOOK
//   __afterterm_precmd
// fi
export const BASH_HOOK =
  '__afterterm_precmd() { ' +
  'if [ "$PS1" != "$__afterterm_wrapped_ps1" ]; then ' +
  '__afterterm_original_ps1="$PS1"; ' +
  "PS1='\\[\\e]133;A\\e\\\\\\]'\"$__afterterm_original_ps1\"'\\[\\e]133;B\\e\\\\\\]'; " +
  '__afterterm_wrapped_ps1="$PS1"; ' +
  'fi; ' +
  'if [ -n "$WSL_DISTRO_NAME" ]; then ' +
  'printf \'\\033]7;file://%s%s\\033\\\\\' "$WSL_DISTRO_NAME" "$PWD"; ' +
  'else ' +
  'case "$PWD" in ' +
  '/?) __afterterm_d="${PWD:1:1}"; __afterterm_win="${__afterterm_d^^}:\\\\" ;; ' +
  '/?/*) __afterterm_d="${PWD:1:1}"; __afterterm_rest="${PWD:3}"; __afterterm_win="${__afterterm_d^^}:\\\\${__afterterm_rest//\\//\\\\}" ;; ' +
  '*) __afterterm_w="$(pwd -W 2>/dev/null)"; ' +
  'if [ -n "$__afterterm_w" ]; then __afterterm_win="${__afterterm_w//\\//\\\\}"; else __afterterm_win=""; fi ;; ' +
  'esac; ' +
  'if [ -n "$__afterterm_win" ]; then printf \'\\033]9;9;%s\\033\\\\\' "$__afterterm_win"; fi; ' +
  'fi; ' +
  '}; ' +
  'if [ -z "$__afterterm_installed" ]; then ' +
  '__afterterm_installed=1; ' +
  "__afterterm_bootstrap='eval \"$AFTERTERM_BASH_HOOK\" 2>/dev/null || unset PROMPT_COMMAND'; " +
  "if declare -p PROMPT_COMMAND 2>/dev/null | grep -q '^declare -a'; then " +
  '__afterterm_new=(); ' +
  'for __afterterm_item in "${PROMPT_COMMAND[@]}"; do ' +
  'case "$__afterterm_item" in ' +
  '*"$__afterterm_bootstrap"*) __afterterm_new+=("__afterterm_precmd") ;; ' +
  '*) __afterterm_new+=("$__afterterm_item") ;; ' +
  'esac; ' +
  'done; ' +
  'PROMPT_COMMAND=("${__afterterm_new[@]}"); ' +
  'else ' +
  '__afterterm_rest="${PROMPT_COMMAND//"$__afterterm_bootstrap"/}"; ' +
  'while [[ "$__afterterm_rest" == [\\ \\;]* ]]; do __afterterm_rest="${__afterterm_rest:1}"; done; ' +
  'while [[ "$__afterterm_rest" == *[\\ \\;] ]]; do __afterterm_rest="${__afterterm_rest%?}"; done; ' +
  'PROMPT_COMMAND="${__afterterm_rest:+$__afterterm_rest;}__afterterm_precmd"; ' +
  'fi; ' +
  'export -n PROMPT_COMMAND AFTERTERM_BASH_HOOK; ' +
  '__afterterm_precmd; ' +
  'fi';

// PROMPT_COMMAND itself, before installation: evaluate the hook (which installs
// itself and then unhooks this bootstrap), or drop PROMPT_COMMAND entirely if the
// hook text is somehow broken (safer than leaving a bad eval running forever).
// The installer above embeds this exact literal, so it can recognise and strip it
// out of PROMPT_COMMAND without needing it in an env var of its own.
export const BASH_BOOTSTRAP = 'eval "$AFTERTERM_BASH_HOOK" 2>/dev/null || unset PROMPT_COMMAND';

// The name of the function the installed hook leaves in PROMPT_COMMAND (the hook above
// defines it; a test checks BASH_HOOK still does).
export const BASH_PRECMD_FUNCTION = '__afterterm_precmd';

// PROMPT_COMMAND with afterterm's own entries taken back out: the bootstrap, and the
// installed hook's function. The hook unexports PROMPT_COMMAND once it has installed,
// so a launching shell normally passes none of this on; it can when the user exports
// PROMPT_COMMAND again or the bootstrap has not run yet. Whatever else the value
// holds is kept, with the same tidy-up of leading and trailing spaces and semicolons
// the hook's own installer does. A value with none of afterterm's text is returned as
// it came.
export function stripBashHook(promptCommand: string): string {
  if (!promptCommand.includes(BASH_BOOTSTRAP) && !promptCommand.includes(BASH_PRECMD_FUNCTION)) {
    return promptCommand;
  }
  const rest = promptCommand.split(BASH_BOOTSTRAP).join('').split(BASH_PRECMD_FUNCTION).join('');
  return rest.replace(/^[ ;]+|[ ;]+$/g, '');
}

// ─── WSL: WSLENV ─────────────────────────────────────────────────────────────

// Appends names to a WSLENV value (colon-separated), skipping ones already
// present and never producing a leading colon when there was nothing before.
export function appendWslEnv(existing: string | undefined, names: string[]): string {
  const parts = existing ? existing.split(':').filter(s => s.length > 0) : [];
  for (const name of names) {
    if (!parts.includes(name)) parts.push(name);
  }
  return parts.join(':');
}

// Documentation of which env keys carry the bash hook, and what WSLENV needs to
// forward across the Windows/WSL boundary.
export const SHELL_INTEGRATION_ENV_KEYS = ['PROMPT_COMMAND', 'AFTERTERM_BASH_HOOK'];

// ─── The planner ──────────────────────────────────────────────────────────────

export interface ShellProfileLike {
  id: string;
  command: string;
  args: string[];
}

export interface SpawnPlanInput {
  shell: ShellProfileLike;
  cwd: string | undefined;          // the tab's saved cwd, may be missing or stale
  home: string;                     // the fallback folder (USERPROFILE or C:\)
  env: Record<string, string>;      // the already-cleaned env main.ts built (AFTERTERM=1 etc. are in it)
  prefs: unknown;                   // the parsed prefs.json object, or undefined
  dirExists: (p: string) => boolean;
}

export interface SpawnPlan {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;      // a copy of input env with the integration keys added, or identical when off
  integration: boolean;             // whether the hook was injected
  cwdFallback: boolean;             // true when the requested cwd was not used
}

const KNOWN_SHELLS = new Set(['cmd', 'pwsh', 'powershell', 'gitbash', 'wsl']);

// The key an environment already holds a variable under, whatever its letter case
// (Windows ignores case, and a copy of process.env keeps the case it was set in), or
// the plain name when there is none.
function findEnvKey(env: Record<string, string>, name: string): string {
  const upper = name.toUpperCase();
  return Object.keys(env).find(k => k.toUpperCase() === upper) ?? name;
}

// A copy of env with afterterm's own shell integration taken back out of it, so that
// a shell does not receive the integration of the afterterm that launched this one:
//   PROMPT               the marks are stripped, the user's own prompt kept
//                        (removed when nothing else was in it)
//   PROMPT_COMMAND       the bash bootstrap and the installed hook's function are
//                        stripped, anything else kept
//   AFTERTERM_BASH_HOOK  removed (planSpawn sets it again where it belongs)
// AFTERTERM, AFTERTERM_TAB_ID and AFTERTERM_SESSION_DIR need nothing here: main.ts
// sets all three afresh for every shell. WSLENV is left alone, since it only names
// variables, and a name with no variable behind it forwards nothing.
export function withoutInheritedIntegration(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...env };
  for (const key of Object.keys(out)) {
    const value = out[key];
    if (typeof value !== 'string') continue;
    const upper = key.toUpperCase();
    if (upper === 'PROMPT') {
      const original = stripCmdPromptMarks(value);
      if (original === value) continue;
      if (original) out[key] = original; else delete out[key];
    } else if (key === 'PROMPT_COMMAND') {
      const original = stripBashHook(value);
      if (original === value) continue;
      if (original) out[key] = original; else delete out[key];
    } else if (key === 'AFTERTERM_BASH_HOOK') {
      delete out[key];
    }
  }
  return out;
}

export function planSpawn(input: SpawnPlanInput): SpawnPlan {
  const { shell, cwd, home, env, prefs, dirExists } = input;
  const known = KNOWN_SHELLS.has(shell.id);
  const enabled = known && integrationEnabled(prefs, shell.id);

  // A WSL UNC cwd, honoured only for the wsl shell itself: --cd takes the linux
  // path directly, so the pty's own cwd argument is just the home folder.
  const wslUnc = shell.id === 'wsl' && typeof cwd === 'string' ? wslUncToLinux(cwd) : null;

  let args = shell.args.slice();
  let dir: string;
  let cwdFallback: boolean;

  if (wslUnc) {
    args = ['-d', wslUnc.distro, '--cd', wslUnc.path];
    dir = home;
    cwdFallback = false;
  } else if (typeof cwd === 'string' && isWslUncPath(cwd)) {
    // A WSL UNC path this shell (or this distro's translation) cannot honour.
    // Never stat a \\wsl$\ path: it may be slow or the distro may not be running.
    dir = home;
    cwdFallback = true;
  } else if (typeof cwd === 'string' && dirExists(cwd)) {
    dir = cwd;
    cwdFallback = false;
  } else {
    dir = home;
    cwdFallback = true;
  }

  // Start from what afterterm itself inherited with its own integration taken out,
  // for every shell, then add what is on for this one. Without this, an afterterm
  // launched from a thread of another afterterm passes the launching shell's marked
  // PROMPT (and the like) down to every shell it starts: cmd would wrap the marks a
  // second time, and the opt-out would not hold because the marks are already there.
  const outEnv = withoutInheritedIntegration(env);

  if (shell.id === 'cmd' && enabled) {
    // OSC 133;A, then OSC 9;9 (the cwd, via cmd's own $P), then the user's own
    // visible prompt (or the default $P$G), then OSC 133;B. The user's own prompt is
    // what is left once any inherited marks are gone, so the wrap happens once.
    const promptKey = findEnvKey(outEnv, 'PROMPT');
    outEnv[promptKey] = wrapCmdPrompt(outEnv[promptKey] || '$P$G');
  } else if ((shell.id === 'pwsh' || shell.id === 'powershell') && enabled) {
    args = ['-NoExit', '-EncodedCommand', pwshEncodedCommand()];
  } else if (shell.id === 'gitbash' && enabled) {
    outEnv.PROMPT_COMMAND = BASH_BOOTSTRAP;
    outEnv.AFTERTERM_BASH_HOOK = BASH_HOOK;
  } else if (shell.id === 'wsl' && enabled) {
    outEnv.PROMPT_COMMAND = BASH_BOOTSTRAP;
    outEnv.AFTERTERM_BASH_HOOK = BASH_HOOK;
    outEnv.WSLENV = appendWslEnv(outEnv.WSLENV, SHELL_INTEGRATION_ENV_KEYS);
  }

  return {
    command: shell.command,
    args,
    cwd: dir,
    env: outEnv,
    integration: enabled,
    cwdFallback,
  };
}

# Shell integration: cwd reporting and prompt marks for every shell

Phase 5 gave cmd.exe two things at spawn: an OSC 9;9 cwd report and OSC 133 A/B prompt marks, both folded into its injected `PROMPT` environment variable. Every other shell profile afterterm offers, PowerShell 7 (pwsh), Windows PowerShell, Git Bash and WSL, had neither, which is why a thread in any of them never restored to the right folder after a relaunch, never showed a branch or worktree in the header, and never re-ran its command when a server thread woke up. This phase gives every shell the same two things cmd already had, each through whatever mechanism actually lands on that shell without disturbing a prompt the user already customised.

## What the user sees

A pwsh, Windows PowerShell, Git Bash or WSL thread now behaves exactly like a cmd thread already did:

- A tab restores to the folder it was last in, not the user's home folder, across a relaunch.
- The header shows the git branch and worktree for whatever folder the shell is actually in, updating within a couple of seconds of a `cd`.
- A server started in any of these shells is named by the command that started it, shows its port, offers "Open localhost:port", and re-types that same command when the thread wakes from sleep, all exactly as already described in `docs/features-servers.md` for cmd.
- Nothing about how the shell looks or behaves changes. A custom prompt (oh-my-posh, starship, a hand-rolled `PS1` or PowerShell `prompt` function) still renders exactly as before; the integration works around it, not over it.
- The one exception is WSL, whose coverage on this development machine is unit-tested logic only: WSL itself is not installed, so nothing here has actually been driven end to end inside a real distro.

## One pure planner decides every spawn

Every shell used to have its own scattered injection logic; Phase 6 moved all of it into one pure module, `src/shell-integration.ts`, and its one function, `planSpawn`. Given the shell profile, the tab's saved cwd, the home folder to fall back to, the already-cleaned environment `main.ts` built, the parsed `prefs.json` object, and a `dirExists` predicate, it returns the exact command, args, cwd and env to spawn with. `pty:create` in `main.ts` calls it and only applies the result, nothing shell-specific left in `main.ts` itself, cmd's own `PROMPT` injection included, which simply moved into the planner unchanged. Being pure (no Electron, no `child_process`, the only I/O is the caller-supplied `dirExists`) is what makes it unit-testable on its own: `src/shell-integration.test.ts` checks every shell's plan directly, and its final section actually spawns real `pwsh.exe`, `powershell.exe` and Git Bash subprocesses to prove the injected script runs and the marks appear, not just that the generated string looks plausible.

## Mechanism per shell, and why

### cmd: unchanged

`$E]133;A$E\` before the visible prompt, `$E]9;9;$P$E\` (the cwd, through cmd's own `$P` token), then the user's own `PROMPT` (or the default `$P$G` when none is set), then `$E]133;B$E\`. This is exactly what Phase 5 built; it just lives in `planSpawn` now instead of inline in `main.ts`.

### pwsh and Windows PowerShell: a wrapped prompt function via `-EncodedCommand`

Both are spawned with `-NoExit -EncodedCommand <base64 of a bootstrap script, UTF-16LE>`. The bootstrap (`PWSH_BOOTSTRAP` in `shell-integration.ts`) runs after the user's own `$PROFILE` has already executed, so a profile that defines its own `prompt` function (oh-my-posh, starship, anything hand-written) sets it first, and the bootstrap wraps whatever it finds rather than replacing it outright:

```powershell
if ($global:__AftertermPromptWrapped) { return }
$global:__AftertermPromptWrapped = $true
if ($null -eq $function:prompt) {
  $global:__AftertermOriginalPrompt = { "PS $($executionContext.SessionState.Path.CurrentLocation)$('>' * ($nestedPromptLevel + 1)) " }
} else {
  $global:__AftertermOriginalPrompt = $function:prompt
}
function global:prompt {
  $__aftertermOk = $global:?
  $esc = [char]27
  $out = "$esc]133;A$esc\"
  if ($PWD.Provider.Name -eq 'FileSystem') {
    $out += "$esc]9;9;$($PWD.ProviderPath)$esc\"
  }
  if (-not $__aftertermOk) {
    Write-Error 'afterterm: restoring $?' -ErrorAction Ignore
  }
  $out += (& $global:__AftertermOriginalPrompt) -join ''
  $out += "$esc]133;B$esc\"
  return $out
}
```

A few details matter here:

- **`$PWD.Provider.Name -eq 'FileSystem'` guards the cwd report.** PowerShell's `$PWD` can point at a non-filesystem drive (`Cert:`, `HKLM:`, `Env:`), which has no OS path worth reporting; the OSC 9;9 line is only emitted when there is a real filesystem path to give.
- **The `Write-Error` trick restores `$?`.** By the time the wrapped prompt is about to call the user's original prompt function, `$?` has already been reset to `$true` by the string-building above (building the marker text is itself a successful expression). If the command the user actually typed had failed, the original prompt (which may print its own success/failure indicator, the way starship does) needs to see that failure again, so a non-terminating, suppressed error is raised first to flip `$?` back to `$false` before handing off.
- **`$global:__AftertermPromptWrapped` stops double-wrapping** if the profile happens to dot-source itself again.
- **`-NoExit` is the safety net.** If the bootstrap script fails for any reason, the shell stays open with the user's ordinary prompt rather than closing on a script error.

`-EncodedCommand` was chosen over the alternatives for three concrete reasons:

- **Execution policy.** A `-File` invocation (or a dot-sourced script) is subject to PowerShell's execution policy, and Windows PowerShell's client default is `Restricted`, meaning the bootstrap would silently fail to run on a machine that has never touched that setting. `-EncodedCommand` is not subject to the execution policy at all.
- **No quoting through node-pty's argv.** The bootstrap has its own quotes, backticks and escape-like sequences; passing it as a literal command-line argument would mean surviving both node-pty's argv handling and PowerShell's own command-line parsing. A base64 blob sidesteps that entirely.
- **No banner or visible noise.** A `-File` run, or a visibly dot-sourced script, can print things a plain `-EncodedCommand` does not.

Verified on PowerShell 7.6 and Windows PowerShell 5.1 directly (`shell-integration.test.ts`'s real-shell section), so the bootstrap deliberately avoids anything PowerShell-7-only.

PowerShell prints no startup banner when started with a command, so, like VS Code's integrated terminal, afterterm's PowerShell threads open straight at the prompt.

### Git Bash: a `PROMPT_COMMAND` hook through the environment

Args stay exactly as they were (`--login -i`); the whole mechanism enters through the environment, since bash reads `PROMPT_COMMAND` (a variable holding a command or function to run before every prompt) without needing to be launched any differently. Two env vars are set:

- `PROMPT_COMMAND` = `eval "$AFTERTERM_BASH_HOOK" 2>/dev/null || unset PROMPT_COMMAND`
- `AFTERTERM_BASH_HOOK` = the real hook, one line (shown here reformatted for readability; the exported constant in `shell-integration.ts` is the same logic joined onto a single line, since it also has to survive a trip through `WSLENV`, which cannot carry a newline):

```bash
__afterterm_precmd() {
  if [ "$PS1" != "$__afterterm_wrapped_ps1" ]; then
    __afterterm_original_ps1="$PS1"
    PS1='\[\e]133;A\e\\\]'"$__afterterm_original_ps1"'\[\e]133;B\e\\\]'
    __afterterm_wrapped_ps1="$PS1"
  fi
  if [ -n "$WSL_DISTRO_NAME" ]; then
    printf '\033]7;file://%s%s\033\\' "$WSL_DISTRO_NAME" "$PWD"
  else
    case "$PWD" in
      /?)
        __afterterm_d="${PWD:1:1}"
        __afterterm_win="${__afterterm_d^^}:\\"
        ;;
      /?/*)
        __afterterm_d="${PWD:1:1}"
        __afterterm_rest="${PWD:3}"
        __afterterm_win="${__afterterm_d^^}:\\${__afterterm_rest//\//\\}"
        ;;
      *)
        __afterterm_w="$(pwd -W 2>/dev/null)"
        if [ -n "$__afterterm_w" ]; then
          __afterterm_win="${__afterterm_w//\//\\}"
        else
          __afterterm_win=""
        fi
        ;;
    esac
    if [ -n "$__afterterm_win" ]; then
      printf '\033]9;9;%s\033\\' "$__afterterm_win"
    fi
  fi
}
if [ -z "$__afterterm_installed" ]; then
  __afterterm_installed=1
  __afterterm_bootstrap='eval "$AFTERTERM_BASH_HOOK" 2>/dev/null || unset PROMPT_COMMAND'
  if declare -p PROMPT_COMMAND 2>/dev/null | grep -q '^declare -a'; then
    __afterterm_new=()
    for __afterterm_item in "${PROMPT_COMMAND[@]}"; do
      case "$__afterterm_item" in
        *"$__afterterm_bootstrap"*) __afterterm_new+=("__afterterm_precmd") ;;
        *) __afterterm_new+=("$__afterterm_item") ;;
      esac
    done
    PROMPT_COMMAND=("${__afterterm_new[@]}")
  else
    __afterterm_rest="${PROMPT_COMMAND//"$__afterterm_bootstrap"/}"
    while [[ "$__afterterm_rest" == [\ \;]* ]]; do __afterterm_rest="${__afterterm_rest:1}"; done
    while [[ "$__afterterm_rest" == *[\ \;] ]]; do __afterterm_rest="${__afterterm_rest%?}"; done
    PROMPT_COMMAND="${__afterterm_rest:+$__afterterm_rest;}__afterterm_precmd"
  fi
  export -n PROMPT_COMMAND AFTERTERM_BASH_HOOK
  __afterterm_precmd
fi
```

Why an environment-variable hook rather than `--rcfile` or `--init-file`, the usual way to inject bash setup: those flags replace which rc file bash reads instead of the user's own (`--rcfile` for a login shell, `--init-file` for `-i`), meaning afterterm would have to reimplement or explicitly re-source the user's real `.bashrc`/`.bash_profile` itself to avoid silently breaking their normal setup, and any mistake in that emulation is a real regression for everyone's shell. Setting `PROMPT_COMMAND` through the environment instead means Git Bash's ordinary login sequence runs completely unmodified; afterterm only has to be sure its own value survives that sequence, which was checked directly: Git for Windows' own `/etc/profile`, `/etc/bash.bashrc` and `/etc/profile.d/*` were read and confirmed to never assign `PROMPT_COMMAND` outright, and both starship's and oh-my-posh's bash init scripts *prepend* to whatever `PROMPT_COMMAND` already holds rather than replacing it. So afterterm's bootstrap value is still there by the time the first prompt is about to print, whatever else the user has installed.

On its first run, the hook installs itself properly rather than leaving the raw bootstrap sitting in `PROMPT_COMMAND` forever: it strips its own bootstrap text back out (handling both the plain-string form of `PROMPT_COMMAND` and bash 5.1's array form), keeps anything an rc file had appended alongside it (an rc doing `PROMPT_COMMAND="$PROMPT_COMMAND; history -a"` keeps its `history -a` call intact), appends the real `__afterterm_precmd` function, and `export -n`s both `PROMPT_COMMAND` and `AFTERTERM_BASH_HOOK` so a child shell does not inherit and re-run the installer a second time.

Every prompt after installation: `__afterterm_precmd` re-wraps whatever `PS1` currently holds in `\[ESC]133;A ESC\ \]` and `\[ESC]133;B ESC\ \]` (comparing against a remembered "already wrapped" value and re-wrapping whenever it has changed, since starship reassigns `PS1` on every single prompt, not once at startup), and reports the cwd as OSC 9;9 with a Windows path: a path shaped `/d/x/y` (Git Bash's own drive form) is turned into `D:\x\y` by parameter expansion alone, no subprocess involved, and anything else (a non-drive mount like `/usr/bin`) goes through `pwd -W`, a Git Bash builtin that also needs no fork.

**Failure mode**: an rc file that assigns `PROMPT_COMMAND` outright (`PROMPT_COMMAND=my_prompt`, replacing rather than appending) discards afterterm's bootstrap before it ever gets a chance to run. The integration is then silently off for that shell: no error, nothing to opt out of, because it was never installed in the first place.

### WSL: the same hook, carried across the boundary by `WSLENV`

WSL reuses the exact same bash hook, since a WSL distro's interactive shell is bash by default. `WSLENV` is what makes an environment variable set on the Windows side visible inside the distro; `appendWslEnv` in `shell-integration.ts` appends `PROMPT_COMMAND:AFTERTERM_BASH_HOOK` to whatever the user's own `WSLENV` already lists, never overwriting it.

Inside the distro, the hook detects `$WSL_DISTRO_NAME` is set and reports the cwd as OSC 7 instead of OSC 9;9: `file://<distro>/<path>`, deliberately putting the distro name in OSC 7's host slot rather than a real hostname. This is safe specifically because afterterm only ever talks to its own hook: an OSC 7 emitter that genuinely wanted to name a host would use that slot differently, but there is no other emitter in play here. The renderer's OSC 7 handler, `osc7ToWindowsPath` in `src/shell-paths.ts` (registered alongside the existing OSC 9 handler in `Terminal/index.tsx`), turns that payload into the Windows-shaped string `Tab.cwd` actually stores: `/mnt/c/x` becomes `C:\x` (an ordinary drvfs mount, no distro segment needed), and anything else becomes `\\wsl$\<distro>\<path>`. That Windows form is deliberate: it is what lets Explorer, the editor launcher and the branch reader, all of which expect an ordinary Windows path or UNC path, work on a WSL thread without any of them needing to know WSL exists.

Spawning back into a `\\wsl$\` cwd never stats that UNC path directly: doing so can block, or can wake a stopped distro just to answer a stat call nobody asked for. `planSpawn` recognises the prefix (`isWslUncPath` and `wslUncToLinux` in `shell-paths.ts`) and turns it straight into `wsl.exe` args `-d <distro> --cd <linux path>`, with the pty's own `cwd` argument left at the home fallback since `--cd` does the real work of landing the shell in the right folder. An ordinary Windows cwd (not a `\\wsl$\` path) spawns exactly as before, and `wsl.exe` maps it under `/mnt` on its own.

zsh and fish inside a distro have no `PROMPT_COMMAND` mechanism at all, so the integration is simply off there, the same silent no-op as an rc file overwriting `PROMPT_COMMAND` in Git Bash. Processes running inside a WSL distro are not Windows processes, so server detection, which walks a Windows process tree by pid, cannot see them: a server started inside WSL never gets a port, full stop, regardless of shell integration.

**WSL is not installed on the development machine** (`wsl.exe` there is the Microsoft Store's install stub), so this path has been verified only by unit tests, never end to end: opening a WSL thread in the harness shows the stub's own "install a distro" message, and a saved `\\wsl$\Ubuntu\home\aryan` cwd was confirmed to plan `wsl.exe` args `["-d","Ubuntu","--cd","/home/aryan"]`, visible in the harness log. State this plainly whenever asked whether WSL was actually driven for real: it was not, on this machine.

### No OSC 133;C or D from any shell

Producing "a command started" (C) or "a command finished" (D) marks needs a preexec-style hook: a `DEBUG` trap in bash, or a PSReadLine key handler in PowerShell. None of that was built, because the renderer's own state machine (`commandMarks.ts`) only ever needed A (a fresh prompt) and B (where the prompt ends and typed input begins) to know when a thread is sitting at a prompt and where that prompt ends; C and D exist in the OSC 133 spec but afterterm has no use for them yet.

## The custom-prompt guarantee

Every mechanism above was chosen specifically so a user's own prompt customisation survives untouched:

- pwsh/Windows PowerShell: the bootstrap wraps whatever `prompt` function is already defined after the profile runs, and calls it, rather than replacing it.
- Git Bash/WSL: the hook wraps whatever `PS1` currently holds, re-wrapping on every prompt precisely because tools like starship reassign `PS1` every time, and stays out of the way of an rc file's own `PROMPT_COMMAND` additions (it only refuses to install if an rc file assigns over it outright).
- cmd: any custom `PROMPT` value the user has set is preserved and wrapped, exactly as Phase 5 already did.

This was verified directly, not just reasoned about: `shell-integration.test.ts`'s real-shell section runs actual `pwsh.exe`, `powershell.exe` and Git Bash subprocesses with a custom prompt function/`PS1` set up first, then checks the wrapped output still contains the custom prompt's own text alongside the OSC marks. The harness gained `--env KEY=VALUE` (see below) specifically to run this same check against a real profile file, not just an inline script.

## Opt-out

`prefs.json`'s `shellIntegration` key, shaped `{ cmd | pwsh | powershell | gitbash | wsl: "off" }`, is read at every spawn (`integrationEnabled` in `shell-integration.ts`), so flipping it takes effect on the very next new terminal, no restart needed. Anything other than the literal string `"off"` for a given shell id, including that key being entirely absent or the whole `shellIntegration` object being missing or malformed, counts as "on": the same permissively-defaulted rule every other `prefs.json` key in this codebase follows, including the file failing to parse at all, which still leaves every shell's integration on rather than treating a typo as an opt-out. There is no settings UI for this yet; the key is edited by hand or seeded through the harness's `--prefs` file.

## Failure modes, summarised

- **PowerShell**: the bootstrap script itself failing to run for any reason is caught by `-NoExit`, which keeps the shell open with the user's ordinary, unwrapped prompt rather than closing.
- **Git Bash and WSL**: an rc file that assigns `PROMPT_COMMAND` outright, rather than appending to it, discards the bootstrap before it runs. No error appears; the integration is simply off for that shell, exactly as if it had been opted out.
- **WSL specifically**: zsh or fish as the interactive shell inside a distro has no `PROMPT_COMMAND` mechanism, so the hook never installs; and any process inside the distro is invisible to Windows-side server detection regardless of shell integration.

## Testing with the harness

`scripts/agent-harness/launch.mjs` gained `--env KEY=VALUE` (repeatable) specifically for this phase, so a custom-prompt test could point `USERPROFILE` and `HOME` at a scratch home directory without ever touching the user's real one: pwsh derives `$PROFILE` from the Documents folder, which itself expands `%USERPROFILE%` (verified on this machine), and Git Bash reads `~/.bash_profile` from `HOME`. Redirecting both is what lets a test prove the bootstrap wraps a *real* custom prompt rather than only the shell's stock one, with zero risk to the person's actual profile files.

Two log lines came with this phase, both gated on `AFTERTERM_HARNESS=1`:

- `[harness] pty:create <tab> shell=<id> integration=on|off cwd=<dir> cwdFallback=<bool> args=[...]`, printed from `pty:create` in `main.ts`. An `-EncodedCommand` value in `args` prints as the literal string `<encoded>` rather than the actual base64, since it is long and unreadable either way.
- `[harness] msys tree <tab> pids=<list>`, printed from the server watcher and from `killTree`, only when a Git Bash tree turns out to hold more than the shell itself.

Verified in the harness on 2026-09-08 for pwsh, Windows PowerShell and Git Bash directly (cmd was re-run too, as a regression check, since the planner now owns its behaviour as well): a thread restored from a saved session woke in its saved folder, with the header showing the correct branch read from that folder's `.git/HEAD`; `drive marks --tab <id>` reported "at prompt: yes" once the shell settled; `cd`-ing into a sibling folder changed `Tab.cwd` and the header's branch line within a couple of seconds; typing `npm start -- <port>` turned the row green with the port, named the thread by the command, showed "Running on :port" in the header chip and a "Last ran" row on the hover card; Sleep asked "Wake runs npm start -- <port> again" and the asleep pane read "Server asleep since just now · runs npm start -- <port>"; Wake re-typed the command and the server was listening again within a few seconds, matching cmd's behaviour exactly. WSL's coverage remains unit-tests-only, as stated above.

## Limits

- WSL shell integration has not been exercised end to end on the development machine; only its planning logic (`planSpawn`'s `wsl.exe --cd` mapping) and the OSC 7 conversion are unit-tested.
- No shell emits OSC 133;C or D, so nothing beyond "a fresh prompt" and "the prompt just ended" is ever known about a shell's state; a preexec hook would be needed for more, and none exists.
- An rc file (Git Bash/WSL) or a broken bootstrap (PowerShell) can silently turn the integration off for a shell, with no visible error and no way today to tell from inside the app that it happened, short of `drive marks` reporting "at prompt: no" forever.
- zsh and fish inside a WSL distro get no cwd capture or prompt marks at all; the hook is bash-only.
- A process running inside a WSL distro is invisible to server detection, since that walk only ever covers Windows processes.

## The CLAUDE.md record (moved here 2026-09-20)

### Shell integration for PowerShell, Git Bash and WSL (Phase 6)

Phase 5 gave cmd two things at spawn: an OSC 9;9 cwd report and OSC 133 A/B prompt marks, both folded into its injected `PROMPT`. Every other shell profile afterterm offers, pwsh, Windows PowerShell, Git Bash and WSL, had neither, which is why the CWD-capture table above and the servers section both carried a "cmd only until Phase 6" caveat: a server thread in any of those shells got a port (process-tree detection has nothing shell-specific about it) but no `lastCommand`, and its cwd was never captured at all, so it always restored to the user's home folder. Phase 6 closes both gaps by giving every shell the same two things cmd already had, using whatever mechanism actually lands on that shell without disturbing a custom prompt.

Every spawn now goes through one pure module, `src/shell-integration.ts`'s `planSpawn`: given the shell profile, the tab's saved cwd, the home fallback, the already-cleaned env, the parsed prefs object and a `dirExists` predicate, it returns the exact command, args, cwd and env to spawn with. `pty:create` in `main.ts` calls it and only applies the result; it owns no shell-specific logic of its own any more, cmd's PROMPT injection included, which moved into the planner unchanged. This is what makes the module unit-testable without Electron: `src/shell-integration.test.ts` covers every shell's plan directly, plus a section that actually spawns real `pwsh.exe`, `powershell.exe` and Git Bash subprocesses to prove the bootstrap script runs and marks appear, not just that the string looks right.

**cmd**: unchanged behaviour. `$E]133;A$E\` before the visible prompt, `$E]9;9;$P$E\` (the cwd), then the user's own `PROMPT` (or the default `$P$G`), then `$E]133;B$E\`.

**pwsh and Windows PowerShell**: spawned with `-NoExit -EncodedCommand <base64 UTF-16LE bootstrap>`. The bootstrap (`PWSH_BOOTSTRAP` in `shell-integration.ts`) runs after the user's own `$PROFILE`, so a profile that defines its own prompt (oh-my-posh, starship, a hand-rolled one) sets it first and the bootstrap wraps whatever it finds: it saves the existing `$function:prompt` as `$global:__AftertermOriginalPrompt` (or a plain fallback if none was defined), then replaces `prompt` with a function that emits `133;A`, then `9;9;$($PWD.ProviderPath)` but only when `$PWD.Provider.Name -eq 'FileSystem'` (a `Cert:` or `HKLM:` drive has no OS path to report), restores `$?` if the last command had failed (`Write-Error -ErrorAction Ignore`, needed because building the marker strings above resets `$?` to true, and the original prompt may print its own success/failure indicator), calls the saved original prompt and appends its output, then emits `133;B`. A `$global:__AftertermPromptWrapped` guard stops it wrapping twice if the profile is dot-sourced again. `-EncodedCommand` was chosen over `-File` or a dot-sourced script for three reasons: it is not subject to PowerShell's execution policy (a `-File` would be, and Windows PowerShell's client default is Restricted, so the bootstrap would silently fail to run on a machine that has never touched execution policy), it needs no quoting through node-pty's argv (the script has its own quotes, backticks and here-string-like escapes that a shell-level quoting scheme would have to survive), and it prints no banner or "running script" noise the way a visibly dot-sourced file might. If the bootstrap itself fails for any reason, `-NoExit` keeps the shell open with the user's ordinary prompt rather than closing on a script error. PowerShell prints no startup banner when started with a command, so, like VS Code's integrated terminal, afterterm's PowerShell threads open straight at the prompt.

**Git Bash**: args are unchanged (`--login -i`), the hook enters entirely through the environment, since bash reads `PROMPT_COMMAND` (a function or string run before every prompt) without needing to be launched any differently. `PROMPT_COMMAND` is set to a one-line bootstrap, `eval "$AFTERTERM_BASH_HOOK" 2>/dev/null || unset PROMPT_COMMAND`, and `AFTERTERM_BASH_HOOK` carries the real hook text (`BASH_HOOK` in `shell-integration.ts`, written out long-form as a comment above the exported one-liner so it can actually be read and changed). This was verified against Git for Windows' own `/etc/profile`, `/etc/bash.bashrc` and `/etc/profile.d/*`: none of them assign `PROMPT_COMMAND` outright, and starship's and oh-my-posh's own bash init both prepend to whatever `PROMPT_COMMAND` already holds rather than replacing it, so afterterm's bootstrap value survives the login sequence and is still there by the time the first prompt is about to print. On its first run the hook installs itself properly: it strips its own bootstrap text back out of `PROMPT_COMMAND` (handling both the plain string form and bash 5.1's array form), keeps anything an rc file had appended alongside it (an rc doing `PROMPT_COMMAND="$PROMPT_COMMAND; history -a"` keeps its `history -a` call), appends the real precmd function, and `export -n`s both `PROMPT_COMMAND` and `AFTERTERM_BASH_HOOK` so a child shell does not inherit and re-run the installer. Every prompt after that: the precmd function wraps whatever `PS1` currently holds in `\[ESC]133;A ESC\ \]` and `\[ESC]133;B ESC\ \]` (re-wrapping every time, since starship reassigns `PS1` on every single prompt, not once at startup), and reports the cwd as OSC 9;9 with a Windows path: a `/d/x/y`-shaped path is turned into `D:\x\y` by parameter expansion alone (no subprocess), and anything else (a non-drive mount like `/usr/bin`) goes through `pwd -W`, a Git Bash builtin, still no fork. Failure mode: an rc file that assigns `PROMPT_COMMAND` outright (`PROMPT_COMMAND=my_prompt`, no append) discards afterterm's bootstrap before it ever runs, and the integration is silently off for that shell, no error, nothing to opt out of because it was never on.

**WSL**: the same hook, carried across the Windows/Linux boundary through `WSLENV` (`PROMPT_COMMAND:AFTERTERM_BASH_HOOK` appended to whatever the user's own `WSLENV` already lists, via `appendWslEnv`, never overwriting it). Inside the distro the hook runs the same as Git Bash's, except it detects `$WSL_DISTRO_NAME` is set and emits OSC 7 instead of OSC 9;9: `file://<distro>/<path>`, deliberately putting the distro name in OSC 7's host slot rather than a real hostname, since afterterm only ever talks to its own hook and that slot would otherwise go unused. The renderer's new OSC 7 handler (`osc7ToWindowsPath` in `src/shell-paths.ts`) turns that into the Windows form `Tab.cwd` actually stores: `/mnt/c/x` becomes `C:\x`, anything else becomes `\\wsl$\<distro>\<path>`. That Windows-shaped string is what `Tab.cwd` holds for a WSL tab, which is what lets Explorer, the editor launcher and the branch reader (all plain `fs`/shell-out calls expecting a Windows path) work on a WSL thread without any of them knowing WSL exists. Spawning back into a `\\wsl$\` cwd never stats that UNC path (a stat can block main's event loop or wake a stopped distro just to answer it): `planSpawn` recognises the prefix (`isWslUncPath`/`wslUncToLinux` in `shell-paths.ts`) and turns it straight into `wsl.exe -d <distro> --cd <linux path>` args, with the pty's own cwd argument left at the home fallback since `--cd` does the real work. An ordinary Windows cwd spawns exactly as before and `wsl.exe` maps it under `/mnt` itself. zsh and fish inside a distro have no `PROMPT_COMMAND` mechanism at all, so the integration is simply off there, the same silent no-op as an rc file that clobbers `PROMPT_COMMAND` in Git Bash. Processes running inside a WSL distro are not Windows processes, so server detection (which walks a Windows process tree by pid) cannot see them: a server started inside WSL never gets a port. **WSL is not installed on the development machine** (`wsl.exe` there is the Microsoft Store stub), so the WSL path is verified only by unit tests, not the harness: opening a WSL thread in the harness shows the stub's "install a distro" message, and a `\\wsl$\Ubuntu\home\aryan` cwd was confirmed planned as `wsl.exe` args `["-d","Ubuntu","--cd","/home/aryan"]` in the harness log. State this limit plainly whenever asked whether WSL shell integration was actually exercised end to end: it was not, on this machine, only its planning and path logic were.

No shell emits OSC 133;C or D (the "a command started" / "a command finished" marks): producing those needs a preexec-style hook, a `DEBUG` trap in bash or a PSReadLine key handler in PowerShell, and the renderer's own state machine (`commandMarks.ts`) only ever needed A and B to know where a prompt starts and ends, so none of the four new shells were made to emit them either.

**Opt-out**: `prefs.json`'s `shellIntegration` key, shaped `{ cmd | pwsh | powershell | gitbash | wsl: "off" }`, read at every spawn (`integrationEnabled` in `shell-integration.ts`) so flipping it takes effect on the next new terminal with no restart needed. Anything other than the literal string `"off"` for a given shell id, including the key being entirely absent or the whole `shellIntegration` object being missing or malformed, counts as "on", the same permissive rule every other prefs.json key in this codebase follows: a prefs.json that fails to parse at all counts as on too, never as a reason to stop opening shells. There is no settings UI for this yet.

**The Git Bash process-tree fix**: found while self-testing this phase in the harness on 2026-09-08, and unrelated to the cwd/prompt work above except that it surfaces on the same shell. Both server detection and the tree kill on sleep/close walk Windows parent links starting from the tab's shell pid, and for an MSYS shell (Git Bash) that chain breaks at every `exec` of an MSYS program: MSYS launches a program through a fork stub that execs the real process and then exits, so by the time `bash npm` is actually running, its Windows parent pid points at a process that is already gone. Native children below that point (node, cmd, the server itself) keep intact Windows parent links, so the break is exactly one hop wide but it is enough to sever the whole subtree below it from the walk. Before the fix this meant a server started in a Git Bash tab was never matched to it (no port ever showed), and closing or sleeping that tab's `taskkill /T` walk stopped at the same gap, leaving the server running as an orphan process with nothing left to have started it. The fix (`parseMsysPs` and `applyMsysParents` in `src/server-detect.ts`) reads MSYS's own process table via `<git root>\usr\bin\ps.exe -l` (about 55ms measured), whose `PID`/`PPID` columns are MSYS's own numbering but whose `WINPID` column is the real Windows pid netstat and `Win32_Process` both speak, and re-points each MSYS process's Windows parent at its MSYS parent's WINPID, which bridges exactly the gap the fork stub left. `main.ts` only runs `ps.exe` while at least one Git Bash tab is actually live, and only on the polls that re-read the process list anyway (never on every netstat poll); `killTree` (the one function sleep, close and quit all funnel through) reads it fresh right before the shell dies, since the process list has to still contain the shell's own rows at that moment, then kills the shell's tree and every pid in the merged descendant set.

**Testing this with the harness**: `scripts/agent-harness/launch.mjs` gained `--env KEY=VALUE` (repeatable) specifically so a custom-prompt test could point `USERPROFILE` and `HOME` at a scratch home directory without ever touching the real one: pwsh derives `$PROFILE` from the Documents folder, which itself expands `%USERPROFILE%`, and Git Bash reads `~/.bash_profile` from `HOME`, so redirecting both env vars is what lets a test prove the bootstrap wraps a *real* custom prompt (starship, oh-my-posh, a hand-written one) rather than only the shell's stock prompt. Two new log lines came with this phase: `[harness] pty:create <tab> shell=<id> integration=on|off cwd=<dir> cwdFallback=<bool> args=[...]` (from `pty:create`, an `-EncodedCommand` value is shown as the literal string `<encoded>` rather than the actual base64, since it is long and unreadable either way) and `[harness] msys tree <tab> pids=<list>` (from the server watcher and from `killTree`, only printed when a Git Bash tree actually has more than the shell itself in it).

Verified per shell in the harness on 2026-09-08 (pwsh, Windows PowerShell and Git Bash directly; cmd re-run as a regression check, since the planner now owns its behaviour too): a thread restored from a saved session woke in its saved folder, with the header showing the correct branch read from that folder's `.git/HEAD`; `drive marks --tab <id>` reported "at prompt: yes" once the shell settled; `cd`-ing into a sibling folder changed `Tab.cwd` and the header's branch line within a couple of seconds; typing `npm start -- <port>` turned the row green with the port, named the thread by the command, showed "Running on :port" in the header chip and "Last ran" on the hover card, exactly like a cmd server thread; Sleep asked "Wake runs npm start -- <port> again" and the asleep pane read "Server asleep since just now · runs npm start -- <port>"; Wake re-typed the command and the server was listening again within a few seconds. WSL's coverage is unit-tests-only, stated above and worth repeating here since it is the one shell this verification pass could not actually run.

### CWD capture — per-shell support

A tab can only restore to its last directory if afterterm captured that directory while you worked. Capture relies on the shell *announcing* its path via an OSC 9;9 report (OSC 7 for WSL), and since Phase 6 every shell profile afterterm offers does:

| Shell | CWD restore | How |
|---|---|---|
| **Command Prompt (cmd.exe)** | ✅ Supported | afterterm injects an OSC 9;9 cwd report into the `PROMPT` env var at spawn (`shell-integration.ts`'s `planSpawn`); the renderer parses OSC 9;9 (`Terminal/index.tsx`). Any custom `PROMPT` is preserved. |
| **PowerShell 7 (pwsh)** | ✅ Supported (Phase 6) | The shell is launched with `-NoExit -EncodedCommand <bootstrap>`; the bootstrap wraps whatever `prompt` function the user's own profile defines (custom prompts preserved) and has the wrapped prompt emit OSC 9;9 with `$PWD.ProviderPath`, FileSystem provider only. |
| **Windows PowerShell** | ✅ Supported (Phase 6) | Same wrapped-prompt mechanism as pwsh, verified separately on 5.1. |
| **Git Bash** | ✅ Supported (Phase 6) | A `PROMPT_COMMAND` hook installed through the environment (no arg/profile changes) reports the cwd as OSC 9;9, converting to a Windows path with parameter expansion for a drive path or `pwd -W` (a builtin, no fork) for anything else. |
| **WSL** | ✅ Supported (Phase 6), unit-tested only | The same `PROMPT_COMMAND` hook, carried into the distro through `WSLENV`, reports OSC 7 `file://<distro>/<path>` instead; the renderer converts that to a `\\wsl$\<distro>\...` or `C:\...` Windows path. WSL is not installed on the development machine, so this path has not been exercised end to end, only planned and unit-tested. |

A shell whose hook is off (opted out in `prefs.json`, or, for Git Bash and WSL, discarded by an rc file that assigns `PROMPT_COMMAND` outright instead of appending to it) falls back to spawning in the user home folder (`%USERPROFILE%`), the same as an unsupported shell always did.

> **Do not** re-add a title→cwd heuristic. cmd.exe sets its console title to `C:\…\cmd.exe - <command>`, which looks path-like but is garbage; capturing it poisoned the saved cwd (it failed `fs.existsSync` on restore → fell back to home). CWD comes from OSC 9;9 only.

// The afterterm skill (design-07, AFT-110): a short note for agents on what afterterm
// is and how to keep its loops. afterterm writes it into Claude Code's folder
// (<claudeDir>\skills\afterterm\SKILL.md) at launch, next to its hook, under the
// same rules as the hook:
//  - only when this launch may touch the Claude folder (hookReconcileAllowed),
//    and not when prefs.json opts out (claudeNotifications: "disabled");
//  - a SKILL.md there that afterterm did not write (no marker line) is never
//    touched;
//  - written only when the text differs, so a launch with nothing new writes
//    nothing.
// Until 0.20.1 the skill was "afterterm-loops" (<claudeDir>\skills\afterterm-loops);
// that one is removed when it carries afterterm's marker, and left alone when it
// does not. The skill says itself that it applies only inside afterterm, since
// Claude Code lists it in every chat.

import fs from 'node:fs';
import path from 'node:path';

export const SKILL_MARKER = '<!-- written by afterterm; edits are replaced at the next launch -->';
export const SKILL_NAME = 'afterterm';
export const OLD_SKILL_NAME = 'afterterm-loops';

export const SKILL_TEXT = `---
name: afterterm
description: Read this first in any chat inside afterterm, before you change any file. It explains afterterm, the terminal this chat runs in, how to keep its loops, one for each piece of work the user starts, and how to start a chat in another project when the user asks.
---
${SKILL_MARKER}

# Working inside afterterm

You are running inside afterterm, a terminal for Windows built for working with Claude Code. The user organises their work in projects (a folder with a name, colour and icon) and threads inside them: chats running Claude Code, like this one, and shells. afterterm shows the user what each chat is doing: its name, model, branch and worktree in the header; whether it is working, needs them or is done, in the sidebar and as notifications; and the files it changed, in a Files button.

## Loops

afterterm keeps a loop for each piece of work the user starts: a feature (work started), a bug (a fix started) or an idea (discussed with Claude, not started). The user sees every project's loops on afterterm's Home and in a card in the workspace, to know what is in progress and what was started long ago and never finished. You keep them up to date as you work; the user should not have to.

The open loops of this folder were listed at the start of the chat.

### Rules

- **When you begin a feature or a bug fix the user asked for, start a loop first, before editing files.** A bug is any error, crash or wrong behaviour the user reports. If a loop in the list already covers the work, continue that one instead and ping it; never start a duplicate. An idea the user wants to keep for later is a loop too. A smaller piece of a bigger loop is a sub-loop, one level only.
- **Before you end your turn, update the status note** of every loop you worked on, so the next chat can pick it up. The note is replaced each time; one or two sentences.
- **Close a loop when its work is done.** Leave it open if something is still pending. If you are unsure, ask the user.
- **A loop with open sub-loops cannot close.** Discuss with the user which pieces of it remain, and close it together with its sub-loops only if they agree.
- Only real work is a loop: something the user asked for or discussed with you. A quick question or a one-line answer is not.
- The user can reopen, rename, move, archive or delete loops; respect what they did.

Activity (a ping, a note, any edit) keeps a loop from rotting; a loop with no activity for 5 days shows as rotting.

### Commands

The command \`afterterm loops\` exists only in afterterm's terminals. Ids are numbers. A loop goes in this thread's project unless \`--project <name>\` says otherwise.

| To | Run |
|---|---|
| List this folder's open loops | \`afterterm loops list\` |
| Start a loop | \`afterterm loops new "<short title>" --label feature\\|bug\\|idea --desc "<what it is for>"\` |
| Start a sub-loop | add \`--parent <id>\` to \`new\` |
| Ping a loop you continue | \`afterterm loops ping <id>\` |
| Update the status note | \`afterterm loops update <id> --note "<where it was left>"\` |
| Close a loop | \`afterterm loops close <id> --note "<what was finished>"\` |
| Close a loop with its open sub-loops | add \`--with-sub-loops\` to \`close\` |
| See every command | \`afterterm loops help\` |

## Starting a chat in another project

\`afterterm chat start\` opens a new Claude Code chat in any of the user's projects, with a prompt you write. **Use it only when the user asked you to start a chat or an agent.** Never on your own. The user sees every request in afterterm and must click Start; nothing opens until they do.

Give the prompt as text on stdin, with a heredoc. Never write it to a file.

\`\`\`
afterterm chat start --project "<project name>" --model opus <<'EOF'
<the prompt: everything the new chat needs, since it knows nothing of this chat>
EOF
\`\`\`

- **--model is required, there is no default.** Pick it by the task: \`haiku\` for notes and laborious basic work; \`sonnet\` for simple coding where the result is known; \`opus\` for anything open-ended, and whenever in doubt. \`fable\` only when the user asked for it, or when the work is very broad and you asked the user first and they said yes.
- \`--effort low|medium|high|xhigh|max\` is optional; left out, Claude Code's default.
- The command waits for the user's click (up to 10 minutes) and for the new chat to receive the prompt, then prints the chat's name. Exit 0 started, 3 declined, 4 nobody answered, 1 failed. Do not ask again after a decline unless the user says so.
- The prompt shows in the new chat as its first message. \`afterterm chat help\` lists the options.
`;

export interface SkillReconcileResult {
  status: 'written' | 'unchanged' | 'skipped-not-ours' | 'skipped-opt-out' | 'failed';
  file: string;
  detail?: string;
  // The old "afterterm-loops" skill: removed (it was ours), kept (someone else's
  // file under that name), or absent.
  oldSkill: 'removed' | 'kept-not-ours' | 'absent';
}

// Removes the old "afterterm-loops" skill when afterterm wrote it, and its folder
// when that leaves it empty. Someone else's file under that name stays.
function removeOldSkill(claudeDir: string): SkillReconcileResult['oldSkill'] {
  const dir = path.join(claudeDir, 'skills', OLD_SKILL_NAME);
  const file = path.join(dir, 'SKILL.md');
  let text: string;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return 'absent'; }
  if (!text.includes(SKILL_MARKER)) return 'kept-not-ours';
  try {
    fs.rmSync(file, { force: true });
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    return 'removed';
  } catch {
    return 'kept-not-ours';
  }
}

export function reconcileAftertermSkill(opts: { claudeDir: string; optedOut: boolean }): SkillReconcileResult {
  const file = path.join(opts.claudeDir, 'skills', SKILL_NAME, 'SKILL.md');
  if (opts.optedOut) return { status: 'skipped-opt-out', file, oldSkill: 'absent' };
  const oldSkill = removeOldSkill(opts.claudeDir);
  let old: string | null = null;
  try { old = fs.readFileSync(file, 'utf8'); } catch { /* not there */ }
  if (old !== null && !old.includes(SKILL_MARKER)) return { status: 'skipped-not-ours', file, oldSkill };
  if (old === SKILL_TEXT) return { status: 'unchanged', file, oldSkill };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, SKILL_TEXT, 'utf8');
    return { status: 'written', file, oldSkill };
  } catch (e) {
    return { status: 'failed', file, detail: (e as Error).message, oldSkill };
  }
}

// The afterterm-loops skill (design-07): a short note for agents on what a loop
// is and when to start, update, ping and close one. afterterm writes it into
// Claude Code's folder (<claudeDir>\skills\afterterm-loops\SKILL.md) at launch,
// next to its hook, under the same rules as the hook:
//  - only when this launch may touch the Claude folder (hookReconcileAllowed),
//    and not when prefs.json opts out (claudeNotifications: "disabled");
//  - a SKILL.md there that afterterm did not write (no marker line) is never
//    touched;
//  - written only when the text differs, so a launch with nothing new writes
//    nothing.
// The skill says itself that it applies only inside afterterm, since Claude Code
// lists it in every chat.

import fs from 'node:fs';
import path from 'node:path';

export const SKILL_MARKER = '<!-- written by afterterm; edits are replaced at the next launch -->';

export const SKILL_TEXT = `---
name: afterterm-loops
description: Read this first in any chat inside afterterm. It explains how to work in afterterm, which keeps a "loop" for each piece of work the user starts, through the afterterm loops command.
---
${SKILL_MARKER}

# Working inside afterterm

afterterm keeps a loop for each piece of work the user starts: a feature (work started), a bug (a fix started) or an idea (discussed with Claude, not started). The user sees every project's loops on afterterm's Home and in a card in the workspace, to know what is in progress and what was started long ago and never finished. You keep them up to date as you work; the user should not have to.

Use the command \`afterterm loops\` (it exists only in afterterm's terminals; \`afterterm loops help\` lists everything). Ids are numbers. The open loops of this folder were listed at the start of the chat; \`afterterm loops list\` shows them again.

- **When you begin a feature or a bug fix the user asked for, start a loop first, before editing files:** \`afterterm loops new "<short title>" --label feature|bug --desc "<what it is for>"\`. If a loop in the list already covers the work, continue that one instead (never start a duplicate) and ping it: \`afterterm loops ping <id>\`. An idea the user wants to keep for later is a loop too: \`--label idea\`. A smaller piece of a bigger loop is a sub-loop: \`--parent <id>\` (one level only).
- **Before you end your turn, update the status note** of every loop you worked on, so the next chat can pick it up: \`afterterm loops update <id> --note "<where it was left>"\`. The note is replaced each time; one or two sentences.
- **Close a loop when its work is done** (merged, shipped, or the user says so): \`afterterm loops close <id>\`. A loop with open sub-loops cannot just close: ask the user first, and only with their say add \`--with-sub-loops\`.
- Only real work is a loop: something the user asked for or discussed with you. A quick question or a one-line answer is not.
- The user can reopen, rename, move, archive or delete loops; respect what they did.

A loop goes in this thread's project unless \`--project <name>\` says otherwise. Activity (a ping, a note, any edit) keeps a loop from rotting; a loop with no activity for 5 days shows as rotting.
`;

export interface SkillReconcileResult {
  status: 'written' | 'unchanged' | 'skipped-not-ours' | 'skipped-opt-out' | 'failed';
  file: string;
  detail?: string;
}

export function reconcileLoopsSkill(opts: { claudeDir: string; optedOut: boolean }): SkillReconcileResult {
  const file = path.join(opts.claudeDir, 'skills', 'afterterm-loops', 'SKILL.md');
  if (opts.optedOut) return { status: 'skipped-opt-out', file };
  let old: string | null = null;
  try { old = fs.readFileSync(file, 'utf8'); } catch { /* not there */ }
  if (old !== null && !old.includes(SKILL_MARKER)) return { status: 'skipped-not-ours', file };
  if (old === SKILL_TEXT) return { status: 'unchanged', file };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, SKILL_TEXT, 'utf8');
    return { status: 'written', file };
  } catch (e) {
    return { status: 'failed', file, detail: (e as Error).message };
  }
}

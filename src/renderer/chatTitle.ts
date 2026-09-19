// Which glyph is sitting at the front of a terminal's title, and what the title
// means once that glyph is read.
//
// Why this exists: two different writers share one OS title channel and
// overwrite each other on the same terminal. Claude Code's own summarizer sets
// the title to its conversation summary with a leading glyph: "✳ Fix the
// spinner" idle, a spinner glyph while it is mid-turn, updated on every reply
// and on /rename. The afterterm notify hook (assets/hooks/afterterm-notify.ps1)
// sets the title to its own state text with a different leading glyph: "▶
// afterterm - working". A shell with neither running just sets its own title (a
// folder name, "cmd.exe"). A caller that wants to know "is this Claude's
// summary, the hook's state, or something else" needs to read the glyph, so
// that decision lives here once instead of at every call site.
//
// Pure module, no React, no DOM: importable from plain Node so the unit tests
// can run with `node src/renderer/chatTitle.test.ts`.

// Claude Code's own leading glyphs. This is the one place that knows them, so a
// change in Claude Code's title format (a new spinner frame, a different idle
// glyph) is one edit.
//
// Idle: "✳" (U+2733). Busy, current builds: "◐ ◓ ◑ ◒" (U+25D0 to U+25D3), a
// four-frame spin. Busy, older builds: a wider dingbat-star cycle, "✢ ✳ ✶ ✻ ✽"
// (U+2722 to U+273F, which also covers the idle glyph), and a plain middle dot
// "·" (U+00B7). All of these are matched so a title from an older Claude Code
// build still reads as a summary, not a shell title.
export const CLAUDE_TITLE_GLYPH = /^[·✢-✿◐-◓]\s*/u;

// The text after Claude's leading glyph, trimmed; null when `raw` does not
// start with one of Claude's own glyphs at all (a hook title, since its glyphs
// are a different set below, or a plain shell title), or when nothing is left
// after the glyph (a bare glyph with no summary yet).
export function claudeSummaryTitle(raw: string): string | null {
  if (!CLAUDE_TITLE_GLYPH.test(raw)) return null;
  const rest = raw.replace(CLAUDE_TITLE_GLYPH, '').trim();
  return rest.length > 0 ? rest : null;
}

// The notify hook's five state glyphs: working, done, needs permission,
// background tasks, compacting. See assets/hooks/afterterm-notify.ps1 and the
// "Notification System" section of CLAUDE.md.
export const HOOK_TITLE_GLYPH = /^[▶✅⚠⏳⚙]\s*/u;

// True when `raw` is one of the hook's own state titles ("▶ afterterm -
// working"), never Claude's summary and never a plain shell title.
export function isHookTitle(raw: string): boolean {
  return HOOK_TITLE_GLYPH.test(raw);
}

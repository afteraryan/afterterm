// A release's notes (its GitHub body, Markdown) as the update notice, the About
// window and the What's new window show them (docs/design-05-automatic-updates.md).
// parseNotes (src/update-check.ts) turns the Markdown into headings, bullets,
// bold and links; nothing is ever inserted as HTML. A link opens in the browser
// through the same safelisted path terminal links use.
import React, { useMemo } from 'react';
import { parseNotes } from '../../../update-check';
import type { Inline } from '../../../update-check';
import './UpdateNotes.css';

export function hasNotes(markdown: string | undefined): boolean {
  return !!markdown && parseNotes(markdown).length > 0;
}

function Inlines({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) => {
        if (p.href) {
          const href = p.href;
          return (
            <a key={i} href={href} onClick={e => { e.preventDefault(); window.afterterm.shell.openExternal(href); }}>
              {p.text}
            </a>
          );
        }
        return p.bold ? <b key={i}>{p.text}</b> : <React.Fragment key={i}>{p.text}</React.Fragment>;
      })}
    </>
  );
}

export function UpdateNotes({ markdown, fold }: { markdown: string; fold?: boolean }) {
  const blocks = useMemo(() => parseNotes(markdown), [markdown]);
  return (
    <div className={`up-notes${fold ? ' fold' : ''}`} data-update-notes="">
      {blocks.map((b, i) => {
        if (b.type === 'heading') return <h4 key={i}><Inlines parts={b.inlines} /></h4>;
        if (b.type === 'list') {
          return <ul key={i}>{b.items.map((item, j) => <li key={j}><Inlines parts={item} /></li>)}</ul>;
        }
        return <p key={i}><Inlines parts={b.inlines} /></p>;
      })}
    </div>
  );
}

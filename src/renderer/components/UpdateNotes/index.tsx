// A release's notes (its GitHub body, Markdown) as the update notice, the About
// window and the What's new window show them (docs/design-05-automatic-updates.md).
// parseNotes (src/update-check.ts) turns the Markdown into headings, bullets,
// bold and links; nothing is ever inserted as HTML. A link opens in the browser
// through the same safelisted path terminal links use.
//
// ReleaseNotesList is What's new for an update that skips versions (AFT-56): every
// release since the running version under its own version heading, the newest
// open and the older ones folded.
import React, { useMemo, useState } from 'react';
import { REPO_URL, parseNotes, releaseDateText } from '../../../update-check';
import type { Inline, ReleaseNote } from '../../../update-check';
import { IconChevR } from '../Icons';
import './UpdateNotes.css';

export function hasNotes(markdown: string | undefined): boolean {
  return !!markdown && parseNotes(markdown).length > 0;
}

// The releases in a list that have notes to show.
export function withNotes(releases: ReleaseNote[] | undefined): ReleaseNote[] {
  return (releases ?? []).filter(r => hasNotes(r.notes));
}

// What's new for a release on offer or just installed: the releases to list (its
// own notes alone when no list came with it), the older ones left out, how many
// versions came out between the two ends, and whether there is anything to show.
export function notesOf(r: { version: string; notes: string; since?: ReleaseNote[]; more?: number }) {
  const releases = r.since && r.since.length ? r.since : [{ version: r.version, date: null, notes: r.notes }];
  const more = r.more ?? 0;
  const shown = withNotes(releases).length;
  // multi: What's new lists versions under headings (ReleaseNotesList), so its
  // label and title say "since" the running version.
  return { releases, more, between: releases.length - 1 + more, any: shown > 0, multi: shown + more > 1 };
}

function open(href: string) {
  window.afterterm.shell.openExternal(href);
}

function Inlines({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) => {
        if (p.href) {
          const href = p.href;
          return <a key={i} href={href} onClick={e => { e.preventDefault(); open(href); }}>{p.text}</a>;
        }
        return p.bold ? <b key={i}>{p.text}</b> : <React.Fragment key={i}>{p.text}</React.Fragment>;
      })}
    </>
  );
}

function Blocks({ markdown }: { markdown: string }) {
  const blocks = useMemo(() => parseNotes(markdown), [markdown]);
  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === 'heading') return <h4 key={i}><Inlines parts={b.inlines} /></h4>;
        if (b.type === 'list') {
          return <ul key={i}>{b.items.map((item, j) => <li key={j}><Inlines parts={item} /></li>)}</ul>;
        }
        return <p key={i}><Inlines parts={b.inlines} /></p>;
      })}
    </>
  );
}

export function UpdateNotes({ markdown, fold }: { markdown: string; fold?: boolean }) {
  return (
    <div className={`up-notes${fold ? ' fold' : ''}`} data-update-notes="">
      <Blocks markdown={markdown} />
    </div>
  );
}

// One release with notes reads as its notes alone, as before. Several read as a
// heading each (version, date, "Newest" on the first), newest first; a click on a
// heading opens or folds it. `more` older releases left out are one link to
// GitHub's releases page at the end.
export function ReleaseNotesList({ releases, more, fold }: { releases: ReleaseNote[]; more: number; fold?: boolean }) {
  const list = useMemo(() => withNotes(releases), [releases]);
  // The versions clicked: the newest starts open, so a click folds it; any other
  // starts folded, so a click opens it. A newer release found later starts open too.
  const [toggled, setToggled] = useState<Set<string>>(() => new Set());
  if (list.length <= 1 && more <= 0) return <UpdateNotes markdown={list[0]?.notes ?? ''} fold={fold} />;

  const toggle = (v: string) => setToggled(prev => {
    const next = new Set(prev);
    if (next.has(v)) next.delete(v); else next.add(v);
    return next;
  });
  const releasesUrl = `${REPO_URL}/releases`;

  return (
    <div className={`up-notes up-vers${fold ? ' fold' : ''}`} data-update-notes="" data-release-count={list.length}>
      {list.map((r, i) => {
        const isOpen = (i === 0) !== toggled.has(r.version);
        const date = releaseDateText(r.date);
        return (
          <section className="up-ver" key={r.version} data-release={r.version} data-open={isOpen ? '' : undefined}>
            <button type="button" className="up-vh" aria-expanded={isOpen} onClick={() => toggle(r.version)}>
              <span className="chev"><IconChevR size={13} /></span>
              <span className="vn">{r.version}</span>
              {date && <span className="vd">{date}</span>}
              {i === 0 && <span className="tag">Newest</span>}
            </button>
            {isOpen && <div className="up-vb"><Blocks markdown={r.notes} /></div>}
          </section>
        );
      })}
      {more > 0 && (
        <a className="up-more" href={releasesUrl} data-release-more="" onClick={e => { e.preventDefault(); open(releasesUrl); }}>
          See {more} earlier {more === 1 ? 'release' : 'releases'} on GitHub
        </a>
      )}
    </div>
  );
}

// The Files button in a chat's header and the list it opens: the documents the
// chat changed first, then its code and the images pasted into it, each folded to
// a count (docs/edited-files/design-04-edited-files.md, decisions 1 to 3). The look
// and every animation value come from docs/mockups/edited-files-button.html; the
// list's content comes from filesView.ts.
//
// The list stays mounted while the button exists, so closing can animate out; it
// is positioned fixed under the button's right edge, measured on open.
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FilesListView, FileRow, PastedRow } from '../../filesView';
import { filesButtonLabel } from '../../filesView';
import { EditorLogo, IconCode, IconDoc, IconExplorer, IconFiles, IconFoldChev, IconImage } from '../Icons';
import type { EditorProduct } from '../../../editors';
import { Menu, MenuItem } from '../Menu';
import './FilesButton.css';

export interface FilesButtonProps {
  view: FilesListView;
  // Changes when the header shows another thread: the list closes and the folds
  // go back to their defaults.
  threadKey: string;
  // "VS Code": the primary detected editor, for the right-click menu's first item.
  editorName: string;
  // Its product, for the logo beside that item (the thread menu's convention).
  editorProduct?: EditorProduct;
  // Called on every open, so the list is re-read from the transcript.
  onOpenList: () => void;
  onOpenFile: (path: string) => void;
  onRevealFile: (path: string) => void;
  onCopyFile: (path: string) => void;
  onOpenPasted: (key: string) => void;
  onRevealPasted: (key: string) => void;
  onCopyPasted: (key: string) => void;
  // A small data URL for a pasted image, or null when it cannot be read.
  thumb: (key: string) => Promise<string | null>;
}

// Thumbnails, once read, for as long as the renderer lives. Keys are unique per
// session (an entry uuid and an index), so there is no need to scope by thread.
const thumbCache = new Map<string, string | null>();

const GAP_BELOW_BUTTON = 8;
const MARGIN = 12;

export function FilesButton(props: FilesButtonProps) {
  const { view, threadKey, editorName, editorProduct } = props;
  const label = filesButtonLabel(view.count);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ top: number; right: number; maxHeight: number }>({ top: 0, right: 0, maxHeight: 400 });
  // The user's own fold choices for this thread; unset means the default
  // (Code starts unfolded only when the chat changed nothing but code).
  const [codeChoice, setCodeChoice] = useState<boolean | null>(null);
  const [pastedOpen, setPastedOpen] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[]; sel: string } | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef(menu);
  menuRef.current = menu;

  const codeOpen = codeChoice ?? view.codeStartsOpen;

  // Another thread in the header: close, and forget this thread's fold choices.
  useEffect(() => {
    setOpen(false);
    setMenu(null);
    setCodeChoice(null);
    setPastedOpen(false);
  }, [threadKey]);

  const measure = useCallback(() => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const top = rect.bottom + GAP_BELOW_BUTTON;
    setPlace({
      top,
      right: Math.max(MARGIN, window.innerWidth - rect.right),
      maxHeight: Math.max(160, window.innerHeight - top - MARGIN),
    });
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setMenu(null);
  }, []);

  const toggle = () => {
    if (open) { close(); return; }
    measure();
    setOpen(true);
    props.onOpenList();
  };

  useLayoutEffect(() => {
    if (!open) return;
    popRef.current?.focus({ preventScroll: true });
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open, measure]);

  // Esc and a click outside close the list. With the right-click menu open, Esc and
  // the outside click belong to the menu (Menu closes itself on both).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || menuRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      close();
      btnRef.current?.focus({ preventScroll: true });
    };
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (target && (popRef.current?.contains(target) || btnRef.current?.contains(target))) return;
      if (menuRef.current) return;
      close();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open, close]);

  // Thumbnails are read the first time the pasted row is unfolded while open.
  useEffect(() => {
    if (!open || !pastedOpen) return;
    let cancelled = false;
    for (const p of view.pasted) {
      if (thumbCache.has(p.key)) {
        const cached = thumbCache.get(p.key)!;
        setThumbs(t => (p.key in t ? t : { ...t, [p.key]: cached }));
        continue;
      }
      props.thumb(p.key).then(url => {
        thumbCache.set(p.key, url);
        if (!cancelled) setThumbs(t => ({ ...t, [p.key]: url }));
      });
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pastedOpen, view.pasted]);

  if (!label) return null;

  const openFile = (row: FileRow) => { close(); props.onOpenFile(row.path); };
  const openPasted = (p: PastedRow) => { close(); props.onOpenPasted(p.key); };

  const fileMenu = (e: React.MouseEvent, row: FileRow) => {
    e.preventDefault();
    setMenu({
      x: e.clientX, y: e.clientY, sel: row.path,
      items: [
        { label: editorName ? `Open in ${editorName}` : 'Open', right: editorProduct ? <EditorLogo product={editorProduct} size={16} /> : undefined, onSelect: () => openFile(row) },
        { label: 'Show in File Explorer', right: <IconExplorer size={16} />, onSelect: () => props.onRevealFile(row.path) },
        { label: 'Copy path', onSelect: () => props.onCopyFile(row.path) },
      ],
    });
  };

  const pastedMenu = (e: React.MouseEvent, p: PastedRow) => {
    e.preventDefault();
    setMenu({
      x: e.clientX, y: e.clientY, sel: p.key,
      items: [
        { label: 'Open', onSelect: () => openPasted(p) },
        { label: 'Show in File Explorer', right: <IconExplorer size={16} />, onSelect: () => props.onRevealPasted(p.key) },
        { label: 'Copy path', onSelect: () => props.onCopyPasted(p.key) },
      ],
    });
  };

  const row = (f: FileRow, code: boolean, i = 0) => (
    <button
      key={f.path}
      type="button"
      className={`frow${code ? ' code' : ''}${menu?.sel === f.path ? ' sel' : ''}`}
      style={{ '--i': i } as React.CSSProperties}
      data-file-row={code ? 'code' : 'doc'}
      data-path={f.path}
      data-source={f.source}
      tabIndex={code && !codeOpen ? -1 : undefined}
      onClick={() => openFile(f)}
      onContextMenu={e => fileMenu(e, f)}
    >
      <span className="fi">{code ? <IconCode size={13} /> : <IconDoc size={15} />}</span>
      <span className="fn">{f.name}</span>
      {f.created && !code && <span className="ftag">New</span>}
      <span className="fd">{f.folder}</span>
      <span className="ft">{f.ago}</span>
    </button>
  );

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`fbtn${open ? ' open' : ''}`}
        data-files-button
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
      >
        <IconFiles size={15} />
        {label}
      </button>
      <div
        ref={popRef}
        className={`fpop${open ? ' open' : ''}`}
        role="dialog"
        aria-label="Files this chat changed"
        aria-hidden={!open}
        tabIndex={-1}
        data-files-list
        style={{ top: place.top, right: place.right, maxHeight: place.maxHeight }}
      >
        {view.docs.length > 0 ? (
          <>
            <div className="fsec">Documents<span className="n">{view.docs.length}</span></div>
            {view.docs.map(d => row(d, false))}
          </>
        ) : (
          <div className="fempty">No documents in this chat yet</div>
        )}

        {view.code.length > 0 && (
          <>
            <button
              type="button"
              className="ffold"
              data-fold="code"
              aria-expanded={codeOpen}
              onClick={() => setCodeChoice(!codeOpen)}
            >
              <IconCode size={13} />
              <span>Code</span>
              <span className="n">{view.code.length}</span>
              <span className="fill" />
              <span className="chev"><IconFoldChev size={12} /></span>
            </button>
            <div className={`fbody${codeOpen ? ' open' : ''}`} data-fold-body="code">
              <div>{view.code.map((c, i) => row(c, true, i))}</div>
            </div>
          </>
        )}

        {view.pasted.length > 0 && (
          <>
            <button
              type="button"
              className="ffold"
              data-fold="pasted"
              aria-expanded={pastedOpen}
              onClick={() => setPastedOpen(!pastedOpen)}
            >
              <IconImage size={13} />
              <span>Images you pasted</span>
              <span className="n">{view.pasted.length}</span>
              <span className="fill" />
              <span className="chev"><IconFoldChev size={12} /></span>
            </button>
            <div className={`fbody${pastedOpen ? ' open' : ''}`} data-fold-body="pasted">
              <div>
                <div className="fpasted">
                  {view.pasted.map(p => (
                    <button
                      key={p.key}
                      type="button"
                      className={`fpi${menu?.sel === p.key ? ' sel' : ''}`}
                      data-pasted={p.n}
                      tabIndex={pastedOpen ? undefined : -1}
                      onClick={() => openPasted(p)}
                      onContextMenu={e => pastedMenu(e, p)}
                    >
                      <span className="big">
                        {thumbs[p.key] ? <img src={thumbs[p.key]!} alt={`Pasted image #${p.n}`} draggable={false} /> : <IconImage size={20} />}
                        {p.repeat && <span className="frepeat" data-repeat={p.repeat}>{p.repeat}</span>}
                      </span>
                      <span className="cap">{p.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
      {menu && <Menu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </>
  );
}

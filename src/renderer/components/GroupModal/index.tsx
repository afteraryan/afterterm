import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { GroupColor, COLOR_CYCLE, GROUP_COLORS, pathBasename, ProjectIconId, PROJECT_ICON_IDS } from '../TabBar/types';
import { groupColors, isCustomColor } from '../../projectColour';
import { IconCheck, IconChevD, IconFolder, IconPencil, ProjectIcon } from '../Icons';
import { Menu, MenuItem } from '../Menu';
import { ColourWheel } from './ColourWheel';
import './GroupModal.css';

export interface GroupDraft {
  label: string;
  color: GroupColor;
  cwd?: string;
  shellId?: string;
  icon?: ProjectIconId;
}

// The plain word shown as each icon button's tooltip and read by the harness,
// in PROJECT_ICON_IDS order.
const ICON_LABELS: Record<ProjectIconId, string> = {
  book: 'Book',
  robot: 'Robot',
  bulb: 'Bulb',
  globe: 'Globe',
  pen: 'Pen',
  film: 'Film',
  house: 'House',
  music: 'Music note',
  bell: 'Bell',
  rocket: 'Rocket',
};

// Space kept between the colour and icon pop-up and the window's edge, and between it
// and the large icon.
const POP_EDGE = 8;
const POP_GAP = 10;

interface GroupModalProps {
  mode: 'create' | 'edit';
  initial: GroupDraft;
  shells: { id: string; name: string }[];
  onCancel: () => void;
  // openTerminal is only ever true in create mode (the checkbox is hidden when editing).
  onSubmit: (draft: GroupDraft, openTerminal: boolean) => void;
}

export function GroupModal({ mode, initial, shells, onCancel, onSubmit }: GroupModalProps) {
  const [label, setLabel] = useState(initial.label);
  const [color, setColor] = useState<GroupColor>(initial.color);
  const [icon, setIcon] = useState<ProjectIconId | undefined>(initial.icon);
  const [cwd, setCwd] = useState<string | undefined>(initial.cwd);
  const [shellId, setShellId] = useState<string | undefined>(initial.shellId);
  const [openTerminal, setOpenTerminal] = useState(true);
  // The shell dropdown's place on screen, null while it is closed.
  const [shellMenu, setShellMenu] = useState<{ x: number; y: number; width: number } | null>(null);
  // The pop-up the large icon opens, holding the colours and icons, and the wheel inside it.
  const [lookOpen, setLookOpen] = useState(false);
  const [wheelOpen, setWheelOpen] = useState(false);
  const [lookPos, setLookPos] = useState({ left: 0, top: 0 });
  const nameRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLButtonElement>(null);
  const lookRef = useRef<HTMLDivElement>(null);

  // Whether the name is still auto-derived from the folder. Typing anything turns this
  // off for good, so picking a different folder never overwrites a hand-typed name.
  const nameFollowsFolder = useRef(mode === 'create' && !initial.label);

  // Escape closes the innermost thing open: the shell dropdown (Menu listens for that
  // itself), then the wheel, then the pop-up, and only then the dialog.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || shellMenu) return;
      if (wheelOpen) setWheelOpen(false);
      else if (lookOpen) setLookOpen(false);
      else onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel, shellMenu, wheelOpen, lookOpen]);

  // The pop-up hangs under the large icon. In a window too short for that it moves
  // beside the icon instead of up over it: the icon is the live preview of what is
  // being chosen, so it must stay visible.
  useLayoutEffect(() => {
    if (!lookOpen) return;
    const place = () => {
      if (!previewRef.current || !lookRef.current) return;
      const anchor = previewRef.current.getBoundingClientRect();
      const { offsetWidth: width, offsetHeight: height } = lookRef.current;
      const bottomLimit = window.innerHeight - POP_EDGE;
      setLookPos(anchor.bottom + POP_GAP + height <= bottomLimit
        ? { left: anchor.left, top: anchor.bottom + POP_GAP }
        : {
          left: Math.min(anchor.right + POP_GAP, window.innerWidth - width - POP_EDGE),
          top: Math.max(POP_EDGE, bottomLimit - height),
        });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [lookOpen, wheelOpen]);

  const chooseFolder = useCallback(async () => {
    const folder = await window.afterterm.dialog.pickFolder();
    if (!folder) return;
    setCwd(folder);
    if (nameFollowsFolder.current) setLabel(pathBasename(folder));
    nameRef.current?.focus();
  }, []);

  const submit = () => {
    const finalLabel = label.trim() || (cwd ? pathBasename(cwd) : 'New Group');
    onSubmit({ label: finalLabel, color, cwd, shellId, icon }, mode === 'create' && openTerminal);
  };

  const look = groupColors(color);
  const custom = isCustomColor(color);

  // A project with no shell of its own, or one no longer on this machine, opens the
  // first shell in the list, so that is the one the dropdown shows.
  const currentShell = shells.find(s => s.id === shellId) ?? shells[0];
  const shellItems: MenuItem[] = shells.map(s => ({
    label: s.name,
    right: s.id === currentShell?.id ? <IconCheck size={16} /> : undefined,
    onSelect: () => setShellId(s.id),
  }));

  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div
        className="modal-card project-card"
        // The card stops this mouse down from reaching the window, where Menu listens
        // for a click outside it, so the card closes what is open itself.
        onMouseDown={e => {
          e.stopPropagation();
          setShellMenu(null);
          setLookOpen(false);
          setWheelOpen(false);
        }}
      >
        <div className="modal-title">
          {mode === 'create' ? 'New project' : 'Edit project'}
        </div>

        <div className="modal-top">
          <button
            type="button"
            ref={previewRef}
            className="modal-preview"
            data-project-preview
            data-tip="Change colour and icon"
            aria-label="Change colour and icon"
            aria-expanded={lookOpen}
            style={{ color: look.border, background: look.bg }}
            // Stopped here so the card does not close the pop-up just before this
            // button's click would open it again.
            onMouseDown={e => { e.stopPropagation(); setShellMenu(null); }}
            onClick={() => {
              setWheelOpen(false);
              setLookOpen(open => !open);
            }}
          >
            {icon ? <ProjectIcon icon={icon} size={42} /> : <IconFolder size={42} />}
            <span className="modal-preview-mark"><IconPencil size={12} /></span>
          </button>
          <label className="modal-field modal-name">
            <span className="modal-label">Name</span>
            <input
              ref={nameRef}
              autoFocus
              className="modal-input"
              value={label}
              placeholder="Project name"
              onChange={e => { nameFollowsFolder.current = false; setLabel(e.target.value); }}
              onKeyDown={e => { if (e.key === 'Enter') submit(); }}
            />
          </label>
        </div>

        <div className="modal-rows">
          <div className="modal-row">
            <span className="modal-label">Folder</span>
            <div className="modal-folder-row">
              <span className={`modal-input modal-folder-path ${cwd ? '' : 'empty'}`} title={cwd}>
                {cwd ?? 'Not set (opens in your home folder)'}
              </span>
              <button className="modal-btn-secondary b" onClick={chooseFolder}>
                {cwd ? 'Change' : 'Browse'}
              </button>
            </div>
          </div>

          <div className="modal-row">
            <span className="modal-label">Shell</span>
            <button
              type="button"
              className="modal-input modal-select"
              data-shell-select
              aria-haspopup="menu"
              aria-expanded={!!shellMenu}
              // Stopped for the same reason as the large icon's mouse down.
              onMouseDown={e => { e.stopPropagation(); setLookOpen(false); setWheelOpen(false); }}
              onClick={e => {
                const rect = e.currentTarget.getBoundingClientRect();
                setShellMenu(open => open ? null : { x: rect.left, y: rect.bottom + 4, width: rect.width });
              }}
            >
              <span>{currentShell?.name}</span>
              <IconChevD size={15} />
            </button>
          </div>
        </div>

        <div className="modal-actions">
          {mode === 'create' && (
            <label className="modal-checkbox">
              <input
                type="checkbox"
                checked={openTerminal}
                onChange={e => setOpenTerminal(e.target.checked)}
              />
              <span>Open a terminal in it now</span>
            </label>
          )}
          <div className="modal-buttons">
            <button className="modal-btn-secondary b q" onClick={onCancel}>Cancel</button>
            <button className="modal-btn-primary b p" onClick={submit}>
              {mode === 'create' ? 'Create' : 'Save'}
            </button>
          </div>
        </div>

        {lookOpen && (
          <div
            ref={lookRef}
            className="modal-look"
            data-project-look
            style={lookPos}
            onMouseDown={e => e.stopPropagation()}
          >
            <div className="modal-swatches">
              {COLOR_CYCLE.map(c => (
                <button
                  key={c}
                  type="button"
                  className={`color-swatch ${color === c ? 'active-swatch' : ''}`}
                  data-color={c}
                  aria-label={c}
                  aria-pressed={color === c}
                  style={{ background: GROUP_COLORS[c].border }}
                  onClick={() => { setColor(c); setWheelOpen(false); }}
                />
              ))}
              <button
                type="button"
                className={`color-swatch wheel-swatch ${custom ? 'custom active-swatch' : ''}`}
                data-wheel-swatch
                aria-label="Choose any colour"
                aria-expanded={wheelOpen}
                style={custom ? { background: look.border } : undefined}
                onClick={() => setWheelOpen(open => !open)}
              />
            </div>

            {wheelOpen && <ColourWheel initial={look.border} onChange={setColor} />}

            <div className="modal-icons">
              <button
                type="button"
                className="icon-swatch"
                data-tip="Folder"
                data-icon="folder"
                aria-pressed={icon === undefined}
                style={icon === undefined ? { color: look.border, background: look.bg } : undefined}
                onClick={() => setIcon(undefined)}
              >
                <IconFolder size={18} />
              </button>
              {PROJECT_ICON_IDS.map(id => (
                <button
                  key={id}
                  type="button"
                  className="icon-swatch"
                  data-tip={ICON_LABELS[id]}
                  data-icon={id}
                  aria-pressed={icon === id}
                  style={icon === id ? { color: look.border, background: look.bg } : undefined}
                  onClick={() => setIcon(id)}
                >
                  <ProjectIcon icon={id} size={18} />
                </button>
              ))}
            </div>
          </div>
        )}

        {shellMenu && (
          <Menu
            x={shellMenu.x}
            y={shellMenu.y}
            minWidth={shellMenu.width}
            items={shellItems}
            onClose={() => setShellMenu(null)}
          />
        )}
      </div>
    </div>
  );
}

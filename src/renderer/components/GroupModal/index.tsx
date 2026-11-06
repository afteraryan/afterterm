import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GroupColor, GROUP_COLORS, COLOR_CYCLE, pathBasename, ProjectIconId, PROJECT_ICON_IDS } from '../TabBar/types';
import { IconCheck, IconChevD, IconFolder, ProjectIcon } from '../Icons';
import { Menu, MenuItem } from '../Menu';
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
  const nameRef = useRef<HTMLInputElement>(null);

  // Whether the name is still auto-derived from the folder. Typing anything turns this
  // off for good, so picking a different folder never overwrites a hand-typed name.
  const nameFollowsFolder = useRef(mode === 'create' && !initial.label);

  // Escape with the shell dropdown open closes only the dropdown (Menu listens for it).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && !shellMenu) onCancel(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel, shellMenu]);

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
        className="modal-card"
        // The card stops this mouse down from reaching the window, where Menu listens
        // for a click outside it, so the card closes the dropdown itself.
        onMouseDown={e => { e.stopPropagation(); setShellMenu(null); }}
      >
        <div className="modal-title">
          {mode === 'create' ? 'New project' : 'Edit project'}
        </div>

        <div className="modal-top">
          <div
            className="modal-preview"
            data-project-preview
            style={{ color: GROUP_COLORS[color].border, background: GROUP_COLORS[color].bg }}
          >
            {icon ? <ProjectIcon icon={icon} size={64} /> : <IconFolder size={64} />}
          </div>
          <div className="modal-top-fields">
            <label className="modal-field">
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

            <div className="modal-field">
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
          </div>
        </div>

        <div className="modal-rows">
          <div className="modal-row">
            <span className="modal-label">Colour</span>
            <div className="modal-swatches">
              {COLOR_CYCLE.map(c => (
                <div
                  key={c}
                  className={`color-swatch ${color === c ? 'active-swatch' : ''}`}
                  style={{ background: GROUP_COLORS[c].border }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>

          <div className="modal-row">
            <span className="modal-label">Icon</span>
            <div className="modal-icons">
              <button
                type="button"
                className="icon-swatch"
                data-tip="Folder"
                data-icon="folder"
                aria-pressed={icon === undefined}
                style={icon === undefined ? {
                  color: GROUP_COLORS[color].border,
                  background: GROUP_COLORS[color].bg,
                } : undefined}
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
                  style={icon === id ? {
                    color: GROUP_COLORS[color].border,
                    background: GROUP_COLORS[color].bg,
                  } : undefined}
                  onClick={() => setIcon(id)}
                >
                  <ProjectIcon icon={id} size={18} />
                </button>
              ))}
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
              // Stopped here so the card does not close the dropdown just before this
              // button's click would open it again.
              onMouseDown={e => e.stopPropagation()}
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

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GroupColor, GROUP_COLORS, COLOR_CYCLE, pathBasename, ProjectIconId, PROJECT_ICON_IDS } from '../TabBar/types';
import { IconFolder, ProjectIcon } from '../Icons';
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
  const nameRef = useRef<HTMLInputElement>(null);

  // Whether the name is still auto-derived from the folder. Typing anything turns this
  // off for good, so picking a different folder never overwrites a hand-typed name.
  const nameFollowsFolder = useRef(mode === 'create' && !initial.label);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);

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

  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div className="modal-card" onMouseDown={e => e.stopPropagation()}>
        <div className="modal-title">
          {mode === 'create' ? 'New project' : 'Edit project'}
        </div>

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

        <div className="modal-field">
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

        <div className="modal-field">
          <span className="modal-label">Default shell</span>
          <div className="modal-shells">
            <button
              className="modal-shell"
              aria-pressed={shellId === undefined}
              onClick={() => setShellId(undefined)}
            >
              Default shell
            </button>
            {shells.map(s => (
              <button
                key={s.id}
                className="modal-shell"
                aria-pressed={shellId === s.id}
                onClick={() => setShellId(s.id)}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>

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

        <div className="modal-actions">
          <button className="modal-btn-secondary b q" onClick={onCancel}>Cancel</button>
          <button className="modal-btn-primary b p" onClick={submit}>
            {mode === 'create' ? 'Create' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

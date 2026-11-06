// The one Rename dialog, for a thread (the thread menus) and a project (the project
// menu). A dialog rather than editing in place, because those menus open from places
// with no name to edit, such as a rail tile. The caller decides what a saved text
// means; the card look comes from GroupModal.css's .modal-overlay and .modal-card.
import React, { useEffect, useRef, useState } from 'react';
import './RenameDialog.css';

export interface RenameDialogProps {
  title: string;
  initial: string;
  // Shown when the field is empty: what the name goes back to. Without one, an empty
  // name cannot be saved.
  placeholder?: string;
  onSave: (name: string) => void;
  onCancel: () => void;
}

export function RenameDialog({ title, initial, placeholder, onSave, onCancel }: RenameDialogProps) {
  const [name, setName] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  const canSave = placeholder !== undefined || name.trim().length > 0;

  useEffect(() => {
    inputRef.current?.select();
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);

  const save = () => { if (canSave) onSave(name); };

  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div className="modal-card rename-card" data-rename-dialog role="dialog" aria-modal="true" onMouseDown={e => e.stopPropagation()}>
        <h2 className="modal-title">{title}</h2>
        <input
          ref={inputRef}
          autoFocus
          className="modal-input"
          aria-label="Name"
          value={name}
          placeholder={placeholder}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); }}
        />
        <div className="rename-actions">
          <button type="button" className="b q" onClick={onCancel}>Cancel</button>
          <button type="button" className="b p" data-save disabled={!canSave} onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}
